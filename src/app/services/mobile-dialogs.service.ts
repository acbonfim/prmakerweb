import { Injectable, inject } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';

/** Mesmo corte do celular usado nas telas (0043). */
const PHONE_QUERY = '(max-width: 576px)';

/**
 * Diálogos no celular (feature 0043). Os diálogos são abertos com tamanhos de desktop (520px, 980px × 88vh…);
 * no celular os grandes viram tela cheia (cabeçalho e rodapé longe do notch) e os pequenos (confirmações)
 * só ganham a largura da tela. Sem mexer em cada chamada a `dialog.open`.
 */
@Injectable({ providedIn: 'root' })
export class MobileDialogsService {
  private readonly dialog = inject(MatDialog);
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    this.dialog.afterOpened.subscribe((ref) => this.adapt(ref));
  }

  private adapt(ref: MatDialogRef<unknown>): void {
    if (!window.matchMedia(PHONE_QUERY).matches) return;
    // O painel do diálogo recém-aberto é o último (o id do container só entra na próxima detecção de mudanças).
    const panes = document.querySelectorAll<HTMLElement>('.cdk-overlay-pane.mat-mdc-dialog-panel');
    const pane = panes[panes.length - 1];
    if (!pane) return;
    ref.addPanelClass(isLarge(pane.style) ? 'cime-dialog--full' : 'cime-dialog--phone');
  }
}

/** Grande = pediu altura ou largura de "tela" (≥ 480px ou ≥ 90vw). */
function isLarge(style: CSSStyleDeclaration): boolean {
  if (style.height && style.height !== 'auto') return true;
  const width = style.width;
  const px = [...width.matchAll(/(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
  const vw = [...width.matchAll(/(\d+(?:\.\d+)?)vw/g)].map((m) => Number(m[1]));
  return px.some((v) => v >= 480) || vw.some((v) => v >= 90);
}
