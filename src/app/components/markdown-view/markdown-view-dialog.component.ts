import { Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { renderMarkdown } from '../../helpers/markdown-ext';
import { CliipboardService } from '../../services/cliipboard.service';
import { CodeRefHostDirective } from '../code-ref/code-ref-host.directive';

export interface MarkdownViewDialogData {
  /** Título ("Soluções propostas", "Publicado na discussion"). */
  title: string;
  /** Linha de contexto ("Análise · há 5 min · Claude"). */
  subtitle?: string | null;
  /** Ícone (`mat-icon`) do título. */
  icon?: string | null;
  /** Card dos links de código/itens (popover). */
  card?: string | null;
  /** O texto já em mãos… */
  markdown?: string | null;
  /** …ou carregado ao abrir (ex.: arquivo do plano). */
  load?: () => Promise<string>;
  /** Links de código (`ref:`/citações) e itens da engenharia reversa — padrão: ligados. */
  codeRefs?: boolean;
  reRefs?: boolean;
  /** Aviso acima do texto (ex.: "É o que o cliente lê na discussion."). */
  note?: string | null;
  /** Botão principal do rodapé (ex.: "Publicar") — fecha o diálogo com `'primary'`. */
  primaryAction?: string | null;
}

/**
 * Diálogo de leitura de um texto em markdown (0076): textos gerados pelo Claude/PRMake no card, o resumo
 * da situação e o que foi publicado na discussion. Renderiza com o design system do markdown, links de
 * código e itens da engenharia reversa clicáveis (`appCodeRefHost`) e copia o texto (formatado + markdown).
 */
@Component({
  selector: 'app-markdown-view-dialog',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, CodeRefHostDirective],
  template: `
    <header class="mv__head">
      <mat-icon class="mv__icon">{{ data.icon || 'description' }}</mat-icon>
      <div class="mv__titles">
        <h2 class="mv__title">{{ data.title }}</h2>
        @if (data.subtitle) { <span class="mv__sub">{{ data.subtitle }}</span> }
      </div>
      <button mat-icon-button type="button" (click)="copy()" [disabled]="!text()" matTooltip="Copiar (texto e formatado)" aria-label="Copiar o texto">
        <mat-icon>{{ copied() ? 'check' : 'content_copy' }}</mat-icon>
      </button>
      <button mat-icon-button type="button" (click)="ref.close()" matTooltip="Fechar (Esc)" aria-label="Fechar">
        <mat-icon>close</mat-icon>
      </button>
    </header>
    <div class="mv__scroll">
      @if (data.note) { <div class="mv__note"><mat-icon>info_outline</mat-icon><span>{{ data.note }}</span></div> }
      @switch (status()) {
        @case ('loading') {
          <div class="mv__state" role="status"><mat-icon class="mv__spin">progress_activity</mat-icon> Carregando o texto…</div>
        }
        @case ('error') {
          <div class="mv__state mv__state--error" role="alert">
            <mat-icon>error_outline</mat-icon> Não foi possível carregar o texto.
            <button mat-stroked-button type="button" (click)="reload()">Tentar de novo</button>
          </div>
        }
        @default {
          @if (html()) {
            <div class="mv__md" [appCodeRefHost]="data.card ?? null" [innerHTML]="html()"></div>
          } @else {
            <div class="mv__state">Sem texto.</div>
          }
        }
      }
    </div>
    @if (data.primaryAction) {
      <footer class="mv__foot">
        <button mat-button type="button" (click)="ref.close()">Fechar</button>
        <button mat-flat-button color="primary" type="button" (click)="ref.close('primary')">{{ data.primaryAction }}</button>
      </footer>
    }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; max-height: min(90vh, 920px); max-height: min(90dvh, 920px); min-height: 0; color: var(--mat-sys-on-surface); }
    .mv__head { flex: none; display: flex; align-items: center; gap: 10px; padding: 12px 8px 12px 18px; border-bottom: 1px solid rgba(255,255,255,.08);
      background: var(--surface-2, #2e343f); }
    .mv__icon { flex: none; color: #79c0ff; }
    .mv__titles { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .mv__title { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.3; }
    .mv__sub { font-size: 12px; color: color-mix(in srgb, var(--mat-sys-on-surface) 60%, transparent); }
    .mv__scroll { flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 16px 22px 20px; }
    .mv__note { display: flex; align-items: flex-start; gap: 6px; margin-bottom: 12px; padding: 7px 10px; border-radius: 8px; font-size: 12.5px;
      color: color-mix(in srgb, #58a6ff 80%, white); background: color-mix(in srgb, #58a6ff 9%, transparent); border: 1px solid color-mix(in srgb, #58a6ff 26%, transparent); }
    .mv__note .mat-icon { flex: none; font-size: 16px; width: 16px; height: 16px; margin-top: 1px; }
    .mv__state { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 30px 12px; color: color-mix(in srgb, var(--mat-sys-on-surface) 60%, transparent); }
    .mv__state--error { color: #f2b8b5; }
    .mv__spin { animation: mv-spin .9s linear infinite; }
    @keyframes mv-spin { to { transform: rotate(360deg); } }
    .mv__md { max-width: 920px; font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; }
    .mv__md ::ng-deep > :first-child { margin-top: 0; }
    .mv__md ::ng-deep > :last-child { margin-bottom: 0; }
    .mv__md ::ng-deep h1, .mv__md ::ng-deep h2 { margin: 18px 0 8px; font-size: 16px; font-weight: 600; }
    .mv__md ::ng-deep h3, .mv__md ::ng-deep h4 { margin: 14px 0 6px; font-size: 14px; font-weight: 600; }
    .mv__md ::ng-deep p { margin: 0 0 10px; }
    .mv__md ::ng-deep ul, .mv__md ::ng-deep ol { margin: 0 0 10px; padding-left: 1.4em; }
    .mv__md ::ng-deep code { color: #e6edf3; padding: 1px 5px; border-radius: 4px; background: rgba(110,118,129,.22); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .88em; }
    .mv__md ::ng-deep pre { padding: 10px 12px; border-radius: 8px; background: rgba(0,0,0,.3); overflow-x: auto; }
    .mv__md ::ng-deep pre code { padding: 0; background: none; }
    .mv__md ::ng-deep a { color: var(--mat-sys-primary); }
    .mv__md ::ng-deep hr { border: 0; border-top: 1px solid rgba(255,255,255,.1); margin: 14px 0; }
    .mv__md ::ng-deep img { max-width: 100%; height: auto; }
    .mv__foot { flex: none; display: flex; justify-content: flex-end; gap: 8px; padding: 10px 16px; border-top: 1px solid rgba(255,255,255,.08); }
    @media (max-width: 576px) {
      .mv__scroll { padding: 12px 14px 16px; }
      .mv__md { font-size: 15px; }
    }
  `],
})
export class MarkdownViewDialogComponent {
  readonly data = inject<MarkdownViewDialogData>(MAT_DIALOG_DATA);
  readonly ref = inject<MatDialogRef<MarkdownViewDialogComponent, 'primary' | undefined>>(MatDialogRef);
  private clipboard = inject(CliipboardService);

  readonly text = signal<string>(this.data.markdown ?? '');
  readonly status = signal<'loading' | 'error' | 'ready'>(this.data.load && !this.data.markdown ? 'loading' : 'ready');
  readonly copied = signal(false);
  readonly html = computed(() => renderMarkdown(this.text(), {
    codeRefs: this.data.codeRefs ?? true,
    reRefs: this.data.reRefs ?? !!this.data.card,
  }));

  constructor() {
    if (this.status() === 'loading') this.reload();
  }

  reload(): void {
    const load = this.data.load;
    if (!load) return;
    this.status.set('loading');
    load().then(
      text => { this.text.set(text ?? ''); this.status.set('ready'); },
      () => this.status.set('error'),
    );
  }

  copy(): void {
    const text = this.text();
    if (!text) return;
    void this.clipboard.copyRichToClipboard(renderMarkdown(text, { codeRefs: false }), text);
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1500);
  }
}

/** Opções padrão do diálogo (tamanho e painel). */
export const MARKDOWN_VIEW_DIALOG = {
  width: 'min(980px, 96vw)',
  maxWidth: '96vw',
  panelClass: 'markdown-view-dialog',
  autoFocus: false,
} as const;
