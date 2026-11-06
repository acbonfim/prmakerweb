import type { WorkItemTypeInfo } from './work-item-types';

/**
 * Itens de trabalho do card (feature 0085) — espelha `WorkItemResponse`/`WorkTaskResponse` da API
 * (`api/v1/WorkItems`). Um card tem vários itens; cada item tem sub-tarefas ordenadas. Itens e sub-tarefas
 * compartilham uma numeração global (`#123`).
 */

/**
 * Tipo do item (rodada 4): os tipos próprios do catálogo (`itemTypes` — task, pull-request, review, analysis, fix…);
 * `bug`/`user-story` só em itens antigos. Ver work-item-types.ts.
 */
export type WorkItemType = 'bug' | 'user-story' | (string & {});
export type WorkItemStatus = 'pending' | 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'reverting' | 'reverted';
export type WorkTaskStatus = 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'skipped' | 'cancelled' | 'reverted';
export type WorkItemOrigin = 'user' | 'specialist' | 'analysis' | 'correction' | 'template';
export type WorkTaskExecutor = 'claude' | 'user';
/** Kinds do catálogo padrão (`WorkItemTaskKinds`); o catálogo é configurável, então qualquer texto é aceito. */
export type TaskKind = 'branch' | 'cherry-pick' | 'code' | 'pr' | 'devops-state' | 'sql-script' | 'validation' | 'comment' | 'manual'
  | 'ticket' | 'notify' | (string & {});
/**
 * Controle do parâmetro no editor (rodada 3): `repository`/`branch`/`target-branch` = autocomplete pesquisável,
 * `state` = estados do card no DevOps, `commits` = seletor de commits, `select` = `options`. Sem `input` no catálogo,
 * o editor deduz pelo nome do parâmetro (`paramInput` em work-item-pickers).
 */
export type TaskParamInput = 'repository' | 'branch' | 'target-branch' | 'state' | 'commits' | 'text' | 'textarea' | 'select' | 'pull-request';
/** Opção de um parâmetro `select` (texto simples ou `{value, label}`). */
export type TaskParamOption = string | { value: string; label?: string | null };
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
  /** 0091: `deliverable` = entrega nova/atualizada no item (`number`) — a tela recarrega o item aberto. */
  action?: 'created' | 'updated' | 'task' | 'status' | 'request' | 'activity' | 'deleted' | 'deliverable' | string;
  status?: string | null;
}

export interface WorkItemLink {
  kind: WorkItemLinkKind;
  title?: string | null;
  url?: string | null;
}

/** Chamado na Bancada: status do chamado (`PUT WorkItems/tasks/{n}/ticket`). */
export type TicketStatus = 'open' | 'resolved' | 'closed';
export type WorkTaskLinkStatus = TicketStatus | 'merged';
export type CiStatus = 'pending' | 'success' | 'failure';

/**
 * Chamado na Bancada: link da sub-tarefa — chamados e PRs da etapa do plano espelhada (ou o chamado anexado na sub-tarefa
 * de item avulso). Servidor antigo não manda (`links` ausente = nenhum).
 */
export interface WorkTaskLink {
  id?: string | null;
  kind: 'ticket' | 'pr' | (string & {});
  title?: string | null;
  url: string;
  status?: WorkTaskLinkStatus | null;
  /** CI do PR (só PR aberto). */
  checksStatus?: CiStatus | null;
}

/** Corpo do `POST WorkItems/tasks/{n}/ticket` (anexa o chamado; a sub-tarefa passa a aguardar). */
export interface AttachTicketRequest {
  url: string;
  title?: string | null;
}

/** Corpo do `PUT WorkItems/tasks/{n}/ticket` (`resolved` conclui a sub-tarefa; `closed` = fechado sem resolução). */
export interface TicketStatusRequest {
  status: TicketStatus;
  linkId?: string | null;
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
  /** JSON livre gravado pelo executor (objeto, na maioria das vezes). */
  output?: unknown;
  undo?: WorkItemUndo | null;
  startedAt?: string | null;
  completedAt?: string | null;
  /** Chamado na Bancada: chamados e PRs ligados à sub-tarefa (ausente = `[]`). */
  links?: WorkTaskLink[] | null;
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
  /** Id do usuário que criou (nulo para o servidor/executor). */
  createdBy?: string | null;
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
  /**
   * 0091: o que o item e as sub-tarefas geraram (só no `GET WorkItems/{n}` — a lista leve do card não traz). Ordem do
   * servidor: sub-tarefa, depois `at`. Ausente = servidor antigo (as telas caem nos `links`/`output`).
   */
  deliverables?: WorkDeliverable[] | null;
  /** O `#n` pedido era de uma sub-tarefa deste item (GET por número — a numeração é a mesma). */
  matchedTaskNumber?: number | null;
}

export interface TaskKindParam {
  key: string;
  label?: string | null;
  required?: boolean;
  placeholder?: string | null;
  /** Controle no editor (rodada 3); ausente = deduzido pelo nome. */
  input?: TaskParamInput | (string & {}) | null;
  /** Opções do `select`. */
  options?: TaskParamOption[] | null;
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
  /** Com `?card=`: o card, o tipo, a branch principal e a branch por destino (`release-version` → `hotfix/77434-rv`). */
  card?: string | null;
  type?: WorkItemType | null;
  mainBranch?: string | null;
  branchesByTarget?: Record<string, string> | null;
  /** Destinos dos PRs do fluxo do card ("development, qa") — quando o catálogo trouxer; senão vem do `Skills/rules`. */
  flowTargets?: string | string[] | null;
  /** Repositório padrão do card (regras). */
  defaultRepository?: string | null;
  /** URL base do GitHub (`https://github.com/<owner>`) para os links de repositório/branch. */
  githubUrl?: string | null;
  /** Rodada 4: tipos do item (`WorkItemTypes`); ausente = os semeados (work-item-types.ts). */
  itemTypes?: WorkItemTypeInfo[] | null;
}

export interface WorkTaskInput {
  /** Número da sub-tarefa existente (editar sem recriar); ausente = nova. */
  number?: number | null;
  /** Etapa do plano ligada (sub-tarefas de item de plano). */
  stepKey?: string | null;
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
  requestId?: string | null;
  status: string;
  item?: WorkItem | null;
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
  manual: { label: 'Manual', icon: 'pan_tool' },
  ticket: { label: 'Abrir chamado', icon: 'confirmation_number' },
  notify: { label: 'Avisar', icon: 'campaign' },
  'pr-review': { label: 'Revisar PR', icon: 'rate_review' },
  'devops-action': { label: 'Ação no DevOps', icon: 'bolt' },
  'pr-text': { label: 'Texto do PR (PRMake)', icon: 'article' },
  'sql-query': { label: 'Consulta SQL', icon: 'manage_search' }
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
export function outputEntries(output: unknown): { key: string; value: string; url: boolean }[] {
  if (output === null || output === undefined || output === '') return [];
  if (typeof output !== 'object') {
    const value = `${output}`;
    return [{ key: 'saída', value, url: isUrl(value) }];
  }
  return Object.entries(output as Record<string, unknown>).map(([key, v]) => {
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

// ── Sessão de execução ao vivo (ajustes da 0085: `GET WorkItems/{number}/live`) ─────────────────────────

/** Pedido do executor ligado ao item (item de plano → o pedido ativo da pista main do plano). */
export interface WorkItemLiveRequest {
  id: string;
  kind: string;
  /** queued · claimed · running · done · failed · cancelled · expired */
  status: string;
  workerName?: string | null;
  claimedAt?: string | null;
  startedAt?: string | null;
  lastHeartbeatAt?: string | null;
  /** Por que está esperando (no-worker, offline, paused, busy, budget, retry, throttled, gathering, updating). */
  waitCode?: string | null;
}

/** O que o Claude está fazendo (rótulo montado pelo executor a partir da ferramenta — nunca o comando). */
export interface WorkItemLiveActivity {
  label: string;
  tool?: string | null;
  at: string;
}

export interface WorkItemLiveLog {
  at: string;
  kind: string;
  text: string;
  taskNumber?: number | null;
}

/** `GET WorkItems/{number}/live` — o estado ao vivo da execução do item. */
export interface WorkItemLive {
  number: number;
  status: WorkItemStatus | string;
  request: WorkItemLiveRequest | null;
  activity: WorkItemLiveActivity | null;
  recent: WorkItemLiveActivity[];
  /** Últimos 50 registros, mais novo por último. */
  logs: WorkItemLiveLog[];
  executorOnline: boolean;
}

/** Linha do feed da sessão (atividades do executor + registros do item), mais nova por último. */
export interface LiveFeedEntry {
  at: string;
  text: string;
  /** activity = o que o Claude fez · log = registro do item (kind do registro em `kind`). */
  source: 'activity' | 'log';
  kind?: string | null;
  tool?: string | null;
  taskNumber?: number | null;
}

const LIVE_ITEM: ReadonlySet<string> = new Set(['queued', 'running', 'waiting', 'reverting']);

/** Item que está na sessão de execução agora (na fila, rodando, esperando alguém ou desfazendo). */
export function isExecutingItem(item: Pick<WorkItem, 'status'> | null | undefined): boolean {
  return !!item && LIVE_ITEM.has(item.status);
}

/** Números dos itens em execução, em ordem de número. */
export function executingNumbers(items: readonly Pick<WorkItem, 'status' | 'number'>[]): number[] {
  return items.filter((x) => isExecutingItem(x)).map((x) => x.number).sort((a, b) => a - b);
}

/**
 * Ordem da lista: criação, do mais antigo ao mais novo (novos por último), com ou sem a sessão de execução aberta —
 * item em execução não sobe. Sem data válida, vale o número (sequência global, também na ordem de criação).
 */
export function sortByCreation<T extends Pick<WorkItem, 'createdAt' | 'number'>>(items: readonly T[]): T[] {
  const time = (s: string | null | undefined) => { const t = s ? Date.parse(s) : NaN; return isNaN(t) ? null : t; };
  return items.slice().sort((a, b) => {
    const ta = time(a.createdAt), tb = time(b.createdAt);
    if (ta !== null && tb !== null && ta !== tb) return ta - tb;
    return a.number - b.number;
  });
}

const WAIT_CODE_LABELS: Record<string, string> = {
  'no-worker': 'Nenhum executor cadastrado — instale o executor na sua máquina',
  offline: 'Seu executor está offline',
  paused: 'Seu executor está pausado',
  busy: 'Executor ocupado — começa quando abrir uma vaga',
  budget: 'Limite diário de gasto atingido',
  retry: 'Vai tentar de novo em instantes',
  throttled: 'Limite de uso do Claude atingido — volta sozinho',
  gathering: 'Juntando os pedidos antes de começar',
  updating: 'Executor se atualizando'
};

/** Motivo da espera do pedido, em português (código desconhecido → texto genérico). */
export function waitCodeLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return WAIT_CODE_LABELS[code] ?? `Aguardando (${code})`;
}

const REQUEST_LABELS: Record<string, string> = {
  queued: 'Na fila do executor',
  claimed: 'Começando',
  running: 'Rodando',
  done: 'Terminou',
  failed: 'Falhou',
  cancelled: 'Cancelado',
  expired: 'Expirou'
};

export function requestStatusLabel(status: string | null | undefined): string {
  return REQUEST_LABELS[status ?? ''] ?? (status || '—');
}

/** Ícone da ferramenta usada pelo Claude (mesma regra do plano). */
export function activityIcon(tool: string | null | undefined): string {
  if (!tool) return 'bolt';
  if (tool === 'Read') return 'menu_book';
  if (tool === 'Grep' || tool === 'Glob') return 'search';
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') return 'edit';
  if (tool.startsWith('mcp__prmake__')) return 'checklist';
  if (tool === 'Task' || tool === 'Agent') return 'hub';
  return 'terminal';
}

/**
 * Feed da sessão: atividades recentes + registros do item, sem repetir, do mais antigo para o mais novo (o mais novo
 * embaixo). A atividade atual entra no feed também (é a última coisa feita).
 */
export function buildLiveFeed(live: Pick<WorkItemLive, 'recent' | 'logs' | 'activity'> | null | undefined, max = 120): LiveFeedEntry[] {
  if (!live) return [];
  const entries: LiveFeedEntry[] = [];
  const seen = new Set<string>();
  const push = (e: LiveFeedEntry) => {
    const key = `${e.source}|${e.at}|${e.text}`;
    if (!e.text || seen.has(key)) return;
    seen.add(key);
    entries.push(e);
  };
  for (const a of [...(live.recent ?? []), ...(live.activity ? [live.activity] : [])]) {
    push({ at: a.at, text: a.label, source: 'activity', tool: a.tool ?? null });
  }
  for (const l of live.logs ?? []) {
    push({ at: l.at, text: l.text, source: 'log', kind: l.kind, taskNumber: l.taskNumber ?? null });
  }
  const time = (s: string) => { const t = Date.parse(s); return isNaN(t) ? 0 : t; };
  // sort estável: mesmo horário mantém a ordem de chegada.
  return entries.map((e, i) => ({ e, i })).sort((a, b) => time(a.e.at) - time(b.e.at) || a.i - b.i).map((x) => x.e).slice(-max);
}

/** Duração legível: `45 s`, `3 min 12 s`, `1 h 05 min`. */
export function formatElapsed(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || isNaN(ms) || ms < 0) return '';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec} s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ${String(sec % 60).padStart(2, '0')} s`;
  const h = Math.floor(min / 60);
  return `${h} h ${String(min % 60).padStart(2, '0')} min`;
}

/** Sub-tarefas cujo status mudou entre duas cargas (para a transição de "concluída"/"em andamento"). */
export function changedTaskNumbers(prev: readonly Pick<WorkTask, 'number' | 'status'>[] | null | undefined, next: readonly Pick<WorkTask, 'number' | 'status'>[]): number[] {
  if (!prev?.length) return [];
  const before = new Map(prev.map((t) => [t.number, t.status]));
  return next.filter((t) => before.has(t.number) && before.get(t.number) !== t.status).map((t) => t.number);
}

const PR_URL = /\/pull(s|request)?\/\d+|\/pullrequest\/\d+/i;

/** Link de PR do item; `status`/`reverted` só quando vem das entregas (0091). */
export interface PullRequestLink {
  title: string;
  url: string;
  status?: string | null;
  reverted?: boolean;
  deliverable?: WorkDeliverable;
}

/**
 * Links de PR do item. 0091: com entregas `pr` (com URL) no item, são elas (com o estado); senão, como antes — links
 * `pr` + saídas das sub-tarefas que são URL de PR, sem repetir.
 */
export function pullRequestLinks(item: Pick<WorkItem, 'links' | 'tasks' | 'deliverables'> | null | undefined): PullRequestLink[] {
  if (!item) return [];
  const out: PullRequestLink[] = [];
  const seen = new Set<string>();
  const add = (url: string | null | undefined, title: string | null | undefined, d?: WorkDeliverable) => {
    const u = (url ?? '').trim();
    if (!isUrl(u) || seen.has(linkKey(u))) return;
    seen.add(linkKey(u));
    out.push(d
      ? { title: (title ?? '').trim() || u, url: u, status: prStatusOf(d), reverted: !!d.reverted, deliverable: d }
      : { title: (title ?? '').trim() || u, url: u });
  };
  for (const d of item.deliverables ?? []) if (d.kind === 'pr') add(d.url, prShortTitle(d), d);
  if (out.length) return out;
  for (const l of item.links ?? []) if (l.kind === 'pr' || PR_URL.test(l.url ?? '')) add(l.url, l.title);
  // Chamado na Bancada: PRs ligados às sub-tarefas (etapas do plano).
  for (const t of item.tasks ?? []) for (const l of t.links ?? []) if (l?.kind === 'pr') add(l.url, l.title);
  for (const t of item.tasks ?? []) {
    for (const o of outputEntries(t.output)) {
      if (o.url && (PR_URL.test(o.value) || /^pr(url|_url|link)?$/i.test(o.key))) add(o.value, t.title);
    }
  }
  return out;
}

/** Links de branch e outros (não-PR) que as sub-tarefas devolveram. */
export function taskOutputLinks(task: Pick<WorkTask, 'output'>): { key: string; url: string; kind: 'pr' | 'branch' | 'link' }[] {
  return outputEntries(task.output).filter((o) => o.url).map((o) => ({
    key: o.key,
    url: o.value,
    kind: PR_URL.test(o.value) || /^pr/i.test(o.key) ? 'pr' : /branch/i.test(o.key) || /\/tree\/|\/branches|version=GB/i.test(o.value) ? 'branch' : 'link'
  }));
}


// ── Chamado na Bancada: links da sub-tarefa (chamados e PRs) ─────────────────────────────────────────

/** Chave de comparação da URL (sem espaços, barra final nem diferença de caixa) — para não repetir o mesmo link. */
export function linkKey(url: string | null | undefined): string {
  return (url ?? '').trim().replace(/\/+$/, '').toLowerCase();
}

/** Links da sub-tarefa válidos (URL http), sem repetir URL (o primeiro vence); ausente = `[]`. */
export function taskLinks(task: Pick<WorkTask, 'links'> | null | undefined): WorkTaskLink[] {
  const out: WorkTaskLink[] = [];
  const seen = new Set<string>();
  for (const l of task?.links ?? []) {
    if (!l || !isUrl(l.url)) continue;
    const k = linkKey(l.url);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ...l, url: l.url.trim() });
  }
  return out;
}

/** PR/branch da sub-tarefa (entregas, senão saídas-link — 0091) que não repetem um link dela (o link com status já aparece). */
export function taskExtraOutputLinks(item: Pick<WorkItem, 'deliverables'> | null | undefined, task: Pick<WorkTask, 'number' | 'output' | 'links'>): TaskOutputLink[] {
  const known = new Set(taskLinks(task).map((l) => linkKey(l.url)));
  const seen = new Set<string>();
  return taskDeliverableLinks(item, task).filter((o) => {
    const k = linkKey(o.url);
    if (known.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function taskLinkIcon(kind: string | null | undefined): string {
  return kind === 'ticket' ? 'confirmation_number' : kind === 'pr' ? 'merge' : linkIcon(kind);
}

const TICKET_STATUS: Record<string, StatusLook> = {
  open: { label: 'Aberto', icon: 'hourglass_top', color: '#d29922' },
  resolved: { label: 'Resolvido', icon: 'task_alt', color: '#3fb950' },
  closed: { label: 'Fechado', icon: 'do_not_disturb_on', color: '#8b949e' }
};

const PR_STATUS: Record<string, StatusLook> = {
  open: { label: 'Aberto', icon: 'radio_button_checked', color: '#58a6ff' },
  merged: { label: 'Mesclado', icon: 'merge', color: '#bc8cff' },
  closed: { label: 'Fechado', icon: 'block', color: '#8b949e' }
};

/** Status do link (chamado: Aberto/Resolvido/Fechado · PR: Aberto/Mesclado/Fechado); sem status = aberto. Outros kinds: null. */
export function taskLinkStatusLook(link: Pick<WorkTaskLink, 'kind' | 'status'>): StatusLook | null {
  const map = link.kind === 'ticket' ? TICKET_STATUS : link.kind === 'pr' ? PR_STATUS : null;
  if (!map) return null;
  return map[link.status || 'open'] ?? { ...UNKNOWN, label: link.status || '—' };
}

const CI_LABELS: Record<CiStatus, StatusLook> = {
  pending: { label: 'CI rodando', icon: 'pending', color: '#d29922' },
  success: { label: 'CI ok', icon: 'check_circle', color: '#3fb950' },
  failure: { label: 'CI falhou', icon: 'error', color: '#f85149' }
};

/** CI do PR — só PR aberto com `checksStatus` conhecido. */
export function taskLinkCiLook(link: Pick<WorkTaskLink, 'kind' | 'status' | 'checksStatus'>): StatusLook | null {
  if (link.kind !== 'pr' || (link.status && link.status !== 'open') || !link.checksStatus) return null;
  return CI_LABELS[link.checksStatus] ?? null;
}

/** Sub-tarefa de chamado da pessoa (`kind: ticket`, executor `user`). */
export function isTicketTask(task: Pick<WorkTask, 'kind' | 'executor'> | null | undefined): boolean {
  return !!task && task.kind === 'ticket' && task.executor === 'user';
}

/** O chamado em foco da sub-tarefa: o último aberto; sem aberto, o último anexado. */
export function currentTicket(task: Pick<WorkTask, 'links'> | null | undefined): WorkTaskLink | null {
  const tickets = taskLinks(task).filter((l) => l.kind === 'ticket');
  if (!tickets.length) return null;
  return [...tickets].reverse().find((l) => (l.status || 'open') === 'open') ?? tickets[tickets.length - 1];
}

const FINISHED_TASK: ReadonlySet<string> = new Set(['completed', 'skipped', 'cancelled', 'reverted']);
/** Item fechado/cancelado/desfeito (ou desfazendo): a Bancada só mostra. */
const READONLY_ITEM: ReadonlySet<string> = new Set(['completed', 'cancelled', 'reverting', 'reverted']);

/**
 * É a vez da sub-tarefa: rodando/aguardando/falhou, ou pendente com todas as anteriores (pela ordem) finalizadas
 * (concluída, pulada, cancelada ou desfeita).
 */
export function isTaskTurn(item: Pick<WorkItem, 'tasks'> | null | undefined, task: Pick<WorkTask, 'number' | 'order' | 'status'>): boolean {
  if (task.status === 'running' || task.status === 'waiting' || task.status === 'failed') return true;
  if (task.status !== 'pending') return false;
  return (item?.tasks ?? []).filter((t) => t.number !== task.number && t.order < task.order).every((t) => FINISHED_TASK.has(t.status));
}

/** Ações de chamado: `attach` (anexar outro), `resolved`, `closed` (sem resolução) e `open` (reabrir). */
export type TicketAction = 'attach' | TicketStatus;

export const TICKET_ACTION_LABELS: Record<TicketAction, { label: string; icon: string }> = {
  attach: { label: 'Anexar chamado', icon: 'add_link' },
  resolved: { label: 'Marcar como resolvido', icon: 'task_alt' },
  closed: { label: 'Fechado sem resolução', icon: 'do_not_disturb_on' },
  open: { label: 'Reabrir', icon: 'replay' }
};

/** Aviso depois de mudar o status do chamado (snackbar). */
export const TICKET_STATUS_DONE: Record<TicketStatus, string> = {
  resolved: 'chamado resolvido — sub-tarefa concluída',
  closed: 'chamado fechado sem resolução — anexe outro ou conclua a sub-tarefa',
  open: 'chamado reaberto — a sub-tarefa volta a aguardar'
};

/**
 * O que a pessoa pode fazer com o chamado da sub-tarefa agora. Só sub-tarefa de chamado da pessoa, na vez dela e não
 * finalizada, com o item aberto. Sem chamado → anexar; aberto → resolvido/fechado sem resolução; fechado → anexar outro
 * ou reabrir; resolvido (sub-tarefa ainda não concluída) → reabrir.
 */
export function ticketTaskActions(item: Pick<WorkItem, 'status' | 'tasks'> | null | undefined, task: WorkTask | null | undefined): TicketAction[] {
  if (!item || !task || !isTicketTask(task) || READONLY_ITEM.has(item.status)) return [];
  if (FINISHED_TASK.has(task.status) || !isTaskTurn(item, task)) return [];
  const ticket = currentTicket(task);
  switch (ticket ? ticket.status || 'open' : null) {
    case null: return ['attach'];
    case 'open': return ['resolved', 'closed'];
    case 'closed': return ['attach', 'open'];
    case 'resolved': return ['open'];
    default: return ['attach'];
  }
}

/**
 * Rótulo da sub-tarefa pendente que já tem PR (etapa de PR do plano): "PR aberto"/"PR mesclado" no lugar de
 * "Pendente". Null quando não se aplica.
 */
export function taskPrHint(task: Pick<WorkTask, 'status' | 'links'>): string | null {
  if (task.status !== 'pending') return null;
  const prs = taskLinks(task).filter((l) => l.kind === 'pr');
  if (!prs.length) return null;
  if (prs.some((l) => (l.status || 'open') === 'open')) return prs.length > 1 ? 'PRs abertos' : 'PR aberto';
  if (prs.every((l) => l.status === 'merged')) return prs.length > 1 ? 'PRs mesclados' : 'PR mesclado';
  return null;
}

// ── Entregas do item e das sub-tarefas (0091: `WorkDeliverableResponse`) ────────────────────────────

/** Tipos de entrega (o servidor pode mandar outros; a tela mostra como "Link"). */
export type WorkDeliverableKind = 'pr' | 'branch' | 'commit' | 'code' | 'ticket' | 'pr-text' | 'devops-state' | 'comment'
  | 'timeline' | 'hours' | 'notify' | 'doc' | (string & {});
/** auto = gravada pelo servidor · task = output/links da sub-tarefa · plan = etapa do plano · deduced = deduzida dos registros do card. */
export type WorkDeliverableSource = 'auto' | 'task' | 'plan' | 'deduced' | (string & {});
/** Estado do PR (`pr`) ou do chamado (`ticket`); os demais tipos vêm sem estado. */
export type WorkDeliverableStatus = 'open' | 'merged' | 'closed' | 'draft' | 'resolved' | (string & {});

export interface DeliverableCommit {
  sha: string;
  title?: string | null;
}

export interface DeliverableFileStat {
  path: string;
  status?: 'modified' | 'added' | 'removed' | 'renamed' | (string & {}) | null;
  additions?: number | null;
  deletions?: number | null;
}

/** `data` do `pr`. */
export interface PrDeliverableData {
  alreadyExisted?: boolean | null;
  checks?: 'success' | 'failure' | 'pending' | (string & {}) | null;
  checksFailed?: number | null;
  approvals?: number | null;
  /** Contagem (ou `true`) de revisões pedindo alteração. */
  changesRequested?: number | boolean | null;
  isDraft?: boolean | null;
}

/** `data` do `code`/`branch` (cherry-pick incluso). `fileList` vem com até 300 arquivos. */
export interface CodeDeliverableData {
  base?: string | null;
  mergeBase?: string | null;
  commits?: DeliverableCommit[] | null;
  files?: number | null;
  additions?: number | null;
  deletions?: number | null;
  truncated?: boolean | null;
  fileList?: DeliverableFileStat[] | null;
}

export interface CommitDeliverableData { title?: string | null }
export interface TicketDeliverableData { system?: string | null }
export interface DevopsStateDeliverableData { from?: string | null; to?: string | null; action?: string | null }
export interface HoursDeliverableData { hours?: number | string | null }
export interface TimelineDeliverableData { entryId?: string | number | null }

/** Extras por tipo — objeto, nunca nulo (a tela trata ausente como `{}`). */
export type WorkDeliverableData = PrDeliverableData & CodeDeliverableData & CommitDeliverableData & TicketDeliverableData
  & DevopsStateDeliverableData & HoursDeliverableData & TimelineDeliverableData & { [key: string]: unknown };

export interface WorkDeliverable {
  /** Guid da entrega gravada ou sintético (`out:57:pr`, `link:<guid>`, `pr:edv-solvace#123`) — codificar na URL. */
  id: string;
  /** Sub-tarefa (#n); nulo = do item. */
  taskNumber?: number | null;
  kind: WorkDeliverableKind;
  title?: string | null;
  url?: string | null;
  status?: WorkDeliverableStatus | null;
  repository?: string | null;
  /** pr = origem; branch/code/commit = a branch. */
  branch?: string | null;
  /** pr = destino; branch/code = base. */
  target?: string | null;
  number?: number | null;
  sha?: string | null;
  /** timeline/comment/pr-text/notify: texto curto (≤ 600); horas: "1.5". */
  text?: string | null;
  data?: WorkDeliverableData | null;
  source?: WorkDeliverableSource | null;
  reverted?: boolean | null;
  hasDiff?: boolean | null;
  at?: string | null;
}

export interface WorkDeliverableDiffFile {
  path: string;
  previousPath?: string | null;
  status?: 'modified' | 'added' | 'removed' | 'renamed' | (string & {}) | null;
  additions?: number | null;
  deletions?: number | null;
  /** Diff unificado do arquivo; ausente = binário ou grande demais. */
  patch?: string | null;
}

/** `GET WorkItems/{n}/deliverables/{id}/diff`. `error` = o GitHub não respondeu (branch apagada etc.). */
export interface WorkDeliverableDiff {
  source?: 'snapshot' | 'github' | (string & {}) | null;
  repository?: string | null;
  base?: string | null;
  head?: string | null;
  truncated?: boolean | null;
  compareUrl?: string | null;
  files?: WorkDeliverableDiffFile[] | null;
  error?: string | null;
}

const DELIVERABLE_LOOK: Record<string, { label: string; icon: string }> = {
  pr: { label: 'Pull request', icon: 'merge' },
  branch: { label: 'Branch', icon: 'call_split' },
  commit: { label: 'Commit', icon: 'commit' },
  code: { label: 'Código alterado', icon: 'code' },
  ticket: { label: 'Chamado', icon: 'confirmation_number' },
  'pr-text': { label: 'Texto do PR', icon: 'article' },
  'devops-state': { label: 'Card no DevOps', icon: 'swap_horiz' },
  comment: { label: 'Comentário no card', icon: 'chat_bubble_outline' },
  timeline: { label: 'Timeline', icon: 'timeline' },
  hours: { label: 'Horas lançadas', icon: 'schedule' },
  notify: { label: 'Aviso', icon: 'campaign' },
  doc: { label: 'Link', icon: 'link' }
};

export function deliverableLabel(kind: string | null | undefined): string {
  return DELIVERABLE_LOOK[kind ?? '']?.label ?? 'Link';
}

export function deliverableIcon(kind: string | null | undefined): string {
  return DELIVERABLE_LOOK[kind ?? '']?.icon ?? 'link';
}

/** Entregas do item; com `taskNumber`, só as daquela sub-tarefa (sem ele, todas — inclusive as do item). */
export function deliverablesOf(item: Pick<WorkItem, 'deliverables'> | null | undefined, taskNumber?: number | null): WorkDeliverable[] {
  const all = item?.deliverables ?? [];
  if (taskNumber === undefined || taskNumber === null) return all.slice();
  return all.filter((d) => d.taskNumber != null && Number(d.taskNumber) === Number(taskNumber));
}

export type DeliverableGroupKey = 'prs' | 'code' | 'tickets' | 'card' | 'other';

export interface DeliverableGroup {
  key: DeliverableGroupKey;
  label: string;
  icon: string;
  items: WorkDeliverable[];
}

/** Ordem dos grupos da aba Entregas do item; tipo fora da lista → Outros. */
export const DELIVERABLE_GROUPS: readonly { key: DeliverableGroupKey; label: string; icon: string; kinds: readonly string[] }[] = [
  { key: 'prs', label: 'Pull requests', icon: 'merge', kinds: ['pr', 'pr-text'] },
  { key: 'code', label: 'Código e branches', icon: 'code', kinds: ['code', 'branch', 'commit'] },
  { key: 'tickets', label: 'Chamados', icon: 'confirmation_number', kinds: ['ticket'] },
  { key: 'card', label: 'Card', icon: 'style', kinds: ['devops-state', 'comment', 'timeline', 'hours'] },
  { key: 'other', label: 'Outros', icon: 'link', kinds: [] }
];

export function deliverableGroupKey(kind: string | null | undefined): DeliverableGroupKey {
  return DELIVERABLE_GROUPS.find((g) => g.kinds.includes(kind ?? ''))?.key ?? 'other';
}

/** Agrupa na ordem dos grupos (só os que têm entrega), mantendo a ordem do servidor dentro de cada grupo. */
export function groupDeliverables(list: readonly WorkDeliverable[] | null | undefined): DeliverableGroup[] {
  const by = new Map<DeliverableGroupKey, WorkDeliverable[]>();
  for (const d of list ?? []) {
    const k = deliverableGroupKey(d.kind);
    const bucket = by.get(k);
    if (bucket) bucket.push(d); else by.set(k, [d]);
  }
  return DELIVERABLE_GROUPS.filter((g) => by.has(g.key)).map((g) => ({ key: g.key, label: g.label, icon: g.icon, items: by.get(g.key)! }));
}

/** Estado do PR para a tela: `draft` quando o servidor manda `draft` ou `open` com `isDraft`. */
export function prStatusOf(d: Pick<WorkDeliverable, 'status' | 'data'>): string | null {
  const s = `${d.status ?? ''}`.trim().toLowerCase();
  if (s === 'open' && d.data?.isDraft) return 'draft';
  return s || (d.data?.isDraft ? 'draft' : null);
}

const PR_STATUS_LABELS: Record<string, string> = { open: 'Aberto', merged: 'Mesclado', closed: 'Fechado', draft: 'Rascunho' };
const TICKET_STATUS_LABELS: Record<string, string> = { open: 'Aberto', resolved: 'Resolvido', closed: 'Fechado' };

export function prStatusLabel(status: string | null | undefined): string {
  return PR_STATUS_LABELS[`${status ?? ''}`.toLowerCase()] ?? (status || '');
}

export function ticketStatusLabel(status: string | null | undefined): string {
  return TICKET_STATUS_LABELS[`${status ?? ''}`.toLowerCase()] ?? (status || '');
}

/** "PR #4521 · edv-solvace" (sem número: o título ou a URL). */
export function prShortTitle(d: Pick<WorkDeliverable, 'number' | 'repository' | 'title' | 'url'>): string {
  if (d.number != null) return [`PR #${d.number}`, d.repository].filter(Boolean).join(' · ');
  return (d.title ?? '').trim() || (d.url ?? '');
}

/** URLs das entregas (para não repetir os mesmos links na lista antiga de `links`). */
export function deliverableUrls(list: readonly WorkDeliverable[] | null | undefined): Set<string> {
  return new Set((list ?? []).map((d) => (d.url ?? '').trim()).filter((u) => !!u));
}

/** Horas da entrega `hours` (`data.hours` ou o texto "1.5"); nulo quando não dá número. */
export function deliverableHours(d: Pick<WorkDeliverable, 'data' | 'text'>): number | null {
  const raw = d.data?.hours ?? d.text;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseFloat(`${raw}`.replace(',', '.'));
  return isNaN(n) ? null : n;
}

/** "1,5h" (pt-BR). */
export function formatHours(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return '';
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}h`;
}

export function shortSha(sha: string | null | undefined): string {
  return `${sha ?? ''}`.trim().slice(0, 7);
}

/** Link de PR/branch de uma sub-tarefa (sessão de execução). */
export interface TaskOutputLink {
  key: string;
  url: string;
  kind: 'pr' | 'branch' | 'link';
  title?: string | null;
  status?: string | null;
}

/**
 * Links de PR/branch da sub-tarefa (sessão de execução): as entregas `pr`/`branch` dela quando há (com URL); senão os
 * links que a sub-tarefa devolveu no `output` (como antes).
 */
export function taskDeliverableLinks(item: Pick<WorkItem, 'deliverables'> | null | undefined, task: Pick<WorkTask, 'number' | 'output'>): TaskOutputLink[] {
  const seen = new Set<string>();
  const out: TaskOutputLink[] = [];
  for (const d of deliverablesOf(item, task.number)) {
    if ((d.kind !== 'pr' && d.kind !== 'branch') || !isUrl(d.url)) continue;
    const url = d.url.trim();
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(d.kind === 'pr'
      ? { key: 'pr', url, kind: 'pr', title: prShortTitle(d), status: prStatusOf(d) }
      : { key: 'branch', url, kind: 'branch', title: d.branch || d.title || null, status: null });
  }
  return out.length ? out : taskOutputLinks(task);
}
