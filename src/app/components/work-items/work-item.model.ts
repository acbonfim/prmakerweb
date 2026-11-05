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
export type TaskKind = 'branch' | 'cherry-pick' | 'code' | 'pr' | 'devops-state' | 'sql-script' | 'validation' | 'comment' | 'manual'
  | 'ticket' | 'notify' | (string & {});
/**
 * Controle do parâmetro no editor (rodada 3): `repository`/`branch`/`target-branch` = autocomplete pesquisável,
 * `state` = estados do card no DevOps, `commits` = seletor de commits, `select` = `options`. Sem `input` no catálogo,
 * o editor deduz pelo nome do parâmetro (`paramInput` em work-item-pickers).
 */
export type TaskParamInput = 'repository' | 'branch' | 'target-branch' | 'state' | 'commits' | 'text' | 'textarea' | 'select';
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
  /** JSON livre gravado pelo executor (objeto, na maioria das vezes). */
  output?: unknown;
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
  notify: { label: 'Avisar', icon: 'campaign' }
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

/** Os itens em execução no topo (em ordem de número); o resto mantém a ordem recebida. */
export function sortExecutingFirst<T extends Pick<WorkItem, 'status' | 'number'>>(items: readonly T[]): T[] {
  const live = items.filter((x) => isExecutingItem(x)).sort((a, b) => a.number - b.number);
  return [...live, ...items.filter((x) => !isExecutingItem(x))];
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

/** Links de PR do item (links `pr` + saídas das sub-tarefas que são URL de PR), sem repetir. */
export function pullRequestLinks(item: Pick<WorkItem, 'links' | 'tasks'> | null | undefined): { title: string; url: string }[] {
  if (!item) return [];
  const out: { title: string; url: string }[] = [];
  const seen = new Set<string>();
  const add = (url: string | null | undefined, title: string | null | undefined) => {
    const u = (url ?? '').trim();
    if (!isUrl(u) || seen.has(u)) return;
    seen.add(u);
    out.push({ title: (title ?? '').trim() || u, url: u });
  };
  for (const l of item.links ?? []) if (l.kind === 'pr' || PR_URL.test(l.url ?? '')) add(l.url, l.title);
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
