import { DestroyRef, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { WorkItemsService } from '../../services/work-items.service';
import { WsService } from '../../services/ws.service';
import { WorkItemFile, isFilesEvent } from './work-item-files';
import { listenWorkItems } from './work-items-live';

/**
 * 0085 rodada 5 (1.2): estado dos arquivos de um item — carrega `GET WorkItems/{number}/files` e recarrega ao vivo
 * (`workItemsUpdated` com action `file`, de sub-tarefa ou status do item, e a volta da conexão). Criar dentro de um
 * contexto de injeção (`new WorkItemFilesStore()` num campo do componente); `watch(number, card)` aponta o item e é
 * idempotente. Desliga sozinho com o dono (DestroyRef).
 */
export class WorkItemFilesStore {
  private api = inject(WorkItemsService);
  private ws = inject(WsService);

  readonly files = signal<WorkItemFile[]>([]);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  /** Servidor sem o endpoint (404) — aviso discreto, sem erro. */
  readonly unavailable = signal(false);
  readonly error = signal<string | null>(null);
  readonly count = computed(() => this.files().length);

  private number: number | null = null;
  private card: string | null = null;
  private stopLive: (() => void) | null = null;
  private sub?: Subscription;
  private seq = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  get itemNumber(): number | null {
    return this.number;
  }

  watch(number: number | null | undefined, card: string | null | undefined): void {
    const n = number || null;
    const c = `${card ?? ''}`.trim() || null;
    if (n === this.number && c === this.card) return;
    const sameItem = n === this.number;
    this.stop();
    this.number = n;
    this.card = c;
    if (!sameItem) {
      this.files.set([]);
      this.loaded.set(false);
      this.unavailable.set(false);
      this.error.set(null);
    }
    if (!n) return;
    if (!sameItem || !this.loaded()) this.load();
    if (c) {
      this.stopLive = listenWorkItems(this.ws, c, (p) => {
        if (this.number && isFilesEvent(p, this.number)) this.load();
      }, 400);
    }
  }

  load(): void {
    const n = this.number;
    if (!n) return;
    const s = ++this.seq;
    this.loading.set(true);
    this.sub?.unsubscribe();
    this.sub = this.api.files(n).subscribe({
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

  /** Arquivo novo (upload) entra na hora; o tempo real/recarga confirma. */
  add(file: WorkItemFile | null | undefined): void {
    if (!file?.id) return;
    this.files.update((list) => [file, ...list.filter((f) => !(f.id === file.id && (f.source ?? 'item') === (file.source ?? 'item')))]);
  }

  private stop(): void {
    this.stopLive?.();
    this.stopLive = null;
    this.sub?.unsubscribe();
  }
}
