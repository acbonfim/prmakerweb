import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { ActivatedRouteSnapshot, DetachedRouteHandle, NavigationEnd, Route, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, filter } from 'rxjs';
import { StorageService } from './storage.service';

/** Máximo de abas abertas (0065). */
export const MAX_TABS = 10;
/** Aba em segundo plano há mais que isto, sem edição não salva, é congelada (0065). */
export const FREEZE_AFTER_MS = 10 * 60_000;
/** Tela de pouso (login, aba nova). */
export const HOME_URL = '/auth/dashboard';

const CHECK_MS = 30_000;
const SAVE_DEBOUNCE_MS = 300;
const STORAGE_PREFIX = 'prmake.tabs.v1.';

/** Dados que cada rota da área logada declara em `data.tab`. */
export interface TabRouteData {
  title: string;
  icon: string;
  /** A tela é de um card (`?card=`): a aba mostra o número, o título e o andamento do card. */
  card?: boolean;
}

export interface Tab {
  id: string;
  url: string;
  title: string;
  icon: string;
  /** Número do card, nas telas de card. */
  card: string | null;
  /** Momento em que deixou de ser a ativa; null enquanto é a ativa. */
  inactiveSince: number | null;
  /** Congelada: sem tela em memória; reabre pela URL. */
  frozen: boolean;
  /** Edição não salva na tela: não congela e pede confirmação ao fechar. */
  dirty: boolean;
}

interface PersistedTabs {
  tabs: Pick<Tab, 'id' | 'url' | 'title' | 'icon' | 'card'>[];
  activeId: string;
  savedAt: number;
}

interface StashedScreen {
  config: Route | null;
  handle: DetachedRouteHandle;
}

/**
 * Abas internas (feature 0065). Cada aba guarda a URL de uma tela da área logada; trocar de aba guarda a tela que sai
 * e reanexa a da que entra (ver `TabRouteReuseStrategy`), sem recarregar. As abas ficam em `localStorage` por usuário
 * e sobrevivem a F5, logout e novo login. Em segundo plano há mais de `FREEZE_AFTER_MS`, a tela é destruída (aba
 * "congelada") e reabre pela URL ao ser ativada.
 */
@Injectable({ providedIn: 'root' })
export class TabsService {
  private readonly router = inject(Router);
  private readonly storage = inject(StorageService);
  private readonly snack = inject(MatSnackBar);

  readonly tabs = signal<Tab[]>([]);
  readonly activeId = signal<string>('');
  readonly active = computed(() => this.tabs().find((t) => t.id === this.activeId()) ?? null);
  readonly canAdd = computed(() => this.tabs().length < MAX_TABS);
  readonly max = MAX_TABS;

  /** A aba vai sair de cena (a tela dela será guardada): quem usa estado compartilhado deve tirar uma foto. */
  readonly leaving$ = new Subject<string>();
  /** A tela guardada da aba foi reanexada: devolver o estado compartilhado e retomar o trabalho. */
  readonly entered$ = new Subject<string>();

  /** Troca de aba em andamento; a estratégia de rotas só guarda/reanexa telas enquanto isto existe. */
  switching: { from: string; to: string } | null = null;

  private readonly stash = new Map<string, StashedScreen>();
  private readonly scrolls = new Map<string, number>();
  private scrollHost?: HTMLElement;
  private started = false;
  private firstNavigationDone = false;
  private storageKey = '';
  private saveTimer?: ReturnType<typeof setTimeout>;
  private checkTimer?: ReturnType<typeof setInterval>;
  private teardown: Array<() => void> = [];

  // ---- ciclo de vida (PageContainer) ----

  start(destroyRef: DestroyRef): void {
    if (this.started) return;
    this.started = true;
    this.firstNavigationDone = false;
    const userId = `${this.storage.getAccess()?.user?.externalId ?? 'anonimo'}`.toLowerCase();
    this.storageKey = STORAGE_PREFIX + userId;

    const sub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.onNavigationEnd(e.urlAfterRedirects));
    this.teardown.push(() => sub.unsubscribe());

    this.checkTimer = setInterval(() => this.freezeIdle(), CHECK_MS);
    const onVisible = () => { if (!document.hidden) this.freezeIdle(); };
    const onHide = () => this.saveNow();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', onHide);
    this.teardown.push(() => {
      clearInterval(this.checkTimer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onHide);
    });

    destroyRef.onDestroy(() => this.stop());
  }

  /** Saiu da área logada (logout): libera as telas guardadas; as abas continuam gravadas para o próximo login. */
  private stop(): void {
    if (!this.started) return;
    this.saveNow();
    this.teardown.forEach((fn) => fn());
    this.teardown = [];
    [...this.stash.keys()].forEach((id) => this.discardScreen(id));
    this.scrolls.clear();
    this.switching = null;
    this.tabs.set([]);
    this.activeId.set('');
    this.started = false;
  }

  registerScrollHost(el: HTMLElement | undefined): void {
    this.scrollHost = el;
  }

  // ---- operações ----

  /** Abre uma aba (por padrão na Home) e a ativa. Devolve false (com aviso) se já há o máximo. */
  open(url: string = HOME_URL): boolean {
    if (!this.canAdd()) {
      this.snack.open(`Limite de ${MAX_TABS} abas. Feche uma para abrir outra.`, 'OK', { duration: 4000 });
      return false;
    }
    const tab = this.newTab(url);
    this.tabs.update((list) => [...list, tab]);
    void this.activate(tab.id);
    return true;
  }

  async activate(id: string): Promise<void> {
    const target = this.tabs().find((t) => t.id === id);
    if (!target) return;
    const from = this.activeId();
    if (from === id && this.router.url === target.url) return;

    const now = Date.now();
    if (from && from !== id) {
      if (this.scrollHost) this.scrolls.set(from, this.scrollHost.scrollTop);
      this.patch(from, { inactiveSince: now });
    }
    const hadScreen = this.stash.has(id);
    if (from && from !== id) this.leaving$.next(from);
    this.patch(id, { inactiveSince: null, frozen: false });
    this.activeId.set(id);
    this.switching = { from, to: id };
    this.scheduleSave();

    let ok = false;
    try {
      // 'reload': duas abas na mesma URL (ex.: duas Homes) também trocam de instância.
      ok = await this.router.navigateByUrl(target.url, { replaceUrl: true, onSameUrlNavigation: 'reload' });
    } catch {
      ok = false;
    } finally {
      this.switching = null;
    }
    if (!ok) {
      // URL que não abre mais (guarda de perfil, rota removida): a aba vira Home em vez de ficar quebrada.
      this.patch(id, { url: HOME_URL, title: 'Início', icon: 'home', card: null, dirty: false });
      await this.router.navigateByUrl(HOME_URL, { replaceUrl: true });
      return;
    }
    if (hadScreen) this.entered$.next(id);
    if (hadScreen && this.scrollHost) {
      const top = this.scrolls.get(id) ?? 0;
      requestAnimationFrame(() => { if (this.scrollHost) this.scrollHost.scrollTop = top; });
    }
  }

  /** Fecha a aba; na ativa, ativa a vizinha. Sempre sobra uma aba (Home). */
  close(id: string): void {
    const list = this.tabs();
    const index = list.findIndex((t) => t.id === id);
    if (index < 0) return;
    const wasActive = id === this.activeId();
    this.discardScreen(id);
    this.scrolls.delete(id);
    const rest = list.filter((t) => t.id !== id);
    if (rest.length === 0) {
      const home = this.newTab(HOME_URL);
      this.tabs.set([home]);
      this.activeId.set('');
      void this.activate(home.id);
      return;
    }
    this.tabs.set(rest);
    if (wasActive) {
      // Sem ativa: a tela da aba fechada é destruída pelo roteador, não guardada.
      this.activeId.set('');
      void this.activate((rest[index] ?? rest[index - 1]).id);
    }
    this.scheduleSave();
  }

  setDirty(id: string, dirty: boolean): void {
    const tab = this.tabs().find((t) => t.id === id);
    if (tab && tab.dirty !== dirty) this.patch(id, { dirty });
  }

  // ---- telas guardadas (usadas pela TabRouteReuseStrategy) ----

  stashScreen(tabId: string, config: Route | null, handle: DetachedRouteHandle): void {
    this.discardScreen(tabId);
    this.stash.set(tabId, { config, handle });
  }

  hasScreen(tabId: string, config: Route | null): boolean {
    const s = this.stash.get(tabId);
    return !!s && s.config === config;
  }

  screenOf(tabId: string): DetachedRouteHandle | null {
    return this.stash.get(tabId)?.handle ?? null;
  }

  /** O roteador reanexou a tela: ela deixa de ser nossa (não destruir). */
  releaseScreen(tabId: string): void {
    this.stash.delete(tabId);
  }

  /** Destrói a tela guardada da aba (libera DOM, timers e inscrições). */
  private discardScreen(tabId: string): void {
    const s = this.stash.get(tabId);
    if (!s) return;
    this.stash.delete(tabId);
    try {
      // DetachedRouteHandle é opaco; o roteador guarda o ComponentRef nesse campo. Único ponto que depende disso.
      (s.handle as unknown as { componentRef?: { destroy(): void } }).componentRef?.destroy();
    } catch (e) {
      console.warn('Falha ao liberar a tela da aba', e);
    }
  }

  // ---- congelamento ----

  private freezeIdle(): void {
    const limit = Date.now() - FREEZE_AFTER_MS;
    for (const tab of this.tabs()) {
      if (tab.id === this.activeId() || tab.frozen || tab.dirty) continue;
      if (tab.inactiveSince !== null && tab.inactiveSince <= limit) {
        this.discardScreen(tab.id);
        this.scrolls.delete(tab.id);
        this.patch(tab.id, { frozen: true });
      }
    }
  }

  // ---- sincronismo com o Router e restauração ----

  private onNavigationEnd(url: string): void {
    if (!url.startsWith('/auth')) return;
    const meta = this.screenMeta(url);
    if (!this.firstNavigationDone) {
      this.firstNavigationDone = true;
      this.restore(url, meta);
      return;
    }
    const active = this.active();
    if (!active) return;
    const sameScreen = active.title === meta.title && active.card === meta.card;
    this.patch(active.id, {
      url, title: meta.title, icon: meta.icon, card: meta.card,
      ...(sameScreen ? {} : { dirty: false }),
    });
  }

  /** Primeira navegação da sessão logada: junta a URL atual com as abas gravadas do usuário. */
  private restore(url: string, meta: ReturnType<TabsService['screenMeta']>): void {
    const saved = this.load();
    const current = (): Tab => ({ ...this.newTab(url), title: meta.title, icon: meta.icon, card: meta.card });
    if (!saved || saved.tabs.length === 0) {
      const tab = current();
      this.tabs.set([tab]);
      this.activeId.set(tab.id);
      this.scheduleSave();
      return;
    }

    const restored: Tab[] = saved.tabs.map((t) => ({ ...t, inactiveSince: Date.now(), frozen: true, dirty: false }));
    const savedActive = restored.find((t) => t.id === saved.activeId) ?? restored[0];
    const live = (id: string, patch: Partial<Tab> = {}): void => {
      this.tabs.set(restored.map((t) => (t.id === id ? { ...t, inactiveSince: null, frozen: false, ...patch } : t)));
      this.activeId.set(id);
      this.scheduleSave();
    };

    if (savedActive.url === url) return live(savedActive.id);              // F5
    if (url === HOME_URL) {                                                  // acabou de logar: volta onde estava
      live(savedActive.id);
      void this.router.navigateByUrl(savedActive.url, { replaceUrl: true });
      return;
    }
    const same = restored.find((t) => t.url === url);                       // link direto para uma tela já aberta
    if (same) return live(same.id);
    if (restored.length < MAX_TABS) {                                        // link direto novo → aba nova
      const tab = current();
      restored.push(tab);
      return live(tab.id);
    }
    live(savedActive.id, { url, title: meta.title, icon: meta.icon, card: meta.card }); // cheio → troca a ativa
  }

  private screenMeta(url: string): { title: string; icon: string; card: string | null } {
    let snapshot: ActivatedRouteSnapshot | null = this.router.routerState.snapshot.root;
    let data: TabRouteData | undefined;
    while (snapshot) {
      if (snapshot.data?.['tab']) data = snapshot.data['tab'] as TabRouteData;
      snapshot = snapshot.firstChild;
    }
    const card = data?.card ? (new URL(url, 'http://x').searchParams.get('card')?.trim() || null) : null;
    return { title: data?.title ?? 'Tela', icon: data?.icon ?? 'tab', card };
  }

  // ---- utilitários e persistência ----

  private newTab(url: string): Tab {
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `t${Date.now()}${Math.random()}`;
    return { id, url, title: 'Início', icon: 'home', card: null, inactiveSince: null, frozen: false, dirty: false };
  }

  private patch(id: string, changes: Partial<Tab>): void {
    this.tabs.update((list) => list.map((t) => (t.id === id ? { ...t, ...changes } : t)));
    this.scheduleSave();
  }

  private load(): PersistedTabs | null {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return null;
      const data = JSON.parse(raw) as PersistedTabs;
      if (!Array.isArray(data?.tabs)) return null;
      const tabs = data.tabs
        .filter((t) => t && typeof t.id === 'string' && typeof t.url === 'string' && t.url.startsWith('/auth'))
        .slice(0, MAX_TABS);
      return { ...data, tabs };
    } catch {
      return null;
    }
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), SAVE_DEBOUNCE_MS);
  }

  private saveNow(): void {
    clearTimeout(this.saveTimer);
    if (!this.storageKey || this.tabs().length === 0) return;
    const data: PersistedTabs = {
      tabs: this.tabs().map(({ id, url, title, icon, card }) => ({ id, url, title, icon, card })),
      activeId: this.activeId(),
      savedAt: Date.now(),
    };
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch {
      // sem espaço/bloqueado: as abas só não resistem ao logout
    }
  }
}
