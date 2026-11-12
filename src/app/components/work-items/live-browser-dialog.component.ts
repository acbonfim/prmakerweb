import { Component, Signal, ViewEncapsulation, computed, effect, inject, signal, untracked } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { formatWorkNumber } from './work-item.model';
import { LiveBrowserView } from './live-browser';
import { WORK_DIALOG_STYLES } from './work-dialog.styles';

export interface LiveBrowserDialogData {
  itemNumber: number;
  title?: string | null;
  /** Sessão do executor local enquanto ela existir (null = a navegação terminou). */
  view: Signal<LiveBrowserView | null>;
}

/**
 * 0095: a tela do navegador que o Claude está usando, ao vivo, direto do executor desta máquina (MJPEG em 127.0.0.1).
 * Nada é gravado: fechar o modal encerra a transmissão. Abrir com `workDialogConfig(data, '1100px')`.
 */
@Component({
  selector: 'app-live-browser-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="wi-dlg">
      <header class="wi-dlg__head">
        <mat-icon class="lbd__ico">web</mat-icon>
        <div class="wi-dlg__head-main">
          <span class="wi-dlg__title">Tela ao vivo · <span class="wi-num">{{ num(data.itemNumber) }}</span> {{ data.title || '' }}</span>
          <span class="wi-dlg__sub">
            @if (session(); as s) {
              {{ s.label || s.env }}@if (s.task) { · sub-tarefa {{ num(+s.task) }} }@if (s.readOnly) { · somente leitura }
            } @else { a navegação terminou }
            · só nesta máquina, nada é gravado
          </span>
        </div>
        @if (url()) { <span class="lbd__live" aria-label="Ao vivo"><i></i>ao vivo</span> }
        <button mat-icon-button mat-dialog-close aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </header>
      <div class="wi-dlg__body lbd__body">
        <div class="lbd__screen">
          @if (url(); as u) {
            <img [src]="u" alt="Tela do navegador do Claude" (load)="loaded.set(true)" (error)="failed.set(true)" [class.lbd__img--on]="loaded()" />
          }
          @if (!url()) {
            <p class="lbd__msg"><mat-icon>check_circle</mat-icon>A navegação terminou — os prints de evidência ficam na sub-tarefa.</p>
          } @else if (failed()) {
            <p class="lbd__msg"><mat-icon>cloud_off</mat-icon>Não consegui ler a tela do executor desta máquina.</p>
          } @else if (!loaded()) {
            <p class="lbd__msg"><mat-icon class="lbd__spin">autorenew</mat-icon>Conectando ao navegador…</p>
          }
        </div>
      </div>
    </div>
  `,
  styles: [WORK_DIALOG_STYLES, `
    .lbd__ico { color: var(--mat-sys-primary); flex: none; }
    .lbd__live { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: #e5534b; margin-right: 4px; }
    .lbd__live i { width: 8px; height: 8px; border-radius: 50%; background: currentColor; animation: lbd-pulse 1.4s ease-in-out infinite; }
    .lbd__body { padding: 0 !important; }
    .lbd__screen { position: relative; aspect-ratio: 1440 / 900; max-height: calc(92vh - 72px); width: 100%; background: #111; display: grid; place-items: center; overflow: hidden; }
    .lbd__screen img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; opacity: 0; transition: opacity .2s; }
    .lbd__screen img.lbd__img--on { opacity: 1; }
    .lbd__msg { position: relative; display: flex; align-items: center; gap: 8px; margin: 0; padding: 16px; color: #ddd; font-size: 13px; text-align: center; }
    .lbd__msg mat-icon { flex: none; }
    .lbd__spin { animation: lbd-spin 1s linear infinite; }
    @keyframes lbd-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
    @keyframes lbd-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .lbd__live i, .lbd__spin { animation: none; } }
  `]
})
export class LiveBrowserDialogComponent {
  readonly data = inject<LiveBrowserDialogData>(MAT_DIALOG_DATA);
  readonly num = formatWorkNumber;
  readonly session = computed(() => this.data.view()?.session ?? null);
  /** Mesma URL enquanto a sessão for a mesma (a lista é relida a cada poucos segundos — não reconecta à toa). */
  readonly url = computed(() => this.data.view()?.url ?? null, { equal: (a, b) => a === b });
  readonly loaded = signal(false);
  readonly failed = signal(false);

  constructor() {
    // Outra sessão (o Claude reabriu o navegador): conecta de novo do zero.
    effect(() => {
      this.url();
      untracked(() => { this.loaded.set(false); this.failed.set(false); });
    });
  }
}
