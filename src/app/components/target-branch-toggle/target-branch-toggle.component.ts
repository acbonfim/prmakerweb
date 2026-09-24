import { Component, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonToggleModule } from '@angular/material/button-toggle';

export interface TargetBranchOption {
  label: string;
  value: string;
}

/** Seleção da branch de destino do PR (ActiveBranchs da configuração do plugin). */
@Component({
  selector: 'app-target-branch-toggle',
  standalone: true,
  imports: [FormsModule, MatButtonToggleModule],
  template: `
    <label class="pr-field__label">{{ label() }}</label>
    @if (loading()) {
      <div class="pr-skel-row" aria-hidden="true">
        @for (s of [1, 2, 3, 4]; track s) {
          <div class="cime-skeleton skeleton--toggle"></div>
        }
      </div>
    } @else {
      <mat-button-toggle-group class="pr-toggle"
                               [ngModel]="value()"
                               (ngModelChange)="value.set($event)"
                               [disabled]="disabled()"
                               hideSingleSelectionIndicator>
        @for (opt of options(); track opt.value) {
          <mat-button-toggle [value]="opt.value">{{ opt.label }}</mat-button-toggle>
        }
      </mat-button-toggle-group>
    }
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    /* Label no estilo da toolbar (não há mat-label flutuante no toggle group) */
    .pr-field__label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.4px;
      text-transform: uppercase;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent);
      padding-left: 2px;
    }

    .pr-skel-row { display: flex; gap: 6px; }
    .skeleton--toggle { width: 54px; height: 40px; border-radius: 8px; }

    /* ── Segmented control (mat-button-toggle-group) ── */
    .pr-toggle {
      border: none;
      border-radius: 0;
      overflow: visible;
      background: transparent;
      gap: 6px;
      display: inline-flex;
      flex-wrap: wrap;
    }

    /* Cada opção é um "chip" independente e totalmente arredondado. O !important vence
       as regras do grupo do Material, que zeram os cantos dos itens do meio. */
    :host ::ng-deep .pr-toggle .mat-button-toggle {
      border: 1px solid rgba(255, 255, 255, 0.12) !important;
      border-radius: 8px !important;
      background: var(--surface-input, #1f1f1f);
      color: color-mix(in srgb, var(--mat-sys-on-surface) 78%, transparent);
      overflow: hidden;
    }

    :host ::ng-deep .pr-toggle .mat-button-toggle-button { height: 40px; }

    :host ::ng-deep .pr-toggle .mat-button-toggle .mat-button-toggle-label-content {
      line-height: 40px;
      padding: 0 14px;
      font-weight: 600;
      font-size: 13px;
    }

    :host ::ng-deep .pr-toggle .mat-button-toggle-checked {
      background: var(--mat-sys-primary);
      border-color: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
    }

    :host ::ng-deep .pr-toggle .mat-button-toggle:hover:not(.mat-button-toggle-checked) {
      border-color: color-mix(in srgb, var(--mat-sys-primary) 55%, transparent);
    }
  `]
})
export class TargetBranchToggleComponent {
  readonly options = input<TargetBranchOption[]>([]);
  readonly label = input('Branch para PR');
  readonly loading = input(false);
  readonly disabled = input(false);
  readonly value = model('');
}
