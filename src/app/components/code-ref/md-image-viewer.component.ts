import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

export interface MdImageViewerData {
  url: string;
  name: string;
  alt?: string | null;
  /** Galeria: as outras imagens do mesmo texto (← → ou as setas nas bordas); `index` = a aberta. */
  items?: { url: string; name: string; alt?: string | null }[];
  index?: number;
}

/**
 * Imagem `anexo:` do markdown em tamanho grande (0075/F3): ajustar à tela ⇄ tamanho real, zoom +/−
 * (mesmo comportamento da prévia de imagem dos arquivos do plano), legenda pelo texto alternativo.
 */
@Component({
  selector: 'app-md-image-viewer',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <div class="iv">
      <div class="iv__bar">
        <mat-icon class="iv__lead">image</mat-icon>
        <span class="iv__name" [title]="cur().name">{{ cur().name }}</span>
        <span class="iv__spacer"></span>
        @if (list.length > 1) { <span class="iv__count" aria-live="polite">{{ index() + 1 }} de {{ list.length }}</span> }
        <button mat-icon-button (click)="zoomOut()" matTooltip="Diminuir" aria-label="Diminuir"><mat-icon>zoom_out</mat-icon></button>
        <button mat-button class="iv__zoom" (click)="toggleFit()" [matTooltip]="fit() ? 'Tamanho real' : 'Ajustar à tela'">
          {{ fit() ? 'Ajustar' : (zoom() * 100).toFixed(0) + '%' }}
        </button>
        <button mat-icon-button (click)="zoomIn()" matTooltip="Aumentar" aria-label="Aumentar"><mat-icon>zoom_in</mat-icon></button>
        <button mat-icon-button mat-dialog-close matTooltip="Fechar (Esc)" aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </div>
      <div class="iv__wrap">
        <div class="iv__stage" [class.iv__stage--fit]="fit()">
          <img [src]="cur().url" [alt]="cur().alt || cur().name" (load)="onLoad($event)" (click)="toggleFit()"
               [style.width]="fit() ? null : (naturalWidth() * zoom()) + 'px'" />
        </div>
        @if (list.length > 1) {
          <button type="button" class="iv__nav iv__nav--prev" (click)="go(-1)" [disabled]="index() === 0" aria-label="Imagem anterior"
                  [matTooltip]="index() > 0 ? 'Anterior (←)' : 'Esta é a primeira'"><mat-icon>chevron_left</mat-icon></button>
          <button type="button" class="iv__nav iv__nav--next" (click)="go(1)" [disabled]="index() === list.length - 1" aria-label="Próxima imagem"
                  [matTooltip]="index() < list.length - 1 ? 'Próxima (→)' : 'Esta é a última'"><mat-icon>chevron_right</mat-icon></button>
        }
      </div>
      @if (cur().alt) { <div class="iv__caption">{{ cur().alt }}</div> }
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .iv { display: flex; flex-direction: column; height: 100%; color: var(--mat-sys-on-surface); background: #161b22; }
    .iv__bar { flex: none; display: flex; align-items: center; gap: 6px; padding: 6px 8px 6px 16px; border-bottom: 1px solid rgba(255,255,255,.06); background: var(--surface-2, #323232); }
    .iv__lead { color: var(--mat-sys-primary); }
    .iv__name { font-weight: 600; font-size: 14px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .iv__spacer { flex: 1 1 auto; }
    .iv__zoom.mat-mdc-button { min-width: 64px; font-variant-numeric: tabular-nums; }
    .iv__count { font-size: 12.5px; font-variant-numeric: tabular-nums; color: color-mix(in srgb, var(--mat-sys-on-surface) 60%, transparent); margin-right: 6px; }
    .iv__wrap { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; position: relative; }
    .iv__nav { position: absolute; top: 50%; z-index: 2; transform: translateY(-50%); width: 40px; height: 64px; border-radius: 10px; border: 1px solid rgba(255,255,255,.14);
      display: grid; place-items: center; cursor: pointer; color: #fff; background: rgba(20,22,26,.62); padding: 0; }
    .iv__nav:hover:not(:disabled) { background: rgba(20,22,26,.85); }
    .iv__nav:disabled { opacity: .28; cursor: default; }
    .iv__nav .mat-icon { font-size: 30px; width: 30px; height: 30px; }
    .iv__nav--prev { left: 10px; }
    .iv__nav--next { right: 10px; }
    .iv__stage { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; align-items: flex-start; justify-content: center; padding: 12px;
      background: repeating-conic-gradient(rgba(255,255,255,.04) 0% 25%, transparent 0% 50%) 50% / 20px 20px; }
    .iv__stage img { display: block; cursor: zoom-in; }
    .iv__stage--fit { align-items: center; }
    .iv__stage--fit img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .iv__stage:not(.iv__stage--fit) img { cursor: zoom-out; max-width: none; }
    .iv__caption { flex: none; padding: 8px 16px 12px; text-align: center; font-size: 13px; color: color-mix(in srgb, var(--mat-sys-on-surface) 70%, transparent); }
  `],
})
export class MdImageViewerComponent {
  readonly data = inject<MdImageViewerData>(MAT_DIALOG_DATA);
  readonly list = this.data.items?.length ? this.data.items : [this.data];
  readonly index = signal(Math.max(0, Math.min(this.data.index ?? 0, this.list.length - 1)));
  readonly cur = computed(() => this.list[this.index()]);
  readonly fit = signal(true);
  readonly zoom = signal(1);
  readonly naturalWidth = signal(0);

  onLoad(event: Event): void {
    this.naturalWidth.set((event.target as HTMLImageElement).naturalWidth || 0);
  }

  go(step: number): void {
    const next = this.index() + step;
    if (next < 0 || next >= this.list.length) return;
    this.index.set(next);
    this.fit.set(true);
    this.zoom.set(1);
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (this.list.length < 2 || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    this.go(e.key === 'ArrowLeft' ? -1 : 1);
  }

  toggleFit(): void {
    if (this.fit()) { this.fit.set(false); this.zoom.set(1); } else { this.fit.set(true); }
  }
  zoomIn(): void { this.fit.set(false); this.zoom.update(z => Math.min(8, +(z * 1.25).toFixed(2))); }
  zoomOut(): void { this.fit.set(false); this.zoom.update(z => Math.max(0.1, +(z / 1.25).toFixed(2))); }
}
