import { Observable, delay, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { GovCardFilter, GovEventFilter, GovRange, GovernanceApi, RuleTestRequest } from './governance-api.service';
import {
  EvaluateResponse, GovOutcome, GovPage, GovSource, GovernanceCardDetail, GovernanceCardRow, GovernanceEvent, GovernanceHook,
  GovernanceOverview, GovernanceRule, GovernanceSettings, GovernanceTaskRow, GovernanceUserDetail, GovernanceUserRow, SOURCES,
  Standard, StandardCheckRequest, StandardCheckResponse, StandardDraft, StandardFilter, StandardImportResult, StandardModuleOption,
  TimelineRow,
} from './governance.model';
import { evaluateLocally, median, normalizeRule, percentile } from './governance.logic';
import { changedFields, checkLocally, filterStandards, normalizeStandard } from './standards.logic';
import { DEMO_MODULES, DEMO_STANDARDS, appStandardsFor, demoWikiSnapshot } from './standards.demo';
import { parseApiDate } from '../usage/usage.model';

/**
 * Dados de demonstração da governança (0098) — `?exemplo=1` em desenvolvimento, sem backend. Gera ~30 cards com
 * planos, etapas, itens, sub-tarefas, pedidos do executor e eventos (alguns barrados/avisados) nos últimos 40 dias;
 * as agregações saem desses dados, então os números batem entre as abas. Gravar (regras, hooks, configurações) só
 * muda a memória da tela.
 */

const H = 3_600_000;
const M = 60_000;

export const DEMO_RULES: GovernanceRule[] = [
  rule('no-merge', 'Nunca mesclar PR', 'git', 'block', 10, 'O Claude só abre PR; o merge é sempre humano.',
    { tools: ['Bash'], patterns: ['\\bgh\\s+pr\\s+merge\\b', '\\bgh\\s+pr\\s+review\\b.*--approve', '\\bgit\\s+merge\\b'] }),
  rule('no-force-push', 'Sem push forçado', 'git', 'block', 20, 'Push forçado reescreve o histórico de outras pessoas.',
    { tools: ['Bash'], patterns: ['git\\s+push\\s.*(--force\\b|-f\\b|--force-with-lease)'] }),
  rule('no-push-protected', 'Sem push em branch protegida', 'git', 'block', 30, 'master, main, develop e release só recebem código por PR.',
    { tools: ['Bash'], patterns: ['git\\s+push\\s.*\\s(master|main|develop|release[^ ]*)\\b'] }),
  rule('no-destructive-rm', 'Sem rm -rf na raiz/home', 'git', 'block', 40, 'Apagar a raiz ou a pasta pessoal não é permitido.',
    { tools: ['Bash'], patterns: ['rm\\s+-rf\\s+(/|~|\\$HOME)(\\s|$)'] }),
  rule('writes-through-prmake', 'Gravações pelo PRMake', 'integracoes', 'block', 50,
    'Gravações no DevOps, GitHub e Teams passam pelos endpoints do PRMake (prmake_*), nunca direto.',
    { tools: ['Bash'], allOf: ['(curl|gh\\s+api|\\baz\\s)', '(dev\\.azure\\.com|api\\.github\\.com|graph\\.microsoft\\.com)', '(-X\\s*(POST|PUT|PATCH|DELETE)|--method\\s+(POST|PUT|PATCH|DELETE))'] }),
  rule('no-db-writes', 'Banco somente leitura', 'dados', 'block', 60, 'Nas análises o banco é só leitura: gere o script no plano de correção.',
    { tools: ['Bash', 'mcp__*sql*'], allOf: ['(psql|mysql|sqlcmd|sqlite3|query)', '\\b(insert|update|delete|merge|drop|alter|truncate|create)\\b'] }),
  rule('no-cognito-writes', 'Cognito somente leitura', 'dados', 'block', 70, 'Usuários do Cognito não são alterados pelas skills.',
    { tools: ['Bash'], patterns: ['aws\\s+cognito-idp\\s+(admin-)?(create|delete|update|set|disable|enable)'] }),
  rule('protect-credentials', 'Credenciais protegidas', 'credenciais', 'block', 80, 'Arquivos de credenciais não são lidos pelo Claude.',
    { paths: ['**/solvace-env-credentials.json', '**/.prmake/db-credentials*', '**/.aws/credentials'] }),
  rule('no-invented-branch', 'Branch das regras do card', 'fluxo', 'monitor', 90, 'Use a branch que as regras do card indicam.',
    { actions: ['mcp:prmake_pr_open', 'POST *pull*'] }),
  rule('ai-cost-daily', 'Teto diário de custo de IA', 'custo', 'warn', 100, 'Você passou do orçamento diário de IA configurado no seu perfil.',
    { actions: ['POST ExecutionQueue*'] }, { sources: ['executor'] }),
  { ...rule('qa-only-support', 'Ready for QA só pelo suporte', 'qualidade', 'warn', 110, 'Mover para Ready for QA é com o suporte; avise no card.',
    { actions: ['POST Azure/card/*/actions/ready-for-qa'] }, { roles: ['user'] }), builtin: false, updatedBy: 'Alex Carlos', updatedAt: '2026-11-20T10:12:00' },
];

export const DEMO_HOOKS: GovernanceHook[] = [
  hook('claude-session', 'Sessão iniciada', 'claude:SessionStart', '', 'record', 10),
  hook('claude-prompt', 'Pedido enviado (só tamanho e card)', 'claude:UserPromptSubmit', '', 'record', 20),
  hook('claude-pretool', 'Avaliar antes de cada ferramenta', 'claude:PreToolUse', '', 'evaluate', 30),
  hook('claude-posttool', 'Registrar ferramentas', 'claude:PostToolUse', 'Bash|Write|Edit|mcp__prmake__*', 'record', 40),
  hook('claude-stop', 'Resposta concluída', 'claude:Stop', '', 'record', 50),
  { ...hook('server-blocked-timeline', 'Barrado → Timeline do card', 'server:*', 'governance', 'timeline', 60), enabled: false,
    config: { template: '{user} foi barrado pela regra {rule} ao tentar {action} no card {card}' } },
  { ...hook('pr-aberto-webhook', 'PR aberto → webhook do time', 'server:mcp:prmake_pr_open', 'pr', 'webhook', 70), builtin: false, enabled: false,
    config: { url: 'https://hooks.exemplo.com/prmake/pr', secret: '***' }, updatedAt: '2026-11-21T15:40:00', updatedBy: 'Alex Carlos' },
];

export const DEMO_SETTINGS: GovernanceSettings = {
  mode: 'monitor', retentionDays: 180, hookFailOpen: true, hookTimeoutMs: 1500, hookCacheSeconds: 60,
  exemptRoles: [], recordSources: [...SOURCES],
  milestones: [
    { key: 'iniciou', label: 'Iniciou a tarefa', order: 10, from: 'plan', phase: 'analysis', at: 'created' },
    { key: 'analise-inicial', label: 'Análise inicial', order: 20, from: 'plan', phase: 'analysis', at: 'finished' },
    { key: 'prototipo', label: 'Protótipo inicial', order: 30, from: 'step', phase: 'correction', match: 'prototipo*', at: 'finished' },
    { key: 'solucao', label: 'Solução escolhida', order: 40, from: 'step', phase: 'analysis', match: 'solucoes*', at: 'finished' },
    { key: 'correcao', label: 'Correção iniciada', order: 50, from: 'plan', phase: 'correction', at: 'started' },
    { key: 'pr', label: 'PR aberto', order: 60, from: 'task', match: 'pr-open', at: 'finished' },
    { key: 'qa', label: 'QA', order: 70, from: 'event', match: 'POST Azure/card/*/actions/ready-for-qa', at: 'finished' },
    { key: 'fechado', label: 'Fechado', order: 80, from: 'event', match: 'POST Azure/card/*/actions/close*', at: 'finished' },
  ],
  updatedAt: '2026-11-24T09:00:00', updatedBy: 'Sistema',
};

const USERS = [
  { id: 'u-alex', name: 'Alex Carlos', role: 'admin' },
  { id: 'u-bruna', name: 'Bruna Lima', role: 'support' },
  { id: 'u-caio', name: 'Caio Souza', role: 'user' },
  { id: 'u-dani', name: 'Daniela Rocha', role: 'support' },
  { id: 'u-edu', name: 'Eduardo Prado', role: 'user' },
  { id: 'u-fer', name: 'Fernanda Melo', role: 'gestor' },
];

const TITLES = [
  'Erro ao salvar plano de ação com anexo', 'Relatório de perdas não carrega filtros', 'Lentidão na tela de auditorias',
  'Importação de pilares falha com acento', 'Gráfico de tendência sem dados de outubro', 'Permissão de gestor não abre KPI',
  'Exportar Excel com colunas trocadas', 'Notificação duplicada no Teams', 'Card de QA sem evidência anexada',
  'Campo obrigatório some após editar', 'Usuário sem acesso à planta nova', 'Data de vencimento com fuso errado',
  'Painel de 5S não atualiza', 'Busca por código ignora zeros à esquerda', 'Login SSO volta para a tela inicial',
];

interface DemoCard {
  row: GovernanceCardRow;
  timeline: TimelineRow[];
}

export class GovernanceDemoApi implements GovernanceApi {
  private readonly rand = mulberry32(98);
  private readonly now = Date.now();
  private rulesState = DEMO_RULES.map((r) => structuredClone(r));
  private hooksState = DEMO_HOOKS.map((h) => structuredClone(h));
  private settingsState: GovernanceSettings = structuredClone(DEMO_SETTINGS);
  private readonly cardsState: DemoCard[] = [];
  private readonly eventsState: GovernanceEvent[] = [];
  private changesState: GovernanceEvent[] = [];
  private standardsState: Standard[] = DEMO_STANDARDS.map((s) => structuredClone(s));
  private readonly drafts = new Map<string, StandardDraft>();
  private nextId = 1;

  constructor() {
    for (let i = 0; i < 30; i++) this.genCard(i);
    this.genStandardFindings();
    this.eventsState.sort((a, b) => (parseApiDate(b.startedAt) ?? 0) - (parseApiDate(a.startedAt) ?? 0));
    this.changesState = [
      this.ev({ user: USERS[0], source: 'screen', action: 'PUT Governance/rules/{id}', category: 'governance', start: this.now - 4 * 24 * H, dur: 180, detail: 'qa-only-support: efeito Monitorar → Avisar' }),
      this.ev({ user: USERS[0], source: 'screen', action: 'PUT Governance/settings', category: 'governance', start: this.now - 6 * 24 * H, dur: 140, detail: 'Modo: Desligada → Monitorando' }),
    ];
  }

  // ---- leituras ----

  overview(r: GovRange): Observable<GovernanceOverview> {
    const ev = this.inRange(r);
    const cards = this.cardsInRange(r);
    const analysisMs = cards.map((c) => c.row.analysisMs).filter((x): x is number => x != null);
    const correctionMs = cards.map((c) => c.row.correctionMs).filter((x): x is number => x != null);
    const firstAnalysis = cards.map((c) => msBetween(c.row.milestones, 'iniciou', 'analise-inicial')).filter((x): x is number => x != null);
    const perDay = new Map<string, { day: string; events: number; blocked: number; warned: number; errors: number }>();
    for (const e of ev) {
      const day = e.startedAt.slice(0, 10);
      const d = perDay.get(day) ?? { day, events: 0, blocked: 0, warned: 0, errors: 0 };
      d.events++;
      if (e.outcome === 'blocked') d.blocked++;
      if (e.outcome === 'warned') d.warned++;
      if (e.outcome === 'error') d.errors++;
      perDay.set(day, d);
    }
    const actions = groupBy(ev, (e) => e.action);
    const ruleHits = new Map<string, { count: number; blocked: number }>();
    for (const e of ev) for (const k of e.rules) {
      const x = ruleHits.get(k) ?? { count: 0, blocked: 0 };
      x.count++;
      if (e.outcome === 'blocked') x.blocked++;
      ruleHits.set(k, x);
    }
    const rows = this.allTimelineRows(r);
    return later({
      kpis: {
        events: ev.length,
        users: new Set(ev.map((e) => e.userId)).size,
        cards: cards.length,
        plansStarted: rows.filter((x) => x.kind === 'plan').length,
        analysesDone: cards.filter((c) => c.row.analysisMs != null).length,
        correctionsDone: cards.filter((c) => c.row.correctionMs != null).length,
        workItemsDone: rows.filter((x) => x.kind === 'work-item' && x.outcome === 'ok').length,
        tasksDone: rows.filter((x) => x.kind === 'task' && x.outcome === 'ok').length,
        blocked: ev.filter((e) => e.outcome === 'blocked').length,
        warned: ev.filter((e) => e.outcome === 'warned').length,
        errors: ev.filter((e) => e.outcome === 'error').length,
        medianAnalysisMs: median(analysisMs),
        medianCorrectionMs: median(correctionMs),
        medianFirstAnalysisMs: median(firstAnalysis),
        aiCostUsd: round2(cards.length * 0.83),
      },
      perDay: [...perDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
      bySource: [...groupBy(ev, (e) => e.source).entries()].map(([key, list]) => ({ key, count: list.length })),
      topActions: [...actions.entries()]
        .map(([key, list]) => ({ key, count: list.length, medianMs: median(list.map((e) => e.durationMs ?? 0)) }))
        .sort((a, b) => b.count - a.count).slice(0, 12),
      topRules: [...ruleHits.entries()]
        .map(([key, v]) => ({ key, name: this.rulesState.find((x) => x.key === key)?.name ?? this.standardsState.find((x) => x.key === key)?.title ?? key, ...v }))
        .sort((a, b) => b.count - a.count),
    });
  }

  users(r: GovRange): Observable<GovernanceUserRow[]> {
    return later(USERS.map((u) => this.userRow(u, r)).filter((u) => u.events > 0));
  }

  user(userId: string, r: GovRange): Observable<GovernanceUserDetail> {
    const u = USERS.find((x) => x.id === userId);
    if (!u) return failLater(404, 'Usuário não encontrado.');
    return later({
      summary: this.userRow(u, r),
      cards: this.cardsInRange(r).filter((c) => c.row.users.includes(u.name)).map((c) => c.row),
      recent: this.inRange(r).filter((e) => e.userId === u.id).slice(0, 50),
    });
  }

  cards(f: GovCardFilter): Observable<GovPage<GovernanceCardRow>> {
    const q = (f.search ?? '').trim().toLowerCase();
    const userName = USERS.find((u) => u.id === f.user)?.name;
    let list = this.cardsInRange(f).map((c) => c.row);
    if (q) list = list.filter((c) => `${c.cardNumber}`.includes(q) || c.title.toLowerCase().includes(q));
    if (userName) list = list.filter((c) => c.users.includes(userName));
    list.sort((a, b) => (parseApiDate(b.lastActivityAt) ?? 0) - (parseApiDate(a.lastActivityAt) ?? 0));
    const size = f.size ?? 20;
    const page = f.page ?? 0;
    return later({ total: list.length, items: list.slice(page * size, page * size + size) });
  }

  card(card: number): Observable<GovernanceCardDetail> {
    const c = this.cardsState.find((x) => x.row.cardNumber === card);
    if (!c) return failLater(404, 'Card sem atividade na governança.');
    return later({ card: c.row, timeline: [...c.timeline].sort((a, b) => a.at.localeCompare(b.at)) });
  }

  tasks(r: GovRange): Observable<GovernanceTaskRow[]> {
    const rows = this.allTimelineRows(r).filter((x) => x.kind === 'step' || x.kind === 'task' || x.kind === 'request');
    const by = groupBy(rows, (x) => `${x.kind}|${x.ref}`);
    return later([...by.entries()].map(([k, list]) => {
      const [kind, ref] = k.split('|');
      const durs = list.map((x) => x.durationMs ?? 0);
      return {
        kind: ref, source: (kind === 'step' ? 'step' : kind === 'task' ? 'task' : 'request') as GovernanceTaskRow['source'],
        count: list.length, done: list.filter((x) => x.outcome === 'ok').length, failed: list.filter((x) => x.outcome === 'error').length,
        medianMs: median(durs), p90Ms: percentile(durs, 90), users: new Set(list.map((x) => x.user)).size,
      };
    }).sort((a, b) => b.count - a.count));
  }

  events(f: GovEventFilter): Observable<GovPage<GovernanceEvent>> {
    let list = this.inRange(f);
    if (f.user) list = list.filter((e) => e.userId === f.user);
    if (f.card) list = list.filter((e) => `${e.cardNumber ?? ''}` === `${f.card}`);
    if (f.source) list = list.filter((e) => e.source === f.source);
    if (f.category) list = list.filter((e) => e.category === f.category);
    if (f.outcome) list = list.filter((e) => e.outcome === f.outcome);
    if (f.action) list = list.filter((e) => e.action.toLowerCase().includes(f.action!.toLowerCase()));
    if (f.search) {
      const q = f.search.toLowerCase();
      list = list.filter((e) => `${e.action} ${e.detail ?? ''} ${e.userName} ${e.rules.join(' ')}`.toLowerCase().includes(q));
    }
    const size = f.size ?? 50;
    const page = f.page ?? 0;
    return later({ total: list.length, items: list.slice(page * size, page * size + size) });
  }

  // ---- regras ----

  rules(): Observable<GovernanceRule[]> {
    return later(this.rulesState.map((r) => structuredClone(r)));
  }

  createRule(rule: GovernanceRule): Observable<GovernanceRule> {
    if (this.rulesState.some((r) => r.key === rule.key)) return failLater(409, 'Já existe regra com essa chave.');
    const saved = { ...structuredClone(rule), id: `r-${Date.now()}`, builtin: false, updatedAt: localIso(Date.now()), updatedBy: 'Você (exemplo)' };
    this.rulesState.push(saved);
    this.change('POST Governance/rules', `${rule.key}: criada`);
    return later(structuredClone(saved));
  }

  updateRule(rule: GovernanceRule): Observable<GovernanceRule> {
    const i = this.rulesState.findIndex((r) => r.id === rule.id);
    if (i < 0) return failLater(404, 'Regra não encontrada.');
    const cur = this.rulesState[i];
    const saved = { ...structuredClone(rule), key: cur.builtin ? cur.key : rule.key, builtin: cur.builtin, updatedAt: localIso(Date.now()), updatedBy: 'Você (exemplo)' };
    this.rulesState[i] = saved;
    this.change('PUT Governance/rules/{id}', `${saved.key}: ${diffText(cur, saved)}`);
    return later(structuredClone(saved));
  }

  deleteRule(id: string): Observable<unknown> {
    const cur = this.rulesState.find((r) => r.id === id);
    if (!cur) return failLater(404, 'Regra não encontrada.');
    if (cur.builtin) return failLater(409, 'Regra embutida não pode ser apagada (desligue-a).');
    this.rulesState = this.rulesState.filter((r) => r.id !== id);
    this.change('DELETE Governance/rules/{id}', `${cur.key}: apagada`);
    return later(null);
  }

  testRule(req: RuleTestRequest): Observable<EvaluateResponse> {
    const { rule, ...request } = req;
    const rules = rule
      ? [...this.rulesState.filter((r) => r.id !== rule.id || !rule.id), normalizeRule({ ...rule, enabled: true })]
      : this.rulesState;
    return later(evaluateLocally(rules, request, this.settingsState.mode === 'off' ? 'monitor' : this.settingsState.mode));
  }

  // ---- hooks ----

  hooks(): Observable<GovernanceHook[]> {
    return later(this.hooksState.map((h) => structuredClone(h)));
  }

  createHook(hook: GovernanceHook): Observable<GovernanceHook> {
    if (this.hooksState.some((h) => h.key === hook.key)) return failLater(409, 'Já existe hook com essa chave.');
    const saved = { ...structuredClone(hook), id: `h-${Date.now()}`, builtin: false, updatedAt: localIso(Date.now()), updatedBy: 'Você (exemplo)' };
    this.hooksState.push(saved);
    this.change('POST Governance/hooks', `${hook.key}: criado`);
    return later(structuredClone(saved));
  }

  updateHook(hook: GovernanceHook): Observable<GovernanceHook> {
    const i = this.hooksState.findIndex((h) => h.id === hook.id);
    if (i < 0) return failLater(404, 'Hook não encontrado.');
    const cur = this.hooksState[i];
    const saved = { ...structuredClone(hook), key: cur.builtin ? cur.key : hook.key, builtin: cur.builtin, updatedAt: localIso(Date.now()), updatedBy: 'Você (exemplo)' };
    this.hooksState[i] = saved;
    this.change('PUT Governance/hooks/{id}', `${saved.key}: ${saved.enabled ? 'ligado' : 'desligado'}`);
    return later(structuredClone(saved));
  }

  deleteHook(id: string): Observable<unknown> {
    const cur = this.hooksState.find((h) => h.id === id);
    if (!cur) return failLater(404, 'Hook não encontrado.');
    if (cur.builtin) return failLater(409, 'Hook embutido não pode ser apagado (desligue-o).');
    this.hooksState = this.hooksState.filter((h) => h.id !== id);
    this.change('DELETE Governance/hooks/{id}', `${cur.key}: apagado`);
    return later(null);
  }

  // ---- configurações ----

  settings(): Observable<GovernanceSettings> {
    return later(structuredClone(this.settingsState));
  }

  saveSettings(s: GovernanceSettings): Observable<GovernanceSettings> {
    const before = this.settingsState;
    this.settingsState = { ...structuredClone(s), updatedAt: localIso(Date.now()), updatedBy: 'Você (exemplo)' };
    this.change('PUT Governance/settings', before.mode !== s.mode ? `Modo: ${before.mode} → ${s.mode}` : 'Configurações alteradas');
    return later(structuredClone(this.settingsState));
  }

  changes(take = 100): Observable<GovernanceEvent[]> {
    return later(this.changesState.slice(0, take));
  }

  // ---- padrões (0101) ----

  standards(f: StandardFilter = {}): Observable<Standard[]> {
    return later(filterStandards(this.standardsState, {
      area: f.area ?? null, status: f.status ?? null, topic: f.topic ?? null, repository: f.repository ?? null, module: f.module ?? null,
      search: f.search ?? null,
    }).map((s) => structuredClone(s)));
  }

  createStandard(s: Standard): Observable<Standard> {
    if (this.standardsState.some((x) => x.key === s.key)) return failLater(409, 'Já existe padrão com essa chave.');
    const saved = normalizeStandard({ ...structuredClone(s), id: `st-${Date.now()}`, source: { kind: 'manual', ref: '', version: null, url: null },
      updatedAt: localIso(Date.now()), updatedBy: 'Você (exemplo)' });
    this.standardsState.push(saved);
    this.change('POST Governance/standards', `${saved.key}: criado`);
    return later(structuredClone(saved));
  }

  updateStandard(s: Standard): Observable<Standard> {
    const i = this.standardsState.findIndex((x) => x.id === s.id);
    if (i < 0) return failLater(404, 'Padrão não encontrado.');
    const cur = this.standardsState[i];
    const saved = normalizeStandard({ ...structuredClone(s), key: cur.key, source: cur.source, updatedAt: localIso(Date.now()), updatedBy: 'Você (exemplo)' });
    this.standardsState[i] = saved;
    this.change('PUT Governance/standards/{id}', `${saved.key}: ${changedFields(cur, saved).map((f) => f.label.toLowerCase()).join(', ') || 'sem mudança'}`);
    return later(structuredClone(saved));
  }

  deleteStandard(id: string): Observable<unknown> {
    const cur = this.standardsState.find((x) => x.id === id);
    if (!cur) return failLater(404, 'Padrão não encontrado.');
    if (cur.source.kind !== 'manual') return failLater(409, 'Só padrões manuais podem ser apagados (descontinue os importados).');
    this.standardsState = this.standardsState.filter((x) => x.id !== id);
    this.change('DELETE Governance/standards/{id}', `${cur.key}: apagado`);
    return later(null);
  }

  checkStandards(req: StandardCheckRequest): Observable<StandardCheckResponse> {
    // A conferência embutida "fk-name" do backend vira uma regex aqui (só para a demonstração).
    const list = this.standardsState.map((s) => (s.check.kind === 'builtin' && s.check.pattern === 'fk-name'
      ? { ...s, check: { ...s.check, kind: 'regex' as const, pattern: '\\bCONSTRAINT\\s+(?!FK_)\\[?\\w+\\]?\\s+FOREIGN\\s+KEY' } } : s));
    const r = checkLocally(list, req, this.settingsState.mode === 'off' ? 'monitor' : this.settingsState.mode);
    if (r.findings.length) {
      const outcome: GovOutcome = r.decision === 'block' ? 'blocked' : r.decision === 'warn' ? 'warned' : 'monitored';
      this.eventsState.unshift(this.ev({
        user: { id: 'u-demo', name: 'Você (exemplo)', role: 'admin' }, source: 'screen', action: 'POST Governance/standards/check', category: 'standard',
        start: Date.now(), dur: 90, card: req.card, outcome, rules: [...new Set(r.findings.map((f) => f.key))],
        detail: `${req.repository ? `repo: ${req.repository} · ` : ''}${req.path ?? req.target} · ${r.findings.length} achado(s)`,
      }));
    }
    return later(r);
  }

  importStandardsWiki(url: string): Observable<StandardDraft> {
    if (!/_wiki\//.test(url)) return failLater(400, 'O endereço não é de uma página de wiki do Azure DevOps.');
    const snap = demoWikiSnapshot();
    const cur = this.standardsState.filter((s) => s.source.kind === 'wiki');
    return later(this.draft('wiki', snap, cur, '2.1', { url }));
  }

  importStandardsReverse(modules: string[] | null): Observable<StandardDraft> {
    const keys = modules?.length ? modules : DEMO_MODULES.filter((m) => m.published).map((m) => m.key);
    const proposed = keys.flatMap((m) => appStandardsFor(m, 1));
    const cur = this.standardsState.filter((s) => s.source.kind === 'reverse-engineering' && s.appliesTo.modules.some((m) => keys.includes(m)));
    return later(this.draft('reverse-engineering', proposed, cur, 'ER publicada em 24/11', { modules: keys }));
  }

  applyStandardsImport(draftId: string, accept: string[]): Observable<StandardImportResult | null> {
    const d = this.drafts.get(draftId);
    if (!d) return failLater(404, 'Rascunho não encontrado (expirou?). Leia a origem de novo.');
    const ok = new Set(accept);
    let added = 0;
    let changed = 0;
    let removed = 0;
    for (const a of d.added) {
      if (!ok.has(a.key) || this.standardsState.some((x) => x.key === a.key)) continue;
      this.standardsState.push(normalizeStandard({ ...structuredClone(a), id: `st-${a.key}`, updatedAt: localIso(Date.now()), updatedBy: 'Você (exemplo)' }));
      added++;
    }
    for (const c of d.changed) {
      const after = 'after' in c ? c.after : c;
      const i = this.standardsState.findIndex((x) => x.key === after.key);
      if (!ok.has(after.key) || i < 0) continue;
      this.standardsState[i] = normalizeStandard({ ...structuredClone(after), id: this.standardsState[i].id, updatedAt: localIso(Date.now()), updatedBy: 'Você (exemplo)' });
      changed++;
    }
    for (const r of d.removed) {
      const key = typeof r === 'string' ? r : r.key;
      if (!ok.has(key)) continue;
      this.standardsState = this.standardsState.filter((x) => x.key !== key);
      removed++;
    }
    this.drafts.delete(draftId);
    this.change(`POST Governance/standards/import/{id}/apply`,
      `${d.source === 'wiki' ? `wiki v${d.version}` : 'engenharia reversa'}: ${added} novo(s), ${changed} alterado(s), ${removed} removido(s)`);
    return later({ added, changed, removed, applied: added + changed + removed });
  }

  standardModules(): Observable<StandardModuleOption[]> {
    return later(DEMO_MODULES.map((m) => ({ ...m })));
  }

  /** Diferença entre a origem e o catálogo: efeito, estado e conferência do catálogo são preservados nos alterados. */
  private draft(source: 'wiki' | 'reverse-engineering', incoming: Standard[], current: Standard[], version: string,
    extra: Partial<StandardDraft>): StandardDraft {
    const byKey = new Map(current.map((s) => [s.key, s]));
    const inKeys = new Set(incoming.map((s) => s.key));
    const added: Standard[] = [];
    const changed: { before: Standard; after: Standard }[] = [];
    for (const s of incoming) {
      const before = byKey.get(s.key);
      if (!before) {
        added.push(normalizeStandard({ ...structuredClone(s), id: '' }));
        continue;
      }
      const after = normalizeStandard({ ...structuredClone(before), title: s.title, textPt: s.textPt, textEn: s.textEn, examples: s.examples, source: s.source });
      const content = changedFields(before, after).filter((f) => f.key !== 'source');
      if (content.length) changed.push({ before: structuredClone(before), after });
    }
    const removed = current.filter((s) => !inKeys.has(s.key)).map((s) => structuredClone(s));
    const id = `d-${Date.now()}`;
    const d: StandardDraft = { id, added, changed, removed, version, source, createdAt: localIso(Date.now()), createdBy: 'Você (exemplo)', ...extra };
    this.drafts.set(id, d);
    return structuredClone(d);
  }

  /** Achados de padrão na trilha (categoria `standard`), nos cards de exemplo. */
  private genStandardFindings(): void {
    const rnd = mulberry32(101);
    const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
    const hits: [string, string, string][] = [
      ['db-c1', 'Scripts/99_{card}_relatorio.sql', 'SELECT * FROM actionPlan.ActionPlan'],
      ['db-fk5', 'Scripts/99_{card}_fk.sql', 'FOREIGN KEY (AreaId) REFERENCES area.Area (AreaId) ON DELETE CASCADE'],
      ['db-fk7', 'Migrations/20261118_AddAreaFk.cs', 'FK_actionPlan_ActionPlan_AreaId sem índice de suporte'],
      ['db-n14', 'Scripts/99_{card}_proc.sql', 'CREATE PROCEDURE dbo.sp_ListaPlanos'],
      ['db-ix3', 'Scripts/99_{card}_indice.sql', 'CREATE INDEX IX_ActionPlan_SiteId ON actionPlan.ActionPlan (SiteId)'],
      ['db-g7', 'Migrations/20261120_Initial.cs', '.OnDelete(DeleteBehavior.Cascade)'],
      ['db-c2', 'Scripts/99_{card}_custo.sql', 'Cost MONEY NOT NULL'],
      ['db-pk10', 'Scripts/99_{card}_tabela.sql', 'PRIMARY KEY (LossId)'],
      ['app-actionplan-api', 'src/actionplan.api/Controllers/ExportController.cs', '[Route("export/[action]")]'],
      ['app-actionplan-data-access', 'src/actionplan.application/Services/ReportService.cs', 'using var cn = new SqlConnection(cs);'],
      ['manual-sql-script-name', 'fix.sql', 'fix.sql'],
    ];
    const weights = [9, 4, 7, 3, 6, 3, 2, 2, 2, 2, 3];
    const bag = hits.flatMap((h, i) => Array<[string, string, string]>(weights[i]).fill(h));
    const repoOf = (key: string, file: string) =>
      key.startsWith('app-actionplan') ? 'solvace-revamp-actionplan-api' : file.startsWith('Migrations') ? pick(['solvace-revamp-kpi-api', 'solvace-revamp-actionplan-api']) : pick(['edv-solvace-api', 'edv-solvace-api', 'solvace-loss-tree-api']);
    for (let i = 0; i < 70; i++) {
      const c = pick(this.cardsState);
      const first = parseApiDate(c.row.firstActivityAt) ?? this.now;
      const last = parseApiDate(c.row.lastActivityAt) ?? this.now;
      const owner = USERS.find((u) => u.name === c.row.users[0]) ?? USERS[0];
      const [key, fileT, excerpt] = pick(bag);
      const file = fileT.replace('{card}', `${c.row.cardNumber}`);
      const std = this.standardsState.find((s) => s.key === key);
      const effect = std?.status === 'active' ? std.effect : 'monitor';
      const outcome: GovOutcome = effect === 'monitor' ? 'monitored' : this.settingsState.mode === 'enforce' ? (effect === 'block' ? 'blocked' : 'warned') : 'monitored';
      const src = pick<GovSource>(['hook', 'hook', 'skill', 'mcp']);
      this.eventsState.push(this.ev({
        user: owner, source: src, card: c.row.cardNumber, category: 'standard', outcome, rules: [key],
        action: src === 'hook' ? 'hook:PostToolUse:Write' : src === 'mcp' ? 'mcp:prmake_file' : 'POST Governance/standards/check',
        start: first + rnd() * Math.max(1, last - first), dur: 40 + rnd() * 400,
        detail: `repo: ${repoOf(key, file)} · ${file}:${1 + Math.floor(rnd() * 80)} · ${excerpt}`,
      }));
    }
  }

  // ---- geração ----

  private genCard(i: number): void {
    const rnd = this.rand;
    const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
    const between = (a: number, b: number) => a + rnd() * (b - a);
    const owner = USERS[i % USERS.length];
    const helper = rnd() < 0.3 ? USERS[(i + 2) % USERS.length] : null;
    const cardNumber = 78600 + i * 7;
    const kind = rnd() < 0.72 ? 'Bug' : 'User Story';
    const title = `${TITLES[i % TITLES.length]}${i >= TITLES.length ? ' (planta 2)' : ''}`;
    const tl: TimelineRow[] = [];
    const milestones: { key: string; label: string; at: string }[] = [];
    let blocked = 0;
    let t = this.now - between(2 * H, 40 * 24 * H);
    const first = t;
    const mark = (key: string, label: string, at: number) => {
      milestones.push({ key, label, at: localIso(at) });
      tl.push({ at: localIso(at), endAt: null, durationMs: null, kind: 'milestone', title: label, user: null, outcome: null, ref: key });
    };
    const row = (k: TimelineRow['kind'], titleText: string, ref: string, start: number, dur: number, user: string, outcome = 'ok') => {
      tl.push({ at: localIso(start), endAt: localIso(start + dur), durationMs: Math.round(dur), kind: k, title: titleText, user, outcome, ref });
    };
    const ev = (o: Parameters<GovernanceDemoApi['ev']>[0]) => this.eventsState.push(this.ev({ ...o, card: cardNumber }));

    // Análise
    mark('iniciou', 'Iniciou a tarefa', t);
    ev({ user: owner, source: 'skill', action: 'POST ExecutionPlan', category: 'plan', start: t, dur: 420, phase: 'analysis' });
    const planStart = t;
    const steps: [string, string, number, number][] = [
      ['contexto', 'Contexto do card', 4, 18], ['base-solvace', 'Consulta à Base Solvace', 3, 14],
      ['causa-raiz', 'Causa raiz', 10, 70], ['solucoes', 'Soluções propostas', 6, 35],
    ];
    for (const [key, name, a, b] of steps) {
      const d = between(a, b) * M;
      row('step', name, key, t, d, owner.name);
      ev({ user: owner, source: 'mcp', action: 'mcp:prmake_advance', category: 'step', start: t + d, dur: between(150, 900), phase: 'analysis', step: key });
      if (rnd() < 0.18) {
        const outcome: GovOutcome = this.settingsState.mode === 'enforce' ? 'blocked' : 'monitored';
        const r = pick(['no-db-writes', 'no-force-push', 'writes-through-prmake', 'protect-credentials']);
        ev({ user: owner, source: 'hook', action: 'hook:PreToolUse:Bash', category: 'tool', start: t + d / 2, dur: between(40, 300), outcome, rules: [r],
          detail: r === 'no-db-writes' ? "psql -c \"update tb_wcm_site set ...\"" : r === 'protect-credentials' ? 'Read ~/.aws/credentials' : r === 'no-force-push' ? 'git push --force origin bugfix/' + cardNumber : 'curl -X PATCH https://dev.azure.com/...' });
        blocked++;
      }
      for (let k = 0; k < 2 + Math.floor(rnd() * 4); k++) {
        ev({ user: owner, source: 'hook', action: pick(['hook:PostToolUse:Bash', 'hook:PostToolUse:Edit', 'hook:PostToolUse:mcp__prmake__prmake_base_search']), category: 'tool', start: t + rnd() * d, dur: between(200, 9000) });
      }
      t += d + between(1, 6) * M;
    }
    row('plan', 'Plano de análise', 'analysis', planStart, t - planStart, owner.name);
    mark('analise-inicial', 'Análise inicial', t);
    mark('solucao', 'Solução escolhida', t + between(5, 40) * M);
    ev({ user: owner, source: 'screen', action: 'POST Timeline', category: 'timeline', start: t, dur: between(200, 700) });
    const analysisMs = t - planStart;

    const level = rnd();
    let correctionMs: number | null = null;
    let status = 'Analisado';
    let workItems = 0;
    let tasksDone = 0;

    if (level > 0.25 && t < this.now - 2 * H) {
      // Correção
      t += between(1, 26) * H;
      const who = helper ?? owner;
      const cStart = t;
      mark('correcao', 'Correção iniciada', t);
      ev({ user: who, source: 'screen', action: 'POST ExecutionPlan/{id}/correction', category: 'plan', start: t, dur: between(300, 900), phase: 'correction' });
      const proto = between(20, 90) * M;
      row('step', 'Protótipo da correção', 'prototipo', t, proto, who.name);
      t += proto;
      mark('prototipo', 'Protótipo inicial', t);
      const code = between(25, 160) * M;
      row('step', 'Código e testes', 'codigo', t, code, who.name, rnd() < 0.08 ? 'error' : 'ok');
      t += code;
      // Item de trabalho + sub-tarefas + pedido do executor
      workItems = 1;
      const wiStart = t;
      const req = between(4, 25) * M;
      row('request', 'Executor: item #1', 'work-item', t, req, who.name);
      ev({ user: who, source: 'executor', action: 'POST ExecutionQueue', category: 'queue', start: t, dur: between(150, 500), outcome: rnd() < 0.1 ? 'warned' : 'ok', rules: [] });
      const tasks: [string, string, number, number][] = [['create-branch', 'Criar branch', 0.5, 2], ['code', 'Aplicar a correção', 3, 15], ['pr-open', 'Abrir PR', 1, 4]];
      for (const [k, name, a, b] of tasks) {
        const d = between(a, b) * M;
        const failed = k === 'pr-open' && rnd() < 0.07;
        row('task', name, k, t, d, who.name, failed ? 'error' : 'ok');
        ev({ user: who, source: 'executor', action: k === 'pr-open' ? 'mcp:prmake_pr_open' : 'mcp:prmake_work_task', category: k === 'pr-open' ? 'pr' : 'task', start: t + d, dur: between(300, 4000), outcome: failed ? 'error' : 'ok', task: 1 + tasks.findIndex((x) => x[0] === k) });
        if (!failed) tasksDone++;
        t += d;
      }
      row('work-item', 'Item #1 — Correção', 'implementation', wiStart, t - wiStart, who.name);
      mark('pr', 'PR aberto', t);
      correctionMs = t - cStart;
      status = 'PR aberto';
      if (level > 0.45 && t < this.now - 3 * H) {
        t += between(2, 40) * H;
        if (t < this.now) {
          mark('qa', 'QA', t);
          ev({ user: pick(USERS), source: 'screen', action: 'POST Azure/card/{id}/actions/ready-for-qa', category: 'devops', start: t, dur: between(400, 1800) });
          status = 'Em QA';
          if (level > 0.65) {
            t += between(3, 60) * H;
            if (t < this.now) {
              mark('fechado', 'Fechado', t);
              ev({ user: pick(USERS), source: 'screen', action: 'POST Azure/card/{id}/actions/close', category: 'devops', start: t, dur: between(400, 1800) });
              status = 'Fechado';
            }
          }
        }
      }
    }

    const last = Math.min(this.now, Math.max(...tl.map((x) => (parseApiDate(x.endAt) ?? parseApiDate(x.at) ?? 0))));
    this.cardsState.push({
      row: {
        cardNumber, title, kind, users: helper ? [owner.name, helper.name] : [owner.name],
        firstActivityAt: localIso(first), lastActivityAt: localIso(last),
        milestones: milestones.sort((a, b) => a.at.localeCompare(b.at)),
        analysisMs: Math.round(analysisMs), correctionMs: correctionMs != null ? Math.round(correctionMs) : null, leadTimeMs: Math.round(last - first),
        workItems, tasksDone, blocked, status,
      },
      timeline: tl,
    });
  }

  private ev(o: {
    user: { id: string; name: string; role: string }; source: GovSource; action: string; category: string; start: number; dur: number;
    card?: number; phase?: string; step?: string; task?: number; outcome?: GovOutcome; rules?: string[]; detail?: string;
  }): GovernanceEvent {
    return {
      id: this.nextId++, startedAt: localIso(o.start), finishedAt: localIso(o.start + o.dur), durationMs: Math.round(o.dur),
      userId: o.user.id, userName: o.user.name, role: o.user.role, source: o.source, action: o.action, category: o.category,
      cardNumber: o.card ?? null, planId: o.phase ? `p-${o.card}-${o.phase}` : null, phase: o.phase ?? null, stepKey: o.step ?? null,
      workItemNumber: o.task ? 1 : null, taskNumber: o.task ?? null, outcome: o.outcome ?? 'ok',
      statusCode: o.source === 'screen' || o.source === 'api' ? (o.outcome === 'blocked' ? 403 : o.outcome === 'error' ? 500 : 200) : null,
      rules: o.rules ?? [], detail: o.detail ?? null,
      sessionId: o.source === 'hook' || o.source === 'executor' ? `s-${o.user.id}-${Math.floor(o.start / (6 * H))}` : null,
      machine: o.source === 'hook' || o.source === 'executor' ? `${o.user.id.slice(2)}-mbp` : null,
    };
  }

  private change(action: string, detail: string): void {
    this.changesState.unshift(this.ev({ user: { id: 'u-demo', name: 'Você (exemplo)', role: 'admin' }, source: 'screen', action, category: 'governance', start: Date.now(), dur: 120, detail }));
  }

  private inRange(r: Partial<GovRange>): GovernanceEvent[] {
    const from = r.from ? new Date(r.from).getTime() : -Infinity;
    const to = r.to ? new Date(r.to).getTime() : Infinity;
    return this.eventsState.filter((e) => {
      const t = parseApiDate(e.startedAt) ?? 0;
      return t >= from && t <= to;
    });
  }

  private cardsInRange(r: Partial<GovRange>): DemoCard[] {
    const from = r.from ? new Date(r.from).getTime() : -Infinity;
    const to = r.to ? new Date(r.to).getTime() : Infinity;
    return this.cardsState.filter((c) => (parseApiDate(c.row.lastActivityAt) ?? 0) >= from && (parseApiDate(c.row.firstActivityAt) ?? 0) <= to);
  }

  private allTimelineRows(r: Partial<GovRange>): TimelineRow[] {
    const from = r.from ? new Date(r.from).getTime() : -Infinity;
    const to = r.to ? new Date(r.to).getTime() : Infinity;
    return this.cardsState.flatMap((c) => c.timeline).filter((x) => {
      const t = parseApiDate(x.at) ?? 0;
      return t >= from && t <= to;
    });
  }

  private userRow(u: { id: string; name: string }, r: GovRange): GovernanceUserRow {
    const ev = this.inRange(r).filter((e) => e.userId === u.id);
    const rows = this.allTimelineRows(r).filter((x) => x.user === u.name);
    const plans = rows.filter((x) => x.kind === 'plan');
    const taskRows = rows.filter((x) => x.kind === 'task');
    return {
      userId: u.id, userName: u.name, events: ev.length,
      cards: new Set(ev.map((e) => e.cardNumber).filter((x) => x != null)).size,
      plansStarted: plans.length, analysesDone: plans.filter((x) => x.ref === 'analysis').length,
      medianAnalysisMs: median(plans.filter((x) => x.ref === 'analysis').map((x) => x.durationMs ?? 0)),
      workItems: rows.filter((x) => x.kind === 'work-item').length, tasksDone: taskRows.filter((x) => x.outcome === 'ok').length,
      medianTaskMs: median(taskRows.map((x) => x.durationMs ?? 0)),
      blocked: ev.filter((e) => e.outcome === 'blocked').length, warned: ev.filter((e) => e.outcome === 'warned').length,
      errors: ev.filter((e) => e.outcome === 'error').length, aiCostUsd: round2(plans.length * 0.41),
      lastActivityAt: ev[0]?.startedAt ?? null,
    };
  }
}

// ---- utilitários ----

function rule(
  key: string, name: string, category: string, effect: GovernanceRule['effect'], order: number, message: string,
  match: Partial<GovernanceRule['match']>, scope: Partial<GovernanceRule['scope']> = {},
): GovernanceRule {
  return normalizeRule({
    id: `r-${key}`, key, name, description: message, category, enabled: true, effect, builtin: true, order, message,
    scope: { roles: [], users: [], sources: [], cardTypes: [], exceptRoles: [], ...scope },
    match: { actions: [], tools: [], patterns: [], allOf: [], paths: [], ...match },
    updatedAt: null, updatedBy: null,
  });
}

function hook(key: string, name: string, event: string, matcher: string, action: GovernanceHook['action'], order: number): GovernanceHook {
  return { id: `h-${key}`, key, name, description: '', event, matcher, action, config: {}, enabled: true, builtin: true, order, updatedAt: null, updatedBy: null };
}

function later<T>(v: T): Observable<T> {
  return of(v).pipe(delay(180));
}

function failLater(status: number, message: string): Observable<never> {
  return throwError(() => new HttpErrorResponse({ status, error: { message } }));
}

function groupBy<T>(list: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of list) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(x);
  }
  return m;
}

function msBetween(ms: { key: string; at: string }[], a: string, b: string): number | null {
  const x = parseApiDate(ms.find((m) => m.key === a)?.at);
  const y = parseApiDate(ms.find((m) => m.key === b)?.at);
  return x != null && y != null ? y - x : null;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Data local sem fuso (como a API devolve). */
export function localIso(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => `${n}`.padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function diffText(a: GovernanceRule, b: GovernanceRule): string {
  const parts: string[] = [];
  if (a.enabled !== b.enabled) parts.push(b.enabled ? 'ligada' : 'desligada');
  if (a.effect !== b.effect) parts.push(`efeito ${a.effect} → ${b.effect}`);
  if (a.message !== b.message) parts.push('mensagem');
  if (JSON.stringify(a.scope) !== JSON.stringify(b.scope)) parts.push('escopo');
  if (JSON.stringify(a.match) !== JSON.stringify(b.match)) parts.push('casamentos');
  return parts.join(', ') || 'sem mudança';
}

/** PRNG determinístico (mesmos dados a cada abertura). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
