import { Component, inject, input } from '@angular/core';
import { CardPanelComponent } from '../card-panel/card-panel.component';
import { MarkdownEditorComponent } from '../markdown-editor/markdown-editor.component';
import { CardPrStateService } from '../../services/card-pr-state.service';

/**
 * Painel "Root Cause" do card ligado ao estado compartilhado (um root cause para todos os
 * repositórios): editar aqui reflete na tela de PR, nos popovers e no "Salvar RC no DevOps".
 * Use `[panel-actions]` para botões no cabeçalho.
 */
@Component({
  selector: 'app-root-cause-panel',
  standalone: true,
  imports: [CardPanelComponent, MarkdownEditorComponent],
  template: `
    <app-card-panel [title]="title()" icon="troubleshoot">
      <ng-container ngProjectAs="[panel-actions]">
        <ng-content select="[panel-actions]"></ng-content>
      </ng-container>
      <app-markdown-editor [value]="state.rootCause()"
                           (valueChange)="state.setRootCause($event)"
                           [loading]="loading()"
                           [skeletonLines]="[90, 76, 84, 64]"></app-markdown-editor>
    </app-card-panel>
  `,
  styles: [`
    :host { display: block; min-width: 0; min-height: 0; }
    /* Editor edge-to-edge: cancela o padding do corpo do painel */
    app-markdown-editor { margin: -10px -12px; }
  `]
})
export class RootCausePanelComponent {
  readonly state = inject(CardPrStateService);
  readonly title = input('Root Cause');
  readonly loading = input(false);
}
