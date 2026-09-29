/** Plano de execução de uma skill sobre um card (feature 0023) — espelha `ExecutionPlanResponse` da API. */
export type PlanStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type LogKind = 'info' | 'progress' | 'finding' | 'decision' | 'warning' | 'error';
export type ArtifactKind = 'script' | 'analysis' | 'data' | 'image' | 'attachment';

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
  activity?: string | null;
  checkpoint?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  updatedAt: string;
}

export interface ExecutionArtifact {
  id: string;
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

export interface ExecutionPlan extends ExecutionPlanSummary {
  summary?: string | null;
  steps: ExecutionStep[];
  artifacts: ExecutionArtifact[];
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
  action: 'created' | 'steps' | 'step' | 'log' | 'status' | 'artifact';
  stepKey?: string | null;
  status?: PlanStatus;
}

export const EXECUTION_PLAN_EVENT = 'executionPlanUpdated';
export const executionPlanGroup = (card: string) => `execplan:${card}`;

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
