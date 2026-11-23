import { ExecutionPlan } from '../execution-plan/execution-plan.model';
import { WorkTask } from './work-item.model';

/**
 * O que a sub-tarefa parada espera da pessoa e como ela destrava (card 78655): a sub-tarefa só dizia "o Claude está
 * esperando você" e o motivo ficava escondido na aba Execução. Fontes, em ordem: a divergência entre a análise e a base
 * real (o PR espera a confirmação), o motivo da espera da etapa do plano (`prmake_block`), a ação "destravar" do plano e
 * o resultado da própria sub-tarefa (item avulso).
 */
export interface TaskPendency {
  /** Divergência pendente (markdown): destrava com "Confirmar e seguir" ou revisando com o especialista. */
  divergence: string | null;
  /** O que o Claude precisa da pessoa (markdown). */
  reason: string | null;
  /** Uma linha para o quadro compacto (sem markdown). */
  summary: string;
  /** Como destravar, em palavras simples. */
  how: string;
}

const SUMMARY_MAX = 220;
const NO_REASON = new Set(['plano concluído', 'plano cancelado']);

export function taskPendency(plan: Pick<ExecutionPlan, 'steps' | 'divergence' | 'userActions'> | null | undefined,
                             task: Pick<WorkTask, 'stepKey' | 'result'> | null | undefined): TaskPendency | null {
  if (!task) return null;
  const key = task.stepKey ?? null;
  const d = plan?.divergence;
  const divergence = d?.pending && (!d.stepKey || !key || d.stepKey === key) ? clean(d.text) : null;
  const step = key ? plan?.steps?.find((s) => s.key === key) : null;
  const unblock = key ? plan?.userActions?.find((a) => a.type === 'unblock' && a.stepKey === key) : null;
  const reason = clean(step?.waitingOn === 'user' ? step.statusReason : null) ?? clean(unblock?.text) ?? clean(task.result);
  if (!divergence && !reason) return null;

  const how = divergence
    ? 'O código real não bate com o que a análise supôs. Leia o que mudou e escolha: **Confirmar e seguir** (o Claude continua do jeito que ele propõe) ou **Revisar com o especialista** (para mudar o rumo antes).'
    : 'Faça o que está pedido acima ou escreva a sua decisão no campo abaixo e clique em **Já resolvi — continuar**. Ficou em dúvida? **Conversar com o especialista**.';
  return { divergence, reason, summary: summarize(divergence ?? reason!), how };
}

/** Primeira frase (ou o começo) sem markdown, para caber numa linha ou duas. */
export function summarize(markdown: string): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const sentence = /^(.{40,}?[.!?:])\s/.exec(plain)?.[1] ?? plain;
  return sentence.length <= SUMMARY_MAX ? sentence : `${sentence.slice(0, SUMMARY_MAX - 1).trimEnd()}…`;
}

function clean(text: string | null | undefined): string | null {
  const t = (text ?? '').trim();
  return t && !NO_REASON.has(t.toLowerCase()) ? t : null;
}
