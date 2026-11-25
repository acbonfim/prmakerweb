import { Subscription } from 'rxjs';
import { ArchitectureService, BASE_QUESTION_ACTIVE, BaseQuestion } from '../../../services/architecture.service';
import { WsService } from '../../../services/ws.service';
import { EXECUTION_PLAN_EVENT, executionPlanGroup } from '../../../components/execution-plan/execution-plan.model';

/** 0102: enquanto a pergunta está ativa, o GET também roda de tempos em tempos (o tempo real é best-effort). */
const POLL_MS = 5_000;

export const isBaseQuestionActive = (q: BaseQuestion | null | undefined) => !!q && BASE_QUESTION_ACTIVE.includes(q.status);

/**
 * 0102: acompanha a pergunta respondida pelo executor — grupo `execplan:{key}`, evento `executionPlanUpdated`: `activity`
 * atualiza a linha "agora" sem GET; os outros (`request`, `answer`) e a volta da conexão refazem o GET. Para sozinho quando a
 * pergunta termina. Devolve a função que desliga.
 */
export function watchBaseQuestion(ws: WsService, api: ArchitectureService, start: BaseQuestion, update: (q: BaseQuestion) => void): () => void {
  let current = start;
  let stopped = false;
  let inFlight: Subscription | null = null;
  const group = executionPlanGroup(start.key);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    inFlight?.unsubscribe();
    ws.off(EXECUTION_PLAN_EVENT, handler);
    ws.removeFromGroup(group);
    resynced.unsubscribe();
  };

  const apply = (q: BaseQuestion) => {
    if (stopped) return;
    current = q;
    update(q);
    if (!isBaseQuestionActive(q)) stop();
  };

  const reload = () => {
    if (stopped || inFlight) return;
    inFlight = api.baseQuestion(start.id).subscribe({
      next: q => { inFlight = null; apply(q); },
      error: () => { inFlight = null; }
    });
  };

  const handler = (payload: { cardNumber?: string; action?: string; activity?: BaseQuestion['activity'] } | null) => {
    if (payload?.cardNumber !== start.key) return;
    if (payload.action === 'activity' && payload.activity) {
      apply({ ...current, status: current.status === 'queued' ? 'running' : current.status, activity: payload.activity });
      return;
    }
    reload();
  };

  ws.startConnection();
  ws.on(EXECUTION_PLAN_EVENT, handler);
  ws.addToGroup(group);
  const resynced = ws._resynced.subscribe(() => reload());
  const timer = setInterval(reload, POLL_MS);
  if (!isBaseQuestionActive(start)) stop();
  return stop;
}

/** Linha de andamento da pergunta pelo executor. */
export function baseQuestionProgress(q: BaseQuestion): string {
  if (q.status === 'queued')
    return q.waitReason || 'Na fila — aguardando o seu executor pegar a pergunta';
  if (q.activity?.label) return q.activity.label;
  return q.workerName ? `O Claude Code de ${q.workerName} está lendo a pergunta…` : 'O Claude Code está lendo a pergunta…';
}

/** Texto final de uma pergunta que não terminou com resposta. */
export function baseQuestionError(q: BaseQuestion): string {
  if (q.status === 'cancelled') return 'Pergunta cancelada.';
  return q.error || 'O executor não conseguiu responder.';
}
