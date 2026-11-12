import { Component, DestroyRef, ViewEncapsulation, computed, effect, inject, input, output, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PlanMarkdownPipe } from '../execution-plan/plan-markdown.pipe';
import { WorkItemsService } from '../../services/work-items.service';
import { WorkItem, WorkTask, taskStatusLook } from './work-item.model';
import { WorkItemFile } from './work-item-files';
import {
  ItemBrief,
  docLabel,
  isOverviewDoc,
  itemCode,
  itemDocuments,
  itemImages,
  pickItemDocument,
  resultHeadline,
  stepTitle
} from './item-overview';

interface StepView {
  task: WorkTask;
  title: string;
  headline: string | null;
  look: ReturnType<typeof taskStatusLook>;
  done: boolean;
  doc: WorkItemFile | null;
  images: number;
}

/**
 * Card 78161: Visão geral rica do item de trabalho (todos menos o de análise, que tem a dele) — o mesmo visual da
 * análise inicial: para que serve em destaque, as etapas com a manchete de cada resultado, o documento do item na tela
 * (troca entre os documentos das sub-tarefas, prints da reprodução) e a ficha do pedido (resumo em callout, seções,
 * selos, links de código e da Base Solvace). Fica dentro do `appCodeRefHost` do modal (popovers e imagens `anexo:`).
 */
@Component({
  selector: 'app-work-item-overview',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule, PlanMarkdownPipe],
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (brief().purpose; as purpose) {
      <section class="wio__hero" aria-label="Para que serve">
        <mat-icon class="wio__hero-ico">flag</mat-icon>
        <div class="wio__hero-main">
          <h4 class="wi-sec__title">Para que serve</h4>
          <div class="wi-md wio__purpose" [innerHTML]="purpose | planMarkdown:'card'"></div>
        </div>
      </section>
    }

    @if (steps().length) {
      <section class="wi-sec" aria-label="Etapas">
        <h4 class="wi-sec__title">{{ allDone() ? 'O que foi entregue' : 'Etapas' }}
          <small class="wi-muted">{{ doneCount() }}/{{ steps().length }}</small></h4>
        <ol class="wio__steps">
          @for (s of steps(); track s.task.number; let i = $index) {
            <li class="wio__step" [class.wio__step--done]="s.done" [class.wio__step--on]="s.doc && s.doc.id === current()?.id">
              <mat-icon class="wio__step-ico" [style.color]="s.look.color" [class.wi-spin]="s.look.spin" [matTooltip]="s.look.label">{{ s.done ? 'check_circle' : s.look.icon }}</mat-icon>
              <button class="wio__step-main" (click)="openTask.emit(s.task.number)" [matTooltip]="'Abrir a sub-tarefa ' + s.task.title">
                <b>{{ i + 1 }}. {{ s.title }}</b>
                @if (s.headline) { <span class="wi-md wio__step-res" [innerHTML]="s.headline | planMarkdown:'card'"></span> }
              </button>
              @if (s.doc) {
                <button class="wio__step-doc" (click)="select(s.doc)" [matTooltip]="'Ver ' + s.doc.name + ' aqui'" [attr.aria-label]="'Ver ' + s.doc.name">
                  <mat-icon>description</mat-icon>@if (s.images) { <mat-icon>image</mat-icon> }
                </button>
              }
              <span class="wio__step-st" [style.color]="s.done ? null : s.look.color">{{ s.done ? 'Entregue' : s.look.label }}</span>
            </li>
          }
        </ol>
      </section>
    }

    @if (current(); as doc) {
      <section class="wi-sec wio__doc" aria-label="Documento do item">
        <h4 class="wi-sec__title">{{ isOverview(doc) ? 'Resultado' : 'Documento' }}</h4>
        @if (docs().length > 1) {
          <div class="wio__docs" role="tablist">
            @for (d of docs(); track d.id) {
              <button class="wio__doc-chip" role="tab" [class.wio__doc-chip--on]="d.id === doc.id" [attr.aria-selected]="d.id === doc.id" (click)="select(d)" [matTooltip]="d.name">
                {{ label(d) }}
              </button>
            }
          </div>
        }
        <div class="wio__doc-body">
          @if (text(doc); as t) {
            <div class="wi-md" [innerHTML]="t | planMarkdown:'card'"></div>
          } @else if (failed().has(doc.id)) {
            <p class="wi-muted wio__p"><mat-icon>error_outline</mat-icon>Não foi possível carregar {{ doc.name }} — abra pela aba Arquivos.</p>
          } @else {
            <p class="wi-muted wio__p"><mat-icon class="wi-spin">autorenew</mat-icon>Carregando {{ doc.name }}…</p>
          }
          @if (docImages().length) {
            <div class="wio__shots" aria-label="Prints">
              @for (img of docImages(); track img.id) {
                <button class="wio__shot" (click)="zoom(img)" [matTooltip]="img.name">
                  @if (thumbs()[img.id]; as url) { <img [src]="url" [alt]="img.name"> }
                  @else { <mat-icon class="wi-spin">autorenew</mat-icon> }
                  <span class="wio__shot-name">{{ img.name }}</span>
                </button>
              }
            </div>
          }
        </div>
      </section>
    }

    @if (brief().body; as body) {
      @if (current()) {
        <details class="wi-sec wio__brief">
          <summary class="wi-sec__title">{{ brief().legacy ? 'O achado (pedido original)' : 'Descrição do item' }}</summary>
          <div class="wi-md wio__brief-body" [innerHTML]="body | planMarkdown:'card'"></div>
        </details>
      } @else {
        <section class="wi-sec">
          <h4 class="wi-sec__title">{{ brief().legacy ? 'O achado' : 'Descrição' }}</h4>
          <div class="wi-md wio__brief-body" [innerHTML]="body | planMarkdown:'card'"></div>
        </section>
      }
    }
  `,
  host: { class: 'wio' },
  styles: [`
    .wio { display: flex; flex-direction: column; gap: 14px; }
    .wio__hero { display: flex; gap: 10px; padding: 10px 12px; border-radius: 10px;
      background: color-mix(in srgb, var(--mat-sys-primary) 9%, transparent); border: 1px solid color-mix(in srgb, var(--mat-sys-primary) 28%, transparent); }
    .wio__hero-ico { color: var(--mat-sys-primary); font-size: 20px; width: 20px; height: 20px; flex: none; margin-top: 1px; }
    .wio__hero-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .wio__purpose { font-size: 13.5px; }
    .wio__steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .wio__step { display: flex; align-items: flex-start; gap: 10px; padding: 8px 10px; border-radius: 8px;
      border: 1px solid var(--cc-surface-border, rgba(255,255,255,.08)); font-size: 12.5px; line-height: 1.4; }
    .wio__step--on { border-color: color-mix(in srgb, var(--mat-sys-primary) 55%, transparent); }
    .wio__step-ico { font-size: 18px; width: 18px; height: 18px; flex: none; }
    .wio__step--done .wio__step-ico { color: #3fb950 !important; }
    .wio__step-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; background: none; border: 0; padding: 0;
      color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .wio__step-main:hover b { text-decoration: underline; }
    .wio__step-res { color: var(--cc-text-2); font-size: 12.5px; }
    .wio__step-res p { display: inline; margin: 0; }
    .wio__step-doc { flex: none; display: inline-flex; gap: 2px; background: none; border: 1px solid transparent; border-radius: 6px; padding: 2px 4px;
      color: var(--mat-sys-primary); cursor: pointer; }
    .wio__step-doc:hover { border-color: color-mix(in srgb, var(--mat-sys-primary) 50%, transparent); }
    .wio__step-doc mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .wio__step-st { flex: none; font-size: 11px; color: var(--cc-text-3); white-space: nowrap; }
    .wio__step--done .wio__step-st { color: #3fb950; }
    .wio__docs { display: flex; flex-wrap: wrap; gap: 6px; }
    .wio__doc-chip { padding: 2px 10px; border-radius: 999px; font: inherit; font-size: 11.5px; line-height: 20px; cursor: pointer; background: transparent;
      color: var(--cc-text-2); border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); }
    .wio__doc-chip:hover { color: var(--mat-sys-on-surface); }
    .wio__doc-chip--on { color: var(--mat-sys-on-surface); border-color: var(--mat-sys-primary); background: color-mix(in srgb, var(--mat-sys-primary) 14%, transparent); }
    .wio__doc-body { padding: 12px 14px; border-radius: 10px; background: var(--surface-input, #1a1f28);
      border: 1px solid var(--cc-surface-border, rgba(255,255,255,.08)); overflow-x: auto; display: flex; flex-direction: column; gap: 10px; }
    .wio__shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
    .wio__shot { display: flex; flex-direction: column; gap: 4px; padding: 4px; border-radius: 8px; cursor: zoom-in; background: transparent;
      border: 1px solid var(--cc-surface-border, rgba(255,255,255,.08)); color: inherit; font: inherit; min-width: 0; }
    .wio__shot:hover { border-color: var(--mat-sys-primary); }
    .wio__shot img { width: 100%; height: 96px; object-fit: cover; object-position: top; border-radius: 5px; }
    .wio__shot mat-icon { margin: 38px auto; }
    .wio__shot-name { font-size: 11px; color: var(--cc-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wio__brief > summary { cursor: pointer; width: fit-content; }
    .wio__brief[open] > summary { margin-bottom: 6px; }
    .wio__brief-body { padding: 12px 14px; border-radius: 10px; background: var(--surface-input, #1a1f28);
      border: 1px solid var(--cc-surface-border, rgba(255,255,255,.08)); }
    .wio__p { margin: 0; display: flex; align-items: center; gap: 6px; font-size: 12.5px; }
  `]
})
export class WorkItemOverviewComponent {
  readonly item = input.required<WorkItem>();
  readonly files = input<readonly WorkItemFile[]>([]);
  readonly brief = input.required<ItemBrief>();
  readonly openTask = output<number>();

  private api = inject(WorkItemsService);
  private dialog = inject(MatDialog);

  private readonly code = computed(() => itemCode(this.item().title));
  readonly docs = computed(() => itemDocuments(this.files(), this.item().tasks ?? []));
  private readonly images = computed(() => itemImages(this.files()));
  private readonly chosen = signal<string | null>(null);
  /** Documento na tela: o escolhido (se ainda existir) ou o padrão (visão geral / o da última sub-tarefa). */
  readonly current = computed(() => {
    const docs = this.docs();
    return docs.find((d) => d.id === this.chosen()) ?? pickItemDocument(docs);
  });
  /** Prints da sub-tarefa do documento na tela (a visão geral mostra todos). */
  readonly docImages = computed(() => {
    const doc = this.current();
    if (!doc) return [];
    return isOverviewDoc(doc) || doc.taskNumber == null ? this.images() : this.images().filter((i) => i.taskNumber === doc.taskNumber);
  });

  readonly steps = computed<StepView[]>(() => {
    const docs = this.docs();
    const imgs = this.images();
    return (this.item().tasks ?? []).slice().sort((a, b) => a.order - b.order).map((t) => {
      const look = taskStatusLook(t.status);
      return {
        task: t,
        title: stepTitle(t.title, this.code()),
        headline: t.status === 'pending' ? null : resultHeadline(t.result),
        look,
        done: t.status === 'completed',
        doc: docs.filter((d) => d.taskNumber === t.number).pop() ?? null,
        images: imgs.filter((i) => i.taskNumber === t.number).length
      };
    });
  });
  readonly doneCount = computed(() => this.steps().filter((s) => s.done || s.task.status === 'skipped').length);
  /** "O que foi entregue" só quando tudo acabou e algo foi de fato entregue (só pulada não é entrega). */
  readonly allDone = computed(() => this.steps().some((s) => s.done) && this.doneCount() === this.steps().length);

  private readonly texts = signal<Record<string, string>>({});
  readonly failed = signal<Set<string>>(new Set());
  readonly thumbs = signal<Record<string, string>>({});
  private loading = new Set<string>();
  private urls: string[] = [];

  readonly isOverview = isOverviewDoc;
  readonly label = (d: WorkItemFile) => docLabel(d.name, this.code());
  readonly text = (d: WorkItemFile) => this.texts()[this.key(d)] ?? null;

  constructor() {
    effect(() => {
      const doc = this.current();
      if (doc) this.load(doc);
    });
    effect(() => {
      for (const img of this.docImages()) this.thumb(img);
    });
    inject(DestroyRef).onDestroy(() => this.urls.forEach((u) => URL.revokeObjectURL(u)));
  }

  select(doc: WorkItemFile): void {
    this.chosen.set(doc.id);
  }

  zoom(img: WorkItemFile): void {
    const url = this.thumbs()[img.id];
    if (!url) return;
    import('../code-ref/md-image-viewer.component').then(({ MdImageViewerComponent }) =>
      this.dialog.open(MdImageViewerComponent, {
        data: { url, name: img.name, alt: img.description ?? null },
        width: '96vw', maxWidth: '96vw', height: '92vh', panelClass: 'md-image-dialog'
      }));
  }

  private key(d: WorkItemFile): string {
    return `${d.id}|${d.updatedAt ?? d.createdAt ?? ''}`;
  }

  private load(doc: WorkItemFile): void {
    const key = this.key(doc);
    if (this.texts()[key] != null || this.loading.has(key)) return;
    this.loading.add(key);
    this.api.fileContent(this.item().number, doc).subscribe({
      next: (blob) => blob.text().then((t) => {
        this.loading.delete(key);
        this.texts.update((m) => ({ ...m, [key]: t.trim() || '*(vazio)*' }));
      }),
      error: () => {
        this.loading.delete(key);
        this.failed.update((s) => new Set(s).add(doc.id));
      }
    });
  }

  private thumb(img: WorkItemFile): void {
    if (this.thumbs()[img.id] || this.loading.has(img.id)) return;
    this.loading.add(img.id);
    this.api.fileContent(this.item().number, img).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        this.urls.push(url);
        this.thumbs.update((m) => ({ ...m, [img.id]: url }));
      },
      error: () => this.loading.delete(img.id)
    });
  }
}
