import { Component, OnDestroy, Signal, computed, effect, inject, signal, untracked } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription } from 'rxjs';
import {
  ExecutionPlanService,
  fileNameFromResponse,
  saveBlob
} from '../../services/execution-plan.service';
import { CliipboardService } from '../../services/cliipboard.service';
import { PlanMarkdownPipe } from './plan-markdown.pipe';
import { ARTIFACT_GROUPS, ArtifactGroup, ExecutionArtifact } from './execution-plan.model';

export interface PlanFilesDialogData {
  planId: string;
  cardNumber: string;
  /** Lista viva: arquivos novos da skill aparecem com o dialog aberto. */
  artifacts: Signal<ExecutionArtifact[]>;
  groupId?: ArtifactGroup['id'];
  artifactId?: string;
  stepTitle: (key: string) => string | null;
}

type PreviewKind = 'code' | 'markdown' | 'json' | 'text' | 'image' | 'none';

interface Preview {
  artifact: ExecutionArtifact;
  kind: PreviewKind;
  text?: string;
  html?: string;
  imageUrl?: string;
  blob: Blob;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const CODE_EXT = /\.(sql|sh|bash|py|ps1|cs|js|ts|xml|ya?ml)$/i;
const TEXT_EXT = /\.(txt|log|csv|tsv)$/i;
const MAX_TEXT_PREVIEW = 2 * 1024 * 1024;

/** Palavras-chave destacadas nos .sql. */
const SQL_KEYWORDS = new Set((
  'select from where and or not in is null as join inner left right outer full cross on group by order having ' +
  'insert into values update set delete merge using when matched then else end case begin commit rollback tran ' +
  'transaction declare exec execute create alter drop table view index procedure function trigger top distinct ' +
  'union all exists like between with nolock go if while return print cast convert coalesce isnull count sum avg ' +
  'min max over partition asc desc output inserted deleted primary key foreign references default constraint'
).split(' '));

/**
 * Visualizador dos arquivos do plano (feature 0023): lista por tipo à esquerda, prévia à direita —
 * SQL/código com números de linha e destaque, markdown renderizado (ou o fonte), JSON formatado,
 * imagem com zoom. Copiar, baixar (nome original, ex.: .sql), abrir a imagem em nova aba e baixar
 * tudo (.zip). O conteúdo vem pelo HttpClient (x-api-key) como blob.
 */
@Component({
  selector: 'app-plan-files-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule, PlanMarkdownPipe],
  template: `
    <div class="pf">
      <div class="pf__header">
        <mat-icon class="pf__lead">folder_open</mat-icon>
        <span class="pf__title">Arquivos do plano · #{{ data.cardNumber }}</span>
        <span class="pf__spacer"></span>
        <button mat-stroked-button (click)="downloadZip()" [disabled]="!all().length || zipping()">
          <mat-icon>{{ zipping() ? 'progress_activity' : 'folder_zip' }}</mat-icon> Baixar tudo (.zip)
        </button>
        <button mat-icon-button mat-dialog-close matTooltip="Fechar (Esc)" aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </div>

      <div class="pf__tabs" role="tablist">
        @for (g of groups; track g.id) {
          <button class="pf__tab" role="tab" [class.pf__tab--on]="groupId() === g.id" [attr.aria-selected]="groupId() === g.id"
                  (click)="selectGroup(g.id)">
            <mat-icon>{{ g.icon }}</mat-icon>{{ g.label }}<span class="pf__count">{{ countOf(g) }}</span>
          </button>
        }
      </div>

      <div class="pf__body">
        <div class="pf__list">
          @for (a of list(); track a.id) {
            <button class="pf__item" [class.pf__item--on]="selectedId() === a.id" (click)="select(a)">
              <mat-icon class="pf__item-icon">{{ iconOf(a) }}</mat-icon>
              <span class="pf__item-text">
                <span class="pf__item-name">{{ a.name }}</span>
                <span class="pf__item-meta">
                  {{ size(a.size) }} · {{ time(a.updatedAt || a.createdAt) }}
                  @if (a.stepKey && data.stepTitle(a.stepKey); as st) { · {{ st }} }
                </span>
              </span>
            </button>
          } @empty {
            <div class="pf__empty">Nenhum arquivo deste tipo ainda.</div>
          }
        </div>

        <div class="pf__preview">
          @if (loading()) {
            <div class="pf__state"><mat-icon class="pf__spin">progress_activity</mat-icon> Carregando…</div>
          } @else if (error()) {
            <div class="pf__state pf__state--error"><mat-icon>error_outline</mat-icon> {{ error() }}</div>
          } @else if (preview(); as p) {
            <div class="pf__bar">
              <span class="pf__bar-name" [title]="p.artifact.name">{{ p.artifact.name }}</span>
              @if (p.artifact.description) { <span class="pf__bar-desc">{{ p.artifact.description }}</span> }
              <span class="pf__spacer"></span>
              @if (p.kind === 'markdown') {
                <button mat-button (click)="showSource.set(!showSource())">
                  <mat-icon>{{ showSource() ? 'visibility' : 'code' }}</mat-icon>{{ showSource() ? 'Renderizado' : 'Fonte' }}
                </button>
              }
              @if (p.kind === 'image') {
                <button mat-icon-button (click)="zoomOut()" matTooltip="Diminuir" aria-label="Diminuir"><mat-icon>zoom_out</mat-icon></button>
                <button mat-button class="pf__zoom" (click)="toggleFit()" [matTooltip]="fit() ? 'Tamanho real' : 'Ajustar à tela'">
                  {{ fit() ? 'Ajustar' : (zoom() * 100).toFixed(0) + '%' }}
                </button>
                <button mat-icon-button (click)="zoomIn()" matTooltip="Aumentar" aria-label="Aumentar"><mat-icon>zoom_in</mat-icon></button>
                <button mat-icon-button (click)="openImage()" matTooltip="Abrir em nova aba" aria-label="Abrir em nova aba"><mat-icon>open_in_new</mat-icon></button>
              }
              @if (p.text !== undefined || p.kind === 'image') {
                <button mat-icon-button (click)="copy()" [matTooltip]="p.kind === 'image' ? 'Copiar imagem' : 'Copiar conteúdo'" aria-label="Copiar">
                  <mat-icon>content_copy</mat-icon>
                </button>
              }
              <button mat-flat-button color="primary" (click)="download()"><mat-icon>download</mat-icon> Baixar</button>
            </div>

            <div class="pf__content">
              @switch (p.kind) {
                @case ('image') {
                  <div class="pf__image" [class.pf__image--fit]="fit()">
                    <img [src]="p.imageUrl" [alt]="p.artifact.name" [style.width]="fit() ? null : (naturalWidth() * zoom()) + 'px'"
                         (load)="onImageLoad($event)" (click)="toggleFit()" />
                  </div>
                }
                @case ('markdown') {
                  @if (showSource()) {
                    <pre class="pf__code">@for (line of lines(); track $index) {<span class="pf__line">{{ line }}</span>}</pre>
                  } @else {
                    <div class="pf__md" [innerHTML]="p.text | planMarkdown"></div>
                  }
                }
                @case ('code') {
                  <pre class="pf__code">@for (line of highlighted(); track $index) {<span class="pf__line" [innerHTML]="line"></span>}</pre>
                }
                @case ('none') {
                  <div class="pf__state">
                    <mat-icon>insert_drive_file</mat-icon>
                    Pré-visualização indisponível para este tipo de arquivo ({{ p.artifact.contentType }}).
                    <button mat-stroked-button (click)="download()"><mat-icon>download</mat-icon> Baixar</button>
                  </div>
                }
                @default {
                  <pre class="pf__code">@for (line of lines(); track $index) {<span class="pf__line">{{ line }}</span>}</pre>
                }
              }
            </div>
          } @else {
            <div class="pf__state"><mat-icon>touch_app</mat-icon> Escolha um arquivo.</div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .pf { display: flex; flex-direction: column; height: 100%; color: var(--mat-sys-on-surface); }
    .pf__header { display: flex; align-items: center; gap: 8px; padding: 10px 10px 10px 18px; background: var(--surface-2, #323232);
      border-bottom: 1px solid rgba(255,255,255,.06); }
    .pf__lead { color: var(--mat-sys-primary); }
    .pf__title { font-weight: 600; font-size: 15px; }
    .pf__spacer { flex: 1 1 auto; }
    .pf__tabs { display: flex; gap: 4px; padding: 8px 12px 0; border-bottom: 1px solid rgba(255,255,255,.06); overflow-x: auto; }
    .pf__tab { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; border: none; background: transparent;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 65%, transparent); font: inherit; font-size: 13px; cursor: pointer;
      border-bottom: 2px solid transparent; white-space: nowrap; }
    .pf__tab .mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .pf__tab--on { color: var(--mat-sys-primary); border-bottom-color: var(--mat-sys-primary); }
    .pf__count { min-width: 18px; padding: 0 5px; border-radius: 9px; font-size: 11px; font-weight: 700; text-align: center;
      background: rgba(255,255,255,.08); }
    .pf__body { flex: 1 1 auto; min-height: 0; display: flex; }
    .pf__list { flex: 0 0 min(300px, 38%); overflow-y: auto; padding: 8px; border-right: 1px solid rgba(255,255,255,.06); }
    .pf__item { width: 100%; display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border: none; border-radius: 8px;
      background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .pf__item:hover { background: rgba(255,255,255,.04); }
    .pf__item--on { background: color-mix(in srgb, var(--mat-sys-primary) 14%, transparent); }
    .pf__item-icon { flex: none; font-size: 18px; width: 18px; height: 18px; margin-top: 1px; color: var(--mat-sys-primary); }
    .pf__item-text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .pf__item-name { font-size: 13px; font-weight: 500; word-break: break-all; }
    .pf__item-meta { font-size: 11px; color: color-mix(in srgb, var(--mat-sys-on-surface) 50%, transparent); }
    .pf__empty { padding: 16px; font-size: 13px; color: color-mix(in srgb, var(--mat-sys-on-surface) 50%, transparent); }
    .pf__preview { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
    .pf__bar { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,.06); flex-wrap: wrap; }
    .pf__bar-name { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40%; }
    .pf__bar-desc { font-size: 12px; color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 0 1 auto; }
    .pf__zoom.mat-mdc-button { min-width: 64px; font-variant-numeric: tabular-nums; }
    .pf__content { flex: 1 1 auto; min-height: 0; overflow: auto; }
    .pf__code { margin: 0; padding: 12px 0; font-family: 'JetBrains Mono', 'Courier New', monospace; font-size: 12.5px; line-height: 1.55;
      counter-reset: line; white-space: pre; tab-size: 4; }
    .pf__line { display: block; padding: 0 16px 0 0; counter-increment: line; }
    .pf__line::before { content: counter(line); display: inline-block; width: 44px; margin-right: 14px; padding-right: 8px; text-align: right;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 30%, transparent); border-right: 1px solid rgba(255,255,255,.06); user-select: none; }
    .pf__line:hover { background: rgba(255,255,255,.03); }
    .pf__code ::ng-deep .k { color: #ff7b72; font-weight: 600; }
    .pf__code ::ng-deep .s { color: #a5d6ff; }
    .pf__code ::ng-deep .c { color: #8b949e; font-style: italic; }
    .pf__code ::ng-deep .n { color: #79c0ff; }
    .pf__md { padding: 16px 22px; font-size: 14px; line-height: 1.6; max-width: 900px; }
    .pf__md ::ng-deep pre { padding: 8px 10px; border-radius: 6px; background: rgba(0,0,0,.3); overflow-x: auto; }
    .pf__md ::ng-deep code { color: inherit; font-family: 'Courier New', monospace; font-size: 12.5px; }
    .pf__code { color: var(--mat-sys-on-surface); }
    .pf__md ::ng-deep table { border-collapse: collapse; }
    .pf__md ::ng-deep th, .pf__md ::ng-deep td { border: 1px solid rgba(255,255,255,.12); padding: 4px 8px; }
    .pf__md ::ng-deep a { color: var(--mat-sys-primary); }
    .pf__image { min-height: 100%; display: flex; align-items: flex-start; justify-content: center; padding: 12px;
      background: repeating-conic-gradient(rgba(255,255,255,.04) 0% 25%, transparent 0% 50%) 50% / 20px 20px; }
    .pf__image img { display: block; cursor: zoom-in; image-rendering: auto; }
    .pf__image--fit { height: 100%; box-sizing: border-box; align-items: center; }
    .pf__image--fit img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .pf__state { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 24px;
      text-align: center; font-size: 13px; color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent); }
    .pf__state--error { color: var(--mat-sys-error, #f2b8b5); }
    .pf__spin { animation: pf-spin .9s linear infinite; }
    @keyframes pf-spin { to { transform: rotate(360deg); } }
    @media (max-width: 720px) {
      .pf__body { flex-direction: column; }
      .pf__list { flex: 0 0 auto; max-height: 34%; border-right: none; border-bottom: 1px solid rgba(255,255,255,.06); }
    }
  `]
})
export class PlanFilesDialogComponent implements OnDestroy {
  readonly data = inject<PlanFilesDialogData>(MAT_DIALOG_DATA);
  private api = inject(ExecutionPlanService);
  private snackBar = inject(MatSnackBar);
  private clipboard = inject(CliipboardService);

  readonly groups = ARTIFACT_GROUPS;
  readonly all = this.data.artifacts;
  readonly groupId = signal<ArtifactGroup['id']>(this.data.groupId ?? this.firstGroupWithFiles());
  readonly selectedId = signal<string | null>(this.data.artifactId ?? null);
  readonly preview = signal<Preview | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly showSource = signal(false);
  readonly fit = signal(true);
  readonly zoom = signal(1);
  readonly naturalWidth = signal(0);
  readonly zipping = signal(false);

  readonly list = computed(() => {
    const group = ARTIFACT_GROUPS.find((g) => g.id === this.groupId())!;
    return this.all().filter((a) => group.kinds.includes(a.kind)).sort((a, b) => a.name.localeCompare(b.name));
  });

  readonly lines = computed(() => (this.preview()?.text ?? '').replace(/\r\n/g, '\n').split('\n'));
  readonly highlighted = computed(() => {
    const p = this.preview();
    const isSql = !!p && /\.sql$/i.test(p.artifact.name);
    return this.lines().map((l) => (isSql ? highlightSql(l) : escapeHtml(l)));
  });

  private sub?: Subscription;
  private objectUrl?: string;

  constructor() {
    // Seleção inicial e arquivo atualizado pela skill (sha mudou) → recarrega a prévia.
    effect(() => {
      const list = this.list();
      const id = this.selectedId();
      const current = untracked(() => this.preview());
      const target = list.find((a) => a.id === id) ?? (id ? null : list[0] ?? null);
      if (!target) return;
      if (!current || current.artifact.id !== target.id || current.artifact.sha256 !== target.sha256) {
        untracked(() => this.loadPreview(target));
      }
    });
  }

  countOf(g: ArtifactGroup): number {
    return this.all().filter((a) => g.kinds.includes(a.kind)).length;
  }

  selectGroup(id: ArtifactGroup['id']): void {
    this.groupId.set(id);
    this.selectedId.set(null);
    this.preview.set(null);
  }

  select(a: ExecutionArtifact): void {
    this.selectedId.set(a.id);
  }

  private loadPreview(a: ExecutionArtifact): void {
    this.selectedId.set(a.id);
    this.loading.set(true);
    this.error.set(null);
    this.showSource.set(false);
    this.fit.set(true);
    this.zoom.set(1);
    this.sub?.unsubscribe();
    this.sub = this.api.content(this.data.planId, a.id).subscribe({
      next: async (blob) => {
        const preview = await this.buildPreview(a, blob);
        if (this.selectedId() !== a.id) return;
        this.preview.set(preview);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Não foi possível carregar o arquivo.');
      }
    });
  }

  private async buildPreview(a: ExecutionArtifact, blob: Blob): Promise<Preview> {
    this.revoke();
    const type = (a.contentType || blob.type || '').toLowerCase();
    if (a.kind === 'image' || type.startsWith('image/') || IMAGE_EXT.test(a.name)) {
      // SVG vira <img> (não executa scripts).
      this.objectUrl = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: a.contentType }));
      return { artifact: a, kind: 'image', imageUrl: this.objectUrl, blob };
    }
    const isText = type.startsWith('text/') || type.includes('json') || type.includes('xml') ||
      CODE_EXT.test(a.name) || TEXT_EXT.test(a.name) || /\.(md|json)$/i.test(a.name);
    if (!isText || blob.size > MAX_TEXT_PREVIEW) return { artifact: a, kind: 'none', blob };

    let text = await blob.text();
    if (/\.md$/i.test(a.name) || type.includes('markdown')) return { artifact: a, kind: 'markdown', text, blob };
    if (/\.json$/i.test(a.name) || type.includes('json')) {
      try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* mostra como veio */ }
      return { artifact: a, kind: 'json', text, blob };
    }
    return { artifact: a, kind: CODE_EXT.test(a.name) ? 'code' : 'text', text, blob };
  }

  onImageLoad(event: Event): void {
    this.naturalWidth.set((event.target as HTMLImageElement).naturalWidth || 0);
  }

  toggleFit(): void {
    if (this.fit()) { this.fit.set(false); this.zoom.set(1); } else { this.fit.set(true); }
  }
  zoomIn(): void { this.fit.set(false); this.zoom.update((z) => Math.min(8, +(z * 1.25).toFixed(2))); }
  zoomOut(): void { this.fit.set(false); this.zoom.update((z) => Math.max(0.1, +(z / 1.25).toFixed(2))); }

  openImage(): void {
    const url = this.preview()?.imageUrl;
    if (url) window.open(url, '_blank', 'noopener');
  }

  async copy(): Promise<void> {
    const p = this.preview();
    if (!p) return;
    if (p.kind === 'image') {
      try {
        // A área de transferência aceita PNG; outros formatos são convertidos pelo navegador quando possível.
        await navigator.clipboard.write([new ClipboardItem({ [p.blob.type || 'image/png']: p.blob })]);
        this.snackBar.open('Imagem copiada', 'Ok', { duration: 3000 });
      } catch {
        this.snackBar.open('O navegador não permitiu copiar esta imagem — use Baixar.', 'Ok', { duration: 5000 });
      }
      return;
    }
    this.clipboard.copyFullDescriptionToClipboard(p.text ?? '');
  }

  download(): void {
    const p = this.preview();
    if (p) saveBlob(p.blob, p.artifact.name);
  }

  downloadZip(): void {
    this.zipping.set(true);
    this.api.zip(this.data.planId).subscribe({
      next: (res) => {
        this.zipping.set(false);
        if (res.body) saveBlob(res.body, fileNameFromResponse(res, `card-${this.data.cardNumber}.zip`));
      },
      error: () => {
        this.zipping.set(false);
        this.snackBar.open('Não foi possível baixar os arquivos.', 'Fechar', { duration: 6000 });
      }
    });
  }

  iconOf(a: ExecutionArtifact): string {
    return { script: 'code', analysis: 'description', data: 'dataset', image: 'image', attachment: 'attach_file' }[a.kind] ?? 'insert_drive_file';
  }

  size(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  time(value: string): string {
    const d = new Date(value);
    const p = (n: number) => String(n).padStart(2, '0');
    return isNaN(d.getTime()) ? '' : `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  private firstGroupWithFiles(): ArtifactGroup['id'] {
    const all = this.data.artifacts();
    return ARTIFACT_GROUPS.find((g) => all.some((a) => g.kinds.includes(a.kind)))?.id ?? 'scripts';
  }

  private revoke(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = undefined;
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.revoke();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Destaque simples de SQL por linha: comentários, strings, números e palavras-chave. */
function highlightSql(line: string): string {
  const out: string[] = [];
  const re = /(--.*$)|('(?:[^']|'')*'?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|([^A-Za-z0-9_'-]+|-)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m[1] !== undefined) out.push(`<span class="c">${escapeHtml(m[1])}</span>`);
    else if (m[2] !== undefined) out.push(`<span class="s">${escapeHtml(m[2])}</span>`);
    else if (m[3] !== undefined) out.push(`<span class="n">${m[3]}</span>`);
    else if (m[4] !== undefined) out.push(SQL_KEYWORDS.has(m[4].toLowerCase()) ? `<span class="k">${m[4]}</span>` : escapeHtml(m[4]));
    else out.push(escapeHtml(m[0]));
    if (m[0] === '') re.lastIndex++;
  }
  return out.join('');
}
