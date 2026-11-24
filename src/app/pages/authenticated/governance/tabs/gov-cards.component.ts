import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { GovernanceCardRow, statusLabel } from '../../../../services/governance/governance.model';
import { fmtMs, fmtNum } from '../../../../services/governance/governance.logic';
import { formatDateTime } from '../../../../services/usage/usage.model';
import { GovernanceStore } from '../governance.store';
import { GovCardTimelineComponent } from './gov-card-timeline.component';

const PAGE_SIZE = 20;

/** Cards (0098): tabela paginada com busca e a linha do tempo do card escolhido (marcos e duração de cada ação). */
@Component({
  selector: 'app-gov-cards',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, GovCardTimelineComponent],
  templateUrl: './gov-cards.component.html',
  styleUrls: ['../governance-shared.css'],
})
export class GovCardsComponent {
  readonly statusLabel = statusLabel;
  readonly store = inject(GovernanceStore);

  readonly rows = signal<GovernanceCardRow[]>([]);
  readonly total = signal(0);
  readonly page = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly search = signal('');
  readonly user = signal('');

  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));

  constructor() {
    effect(() => {
      this.store.range();
      untracked(() => this.load(0));
    });
    // Opções de pessoa no filtro (quando a aba abre direto).
    if (!this.store.userOptions().length) {
      this.store.api.users(this.store.range()).subscribe({ next: (u) => this.store.mergeUsers(u ?? []), error: () => undefined });
    }
  }

  load(page: number): void {
    this.page.set(page);
    this.loading.set(true);
    this.error.set(null);
    this.store.api.cards({ ...this.store.range(), search: this.search().trim() || null, user: this.user() || null, page, size: PAGE_SIZE }).subscribe({
      next: (r) => {
        this.rows.set(r.items ?? []);
        this.total.set(r.total ?? 0);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Não consegui carregar os cards.');
      },
    });
  }

  go(delta: number): void {
    const next = Math.min(this.pageCount() - 1, Math.max(0, this.page() + delta));
    if (next !== this.page()) this.load(next);
  }

  open(c: GovernanceCardRow): void {
    this.store.select('card', this.store.selectedCard() === c.cardNumber ? null : c.cardNumber);
  }

  /** Busca por número que não está na página: abre o card direto. */
  openTyped(): void {
    const n = Number(this.search().trim());
    if (Number.isInteger(n) && n > 0 && !this.rows().some((r) => r.cardNumber === n)) this.store.select('card', n);
    this.load(0);
  }

  milestoneText(c: GovernanceCardRow): string {
    return c.milestones.map((m) => `${m.label} (${formatDateTime(m.at)})`).join(' → ') || 'Nenhum marco';
  }

  close(): void {
    this.store.select('card', null);
  }

  num = fmtNum;
  dur = fmtMs;
  dt = formatDateTime;
}
