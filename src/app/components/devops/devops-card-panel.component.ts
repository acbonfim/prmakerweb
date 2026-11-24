// 0099: stub — substituído pelo F2 no Q1
import { Component, input, output } from '@angular/core';

/** Painel do card do DevOps (campos, tags, coluna, comentário) — a implementação real é do F2. */
@Component({
  selector: 'app-devops-card-panel',
  standalone: true,
  template: `<div class="dvp-stub">Card #{{ cardId() }} <button type="button" (click)="closed.emit()">Fechar</button></div>`,
  styles: [`.dvp-stub { padding: 16px; display: flex; gap: 8px; align-items: center; }`]
})
export class DevOpsCardPanelComponent {
  readonly cardId = input<string | null>(null);
  readonly epic = input<number | null>(null);
  readonly closed = output<void>();
}
