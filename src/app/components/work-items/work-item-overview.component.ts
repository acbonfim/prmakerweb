import { Component, DestroyRef, ViewEncapsulation, computed, effect, inject, input, output, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PlanMarkdownPipe } from '../execution-plan/plan-markdown.pipe';
import { WorkItemsService } from '../../services/work-items.service';
import { saveBlob } from '../../services/execution-plan.service';
import { CliipboardService } from '../../services/cliipboard.service';
import { renderMarkdown } from '../../helpers/markdown-ext';
import { FILE_VIEWER_DIALOG, FileViewerDialogComponent, FileViewerDialogData } from '../file-viewer/file-viewer-dialog.component';
import { WorkItem, WorkTask, taskStatusLook } from './work-item.model';
import { WorkItemFile, normalizeFileKind } from './work-item-files';
import {
  ItemBrief,
  briefMarkdown,
  docLabel,
  isEditableText,
  overviewFileName,
  titleSeverity,
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
  doc: DocView | null;
  images: number;
}

/** Documento da Visão geral: um arquivo do item ou a prévia montada da descrição (`virtual`). */
interface DocView {
  id: string;
  name: string;
  label: string;
  file: WorkItemFile | null;
  /** `overview` = visão geral montada da descrição (ainda sem arquivo); `request` = a descrição do item (pedido). */
  virtual: 'overview' | 'request' | null;
  overview: boolean;
  taskNumber: number | null;
  editable: boolean;
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
        <h4 class="wi-sec__title">{{ doc.virtual === 'overview' ? 'Visão geral (prévia)' : doc.overview && allDone() ? 'Resultado' : doc.overview ? 'Visão geral' : 'Documento' }}</h4>
        <div class="wio__doc-bar">
          @if (docs().length > 1) {
            <div class="wio__docs" role="tablist">
              @for (d of docs(); track d.id) {
                <button class="wio__doc-chip" role="tab" [class.wio__doc-chip--on]="d.id === doc.id" [attr.aria-selected]="d.id === doc.id" (click)="select(d)" [matTooltip]="d.name">
                  {{ d.label }}
                </button>
              }
            </div>
          }
          <span class="wio__doc-acts">
            <button class="wio__act" (click)="openFull(doc)" [disabled]="!text(doc)" matTooltip="Abrir em tela cheia" aria-label="Abrir em tela cheia"><mat-icon>open_in_full</mat-icon></button>
            <button class="wio__act" (click)="copy(doc)" [disabled]="!text(doc)" matTooltip="Copiar texto (markdown e formatado)" aria-label="Copiar texto">
              <mat-icon>{{ copied() === doc.id ? 'check' : 'content_copy' }}</mat-icon></button>
            <button class="wio__act" (click)="download(doc)" [disabled]="!text(doc)" [matTooltip]="'Baixar ' + doc.name" aria-label="Baixar"><mat-icon>download</mat-icon></button>
            @if (doc.editable) {
              <button class="wio__act" (click)="edit(doc)" [disabled]="!text(doc) || editing() !== null" [matTooltip]="doc.virtual ? 'Editar e salvar como arquivo do item' : 'Editar'" aria-label="Editar"><mat-icon>edit</mat-icon></button>
            }
          </span>
        </div>
        @if (doc.virtual === 'overview') {
          <p class="wi-muted wio__hint"><mat-icon>info</mat-icon><span>Montada da descrição do item — ainda não há arquivo. Edite para salvar como <b>{{ doc.name }}</b>; a análise atualiza este arquivo a cada etapa.</span></p>
        }
        @if (editing() !== null && editingId() === doc.id) {
          <div class="wio__editor">
            <div class="wio__editor-tabs">
              <button class="wio__doc-chip" [class.wio__doc-chip--on]="!preview()" (click)="preview.set(false)">Editar</button>
              <button class="wio__doc-chip" [class.wio__doc-chip--on]="preview()" (click)="preview.set(true)">Prévia</button>
              <span class="wio__editor-spacer"></span>
              <button class="wio__btn" (click)="cancelEdit()" [disabled]="saving()">Cancelar</button>
              <button class="wio__btn wio__btn--primary" (click)="save(doc)" [disabled]="saving() || !editing()?.trim()">
                @if (saving()) { <mat-icon class="wi-spin">autorenew</mat-icon> } Salvar</button>
            </div>
            @if (preview()) {
              <div class="wio__doc-body"><div class="wi-md" [innerHTML]="editing() | planMarkdown:'card'"></div></div>
            } @else {
              <textarea class="wio__textarea" [value]="editing()" (input)="editing.set($any($event.target).value)" spellcheck="true" aria-label="Texto do documento"></textarea>
            }
          </div>
        } @else {
          <div class="wio__doc-body">
            @if (text(doc); as t) {
              <div class="wi-md" [innerHTML]="t | planMarkdown:'card'"></div>
            } @else if (doc.file && failed().has(doc.file.id)) {
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
        }
      </section>
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
    .wio__doc-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
    .wio__doc-bar .wio__docs { flex: 1; min-width: 0; }
    .wio__doc-acts { display: inline-flex; gap: 2px; margin-left: auto; }
    .wio__act { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 8px; cursor: pointer;
      background: transparent; border: 1px solid transparent; color: var(--cc-text-2); }
    .wio__act:hover:not(:disabled) { color: var(--mat-sys-on-surface); border-color: var(--cc-surface-border-strong, rgba(255,255,255,.18)); }
    .wio__act:disabled { opacity: .4; cursor: default; }
    .wio__act mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .wio__hint { margin: 0; display: flex; align-items: flex-start; gap: 6px; font-size: 12px; }
    .wio__hint mat-icon { font-size: 15px; width: 15px; height: 15px; flex: none; margin-top: 1px; }
    .wio__editor { display: flex; flex-direction: column; gap: 8px; }
    .wio__editor-tabs { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .wio__editor-spacer { flex: 1; }
    .wio__textarea { width: 100%; box-sizing: border-box; min-height: 420px; resize: vertical; padding: 10px 12px; border-radius: 10px;
      font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: inherit; background: var(--surface-input, #1a1f28);
      border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); }
    .wio__textarea:focus { outline: none; border-color: color-mix(in srgb, var(--mat-sys-primary) 70%, transparent); }
    .wio__btn { display: inline-flex; align-items: center; gap: 4px; padding: 4px 14px; border-radius: 999px; font: inherit; font-size: 12.5px; cursor: pointer;
      background: transparent; color: var(--mat-sys-on-surface); border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); }
    .wio__btn--primary { background: var(--mat-sys-primary); color: var(--mat-sys-on-primary); border-color: transparent; }
    .wio__btn:disabled { opacity: .5; cursor: default; }
    .wio__btn mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .wio__p { margin: 0; display: flex; align-items: center; gap: 6px; font-size: 12.5px; }
  `]
})
export class WorkItemOverviewComponent {
  readonly item = input.required<WorkItem>();
  readonly files = input<readonly WorkItemFile[]>([]);
  readonly brief = input.required<ItemBrief>();
  readonly openTask = output<number>();
  /** Um arquivo foi gravado (edição): o modal recarrega a lista. */
  readonly saved = output<WorkItemFile>();

  private api = inject(WorkItemsService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);
  private clipboard = inject(CliipboardService);

  private readonly code = computed(() => itemCode(this.item().title));
  private readonly fileDocs = computed(() => itemDocuments(this.files(), this.item().tasks ?? []));
  private readonly images = computed(() => itemImages(this.files()));
  /** A descrição do item como markdown (a prévia da visão geral, ou o "Pedido" quando já há o arquivo). */
  private readonly briefText = computed(() => briefMarkdown(this.brief(), titleSeverity(this.item().title).title));

  /**
   * Abas do documento: a visão geral sempre primeiro (o arquivo `00-visao-geral`, ou a prévia montada da descrição até
   * ele existir), os documentos das sub-tarefas e, com o arquivo da visão geral, a descrição do item como "Pedido".
   */
  readonly docs = computed<DocView[]>(() => {
    const views: DocView[] = this.fileDocs().map((f) => ({
      id: f.id, name: f.name, label: docLabel(f.name, this.code()), file: f, virtual: null,
      overview: isOverviewDoc(f), taskNumber: f.taskNumber ?? null, editable: isEditableText(f)
    }));
    const brief = this.briefText();
    if (brief && !views.some((v) => v.overview)) {
      views.unshift({ id: 'virtual:overview', name: overviewFileName(this.item()), label: 'Visão geral', file: null,
        virtual: 'overview', overview: true, taskNumber: null, editable: true });
    } else if (brief) {
      const at = views.findIndex((v) => v.overview) + 1;
      views.splice(at, 0, { id: 'virtual:request', name: overviewFileName(this.item()).replace(/^00-visao-geral-/, 'pedido-'),
        label: 'Pedido', file: null, virtual: 'request', overview: false, taskNumber: null, editable: false });
    }
    return views;
  });
  private readonly chosen = signal<string | null>(null);
  /** Documento na tela: o escolhido (se ainda existir), a visão geral, ou o da última sub-tarefa. */
  readonly current = computed<DocView | null>(() => {
    const docs = this.docs();
    const picked = docs.find((d) => d.id === this.chosen());
    if (picked) return picked;
    const overview = docs.find((d) => d.overview);
    if (overview) return overview;
    const file = pickItemDocument(this.fileDocs());
    return docs.find((d) => !!file && d.file?.id === file.id) ?? docs[0] ?? null;
  });
  /** Prints da sub-tarefa do documento na tela (a visão geral mostra todos). */
  readonly docImages = computed(() => {
    const doc = this.current();
    if (!doc || doc.virtual === 'request') return [];
    return doc.overview || doc.taskNumber == null ? this.images() : this.images().filter((i) => i.taskNumber === doc.taskNumber);
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
        doc: docs.filter((d) => !!d.file && d.taskNumber === t.number).pop() ?? null,
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
  readonly copied = signal<string | null>(null);
  /** Edição: o texto em edição (null = fora da edição), de qual documento, e a prévia. */
  readonly editing = signal<string | null>(null);
  readonly editingId = signal<string | null>(null);
  readonly preview = signal(false);
  readonly saving = signal(false);
  private loading = new Set<string>();
  private urls: string[] = [];

  readonly text = (d: DocView): string | null => (d.file ? this.texts()[this.key(d.file)] ?? null : this.briefText());

  constructor() {
    effect(() => {
      const doc = this.current();
      if (doc?.file) this.load(doc.file);
    });
    effect(() => {
      for (const img of this.docImages()) this.thumb(img);
    });
    inject(DestroyRef).onDestroy(() => this.urls.forEach((u) => URL.revokeObjectURL(u)));
  }

  select(doc: DocView): void {
    if (this.editing() !== null && this.editingId() !== doc.id) this.cancelEdit();
    this.chosen.set(doc.id);
  }

  /** Mesmo visualizador da aba Arquivos (tela cheia, copiar formatado). */
  openFull(doc: DocView): void {
    const text = this.text(doc);
    if (!text) return;
    const data: FileViewerDialogData = {
      name: doc.name,
      contentType: 'text/markdown',
      kind: doc.file?.kind ?? 'analysis',
      subtitle: doc.virtual === 'overview' ? 'Visão geral (prévia montada da descrição)' : doc.virtual === 'request' ? 'Descrição do item' : doc.label,
      icon: 'description',
      card: this.item().cardNumber,
      load: async () => new Blob([text], { type: 'text/markdown' })
    };
    this.dialog.open(FileViewerDialogComponent, { ...FILE_VIEWER_DIALOG, data });
  }

  /** Copia o markdown (e o formatado, para colar bonito em outro sistema). */
  async copy(doc: DocView): Promise<void> {
    const text = this.text(doc);
    if (!text) return;
    try {
      await this.clipboard.copyRichToClipboard(renderMarkdown(text, { codeRefs: false }), text);
      this.copied.set(doc.id);
      setTimeout(() => { if (this.copied() === doc.id) this.copied.set(null); }, 1600);
    } catch {
      this.snack.open('Não foi possível copiar o texto.', 'Fechar', { duration: 5000 });
    }
  }

  download(doc: DocView): void {
    const text = this.text(doc);
    if (text) saveBlob(new Blob([text], { type: 'text/markdown;charset=utf-8' }), doc.name);
  }

  edit(doc: DocView): void {
    const text = this.text(doc);
    if (!doc.editable || text == null) return;
    this.editing.set(text);
    this.editingId.set(doc.id);
    this.preview.set(false);
  }

  cancelEdit(): void {
    this.editing.set(null);
    this.editingId.set(null);
    this.preview.set(false);
  }

  /** Grava como arquivo do item (mesmo nome + tipo substitui; a prévia vira o `00-visao-geral`). */
  async save(doc: DocView): Promise<void> {
    const content = this.editing();
    if (!content?.trim()) return;
    this.saving.set(true);
    try {
      const file = await firstValueFrom(this.api.addTextFile(this.item().number, {
        name: doc.name,
        kind: doc.file ? normalizeFileKind(doc.file.kind) : 'analysis',
        content,
        taskNumber: doc.file?.taskNumber ?? null
      }));
      if (file) this.texts.update((m) => ({ ...m, [this.key(file)]: content.trim() }));
      this.cancelEdit();
      if (file?.id) this.chosen.set(file.id);
      this.snack.open(`${doc.name} salvo.`, 'Ok', { duration: 3000 });
      if (file) this.saved.emit(file);
    } catch (e) {
      this.snack.open((e as Error)?.message || `Não foi possível salvar ${doc.name}.`, 'Fechar', { duration: 6000 });
    } finally {
      this.saving.set(false);
    }
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
