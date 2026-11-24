// 0099: stub — substituído pelo F2 no Q1
import { Component, input, output } from '@angular/core';

/** Board do DevOps do épico (colunas, lanes, arrastar) — a implementação real é do F2. */
@Component({
  selector: 'app-devops-board',
  standalone: true,
  template: `<div class="dvb-stub">Board do DevOps ({{ team() || 'sem time' }} · {{ board() || 'sem board' }} · {{ scope() === 'epic' ? 'cards do épico' : 'board do time' }})</div>`,
  styles: [`.dvb-stub { padding: 24px; text-align: center; color: var(--cc-text-3, rgba(255,255,255,.45)); border: 1px dashed var(--cc-surface-border, rgba(255,255,255,.08)); border-radius: 10px; }`]
})
export class DevOpsBoardComponent {
  readonly team = input<string | null>(null);
  readonly board = input<string | null>(null);
  readonly epic = input<number | null>(null);
  readonly scope = input<'epic' | 'board'>('epic');
  readonly cardOpened = output<string>();
}
