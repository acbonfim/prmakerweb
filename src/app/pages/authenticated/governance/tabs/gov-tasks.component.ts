import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { UsageHBarsComponent } from '../../../../components/usage-charts/usage-charts';
import { GovernanceTaskRow, TASK_SOURCE_LABEL } from '../../../../services/governance/governance.model';
import { SortState, fmtMs, fmtNum, fmtPct, sortRows, toggleSort } from '../../../../services/governance/governance.logic';
import { GovernanceStore } from '../governance.store';

type TaskSort = keyof Pick<GovernanceTaskRow, 'kind' | 'source' | 'count' | 'done' | 'failed' | 'medianMs' | 'p90Ms' | 'users'>;
type SourceFilter = '' | GovernanceTaskRow['source'];

/** Tarefas (0098): etapas, sub-tarefas e pedidos do executor por tipo — quantidade, concluídas, falhas, mediana e p90. */
@Component({
  selector: 'app-gov-tasks',
  standalone: true,
  imports: [MatIconModule, MatProgressSpinnerModule, MatTooltipModule, UsageHBarsComponent],
  template: `
    @if (error()) { <div class="notice">{{ error() }}</div> }

    <section class="panel">
      <div class="panel__head">
        <h2>Por tipo de tarefa</h2>
        <span class="muted">etapas do plano (chave sem número), sub-tarefas e pedidos do executor</span>
        <div class="seg ms-auto" role="radiogroup" aria-label="Origem">
          @for (s of sources; track s.key) {
            <button type="button" class="seg__item" [class.on]="source() === s.key" role="radio" [attr.aria-checked]="source() === s.key"
                    (click)="source.set(s.key)">{{ s.label }}</button>
          }
        </div>
        @if (loading()) { <mat-spinner diameter="18"></mat-spinner> }
      </div>
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th><button class="th-sort" (click)="sortBy('kind')">Tipo {{ mark('kind') }}</button></th>
              <th><button class="th-sort" (click)="sortBy('source')">Origem {{ mark('source') }}</button></th>
              <th class="num"><button class="th-sort" (click)="sortBy('count')">Quantidade {{ mark('count') }}</button></th>
              <th class="num"><button class="th-sort" (click)="sortBy('done')">Concluídas {{ mark('done') }}</button></th>
              <th class="num"><button class="th-sort" (click)="sortBy('failed')">Falhas {{ mark('failed') }}</button></th>
              <th class="num">% falha</th>
              <th class="num"><button class="th-sort" (click)="sortBy('medianMs')" matTooltip="Metade levou até isto">Mediana {{ mark('medianMs') }}</button></th>
              <th class="num"><button class="th-sort" (click)="sortBy('p90Ms')" matTooltip="9 em cada 10 levaram até isto">p90 {{ mark('p90Ms') }}</button></th>
              <th class="num"><button class="th-sort" (click)="sortBy('users')">Pessoas {{ mark('users') }}</button></th>
            </tr>
          </thead>
          <tbody>
            @for (t of sorted(); track t.source + t.kind) {
              <tr>
                <td class="mono">{{ t.kind }}</td>
                <td>{{ sourceLabel[t.source] }}</td>
                <td class="num">{{ num(t.count) }}</td>
                <td class="num">{{ num(t.done) }}</td>
                <td class="num" [class.bad]="t.failed > 0">{{ num(t.failed) }}</td>
                <td class="num">{{ pct(t.failed, t.count) }}</td>
                <td class="num">{{ dur(t.medianMs) }}</td>
                <td class="num">{{ dur(t.p90Ms) }}</td>
                <td class="num">{{ num(t.users) }}</td>
              </tr>
            } @empty {
              <tr><td colspan="9" class="muted">{{ loading() ? 'Carregando…' : 'Nenhuma tarefa no período.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    <div class="charts">
      <section class="panel">
        <div class="panel__head"><h2>Mais demoradas</h2><span class="muted">mediana</span></div>
        <app-usage-hbars [items]="slowest()" [limit]="12"></app-usage-hbars>
      </section>
      <section class="panel">
        <div class="panel__head"><h2>Mais falhas</h2><span class="muted">quantidade</span></div>
        <app-usage-hbars [items]="failing()" [limit]="12" color="#8957e5"></app-usage-hbars>
      </section>
    </div>
  `,
  styleUrls: ['../governance-shared.css'],
})
export class GovTasksComponent {
  readonly store = inject(GovernanceStore);

  readonly rows = signal<GovernanceTaskRow[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly source = signal<SourceFilter>('');
  readonly sort = signal<SortState<TaskSort>>({ key: 'count', dir: -1 });

  readonly sourceLabel = TASK_SOURCE_LABEL;
  readonly sources: { key: SourceFilter; label: string }[] = [
    { key: '', label: 'Todas' }, { key: 'step', label: 'Etapas' }, { key: 'task', label: 'Sub-tarefas' }, { key: 'request', label: 'Executor' },
  ];

  private readonly filtered = computed(() => (this.source() ? this.rows().filter((r) => r.source === this.source()) : this.rows()));
  readonly sorted = computed(() => sortRows(this.filtered(), this.sort()));
  readonly slowest = computed(() => this.filtered().filter((r) => r.medianMs != null).map((r) => ({
    label: `${r.kind} (${TASK_SOURCE_LABEL[r.source].toLowerCase()})`, value: r.medianMs ?? 0, text: `${fmtMs(r.medianMs)} · p90 ${fmtMs(r.p90Ms)}`,
  })));
  readonly failing = computed(() => this.filtered().filter((r) => r.failed > 0).map((r) => ({
    label: `${r.kind} (${TASK_SOURCE_LABEL[r.source].toLowerCase()})`, value: r.failed, text: `${fmtNum(r.failed)} · ${fmtPct(r.failed, r.count)}`,
  })));

  constructor() {
    effect(() => {
      const r = this.store.range();
      untracked(() => this.load(r));
    });
  }

  private load(r: { from: string; to: string }): void {
    this.loading.set(true);
    this.error.set(null);
    this.store.api.tasks(r).subscribe({
      next: (rows) => {
        this.rows.set(rows ?? []);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Não consegui carregar as tarefas.');
      },
    });
  }

  sortBy(k: TaskSort): void {
    this.sort.set(toggleSort(this.sort(), k, ['kind', 'source']));
  }

  mark(k: TaskSort): string {
    const s = this.sort();
    return s.key === k ? (s.dir === 1 ? '▲' : '▼') : '';
  }

  num = fmtNum;
  dur = fmtMs;
  pct = fmtPct;
}
