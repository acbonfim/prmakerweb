import { DestroyRef, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { WorkItemsService } from '../../services/work-items.service';
import { WsService } from '../../services/ws.service';
import { EXECUTION_PLAN_EVENT } from '../execution-plan/execution-plan.model';
import { WorkItemFile } from './work-item-files';
import { listenWorkItems } from './work-items-live';

/**
 * 0087: o que o `app-work-item-files` precisa de uma fonte de arquivos — o `WorkItemFilesStore` (um item) e o
 * `CardFilesStore` (o card todo) cumprem o mesmo contrato.
 */
export interface FilesSource {
  readonly files: () => WorkItemFile[];
  readonly loaded: () => boolean;
  readonly unavailable: () => boolean;
  readonly error: () => string | null;
  /** Item dono da lista (null na lista do card: cada arquivo traz o seu). */
  readonly itemNumber: number | null;
  load(): void;
  add(file: WorkItemFile | null | undefined): void;
}

/**
 * 0087: todos os arquivos do card (`GET WorkItems/card/{card}/files`) — análises, chamados, scripts, dados e anexos de
 * todos os itens e planos —, ao vivo: mudança de item/arquivo (`workItemsUpdated`) e artefato novo do plano
 * (`executionPlanUpdated` action `artifact`) recarregam sem piscar (a lista só é trocada quando a resposta chega).
 * Criar dentro de um contexto de injeção; `watch(card)` é idempotente e desliga com o dono.
 */
export class CardFilesStore implements FilesSource {
  private api = inject(WorkItemsService);
  private ws = inject(WsService);

  readonly files = signal<WorkItemFile[]>([]);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly unavailable = signal(false);
  readonly error = signal<string | null>(null);
  readonly count = computed(() => this.files().length);
  readonly itemNumber: number | null = null;

  private card: string | null = null;
  private stopLive: (() => void) | null = null;
  private sub?: Subscription;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  private readonly onPlanEvent = (p: { cardNumber?: string | number; action?: string }) => {
    if (!this.card || `${p?.cardNumber ?? ''}`.trim() !== this.card) return;
    if (p.action !== 'artifact' && p.action !== 'created') return;
    this.scheduleLoad();
  };

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  watch(card: string | null | undefined): void {
    const c = `${card ?? ''}`.trim() || null;
    if (c === this.card) return;
    this.stop();
    this.card = c;
    this.files.set([]);
    this.loaded.set(false);
    this.unavailable.set(false);
    this.error.set(null);
    if (!c) return;
    this.load();
    this.stopLive = listenWorkItems(this.ws, c, (p) => {
      if (p?.action === 'activity') return;
      this.scheduleLoad();
    }, 400);
    this.ws.on(EXECUTION_PLAN_EVENT, this.onPlanEvent);
  }

  load(): void {
    const c = this.card;
    if (!c) return;
    const s = ++this.seq;
    // Só o primeiro carregamento mostra "Carregando…"; as seguintes trocam a lista quando chega (sem piscar).
    if (!this.loaded()) this.loading.set(true);
    this.sub?.unsubscribe();
    this.sub = this.api.cardFiles(c).subscribe({
      next: (r) => {
        if (s !== this.seq) return;
        this.files.set(r.files);
        this.unavailable.set(r.unavailable);
        this.error.set(null);
        this.loading.set(false);
        this.loaded.set(true);
      },
      error: (e) => {
        if (s !== this.seq) return;
        this.loading.set(false);
        this.loaded.set(true);
        if (!this.files().length) this.error.set(e?.message || 'Não foi possível carregar os arquivos.');
      }
    });
  }

  add(file: WorkItemFile | null | undefined): void {
    if (!file?.id) return;
    this.files.update((list) => [file, ...list.filter((f) => !(f.id === file.id && (f.source ?? 'item') === (file.source ?? 'item')))]);
  }

  private scheduleLoad(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.load(); }, 500);
  }

  private stop(): void {
    this.stopLive?.();
    this.stopLive = null;
    this.ws.off(EXECUTION_PLAN_EVENT, this.onPlanEvent);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.sub?.unsubscribe();
  }
}
