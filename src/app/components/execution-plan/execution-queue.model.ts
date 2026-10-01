/** Fila de execução e executores (feature 0039) — espelha ExecutionQueueResponses.cs. */

export type ExecutionRequestStatus = 'queued' | 'claimed' | 'running' | 'done' | 'failed' | 'cancelled' | 'expired';
export type ExecutionRequestKind = 'analyze' | 'resume';
export type ExecutionWaitCode = 'no-worker' | 'offline' | 'paused' | 'busy' | 'budget' | 'retry';

export interface ExecutionRequest {
  id: string;
  cardNumber: string;
  kind: ExecutionRequestKind;
  source: string;
  status: ExecutionRequestStatus;
  planId?: string | null;
  sessionId?: string | null;
  sessionHost?: string | null;
  ownerUserId: string;
  ownerName: string;
  requestedBy: string;
  targetWorkerId?: string | null;
  workerId?: string | null;
  workerName?: string | null;
  note?: string | null;
  force: boolean;
  attempts: number;
  maxAttempts: number;
  notBefore?: string | null;
  waitReason?: string | null;
  waitCode?: ExecutionWaitCode | null;
  lastError?: string | null;
  stderrTail?: string | null;
  exitCode?: number | null;
  finishedReason?: string | null;
  finishedBy?: string | null;
  costUsd?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  turns?: number | null;
  createdAt: string;
  claimedAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  lastHeartbeatAt?: string | null;
}

export interface ExecutionDoctorCheck {
  name: string;
  ok: boolean;
  message?: string | null;
  severity?: 'error' | 'warning' | null;
}

export interface ExecutionWorker {
  id: string;
  ownerUserId: string;
  ownerName: string;
  name: string;
  host: string;
  os?: string | null;
  agentVersion?: string | null;
  claudeVersion?: string | null;
  skillsVersion?: string | null;
  workspace?: string | null;
  maxConcurrency: number;
  status: 'active' | 'paused' | 'revoked';
  online: boolean;
  lastSeenAt?: string | null;
  createdAt: string;
  capabilities?: { repos?: string[]; os?: string } | null;
  doctor?: ExecutionDoctorCheck[] | null;
  doctorAt?: string | null;
  /** "Rodar diagnóstico agora" pedido e ainda não recebido. */
  doctorPending?: boolean;
  doctorProblems: number;
  running: number;
  latestAgentVersion?: string | null;
}

export interface ExecutionCardQueue {
  active?: ExecutionRequest | null;
  recent: ExecutionRequest[];
  myWorkers: ExecutionWorker[];
  ownerWorkers: ExecutionWorker[];
}

export interface ExecutionUserSettings {
  dailyBudgetUsd?: number | null;
  spentTodayUsd: number;
  autoAnalyzeEnabled: boolean;
  autoWorkItemTypes: string[];
  autoStates: string[];
  autoAreaPaths: string[];
  autoAssignedTo?: string | null;
  autoMaxPerDay: number;
  autoLastCheckAt?: string | null;
  autoLastError?: string | null;
}

/** Evento (grupo execplan-pending): executores/pedidos de um usuário mudaram. Payload: { userId }. */
export const EXECUTION_WORKERS_EVENT = 'executionWorkersChanged';

export const REQUEST_STATUS_LABEL: Record<ExecutionRequestStatus, string> = {
  queued: 'Na fila',
  claimed: 'Começando',
  running: 'Rodando',
  done: 'Concluído',
  failed: 'Falhou',
  cancelled: 'Cancelado',
  expired: 'Expirou'
};

export const REQUEST_SOURCE_LABEL: Record<string, string> = {
  button: 'pedido pela tela',
  answers: 'respostas pela tela',
  resume: '"Continuar"',
  'user-action': 'ação no plano',
  note: 'comentário',
  pr: 'PR mesclado',
  rule: 'regra automática',
  api: 'API'
};

export const isRequestActive = (status: ExecutionRequestStatus | undefined | null) =>
  status === 'queued' || status === 'claimed' || status === 'running';

/** Comando que instala o executor (depois das skills). */
export const AGENT_INSTALL_COMMAND = 'bash ~/.claude/skills/.prmake/prmake-skills.sh agent install';
