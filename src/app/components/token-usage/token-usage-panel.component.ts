import { Component, computed, inject, input } from '@angular/core';
import { formatTokens, formatUsd } from '../../services/ai-usage.service';
import { TokenPricingService, TokenUsage } from '../../services/token-pricing.service';

/**
 * Detalhe do consumo em tokens (0044): entrada nova, cache lido (com desconto), cache escrito, entrada total, saída e
 * total — tokens, preço por milhão e custo estimado de cada parte. Conteúdo do popover de <app-token-usage>.
 */
@Component({
  selector: 'app-token-usage-panel',
  standalone: true,
  template: `
    @let b = breakdown();
    @let u = usage();
    <div class="tup" role="group" [attr.aria-label]="u.title || 'Consumo de tokens'">
      @if (u.title || u.subtitle) {
        <div class="tup__head">
          @if (u.title) { <strong class="tup__title">{{ u.title }}</strong> }
          @if (u.subtitle) { <span class="tup__sub">{{ u.subtitle }}</span> }
        </div>
      }
      <table class="tup__table">
        <thead><tr><th>Parte</th><th class="num">Tokens{{ u.average ? ' (média)' : '' }}</th><th class="num">US$/milhão</th><th class="num">≈ Custo</th></tr></thead>
        <tbody>
          @for (l of b.lines; track l.key) {
            <tr [class.tup__strong]="l.strong" [class.tup__part]="l.key === 'fresh' || l.key === 'cacheRead' || l.key === 'cacheWrite'">
              <td>{{ l.label }}@if (l.hint) { <span class="tup__hint" [class.tup__hint--good]="l.discount">{{ l.hint }}</span> }</td>
              <td class="num">{{ tokens(l.tokens) }}</td>
              <td class="num">{{ l.pricePerMillion == null ? '' : price(l.pricePerMillion) }}</td>
              <td class="num">{{ l.cost == null ? '—' : usd(l.cost) }}</td>
            </tr>
          }
        </tbody>
      </table>
      @if (b.models.length) {
        <!-- 0047: cada modelo pelo seu preço (ex.: análise no Opus, correção no Sonnet). -->
        <table class="tup__table tup__models">
          <thead><tr><th>Modelo</th><th class="num">Tokens{{ u.average ? ' (média)' : '' }}</th><th class="num">≈ Custo</th></tr></thead>
          <tbody>
            @for (m of b.models; track m.model) {
              <tr>
                <td>{{ m.label }}@if (m.turns) { <span class="tup__hint">{{ m.turns }} respostas</span> }</td>
                <td class="num">{{ tokens(m.tokens) }}</td>
                <td class="num">{{ m.cost == null ? '—' : usd(m.cost) }}</td>
              </tr>
            }
          </tbody>
        </table>
      }
      <ul class="tup__notes">
        @if (u.reportedCostUsd != null) {
          <li><strong>{{ usd(u.reportedCostUsd) }}</strong> informado {{ u.reportedBy ? 'pelo ' + u.reportedBy : '' }}{{ b.estimatedCost != null ? ' (a estimativa acima usa a tabela de preços)' : '' }}.</li>
        }
        @if (b.hasParts && b.withoutCache != null && b.totalInput > 0) {
          <li>Sem o desconto do cache, a entrada custaria <strong>{{ usd(b.withoutCache) }}</strong>.</li>
        }
        @if (b.hasParts) {
          <li><b>Cache lido</b>: o contexto que o Claude relê a cada resposta (já enviado antes) — cobrado com desconto.
            <b>Cache escrito</b>: contexto novo guardado para as próximas respostas.</li>
        }
        @if (b.models.length) {
          <li>Vários modelos: cada parte soma o consumo de cada modelo pelo preço dele (US$/milhão por modelo na tabela de preços).</li>
        } @else if (!b.price && u.model) { <li>Modelo <code>{{ u.model }}</code> fora da tabela de preços (AI Configurations) — só os tokens.</li> }
        @if (u.model || u.turns || u.calls) {
          <li class="tup__meta">
            @if (u.model && !b.models.length) { <span>Modelo <code>{{ u.model }}</code></span> }
            @if (u.turns) { <span>{{ u.turns }} respostas</span> }
            @if (u.calls) { <span>{{ u.calls }} {{ u.calls === 1 ? 'ação' : 'ações' }}</span> }
          </li>
        }
        @for (n of notes(); track $index) { <li>{{ n }}</li> }
      </ul>
    </div>
  `,
  styles: [`
    .tup { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; color: var(--mat-sys-on-surface, #e6e6e6); font-size: 12.5px; }
    .tup__head { display: flex; flex-direction: column; gap: 2px; }
    .tup__title { font-size: 13.5px; }
    .tup__sub { font-size: 12px; color: color-mix(in srgb, var(--mat-sys-on-surface) 60%, transparent); }
    .tup__table { width: 100%; border-collapse: collapse; background: transparent; color: inherit; }
    .tup__table th { text-align: left; font-weight: 500; font-size: 11px; padding: 4px 6px; color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent); }
    .tup__table td { padding: 5px 6px; border-top: 1px solid rgba(255, 255, 255, .06); }
    .tup__table .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .tup__part td:first-child { padding-left: 16px; }
    .tup__strong td { font-weight: 600; }
    .tup__models { margin-top: -2px; }
    .tup__hint { display: block; font-size: 10.5px; font-weight: 400; color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent); }
    .tup__hint--good { color: #3fb950; }
    .tup__notes { margin: 0; padding: 0 0 0 16px; display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; line-height: 1.45;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 72%, transparent); }
    .tup__meta { list-style: none; margin-left: -16px; display: flex; flex-wrap: wrap; gap: 4px 12px; }
    code { font-size: 11px; }
  `],
})
export class TokenUsagePanelComponent {
  private pricing = inject(TokenPricingService);
  readonly usage = input.required<TokenUsage>();
  readonly breakdown = computed(() => this.pricing.breakdown(this.usage()));
  readonly notes = computed(() => (this.usage().notes ?? []).filter((n): n is string => !!n));
  readonly tokens = formatTokens;
  readonly usd = formatUsd;

  constructor() {
    this.pricing.ensureLoaded();
  }

  price(v: number): string {
    return v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  }
}
