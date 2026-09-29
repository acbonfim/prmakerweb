import { Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CardPanelComponent } from '../card-panel/card-panel.component';
import { MarkdownEditorComponent } from '../markdown-editor/markdown-editor.component';
import { CardPrStateService } from '../../services/card-pr-state.service';
import { CliipboardService } from '../../services/cliipboard.service';

/**
 * Painel "Descrição" do card ligado ao estado compartilhado: a mesma descrição aparece
 * na tela de PR, no modal "Abrir PR" e no popover — editar em um reflete nos demais.
 * Use `[panel-actions]` para botões no cabeçalho.
 */
@Component({
  selector: 'app-pr-description-panel',
  standalone: true,
  imports: [CardPanelComponent, MarkdownEditorComponent, MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <app-card-panel [title]="title()" icon="description">
      <ng-container ngProjectAs="[panel-actions]">
        <!-- 0021: copiar fica onde o texto está (saiu o "Copiar" do rodapé) -->
        <button mat-icon-button type="button" class="panel-copy"
                matTooltip="Copiar descrição (markdown)" matTooltipPosition="above"
                aria-label="Copiar descrição" [disabled]="!hasText()" (click)="copy()">
          <mat-icon>content_copy</mat-icon>
        </button>
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
    .panel-copy.mat-mdc-icon-button {
      width: 34px; height: 34px; padding: 0; margin: -4px 0;
      --mdc-icon-button-state-layer-size: 34px;
      color: var(--mat-sys-primary);
    }
    .panel-copy .mat-icon { font-size: 18px; width: 18px; height: 18px; }
  `]
})
export class PrDescriptionPanelComponent {
  readonly state = inject(CardPrStateService);
  private clipboard = inject(CliipboardService);
  readonly hasText = computed(() => !!this.state.description()?.trim());
  readonly title = input('Descrição');
  readonly loading = input(false);

  copy(): void {
    this.clipboard.copyFullDescriptionToClipboard(this.state.description() ?? '');
  }
}
