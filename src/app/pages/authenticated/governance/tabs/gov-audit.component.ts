import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  EVENT_CATEGORIES, EVENT_CATEGORY_LABEL, GovernanceEvent, OUTCOMES, OUTCOME_LABEL, SOURCES, SOURCE_LABEL, labelOf,
} from '../../../../services/governance/governance.model';
import { fmtMs, fmtNum } from '../../../../services/governance/governance.logic';
import { formatDateTime } from '../../../../services/usage/usage.model';
import { GovernanceStore } from '../governance.store';

const PAGE_SIZE = 50;

/** Auditoria (0098): a trilha única, paginada, com filtros; a linha abre o detalhe com todos os campos e as regras. */
@Component({
  selector: 'app-gov-audit',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  template: `
    <div class="filters" role="group" aria-label="Filtros da auditoria">
      <label class="f-field"><span>Pessoa</span>
        <select [ngModel]="user()" (ngModelChange)="user.set($event); load(0)">
          <option value="">Todas</option>
          @for (u of store.userOptions(); track u.id) { <option [value]="u.id">{{ u.name }}</option> }
        </select>
      </label>
      <label class="f-field f-field--card"><span>Card</span>
        <input type="text" inputmode="numeric" placeholder="nº" [ngModel]="card()" (ngModelChange)="card.set($event)"
               (keyup.enter)="load(0)" (blur)="cardChanged()">
      </label>
      <label class="f-field"><span>Origem</span>
        <select [ngModel]="source()" (ngModelChange)="source.set($event); load(0)">
          <option value="">Todas</option>
          @for (s of sources; track s) { <option [value]="s">{{ sourceLabel[s] }}</option> }
        </select>
      </label>
      <label class="f-field"><span>Categoria</span>
        <select [ngModel]="category()" (ngModelChange)="category.set($event); load(0)">
          <option value="">Todas</option>
          @for (c of categories; track c) { <option [value]="c">{{ categoryLabel[c] }}</option> }
        </select>
      </label>
      <label class="f-field"><span>Resultado</span>
        <select [ngModel]="outcome()" (ngModelChange)="outcome.set($event); load(0)">
          <option value="">Todos</option>
          @for (o of outcomes; track o) { <option [value]="o">{{ outcomeLabel[o] }}</option> }
        </select>
      </label>
      <label class="f-field"><span>Ação</span>
        <input type="text" placeholder="ex.: mcp:prmake_advance" [ngModel]="action()" (ngModelChange)="action.set($event)" (keyup.enter)="load(0)"
               (blur)="load(0)" data-usage-ignore>
      </label>
      <label class="f-field f-field--grow"><span>Texto</span>
        <input type="search" placeholder="Busca no detalhe, ação, pessoa, regra (Enter)" [ngModel]="search()" (ngModelChange)="search.set($event)"
               (keyup.enter)="load(0)" (search)="load(0)" data-usage-ignore>
      </label>
      @if (hasFilters()) {
        <button mat-button type="button" (click)="clear()"><mat-icon>filter_alt_off</mat-icon> Limpar</button>
      }
    </div>

    @if (error()) { <div class="notice">{{ error() }}</div> }

    <section class="panel">
      <div class="panel__head">
        <h2>Trilha de auditoria</h2>
        <span class="muted">mais recentes primeiro · clique para ver o detalhe</span>
        <span class="ms-auto muted">{{ num(total()) }} eventos</span>
        @if (loading()) { <mat-spinner diameter="18"></mat-spinner> }
      </div>
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>Quando</th><th class="num">Duração</th><th>Pessoa</th><th>Origem</th><th>Ação</th><th>Categoria</th>
              <th>Card</th><th>Item · sub</th><th>Resultado</th><th>Regras</th><th>Detalhe</th>
            </tr>
          </thead>
          <tbody>
            @for (e of rows(); track e.id) {
              <tr class="clickable" (click)="store.showEvent(e)">
                <td>{{ dt(e.startedAt) }}</td>
                <td class="num">{{ dur(e.durationMs) }}</td>
                <td>{{ e.userName || '—' }}</td>
                <td>{{ label(sourceLabel, e.source) }}</td>
                <td class="ellipsis mono" [title]="e.action">{{ e.action }}</td>
                <td>{{ label(categoryLabel, e.category) }}</td>
                <td class="mono">{{ e.cardNumber ?? '' }}</td>
                <td class="mono">{{ e.workItemNumber != null ? '#' + e.workItemNumber : '' }}{{ e.taskNumber != null ? ' · ' + e.taskNumber : '' }}</td>
                <td><span class="badge badge--{{ e.outcome }}">{{ label(outcomeLabel, e.outcome) }}</span></td>
                <td class="ellipsis" [title]="ruleNames(e)">{{ ruleNames(e) }}</td>
                <td class="ellipsis" [title]="e.detail || ''">{{ e.detail || '' }}</td>
              </tr>
            } @empty {
              <tr><td colspan="11" class="muted">{{ loading() ? 'Carregando…' : 'Nenhum evento com estes filtros.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
      @if (pageCount() > 1) {
        <div class="pager">
          <button mat-icon-button (click)="go(-1)" [disabled]="page() === 0" aria-label="Página anterior"><mat-icon>chevron_left</mat-icon></button>
          <span>{{ page() + 1 }} / {{ pageCount() }}</span>
          <button mat-icon-button (click)="go(1)" [disabled]="page() + 1 >= pageCount()" aria-label="Próxima página"><mat-icon>chevron_right</mat-icon></button>
        </div>
      }
    </section>
  `,
  styleUrls: ['../governance-shared.css'],
  styles: [`
    .f-field--card input { min-width: 0; width: 90px; }
    .f-field--grow { flex: 1 1 220px; }
    .f-field--grow input { width: 100%; }
  `],
})
export class GovAuditComponent {
  readonly store = inject(GovernanceStore);

  readonly user = signal('');
  readonly card = signal('');
  readonly source = signal('');
  readonly category = signal('');
  readonly outcome = signal('');
  readonly action = signal('');
  readonly search = signal('');

  readonly rows = signal<GovernanceEvent[]>([]);
  readonly total = signal(0);
  readonly page = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));
  readonly hasFilters = computed(() => !!(this.user() || this.card() || this.source() || this.category() || this.outcome() || this.action() || this.search()));

  readonly sources = SOURCES;
  readonly sourceLabel = SOURCE_LABEL;
  readonly categories = EVENT_CATEGORIES;
  readonly categoryLabel = EVENT_CATEGORY_LABEL;
  readonly outcomes = OUTCOMES;
  readonly outcomeLabel = OUTCOME_LABEL;

  private lastCard = '';

  constructor() {
    // Filtro vindo de outra aba ("ver na auditoria").
    const preset = this.store.auditPreset();
    if (preset) {
      this.user.set(preset.user ?? '');
      this.card.set(preset.card != null ? `${preset.card}` : '');
      this.outcome.set(preset.outcome ?? '');
      this.action.set(preset.action ?? '');
      this.store.auditPreset.set(null);
    }
    this.lastCard = this.card();
    this.store.ensureRules();
    if (!this.store.userOptions().length) {
      this.store.api.users(this.store.range()).subscribe({ next: (u) => this.store.mergeUsers(u ?? []), error: () => undefined });
    }
    effect(() => {
      this.store.range();
      untracked(() => this.load(0));
    });
  }

  load(page: number): void {
    this.page.set(page);
    this.loading.set(true);
    this.error.set(null);
    const card = this.card().trim();
    this.lastCard = card;
    this.store.api.events({
      ...this.store.range(),
      user: this.user() || null, card: /^\d+$/.test(card) ? card : null, source: this.source() || null, category: this.category() || null,
      outcome: this.outcome() || null, action: this.action().trim() || null, search: this.search().trim() || null, page, size: PAGE_SIZE,
    }).subscribe({
      next: (r) => {
        this.rows.set(r.items ?? []);
        this.total.set(r.total ?? 0);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Não consegui carregar a trilha de auditoria.');
      },
    });
  }

  cardChanged(): void {
    if (this.card().trim() !== this.lastCard) this.load(0);
  }

  go(delta: number): void {
    const next = Math.min(this.pageCount() - 1, Math.max(0, this.page() + delta));
    if (next !== this.page()) this.load(next);
  }

  clear(): void {
    for (const s of [this.user, this.card, this.source, this.category, this.outcome, this.action, this.search]) s.set('');
    this.load(0);
  }

  ruleNames(e: GovernanceEvent): string {
    return e.rules.map((k) => this.store.ruleName(k)).join(', ');
  }

  label(map: Record<string, string>, k: string | null): string {
    return labelOf(map, k);
  }

  num = fmtNum;
  dur = fmtMs;
  dt = formatDateTime;
}
