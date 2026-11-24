import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { UsageHBarsComponent } from '../../../../components/usage-charts/usage-charts';
import {
  EFFECT_LABEL, GovernanceEvent, OUTCOME_LABEL, STANDARD_STATUS_LABEL, labelOf,
} from '../../../../services/governance/governance.model';
import { fmtNum } from '../../../../services/governance/governance.logic';
import { standardAdherence } from '../../../../services/governance/standards.logic';
import { formatDateTime } from '../../../../services/usage/usage.model';
import { GovernanceStore } from '../governance.store';

/** Quantos achados a aderência lê da trilha por período (os mais recentes). */
const TAKE = 1000;

/**
 * Aderência aos padrões (0101): a partir da trilha (`GET events?category=standard`) — achados por padrão, por
 * repositório e por card, os últimos achados e atalhos para a Auditoria filtrada. Usa o período da governança.
 */
@Component({
  selector: 'app-gov-standards-adherence',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, UsageHBarsComponent],
  template: `
    @if (error()) { <div class="notice">{{ error() }}</div> }
    @if (truncated()) {
      <div class="notice notice--warn">O período tem {{ num(total()) }} achados; a aderência considera os {{ num(events().length) }} mais recentes. Encurte o período para ver tudo.</div>
    }

    <div class="panel__head">
      <h2>Aderência aos padrões</h2>
      <span class="muted">achados da trilha no período · com o modo "Monitorando", nada é barrado: os achados aparecem como "teria barrado/avisado"</span>
      @if (loading()) { <mat-spinner diameter="18"></mat-spinner> }
      <span class="ms-auto"></span>
      <button mat-stroked-button type="button" (click)="auditAll()"><mat-icon>manage_search</mat-icon> Ver na auditoria</button>
    </div>

    <div class="tiles">
      <div class="tile"><span class="tile__label">Achados</span><span class="tile__value">{{ num(view().total) }}</span></div>
      <button type="button" class="tile tile--btn" [class.tile--bad]="view().blocked > 0" (click)="auditOutcome('blocked')">
        <span class="tile__label">Barrados</span><span class="tile__value">{{ num(view().blocked) }}</span></button>
      <button type="button" class="tile tile--btn" [class.tile--warn]="view().warned > 0" (click)="auditOutcome('warned')">
        <span class="tile__label">Avisados</span><span class="tile__value">{{ num(view().warned) }}</span></button>
      <button type="button" class="tile tile--btn" (click)="auditOutcome('monitored')" matTooltip="Achados que barrariam/avisariam com o modo Aplicando ou efeito maior">
        <span class="tile__label">Só monitorados</span><span class="tile__value">{{ num(view().monitored) }}</span></button>
      <div class="tile"><span class="tile__label">Padrões com achado</span><span class="tile__value">{{ num(view().byStandard.length) }}</span>
        <span class="tile__sub">de {{ num(store.standards()?.length ?? 0) }}</span></div>
      <div class="tile"><span class="tile__label">Repositórios</span><span class="tile__value">{{ num(view().repositories) }}</span></div>
      <div class="tile"><span class="tile__label">Cards</span><span class="tile__value">{{ num(view().cards) }}</span></div>
    </div>

    <div class="charts">
      <section class="panel">
        <div class="panel__head"><h2>Por padrão</h2><span class="muted">achados</span></div>
        <app-usage-hbars [items]="byStandardBars()" color="#d29922" [limit]="12"></app-usage-hbars>
      </section>
      <section class="panel">
        <div class="panel__head"><h2>Por repositório</h2><span class="muted">achados</span></div>
        <app-usage-hbars [items]="byRepoBars()" [limit]="12"></app-usage-hbars>
      </section>
    </div>

    <section class="panel">
      <div class="panel__head"><h2>Por padrão</h2><span class="muted">clique para abrir o padrão · suba o efeito dos que não deveriam aparecer</span></div>
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr><th>Padrão</th><th>Título</th><th>Estado</th><th>Efeito</th><th class="num">Achados</th><th class="num">Barrados</th>
            <th class="num">Avisados</th><th class="num">Cards</th><th class="num">Repos</th><th>Último</th><th></th></tr></thead>
          <tbody>
            @for (r of view().byStandard; track r.key) {
              <tr class="clickable" (click)="store.openStandards('catalogo', r.key)">
                <td><span class="code">{{ r.code }}</span></td>
                <td class="ellipsis" [title]="r.title">{{ r.title }}</td>
                <td>{{ r.status ? statusLabel[r.status] : '—' }}</td>
                <td>@if (r.effect) { <span class="badge badge--{{ r.effect }}">{{ effectLabel[r.effect] }}</span> } @else { — }</td>
                <td class="num">{{ num(r.count) }}</td>
                <td class="num" [class.bad]="r.blocked > 0">{{ num(r.blocked) }}</td>
                <td class="num" [class.warn]="r.warned > 0">{{ num(r.warned) }}</td>
                <td class="num">{{ num(r.cards) }}</td>
                <td class="num">{{ num(r.repositories) }}</td>
                <td>{{ dt(r.lastAt) }}</td>
                <td><button mat-icon-button type="button" (click)="$event.stopPropagation(); auditStandard(r.key)" matTooltip="Achados deste padrão na auditoria"
                            aria-label="Ver na auditoria"><mat-icon>manage_search</mat-icon></button></td>
              </tr>
            } @empty {
              <tr><td colspan="11" class="muted">{{ loading() ? 'Carregando…' : 'Nenhum achado no período.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    <div class="charts">
      <section class="panel">
        <div class="panel__head"><h2>Por repositório</h2></div>
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th>Repositório</th><th class="num">Achados</th><th class="num">Barrados</th><th>Padrões</th><th>Último</th></tr></thead>
            <tbody>
              @for (r of view().byRepository; track r.key) {
                <tr>
                  <td class="mono">{{ r.key === '—' ? '(sem repositório no evento)' : r.key }}</td>
                  <td class="num">{{ num(r.count) }}</td>
                  <td class="num" [class.bad]="r.blocked > 0">{{ num(r.blocked) }}</td>
                  <td class="ellipsis mono" [title]="r.standards.join(', ')">{{ r.standards.join(', ') }}</td>
                  <td>{{ dt(r.lastAt) }}</td>
                </tr>
              } @empty { <tr><td colspan="5" class="muted">—</td></tr> }
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <div class="panel__head"><h2>Por card</h2><span class="muted">clique para ver o card</span></div>
        <div class="table-wrap">
          <table class="tbl">
            <thead><tr><th>Card</th><th class="num">Achados</th><th class="num">Barrados</th><th>Padrões</th><th>Último</th><th></th></tr></thead>
            <tbody>
              @for (r of view().byCard; track r.card) {
                <tr class="clickable" (click)="store.openCard(r.card)">
                  <td class="mono">{{ r.card }}</td>
                  <td class="num">{{ num(r.count) }}</td>
                  <td class="num" [class.bad]="r.blocked > 0">{{ num(r.blocked) }}</td>
                  <td class="ellipsis mono" [title]="r.standards.join(', ')">{{ r.standards.join(', ') }}</td>
                  <td>{{ dt(r.lastAt) }}</td>
                  <td><button mat-icon-button type="button" (click)="$event.stopPropagation(); auditCard(r.card)" matTooltip="Achados deste card na auditoria"
                              aria-label="Ver na auditoria"><mat-icon>manage_search</mat-icon></button></td>
                </tr>
              } @empty { <tr><td colspan="6" class="muted">—</td></tr> }
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <section class="panel">
      <div class="panel__head"><h2>Últimos achados</h2><span class="muted">clique para ver o detalhe</span></div>
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr><th>Quando</th><th>Pessoa</th><th>Card</th><th>Ação</th><th>Padrões</th><th>Resultado</th><th>Detalhe</th></tr></thead>
          <tbody>
            @for (e of view().recent; track e.id) {
              <tr class="clickable" (click)="store.showEvent(e)">
                <td>{{ dt(e.startedAt) }}</td>
                <td>{{ e.userName || '—' }}</td>
                <td class="mono">{{ e.cardNumber ?? '' }}</td>
                <td class="ellipsis mono" [title]="e.action">{{ e.action }}</td>
                <td class="mono">{{ codes(e) }}</td>
                <td><span class="badge badge--{{ e.outcome }}">{{ outcome(e.outcome) }}</span></td>
                <td class="ellipsis" [title]="e.detail || ''">{{ e.detail || '' }}</td>
              </tr>
            } @empty { <tr><td colspan="7" class="muted">{{ loading() ? 'Carregando…' : 'Nenhum achado no período.' }}</td></tr> }
          </tbody>
        </table>
      </div>
    </section>
  `,
  styleUrls: ['../governance-shared.css', './gov-standards.css'],
})
export class GovStandardsAdherenceComponent {
  readonly store = inject(GovernanceStore);

  readonly events = signal<GovernanceEvent[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly truncated = computed(() => this.total() > this.events().length);

  readonly view = computed(() => standardAdherence(this.events(), this.store.standards() ?? []));
  readonly byStandardBars = computed(() => this.view().byStandard.map((r) => ({
    label: `${r.code} · ${r.title}`, value: r.count, text: `${fmtNum(r.count)}${r.blocked ? ` · ${fmtNum(r.blocked)} barrados` : ''}`,
    tip: `${r.code}: ${fmtNum(r.count)} achado(s) em ${fmtNum(r.cards)} card(s)`,
  })));
  readonly byRepoBars = computed(() => this.view().byRepository.map((r) => ({
    label: r.key === '—' ? '(sem repositório)' : r.key, value: r.count, tip: `${r.standards.join(', ')}`,
  })));

  readonly statusLabel = STANDARD_STATUS_LABEL;
  readonly effectLabel = EFFECT_LABEL;

  constructor() {
    this.store.ensureStandards();
    effect(() => {
      const r = this.store.range();
      untracked(() => this.load(r));
    });
  }

  private load(r: { from: string; to: string }): void {
    this.loading.set(true);
    this.error.set(null);
    this.store.api.events({ ...r, category: 'standard', page: 0, size: TAKE }).subscribe({
      next: (p) => {
        this.events.set(p.items ?? []);
        this.total.set(p.total ?? 0);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Não consegui carregar os achados dos padrões.');
      },
    });
  }

  auditAll(): void {
    this.store.openAudit({ category: 'standard' });
  }

  auditOutcome(outcome: string): void {
    this.store.openAudit({ category: 'standard', outcome });
  }

  auditStandard(key: string): void {
    this.store.openAudit({ category: 'standard', search: key });
  }

  auditCard(card: number): void {
    this.store.openAudit({ category: 'standard', card });
  }

  codes(e: GovernanceEvent): string {
    return e.rules.map((k) => this.store.findStandard(k)?.code ?? k).join(', ');
  }

  outcome(o: string): string {
    return labelOf(OUTCOME_LABEL, o);
  }

  num = fmtNum;
  dt = formatDateTime;
}
