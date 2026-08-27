import { Component, Input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/**
 * Painel apresentacional reutilizável no mesmo estilo visual da linha do tempo
 * (cabeçalho com ícone + título e um corpo que preenche a altura disponível).
 * O conteúdo é projetado; use `[panel-actions]` para itens à direita do cabeçalho.
 */
@Component({
  selector: 'app-card-panel',
  standalone: true,
  imports: [MatIconModule],
  template: `
    <div class="panel">
      <div class="panel__header">
        @if (icon) {
          <mat-icon class="panel__icon">{{ icon }}</mat-icon>
        }
        <span class="panel__title">{{ title }}</span>
        <span class="panel__spacer"></span>
        <ng-content select="[panel-actions]"></ng-content>
      </div>
      <div class="panel__body">
        <ng-content></ng-content>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
    }

    .panel {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      background-color: #2a2a2a;
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 10px;
      overflow: hidden;
    }

    .panel__header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      background-color: #323232;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }

    .panel__icon {
      color: var(--mat-sys-primary);
    }

    .panel__title {
      font-weight: 600;
      font-size: 14px;
    }

    .panel__spacer {
      margin-left: auto;
    }

    .panel__body {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      padding: 10px 12px;
      overflow: hidden;
    }
  `]
})
export class CardPanelComponent {
  @Input() title = '';
  @Input() icon?: string;
}
