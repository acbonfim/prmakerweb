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
export const ROLES = ['admin', 'support', 'user', 'gestor'];
export const ROLE_LABEL: Record<string, string> = { admin: 'Admin', support: 'Suporte', user: 'Usuário', gestor: 'Gestor' };
export const CARD_TYPES = ['Bug', 'User Story', 'Task', 'Feature'];

export function labelOf(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return '—';
  return map[key] ?? key;
}
