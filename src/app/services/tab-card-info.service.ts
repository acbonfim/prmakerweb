import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Subscription, forkJoin } from 'rxjs';
import { DevOpsCardSummary, HomeCard, HomeCardsService } from './home-cards.service';
import { TabsService } from './tabs.service';
import { WsService } from './ws.service';

/** Mesmo grupo/evento da lista de recentes da Home: card salvo, PR aberto ou handover salvo. */
const RECENT_GROUP = 'pullrequest-recent';
const RECENT_EVENT = 'pullRequestRecentUpdated';
const DEBOUNCE_MS = 600;
/** Rede de segurança (o plano muda sem passar pelo evento acima). */
const POLL_MS = 90_000;

export interface CardTabInfo {
  card: HomeCard | null;
  devops: DevOpsCardSummary | null;
}

/**
 * Dados que dão nome e indicadores às abas de card (0065): título/estado no DevOps, plano de execução e PRs. Uma
 * chamada só para todas as abas de card abertas (inclusive congeladas, que não têm tela para carregar nada).
 */
@Injectable({ providedIn: 'root' })
export class TabCardInfoService {
  private readonly api = inject(HomeCardsService);
  private readonly tabs = inject(TabsService);
  private readonly ws = inject(WsService);

  readonly info = signal<ReadonlyMap<string, CardTabInfo>>(new Map());

  private started = false;
  private lastKey = '';
  private timer?: ReturnType<typeof setTimeout>;
  private poll?: ReturnType<typeof setInterval>;
  private loading?: Subscription;
  private resyncSub?: Subscription;

  private readonly watcher = effect(() => {
    const key = [...new Set(this.tabs.tabs().map((t) => t.card).filter((c): c is string => !!c))].sort().join(',');
    untracked(() => {
      if (!this.started || key === this.lastKey) return;
      this.lastKey = key;
      this.schedule(0);
    });
  });

  start(): void {
    if (this.started) return;
    this.started = true;
    this.lastKey = '';
    this.ws.startConnection();
    this.ws.addToGroup(RECENT_GROUP);
    this.ws.on(RECENT_EVENT, this.onRecent);
    this.resyncSub = this.ws._resynced.subscribe(() => this.schedule(0));
    this.poll = setInterval(() => { if (!document.hidden) this.load(); }, POLL_MS);
    document.addEventListener('visibilitychange', this.onVisible);
    this.schedule(0);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    clearTimeout(this.timer);
    clearInterval(this.poll);
    this.loading?.unsubscribe();
    this.resyncSub?.unsubscribe();
    document.removeEventListener('visibilitychange', this.onVisible);
    this.ws.off(RECENT_EVENT, this.onRecent);
    this.ws.removeFromGroup(RECENT_GROUP);
    this.info.set(new Map());
  }

  private onRecent = (): void => this.schedule(DEBOUNCE_MS);
  private onVisible = (): void => { if (!document.hidden) this.schedule(0); };

  private schedule(delay: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.load(), delay);
  }

  private load(): void {
    const cards = [...new Set(this.tabs.tabs().map((t) => t.card).filter((c): c is string => !!c))];
    if (!cards.length) {
      this.info.set(new Map());
      return;
    }
    const numeric = cards.filter((c) => /^\d+$/.test(c));
    this.loading?.unsubscribe();
    this.loading = forkJoin({
      cards: this.api.getByNumbers(cards),
      devops: this.api.getDevOpsSummary(numeric),
    }).subscribe(({ cards: list, devops }) => {
      const next = new Map<string, CardTabInfo>();
      for (const card of cards) {
        next.set(card, {
          card: (list ?? []).find((c) => c.cardNumber === card) ?? null,
          devops: (devops ?? []).find((d) => `${d.id}` === card) ?? null,
        });
      }
      this.info.set(next);
    });
  }
}
