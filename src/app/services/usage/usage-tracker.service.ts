import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { environment } from '../../../environments/environment';
import { StorageService } from '../storage.service';
import { WsService } from '../ws.service';
import { clickLabel, clientInfo, cut, normalizePath, uuid } from './usage-helpers';
import { PresenceReport, PresenceState, UsageBatch, UsageClientInfo, UsageEvent, UsageEventKind } from './usage.model';

/** Sem interação há mais que isto = ausente (pedido do usuário: 5 min). */
export const AWAY_AFTER_MS = 5 * 60_000;
const FLUSH_EVERY_MS = 5 * 60_000;
const FLUSH_AT_EVENTS = 200;
const MAX_BUFFER = 1000;
/** `fetch` com keepalive aceita ~64 KB por página; cada parte fica abaixo disto. */
const MAX_BODY_BYTES = 60_000;
const TICK_MS = 15_000;
const INPUT_THROTTLE_MS = 5_000;
const PRESENCE_DEBOUNCE_MS = 1_000;
/** Reenvia a presença (última interação) mesmo sem mudança de estado — vai ao relay, não custa no Cloud Run. */
const PRESENCE_REFRESH_MS = 60_000;

const SESSION_KEY = 'cime.usage.session';
const LOGIN_FLAG_KEY = 'cime.usage.login';
const CLICK_SELECTOR = 'button, a, [role=menuitem], [role=tab], [role=option], mat-slide-toggle, mat-chip, mat-chip-option, .mat-mdc-chip';

interface CurrentView {
  screen: string;
  route: string;
  card: string | null;
  enteredAt: number;
  foregroundMs: number;
}

/**
 * Dados de uso (0079). Uma sessão por aba (sessionStorage). Registra telas (com o tempo em primeiro plano), cliques,
 * ações e erros (pelo `UsageInterceptor`) e marcos nomeados (`track`), e manda em LOTE para a API: a cada 5 min (só
 * se houver eventos), ao juntar 200, e ao ocultar/fechar a aba ou sair. A presença (ativo, executando, segundo plano,
 * ausente, tela e o que está fazendo) vai em TEMPO REAL pelo hub do relay — nada disso mantém request aberto no
 * Cloud Run. Telemetria nunca quebra a tela: todo erro é engolido.
 */
@Injectable({ providedIn: 'root' })
export class UsageTrackerService {
  private readonly router = inject(Router);
  private readonly storage = inject(StorageService);
  private readonly ws = inject(WsService);

  /** Estado atual desta aba. */
  readonly state = signal<PresenceState>('active');
  /** O que está em andamento (rótulo), ou null. */
  readonly busyLabel = signal<string | null>(null);

  private started = false;
  private teardown: Array<() => void> = [];
  private sessionId = '';
  private startedAt = '';
  private client!: UsageClientInfo;

  private buffer: UsageEvent[] = [];
  private current: CurrentView | null = null;
  private flushing = false;

  private foregroundMs = 0;
  private backgroundMs = 0;
  private awayMs = 0;
  private lastTick = Date.now();
  private lastInputAt = Date.now();
  private stateSince = Date.now();
  private focused = document.hasFocus();

  private busySeq = 0;
  private readonly busyItems = new Map<number, string>();

  private presenceTimer?: ReturnType<typeof setTimeout>;
  private lastPresenceKey = '';
  private lastPresenceAt = 0;

  // ---- ciclo de vida (PageContainer) ----

  start(destroyRef: DestroyRef): void {
    if (this.started) return;
    this.started = true;
    try {
      this.begin();
    } catch {
      /* telemetria não quebra a tela */
    }
    destroyRef.onDestroy(() => this.stop(false));
  }

  /** Logout: fecha a sessão (a próxima entrada nesta aba é uma sessão nova). */
  endSession(): void {
    if (!this.started) return;
    this.track('logout', null, 'logout');
    this.stop(true);
  }

  private begin(): void {
    const now = Date.now();
    this.client = clientInfo();
    const saved = this.readSession();
    this.sessionId = saved?.id ?? uuid();
    this.startedAt = saved?.startedAt ?? new Date(now).toISOString();
    this.writeSession();
    this.lastTick = now;
    this.lastInputAt = now;
    this.stateSince = now;
    this.foregroundMs = saved?.foregroundMs ?? 0;
    this.backgroundMs = saved?.backgroundMs ?? 0;
    this.awayMs = saved?.awayMs ?? 0;

    if (sessionStorage.getItem(LOGIN_FLAG_KEY)) {
      sessionStorage.removeItem(LOGIN_FLAG_KEY);
      this.push({ kind: 'login', name: 'login' });
    }

    const nav = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.safe(() => this.onNavigation(e.urlAfterRedirects)));
    this.teardown.push(() => nav.unsubscribe());
    this.safe(() => this.onNavigation(this.router.url));

    const onInput = () => this.onInput();
    const inputEvents = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove', 'scroll'];
    inputEvents.forEach((ev) => document.addEventListener(ev, onInput, { passive: true, capture: true }));
    const onClick = (e: MouseEvent) => this.safe(() => this.onClick(e));
    document.addEventListener('click', onClick, { capture: true });
    const onVisibility = () => this.safe(() => {
      this.refresh();
      if (document.hidden) void this.flush(false);
    });
    document.addEventListener('visibilitychange', onVisibility);
    const onFocus = () => { this.focused = true; this.onInput(); };
    const onBlur = () => { this.focused = false; this.refresh(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    const onPageHide = () => this.safe(() => {
      this.closeView();
      void this.flush(true);
    });
    window.addEventListener('pagehide', onPageHide);

    const tick = setInterval(() => this.safe(() => this.refresh()), TICK_MS);
    const flushTimer = setInterval(() => { if (this.buffer.length) void this.flush(false); }, FLUSH_EVERY_MS);
    const reconnected = this.ws._reconnected.subscribe(() => this.schedulePresence(true));

    this.teardown.push(() => {
      inputEvents.forEach((ev) => document.removeEventListener(ev, onInput, { capture: true }));
      document.removeEventListener('click', onClick, { capture: true });
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pagehide', onPageHide);
      clearInterval(tick);
      clearInterval(flushTimer);
      clearTimeout(this.presenceTimer);
      reconnected.unsubscribe();
    });

    this.refresh();
    this.schedulePresence(true);
  }

  private stop(ended: boolean): void {
    if (!this.started) return;
    this.safe(() => {
      this.accumulate(Date.now());
      this.closeView();
      void this.flush(true, ended);
    });
    this.teardown.forEach((fn) => this.safe(fn));
    this.teardown = [];
    this.busyItems.clear();
    this.busyLabel.set(null);
    this.current = null;
    if (ended) {
      sessionStorage.removeItem(SESSION_KEY);
      this.foregroundMs = this.backgroundMs = this.awayMs = 0;
    }
    this.started = false;
  }

  // ---- API pública ----

  /** Marco estratégico nomeado (ex.: "Buscar card"). */
  track(name: string, detail?: string | null, kind: UsageEventKind = 'track'): void {
    if (!this.started) return;
    this.safe(() => this.push({ kind, name: cut(name, 120) ?? name, detail: cut(detail ?? null, 300) }));
  }

  /** Algo em andamento ("executando"); devolve a função que encerra. */
  busy(label: string): () => void {
    const id = ++this.busySeq;
    this.busyItems.set(id, cut(label, 120) ?? 'Processando');
    this.safe(() => this.refresh());
    return () => {
      if (!this.busyItems.delete(id)) return;
      this.safe(() => this.refresh());
    };
  }

  /** Registro vindo do interceptor HTTP. */
  record(kind: 'action' | 'error' | 'slow', name: string, detail: string | null, status: number | null, durationMs: number): void {
    if (!this.started) return;
    this.safe(() => this.push({ kind, name, detail, status, durationMs: Math.round(durationMs) }));
  }

  /** O login acabou de acontecer nesta aba: o próximo start registra o evento `login`. */
  static markLogin(): void {
    try {
      sessionStorage.setItem(LOGIN_FLAG_KEY, '1');
      sessionStorage.removeItem(SESSION_KEY);
    } catch { /* sem sessionStorage */ }
  }

  // ---- telas e cliques ----

  private onNavigation(url: string): void {
    const route = normalizePath(new URL(url, 'http://x').pathname);
    const card = new URL(url, 'http://x').searchParams.get('card')?.trim() || null;
    const screen = this.screenTitle(route);
    if (this.current && this.current.route === route && this.current.card === card) return;
    this.accumulate(Date.now());
    this.closeView();
    this.current = { screen, route, card, enteredAt: Date.now(), foregroundMs: 0 };
    this.schedulePresence();
  }

  private screenTitle(route: string): string {
    let snapshot: ActivatedRouteSnapshot | null = this.router.routerState.snapshot.root;
    let title: string | null = null;
    while (snapshot) {
      const tab = snapshot.data?.['tab'] as { title?: string } | undefined;
      if (tab?.title) title = tab.title;
      snapshot = snapshot.firstChild;
    }
    if (route.includes('/user/usage')) return 'Análise de uso';
    if (route.includes('/user/manager')) return 'Gestão de usuários';
    return title ?? (route.split('/').filter(Boolean).pop() || 'Início');
  }

  /** Fecha a tela atual: um evento `view` com o tempo em primeiro plano nela. */
  private closeView(): void {
    const view = this.current;
    if (!view) return;
    this.current = null;
    this.push({
      kind: 'view',
      at: new Date(view.enteredAt).toISOString(),
      name: view.screen,
      screen: view.screen,
      route: view.route,
      card: view.card,
      durationMs: Math.round(view.foregroundMs),
    });
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as Element | null;
    if (!target?.closest) return;
    if (target.closest('[data-usage-ignore]')) return;
    if (target.matches('input, textarea, select') && !target.closest('mat-slide-toggle')) return;
    const el = target.closest(CLICK_SELECTOR);
    if (!el) return;
    const label = clickLabel(el);
    if (!label) return;
    const href = el instanceof HTMLAnchorElement && el.getAttribute('href') ? normalizePath(el.getAttribute('href')!) : null;
    this.push({ kind: 'click', name: label, detail: href });
  }

  // ---- estado, tempo e presença ----

  private onInput(): void {
    const now = Date.now();
    if (now - this.lastInputAt < INPUT_THROTTLE_MS && this.state() !== 'away') return;
    this.accumulate(now);
    this.lastInputAt = now;
    if (this.state() === 'away' || this.state() === 'background') this.refresh();
  }

  /** Soma o tempo desde o último tique no balde certo (primeiro plano, segundo plano ou ausente). */
  private accumulate(now: number): void {
    const delta = Math.max(0, Math.min(now - this.lastTick, 10 * 60_000));
    this.lastTick = now;
    if (!delta) return;
    const away = now - this.lastInputAt >= AWAY_AFTER_MS;
    if (away) this.awayMs += delta;
    else if (document.hidden) this.backgroundMs += delta;
    else {
      this.foregroundMs += delta;
      if (this.current) this.current.foregroundMs += delta;
    }
  }

  private refresh(): void {
    const now = Date.now();
    this.accumulate(now);
    const labels = [...this.busyItems.values()];
    const busy = labels.length ? labels[labels.length - 1] : null;
    this.busyLabel.set(busy);
    let next: PresenceState;
    if (busy) next = 'busy';
    else if (now - this.lastInputAt >= AWAY_AFTER_MS) next = 'away';
    else if (document.hidden) next = 'background';
    else next = 'active';
    if (next !== this.state()) {
      this.state.set(next);
      this.stateSince = now;
    }
    this.writeSession();
    this.schedulePresence();
  }

  private schedulePresence(force = false): void {
    if (!this.started) return;
    if (force) this.lastPresenceKey = '';
    clearTimeout(this.presenceTimer);
    this.presenceTimer = setTimeout(() => this.safe(() => this.sendPresence()), PRESENCE_DEBOUNCE_MS);
  }

  private sendPresence(): void {
    if (!this.started || !this.ws.isConnected()) return;
    const report = this.report();
    const key = [report.state, report.visible, report.focused, report.screen, report.card, report.busy].join('|');
    const now = Date.now();
    if (key === this.lastPresenceKey && now - this.lastPresenceAt < PRESENCE_REFRESH_MS) return;
    this.lastPresenceKey = key;
    this.lastPresenceAt = now;
    this.ws.invoke('UpdatePresence', report).catch(() => {
      this.lastPresenceKey = '';
    });
  }

  private report(): PresenceReport {
    const user = this.storage.getAccess()?.user;
    return {
      sessionId: this.sessionId,
      state: this.state(),
      visible: !document.hidden,
      focused: this.focused,
      screen: this.current?.screen ?? null,
      route: this.current?.route ?? null,
      card: this.current?.card ?? null,
      busy: this.busyLabel(),
      lastInputAt: new Date(this.lastInputAt).toISOString(),
      since: new Date(this.stateSince).toISOString(),
      startedAt: this.startedAt,
      fullName: user?.fullName ?? null,
      client: this.client,
    };
  }

  // ---- lotes ----

  private push(partial: Partial<UsageEvent> & { kind: UsageEventKind; name: string }): void {
    const event: UsageEvent = {
      at: partial.at ?? new Date().toISOString(),
      kind: partial.kind,
      screen: partial.screen !== undefined ? partial.screen : this.current?.screen ?? null,
      route: partial.route !== undefined ? partial.route : this.current?.route ?? null,
      card: partial.card !== undefined ? partial.card : this.current?.card ?? null,
      name: cut(partial.name, 120) ?? partial.kind,
      detail: partial.detail ?? null,
      durationMs: partial.durationMs ?? null,
      status: partial.status ?? null,
    };
    this.buffer.push(event);
    if (this.buffer.length > MAX_BUFFER) this.buffer.splice(0, this.buffer.length - MAX_BUFFER);
    if (this.buffer.length >= FLUSH_AT_EVENTS) void this.flush(false);
  }

  /**
   * Envia o que está no buffer (em partes ≤ 60 KB). `unloading`: a página está saindo — não espera resposta.
   * Falha (fora da saída) devolve os eventos ao buffer.
   */
  private async flush(unloading: boolean, ended = false): Promise<void> {
    if (this.flushing && !unloading) return;
    const apiKey = this.storage.getItem('apiKey');
    if (!apiKey || !this.sessionId) return;
    this.accumulate(Date.now());
    const events = this.buffer.splice(0, this.buffer.length);
    if (!events.length && !unloading && !ended) return;
    this.flushing = true;
    try {
      const parts = this.split(events);
      for (let i = 0; i < parts.length; i++) {
        const body = this.batch(parts[i], ended && i === parts.length - 1);
        const ok = await this.post(apiKey, body);
        if (!ok && !unloading) {
          this.buffer.unshift(...parts.slice(i).flat());
          if (this.buffer.length > MAX_BUFFER) this.buffer.splice(0, this.buffer.length - MAX_BUFFER);
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private split(events: UsageEvent[]): UsageEvent[][] {
    if (!events.length) return [[]];
    const parts: UsageEvent[][] = [];
    let part: UsageEvent[] = [];
    let size = 1200; // cabeçalho da sessão
    for (const e of events) {
      const len = JSON.stringify(e).length + 1;
      if (part.length && (size + len > MAX_BODY_BYTES || part.length >= 500)) {
        parts.push(part);
        part = [];
        size = 1200;
      }
      part.push(e);
      size += len;
    }
    if (part.length) parts.push(part);
    return parts;
  }

  private batch(events: UsageEvent[], ended: boolean): UsageBatch {
    return {
      session: {
        id: this.sessionId,
        startedAt: this.startedAt,
        screen: this.current?.screen ?? null,
        route: this.current?.route ?? null,
        foregroundMs: Math.round(this.foregroundMs),
        backgroundMs: Math.round(this.backgroundMs),
        awayMs: Math.round(this.awayMs),
        ended,
        client: this.client,
      },
      events,
    };
  }

  /** `sendBeacon` não manda cabeçalho: `fetch` com keepalive leva a x-api-key e sobrevive ao fechar a aba. */
  private async post(apiKey: string, body: UsageBatch): Promise<boolean> {
    try {
      const res = await fetch(`${environment.apiUrl}Usage/batch`, {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', 'x-api-key': `${apiKey}` },
        body: JSON.stringify(body),
      });
      return res.ok || (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429);
    } catch {
      return false;
    }
  }

  // ---- sessão (sessionStorage) ----

  private readSession(): { id: string; startedAt: string; foregroundMs: number; backgroundMs: number; awayMs: number } | null {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private writeSession(): void {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        id: this.sessionId,
        startedAt: this.startedAt,
        foregroundMs: Math.round(this.foregroundMs),
        backgroundMs: Math.round(this.backgroundMs),
        awayMs: Math.round(this.awayMs),
      }));
    } catch { /* sem sessionStorage */ }
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch {
      /* telemetria nunca quebra a tela */
    }
  }
}
