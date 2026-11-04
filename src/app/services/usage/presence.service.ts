import { Injectable, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { WsService } from '../ws.service';
import { AWAY_AFTER_MS } from './usage-tracker.service';
import { PRESENCE_LABEL, PRESENCE_RANK, PresenceEntry, PresenceState, formatAgo, parseApiDate } from './usage.model';

const WATCHERS_PRESENCE_CHANGED = 'presenceChanged';
const WATCHERS_PRESENCE_REMOVED = 'presenceRemoved';

/** Presença de um usuário (todas as abas dele). */
export interface UserPresence {
  userId: string;
  name: string;
  /** Estado "mais ativo" entre as abas. */
  state: PresenceState;
  /** Aba que define o estado (a mais ativa; empate = a com interação mais recente). */
  primary: PresenceEntry;
  entries: PresenceEntry[];
  /** Última interação entre todas as abas. */
  lastInputAt: number | null;
}

/**
 * Quem está online agora (0079, admin). `WatchPresence` devolve a foto e inscreve no grupo de presença do hub; os
 * eventos `presenceChanged`/`presenceRemoved` mantêm a lista ao vivo. Reinscreve quando a conexão volta. Vários
 * componentes podem assistir ao mesmo tempo (contagem).
 */
@Injectable({ providedIn: 'root' })
export class PresenceService {
  private readonly ws = inject(WsService);

  readonly entries = signal<Map<string, PresenceEntry>>(new Map());
  readonly connected = signal(false);
  readonly error = signal<string | null>(null);

  /** Relógio para "há X min" (atualiza a cada 30 s enquanto alguém assiste). */
  readonly now = signal(Date.now());

  readonly users = computed<UserPresence[]>(() => {
    // Recarregar a aba abre uma conexão nova com o mesmo sessionId; a antiga pode demorar a cair no servidor.
    const bySession = new Map<string, PresenceEntry>();
    for (const e of this.entries().values()) {
      const key = e.sessionId || e.connectionId;
      const prev = bySession.get(key);
      if (!prev || (parseApiDate(e.connectedAt) ?? 0) >= (parseApiDate(prev.connectedAt) ?? 0)) bySession.set(key, e);
    }
    const byUser = new Map<string, PresenceEntry[]>();
    for (const e of bySession.values()) {
      const id = (e.userId ?? e.connectionId).toLowerCase();
      const list = byUser.get(id) ?? [];
      list.push(e);
      byUser.set(id, list);
    }
    const out: UserPresence[] = [];
    for (const [userId, entries] of byUser) {
      const sorted = [...entries].sort((a, b) =>
        (PRESENCE_RANK[b.state ?? 'away'] - PRESENCE_RANK[a.state ?? 'away']) ||
        ((parseApiDate(b.lastInputAt) ?? 0) - (parseApiDate(a.lastInputAt) ?? 0)));
      const primary = sorted[0];
      const lastInputAt = Math.max(...entries.map((e) => parseApiDate(e.lastInputAt) ?? 0)) || null;
      out.push({
        userId,
        name: primary.fullName || primary.userName || 'Usuário',
        state: primary.state ?? 'active',
        primary,
        entries: sorted,
        lastInputAt,
      });
    }
    return out.sort((a, b) => (PRESENCE_RANK[b.state] - PRESENCE_RANK[a.state]) || a.name.localeCompare(b.name));
  });

  readonly byUserId = computed(() => new Map(this.users().map((u) => [u.userId, u])));

  private watchers = 0;
  private reconnectSub?: Subscription;
  private clock?: ReturnType<typeof setInterval>;
  private retry?: ReturnType<typeof setTimeout>;

  watch(): () => void {
    this.watchers++;
    if (this.watchers === 1) this.begin();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.watchers--;
      if (this.watchers === 0) this.end();
    };
  }

  for(externalId: string | null | undefined): UserPresence | null {
    if (!externalId) return null;
    return this.byUserId().get(`${externalId}`.toLowerCase()) ?? null;
  }

  /** "Ativo · Pull Request (card 123)", "Executando: IA (processando)", "Ausente há 12 min". */
  describe(p: UserPresence | null): string {
    if (!p) return PRESENCE_LABEL.offline;
    const e = p.primary;
    const where = e.screen ? `${e.screen}${e.card ? ` (card ${e.card})` : ''}` : '';
    const idle = p.lastInputAt ? this.now() - p.lastInputAt : 0;
    switch (p.state) {
      case 'busy': {
        const awayNote = idle >= AWAY_AFTER_MS ? ` · sem interação ${formatAgo(new Date(p.lastInputAt!).toISOString(), this.now())}` : '';
        return `Executando: ${e.busy ?? 'processando'}${awayNote}`;
      }
      case 'away':
        return `Ausente ${p.lastInputAt ? formatAgo(new Date(p.lastInputAt).toISOString(), this.now()) : ''}${where ? ` · ${where}` : ''}`.trim();
      case 'background':
        return `Em segundo plano${where ? ` · ${where}` : ''}`;
      default:
        return `Ativo${where ? ` · ${where}` : ''}`;
    }
  }

  private begin(): void {
    this.ws.startConnection();
    this.ws.on(WATCHERS_PRESENCE_CHANGED, this.onChanged);
    this.ws.on(WATCHERS_PRESENCE_REMOVED, this.onRemoved);
    this.reconnectSub = this.ws._reconnected.subscribe(() => this.subscribe());
    this.clock = setInterval(() => this.now.set(Date.now()), 30_000);
    this.subscribe();
  }

  private end(): void {
    this.ws.off(WATCHERS_PRESENCE_CHANGED, this.onChanged);
    this.ws.off(WATCHERS_PRESENCE_REMOVED, this.onRemoved);
    this.reconnectSub?.unsubscribe();
    clearInterval(this.clock);
    clearTimeout(this.retry);
    if (this.ws.isConnected()) this.ws.invoke('UnwatchPresence').catch(() => undefined);
    this.connected.set(false);
    this.entries.set(new Map());
  }

  private subscribe(): void {
    clearTimeout(this.retry);
    if (!this.watchers) return;
    if (!this.ws.isConnected()) {
      // A conexão ainda está abrindo: `_reconnected` chama de novo; o timer cobre a corrida.
      this.retry = setTimeout(() => this.subscribe(), 3000);
      return;
    }
    this.ws.invoke<PresenceEntry[]>('WatchPresence')
      .then((list) => {
        const map = new Map<string, PresenceEntry>();
        for (const e of list ?? []) map.set(e.connectionId, e);
        this.entries.set(map);
        this.connected.set(true);
        this.error.set(null);
        this.now.set(Date.now());
      })
      .catch((err) => {
        this.connected.set(false);
        this.error.set(err?.message?.includes('admin') ? 'Presença disponível só para administradores.' : 'Presença indisponível no momento.');
        this.retry = setTimeout(() => this.subscribe(), 30_000);
      });
  }

  private readonly onChanged = (entry: PresenceEntry) => {
    if (!entry?.connectionId) return;
    this.entries.update((m) => new Map(m).set(entry.connectionId, entry));
  };

  private readonly onRemoved = (payload: { connectionId: string }) => {
    if (!payload?.connectionId) return;
    this.entries.update((m) => {
      if (!m.has(payload.connectionId)) return m;
      const next = new Map(m);
      next.delete(payload.connectionId);
      return next;
    });
  };
}
