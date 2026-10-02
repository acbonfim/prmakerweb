import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

/** Totais de consumo de IA (0042). `unpriced` = chamadas de modelo fora da tabela de preços (só tokens). */
export interface AiUsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  unpriced: number;
  failures: number;
}

export interface AiUsageSummary {
  days: number;
  since: string;
  total: AiUsageTotals;
  byAction: { action: string; label: string; totals: AiUsageTotals }[];
  byModel: { model: string; totals: AiUsageTotals }[];
  byDay: { day: string; totals: AiUsageTotals }[];
  byUser: { userExternalId: string | null; userName: string; totals: AiUsageTotals }[] | null;
  recent: {
    createdAt: string;
    action: string;
    label: string;
    userName: string | null;
    provider: string;
    model: string | null;
    inputTokens: number;
    outputTokens: number;
    costUsd: number | null;
    durationMs: number;
    success: boolean;
  }[];
}

/** Cabeçalho X-AI-Usage da resposta: o que a requisição gastou de IA. */
export interface AiUsageHeader {
  calls: number;
  input: number;
  output: number;
  cost: number | null;
  model: string;
}

export function parseAiUsageHeader(value: string | null): AiUsageHeader | null {
  if (!value) return null;
  const kv: Record<string, string> = {};
  for (const part of value.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) kv[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  const calls = Number(kv['calls'] ?? 0);
  if (!calls) return null;
  return {
    calls,
    input: Number(kv['in'] ?? 0),
    output: Number(kv['out'] ?? 0),
    cost: kv['cost'] ? Number(kv['cost']) : null,
    model: kv['model'] ?? '',
  };
}

/** "12,8 mil" / "1,2 mi" — tokens no formato curto. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (n >= 1_000) return `${(n / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return n.toLocaleString('pt-BR');
}

/** "US$ 0,0056" (centavos de centavo aparecem; valores maiores com 2 casas). */
export function formatUsd(v: number | null | undefined): string {
  if (v == null) return '—';
  const digits = v !== 0 && Math.abs(v) < 0.1 ? 4 : 2;
  return `US$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Consumo de IA por ação (0042): o meu e, para o admin, o de todos. */
@Injectable({ providedIn: 'root' })
export class AiUsageService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}AiUsage`;

  private params(days: number) {
    return { days, tzOffsetMinutes: -new Date().getTimezoneOffset() };
  }

  mine(days: number): Promise<AiUsageSummary> {
    return firstValueFrom(this.http.get<AiUsageSummary>(`${this.baseUrl}/me`, { params: this.params(days) }));
  }

  all(days: number): Promise<AiUsageSummary> {
    return firstValueFrom(this.http.get<AiUsageSummary>(this.baseUrl, { params: this.params(days) }));
  }
}
