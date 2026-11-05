import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CardAssistantService, formatHours } from '../../services/card-assistant.service';
import { BugHoursInsight, UsHoursInsight, bugInsight, hasNoEstimate, parseHoursSetting, pickAverage, usInsight } from './hours-insight';

/** Médias do time no Skills Configurations (0078/0085). */
interface TeamAverages {
  bug: number | null;
  userStory: number | null;
  general: number | null;
}

/** `GET Skills/config` uma vez por sessão (as médias mudam raramente; falha → sem médias). */
let averagesLoad: Promise<TeamAverages> | null = null;
function loadAverages(http: HttpClient): Promise<TeamAverages> {
  averagesLoad ??= firstValueFrom(http.get<any>(`${environment.apiUrl}Skills/config`))
    .then(res => {
      const s = res?.settings ?? {};
      return {
        bug: parseHoursSetting(s.AssistantAverageHoursBug),
        userStory: parseHoursSetting(s.AssistantAverageHoursUserStory),
        general: parseHoursSetting(s.AssistantAverageHours),
      };
    })
    .catch(() => {
      averagesLoad = null; // tenta de novo na próxima vez
      return { bug: null, userStory: null, general: null };
    });
  return averagesLoad;
}

/**
 * "Horas do card" da Bancada (feature 0085), para a coluna lateral. Lê as horas do DevOps pelo
 * `CardAssistantService` (`GET Azure/card/{n}/effort`, cache e tempo real das sugestões de horas) e as médias do
 * `GET Skills/config` (`AssistantAverageHoursBug` / `AssistantAverageHoursUserStory`, reserva `AssistantAverageHours`).
 *
 * - **Bug**: barra do Completed com a marca da média dos bugs (faixas ok / atenção até +50% / alerta) e o texto
 *   "Completed 5h · média de bugs 3h · 2h acima da média".
 * - **User Story**: planejado × realizado — barra empilhada Completed + Remaining contra a marca do Original
 *   (estouro hachurado), % consumido, projeção (estouro/folga) e a média das US só como referência.
 *
 * Só leitura; sem estimativa mostra um texto curto. Tooltips só explicam (os números ficam sempre na tela).
 */
@Component({
  selector: 'app-card-hours-insight',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule],
  template: `
    @let st = state();
    <section class="hi" aria-label="Horas do card">
      <header class="hi__head">
        <mat-icon class="hi__icon" aria-hidden="true">schedule</mat-icon>
        <span class="hi__title">Horas do card</span>
        @if (isUs()) { <span class="hi__kind">planejado × realizado</span> }
        @else { <span class="hi__kind">× média dos bugs</span> }
        <span class="hi__spacer"></span>
        @if (st?.status === 'loading' && st?.effort) { <span class="hi__sync" role="status" aria-label="Atualizando as horas"></span> }
        @if (card()) {
          <button type="button" class="hi__icon-btn" (click)="reload()" [disabled]="st?.status === 'loading'"
                  matTooltip="Buscar as horas no DevOps de novo" aria-label="Atualizar as horas">
            <mat-icon>refresh</mat-icon>
          </button>
        }
      </header>

      @if (!card()) {
        <p class="hi__muted">Busque um card para ver as horas.</p>
      } @else if (!st || (st.status === 'loading' && !st.effort)) {
        <div class="hi__skeleton" aria-busy="true" aria-label="Carregando as horas">
          <span class="cime-skeleton hi__sk-bar"></span>
          <span class="cime-skeleton hi__sk-line"></span>
        </div>
      } @else if (st?.status === 'error') {
        <p class="hi__muted hi__muted--warn">Horas indisponíveis — {{ unavailableReason() }}
          <button type="button" class="hi__link" (click)="reload()">Tentar de novo</button></p>
      } @else if (noEstimate()) {
        <p class="hi__muted">Sem estimativa no DevOps (Original, Completed e Remaining vazios).</p>
      } @else if (isUs()) {
        @if (us(); as u) {
          <!-- Barra empilhada: Completed + Remaining contra a marca do Original; o que passa do Original fica hachurado -->
          <div class="hi__bar hi__bar--us" role="img"
               [attr.aria-label]="'Completed ' + h(u.completed) + ' mais Remaining ' + h(u.remaining) + (u.hasPlan ? ' contra Original ' + h(u.original) : '')">
            <span class="hi__seg hi__seg--done" [style.width.%]="u.completedPct"></span>
            <span class="hi__seg hi__seg--left" [style.left.%]="u.completedPct" [style.width.%]="u.remainingPct"></span>
            @if (u.originalPct !== null && u.projection === 'overrun') {
              <span class="hi__over" [style.left.%]="u.originalPct"></span>
            }
            @if (u.originalPct !== null) {
              <span class="hi__mark hi__mark--plan" [style.left.%]="u.originalPct"
                    matTooltip="Marca: Original Estimate (o planejado)"></span>
            }
          </div>
          <div class="hi__legend" aria-hidden="true">
            <span><i class="hi__dot hi__dot--done"></i>Completed</span>
            <span><i class="hi__dot hi__dot--left"></i>Remaining</span>
            @if (u.hasPlan) { <span><i class="hi__tick"></i>Original</span> }
          </div>

          <div class="hi__facts">
            <span>Planejado <strong>{{ u.hasPlan ? h(u.original) : '—' }}</strong></span>
            <span>Realizado <strong>{{ h(u.completed) }}</strong>@if (u.consumedPct !== null) { <em [class]="'hi__pct hi--' + (u.completedOverPlan ? 'bad' : 'muted')">{{ u.consumedPct }}%</em> }</span>
            <span>Restante <strong>{{ h(u.remaining) }}</strong></span>
          </div>
          <p class="hi__verdict">
            Projeção <strong>{{ h(u.projected) }}</strong>
            @if (u.projection === 'overrun') {
              → <strong [class]="'hi--' + u.tone">estouro de {{ h(u.projectionDelta) }}</strong>
            } @else if (u.projection === 'slack') {
              → <strong [class]="'hi--' + u.tone">folga de {{ h(abs(u.projectionDelta)) }}</strong>
            } @else if (u.projection === 'on-plan') {
              → <strong class="hi--ok">no planejado</strong>
            } @else {
              <span class="hi__muted-inline">· sem Original Estimate (sem plano para comparar)</span>
            }
          </p>
          @if (u.completedOverPlan) {
            <p class="hi__note hi--bad">O Completed já passou do Original em {{ h(u.completed - u.original) }}.</p>
          }
          @if (u.average !== null) {
            <p class="hi__ref" [matTooltip]="averageTip()">
              Referência: média de US {{ h(u.average) }}
              @if (u.averageDelta !== null && u.averageDelta !== 0) {
                · projeção {{ h(abs(u.averageDelta)) }} {{ u.averageDelta > 0 ? 'acima' : 'abaixo' }}
              } @else { · projeção na média }
            </p>
          }
        }
      } @else {
        @if (bug(); as b) {
          <!-- Barra do Completed com as faixas da média: ok até a média, atenção até +50%, alerta acima -->
          <div class="hi__bar" role="img"
               [attr.aria-label]="'Completed ' + h(b.completed) + (b.average !== null ? ' com média dos bugs ' + h(b.average) : '')">
            @if (b.averagePct !== null && b.warnPct !== null) {
              <span class="hi__zone hi__zone--ok" [style.width.%]="b.averagePct"></span>
              <span class="hi__zone hi__zone--warn" [style.left.%]="b.averagePct" [style.width.%]="b.warnPct - b.averagePct"></span>
              <span class="hi__zone hi__zone--bad" [style.left.%]="b.warnPct" [style.width.%]="100 - b.warnPct"></span>
            }
            <span [class]="'hi__fill hi__fill--' + b.tone" [style.width.%]="b.completedPct"></span>
            @if (b.averagePct !== null) {
              <span class="hi__mark" [style.left.%]="b.averagePct" [matTooltip]="averageTip()"></span>
            }
          </div>
          <p class="hi__verdict">
            Completed <strong>{{ h(b.completed) }}</strong>
            @if (b.average !== null) {
              · média de bugs {{ h(b.average) }} ·
              @if (b.position === 'above') {
                <strong [class]="'hi--' + b.tone">{{ h(b.delta) }} acima</strong> da média
                <span class="hi__muted-inline">(+{{ (b.ratioPct ?? 100) - 100 }}%)</span>
              } @else if (b.position === 'below') {
                <strong class="hi--ok">{{ h(abs(b.delta)) }} abaixo</strong> da média
              } @else {
                <strong class="hi--ok">na média</strong>
              }
            } @else {
              <span class="hi__muted-inline">· média de bugs não configurada</span>
            }
          </p>
          <div class="hi__facts hi__facts--minor">
            <span>Original <strong>{{ b.original ? h(b.original) : '—' }}</strong></span>
            <span>Remaining <strong>{{ h(b.remaining) }}</strong></span>
          </div>
        }
      }
    </section>
  `,
  styles: [`
    :host { display: block; min-width: 0; font-size: 12.5px; color: var(--cc-text-1, var(--mat-sys-on-surface)); }
    .hi { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .hi__head { display: flex; align-items: center; gap: 6px; min-height: 24px; }
    .hi__icon { flex: none; font-size: 16px; width: 16px; height: 16px; color: var(--cc-text-3); }
    .hi__title { font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--cc-text-2); }
    .hi__kind { font-size: 11px; color: var(--cc-text-3); }
    .hi__spacer { flex: 1 1 auto; }
    .hi__icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0;
      border: 0; border-radius: 6px; background: none; color: var(--cc-text-3); cursor: pointer; }
    .hi__icon-btn:hover:not(:disabled) { background: var(--cc-surface-2); color: var(--cc-text-1); }
    .hi__icon-btn:disabled { opacity: .45; cursor: default; }
    .hi__icon-btn .mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .hi__sync { width: 10px; height: 10px; border-radius: 50%; border: 2px solid color-mix(in srgb, #58a6ff 70%, transparent);
      border-right-color: transparent; animation: hi-spin .8s linear infinite; }
    @keyframes hi-spin { to { transform: rotate(360deg); } }

    .hi__muted { margin: 0; color: var(--cc-text-2); }
    .hi__muted--warn { color: color-mix(in srgb, #d29922 75%, white); }
    .hi__muted-inline { color: var(--cc-text-3); }
    .hi__link { padding: 0 2px; border: 0; background: none; color: var(--mat-sys-primary); font: inherit; cursor: pointer; }
    .hi__link:hover { text-decoration: underline; }

    .hi__skeleton { display: flex; flex-direction: column; gap: 6px; }
    .hi__sk-bar { display: block; height: 8px; border-radius: 999px; }
    .hi__sk-line { display: block; height: 12px; width: 70%; border-radius: 6px; }

    /* Barra */
    .hi__bar { position: relative; height: 8px; border-radius: 999px; background: rgba(255, 255, 255, .07); overflow: visible; margin-top: 2px; }
    .hi__zone { position: absolute; top: 0; bottom: 0; }
    .hi__zone--ok { left: 0; border-radius: 999px 0 0 999px; background: color-mix(in srgb, #3fb950 12%, transparent); }
    .hi__zone--warn { background: color-mix(in srgb, #d29922 13%, transparent); }
    .hi__zone--bad { border-radius: 0 999px 999px 0; background: color-mix(in srgb, #f85149 12%, transparent); }
    .hi__fill { position: absolute; inset: 0 auto 0 0; border-radius: 999px; transition: width .3s ease; }
    .hi__fill--ok { background: color-mix(in srgb, #3fb950 80%, transparent); }
    .hi__fill--neutral { background: color-mix(in srgb, #58a6ff 75%, transparent); }
    .hi__fill--warn { background: color-mix(in srgb, #d29922 85%, transparent); }
    .hi__fill--bad { background: color-mix(in srgb, #f85149 80%, transparent); }
    .hi__mark { position: absolute; top: -4px; width: 2px; height: 16px; margin-left: -1px; border-radius: 1px; background: #79c0ff; cursor: help; }
    .hi__mark--plan { background: var(--cc-text-1); }
    .hi__seg { position: absolute; top: 0; bottom: 0; transition: width .3s ease, left .3s ease; }
    .hi__seg--done { left: 0; border-radius: 999px 0 0 999px; background: color-mix(in srgb, #58a6ff 80%, transparent); }
    .hi__seg--left { border-radius: 0 999px 999px 0;
      background: repeating-linear-gradient(135deg, color-mix(in srgb, #58a6ff 34%, transparent) 0 4px, color-mix(in srgb, #58a6ff 18%, transparent) 4px 8px); }
    .hi__over { position: absolute; top: -2px; bottom: -2px; right: 0; border-radius: 0 999px 999px 0;
      border: 1px solid color-mix(in srgb, #f85149 60%, transparent); background: color-mix(in srgb, #f85149 16%, transparent); pointer-events: none; }

    .hi__legend { display: flex; flex-wrap: wrap; gap: 2px 12px; font-size: 11px; color: var(--cc-text-3); }
    .hi__legend > span { display: inline-flex; align-items: center; gap: 5px; }
    .hi__dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; }
    .hi__dot--done { background: color-mix(in srgb, #58a6ff 80%, transparent); }
    .hi__dot--left { background: color-mix(in srgb, #58a6ff 30%, transparent); }
    .hi__tick { display: inline-block; width: 2px; height: 10px; border-radius: 1px; background: var(--cc-text-1); }

    .hi__facts { display: flex; flex-wrap: wrap; gap: 0 10px; color: var(--cc-text-2); }
    .hi__facts > span + span::before { content: '·'; margin-right: 10px; opacity: .6; }
    .hi__facts strong, .hi__verdict strong { color: var(--cc-text-1); font-weight: 600; font-variant-numeric: tabular-nums; }
    .hi__facts--minor { font-size: 11.5px; color: var(--cc-text-3); }
    .hi__pct { margin-left: 4px; font-style: normal; font-size: 11px; font-variant-numeric: tabular-nums; }
    .hi__verdict { margin: 0; color: var(--cc-text-2); line-height: 1.45; }
    .hi__note { margin: 0; font-size: 11.5px; }
    .hi__ref { margin: 0; font-size: 11.5px; color: var(--cc-text-3); width: fit-content; cursor: help; }

    /* Tons discretos */
    .hi__verdict strong.hi--ok, .hi--ok { color: color-mix(in srgb, #3fb950 80%, white); }
    .hi__verdict strong.hi--warn, .hi--warn { color: color-mix(in srgb, #d29922 82%, white); }
    .hi__verdict strong.hi--bad, .hi--bad { color: color-mix(in srgb, #f85149 78%, white); }
    .hi__verdict strong.hi--neutral { color: var(--cc-text-1); }
    .hi--muted { color: var(--cc-text-3); }

    @media (prefers-reduced-motion: reduce) { .hi__sync { animation: none; } .hi__fill, .hi__seg { transition: none; } }
  `],
})
export class CardHoursInsightComponent {
  /** Número do card (null = nenhum card na Bancada). */
  readonly card = input<string | number | null | undefined>(null);
  /** Tipo do card: Bug compara com a média; User Story compara planejado × realizado. */
  readonly cardType = input<'bug' | 'user-story' | string | null | undefined>('bug');

  private svc = inject(CardAssistantService);
  private http = inject(HttpClient);

  readonly cardKey = computed(() => {
    const c = this.card();
    return c === null || c === undefined ? '' : `${c}`.trim();
  });
  readonly isUs = computed(() => this.cardType() === 'user-story');
  readonly state = computed(() => (this.cardKey() ? this.svc.effortOf(this.cardKey())() : null));
  readonly noEstimate = computed(() => {
    const st = this.state();
    return st?.status === 'ready' && hasNoEstimate(st.effort);
  });

  private readonly averages = signal<TeamAverages | null>(null);
  /** Média usada: a do tipo; na falta, a geral do time. */
  readonly average = computed(() => {
    const a = this.averages();
    if (!a) return null;
    return pickAverage(this.isUs() ? a.userStory : a.bug, a.general);
  });
  /** A média em uso é a geral (o tipo não tem a sua configurada). */
  readonly averageIsGeneral = computed(() => {
    const a = this.averages();
    return !!a && !(this.isUs() ? a.userStory : a.bug) && !!a.general;
  });

  readonly bug = computed<BugHoursInsight | null>(() => bugInsight(this.state()?.effort, this.average()));
  readonly us = computed<UsHoursInsight | null>(() => usInsight(this.state()?.effort, this.average()));

  readonly averageTip = computed(() => {
    const kind = this.isUs() ? 'User Story' : 'bug';
    return this.averageIsGeneral()
      ? `Média geral de horas por card do time (Skills Configurations → AssistantAverageHours) — o ${kind} não tem média própria configurada.`
      : `Média de horas por ${kind} do time (Skills Configurations → ${this.isUs() ? 'AssistantAverageHoursUserStory' : 'AssistantAverageHoursBug'}).`;
  });

  readonly unavailableReason = computed(() => {
    const st = this.state();
    const msg = (st?.error ?? '').trim();
    if (!msg || /integra|configur|token|\bpat\b|credencia|não respondeu|unauthor|401|403/i.test(msg) || (st?.httpStatus ?? 0) === 0) {
      return 'sem integração do DevOps';
    }
    return msg.length > 80 ? msg.slice(0, 77) + '…' : msg;
  });

  private watched = '';

  constructor() {
    void loadAverages(this.http).then(a => this.averages.set(a));

    // Card novo: busca as horas (o serviço guarda por card) e passa a ouvir o tempo real das sugestões de horas.
    effect(() => {
      const card = this.cardKey();
      untracked(() => {
        if (card === this.watched) return;
        if (this.watched) this.svc.unwatch(this.watched);
        this.watched = card;
        if (!card) return;
        this.svc.watch(card);
        const current = this.svc.effortOf(card)();
        if (!current || current.status === 'error') void this.svc.loadEffort(card).catch(() => undefined);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.watched) this.svc.unwatch(this.watched);
    });
  }

  h(v: number | null | undefined): string {
    return formatHours(v);
  }

  abs(v: number | null | undefined): number {
    return Math.abs(v ?? 0);
  }

  reload(): void {
    const card = this.cardKey();
    if (card) void this.svc.loadEffort(card).catch(() => undefined);
  }
}
