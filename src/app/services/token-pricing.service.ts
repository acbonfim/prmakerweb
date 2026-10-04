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

/** Consumo em UM modelo (0047): a análise roda no Opus e a correção no Sonnet — cada um pelo seu preço. */
export interface ModelTokenUsage {
  model: string;
  freshInput: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  turns?: number | null;
}

/** Custo de um modelo no detalhe (0047). */
export interface ModelCostLine {
  model: string;
  label: string;
  tokens: number;
  output: number;
  turns: number | null;
  cost: number | null;
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
  /** 0047: as mesmas partes separadas por modelo — a estimativa soma cada um pelo seu preço. */
  models?: ModelTokenUsage[] | null;
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
  /** 0055: de onde a sessão leu — engenharia reversa × base antiga/KC × código (confirmando item × explorando) × buscas. */
  reads?: TokenUsageReads | null;
}

/** 0055: leituras por origem (chamadas e tokens estimados do que entrou no contexto). */
export interface TokenUsageReads {
  sources: { key: string; calls: number; tokens: number }[];
  /** Fração dos tokens lidos que veio da engenharia reversa (0–1). */
  reverseShare?: number | null;
  /** Arquivos de código lidos sem item da engenharia reversa que os cite — candidatos a lacuna. */
  exploredFiles?: { path: string; reads: number; tokens: number }[];
  /** Planos que mediram (relatório: as médias são só deles). */
  plans?: number | null;
}

/** 0055: nome de cada origem de leitura na tela. */
export const READ_SOURCE_LABELS: Record<string, { label: string; hint: string }> = {
  're': { label: 'Engenharia reversa', hint: 'itens, contexto do card, MCP' },
  'base': { label: 'Base antiga e KC', hint: 'seções e artigos' },
  'code-confirm': { label: 'Código — confirmando item', hint: 'o arquivo que o item cita' },
  'code-explore': { label: 'Código — explorando', hint: 'sem item que o cite' },
  'code-search': { label: 'Buscas no código', hint: 'grep, find, Glob' },
};

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
  /** 0047: uma linha por modelo (vazio quando o consumo é de um modelo só). */
  models: ModelCostLine[];
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

  /** Nome curto do modelo: "claude-opus-5-5" → "Opus 5.5". */
  label(model: string): string {
    const m = /claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/i.exec(model);
    if (!m) return model;
    const name = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    const minor = m[3] && m[3].length <= 2 ? `.${m[3]}` : '';
    return `${name} ${m[2]}${minor}`;
  }

  breakdown(u: TokenUsage): TokenUsageBreakdown {
    const models = (u.models ?? []).filter((m) => m && m.model);
    // 0047: mais de um modelo → cada parte é a soma de cada modelo pelo seu preço.
    if (models.length > 1) return this.multiModel(u, models);
    const price = this.find(models[0]?.model ?? u.model);
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
      models: [],
    };
  }

  /** 0047: consumo com vários modelos (ex.: análise no Opus, correção no Sonnet). */
  private multiModel(u: TokenUsage, models: ModelTokenUsage[]): TokenUsageBreakdown {
    const sum = (f: (m: ModelTokenUsage) => number) => models.reduce((s, m) => s + (f(m) || 0), 0);
    const costOf = (f: (m: ModelTokenUsage) => number, part: keyof ModelPrice) => {
      let total = 0;
      for (const m of models) {
        const p = this.find(m.model);
        if (!p) return null;
        total += ((f(m) || 0) * p[part]) / 1_000_000;
      }
      return total;
    };
    const fresh = sum((m) => m.freshInput);
    const cr = sum((m) => m.cacheRead);
    const cw = sum((m) => m.cacheWrite);
    const output = sum((m) => m.output);
    const totalInput = fresh + cr + cw;
    const freshCost = costOf((m) => m.freshInput, 'input');
    const crCost = costOf((m) => m.cacheRead, 'cacheRead');
    const cwCost = costOf((m) => m.cacheWrite, 'cacheWrite');
    const outCost = costOf((m) => m.output, 'output');
    const inputCost = freshCost == null || crCost == null || cwCost == null ? null : freshCost + crCost + cwCost;
    const estimatedCost = inputCost == null || outCost == null ? null : inputCost + outCost;
    const lines: TokenUsageLine[] = [
      { key: 'fresh', label: 'Entrada nova', hint: 'preço cheio de cada modelo', tokens: fresh, pricePerMillion: null, cost: freshCost },
      { key: 'cacheRead', label: 'Cache lido', hint: 'com desconto', tokens: cr, pricePerMillion: null, cost: crCost, discount: true },
      { key: 'cacheWrite', label: 'Cache escrito', tokens: cw, pricePerMillion: null, cost: cwCost },
      { key: 'input', label: 'Entrada total', tokens: totalInput, pricePerMillion: null, cost: inputCost, strong: true },
      { key: 'output', label: 'Saída', tokens: output, pricePerMillion: null, cost: outCost },
      { key: 'total', label: 'Total', tokens: totalInput + output, pricePerMillion: null, cost: estimatedCost ?? u.reportedCostUsd ?? null, strong: true },
    ];
    const withoutCache = models.every((m) => this.find(m.model))
      ? models.reduce((s, m) => s + ((m.freshInput + m.cacheRead + m.cacheWrite) * this.find(m.model)!.input) / 1_000_000, 0)
      : null;
    return {
      lines,
      totalInput,
      totalTokens: totalInput + output,
      estimatedCost,
      withoutCache,
      price: null,
      hasParts: true,
      models: models.map((m) => {
        const p = this.find(m.model);
        const tokens = m.freshInput + m.cacheRead + m.cacheWrite + m.output;
        return {
          model: m.model,
          label: this.label(m.model),
          tokens,
          output: m.output,
          turns: m.turns ?? null,
          cost: p ? (m.freshInput * p.input + m.cacheRead * p.cacheRead + m.cacheWrite * p.cacheWrite + m.output * p.output) / 1_000_000 : null,
        };
      }),
    };
  }
}
