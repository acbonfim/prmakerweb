import { Injectable, Signal, inject, signal } from '@angular/core';
import { WsService } from './ws.service';
import { StorageService } from './storage.service';
import { CaseChatService } from './case-chat.service';
import { CASE_CHAT_EVENT, CaseChatRealtimePayload, CaseMessage, isRunActive } from '../components/case-chat/case-chat.model';
import { executionPlanGroup } from '../components/execution-plan/execution-plan.model';

export interface CaseChatStatus {
  /** Últimas mensagens (prévia). */
  last: CaseMessage[];
  lastNumber: number;
  seenNumber: number;
  unread: number;
  working: boolean;
  activity: string | null;
  people: number;
}

const EMPTY: CaseChatStatus = { last: [], lastNumber: 0, seenNumber: 0, unread: 0, working: false, activity: null, people: 0 };
const SEEN_KEY = (card: string) => `prmake.case-seen.${card}`;

/**
 * 0080: estado resumido da conversa do caso para o botão "Especialista do caso" (mensagens novas, trabalhando) e para a
 * prévia ao vivo da coluna da direita. Uma assinatura por card; "visto" fica no navegador.
 */
@Injectable({ providedIn: 'root' })
export class CaseChatStatusService {
  private api = inject(CaseChatService);
  private ws = inject(WsService);
  private readonly me = (inject(StorageService).getAccess()?.user?.externalId ?? '').toLowerCase();
  private readonly states = new Map<string, ReturnType<typeof signal<CaseChatStatus>>>();
  private readonly watched = new Map<string, number>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private listening = false;

  status(card: string): Signal<CaseChatStatus> {
    return this.state(card).asReadonly();
  }

  /** Começa a acompanhar o card (contagem de referências: `unwatch` ao sair). */
  watch(card: string): void {
    if (!card) return;
    this.watched.set(card, (this.watched.get(card) ?? 0) + 1);
    if (this.watched.get(card) === 1) {
      this.ws.startConnection();
      this.ws.addToGroup(executionPlanGroup(card));
      if (!this.listening) {
        this.listening = true;
        this.ws.on(CASE_CHAT_EVENT, this.onRealtime);
      }
      this.reload(card);
    }
  }

  unwatch(card: string): void {
    const n = (this.watched.get(card) ?? 0) - 1;
    if (n > 0) { this.watched.set(card, n); return; }
    this.watched.delete(card);
    this.ws.removeFromGroup(executionPlanGroup(card));
  }

  markSeen(card: string, number: number): void {
    try { localStorage.setItem(SEEN_KEY(card), `${number}`); } catch { /* sem storage */ }
    const s = this.state(card);
    s.set({ ...s(), seenNumber: number, unread: 0 });
  }

  reload(card: string): void {
    this.api.get(card, 3).subscribe({
      next: (c) => {
        const lastNumber = c.messages.at(-1)?.number ?? 0;
        const seen = this.seen(card);
        // Novas = de outras pessoas ou do especialista (as minhas e os avisos do PRMake não contam).
        const fromOthers = c.messages.filter((m) => m.number > seen && m.authorKind !== 'system'
          && !(m.authorKind === 'person' && !!this.me && (m.authorUserId ?? '').toLowerCase() === this.me)).length;
        const run = c.run;
        this.state(card).set({
          last: c.messages.filter((m) => m.authorKind !== 'system').slice(-2),
          lastNumber,
          seenNumber: seen,
          // + as mais antigas que a prévia não trouxe (entre a última vista e a primeira das 3), sem saber o autor.
          unread: Math.min(fromOthers + Math.max(0, (c.messages[0]?.number ?? 1) - 1 - seen), 99),
          working: isRunActive(run),
          activity: run && isRunActive(run) ? (run.status === 'queued' ? 'na fila' : run.currentActivity?.label ?? 'pensando…') : null,
          people: c.participants.length
        });
      },
      error: () => {}
    });
  }

  private state(card: string) {
    let s = this.states.get(card);
    if (!s) {
      s = signal<CaseChatStatus>({ ...EMPTY, seenNumber: this.seen(card) });
      this.states.set(card, s);
    }
    return s;
  }

  private seen(card: string): number {
    try { return Number(localStorage.getItem(SEEN_KEY(card)) ?? 0) || 0; } catch { return 0; }
  }

  private onRealtime = (p: CaseChatRealtimePayload): void => {
    const card = p?.cardNumber != null ? `${p.cardNumber}` : null;
    if (!card || !this.watched.has(card) || p.action === 'typing') return;
    if (p.action === 'activity' && p.activity) {
      const s = this.state(card);
      s.set({ ...s(), working: true, activity: p.activity.label });
      return;
    }
    clearTimeout(this.timers.get(card));
    this.timers.set(card, setTimeout(() => this.reload(card), 300));
  };
}

