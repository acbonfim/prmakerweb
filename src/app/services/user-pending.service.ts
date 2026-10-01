import { Injectable, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { ExecutionPlanService } from './execution-plan.service';
import { StorageService } from './storage.service';
import { WsService } from './ws.service';
import {
  EXECUTION_PENDING_EVENT,
  EXECUTION_PENDING_GROUP,
  ExecutionUserPending
} from '../components/execution-plan/execution-plan.model';

/** Consulta de segurança (tempo real fora, aba voltando do segundo plano). */
const POLL_MS = 60_000;
/** Rajadas de eventos (a skill manda várias mudanças seguidas) viram uma consulta só. */
const DEBOUNCE_MS = 1_500;

/**
 * Pendências do usuário nos planos de execução (0037), fora do card: sino do topo, selo na lista de recentes, contador
 * no título da aba e no ícone do app instalado. Singleton iniciado pelo topo (área logada).
 */
@Injectable({ providedIn: 'root' })
export class UserPendingService {
  private api = inject(ExecutionPlanService);
  private ws = inject(WsService);
  private storage = inject(StorageService);

  readonly items = signal<ExecutionUserPending[]>([]);
  readonly total = computed(() => this.items().reduce((sum, i) => sum + i.count, 0));
  /** Pendências por card (selo da lista de recentes). */
  readonly byCard = computed(() => new Map(this.items().map((i) => [`${i.cardNumber}`, i])));

  private started = false;
  private userId: string | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private poll?: ReturnType<typeof setInterval>;
  private resyncSub?: Subscription;
  private baseTitle = document.title || 'PRMake';

  start(): void {
    if (this.started) return;
    this.userId = this.storage.getAccess()?.user?.externalId ?? null;
    if (!this.userId) return;
    this.started = true;
    this.baseTitle = document.title.replace(/^\(\d+\)\s*/, '') || 'PRMake';
    this.ws.startConnection();
    this.ws.addToGroup(EXECUTION_PENDING_GROUP);
    this.ws.on(EXECUTION_PENDING_EVENT, this.onChanged);
    this.resyncSub = this.ws._resynced.subscribe(() => this.schedule(0));
    this.poll = setInterval(() => { if (!document.hidden) this.refresh(); }, POLL_MS);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.refresh();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    clearTimeout(this.timer);
    clearInterval(this.poll);
    this.ws.off(EXECUTION_PENDING_EVENT, this.onChanged);
    this.ws.removeFromGroup(EXECUTION_PENDING_GROUP);
    this.resyncSub?.unsubscribe();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.items.set([]);
    this.applyBadge(0);
  }

  /** Recarrega já (ex.: o usuário concluiu uma etapa no painel). */
  refresh(): void {
    if (!this.started) return;
    this.api.pending().subscribe({
      next: (list) => {
        this.items.set(list ?? []);
        this.applyBadge(this.total());
      },
      error: () => {}
    });
  }

  /** O evento é global: só interessa se o plano é do usuário logado. */
  private onChanged = (payload?: { userId?: string | null }): void => {
    if (payload?.userId && this.userId && payload.userId.toLowerCase() !== this.userId.toLowerCase()) return;
    this.schedule(DEBOUNCE_MS);
  };

  private onVisibility = (): void => {
    if (!document.hidden) this.schedule(0);
  };

  private schedule(delay: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), delay);
  }

  /** "(2) PRMake" na aba e o número no ícone do app instalado (quando o navegador suporta). */
  private applyBadge(count: number): void {
    const current = document.title.replace(/^\(\d+\)\s*/, '');
    if (current) this.baseTitle = current;
    document.title = count > 0 ? `(${count}) ${this.baseTitle}` : this.baseTitle;
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    try {
      if (count > 0) nav.setAppBadge?.(count)?.catch(() => {});
      else nav.clearAppBadge?.()?.catch(() => {});
    } catch {
      // sem suporte: só o título
    }
  }
}
