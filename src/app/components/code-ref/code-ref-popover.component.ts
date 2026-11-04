import {
  Component, ElementRef, ViewEncapsulation, afterNextRender, computed, effect, inject, input, output, signal, untracked,
  viewChild,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CliipboardService } from '../../services/cliipboard.service';
import { highlightLines } from '../../helpers/code-highlight';
import { renderMarkdown } from '../../helpers/markdown-ext';
import { DiffLine, diffStats, parsePatch } from '../../helpers/unified-diff';
import { CodeRefService } from './code-ref.service';
import {
  CodeRef, CodeRefAnnotation, CodeRefTarget, changeMeta, citationText, linesLabel, noteMarker,
} from './code-ref.model';

export type CodeRefTab = 'proposal' | 'current' | 'done';
export type CodeRefMode = 'popover' | 'sheet' | 'dialog';

export interface CodeRefDialogData {
  card: string;
  target: CodeRefTarget;
  tab?: CodeRefTab | null;
}

interface Row {
  type: 'plain' | DiffLine['type'];
  old?: number;
  new?: number;
  html: string;
  focus: boolean;
  /** Índices das anotações que cobrem a linha. */
  notes: number[];
  /** Marcadores ①② das anotações que começam nesta linha. */
  marks: string;
}

interface NoteView {
  index: number;
  marker: string;
  side: 'old' | 'new';
  lines: string;
  html: string;
  /** A nota tem linha na aba aberta (senão aparece apagada, com a dica da aba). */
  visible: boolean;
}

const TAB_LABEL: Record<CodeRefTab, string> = { proposal: 'Proposta', current: 'Código atual', done: 'Feito' };

/**
 * Popover da fotografia de código (0075/F2): cabeçalho (selo da mudança, título, repositório/caminho,
 * linhas, commit), "Por quê", abas Proposta (diff) / Código atual (foco destacado) / Feito, anotações
 * numeradas na calha com destaque cruzado nota ↔ linhas. O mesmo componente vira diálogo grande
 * ("expandir") e folha inferior no celular. Aberto pela `appCodeRefHost` (overlay CDK) — sem estado
 * global: a ref vem do `CodeRefService` (cache por card).
 */
@Component({
  selector: 'app-code-ref-popover',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'cr',
    '[class.cr--popover]': "modeV() === 'popover'",
    '[class.cr--sheet]': "modeV() === 'sheet'",
    '[class.cr--dialog]': "modeV() === 'dialog'",
    role: 'dialog',
    tabindex: '-1',
    '[attr.aria-label]': 'ariaLabel()',
    '(keydown)': 'onKeydown($event)',
  },
  template: `
    <header class="cr__head">
      @if (ref(); as r) {
        <span class="cr__badge cr__badge--{{ r.change }}" [title]="meta().label">
          <span aria-hidden="true">{{ meta().icon }}</span> {{ meta().label }}
        </span>
      } @else {
        <span class="cr__badge cr__badge--none"><span aria-hidden="true">📄</span> Código</span>
      }
      <div class="cr__titles">
        @if (ref()?.title; as t) { <span class="cr__title">{{ t }}</span> }
        <span class="cr__where">
          @if (ref()?.repository; as repo) { <span class="cr__repo">{{ repo }}</span><span class="cr__slash">/</span> }
          <span class="cr__path" [title]="pathV()">{{ pathV() }}</span>
          @if (linesV(); as l) { <span class="cr__lines">L{{ l }}</span> }
          @if (ref()?.commitSha; as sha) {
            <button type="button" class="cr__sha" (click)="copy(sha)" [matTooltip]="'Copiar o commit da fotografia' + (ref()?.branch ? ' (' + ref()?.branch + ')' : '')">
              <mat-icon>commit</mat-icon>{{ sha.slice(0, 7) }}
            </button>
          }
        </span>
      </div>
      <span class="cr__actions">
        @if (citationV()) {
          <button mat-icon-button type="button" (click)="copy(citationV())" matTooltip="Copiar caminho:linhas" aria-label="Copiar caminho e linhas">
            <mat-icon>content_copy</mat-icon>
          </button>
        }
        @if (modeV() !== 'dialog' && status() === 'ready') {
          <button mat-icon-button type="button" (click)="expand.emit(tab())" matTooltip="Expandir" aria-label="Expandir em tela grande">
            <mat-icon>open_in_full</mat-icon>
          </button>
        }
        <button mat-icon-button type="button" (click)="close()" matTooltip="Fechar (Esc)" aria-label="Fechar">
          <mat-icon>close</mat-icon>
        </button>
      </span>
    </header>

    @switch (status()) {
      @case ('loading') {
        <div class="cr__state" role="status"><mat-icon class="cr__spin">progress_activity</mat-icon> Carregando a fotografia do código…</div>
      }
      @case ('error') {
        <div class="cr__state cr__state--error" role="alert">
          <mat-icon>error_outline</mat-icon> Não foi possível carregar a fotografia.
          <button mat-stroked-button type="button" (click)="reload()">Tentar de novo</button>
        </div>
      }
      @case ('missing') {
        <div class="cr__state cr__missing">
          <mat-icon>image_not_supported</mat-icon>
          @if (targetV()?.kind === 'ref') {
            <span>A referência <code>{{ refIdV() }}</code> não existe (ou foi removida) neste card.</span>
          } @else {
            <code class="cr__cite">{{ citationV() }}</code>
            <span>Este trecho ainda não tem fotografia no card.</span>
            <button mat-stroked-button type="button" (click)="copy(citationV())"><mat-icon>content_copy</mat-icon> Copiar caminho</button>
          }
        </div>
      }
      @case ('ready') {
        @if (whyHtml(); as why) {
          <div class="cr__why"><span class="cr__why-label">Por quê</span><div class="cr__why-text" [innerHTML]="why"></div></div>
        }
        @if (tabs().length > 1 || tabs()[0] !== 'current') {
          <div class="cr__tabs" role="tablist" aria-label="Visões do código">
            @for (t of tabs(); track t) {
              <button type="button" role="tab" class="cr__tab" [class.cr__tab--on]="tab() === t" [attr.aria-selected]="tab() === t"
                      [attr.tabindex]="tab() === t ? 0 : -1" (click)="selectTab(t)" (keydown)="onTabKey($event)">
                {{ tabLabel[t] }}
                @if (t !== 'current' && statsOf(t); as s) {
                  <span class="cr__stat cr__stat--add">+{{ s.additions }}</span><span class="cr__stat cr__stat--del">−{{ s.deletions }}</span>
                }
              </button>
            }
          </div>
        }
        <div class="cr__bodywrap">
          <div class="cr__body">
            <div class="cr__code" #code role="tabpanel" [attr.aria-label]="tabLabel[tab()]" tabindex="0">
              @if (rows().length) {
                <div class="cr__rows" [class.cr__rows--two]="twoCols()">
                  @for (row of rows(); track $index) {
                    <div class="cr-row cr-row--{{ row.type }}" [class.is-focus]="row.focus" [class.is-noted]="row.notes.length > 0"
                         [class.is-active]="activeNote() !== null && row.notes.includes(activeNote()!)"
                         (mouseenter)="hoverRow(row)" (mouseleave)="hoverRow(null)">
                      <span class="cr-row__gutter">
                        <span class="cr-row__mark">{{ row.marks }}</span>
                        @if (row.type === 'info') {
                          <span class="cr-row__num cr-row__num--info">⋯</span>
                          @if (twoCols()) { <span class="cr-row__num cr-row__num--info"></span> }
                        } @else {
                          <span class="cr-row__num">{{ row.old ?? '' }}</span>
                          @if (twoCols()) { <span class="cr-row__num">{{ row.new ?? '' }}</span> }
                        }
                        <span class="cr-row__sign">{{ row.type === 'addition' ? '+' : row.type === 'deletion' ? '−' : '' }}</span>
                      </span>
                      <span class="cr-row__code" [innerHTML]="row.html"></span>
                    </div>
                  }
                </div>
              } @else {
                <div class="cr__state">Sem código nesta visão.</div>
              }
            </div>
            @if (notes().length) {
              <ol class="cr__notes" aria-label="Anotações">
                @for (n of notes(); track n.index) {
                  <li class="cr-note" [class.is-active]="activeNote() === n.index" [class.is-off]="!n.visible" tabindex="0"
                      (mouseenter)="activeNote.set(n.index)" (mouseleave)="activeNote.set(null)"
                      (focus)="activeNote.set(n.index)" (blur)="activeNote.set(null)"
                      (click)="goToNote(n)" (keydown.enter)="goToNote(n)">
                    <span class="cr-note__mark" aria-hidden="true">{{ n.marker }}</span>
                    <div class="cr-note__main">
                      <span class="cr-note__where">{{ n.side === 'new' ? 'proposto' : 'atual' }} · L{{ n.lines }}
                        @if (!n.visible) { · <em>veja em {{ n.side === 'new' ? 'Proposta' : 'Código atual' }}</em> }
                      </span>
                      <div class="cr-note__text" [innerHTML]="n.html"></div>
                    </div>
                  </li>
                }
              </ol>
            }
          </div>
        </div>
      }
    }
  `,
  styles: [`
    .cr { display: flex; flex-direction: column; min-height: 0; color: var(--mat-sys-on-surface, #e6edf3);
      background: #161b22; border: 1px solid #30363d; border-radius: 12px; box-shadow: 0 16px 48px rgba(0,0,0,.55);
      font: var(--mat-sys-body-medium); font-size: 13px; outline: none; overflow: hidden; }
    .cr.cr--popover { width: min(760px, calc(100vw - 24px)); max-height: min(70vh, 720px); animation: cr-in .12s ease-out; }
    .cr.cr--sheet { width: 100vw; max-height: 82vh; border-radius: 14px 14px 0 0; border-bottom: none; animation: cr-up .18s ease-out; }
    .cr.cr--dialog { width: 100%; height: 100%; border: none; border-radius: 0; box-shadow: none; }
    @keyframes cr-in { from { opacity: 0; transform: scale(.97); } to { opacity: 1; transform: none; } }
    @keyframes cr-up { from { transform: translateY(24px); opacity: .6; } to { transform: none; opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .cr.cr--popover, .cr.cr--sheet { animation: none; } }

    .cr__head { flex: none; display: flex; align-items: flex-start; gap: 10px; padding: 10px 6px 8px 12px; border-bottom: 1px solid #30363d; background: #1c2128; }
    .cr__badge { flex: none; margin-top: 2px; padding: 2px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 600; white-space: nowrap;
      --cr-badge: #8b949e; color: var(--cr-badge); background: color-mix(in srgb, var(--cr-badge) 16%, transparent);
      border: 1px solid color-mix(in srgb, var(--cr-badge) 40%, transparent); }
    .cr__badge--change { --cr-badge: #d29922; }
    .cr__badge--create { --cr-badge: #3fb950; }
    .cr__badge--remove { --cr-badge: #f85149; }
    .cr__badge--suspect { --cr-badge: #db6d28; }
    .cr__badge--read { --cr-badge: #58a6ff; }
    .cr__titles { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .cr__title { font-weight: 600; font-size: 13.5px; line-height: 1.3; }
    .cr__where { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; color: #8b949e; min-width: 0; }
    .cr__repo { color: #c9d1d9; }
    .cr__slash { margin: 0 -4px; }
    .cr__path { color: #79c0ff; overflow-wrap: anywhere; }
    .cr__lines { color: #e3b341; }
    .cr__sha { display: inline-flex; align-items: center; gap: 2px; padding: 0 5px; border: 1px solid #30363d; border-radius: 6px; background: transparent;
      color: #8b949e; font: inherit; cursor: pointer; }
    .cr__sha:hover, .cr__sha:focus-visible { color: #c9d1d9; border-color: #8b949e; }
    .cr__sha .mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .cr__actions { flex: none; display: flex; align-items: center; margin-top: -4px; }
    .cr__actions .mat-mdc-icon-button { --mat-icon-button-state-layer-size: 32px; width: 32px; height: 32px; padding: 4px; }
    .cr__actions .mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .cr__state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 26px 16px; text-align: center; color: #8b949e; }
    .cr__state--error { color: #f2b8b5; }
    .cr__missing code, .cr__cite { padding: 3px 8px; border-radius: 6px; background: #0d1117; border: 1px solid #30363d; color: #79c0ff;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; overflow-wrap: anywhere; }
    .cr__spin { animation: cr-spin .9s linear infinite; }
    @keyframes cr-spin { to { transform: rotate(360deg); } }

    .cr__why { flex: none; margin: 10px 12px 2px; padding: 8px 12px; border-left: 3px solid #d29922; border-radius: 0 8px 8px 0;
      background: color-mix(in srgb, #d29922 9%, transparent); line-height: 1.5; max-height: 30%; overflow: auto; }
    .cr__why-label { display: block; font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: #e3b341; margin-bottom: 2px; }
    .cr__why-text p { margin: 0 0 4px; }
    .cr__why-text p:last-child { margin-bottom: 0; }
    .cr__why-text code, .cr-note__text code { padding: 0 4px; border-radius: 4px; background: rgba(110,118,129,.25); font-size: .92em; }

    .cr__tabs { flex: none; display: flex; gap: 2px; padding: 6px 10px 0; border-bottom: 1px solid #30363d; overflow-x: auto; }
    .cr__tab { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border: none; border-bottom: 2px solid transparent; background: transparent;
      color: #8b949e; font: inherit; font-size: 12.5px; cursor: pointer; white-space: nowrap; }
    .cr__tab:hover { color: #c9d1d9; }
    .cr__tab--on { color: #e6edf3; border-bottom-color: #f78166; font-weight: 600; }
    .cr__tab:focus-visible { outline: 2px solid #58a6ff; outline-offset: -2px; border-radius: 4px; }
    .cr__stat { font-size: 11px; font-weight: 600; }
    .cr__stat--add { color: #3fb950; }
    .cr__stat--del { color: #f85149; margin-left: -3px; }

    .cr__bodywrap { flex: 1 1 auto; min-height: 0; display: flex; container-type: inline-size; }
    .cr__body { flex: 1 1 auto; min-height: 0; min-width: 0; display: flex; flex-direction: column; }
    .cr__code { position: relative; flex: 1 1 auto; min-height: 90px; overflow: auto; background: #0d1117; outline: none; overscroll-behavior: contain; }
    .cr__code:focus-visible { box-shadow: inset 0 0 0 2px #58a6ff; }
    .cr__rows { display: inline-block; min-width: 100%; padding: 4px 0; font-family: ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo, Consolas, monospace;
      font-size: 12px; line-height: 19px; tab-size: 4; }
    .cr-row { display: flex; min-width: 100%; }
    .cr-row__gutter { position: sticky; left: 0; z-index: 1; flex: none; display: flex; background: #0d1117; user-select: none; }
    .cr-row__mark { width: 22px; text-align: center; color: #e3b341; font-size: 12px; }
    .cr-row__num { width: 44px; padding-right: 8px; text-align: right; color: #6e7681; font-variant-numeric: tabular-nums; }
    .cr__rows--two .cr-row__num { width: 40px; }
    .cr-row__num--info { color: #6e7681; }
    .cr-row__sign { width: 16px; text-align: center; border-right: 1px solid #21262d; }
    .cr-row__code { flex: 1 0 auto; padding: 0 14px 0 8px; white-space: pre; color: #c9d1d9; }

    /* Código atual: foco destacado, o resto esmaecido */
    .cr-row--plain .cr-row__code { opacity: .5; }
    .cr-row--plain.is-focus .cr-row__code { opacity: 1; }
    .cr-row--plain.is-focus, .cr-row--plain.is-focus .cr-row__gutter { background: #1c2333; }
    .cr-row--plain.is-focus .cr-row__sign { border-right: 2px solid #e3b341; }
    .cr-row--plain.is-focus .cr-row__num { color: #c9d1d9; }
    /* Diff */
    .cr-row--context .cr-row__code { opacity: .62; }
    .cr-row--addition, .cr-row--addition .cr-row__gutter { background: #12261e; }
    .cr-row--addition .cr-row__code { background: rgba(46,160,67,.15); }
    .cr-row--addition .cr-row__sign { color: #3fb950; }
    .cr-row--deletion, .cr-row--deletion .cr-row__gutter { background: #25171c; }
    .cr-row--deletion .cr-row__code { background: rgba(248,81,73,.15); }
    .cr-row--deletion .cr-row__sign { color: #f85149; }
    .cr-row--info, .cr-row--info .cr-row__gutter { background: #161b22; }
    .cr-row--info .cr-row__code { color: #6e7681; font-style: italic; }
    /* Anotações */
    .cr-row.is-noted .cr-row__mark { box-shadow: inset 2px 0 0 color-mix(in srgb, #e3b341 55%, transparent); }
    .cr-row.is-active, .cr-row.is-active .cr-row__gutter { background: #2d2a1a; }
    .cr-row.is-active .cr-row__code { opacity: 1; background: rgba(227,179,65,.12); }

    .cr__notes { flex: none; list-style: none; margin: 0; padding: 8px; display: flex; flex-direction: column; gap: 6px; max-height: 38%;
      overflow: auto; border-top: 1px solid #30363d; background: #161b22; }
    .cr-note { display: flex; gap: 8px; padding: 7px 9px; border: 1px solid #30363d; border-radius: 8px; background: #1c2128; cursor: pointer; line-height: 1.45; outline: none; }
    .cr-note:hover, .cr-note.is-active, .cr-note:focus-visible { border-color: #e3b341; background: #2d2a1a; }
    .cr-note.is-off { opacity: .55; }
    .cr-note__mark { flex: none; color: #e3b341; font-size: 16px; line-height: 1.1; }
    .cr-note__main { min-width: 0; }
    .cr-note__where { display: block; font-size: 10.5px; color: #8b949e; text-transform: uppercase; letter-spacing: .03em; }
    .cr-note__where em { text-transform: none; font-style: normal; color: #79c0ff; }
    .cr-note__text p { margin: 0 0 3px; }
    .cr-note__text p:last-child { margin-bottom: 0; }
    @container (min-width: 720px) {
      .cr__body { flex-direction: row; }
      .cr__notes { width: 260px; max-height: none; border-top: none; border-left: 1px solid #30363d; }
    }

    /* Destaque de sintaxe (helpers/code-highlight.ts) */
    .cr .hl-k { color: #ff7b72; }
    .cr .hl-s { color: #a5d6ff; }
    .cr .hl-c { color: #8b949e; font-style: italic; }
    .cr .hl-n { color: #79c0ff; }
    .cr .hl-t { color: #7ee787; }
    .cr .hl-a { color: #d2a8ff; }
    .cr .hl-d { color: #ffa657; font-weight: 600; }

    /* Overlay (painel do CDK) e diálogo grande */
    .cdk-overlay-pane.code-ref-pane { max-width: 100vw; }
    .code-ref-dialog .mat-mdc-dialog-surface { border-radius: 14px !important; overflow: hidden; background: #161b22; }
    .code-ref-dialog .mat-mdc-dialog-container { --mdc-dialog-container-shape: 14px; }
  `],
})
export class CodeRefPopoverComponent {
  private svc = inject(CodeRefService);
  private clipboard = inject(CliipboardService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private dialogRef = inject<MatDialogRef<CodeRefPopoverComponent>>(MatDialogRef, { optional: true });
  private dialogData = inject<CodeRefDialogData | null>(MAT_DIALOG_DATA, { optional: true });

  readonly card = input<string | null>(null);
  readonly target = input<CodeRefTarget | null>(null);
  readonly mode = input<CodeRefMode>('popover');
  /** Aba inicial pedida (ex.: a que estava aberta ao expandir). */
  readonly initialTab = input<CodeRefTab | null>(null);

  readonly closed = output<void>();
  readonly expand = output<CodeRefTab>();

  readonly tabLabel = TAB_LABEL;

  readonly cardV = computed(() => this.dialogData?.card ?? this.card());
  readonly targetV = computed(() => this.dialogData?.target ?? this.target());
  readonly modeV = computed<CodeRefMode>(() => (this.dialogData ? 'dialog' : this.mode()));

  readonly status = signal<'loading' | 'error' | 'missing' | 'ready'>('loading');
  readonly ref = signal<CodeRef | null>(null);
  readonly tab = signal<CodeRefTab>('current');
  readonly activeNote = signal<number | null>(null);

  private readonly codeEl = viewChild<ElementRef<HTMLElement>>('code');
  private loadSeq = 0;
  private loadedAt = 0;

  readonly meta = computed(() => changeMeta(this.ref()?.change));
  readonly refIdV = computed(() => { const t = this.targetV(); return t?.kind === 'ref' ? t.id : null; });
  readonly pathV = computed(() => {
    const r = this.ref();
    if (r) return r.path;
    const t = this.targetV();
    return t?.kind === 'cite' ? t.path : (t?.id ?? '');
  });
  readonly linesV = computed(() => {
    const r = this.ref();
    if (r) return linesLabel(r.startLine, r.endLine);
    const t = this.targetV();
    return t?.kind === 'cite' ? linesLabel(t.start, t.end) : '';
  });
  readonly citationV = computed(() => {
    const r = this.ref();
    if (r) return citationText(r.path, r.startLine, r.endLine);
    const t = this.targetV();
    return t?.kind === 'cite' ? citationText(t.path, t.start, t.end) : '';
  });
  readonly ariaLabel = computed(() => `Código: ${this.citationV() || this.pathV()}`);

  readonly whyHtml = computed(() => {
    const why = this.ref()?.why?.trim();
    return why ? renderMarkdown(why, { codeRefs: false }) : '';
  });

  readonly tabs = computed<CodeRefTab[]>(() => {
    const r = this.ref();
    if (!r) return [];
    const out: CodeRefTab[] = [];
    if (r.proposal) out.push('proposal');
    if (r.snapshot !== null && r.snapshot !== undefined) out.push('current');
    if (r.implemented) out.push('done');
    return out.length ? out : ['current'];
  });

  private readonly diffs = computed(() => {
    const r = this.ref();
    return { proposal: parsePatch(r?.proposal), done: parsePatch(r?.implemented) };
  });

  statsOf(tab: CodeRefTab): { additions: number; deletions: number } | null {
    if (tab === 'current') return null;
    return diffStats(this.diffs()[tab]);
  }

  readonly twoCols = computed(() => this.tab() !== 'current');

  readonly rows = computed<Row[]>(() => {
    const r = this.ref();
    if (!r) return [];
    const notes = r.annotations ?? [];
    const tab = this.tab();
    if (tab === 'current') {
      const lines = (r.snapshot ?? '').replace(/\r\n/g, '\n').split('\n');
      if (lines.length && lines[lines.length - 1] === '' && lines.length > 1) lines.pop();
      const html = highlightLines(lines, r.language || r.path);
      const first = r.firstLine || 1;
      return lines.map((_, i) => {
        const n = first + i;
        return this.withNotes({ type: 'plain', old: n, html: html[i], focus: n >= r.startLine && n <= r.endLine, notes: [], marks: '' }, notes);
      });
    }
    const diff = this.diffs()[tab];
    const html = highlightLines(diff.map(d => (d.type === 'info' ? '' : d.content)), r.language || r.path);
    return diff.map((d, i) => this.withNotes({
      type: d.type,
      old: d.oldLineNumber,
      new: d.newLineNumber,
      html: d.type === 'info' ? escapeText(d.content) : html[i],
      focus: d.type === 'addition' || d.type === 'deletion',
      notes: [],
      marks: '',
    }, notes));
  });

  readonly notes = computed<NoteView[]>(() => {
    const r = this.ref();
    if (!r?.annotations?.length) return [];
    const rows = this.rows();
    return r.annotations.map((a, index) => {
      const side = sideOf(a);
      const to = a.to && a.to > a.from ? a.to : a.from;
      return {
        index,
        marker: noteMarker(index),
        side,
        lines: linesLabel(a.from, to),
        html: renderMarkdown(a.text ?? '', { codeRefs: false }),
        visible: rows.some(row => row.notes.includes(index)),
      };
    });
  });

  constructor() {
    effect(() => {
      this.cardV();
      this.targetV();
      untracked(() => this.load(false));
    });
    // Tempo real: a skill regravou a ref com o popover aberto → recarrega sem piscar.
    effect(() => {
      const ch = this.svc.changes();
      if (!ch || ch.kind === 'artifact' || ch.at <= this.loadedAt) return;
      if (ch.card !== `${untracked(this.cardV) ?? ''}`.trim()) return;
      untracked(() => this.load(true));
    });
    // Abriu a aba (ou a ref): rola até o foco / a 1ª mudança.
    effect(() => {
      this.rows();
      const el = this.codeEl()?.nativeElement;
      if (el) requestAnimationFrame(() => this.scrollToFocus(el));
    });
    afterNextRender(() => this.host.nativeElement.focus({ preventScroll: true }));
  }

  reload(): void { this.load(false); }

  private async load(silent: boolean): Promise<void> {
    const seq = ++this.loadSeq;
    const card = `${this.cardV() ?? ''}`.trim();
    const target = this.targetV();
    this.loadedAt = Date.now();
    if (!card || !target) { this.status.set('missing'); return; }
    if (!silent) this.status.set('loading');
    try {
      const refId = target.kind === 'ref'
        ? target.id
        : (await this.svc.match(card, target.path, target.start, target.end))?.ref ?? null;
      if (seq !== this.loadSeq) return;
      if (!refId) { this.ref.set(null); this.status.set('missing'); return; }
      const r = await this.svc.get(card, refId);
      if (seq !== this.loadSeq) return;
      if (!r) { this.ref.set(null); this.status.set('missing'); return; }
      const keepTab = silent ? this.tab() : (this.dialogData?.tab ?? this.initialTab());
      this.ref.set(r);
      const tabs = this.tabs();
      this.tab.set(keepTab && tabs.includes(keepTab) ? keepTab : tabs[0]);
      this.status.set('ready');
    } catch {
      if (seq !== this.loadSeq) return;
      if (!silent) this.status.set('error');
    }
  }

  selectTab(t: CodeRefTab): void {
    this.tab.set(t);
    this.activeNote.set(null);
  }

  onTabKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const tabs = this.tabs();
    const i = tabs.indexOf(this.tab());
    const next = tabs[(i + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    this.selectTab(next);
    requestAnimationFrame(() => this.host.nativeElement.querySelector<HTMLElement>('.cr__tab--on')?.focus());
  }

  hoverRow(row: Row | null): void {
    this.activeNote.set(row && row.notes.length ? row.notes[0] : null);
  }

  goToNote(n: NoteView): void {
    if (!n.visible) {
      const tab: CodeRefTab = n.side === 'new' ? 'proposal' : this.tabs().includes('current') ? 'current' : 'proposal';
      if (this.tabs().includes(tab)) this.tab.set(tab);
    }
    this.activeNote.set(n.index);
    requestAnimationFrame(() => {
      const el = this.codeEl()?.nativeElement;
      const row = el?.querySelector<HTMLElement>('.cr-row.is-active');
      if (el && row) el.scrollTop = Math.max(0, row.offsetTop - 3 * row.offsetHeight);
    });
  }

  copy(text: string | null | undefined): void {
    if (text) this.clipboard.copyFullDescriptionToClipboard(text);
  }

  close(): void {
    if (this.dialogRef) this.dialogRef.close();
    else this.closed.emit();
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && !this.dialogRef && !event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    }
  }

  private scrollToFocus(el: HTMLElement): void {
    const row = el.querySelector<HTMLElement>('.cr-row.is-focus');
    if (!row) { el.scrollTop = 0; return; }
    el.scrollTop = Math.max(0, row.offsetTop - 3 * row.offsetHeight);
  }

  private withNotes(row: Row, notes: CodeRefAnnotation[]): Row {
    if (!notes.length || row.type === 'info') return row;
    const marks: string[] = [];
    notes.forEach((a, i) => {
      const side = sideOf(a);
      const n = side === 'new' ? row.new : row.old;
      if (n === undefined) return;
      if (side === 'new' && row.type === 'plain') return; // nota do proposto não aparece no código atual
      const to = a.to && a.to > a.from ? a.to : a.from;
      if (n >= a.from && n <= to) {
        row.notes.push(i);
        if (n === a.from) marks.push(noteMarker(i));
      }
    });
    row.marks = marks.join('');
    return row;
  }
}

function sideOf(a: CodeRefAnnotation): 'old' | 'new' {
  return (a.side ?? '').toLowerCase() === 'new' ? 'new' : 'old';
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
