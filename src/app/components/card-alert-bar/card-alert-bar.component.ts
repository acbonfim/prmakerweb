import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CardAlerts } from '../card-details-dialog/card-full.model';

interface AlertDefinition {
  key: keyof CardAlerts;
  icon: string;
  label: string;
}

/**
 * Barra flutuante de alertas de preenchimento do card.
 * Exibe um ícone com tooltip para cada regra pendente.
 */
@Component({
  selector: 'app-card-alert-bar',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatTooltipModule],
  template: `
    @if (inline) {
      <div class="alert-inline">
        @if (allClear) {
          <span class="alert alert--ok" matTooltip="Nenhuma pendência encontrada" matTooltipPosition="above">
            <mat-icon>check_circle</mat-icon>
          </span>
        } @else {
          @for (item of active; track item.key) {
            <span class="alert alert--warn" [matTooltip]="item.label" matTooltipPosition="above">
              <mat-icon>{{ item.icon }}</mat-icon>
            </span>
          }
        }
      </div>
    } @else {
      <div class="alert-bar">
        <mat-icon class="alert-bar__lead">notifications</mat-icon>
        <span class="alert-bar__title">Alertas do card</span>

        <div class="alert-bar__items">
          @if (allClear) {
            <span class="alert alert--ok" matTooltip="Nenhuma pendência encontrada" matTooltipPosition="above">
              <mat-icon>check_circle</mat-icon>
              Sem pendências
            </span>
          } @else {
            @for (item of active; track item.key) {
              <span class="alert alert--warn" [matTooltip]="item.label" matTooltipPosition="above">
                <mat-icon>{{ item.icon }}</mat-icon>
              </span>
            }
          }
        </div>
      </div>
    }
  `,
  styles: [`
    :host {
      display: block;
      flex-shrink: 0;
    }

    /* Modo inline — apenas os badges, para embutir no cabeçalho */
    .alert-inline {
      display: inline-flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
    }

    .alert-inline .alert {
      height: 24px;
      padding: 0 6px;
    }

    .alert-inline .alert mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .alert-bar {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 12px 4px 0 4px;
      padding: 8px 14px;
      background-color: #2f2f2f;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
    }

    .alert-bar__lead {
      color: var(--mat-sys-primary);
    }

    .alert-bar__title {
      font-size: 13px;
      font-weight: 600;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 85%, transparent);
    }

    .alert-bar__items {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-left: auto;
    }

    .alert {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 30px;
      padding: 0 8px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
    }

    .alert mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }

    .alert--warn {
      color: #ffb74d;
      background-color: rgba(255, 152, 0, 0.14);
      border: 1px solid rgba(255, 152, 0, 0.35);
      cursor: help;
    }

    .alert--ok {
      color: #81c784;
      background-color: rgba(76, 175, 80, 0.14);
      border: 1px solid rgba(76, 175, 80, 0.35);
    }
  `]
})
export class CardAlertBarComponent {
  @Input() alerts: CardAlerts | null = null;
  /** Quando true, renderiza apenas os badges (sem o card flutuante) para embutir em cabeçalhos. */
  @Input() inline = false;

  private readonly definitions: AlertDefinition[] = [
    { key: 'missingRootCause', icon: 'report', label: 'Card sem Root Cause preenchido' },
    { key: 'missingResolutionType', icon: 'rule', label: 'Card sem Resolution Type preenchido' },
    { key: 'missingGeneralClassification', icon: 'category', label: 'Card sem General Classification preenchido' },
    { key: 'missingClassification', icon: 'sell', label: 'Card sem Classification preenchido' },
    { key: 'remainingNotZero', icon: 'timelapse', label: 'Card com Remaining não zerado' }
  ];

  get active(): AlertDefinition[] {
    if (!this.alerts) {
      return [];
    }
    return this.definitions.filter((d) => !!this.alerts![d.key]);
  }

  get allClear(): boolean {
    return !!this.alerts && this.active.length === 0;
  }
}
