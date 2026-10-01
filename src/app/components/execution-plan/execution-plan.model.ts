/** Plano de execução de uma skill sobre um card (feature 0023) — espelha `ExecutionPlanResponse` da API. */
export type PlanStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
export type PlanPhase = 'analysis' | 'correction';
export type StepExecutor = 'claude' | 'user';
export type StepKind = 'task' | 'code' | 'pr' | 'ticket' | 'question' | 'validation';
export type LinkKind = 'ticket' | 'pr' | 'doc' | 'other';
export type LogKind = 'info' | 'progress' | 'finding' | 'decision' | 'warning' | 'error';
export type ArtifactKind = 'script' | 'analysis' | 'data' | 'image' | 'attachment';
/** Etapa "aguardando": de quem depende (0037). `user` = ação do usuário (o motivo diz qual). */
export type WaitingOn = 'user' | 'answer' | 'external';
/** Pendência do usuário (0037): pergunta aberta, etapa dele pronta/em andamento, etapa travada esperando ele. */
export type UserActionType = 'question' | 'step' | 'unblock';

export interface ExecutionPlanSummary {
  id: string;
  cardNumber: string;
  kind: string;
  title: string;
  status: PlanStatus;
  statusReason?: string | null;
  statusChangedBy?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  lastActivityAt?: string | null;
  stepsTotal: number;
  stepsCompleted: number;
  /** Análise ou correção (0024). */
  phase: PlanPhase;
  parentPlanId?: string | null;
  /** Sessão do Claude Code a retomar (0033). */
  executor?: ExecutionSessionInfo | null;
  /** Custo somado das sessões (0033). */
  usage?: ExecutionUsage | null;
  resumeRequestedAt?: string | null;
  resumeRequestedBy?: string | null;
  resumePending?: boolean;
  /** Quantas coisas dependem do usuário agora (0037). */
  userPending?: number;
}

/** Uma pendência do usuário (0037) — espelha `ExecutionUserActionResponse`. */
export interface ExecutionUserAction {
  type: UserActionType;
  stepKey?: string | null;
  title: string;
  text?: string | null;
  questionId?: string | null;
  since?: string | null;
}

/** Plano ativo do usuário com pendência dele (0037) — `GET ExecutionPlan/pending`. */
export interface ExecutionUserPending {
  planId: string;
  cardNumber: string;
  title: string;
  phase: PlanPhase;
  status: PlanStatus;
  count: number;
  actions: ExecutionUserAction[];
}

export interface ExecutionSessionInfo {
  sessionId: string;
  host?: string | null;
  cwd?: string | null;
  startedAt: string;
  lastSeenAt: string;
}

export interface ExecutionUsage {
  sessions: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  updatedAt?: string | null;
}

export interface ExecutionStep {
  id: string;
  key: string;
  order: number;
  title: string;
  description?: string | null;
  status: StepStatus;
  statusReason?: string | null;
  statusChangedBy?: string | null;
  /** Etapa "aguardando": de quem depende (0037). */
  waitingOn?: WaitingOn | null;
  activity?: string | null;
  checkpoint?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  updatedAt: string;
  executor: StepExecutor;
  kind: StepKind;
  repository?: string | null;
  dependsOn: string[];
}

export interface ExecutionQuestionOption {
  label: string;
  description?: string | null;
  recommended: boolean;
}

/** Pergunta da skill ao usuário (0024) — responde aqui ou no Claude. */
export interface ExecutionQuestion {
  id: string;
  stepKey?: string | null;
  order: number;
  text: string;
  options: ExecutionQuestionOption[];
  allowFreeText: boolean;
  status: 'open' | 'answered' | 'cancelled';
  answer?: string | null;
  answeredBy?: string | null;
  answeredVia?: 'prmake' | 'claude' | null;
  answeredAt?: string | null;
  createdBy: string;
  createdAt: string;
}

/** Link anexado a uma etapa (0024): chamado (status manual), PR (status do GitHub), documento. */
export interface ExecutionLink {
  id: string;
  stepKey: string;
  kind: LinkKind;
  url: string;
  title?: string | null;
  status?: 'open' | 'resolved' | 'closed' | 'merged' | null;
  blocksStep: boolean;
  pullRequestNumber?: number | null;
  repository?: string | null;
  targetBranch?: string | null;
  createdBy: string;
  createdAt: string;
  statusChangedBy?: string | null;
  statusChangedAt?: string | null;
}

export interface ExecutionArtifact {
  id: string;
  /** Plano dono do arquivo (0031: anexos de comentário podem ser do outro plano do card). */
  planId: string;
  /** Número por card — "anexo #n" (0031). */
  number: number;
  /** Comentário a que pertence (0031); null = arquivo da skill. */
  noteId?: string | null;
  stepKey?: string | null;
  name: string;
  kind: ArtifactKind;
  contentType: string;
  size: number;
  sha256: string;
  description?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt?: string | null;
}

/** Comentário no plano (0031): texto + anexos, numerado por card ("comentário #n"). */
export interface ExecutionNote {
  id: string;
  planId: string;
  planPhase: PlanPhase;
  number: number;
  stepKey?: string | null;
  text: string;
  authorUserId?: string | null;
  authorName: string;
  fromExecutor: boolean;
  createdAt: string;
  updatedAt?: string | null;
  attachments: ExecutionArtifact[];
}

export interface ExecutionPlan extends ExecutionPlanSummary {
  summary?: string | null;
  steps: ExecutionStep[];
  artifacts: ExecutionArtifact[];
  questions: ExecutionQuestion[];
  links: ExecutionLink[];
  /** O que depende do usuário agora, na ordem do plano (0037). */
  userActions?: ExecutionUserAction[];
  /** Comentários do card inteiro (análise e correção) — 0031. */
  notes?: ExecutionNote[];
  lastLogId: number;
  serverTime: string;
}

export interface ExecutionLog {
  id: number;
  stepKey?: string | null;
  kind: LogKind;
  message: string;
  createdAt: string;
}

/** Sinal de tempo real (grupo `execplan:{card}`); a tela refaz o GET. Em sincronia com o backend. */
export interface ExecutionPlanRealtimePayload {
  cardNumber: string;
  planId: string;
  action: 'created' | 'steps' | 'step' | 'log' | 'status' | 'artifact' | 'question' | 'link' | 'note';
  stepKey?: string | null;
  status?: PlanStatus;
}

export const EXECUTION_PLAN_EVENT = 'executionPlanUpdated';
export const executionPlanGroup = (card: string) => `execplan:${card}`;

/** Pendências do usuário fora do card (0037): grupo global; payload { cardNumber, planId, userId }. */
export const EXECUTION_PENDING_GROUP = 'execplan-pending';
export const EXECUTION_PENDING_EVENT = 'executionPlanPendingChanged';

/** Botões do rodapé: cada grupo junta um ou mais tipos de arquivo. */
export interface ArtifactGroup {
  id: 'scripts' | 'analyses' | 'data' | 'attachments';
  label: string;
  icon: string;
  kinds: ArtifactKind[];
}

export const ARTIFACT_GROUPS: ArtifactGroup[] = [
  { id: 'scripts', label: 'Scripts', icon: 'code', kinds: ['script'] },
  { id: 'analyses', label: 'Análises', icon: 'description', kinds: ['analysis'] },
  { id: 'data', label: 'Dados', icon: 'dataset', kinds: ['data'] },
  { id: 'attachments', label: 'Anexos', icon: 'attach_file', kinds: ['image', 'attachment'] }
];

export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  pending: 'Pendente',
  running: 'Em andamento',
  paused: 'Pausado',
  completed: 'Concluído',
  failed: 'Falhou',
  cancelled: 'Cancelado'
};

export const isPlanActive = (status: PlanStatus | undefined | null) =>
  status === 'pending' || status === 'running' || status === 'paused';
