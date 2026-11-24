/**
 * Governança do PRMake (0098): contrato com a API (`api/v1/Governance`) e rótulos pt-BR.
 * Fonte da verdade: `features/0098/plan.md` (seção Contratos) no backend. Datas sem "Z", como no resto da API.
 */

export type GovSource = 'screen' | 'api' | 'mcp' | 'skill' | 'executor' | 'specialist' | 'hook' | 'system';
export type GovEffect = 'monitor' | 'warn' | 'block' | 'approval';
export type GovMode = 'off' | 'monitor' | 'enforce';
/** `monitored` = casou regra, mas o modo/efeito só registra ("teria barrado/avisado"). */
export type GovOutcome = 'ok' | 'error' | 'blocked' | 'warned' | 'monitored';
export type GovDecision = 'allow' | 'warn' | 'block';

export interface GovernanceEvent {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  userId: string | null;
  userName: string;
  role: string | null;
  source: GovSource;
  /** 'POST ExecutionPlan/{id}/steps/{key}/complete' | 'mcp:prmake_advance' | 'hook:PreToolUse:Bash' */
  action: string;
  category: string;
  cardNumber: number | null;
  planId: string | null;
  phase: string | null;
  stepKey: string | null;
  workItemNumber: number | null;
  taskNumber: number | null;
  outcome: GovOutcome;
  statusCode: number | null;
  rules: string[];
  detail: string | null;
  sessionId: string | null;
  machine: string | null;
}

export interface GovernanceRuleScope {
  roles: string[];
  users: string[];
  sources: GovSource[];
  cardTypes: string[];
  exceptRoles: string[];
}

export interface GovernanceRuleMatch {
  /** glob sobre GovernanceEvent.action */
  actions: string[];
  /** glob sobre a ferramenta do Claude Code */
  tools: string[];
  /** regex (sem diferenciar maiúsculas) — basta UMA casar */
  patterns: string[];
  /** regex que precisam casar TODAS (além de `patterns`) */
  allOf: string[];
  /** glob sobre caminho de arquivo */
  paths: string[];
}

export interface GovernanceRule {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  effect: GovEffect;
  builtin: boolean;
  order: number;
  message: string;
  scope: GovernanceRuleScope;
  match: GovernanceRuleMatch;
  updatedAt: string | null;
  updatedBy: string | null;
}

export type GovHookAction = 'record' | 'evaluate' | 'timeline' | 'webhook';

export interface GovernanceHook {
  id: string;
  key: string;
  name: string;
  description: string;
  /** 'claude:PreToolUse' … ou 'server:<glob da action>' */
  event: string;
  /** glob da ferramenta (claude:*ToolUse) ou da categoria (server:*); '' = tudo */
  matcher: string;
  action: GovHookAction;
  config: Record<string, string>;
  enabled: boolean;
  builtin: boolean;
  order: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export type MilestoneFrom = 'plan' | 'step' | 'work-item' | 'task' | 'event' | 'request';
export type MilestoneAt = 'created' | 'started' | 'finished';

export interface Milestone {
  key: string;
  label: string;
  order: number;
  from: MilestoneFrom;
  phase?: 'analysis' | 'correction';
  match?: string;
  at: MilestoneAt;
}

export interface GovernanceSettings {
  mode: GovMode;
  retentionDays: number;
  hookFailOpen: boolean;
  hookTimeoutMs: number;
  hookCacheSeconds: number;
  exemptRoles: string[];
  recordSources: GovSource[];
  milestones: Milestone[];
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface EvaluateRequest {
  source: GovSource;
  event?: string;
  tool?: string;
  input?: string;
  path?: string;
  action?: string;
  cardNumber?: number;
  sessionId?: string;
  machine?: string;
  cwd?: string;
}

export interface EvaluateRuleHit {
  key: string;
  name: string;
  effect: GovEffect;
  message: string;
}

export interface EvaluateResponse {
  decision: GovDecision;
  /** Decisão se o modo fosse `enforce`. */
  wouldDecide?: GovDecision;
  mode: GovMode;
  reason: string | null;
  rules: EvaluateRuleHit[];
}

export interface GovPage<T> {
  total: number;
  items: T[];
}

export interface GovKeyCount {
  key: string;
  count: number;
}

export interface GovernanceOverview {
  kpis: {
    events: number; users: number; cards: number; plansStarted: number; analysesDone: number; correctionsDone: number;
    workItemsDone: number; tasksDone: number; blocked: number; warned: number; errors: number;
    medianAnalysisMs: number | null; medianCorrectionMs: number | null; medianFirstAnalysisMs: number | null;
    aiCostUsd: number | null;
  };
  perDay: { day: string; events: number; blocked: number; warned: number; errors: number }[];
  bySource: GovKeyCount[];
  topActions: { key: string; count: number; medianMs: number | null }[];
  topRules: { key: string; name: string; count: number; blocked: number }[];
}

export interface GovernanceUserRow {
  userId: string;
  userName: string;
  events: number;
  cards: number;
  plansStarted: number;
  analysesDone: number;
  medianAnalysisMs: number | null;
  workItems: number;
  tasksDone: number;
  medianTaskMs: number | null;
  blocked: number;
  warned: number;
  errors: number;
  aiCostUsd: number | null;
  lastActivityAt: string | null;
}

export interface CardMilestoneHit {
  key: string;
  label: string;
  at: string;
}

export interface GovernanceCardRow {
  cardNumber: number;
  title: string;
  kind: string;
  users: string[];
  firstActivityAt: string | null;
  lastActivityAt: string | null;
  milestones: CardMilestoneHit[];
  analysisMs: number | null;
  correctionMs: number | null;
  leadTimeMs: number | null;
  workItems: number;
  tasksDone: number;
  blocked: number;
  status: string | null;
}

/**
 * `GET users/{id}`: o contrato diz "resumo + cards: CardRow[] + recent", mas o resumo já tem `cards` (número).
 * A tela aceita o formato plano (a lista substitui o número) e o aninhado (`summary`/`user`) — ver `normalizeUserDetail`.
 */
export interface GovernanceUserDetail {
  summary: GovernanceUserRow;
  cards: GovernanceCardRow[];
  recent: GovernanceEvent[];
}

export type TimelineKind = 'milestone' | 'plan' | 'step' | 'work-item' | 'task' | 'request' | 'event';

export interface TimelineRow {
  at: string;
  endAt: string | null;
  durationMs: number | null;
  kind: TimelineKind;
  title: string;
  user: string | null;
  outcome: string | null;
  ref: string | null;
}

export interface GovernanceCardDetail {
  card: GovernanceCardRow;
  timeline: TimelineRow[];
}

export interface GovernanceTaskRow {
  kind: string;
  source: 'step' | 'task' | 'request';
  count: number;
  done: number;
  failed: number;
  medianMs: number | null;
  p90Ms: number | null;
  users: number;
}

/** Corpo do 403 de ação barrada (HTTP). */
export interface GovernanceBlockedBody {
  code: 'governance_blocked';
  message: string;
  rules?: (EvaluateRuleHit | string)[];
}

export const GOVERNANCE_BLOCKED = 'governance_blocked';
export const GOVERNANCE_WARNING_HEADER = 'X-Governance-Warning';

// ---- rótulos pt-BR ----

export const SOURCE_LABEL: Record<GovSource, string> = {
  screen: 'Tela',
  api: 'API',
  mcp: 'MCP',
  skill: 'Skill',
  executor: 'Executor',
  specialist: 'Especialista',
  hook: 'Hook do Claude Code',
  system: 'Sistema',
};
export const SOURCES = Object.keys(SOURCE_LABEL) as GovSource[];

export const EFFECT_LABEL: Record<GovEffect, string> = {
  monitor: 'Monitorar',
  warn: 'Avisar',
  block: 'Bloquear',
  approval: 'Exigir aprovação',
};
export const EFFECT_HINT: Record<GovEffect, string> = {
  monitor: 'Só registra na trilha; ninguém percebe.',
  warn: 'Deixa passar e mostra o aviso para quem agiu.',
  block: 'Barra a ação e mostra a mensagem.',
  approval: 'Barra até um admin aprovar (nesta versão funciona como bloquear, com "precisa de aprovação").',
};
export const EFFECTS = Object.keys(EFFECT_LABEL) as GovEffect[];

export const MODE_LABEL: Record<GovMode, string> = {
  off: 'Desligada',
  monitor: 'Monitorando',
  enforce: 'Aplicando',
};
export const MODE_HINT: Record<GovMode, string> = {
  off: 'Nada é avaliado nem registrado. As regras ficam guardadas, mas sem efeito.',
  monitor: 'Tudo é registrado e as regras são avaliadas, mas nada é barrado: o que seria barrado ou avisado aparece na trilha como "teria barrado/avisado". Use para medir antes de aplicar.',
  enforce: 'As regras valem de verdade: ações com efeito "bloquear" são barradas e as de "avisar" mostram o aviso — nas telas, no MCP e nos hooks do Claude Code (terminal e executor).',
};
export const MODES = Object.keys(MODE_LABEL) as GovMode[];

export const OUTCOME_LABEL: Record<GovOutcome, string> = {
  ok: 'Ok',
  error: 'Erro',
  blocked: 'Barrado',
  warned: 'Avisado',
  monitored: 'Teria barrado/avisado',
};
export const OUTCOMES = Object.keys(OUTCOME_LABEL) as GovOutcome[];

/** 0098: situação de plano/item/sub-tarefa/pedido vinda do backend (inglês) → rótulo da tela. */
export const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente', queued: 'Na fila', claimed: 'Pego pelo executor', running: 'Em andamento', paused: 'Pausado',
  waiting: 'Aguardando', completed: 'Concluído', done: 'Concluído', failed: 'Falhou', cancelled: 'Cancelado',
  expired: 'Expirado', skipped: 'Pulado', reverting: 'Desfazendo', reverted: 'Desfeito',
};
export const statusLabel = (s: string | null | undefined): string => (s ? STATUS_LABEL[s] ?? s : '—');
/** Fim da frase "levou X até …" da linha do tempo do card. */
export const statusUntil = (s: string | null | undefined): string =>
  s === 'completed' ? 'concluir' : s === 'cancelled' ? 'ser cancelado' : s === 'failed' ? 'falhar' : 'a última atividade';

export const DECISION_LABEL: Record<GovDecision, string> = {
  allow: 'Deixa passar',
  warn: 'Deixa passar com aviso',
  block: 'Barra',
};

export const RULE_CATEGORY_LABEL: Record<string, string> = {
  fluxo: 'Fluxo',
  git: 'Git',
  dados: 'Dados',
  credenciais: 'Credenciais',
  integracoes: 'Integrações',
  custo: 'Custo',
  qualidade: 'Qualidade',
};
export const RULE_CATEGORIES = Object.keys(RULE_CATEGORY_LABEL);

export const EVENT_CATEGORY_LABEL: Record<string, string> = {
  plan: 'Plano',
  step: 'Etapa',
  question: 'Pergunta',
  'work-item': 'Item de trabalho',
  task: 'Sub-tarefa',
  queue: 'Fila do executor',
  devops: 'DevOps',
  pr: 'Pull request',
  timeline: 'Timeline',
  case: 'Caso (especialista)',
  config: 'Configuração',
  governance: 'Governança',
  standard: 'Padrão (0101)',
  knowledge: 'Base Solvace',
  session: 'Sessão',
  tool: 'Ferramenta',
  other: 'Outros',
};
export const EVENT_CATEGORIES = Object.keys(EVENT_CATEGORY_LABEL);

export const HOOK_ACTION_LABEL: Record<GovHookAction, string> = {
  record: 'Registrar na trilha',
  evaluate: 'Avaliar as regras',
  timeline: 'Avisar na Timeline do card',
  webhook: 'Chamar webhook',
};
export const HOOK_ACTIONS = Object.keys(HOOK_ACTION_LABEL) as GovHookAction[];

export const HOOK_EVENT_LABEL: Record<string, string> = {
  'claude:SessionStart': 'Claude Code: sessão iniciada',
  'claude:UserPromptSubmit': 'Claude Code: pedido enviado',
  'claude:PreToolUse': 'Claude Code: antes de cada ferramenta',
  'claude:PostToolUse': 'Claude Code: depois de cada ferramenta',
  'claude:Stop': 'Claude Code: resposta concluída',
  'claude:SubagentStop': 'Claude Code: subagente concluído',
};
export const CLAUDE_HOOK_EVENTS = Object.keys(HOOK_EVENT_LABEL);

export const TIMELINE_KIND_LABEL: Record<TimelineKind, string> = {
  milestone: 'Marco',
  plan: 'Plano',
  step: 'Etapa',
  'work-item': 'Item de trabalho',
  task: 'Sub-tarefa',
  request: 'Pedido do executor',
  event: 'Evento',
};
export const TIMELINE_KIND_ICON: Record<TimelineKind, string> = {
  milestone: 'flag',
  plan: 'assignment',
  step: 'checklist',
  'work-item': 'work',
  task: 'task_alt',
  request: 'smart_toy',
  event: 'bolt',
};

export const TASK_SOURCE_LABEL: Record<GovernanceTaskRow['source'], string> = {
  step: 'Etapa do plano',
  task: 'Sub-tarefa',
  request: 'Pedido do executor',
};

export const MILESTONE_FROM_LABEL: Record<MilestoneFrom, string> = {
  plan: 'Plano',
  step: 'Etapa do plano',
  'work-item': 'Item de trabalho',
  task: 'Sub-tarefa',
  event: 'Evento da trilha',
  request: 'Pedido do executor',
};
export const MILESTONE_FROMS = Object.keys(MILESTONE_FROM_LABEL) as MilestoneFrom[];
export const MILESTONE_AT_LABEL: Record<MilestoneAt, string> = {
  created: 'criado',
  started: 'iniciado',
  finished: 'concluído',
};
export const MILESTONE_ATS = Object.keys(MILESTONE_AT_LABEL) as MilestoneAt[];

/** Papéis do PRMake (Cime.Auth). */
export const ROLES = ['admin', 'support', 'user', 'gestor', 'management'];
export const ROLE_LABEL: Record<string, string> = { admin: 'Admin', support: 'Suporte', user: 'Usuário', gestor: 'Gestor', management: 'Gestão' };
export const CARD_TYPES = ['Bug', 'User Story', 'Task', 'Feature'];

export function labelOf(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return '—';
  return map[key] ?? key;
}

// ───────────────────────── 0101: padrões de banco e de aplicação ─────────────────────────
// Fonte da verdade: `features/0101/plan.md` (Contratos) no backend. Padrão ≠ regra: é convenção que a análise e a
// correção seguem ao escrever SQL, migrações e código; achados entram na trilha com a categoria `standard`.

export type StandardArea = 'database' | 'application';
export type StandardStatus = 'proposed' | 'active' | 'deprecated';
export type StandardEffect = 'monitor' | 'warn' | 'block';
/** `builtin` = conferência embutida no código do backend (ex.: nome de FK fora do padrão); `pattern` = nome dela. */
export type StandardCheckKind = 'none' | 'regex' | 'path' | 'sql' | 'builtin';
export type StandardCheckTarget = 'sql' | 'migration' | 'code' | 'path';
export type StandardObjectScope = 'new' | 'migrated' | 'legacy';
export type StandardSourceKind = 'wiki' | 'reverse-engineering' | 'manual';

export interface StandardCheck {
  kind: StandardCheckKind;
  target: StandardCheckTarget | null;
  pattern: string | null;
  /** true = o texto/caminho PRECISA casar (não casar é o achado); false = casar é o achado. */
  mustMatch: boolean;
  sql: string | null;
  /** Dica mostrada no achado (o backend aceita; fora do contrato da 0101). */
  hint?: string | null;
}

export interface Standard {
  id: string;
  /** 'db-fk7', 'app-revamp-actionplan-layers' */
  key: string;
  /** ID na origem: 'FK7' */
  code: string;
  area: StandardArea;
  /** table|column|schema|pk|fk|index|unique-index|default|check|view|procedure|query|general | layers|folders|naming|api|data-access|migrations */
  topic: string;
  title: string;
  textPt: string;
  textEn: string | null;
  examples: { good: string[]; bad: string[] };
  appliesTo: { platforms: string[]; repositories: string[]; modules: string[]; objects: StandardObjectScope[] };
  source: { kind: StandardSourceKind; ref: string; version: string | null; url: string | null };
  status: StandardStatus;
  effect: StandardEffect;
  check: StandardCheck;
  order?: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface StandardFinding {
  key: string;
  code: string;
  title: string;
  effect: string;
  line: number | null;
  excerpt: string;
  hint: string;
}

export interface StandardCheckRequest {
  text: string;
  target: StandardCheckTarget;
  path?: string;
  repository?: string;
  card?: number;
}

export interface StandardCheckResponse {
  decision: GovDecision;
  findings: StandardFinding[];
  /** Se a API mandar (como no evaluate da 0098). */
  mode?: GovMode;
  wouldDecide?: GovDecision;
}

export interface StandardFilter {
  area?: StandardArea | null;
  status?: StandardStatus | null;
  topic?: string | null;
  repository?: string | null;
  module?: string | null;
  search?: string | null;
}

/** Item alterado no rascunho de importação: o antes (catálogo) e o depois (origem). */
export interface StandardDraftChange {
  before: Standard;
  after: Standard;
}

/**
 * Rascunho de importação (wiki ou engenharia reversa). O contrato diz `{ id, added[], changed[], removed[], version }`;
 * `changed` pode vir como `{ before, after }` ou só o padrão novo, e `removed` como padrões ou chaves —
 * `normalizeDraft` aceita os dois formatos.
 */
export interface StandardDraft {
  id: string;
  added: Standard[];
  changed: (StandardDraftChange | Standard)[];
  removed: (Standard | string)[];
  version: string | null;
  source?: StandardSourceKind | null;
  url?: string | null;
  modules?: string[] | null;
  createdAt?: string | null;
  createdBy?: string | null;
}

export interface StandardImportResult {
  added?: number;
  changed?: number;
  removed?: number;
  applied?: number;
}

/** Módulo da engenharia reversa (para importar a estrutura de aplicação). */
export interface StandardModuleOption {
  key: string;
  name: string;
  published: boolean;
}

/** Página 236 da wiki "Data Nomenclature and Rules (Nomenclatura e Regras de dados)". */
export const STANDARDS_WIKI_URL =
  'https://dev.azure.com/solvacelabs/Solvace%20Product%20Improvement/_wiki/wikis/Solvace-Product-Improvement.wiki/236';

export const STANDARD_AREA_LABEL: Record<StandardArea, string> = {
  database: 'Banco de dados',
  application: 'Aplicação',
};
export const STANDARD_AREAS = Object.keys(STANDARD_AREA_LABEL) as StandardArea[];

export const STANDARD_TOPIC_LABEL: Record<string, string> = {
  general: 'Regras gerais',
  schema: 'Schema',
  table: 'Tabela',
  column: 'Coluna e nomes',
  pk: 'Chave primária',
  fk: 'Chave estrangeira',
  index: 'Índice',
  'unique-index': 'Índice único',
  default: 'Default',
  check: 'Check',
  view: 'View',
  procedure: 'Procedure',
  query: 'Consultas e tipos',
  layers: 'Camadas',
  folders: 'Pastas',
  naming: 'Nomes',
  api: 'API / endpoints',
  'data-access': 'Acesso a dados',
  migrations: 'Migrações',
};
/** Ordem dos assuntos na lista (os desconhecidos vão para o fim). */
export const STANDARD_TOPICS = Object.keys(STANDARD_TOPIC_LABEL);

export const STANDARD_STATUS_LABEL: Record<StandardStatus, string> = {
  proposed: 'Proposto',
  active: 'Vigente',
  deprecated: 'Descontinuado',
};
export const STANDARD_STATUS_HINT: Record<StandardStatus, string> = {
  proposed: 'Proposta (ex.: itens (NEW) da wiki): aguarda o DBA. Só monitora, qualquer que seja o efeito.',
  active: 'Vale: a análise e a correção seguem; a conferência aplica o efeito.',
  deprecated: 'Não vale mais: fica guardado para histórico e só monitora.',
};
export const STANDARD_STATUSES = Object.keys(STANDARD_STATUS_LABEL) as StandardStatus[];

export const STANDARD_EFFECTS: StandardEffect[] = ['monitor', 'warn', 'block'];

export const STANDARD_CHECK_KIND_LABEL: Record<StandardCheckKind, string> = {
  none: 'Sem conferência',
  regex: 'Expressão regular no texto',
  path: 'Caminho do arquivo (glob)',
  sql: 'Consulta de validação (banco)',
  builtin: 'Conferência embutida',
};
export const STANDARD_CHECK_KIND_HINT: Record<StandardCheckKind, string> = {
  none: 'Só orienta a análise e a correção; nada é conferido automaticamente.',
  regex: 'Procura a expressão no SQL/DDL/código gravado pelas skills ou editado no Claude Code.',
  path: 'Confere onde o arquivo fica (glob, ** atravessa pastas).',
  sql: 'Consulta somente leitura da wiki, rodada sob demanda pela skill no banco de um ambiente; cada linha devolvida é um achado.',
  builtin: 'Conferência feita pelo código do PRMake (ex.: nome de FK fora do padrão); o padrão abaixo é o nome dela.',
};
export const STANDARD_CHECK_KINDS = Object.keys(STANDARD_CHECK_KIND_LABEL) as StandardCheckKind[];

export const STANDARD_CHECK_TARGET_LABEL: Record<StandardCheckTarget, string> = {
  sql: 'SQL / DDL',
  migration: 'Migração',
  code: 'Código',
  path: 'Caminho',
};
export const STANDARD_CHECK_TARGETS = Object.keys(STANDARD_CHECK_TARGET_LABEL) as StandardCheckTarget[];

export const STANDARD_OBJECT_LABEL: Record<StandardObjectScope, string> = {
  new: 'Objetos novos',
  migrated: 'Módulos em migração',
  legacy: 'Legado (dbo)',
};
export const STANDARD_OBJECTS = Object.keys(STANDARD_OBJECT_LABEL) as StandardObjectScope[];

export const STANDARD_SOURCE_LABEL: Record<StandardSourceKind, string> = {
  wiki: 'Wiki',
  'reverse-engineering': 'Engenharia reversa',
  manual: 'Manual',
};
export const STANDARD_SOURCES = Object.keys(STANDARD_SOURCE_LABEL) as StandardSourceKind[];

export const STANDARD_PLATFORMS = ['sqlserver', 'postgresql', 'dotnet', 'angular', 'node'];
