/** Fila de execução e executores (feature 0039) — espelha ExecutionQueueResponses.cs. */

export type ExecutionRequestStatus = 'queued' | 'claimed' | 'running' | 'done' | 'failed' | 'cancelled' | 'expired';
export type ExecutionRequestKind = 'analyze' | 'resume';
export type ExecutionWaitCode = 'no-worker' | 'offline' | 'paused' | 'busy' | 'budget' | 'retry' | 'throttled' | 'gathering';

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
  /** Custo deste pedido (0044: sem o acumulado das execuções anteriores da mesma sessão). */
  costUsd?: number | null;
  /** Acumulado da sessão no fim do pedido (como o Claude Code informa). */
  sessionCostUsd?: number | null;
  /** Entrada total (nova + cache lido + cache escrito). */
  inputTokens?: number | null;
  outputTokens?: number | null;
  freshInputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  model?: string | null;
  turns?: number | null;
  /** 0049: fase do card quando a máquina pegou o pedido. */
  phase?: 'analysis' | 'correction' | null;
  /** 0049: a correção começou numa sessão nova do Claude (só o resumo da análise). */
  newSession?: boolean;
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
  capabilities?: { repos?: string[]; os?: string; repoMap?: ExecutionRepoMap | null } | null;
  doctor?: ExecutionDoctorCheck[] | null;
  doctorAt?: string | null;
  /** "Rodar diagnóstico agora" pedido e ainda não recebido. */
  doctorPending?: boolean;
  /** Limite de uso da conta do Claude atingido até este horário (0041). */
  throttledUntil?: string | null;
  doctorProblems: number;
  running: number;
  latestAgentVersion?: string | null;
}

/** Repositório do mapa da máquina (0048): nome pelo remote → pasta local. */
export interface ExecutionRepoMapItem {
  name: string;
  path: string;
  kind?: string | null;
  branch?: string | null;
  /** scan = achado pela busca · manual = fixado com "repos set" · env = variável (EDV_SOLVACE_DIR, REVAMP_DIR). */
  source?: string | null;
  confirmed?: boolean;
  /** A pasta do mapa não existe mais. */
  gone?: boolean;
}

/** Mapa dos repositórios da máquina (~/.prmake/repos.json), mandado pelo executor 1.0.7+. */
export interface ExecutionRepoMap {
  items: ExecutionRepoMapItem[];
  /** Quando o executor manda só parte (limite do report). */
  total?: number;
  /** Mais de um clone do mesmo repositório: nome → pastas. */
  ambiguous?: Record<string, string[]>;
  /** Padrões do BranchStrategy sem nenhum clone na máquina. */
  missing?: string[];
  updatedAt?: string | null;
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

/** Consumo médio por plano, com MCP × sem MCP (0041). */
export interface ExecutionUsageReportRow {
  channel: 'mcp' | 'script';
  phase: 'all' | 'analysis' | 'correction';
  plans: number;
  avgTurns: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  /** 0044: partes da entrada, total e o modelo que mais gastou. */
  avgFreshInputTokens?: number;
  avgCacheReadTokens?: number;
  avgCacheWriteTokens?: number;
  avgTotalTokens?: number;
  model?: string | null;
  avgMcpCalls: number;
  avgScriptCalls: number;
  /** 0045: consultas à Base Solvace e buscas no código, em média por plano. */
  avgKbCalls?: number;
  avgSearchCalls?: number;
  /** 0047: média por plano em cada modelo do grupo. */
  models?: { model: string; avgTurns: number; avgInputTokens: number; avgOutputTokens: number; avgCacheReadTokens: number; avgCacheWriteTokens: number }[];
}

export interface ExecutionUsageReport {
  days: number;
  allUsers: boolean;
  rows: ExecutionUsageReportRow[];
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
/** Mostra/corrige o mapa de repositórios da máquina (0048). */
export const REPOS_COMMAND = 'bash ~/.claude/skills/.prmake/prmake-skills.sh repos';
