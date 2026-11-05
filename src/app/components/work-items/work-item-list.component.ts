import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * 0085: lista dos itens de trabalho do card (esqueleto — a implementação completa vem a seguir).
 * API pública: `[card]`, `[cardType]`, `[openItem]` (abre o modal do item — `?item=`), `(countChange)`.
 */
@Component({
  selector: 'app-work-item-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="wil-empty">Itens de trabalho</div>`
})
export class WorkItemListComponent {
  readonly card = input<string | null>();
  readonly cardType = input<'bug' | 'user-story'>('bug');
  readonly openItem = input<number | null>(null);
  readonly countChange = output<number>();
}
