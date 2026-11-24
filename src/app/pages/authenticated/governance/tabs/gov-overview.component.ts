import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BarDatum, BarSeries, UsageBarsComponent, UsageHBarsComponent } from '../../../../components/usage-charts/usage-charts';
import { GovernanceOverview, SOURCE_LABEL, labelOf } from '../../../../services/governance/governance.model';
import { dayKeys, fmtMs, fmtNum, fmtUsd, perDayStack, shortDay } from '../../../../services/governance/governance.logic';
import { GovernanceStore } from '../governance.store';

/** Cores por resultado (sempre com legenda): ok azul, avisado âmbar, barrado vermelho, erro roxo. */
export const OUTCOME_SERIES: BarSeries[] = [
  { name: 'Ok', color: '#3987e5' },
  { name: 'Avisado', color: '#c69026' },
  { name: 'Barrado', color: '#d03b3b' },
  { name: 'Erro', color: '#8957e5' },
];

/** Visão geral da governança (0098): indicadores, eventos por dia por resultado, por origem, top ações e regras. */
@Component({
  selector: 'app-gov-overview',
  standalone: true,
  imports: [MatIconModule, MatProgressSpinnerModule, MatTooltipModule, UsageBarsComponent, UsageHBarsComponent],
  templateUrl: './gov-overview.component.html',
  styleUrls: ['../governance-shared.css'],
})
export class GovOverviewComponent {
  readonly store = inject(GovernanceStore);

  readonly data = signal<GovernanceOverview | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly kpis = computed(() => this.data()?.kpis ?? null);
  readonly series = OUTCOME_SERIES;

  readonly perDay = computed<BarDatum[]>(() => {
    const { from, to } = this.store.rangeDates();
    return perDayStack(this.data()?.perDay ?? [], dayKeys(from, to)).map((d) => ({
      label: shortDay(d.day),
      title: new Date(`${d.day}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' }),
      values: d.values,
    }));
  });

  readonly bySource = computed(() => (this.data()?.bySource ?? []).map((s) => ({ label: labelOf(SOURCE_LABEL, s.key), value: s.count })));
  readonly topActions = computed(() => (this.data()?.topActions ?? []).map((a) => ({
    label: a.key, value: a.count, text: `${fmtNum(a.count)} · ${fmtMs(a.medianMs)}`, tip: `${fmtNum(a.count)} vezes · mediana ${fmtMs(a.medianMs)}`,
  })));
  readonly topRules = computed(() => (this.data()?.topRules ?? []).map((r) => ({
    label: r.name || r.key, value: r.count, text: `${fmtNum(r.count)} · ${fmtNum(r.blocked)} barradas`,
    tip: `${r.key}: casou ${fmtNum(r.count)} vezes, barrou ${fmtNum(r.blocked)}`,
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
    this.store.api.overview(r).subscribe({
      next: (o) => {
        this.data.set(o);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Não consegui carregar a visão geral da governança.');
      },
    });
  }

  auditOutcome(outcome: string): void {
    this.store.openAudit({ outcome });
  }

  num = fmtNum;
  dur = fmtMs;
  usd = fmtUsd;
}
