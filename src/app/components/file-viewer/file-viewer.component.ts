import { Component, ElementRef, OnDestroy, ViewChild, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PlanMarkdownPipe } from '../execution-plan/plan-markdown.pipe';
import { CodeRefHostDirective } from '../code-ref/code-ref-host.directive';

export type FileViewKind = 'code' | 'markdown' | 'json' | 'text' | 'image' | 'none';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const CODE_EXT = /\.(sql|sh|bash|py|ps1|cs|js|ts|xml|ya?ml|html?|css)$/i;
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

/** Como mostrar o arquivo: imagem, markdown renderizado, JSON formatado, código com destaque, texto ou só baixar. */
export function fileViewKind(name: string, contentType: string | null | undefined, size: number, kind?: string | null): FileViewKind {
  const type = `${contentType ?? ''}`.toLowerCase();
  if (kind === 'image' || type.startsWith('image/') || IMAGE_EXT.test(name)) return 'image';
  const isText = type.startsWith('text/') || type.includes('json') || type.includes('xml') || type.includes('markdown') ||
    CODE_EXT.test(name) || TEXT_EXT.test(name) || /\.(md|markdown|json)$/i.test(name) ||
    // Sem extensão: chamado/análise/texto gerados são markdown.
    (!/\.[a-z0-9]{1,6}$/i.test(name) && (kind === 'ticket' || kind === 'analysis' || kind === 'text'));
  if (!isText || size > MAX_TEXT_PREVIEW) return 'none';
  if (/\.(md|markdown)$/i.test(name) || type.includes('markdown')) return 'markdown';
  if (/\.json$/i.test(name) || type.includes('json')) return 'json';
  if (CODE_EXT.test(name)) return 'code';
  if (!/\.[a-z0-9]{1,6}$/i.test(name) && (kind === 'ticket' || kind === 'analysis' || kind === 'text')) return 'markdown';
  return 'text';
}

interface Shown {
  kind: FileViewKind;
  text?: string;
  imageUrl?: string;
}

/**
 * Prévia de um arquivo (feature 0023, compartilhada desde a correção da aba Arquivos): SQL/código com números de linha e
 * destaque, markdown renderizado (ou o fonte), JSON formatado, imagem com zoom e tela cheia. Recebe o conteúdo pronto
 * (`blob`) — quem usa busca, cuida de carregando/erro e projeta as próprias ações (copiar, baixar) em `[viewerActions]`.
 */
@Component({
  selector: 'app-file-viewer',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, PlanMarkdownPipe, CodeRefHostDirective],
  template: `
    @if (shown(); as p) {
      @if (bar() || p.kind === 'markdown' || p.kind === 'image' || actions()) {
        <div class="fv__bar">
          @if (bar()) {
            <span class="fv__bar-name" [title]="name()">{{ name() }}</span>
            @if (description()) { <span class="fv__bar-desc">{{ description() }}</span> }
          }
          <span class="fv__spacer"></span>
          @if (p.kind === 'markdown') {
            <button mat-button (click)="showSource.set(!showSource())">
              <mat-icon>{{ showSource() ? 'visibility' : 'code' }}</mat-icon>{{ showSource() ? 'Renderizado' : 'Fonte' }}
            </button>
          }
          @if (p.kind === 'image') {
            <button mat-icon-button (click)="zoomOut()" matTooltip="Diminuir" aria-label="Diminuir"><mat-icon>zoom_out</mat-icon></button>
            <button mat-button class="fv__zoom" (click)="toggleFit()" [matTooltip]="fit() ? 'Tamanho real' : 'Ajustar à tela'">
              {{ fit() ? 'Ajustar' : (zoom() * 100).toFixed(0) + '%' }}
            </button>
            <button mat-icon-button (click)="zoomIn()" matTooltip="Aumentar" aria-label="Aumentar"><mat-icon>zoom_in</mat-icon></button>
            <button mat-icon-button (click)="fullscreen()" matTooltip="Tela cheia" aria-label="Ver em tela cheia"><mat-icon>fullscreen</mat-icon></button>
          }
          <ng-content select="[viewerActions]" />
        </div>
      }

      <div class="fv__content" #content>
        @switch (p.kind) {
          @case ('image') {
            <div class="fv__image" [class.fv__image--fit]="fit()">
              <img [src]="p.imageUrl" [alt]="name()" [style.width]="fit() ? null : (naturalWidth() * zoom()) + 'px'"
                   (load)="onImageLoad($event)" (click)="toggleFit()" />
            </div>
          }
          @case ('markdown') {
            @if (showSource()) {
              <pre class="fv__code">@for (line of lines(); track $index) {<span class="fv__line">{{ line }}</span>}</pre>
            } @else {
              <div class="fv__md" [appCodeRefHost]="card()" [innerHTML]="p.text | planMarkdown:'card'"></div>
            }
          }
          @case ('code') {
            <pre class="fv__code">@for (line of highlighted(); track $index) {<span class="fv__line" [innerHTML]="line"></span>}</pre>
          }
          @case ('none') {
            <div class="fv__state">
              <mat-icon>insert_drive_file</mat-icon>
              Pré-visualização indisponível para este tipo de arquivo{{ contentType() ? ' (' + contentType() + ')' : '' }}.
            </div>
          }
          @default {
            <pre class="fv__code">@for (line of lines(); track $index) {<span class="fv__line">{{ line }}</span>}</pre>
          }
        }
      </div>
    }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; color: var(--mat-sys-on-surface); }
    .fv__bar { flex: none; display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-bottom: 1px solid rgba(255,255,255,.06); flex-wrap: wrap; }
    .fv__bar-name { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40%; }
    .fv__bar-desc { font-size: 12px; color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 0 1 auto; }
    .fv__spacer { flex: 1 1 auto; }
    .fv__zoom.mat-mdc-button { min-width: 64px; font-variant-numeric: tabular-nums; }
    .fv__content { flex: 1 1 auto; min-height: 0; overflow: auto; }
    .fv__content:fullscreen { background: #111; display: flex; align-items: center; justify-content: center; }
    .fv__content:fullscreen img { max-width: 100vw; max-height: 100vh; object-fit: contain; }
    .fv__code { margin: 0; padding: 12px 0; font-family: 'JetBrains Mono', 'Courier New', monospace; font-size: 12.5px; line-height: 1.55;
      counter-reset: line; white-space: pre; tab-size: 4; color: var(--mat-sys-on-surface); }
    .fv__line { display: block; padding: 0 16px 0 0; counter-increment: line; }
    .fv__line::before { content: counter(line); display: inline-block; width: 44px; margin-right: 14px; padding-right: 8px; text-align: right;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 30%, transparent); border-right: 1px solid rgba(255,255,255,.06); user-select: none; }
    .fv__line:hover { background: rgba(255,255,255,.03); }
    .fv__code ::ng-deep .k { color: #ff7b72; font-weight: 600; }
    .fv__code ::ng-deep .s { color: #a5d6ff; }
    .fv__code ::ng-deep .c { color: #8b949e; font-style: italic; }
    .fv__code ::ng-deep .n { color: #79c0ff; }
    .fv__md { padding: 16px 22px; font-size: 14px; line-height: 1.6; max-width: 900px; overflow-wrap: anywhere; }
    .fv__md ::ng-deep pre { padding: 8px 10px; border-radius: 6px; background: rgba(0,0,0,.3); overflow-x: auto; }
    .fv__md ::ng-deep code { color: inherit; font-family: 'Courier New', monospace; font-size: 12.5px; }
    .fv__md ::ng-deep a { color: var(--mat-sys-primary); }
    .fv__md ::ng-deep img { max-width: 100%; height: auto; }
    .fv__md ::ng-deep table { border-collapse: collapse; margin: 0 0 10px; }
    .fv__md ::ng-deep th, .fv__md ::ng-deep td { padding: 4px 8px; border: 1px solid rgba(255,255,255,.12); }
    .fv__image { min-height: 100%; display: flex; align-items: flex-start; justify-content: center; padding: 12px; box-sizing: border-box;
      background: repeating-conic-gradient(rgba(255,255,255,.04) 0% 25%, transparent 0% 50%) 50% / 20px 20px; }
    .fv__image img { display: block; cursor: zoom-in; image-rendering: auto; }
    .fv__image--fit { height: 100%; align-items: center; }
    .fv__image--fit img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .fv__state { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 24px;
      text-align: center; font-size: 13px; color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent); }
  `]
})
export class FileViewerComponent implements OnDestroy {
  readonly name = input.required<string>();
  readonly contentType = input<string | null | undefined>(null);
  /** Kind do arquivo (`image`, `ticket`, `analysis`…) — ajuda quando o nome não tem extensão. */
  readonly kind = input<string | null | undefined>(null);
  readonly description = input<string | null | undefined>(null);
  readonly blob = input<Blob | null>(null);
  /** Card dos links da engenharia reversa / código no markdown. */
  readonly card = input<string | null | undefined>(null);
  /** Mostra nome e descrição na barra (o diálogo do plano mostra; quem já tem cabeçalho próprio, não). */
  readonly bar = input(false);
  /** Quem usa projeta ações (`[viewerActions]`): a barra aparece mesmo para código/texto. */
  readonly actions = input(false);

  private snackBar = inject(MatSnackBar);

  readonly shown = signal<Shown | null>(null);
  readonly showSource = signal(false);
  readonly fit = signal(true);
  readonly zoom = signal(1);
  readonly naturalWidth = signal(0);

  readonly lines = computed(() => (this.shown()?.text ?? '').replace(/\r\n/g, '\n').split('\n'));
  readonly highlighted = computed(() => {
    const isSql = /\.sql$/i.test(this.name());
    return this.lines().map((l) => (isSql ? highlightSql(l) : escapeHtml(l)));
  });

  @ViewChild('content') private contentRef?: ElementRef<HTMLElement>;
  private objectUrl?: string;
  private seq = 0;

  constructor() {
    effect(() => {
      const blob = this.blob();
      const name = this.name();
      const type = this.contentType();
      const kind = this.kind();
      untracked(() => void this.build(blob, name, type, kind));
    });
  }

  private async build(blob: Blob | null, name: string, contentType: string | null | undefined, kind: string | null | undefined): Promise<void> {
    const s = ++this.seq;
    this.showSource.set(false);
    this.fit.set(true);
    this.zoom.set(1);
    if (!blob) { this.revoke(); this.shown.set(null); return; }
    const view = fileViewKind(name, contentType || blob.type, blob.size, kind);
    if (view === 'image') {
      this.revoke();
      // SVG vira <img> (não executa scripts).
      this.objectUrl = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: contentType ?? '' }));
      this.shown.set({ kind: 'image', imageUrl: this.objectUrl });
      return;
    }
    if (view === 'none') { this.revoke(); this.shown.set({ kind: 'none' }); return; }
    let text = await blob.text();
    if (s !== this.seq) return;
    if (view === 'json') {
      try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* mostra como veio */ }
    }
    this.revoke();
    this.shown.set({ kind: view, text });
  }

  onImageLoad(event: Event): void {
    this.naturalWidth.set((event.target as HTMLImageElement).naturalWidth || 0);
  }

  toggleFit(): void {
    if (this.fit()) { this.fit.set(false); this.zoom.set(1); } else { this.fit.set(true); }
  }
  zoomIn(): void { this.fit.set(false); this.zoom.update((z) => Math.min(8, +(z * 1.25).toFixed(2))); }
  zoomOut(): void { this.fit.set(false); this.zoom.update((z) => Math.max(0.1, +(z / 1.25).toFixed(2))); }

  /** Tela cheia dentro do app (no PWA uma nova aba com blob sai do app); Esc volta. */
  fullscreen(): void {
    const el = this.contentRef?.nativeElement;
    if (el?.requestFullscreen) {
      el.requestFullscreen().catch(() => this.snackBar.open('Não foi possível abrir em tela cheia.', 'Fechar', { duration: 4000 }));
    }
  }

  private revoke(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = undefined;
  }

  ngOnDestroy(): void {
    this.seq++;
    this.revoke();
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Destaque simples de SQL por linha: comentários, strings, números e palavras-chave. */
export function highlightSql(line: string): string {
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
