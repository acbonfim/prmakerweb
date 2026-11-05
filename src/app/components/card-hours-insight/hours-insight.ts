/**
 * Lógica pura da seção "Horas do card" da Bancada (feature 0085) — sem Angular, testada no spec.
 *
 * - **Bug**: Completed contra a média de horas dos bugs do time (`AssistantAverageHoursBug`, reserva
 *   `AssistantAverageHours`). Tom: até a média = ok; até +50% = atenção; acima disso = alerta.
 * - **User Story**: planejado × realizado — Completed + Remaining (projeção) contra o Original Estimate, % consumido
 *   e estouro/folga; a média de US entra só como referência secundária.
 */

/** Horas do card no DevOps (`GET Azure/card/{n}/effort`). */
export interface HoursEffort {
  originalEstimate: number | null;
  completedWork: number | null;
  remainingWork: number | null;
}

export type HoursTone = 'ok' | 'warn' | 'bad' | 'neutral';

/** Acima da média até este fator ainda é "atenção" (âmbar); passou disso é "alerta" (vermelho). */
export const WARN_FACTOR = 1.5;
/** Estouro da projeção da US até esta fração do Original é "atenção"; acima, "alerta". */
export const US_WARN_OVERRUN = 0.2;

/** Valor de hora utilizável (número finito ≥ 0); o resto vira 0. */
export function hours(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/** Card sem nenhuma hora no DevOps (nem Original, nem Completed, nem Remaining). */
export function hasNoEstimate(e: HoursEffort | null | undefined): boolean {
  return !e || (!hours(e.originalEstimate) && !hours(e.completedWork) && !hours(e.remainingWork));
}

/** Arredonda para 2 casas (evita 2.0000000004h). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0;
}

/** Tom do Completed em relação à média: ≤ média ok, ≤ média × 1,5 atenção, acima alerta. */
export function toneVsAverage(completed: number, average: number | null | undefined): HoursTone {
  const avg = hours(average);
  if (!avg) return 'neutral';
  if (completed <= avg) return 'ok';
  if (completed <= avg * WARN_FACTOR) return 'warn';
  return 'bad';
}

/** Primeira média configurada (ex.: a do tipo e, na falta, a geral). */
export function pickAverage(...candidates: Array<number | null | undefined>): number | null {
  for (const c of candidates) if (hours(c) > 0) return c as number;
  return null;
}

// ── Bug ───────────────────────────────────────────────────────────────────────────────────────────

export interface BugHoursInsight {
  original: number;
  completed: number;
  remaining: number;
  /** Média dos bugs (null = não configurada). */
  average: number | null;
  /** Completed − média (positivo = acima). null sem média. */
  delta: number | null;
  /** Completed ÷ média × 100 (pode passar de 100). null sem média. */
  ratioPct: number | null;
  /** 'above' | 'below' | 'equal'; null sem média. */
  position: 'above' | 'below' | 'equal' | null;
  tone: HoursTone;
  /** Escala da barra (h): o maior entre Completed e 2× a média (sem média: Completed ou Original). */
  scale: number;
  /** Largura do Completed na barra (%). */
  completedPct: number;
  /** Posição da marca da média na barra (%), null sem média. */
  averagePct: number | null;
  /** Fim da faixa de atenção (média × 1,5) na barra (%), null sem média. */
  warnPct: number | null;
}

export function bugInsight(effort: HoursEffort | null | undefined, average: number | null | undefined): BugHoursInsight | null {
  if (!effort || hasNoEstimate(effort)) return null;
  const original = hours(effort.originalEstimate);
  const completed = hours(effort.completedWork);
  const remaining = hours(effort.remainingWork);
  const avg = hours(average) || null;

  const delta = avg === null ? null : round2(completed - avg);
  const position = delta === null ? null : delta > 0 ? 'above' : delta < 0 ? 'below' : 'equal';
  const scale = avg !== null ? Math.max(completed, avg * 2) : Math.max(completed, original, completed + remaining);

  return {
    original, completed, remaining,
    average: avg,
    delta,
    ratioPct: avg === null ? null : Math.round((completed / avg) * 100),
    position,
    tone: toneVsAverage(completed, avg),
    scale,
    completedPct: pct(completed, scale),
    averagePct: avg === null ? null : pct(avg, scale),
    warnPct: avg === null ? null : pct(avg * WARN_FACTOR, scale),
  };
}

// ── User Story ────────────────────────────────────────────────────────────────────────────────────

export interface UsHoursInsight {
  original: number;
  completed: number;
  remaining: number;
  /** Projeção = Completed + Remaining. */
  projected: number;
  /** Tem Original Estimate (o plano). */
  hasPlan: boolean;
  /** Completed ÷ Original × 100 (pode passar de 100). null sem Original. */
  consumedPct: number | null;
  /** Projeção − Original (positivo = estouro, negativo = folga). null sem Original. */
  projectionDelta: number | null;
  /** 'overrun' | 'slack' | 'on-plan'; null sem Original. */
  projection: 'overrun' | 'slack' | 'on-plan' | null;
  /** Completed já passou do Original. */
  completedOverPlan: boolean;
  tone: HoursTone;
  /** Escala da barra: o maior entre Original e projeção. */
  scale: number;
  completedPct: number;
  /** Remaining na barra (%), empilhado depois do Completed. */
  remainingPct: number;
  /** Marca do Original (%), null sem Original. */
  originalPct: number | null;
  /** Média das US (referência secundária). */
  average: number | null;
  /** Projeção − média (positivo = acima). null sem média. */
  averageDelta: number | null;
}

export function usInsight(effort: HoursEffort | null | undefined, average: number | null | undefined): UsHoursInsight | null {
  if (!effort || hasNoEstimate(effort)) return null;
  const original = hours(effort.originalEstimate);
  const completed = hours(effort.completedWork);
  const remaining = hours(effort.remainingWork);
  const projected = round2(completed + remaining);
  const hasPlan = original > 0;
  const avg = hours(average) || null;

  const projectionDelta = hasPlan ? round2(projected - original) : null;
  const projection = projectionDelta === null ? null : projectionDelta > 0 ? 'overrun' : projectionDelta < 0 ? 'slack' : 'on-plan';
  let tone: HoursTone = 'neutral';
  if (hasPlan) {
    const over = projectionDelta ?? 0;
    tone = over <= 0 ? 'ok' : over <= original * US_WARN_OVERRUN ? 'warn' : 'bad';
  }
  const scale = Math.max(original, projected);

  return {
    original, completed, remaining, projected, hasPlan,
    consumedPct: hasPlan ? Math.round((completed / original) * 100) : null,
    projectionDelta,
    projection,
    completedOverPlan: hasPlan && completed > original,
    tone,
    scale,
    completedPct: pct(completed, scale),
    remainingPct: pct(remaining, scale),
    originalPct: hasPlan ? pct(original, scale) : null,
    average: avg,
    averageDelta: avg === null ? null : round2(projected - avg),
  };
}

/** Lê uma média do `GET Skills/config` ("3", "2,5", "4h"); inválida/≤ 0 → null. */
export function parseHoursSetting(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(`${v}`.trim().replace(',', '.').replace(/h$/i, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}
