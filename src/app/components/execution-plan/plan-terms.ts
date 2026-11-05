/**
 * 0085 (rodada 5, 1.5): terminologia por tipo do plano. Plano de US (`kind === 'analisar-us'`, ou a fase de correção
 * cujo pai é de US) fala em "implementação"; Bug continua com "correção". Vale na Bancada e na tela de PR.
 */
export const US_PLAN_KIND = 'analisar-us';

export interface PlanTerms {
  /** O plano é de User Story. */
  us: boolean;
  /** "correção" | "implementação" */
  fix: string;
  /** "Correção" | "Implementação" */
  Fix: string;
  /** "correções" | "implementações" */
  fixes: string;
  /** "Plano de correção" | "Plano de implementação" */
  fixPlan: string;
  /** "plano de correção" | "plano de implementação" */
  fixPlanLower: string;
}

const BUG_TERMS: PlanTerms = {
  us: false, fix: 'correção', Fix: 'Correção', fixes: 'correções', fixPlan: 'Plano de correção', fixPlanLower: 'plano de correção'
};
const US_TERMS: PlanTerms = {
  us: true, fix: 'implementação', Fix: 'Implementação', fixes: 'implementações',
  fixPlan: 'Plano de implementação', fixPlanLower: 'plano de implementação'
};

export function planTerms(us: boolean): PlanTerms {
  return us ? US_TERMS : BUG_TERMS;
}

interface PlanKindLike {
  id?: string;
  kind?: string | null;
  parentPlanId?: string | null;
}

/**
 * O plano é de US? Pelo `kind` dele; na correção, também pelo do pai (procurado em `others`: histórico do card, o outro
 * plano do par). Um card é Bug ou US — qualquer plano de US entre os do card decide.
 */
export function isUsPlan(plan: PlanKindLike | null | undefined, others: readonly (PlanKindLike | null | undefined)[] = []): boolean {
  if (!plan) return false;
  if (plan.kind === US_PLAN_KIND) return true;
  const list = others.filter((o): o is PlanKindLike => !!o);
  if (plan.parentPlanId && list.some((o) => o.id === plan.parentPlanId && o.kind === US_PLAN_KIND)) return true;
  return list.some((o) => o.kind === US_PLAN_KIND);
}

/**
 * O documento do plano como arquivo (em "Arquivos e textos" e na aba Arquivos da Bancada): nome estável por fase/item —
 * "plano-de-correcao-completo-item-56.md", "analise-completa.md".
 */
export function planDocumentFileName(phase: string | null | undefined, us: boolean, itemNumber?: number | null): string {
  const base = (phase ?? 'analysis') === 'correction' ? `${planTerms(us).fixPlan} completo` : 'Análise completa';
  const slug = base.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug}${itemNumber ? '-item-' + itemNumber : ''}.md`;
}
