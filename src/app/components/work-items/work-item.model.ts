/**
 * Itens de trabalho do card (feature 0085) — espelha `WorkItemResponse`/`WorkTaskResponse` da API
 * (`api/v1/WorkItems`). Um card tem vários itens; cada item tem sub-tarefas ordenadas. Itens e sub-tarefas
 * compartilham uma numeração global (`#123`).
 */

export type WorkItemType = 'bug' | 'user-story';
export type WorkItemStatus = 'pending' | 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'reverting' | 'reverted';
export type WorkTaskStatus = 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'skipped' | 'cancelled' | 'reverted';
export type WorkItemOrigin = 'user' | 'specialist' | 'analysis' | 'correction' | 'template';
export type WorkTaskExecutor = 'claude' | 'user';
/** Kinds do catálogo padrão (`WorkItemTaskKinds`); o catálogo é configurável, então qualquer texto é aceito. */
export type TaskKind = 'branch' | 'cherry-pick' | 'code' | 'pr' | 'devops-state' | 'sql-script' | 'validation' | 'comment' | 'manual' | (string & {});
export type WorkItemLinkKind = 'pr' | 'branch' | 'commit' | 'doc' | 'attachment' | 'timeline' | (string & {});
/** Ações rápidas da sub-tarefa (`POST WorkItems/tasks/{n}/{action}`). */
export type WorkTaskAction = 'start' | 'complete' | 'fail' | 'skip';
/** Filtro da lista. */
export type WorkItemFilter = 'all' | 'open' | 'done' | 'cancelled';

/** Evento do tempo real (grupo `execplan:{card}`) — só sinal; a tela refaz o GET. */
export const WORK_ITEMS_EVENT = 'workItemsUpdated';

export interface WorkItemsUpdatedPayload {
  cardNumber: string;
  number?: number | null;
  taskNumber?: number | null;
  action?: 'created' | 'updated' | 'task' | 'status' | 'request' | 'activity' | 'deleted' | string;
  status?: string | null;
}

export interface WorkItemLink {
  kind: WorkItemLinkKind;
  title?: string | null;
  url?: string | null;
}

export interface WorkItemUndo {
  action: string;
  params?: Record<string, string> | null;
}

export interface WorkTask {
  id: string;
  number: number;
  order: number;
  title: string;
  description?: string | null;
  kind: TaskKind;
  executor: WorkTaskExecutor;
  params: Record<string, string>;
  status: WorkTaskStatus;
  stepKey?: string | null;
  result?: string | null;
  output?: Record<string, unknown> | null;
  undo?: WorkItemUndo | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface WorkItemLog {
  id: number;
  taskNumber?: number | null;
  at: string;
  actor?: string | null;
  kind: string;
  text: string;
}

export interface WorkItem {
  id: string;
  number: number;
  cardNumber: string;
  type: WorkItemType;
  title: string;
  description?: string | null;
  status: WorkItemStatus;
  origin: WorkItemOrigin;
  templateKey?: string | null;
  planId?: string | null;
  planPhase?: 'analysis' | 'correction' | null;
  createdBy: string;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  cancelReason?: string | null;
  editable: boolean;
  progress: { done: number; total: number };
  links: WorkItemLink[];
  requestId?: string | null;
  /** Atividade ao vivo do executor (texto curto) enquanto o item roda. */
  activity?: string | null;
  fingerprint: string;
  tasks: WorkTask[];
  logs?: WorkItemLog[] | null;
}

export interface TaskKindParam {
  key: string;
  label?: string | null;
  required?: boolean;
  placeholder?: string | null;
}

export interface TaskKindInfo {
  kind: TaskKind;
  label: string;
  icon?: string | null;
  /** Nomes dos parâmetros (texto) ou descrições completas. */
  params: (string | TaskKindParam)[];
  /** Executor padrão do kind (opcional no catálogo). */
  executor?: WorkTaskExecutor | null;
}

export interface WorkItemTemplateTask {
  title: string;
  description?: string | null;
  kind: TaskKind;
  executor?: WorkTaskExecutor | null;
  params?: Record<string, string> | null;
}

export interface WorkItemTemplate {
  key: string;
  title: string;
  description?: string | null;
  type?: WorkItemType | null;
  tasks: WorkItemTemplateTask[];
}

export interface WorkItemCatalog {
  taskKinds: TaskKindInfo[];
  templates: WorkItemTemplate[];
}

export interface WorkTaskInput {
  title: string;
  description?: string | null;
  kind: TaskKind;
  executor?: WorkTaskExecutor | null;
  params?: Record<string, string> | null;
}

export interface CreateWorkItemRequest {
  title: string;
  description?: string | null;
  type?: WorkItemType | null;
  templateKey?: string | null;
  tasks: WorkTaskInput[];
  allowDuplicate?: boolean;
  duplicateReason?: string | null;
}

export interface UpdateWorkItemRequest {
  title: string;
  description?: string | null;
  tasks: WorkTaskInput[];
}

export interface ExecuteWorkItemResponse {
  requestId: string;
  status: string;
}

export interface DuplicateConflict {
  code: 'duplicate';
  existing: { number: number; title: string; status: WorkItemStatus };
}

/** Erro já traduzido pelo serviço (409 `duplicate`/`notEditable` e afins). */
export class WorkItemError extends Error {
  constructor(
    message: string,
    readonly code: 'duplicate' | 'notEditable' | 'notFound' | 'conflict' | 'error',
    readonly existing?: DuplicateConflict['existing'] | null,
    readonly status?: number
  ) {
    super(message);
  }
}

// ── Rótulos e aparência ────────────────────────────────────────────────────────────────────────

export interface StatusLook {
  label: string;
  icon: string;
  color: string;
  /** Ícone girando (em andamento). */
  spin?: boolean;
}

const ITEM_STATUS: Record<WorkItemStatus, StatusLook> = {
  pending: { label: 'Pendente', icon: 'radio_button_unchecked', color: '#9aa4b2' },
  queued: { label: 'Na fila', icon: 'schedule', color: '#c9a227' },
  running: { label: 'Em andamento', icon: 'autorenew', color: '#58a6ff', spin: true },
  waiting: { label: 'Aguardando', icon: 'hourglass_top', color: '#d29922' },
  completed: { label: 'Concluído', icon: 'check_circle', color: '#3fb950' },
  failed: { label: 'Falhou', icon: 'error', color: '#f85149' },
  cancelled: { label: 'Cancelado', icon: 'cancel', color: '#8b949e' },
  reverting: { label: 'Desfazendo', icon: 'undo', color: '#bc8cff', spin: true },
  reverted: { label: 'Desfeito', icon: 'undo', color: '#bc8cff' }
};

const TASK_STATUS: Record<WorkTaskStatus, StatusLook> = {
  pending: { label: 'Pendente', icon: 'radio_button_unchecked', color: '#9aa4b2' },
  running: { label: 'Em andamento', icon: 'autorenew', color: '#58a6ff', spin: true },
  waiting: { label: 'Aguardando', icon: 'hourglass_top', color: '#d29922' },
  completed: { label: 'Concluída', icon: 'check_circle', color: '#3fb950' },
  failed: { label: 'Falhou', icon: 'error', color: '#f85149' },
  skipped: { label: 'Pulada', icon: 'redo', color: '#8b949e' },
  cancelled: { label: 'Cancelada', icon: 'cancel', color: '#8b949e' },
  reverted: { label: 'Desfeita', icon: 'undo', color: '#bc8cff' }
};

const UNKNOWN: StatusLook = { label: '—', icon: 'help_outline', color: '#9aa4b2' };

export function itemStatusLook(status: string | null | undefined): StatusLook {
  return ITEM_STATUS[status as WorkItemStatus] ?? { ...UNKNOWN, label: status || '—' };
}

export function taskStatusLook(status: string | null | undefined): StatusLook {
  return TASK_STATUS[status as WorkTaskStatus] ?? { ...UNKNOWN, label: status || '—' };
}

export const ORIGIN_LABELS: Record<WorkItemOrigin, string> = {
  user: 'Manual',
  specialist: 'Especialista',
  analysis: 'Plano',
  correction: 'Plano',
  template: 'Modelo'
};

export function originLabel(origin: string | null | undefined): string {
  return ORIGIN_LABELS[origin as WorkItemOrigin] ?? (origin || '—');
}

export function originIcon(origin: string | null | undefined): string {
  switch (origin) {
    case 'specialist': return 'psychology';
    case 'analysis':
    case 'correction': return 'account_tree';
    case 'template': return 'content_copy';
    default: return 'person';
  }
}

export function executorLabel(executor: string | null | undefined): string {
  return executor === 'user' ? 'Você' : 'Claude';
}

/** Rótulo/ícone padrão de cada kind (quando o catálogo ainda não chegou ou não traz o kind). */
const KIND_DEFAULTS: Record<string, { label: string; icon: string }> = {
  branch: { label: 'Branch', icon: 'call_split' },
  'cherry-pick': { label: 'Cherry-pick', icon: 'commit' },
  code: { label: 'Código', icon: 'code' },
  pr: { label: 'Pull request', icon: 'merge' },
  'devops-state': { label: 'Estado no DevOps', icon: 'swap_horiz' },
  'sql-script': { label: 'Script SQL', icon: 'storage' },
  validation: { label: 'Validação', icon: 'fact_check' },
  comment: { label: 'Comentário', icon: 'chat_bubble_outline' },
  manual: { label: 'Manual', icon: 'pan_tool' }
};

export function kindInfo(kind: string | null | undefined, catalog?: WorkItemCatalog | null): { label: string; icon: string } {
  const k = kind ?? '';
  const fromCatalog = catalog?.taskKinds?.find((x) => x.kind === k);
  const def = KIND_DEFAULTS[k];
  return {
    label: fromCatalog?.label || def?.label || k || 'Tarefa',
    icon: fromCatalog?.icon || def?.icon || 'task_alt'
  };
}

/** Parâmetros do kind (normalizados) — os campos que o editor mostra. */
export function kindParams(kind: string | null | undefined, catalog?: WorkItemCatalog | null): TaskKindParam[] {
  const info = catalog?.taskKinds?.find((x) => x.kind === kind);
  return (info?.params ?? []).map((p) => (typeof p === 'string' ? { key: p, label: p } : { ...p, label: p.label || p.key }));
}

/** `#123` (sem zeros à esquerda). */
export function formatWorkNumber(n: number | string | null | undefined): string {
  return n === null || n === undefined || n === '' ? '' : '#' + Number(n);
}

// ── Regras puras ───────────────────────────────────────────────────────────────────────────────

const OPEN_ITEM: ReadonlySet<string> = new Set(['pending', 'queued', 'running', 'waiting', 'failed', 'reverting']);
const DONE_ITEM: ReadonlySet<string> = new Set(['completed']);
const CANCELLED_ITEM: ReadonlySet<string> = new Set(['cancelled', 'reverted']);

export function isOpenItem(item: Pick<WorkItem, 'status'>): boolean {
  return OPEN_ITEM.has(item.status);
}

export function matchesFilter(item: Pick<WorkItem, 'status'>, filter: WorkItemFilter): boolean {
  switch (filter) {
    case 'open': return OPEN_ITEM.has(item.status);
    case 'done': return DONE_ITEM.has(item.status);
    case 'cancelled': return CANCELLED_ITEM.has(item.status);
    default: return true;
  }
}

/** Item rodando (ou na fila): o botão Executar vira atividade. */
export function isItemBusy(item: Pick<WorkItem, 'status'>): boolean {
  return item.status === 'queued' || item.status === 'running' || item.status === 'reverting';
}

/** Executar só para pending/failed (o servidor decide o resto). */
export function canExecute(item: Pick<WorkItem, 'status'>): boolean {
  return item.status === 'pending' || item.status === 'failed';
}

export function canCancel(item: Pick<WorkItem, 'status'>): boolean {
  return !CANCELLED_ITEM.has(item.status) && item.status !== 'completed';
}

/** Desfazer: item cancelado ou concluído (com alguma sub-tarefa concluída para desfazer). */
export function canUndo(item: Pick<WorkItem, 'status' | 'tasks'>): boolean {
  return (item.status === 'cancelled' || item.status === 'completed' || item.status === 'failed')
    && (item.tasks ?? []).some((t) => t.status === 'completed');
}

/** Progresso `done/total` — usa o do servidor, ou calcula pelas sub-tarefas (concluídas + puladas). */
export function itemProgress(item: Pick<WorkItem, 'progress' | 'tasks'>): { done: number; total: number; pct: number } {
  const tasks = item.tasks ?? [];
  const done = item.progress?.done ?? tasks.filter((t) => t.status === 'completed' || t.status === 'skipped').length;
  const total = item.progress?.total ?? tasks.length;
  return { done, total, pct: total > 0 ? Math.round((Math.min(done, total) / total) * 100) : 0 };
}

/** Sub-tarefa do usuário que ele pode mexer agora (iniciar/concluir/falhar/pular). */
export function userTaskActions(task: Pick<WorkTask, 'executor' | 'status'>): WorkTaskAction[] {
  if (task.executor !== 'user') return [];
  switch (task.status) {
    case 'pending': return ['start', 'complete', 'skip'];
    case 'running':
    case 'waiting': return ['complete', 'fail', 'skip'];
    case 'failed': return ['start', 'complete', 'skip'];
    default: return [];
  }
}

export const TASK_ACTION_LABELS: Record<WorkTaskAction, { label: string; icon: string }> = {
  start: { label: 'Iniciar', icon: 'play_arrow' },
  complete: { label: 'Concluir', icon: 'check' },
  fail: { label: 'Falhou', icon: 'close' },
  skip: { label: 'Pular', icon: 'redo' }
};

/** Saída que é URL vira link. */
export function isUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

/** Ordem de leitura das saídas (`output` é jsonb livre): pares chave/valor em texto. */
export function outputEntries(output: Record<string, unknown> | null | undefined): { key: string; value: string; url: boolean }[] {
  if (!output || typeof output !== 'object') return [];
  return Object.entries(output).map(([key, v]) => {
    const value = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
    return { key, value, url: isUrl(value) };
  });
}

export function linkIcon(kind: string | null | undefined): string {
  switch (kind) {
    case 'pr': return 'merge';
    case 'branch': return 'call_split';
    case 'commit': return 'commit';
    case 'attachment': return 'attach_file';
    case 'timeline': return 'timeline';
    default: return 'description';
  }
}
