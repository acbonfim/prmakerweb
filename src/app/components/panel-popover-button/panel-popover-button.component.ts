import { Component, computed, inject, input } from '@angular/core';
import { CardPrStateService } from '../../services/card-pr-state.service';
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
    @if (label()) {
      <!-- Com texto: deixa claro que dá para escrever a descrição/root cause manualmente -->
      <button mat-stroked-button type="button" class="popover-trigger--label"
              [matTooltip]="tooltipText()" matTooltipPosition="above"
              (click)="op.toggle($event)">
        <mat-icon>{{ iconName() }}</mat-icon>
        {{ label() }}
        @if (filled()) {
          <mat-icon class="popover-trigger__filled" aria-label="preenchido">check_circle</mat-icon>
        }
      </button>
    } @else {
      <button mat-icon-button type="button" class="popover-trigger"
              [matTooltip]="tooltipText()" matTooltipPosition="above"
              [attr.aria-label]="tooltipText()"
              (click)="op.toggle($event)">
        <mat-icon>{{ iconName() }}</mat-icon>
      </button>
    }

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

    .popover-trigger--label { white-space: nowrap; }
    .popover-trigger__filled {
      color: #3fb950;
      font-size: 16px;
      width: 16px;
      height: 16px;
      margin-left: 4px;
    }
  `]
})
export class PanelPopoverButtonComponent {
  readonly kind = input<PanelPopoverKind>('description');
  readonly tooltip = input<string | null>(null);
  readonly icon = input<string | null>(null);
  /** Quando informado, vira um botão com texto (ex.: "Descrição") em vez de só o ícone. */
  readonly label = input<string | null>(null);

  private state = inject(CardPrStateService);
  /** Indica (✓) quando o conteúdo já foi escrito. */
  readonly filled = computed(() => {
    const value = this.kind() === 'description' ? this.state.description() : this.state.rootCause();
    return !!value && value.trim().length > 0;
  });

  readonly tooltipText = computed(() =>
    this.tooltip() ?? (this.kind() === 'description' ? 'Descrição do card' : 'Root Cause'));
  readonly iconName = computed(() =>
    this.icon() ?? (this.kind() === 'description' ? 'description' : 'troubleshoot'));
}
