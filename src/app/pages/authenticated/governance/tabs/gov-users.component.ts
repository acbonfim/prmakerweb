import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { UserAvatarComponent } from '../../../../components/user-avatar/user-avatar.component';
import {
  GovernanceUserDetail, GovernanceUserRow, OUTCOME_LABEL, SOURCE_LABEL, labelOf,
} from '../../../../services/governance/governance.model';
import { SortState, fmtMs, fmtNum, fmtUsd, sortRows, toggleSort } from '../../../../services/governance/governance.logic';
import { formatAgo, formatDateTime } from '../../../../services/usage/usage.model';
import { GovernanceStore } from '../governance.store';

type UserSort = keyof Pick<GovernanceUserRow, 'userName' | 'events' | 'cards' | 'plansStarted' | 'analysesDone' | 'medianAnalysisMs' |
  'workItems' | 'tasksDone' | 'medianTaskMs' | 'blocked' | 'warned' | 'errors' | 'aiCostUsd' | 'lastActivityAt'>;

/** Usuários (0098): tabela ordenável e painel com os cards e os eventos recentes da pessoa. */
@Component({
  selector: 'app-gov-users',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, UserAvatarComponent],
  templateUrl: './gov-users.component.html',
  styleUrls: ['../governance-shared.css'],
})
export class GovUsersComponent {
  readonly store = inject(GovernanceStore);

  readonly rows = signal<GovernanceUserRow[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly search = signal('');
  readonly sort = signal<SortState<UserSort>>({ key: 'events', dir: -1 });

  readonly detail = signal<GovernanceUserDetail | null>(null);
  readonly detailLoading = signal(false);
  readonly detailError = signal<string | null>(null);

  readonly sorted = computed(() => {
    const q = this.search().trim().toLowerCase();
    const list = q ? this.rows().filter((r) => r.userName.toLowerCase().includes(q)) : this.rows();
    return sortRows(list, this.sort());
  });

  constructor() {
    effect(() => {
      const r = this.store.range();
      untracked(() => this.load(r));
    });
    effect(() => {
      const id = this.store.selectedUser();
      const r = this.store.range();
      untracked(() => (id ? this.loadDetail(id, r) : this.detail.set(null)));
    });
    this.store.ensureRules();
  }

  private load(r: { from: string; to: string }): void {
    this.loading.set(true);
    this.error.set(null);
    this.store.api.users(r).subscribe({
      next: (rows) => {
        this.rows.set(rows ?? []);
        this.store.mergeUsers(rows ?? []);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Não consegui carregar os usuários.');
      },
    });
  }

  private loadDetail(id: string, r: { from: string; to: string }): void {
    this.detailLoading.set(true);
    this.detailError.set(null);
    this.store.api.user(id, r).subscribe({
      next: (d) => {
        this.detail.set(d);
        this.detailLoading.set(false);
      },
      error: () => {
        this.detail.set(null);
        this.detailLoading.set(false);
        this.detailError.set('Não consegui carregar o detalhe da pessoa.');
      },
    });
  }

  open(u: GovernanceUserRow): void {
    this.store.select('usuario', this.store.selectedUser() === u.userId ? null : u.userId);
  }

  close(): void {
    this.store.select('usuario', null);
  }

  sortBy(k: UserSort): void {
    this.sort.set(toggleSort(this.sort(), k, ['userName']));
  }

  mark(k: UserSort): string {
    const s = this.sort();
    return s.key === k ? (s.dir === 1 ? '▲' : '▼') : '';
  }

  ago(iso: string | null): string {
    return formatAgo(iso);
  }

  outcome(o: string): string {
    return labelOf(OUTCOME_LABEL, o);
  }

  source(s: string): string {
    return labelOf(SOURCE_LABEL, s);
  }

  num = fmtNum;
  dur = fmtMs;
  usd = fmtUsd;
  dt = formatDateTime;
}
