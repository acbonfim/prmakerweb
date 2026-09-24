import { Component, computed, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PopoverModule } from 'primeng/popover';
import { PrDescriptionPanelComponent } from '../pr-description-panel/pr-description-panel.component';
import { RootCausePanelComponent } from '../root-cause-panel/root-cause-panel.component';

export type PanelPopoverKind = 'description' | 'rootCause';

/**
 * Botão de ícone (com tooltip) que abre um popover grande com o painel de Descrição ou de
 * Root Cause do card. Os painéis usam o estado compartilhado, então a edição aqui reflete
 * na tela de PR, no modal e em qualquer outro editor aberto.
 */
@Component({
  selector: 'app-panel-popover-button',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, PopoverModule,
    PrDescriptionPanelComponent, RootCausePanelComponent],
  template: `
    <button mat-icon-button type="button" class="popover-trigger"
            [matTooltip]="tooltipText()" matTooltipPosition="above"
            [attr.aria-label]="tooltipText()"
            (click)="op.toggle($event)">
      <mat-icon>{{ iconName() }}</mat-icon>
    </button>

    <!-- baseZIndex acima do MatDialog (1000): o popover também é usado dentro do modal "Abrir PR". -->
    <p-popover #op appendTo="body" [baseZIndex]="1100" styleClass="cime-panel-popover">
      <div class="cime-panel-popover__body">
        @if (kind() === 'description') {
          <app-pr-description-panel></app-pr-description-panel>
        } @else {
          <app-root-cause-panel></app-root-cause-panel>
        }
      </div>
    </p-popover>
  `,
  styles: [`
    .popover-trigger.mat-mdc-icon-button {
      width: 36px;
      height: 36px;
      padding: 0;
      --mdc-icon-button-state-layer-size: 36px;
      color: var(--mat-sys-primary);
    }
  `]
})
export class PanelPopoverButtonComponent {
  readonly kind = input<PanelPopoverKind>('description');
  readonly tooltip = input<string | null>(null);
  readonly icon = input<string | null>(null);

  readonly tooltipText = computed(() =>
    this.tooltip() ?? (this.kind() === 'description' ? 'Descrição do card' : 'Root Cause'));
  readonly iconName = computed(() =>
    this.icon() ?? (this.kind() === 'description' ? 'description' : 'troubleshoot'));
}
