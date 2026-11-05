import { CardFull } from '../../../components/card-details-dialog/card-full.model';
import { CardSituation, situationAgo, situationDate, situationMeta } from '../../../components/card-situation/card-situation.service';
import { PlanHeadline } from '../../../components/execution-plan/execution-plan.component';
import { InfoFact } from '../../../components/pr-info-card/pr-info-card.component';

/**
 * 0085 (ajustes): etiquetas de status do card na Bancada — as mesmas da barra da tela de PR (`infoFacts()` do
 * register, feature 0026), montadas com o estado próprio da Bancada (sem `CardPrStateService`). Os PRs ficam no
 * botão "PRs (n)" ao lado e o resumo não técnico na tela de PR, por isso não entram aqui.
 * A lógica foi copiada (e não importada) para não mexer na tela de PR.
 */
export interface WorkbenchFactsInput {
  card: CardFull | null;
  plan: PlanHeadline | null;
  situation: CardSituation | null;
  /** Rodada 5: card US — o plano de entrega é "Implementação" (não "Correção"). */
  us?: boolean;
}

const PLAN_LABELS: Record<string, string> = {
  pending: 'pendente', running: 'em andamento', paused: 'pausado', completed: 'concluído', failed: 'falhou', cancelled: 'cancelado'
};

function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/** Texto de um campo do DevOps (identidade → nome; "-" = vazio). */
export function cardFieldText(card: CardFull | null | undefined, key: string): string {
  const v = card?.fields?.[key];
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return `${v.displayName ?? v.name ?? ''}`.trim();
  const s = `${v}`.trim();
  return s === '-' ? '' : s;
}

export function workbenchFacts(input: WorkbenchFactsInput): InfoFact[] {
  const facts: InfoFact[] = [];
  const card = input.card;
  const text = (key: string) => cardFieldText(card, key);

  if (card?.fields) {
    const state = text('System.State');
    if (state) {
      const column = text('System.BoardColumn');
      const lane = text('System.BoardLane');
      facts.push({
        icon: 'flag', label: 'Estado no DevOps', value: state, tone: /closed|done|resolved|removed/i.test(state) ? 'ok' : 'info',
        tooltip: [column && `Coluna: ${column}`, lane && `Raia: ${lane}`, text('System.Reason')].filter(Boolean).join('\n')
      });
    }
    const env = text('Custom.Environment');
    if (env) facts.push({ icon: 'dns', label: 'Ambiente do cliente', value: env });
    const module = text('Custom.Module');
    if (module) facts.push({ icon: 'widgets', label: 'Módulo', value: module, tooltip: text('Custom.Platform') && `Plataforma: ${text('Custom.Platform')}` });
    const area = text('System.AreaPath');
    const origin = text('Custom.BugReleaseorProduction') || (/Release Management/i.test(area) ? 'Release' : /Product Development/i.test(area) ? 'Production' : '');
    if (origin) facts.push({
      icon: 'rocket_launch', label: 'Produção ou release', value: /prod/i.test(origin) ? 'Produção' : /release|regress/i.test(origin) ? 'Release' : origin,
      tooltip: area ? `Área: ${area}` : undefined
    });
    const priority = text('Microsoft.VSTS.Common.Priority');
    const severity = text('Microsoft.VSTS.Common.Severity');
    if (priority || severity) facts.push({
      icon: 'priority_high', label: 'Prioridade · severidade',
      value: [priority && `P${priority}`, severity].filter(Boolean).join(' · '),
      tone: priority === '1' || /^[12]\b/.test(severity) ? 'warn' : undefined
    });
    const assigned = text('System.AssignedTo');
    if (assigned) facts.push({ icon: 'person', label: 'Responsável no DevOps', value: assigned.replace(/\s*<.*>$/, '') });
    const remaining = Number(text('Microsoft.VSTS.Scheduling.RemainingWork'));
    if (Number.isFinite(remaining) && remaining > 0) facts.push({
      icon: 'timer', label: 'Horas restantes', value: `${remaining}h restantes`,
      tooltip: text('Microsoft.VSTS.Scheduling.OriginalEstimate') && `Estimativa original: ${text('Microsoft.VSTS.Scheduling.OriginalEstimate')}h`
    });
  }

  const plan = input.plan;
  if (plan) {
    const phase = plan.phase === 'correction' ? (input.us ? 'Implementação' : 'Correção') : 'Análise';
    const yours = plan.userPending ?? 0;
    const extra = yours ? ` · aguardando você (${yours})` : plan.openQuestions ? ` · ${plan.openQuestions} pergunta(s)` : plan.waiting ? ' · aguardando' : '';
    facts.push({
      icon: 'account_tree', label: `Plano de ${phase.toLowerCase()} · ${PLAN_LABELS[plan.status] ?? plan.status}`,
      value: plan.status === 'completed' ? `${phase} concluída` : `${phase} ${plan.done}/${plan.total}${extra}`,
      tone: plan.status === 'completed' ? 'ok' : yours || plan.openQuestions || plan.status === 'paused' ? 'warn' : plan.status === 'running' ? 'info' : 'muted',
      tooltip: yours ? 'O plano está esperando você — veja o aviso "Aguardando você" no plano de execução' : undefined
    });
  }

  const situation = input.situation;
  const meta = situationMeta(situation?.kind);
  if (situation && meta) {
    const ago = situationAgo(situation.since);
    facts.push({
      icon: meta.icon, label: 'Situação atual',
      value: `${lowerFirst(situation.title || meta.short)}${ago ? ` · ${ago}` : ''}`,
      tone: meta.tone === 'pending' ? 'warn' : 'info',
      tooltip: [situation.stepTitle && `Etapa: ${situation.stepTitle}`, situation.since && `Desde ${situationDate(situation.since)}`,
        'Detalhes no cartão "Situação atual" (aba Itens)'].filter(Boolean).join('\n')
    });
  }
  return facts;
}
