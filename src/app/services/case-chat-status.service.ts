import { Injectable, Signal, inject } from '@angular/core';
import { CaseChatStatus, CaseChatStore } from './case-chat-store.service';

export type { CaseChatStatus } from './case-chat-store.service';

/**
 * 0080: estado resumido da conversa do caso para o botão "Especialista do caso" (mensagens novas, trabalhando).
 * 0081: virou uma vista do {@link CaseChatStore} — a mesma conversa em memória que o modal e a versão compacta usam.
 */
@Injectable({ providedIn: 'root' })
export class CaseChatStatusService {
  private store = inject(CaseChatStore);

  status(card: string): Signal<CaseChatStatus> {
    return this.store.status(card);
  }

  watch(card: string): void {
    this.store.watch(card);
  }

  unwatch(card: string): void {
    this.store.unwatch(card);
  }

  markSeen(card: string, number: number): void {
    this.store.markSeen(card, number);
  }

  reload(card: string): void {
    this.store.reload(card, 0);
  }
}
