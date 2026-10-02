import { inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

/** US$ por milhão de tokens de cada parte (0044) — tabela "AiModelPricesUsdPerMillion" do plugin "AI Configurations". */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Consumo em tokens (0044). Com as partes da entrada (Claude Code: nova, cache lido, cache escrito) ou só a entrada
 * total (IA do PRMake). `reportedCostUsd` = custo já calculado (Claude Code ou PRMake), preferido à estimativa.
 */
export interface TokenUsage {
  freshInput?: number | null;
  cacheRead?: number | null;
  cacheWrite?: number | null;
  /** Entrada total quando não há as partes. */
  input?: number | null;
  output?: number | null;
  model?: string | null;
  reportedCostUsd?: number | null;
  /** De onde veio o custo informado ("Claude Code", "PRMake"). */
  reportedBy?: string | null;
  turns?: number | null;
  calls?: number | null;
  title?: string | null;
  subtitle?: string | null;
  notes?: (string | null | undefined)[];
  /** Valores são médias (relatório). */
  average?: boolean;
}

export interface TokenUsageLine {
  key: 'fresh' | 'cacheRead' | 'cacheWrite' | 'input' | 'output' | 'total';
  label: string;
  hint?: string;
  tokens: number;
  pricePerMillion: number | null;
  cost: number | null;
  strong?: boolean;
  discount?: boolean;
}

export interface TokenUsageBreakdown {
  lines: TokenUsageLine[];
  totalInput: number;
  totalTokens: number;
  estimatedCost: number | null;
  /** Quanto a entrada custaria sem o desconto do cache (tudo a preço cheio). */
  withoutCache: number | null;
  price: ModelPrice | null;
  hasParts: boolean;
}

/** Tabela de preços (uma vez por sessão do navegador) e o cálculo das partes. */
@Injectable({ providedIn: 'root' })
export class TokenPricingService {
  private http = inject(HttpClient);
  private loading = false;
  readonly prices = signal<Record<string, ModelPrice>>({});

  ensureLoaded(): void {
    if (this.loading) return;
    this.loading = true;
    this.http.get<{ prices: Record<string, ModelPrice> }>(`${environment.apiUrl}AiUsage/prices`).subscribe({
      next: (r) => this.prices.set(r?.prices ?? {}),
      error: () => (this.loading = false),
    });
  }

  /** Prefixo mais longo: "claude-opus-5-5[1m]" → "claude-opus-5-5". */
  find(model: string | null | undefined): ModelPrice | null {
    if (!model) return null;
    const m = model.trim().toLowerCase();
    const prices = this.prices();
    const key = Object.keys(prices).filter((k) => m.startsWith(k.toLowerCase())).sort((a, b) => b.length - a.length)[0];
    return key ? prices[key] : null;
  }

  breakdown(u: TokenUsage): TokenUsageBreakdown {
    const price = this.find(u.model);
    const cost = (tokens: number, per: number | null | undefined) => (per == null ? null : (tokens * per) / 1_000_000);
    const fresh = u.freshInput ?? 0;
    const cr = u.cacheRead ?? 0;
    const cw = u.cacheWrite ?? 0;
    const hasParts = u.cacheRead != null || u.cacheWrite != null || u.freshInput != null;
    const totalInput = hasParts ? fresh + cr + cw : u.input ?? 0;
    const output = u.output ?? 0;
    const lines: TokenUsageLine[] = [];
    if (hasParts) {
      const readDiscount = price && price.input ? Math.round((1 - price.cacheRead / price.input) * 100) : 90;
      const writeExtra = price && price.input ? Math.round((price.cacheWrite / price.input - 1) * 100) : 25;
      lines.push(
        { key: 'fresh', label: 'Entrada nova', hint: 'preço cheio', tokens: fresh, pricePerMillion: price?.input ?? null, cost: cost(fresh, price?.input) },
        { key: 'cacheRead', label: 'Cache lido', hint: `${readDiscount}% de desconto`, tokens: cr, pricePerMillion: price?.cacheRead ?? null, cost: cost(cr, price?.cacheRead), discount: true },
        { key: 'cacheWrite', label: 'Cache escrito', hint: `${writeExtra >= 0 ? '+' : ''}${writeExtra}% sobre a entrada`, tokens: cw, pricePerMillion: price?.cacheWrite ?? null, cost: cost(cw, price?.cacheWrite) },
      );
    }
    const inputCost = hasParts
      ? (price ? lines.reduce((s, l) => s + (l.cost ?? 0), 0) : null)
      : cost(totalInput, price?.input);
    lines.push({ key: 'input', label: 'Entrada total', tokens: totalInput, pricePerMillion: hasParts ? null : price?.input ?? null, cost: inputCost, strong: hasParts });
    const outputCost = cost(output, price?.output);
    lines.push({ key: 'output', label: 'Saída', tokens: output, pricePerMillion: price?.output ?? null, cost: outputCost });
    const estimatedCost = inputCost == null || outputCost == null ? null : inputCost + outputCost;
    // Sem preço do modelo (ex.: totais de vários modelos): o Total mostra o custo já calculado, se houver.
    lines.push({ key: 'total', label: 'Total', tokens: totalInput + output, pricePerMillion: null, cost: estimatedCost ?? u.reportedCostUsd ?? null, strong: true });
    return {
      lines,
      totalInput,
      totalTokens: totalInput + output,
      estimatedCost,
      withoutCache: hasParts && price ? (totalInput * price.input) / 1_000_000 : null,
      price,
      hasParts,
    };
  }
}
