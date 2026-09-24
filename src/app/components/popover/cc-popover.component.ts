import { Component, output, signal } from '@angular/core';
import { CdkOverlayOrigin, ConnectedPosition, ConnectionPositionPair, OverlayModule } from '@angular/cdk/overlay';

/**
 * Popover ancorado ao gatilho (UI Kit §11.5 / §6 "menos modal") — painel flutuante com caret
 * apontando pro botão, animado (fade+scale), que segura conteúdo rico (form pequeno, stepper,
 * mini-lista, timeline) e fecha em clique fora / `Esc`. Materializado com CDK Overlay
 * (`cdkConnectedOverlay`) — preferido a `mat-menu` quando há form/interação dentro (§11.5).
 *
 * Uso:
 *   <button cdkOverlayOrigin #orig="cdkOverlayOrigin" (click)="pop.toggle(orig)">Abrir</button>
 *   <cc-popover #pop>
 *     <conteúdo />
 *   </cc-popover>
 *
 * Copiado do ComandaCerta (`ComandaCerta.App/src/app/shared/popover`) — feature 0005 do CIME.
 * Consumidor: cc-filter-bar.
 */
@Component({
  selector: 'cc-popover',
  imports: [OverlayModule],
  template: `
    <ng-template
      cdkConnectedOverlay
      [cdkConnectedOverlayOrigin]="origin()!"
      [cdkConnectedOverlayOpen]="isOpen()"
      [cdkConnectedOverlayPositions]="positions"
      [cdkConnectedOverlayHasBackdrop]="true"
      [cdkConnectedOverlayPush]="true"
      cdkConnectedOverlayBackdropClass="cdk-overlay-transparent-backdrop"
      (attach)="opened.emit()"
      (backdropClick)="close()"
      (detach)="close()"
      (overlayKeydown)="onKeydown($event)"
      (positionChange)="onPositionChange($event.connectionPair)"
    >
      <div class="cc-popover-panel" [class.above]="above()" [class.align-start]="alignX() === 'start'" [class.align-end]="alignX() === 'end'" role="dialog">
        <span class="cc-popover-caret"></span>
        <div class="cc-popover-content"><ng-content /></div>
      </div>
    </ng-template>
  `,
  styles: [`
    .cc-popover-panel {
      position: relative; margin: 8px 0; min-width: 200px;
      max-width: min(340px, calc(100vw - 24px));
      background: var(--cc-overlay, #fff); color: var(--cc-text-1, inherit);
      border: 1px solid var(--cc-surface-border, rgba(0,0,0,.12));
      border-radius: var(--cc-radius-md, 12px); box-shadow: var(--cc-elev-3, 0 12px 34px rgba(0,0,0,.22));
      transform-origin: top center; animation: cc-pop-in .12s ease-out;
    }
    .cc-popover-panel.above { transform-origin: bottom center; }
    .cc-popover-content { padding: 14px 16px; }
    /* Caret apontando pro gatilho — em cima quando o painel abre embaixo (padrão), embaixo quando
       o CDK vira o painel pra cima por falta de espaço. */
    .cc-popover-caret {
      position: absolute; left: 50%; margin-left: -6px; width: 12px; height: 12px; rotate: 45deg;
      background: var(--cc-overlay, #fff); border: 1px solid var(--cc-surface-border, rgba(0,0,0,.12));
    }
    .cc-popover-panel:not(.above) .cc-popover-caret { top: -6px; border-right: none; border-bottom: none; }
    .cc-popover-panel.above .cc-popover-caret { bottom: -6px; border-left: none; border-top: none; }
    /* Quando o CDK alinha o painel pela borda (gatilho perto de um canto), o caret acompanha o
       gatilho em vez de ficar no centro. */
    .cc-popover-panel.align-start .cc-popover-caret { left: 18px; margin-left: 0; }
    .cc-popover-panel.align-end .cc-popover-caret { left: auto; right: 18px; margin-left: 0; }
    @keyframes cc-pop-in { from { opacity: 0; transform: scale(.94); } to { opacity: 1; transform: scale(1); } }
  `],
})
export class CcPopoverComponent {
  readonly closed = output<void>();
  /** Emitido quando o painel é ANEXADO/renderizado (mirror do `menuOpened` do mat-menu) — usar para
   *  carregar dados sob demanda (ex.: busca inicial do filtro), inclusive com fonte síncrona. */
  readonly opened = output<void>();

  protected readonly origin = signal<CdkOverlayOrigin | null>(null);
  protected readonly isOpen = signal(false);
  protected readonly above = signal(false);
  protected readonly alignX = signal<'center' | 'start' | 'end'>('center');

  /** Posições: preferir abaixo-centralizado; sem espaço, cai pra acima e, se o gatilho estiver
   *  perto de uma borda lateral, alinha pela borda (end/start) pra NÃO vazar da tela (§6). */
  protected readonly positions: ConnectedPosition[] = [
    { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top' },
    { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom' },
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top' },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom' },
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top' },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom' },
  ];

  open(origin: CdkOverlayOrigin): void {
    this.origin.set(origin);
    this.isOpen.set(true);
  }

  toggle(origin: CdkOverlayOrigin): void {
    if (this.isOpen() && this.origin() === origin) { this.close(); return; }
    this.open(origin);
  }

  close(): void {
    if (!this.isOpen()) return;
    this.isOpen.set(false);
    this.closed.emit();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); this.close(); }
  }

  protected onPositionChange(pair: ConnectionPositionPair): void {
    // overlayY 'bottom' => o painel está posicionado ACIMA do gatilho (encostou pela base).
    this.above.set(pair.overlayY === 'bottom');
    this.alignX.set(pair.overlayX as 'center' | 'start' | 'end');
  }
}
