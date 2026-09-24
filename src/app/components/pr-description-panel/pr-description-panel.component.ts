import { Component, inject, input } from '@angular/core';
import { CardPanelComponent } from '../card-panel/card-panel.component';
import { MarkdownEditorComponent } from '../markdown-editor/markdown-editor.component';
import { CardPrStateService } from '../../services/card-pr-state.service';

/**
 * Painel "Descrição" do card ligado ao estado compartilhado: a mesma descrição aparece
 * na tela de PR, no modal "Abrir PR" e no popover — editar em um reflete nos demais.
 * Use `[panel-actions]` para botões no cabeçalho.
 */
@Component({
  selector: 'app-pr-description-panel',
  standalone: true,
  imports: [CardPanelComponent, MarkdownEditorComponent],
  template: `
    <app-card-panel [title]="title()" icon="description">
      <ng-container ngProjectAs="[panel-actions]">
        <ng-content select="[panel-actions]"></ng-content>
      </ng-container>
      <app-markdown-editor [value]="state.description()"
                           (valueChange)="state.setDescription($event)"
                           [loading]="loading()"></app-markdown-editor>
    </app-card-panel>
  `,
  styles: [`
    :host { display: block; min-width: 0; min-height: 0; }
    /* Editor edge-to-edge: cancela o padding do corpo do painel */
    app-markdown-editor { margin: -10px -12px; }
  `]
})
export class PrDescriptionPanelComponent {
  readonly state = inject(CardPrStateService);
  readonly title = input('Descrição');
  readonly loading = input(false);
}
