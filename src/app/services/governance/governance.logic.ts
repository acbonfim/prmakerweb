/**
 * Governança (0098): lógica pura das telas — formatação, período, agrupamentos, validação de glob/regex, avaliação
 * local das regras (simulador do `?exemplo=1` e prévia), linha do tempo do card e leitura do 403/aviso.
 * Sem Angular: testada em `governance.logic.spec.ts`.
 */
import {
  EvaluateRequest, EvaluateResponse, EvaluateRuleHit, GOVERNANCE_BLOCKED, GovDecision, GovEffect, GovMode, GovernanceCardDetail,
  GovernanceCardRow, GovernanceEvent, GovernanceHook, GovernanceRule, GovernanceUserDetail, GovernanceUserRow, Milestone,
  RULE_CATEGORIES, RULE_CATEGORY_LABEL, TimelineKind, TimelineRow,
} from './governance.model';
import { formatDuration, parseApiDate } from '../usage/usage.model';

// ───────────────────────── números e durações ─────────────────────────

/** Mediana (null se vazio). */
export function median(values: number[]): number | null {
  return percentile(values, 50);
}

/** Percentil por posição mais próxima (`p` em 0–100; null se vazio). */
export function percentile(values: number[], p: number): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  if (p <= 0) return v[0];
  if (p >= 100) return v[v.length - 1];
  if (p === 50) {
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
  }
  const rank = Math.ceil((p / 100) * v.length);
  return v[Math.min(v.length - 1, Math.max(0, rank - 1))];
}

/** Duração legível: "—" sem valor, "420 ms" abaixo de 1 s, senão como na análise de uso ("3 min", "2 h 5 min"). */
export function fmtMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  return formatDuration(ms);
}

const nf = new Intl.NumberFormat('pt-BR');
export function fmtNum(v: number | null | undefined): string {
  return nf.format(v ?? 0);
}

export function fmtUsd(v: number | null | undefined): string {
  if (v == null) return '—';
  return `US$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 })}`;
}

export function fmtPct(part: number, total: number): string {
  if (!total) return '—';
  return `${Math.round((part / total) * 100)}%`;
}

// ───────────────────────── período ─────────────────────────

export type GovPeriod = '1' | '7' | '30' | '90' | 'custom';

export const PERIODS: { key: GovPeriod; label: string }[] = [
  { key: '1', label: '24 h' }, { key: '7', label: '7 dias' }, { key: '30', label: '30 dias' }, { key: '90', label: '90 dias' },
  { key: 'custom', label: 'Personalizado' },
];

/** Intervalo do período. Personalizado inválido (ou invertido) cai em 7 dias. */
export function periodRange(period: GovPeriod, customFrom: string, customTo: string, now = Date.now()): { from: Date; to: Date } {
  if (period === 'custom') {
    const from = new Date(`${customFrom}T00:00:00`);
    const to = new Date(`${customTo}T23:59:59`);
    if (Number.isFinite(from.getTime()) && Number.isFinite(to.getTime()) && from <= to) return { from, to };
  }
  const days = period === 'custom' ? 7 : Number(period);
  return { from: new Date(now - days * 86_400_000), to: new Date(now) };
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
}

/** Dias (yyyy-MM-dd, fuso do navegador) de `from` a `to`, no máximo 400. */
export function dayKeys(from: Date, to: Date): string[] {
  const out: string[] = [];
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  while (d <= to && out.length < 400) {
    out.push(dayKey(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export function shortDay(k: string): string {
  return `${k.slice(8, 10)}/${k.slice(5, 7)}`;
}

/**
 * Eventos por dia empilhados por resultado: [ok, avisado, barrado, erro]. "ok" = total − os outros (nunca negativo).
 * Dias sem linha viram zero.
 */
export function perDayStack(
  perDay: { day: string; events: number; blocked: number; warned: number; errors: number }[],
  keys: string[],
): { day: string; values: [number, number, number, number] }[] {
  const by = new Map(perDay.map((d) => [d.day.slice(0, 10), d]));
  return keys.map((k) => {
    const d = by.get(k);
    if (!d) return { day: k, values: [0, 0, 0, 0] };
    const ok = Math.max(0, (d.events ?? 0) - (d.blocked ?? 0) - (d.warned ?? 0) - (d.errors ?? 0));
    return { day: k, values: [ok, d.warned ?? 0, d.blocked ?? 0, d.errors ?? 0] };
  });
}

// ───────────────────────── ordenação ─────────────────────────

export interface SortState<K extends string> {
  key: K;
  dir: 1 | -1;
}

/** Ordena cópia; nulos sempre no fim; números numéricos, o resto por texto pt-BR. */
export function sortRows<T, K extends string>(rows: T[], s: SortState<K>): T[] {
  return [...rows].sort((a, b) => {
    const va = (a as Record<string, unknown>)[s.key];
    const vb = (b as Record<string, unknown>)[s.key];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * s.dir;
    return `${va}`.localeCompare(`${vb}`, 'pt-BR') * s.dir;
  });
}

/** Clique no cabeçalho: mesma coluna inverte; outra coluna começa decrescente (texto: crescente). */
export function toggleSort<K extends string>(cur: SortState<K>, key: K, textKeys: K[] = []): SortState<K> {
  if (cur.key === key) return { key, dir: (cur.dir * -1) as 1 | -1 };
  return { key, dir: textKeys.includes(key) ? 1 : -1 };
}

// ───────────────────────── glob e regex ─────────────────────────

/**
 * Glob → RegExp (sem diferenciar maiúsculas). `a|b` = alternativas. Ações/ferramentas: `*` = qualquer coisa.
 * Caminhos (`path`): `**` atravessa pastas, `*` não passa de `/`, e `**\/x` casa `x` na raiz também.
 */
export function globToRegExp(glob: string, path = false): RegExp {
  const alts = glob.split('|').map((g) => g.trim()).filter((g) => g.length);
  const body = alts.map((g) => globBody(g, path)).join('|');
  return new RegExp(`^(?:${body || '(?!)'})$`, 'i');
}

function globBody(g: string, path: boolean): string {
  let out = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (path && g[i + 1] === '*') {
        if (g[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += path ? '[^/]*' : '.*';
      }
    } else if (c === '?') {
      out += path ? '[^/]' : '.';
    } else {
      out += c.replace(/[.+^${}()[\]\\]/g, '\\$&');
    }
  }
  return out;
}

export function globMatch(glob: string, value: string | null | undefined, path = false): boolean {
  if (value == null) return false;
  const v = path ? value.replace(/\\/g, '/') : value;
  try {
    return globToRegExp(glob, path).test(v);
  } catch {
    return false;
  }
}

/** Erro do glob (ou null): vazio, espaço nas pontas, colchete/chave sem par. */
export function validateGlob(glob: string): string | null {
  if (!glob || !glob.trim()) return 'Informe um padrão.';
  if (glob !== glob.trim()) return 'Tire os espaços do começo e do fim.';
  if (glob.split('|').some((p) => !p.trim())) return 'Alternativa vazia em "|".';
  if (count(glob, '[') !== count(glob, ']')) return 'Colchete sem par.';
  if (count(glob, '{') !== count(glob, '}')) return 'Chave sem par.';
  return null;
}

/** Erro da regex (ou null). A API usa .NET; o que o navegador não entende também é recusado aqui. */
export function validateRegex(re: string): string | null {
  if (!re || !re.trim()) return 'Informe uma expressão.';
  try {
    new RegExp(re, 'i');
  } catch (e) {
    const msg = e instanceof Error ? e.message.replace(/^Invalid regular expression: /, '') : `${e}`;
    return `Expressão inválida: ${msg}`;
  }
  if (new RegExp(re, 'i').test('')) return 'A expressão casa com texto vazio (casaria com tudo).';
  return null;
}

function count(s: string, ch: string): number {
  return s.split(ch).length - 1;
}

// ───────────────────────── chaves ─────────────────────────

/** "Não fazer merge!" → "nao-fazer-merge". */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function validateKey(key: string, takenKeys: string[]): string | null {
  if (!key) return 'Informe a chave.';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) return 'Use só letras minúsculas, números e hífen (ex.: no-merge).';
  if (takenKeys.includes(key)) return 'Já existe outra com essa chave.';
  return null;
}

// ───────────────────────── regras ─────────────────────────

export type RuleMatchDim = 'actions' | 'tools' | 'patterns' | 'allOf' | 'paths';
export const RULE_MATCH_DIMS: { key: RuleMatchDim; label: string; hint: string; kind: 'glob' | 'path' | 'regex' }[] = [
  { key: 'actions', label: 'Ações', hint: "Glob sobre a ação da trilha (ex.: POST Azure/card/*/actions/*, mcp:prmake_pr_*).", kind: 'glob' },
  { key: 'tools', label: 'Ferramentas do Claude Code', hint: 'Glob sobre a ferramenta (ex.: Bash, Write, mcp__prmake__*).', kind: 'glob' },
  { key: 'patterns', label: 'Padrões (basta um)', hint: 'Regex sobre o comando/entrada; basta UMA casar. Não diferencia maiúsculas.', kind: 'regex' },
  { key: 'allOf', label: 'Padrões (todos)', hint: 'Regex que precisam casar TODAS, além dos padrões acima (ex.: cliente de banco + comando de escrita).', kind: 'regex' },
  { key: 'paths', label: 'Caminhos', hint: 'Glob sobre o caminho do arquivo (ex.: **/.aws/credentials).', kind: 'path' },
];

export function ruleHasMatch(rule: Pick<GovernanceRule, 'match'>): boolean {
  const m = rule.match;
  return !!(m.actions?.length || m.tools?.length || m.patterns?.length || m.allOf?.length || m.paths?.length);
}

export function newRule(order = 100): GovernanceRule {
  return {
    id: '', key: '', name: '', description: '', category: 'fluxo', enabled: true, effect: 'warn', builtin: false, order,
    message: '',
    scope: { roles: [], users: [], sources: [], cardTypes: [], exceptRoles: [] },
    match: { actions: [], tools: [], patterns: [], allOf: [], paths: [] },
    updatedAt: null, updatedBy: null,
  };
}

/** Garante as listas (regra antiga sem `allOf`, por exemplo). */
export function normalizeRule(r: GovernanceRule): GovernanceRule {
  const s = r.scope ?? ({} as GovernanceRule['scope']);
  const m = r.match ?? ({} as GovernanceRule['match']);
  return {
    ...r,
    scope: { roles: s.roles ?? [], users: s.users ?? [], sources: s.sources ?? [], cardTypes: s.cardTypes ?? [], exceptRoles: s.exceptRoles ?? [] },
    match: { actions: m.actions ?? [], tools: m.tools ?? [], patterns: m.patterns ?? [], allOf: m.allOf ?? [], paths: m.paths ?? [] },
  };
}

/** Erros da regra por campo (vazio = ok). `match.<dim>.<i>` aponta o item da lista. */
export function validateRule(rule: GovernanceRule, otherKeys: string[]): Record<string, string> {
  const e: Record<string, string> = {};
  const keyErr = validateKey(rule.key, otherKeys);
  if (keyErr) e['key'] = keyErr;
  if (!rule.name.trim()) e['name'] = 'Informe o nome.';
  if (!rule.message.trim() && rule.effect !== 'monitor') e['message'] = 'Escreva a mensagem que a pessoa vai ver.';
  for (const dim of RULE_MATCH_DIMS) {
    (rule.match[dim.key] ?? []).forEach((v, i) => {
      const err = dim.kind === 'regex' ? validateRegex(v) : validateGlob(v);
      if (err) e[`match.${dim.key}.${i}`] = err;
    });
  }
  if (!ruleHasMatch(rule)) e['match'] = 'Preencha ao menos um casamento (ação, ferramenta, padrão ou caminho): sem nenhum, a regra nunca casa.';
  const both = rule.scope.roles.filter((r) => rule.scope.exceptRoles.includes(r));
  if (both.length) e['scope'] = `Papel ao mesmo tempo no escopo e isento: ${both.join(', ')}.`;
  return e;
}

export interface RuleGroup {
  category: string;
  label: string;
  rules: GovernanceRule[];
}

/** Agrupa por categoria (ordem conhecida primeiro, depois as outras), regras por `order` e nome. */
export function groupRulesByCategory(rules: GovernanceRule[]): RuleGroup[] {
  const map = new Map<string, GovernanceRule[]>();
  for (const r of rules) {
    const c = r.category || 'outros';
    if (!map.has(c)) map.set(c, []);
    map.get(c)!.push(r);
  }
  const known = RULE_CATEGORIES.filter((c) => map.has(c));
  const others = [...map.keys()].filter((c) => !RULE_CATEGORIES.includes(c)).sort();
  return [...known, ...others].map((c) => ({
    category: c,
    label: RULE_CATEGORY_LABEL[c] ?? c,
    rules: map.get(c)!.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'pt-BR')),
  }));
}

const EFFECT_RANK: Record<GovEffect, number> = { monitor: 1, warn: 2, block: 3, approval: 3 };

/** A regra casa o pedido? (ativa, escopo de origem/papel e cada dimensão preenchida casando). */
export function ruleMatches(rule: GovernanceRule, req: EvaluateRequest, ctx: { role?: string | null; user?: string | null; cardType?: string | null } = {}): boolean {
  const r = normalizeRule(rule);
  if (!r.enabled || !ruleHasMatch(r)) return false;
  const s = r.scope;
  if (s.sources.length && !s.sources.includes(req.source)) return false;
  if (ctx.role && s.exceptRoles.includes(ctx.role)) return false;
  if (s.roles.length && (!ctx.role || !s.roles.includes(ctx.role))) return false;
  if (s.users.length && (!ctx.user || !s.users.includes(ctx.user))) return false;
  if (s.cardTypes.length && ctx.cardType && !s.cardTypes.includes(ctx.cardType)) return false;
  const m = r.match;
  if (m.actions.length && !m.actions.some((g) => globMatch(g, req.action))) return false;
  if (m.tools.length && !m.tools.some((g) => globMatch(g, req.tool))) return false;
  if (m.paths.length && !m.paths.some((g) => globMatch(g, req.path, true))) return false;
  const text = req.input ?? '';
  if (m.patterns.length && !m.patterns.some((p) => safeTest(p, text))) return false;
  if (m.allOf.length && !m.allOf.every((p) => safeTest(p, text))) return false;
  return true;
}

function safeTest(re: string, text: string): boolean {
  try {
    return new RegExp(re, 'i').test(text);
  } catch {
    return false;
  }
}

function decide(hits: EvaluateRuleHit[]): GovDecision {
  const top = Math.max(0, ...hits.map((h) => EFFECT_RANK[h.effect] ?? 0));
  return top >= 3 ? 'block' : top === 2 ? 'warn' : 'allow';
}

/**
 * Avaliação local (mesma semântica do contrato): decisão = efeito mais forte entre as que casaram; modo `monitor`
 * sempre deixa passar; `off` não avalia. `wouldDecide` = decisão no `enforce`. Usada no `?exemplo=1`.
 */
export function evaluateLocally(
  rules: GovernanceRule[], req: EvaluateRequest, mode: GovMode,
  ctx: { role?: string | null; user?: string | null; cardType?: string | null; exemptRoles?: string[] } = {},
): EvaluateResponse {
  if (mode === 'off') return { decision: 'allow', wouldDecide: 'allow', mode, reason: 'Governança desligada.', rules: [] };
  const hits: EvaluateRuleHit[] = rules
    .filter((r) => ruleMatches(r, req, ctx))
    .sort((a, b) => a.order - b.order)
    .map((r) => ({ key: r.key, name: r.name, effect: r.effect, message: r.effect === 'approval' ? `${r.message} (precisa de aprovação)` : r.message }));
  let would = decide(hits);
  if (ctx.role && ctx.exemptRoles?.includes(ctx.role)) would = 'allow';
  const decision = mode === 'enforce' ? would : 'allow';
  const strongest = hits.find((h) => (would === 'block' ? EFFECT_RANK[h.effect] >= 3 : would === 'warn' ? h.effect === 'warn' : false));
  return { decision, wouldDecide: would, mode, reason: strongest ? `${strongest.message} (regra ${strongest.key})` : null, rules: hits };
}

// ───────────────────────── hooks ─────────────────────────

export function newHook(order = 100): GovernanceHook {
  return {
    id: '', key: '', name: '', description: '', event: 'claude:PostToolUse', matcher: '', action: 'record', config: {},
    enabled: true, builtin: false, order, updatedAt: null, updatedBy: null,
  };
}

/** Chaves de configuração sugeridas por ação. */
export const HOOK_CONFIG_KEYS: Record<string, { key: string; hint: string; required?: boolean }[]> = {
  record: [],
  evaluate: [],
  timeline: [{ key: 'template', hint: "Texto na Timeline (ex.: '{user} {action} no card {card}').", required: true }],
  webhook: [
    { key: 'url', hint: 'Endereço https que recebe o POST com o evento.', required: true },
    { key: 'secret', hint: 'Segredo enviado no cabeçalho de assinatura (opcional).' },
  ],
};

export function validateHook(hook: GovernanceHook, otherKeys: string[]): Record<string, string> {
  const e: Record<string, string> = {};
  const keyErr = validateKey(hook.key, otherKeys);
  if (keyErr) e['key'] = keyErr;
  if (!hook.name.trim()) e['name'] = 'Informe o nome.';
  if (!/^(claude:[A-Za-z]+|server:.+)$/.test(hook.event)) e['event'] = 'Evento "claude:<Nome>" ou "server:<glob da ação>".';
  else if (hook.event.startsWith('server:')) {
    const g = validateGlob(hook.event.slice(7));
    if (g) e['event'] = g;
  }
  if (hook.matcher) {
    const g = validateGlob(hook.matcher);
    if (g) e['matcher'] = g;
  }
  if (hook.event.startsWith('claude:') && (hook.action === 'timeline' || hook.action === 'webhook')) {
    e['action'] = 'Hooks do Claude Code só registram ou avaliam; Timeline e webhook são para gatilhos do servidor.';
  }
  if (hook.event.startsWith('server:') && hook.action === 'evaluate') {
    e['action'] = 'Gatilhos do servidor rodam depois da ação: use registrar, Timeline ou webhook.';
  }
  for (const k of HOOK_CONFIG_KEYS[hook.action] ?? []) {
    if (k.required && !(hook.config[k.key] ?? '').trim()) e[`config.${k.key}`] = `Informe "${k.key}".`;
  }
  if (hook.action === 'webhook' && hook.config['url'] && !/^https?:\/\/\S+$/i.test(hook.config['url'])) {
    e['config.url'] = 'URL inválida (http:// ou https://).';
  }
  const keys = Object.keys(hook.config);
  if (keys.some((k) => !k.trim())) e['config'] = 'Chave vazia na configuração.';
  return e;
}

// ───────────────────────── marcos ─────────────────────────

/** Erros por índice (vazio = ok): chave única em slug, nome, glob válido, fase só em plano/etapa. */
export function validateMilestones(list: Milestone[]): Record<number, string> {
  const e: Record<number, string> = {};
  const seen = new Set<string>();
  list.forEach((m, i) => {
    const keyErr = validateKey(m.key, [...seen]);
    if (keyErr) e[i] = keyErr;
    else if (!m.label.trim()) e[i] = 'Informe o nome do marco.';
    else if (m.match && validateGlob(m.match)) e[i] = validateGlob(m.match)!;
    else if (m.phase && m.from !== 'plan' && m.from !== 'step') e[i] = 'A fase só vale para plano ou etapa.';
    else if (m.from !== 'plan' && !m.match) e[i] = 'Diga o que casa (chave/tipo ou ação).';
    seen.add(m.key);
  });
  return e;
}

/** Renumera `order` (10, 20, 30…) na ordem da lista. */
export function renumber<T extends { order: number }>(list: T[]): T[] {
  return list.map((m, i) => ({ ...m, order: (i + 1) * 10 }));
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const copy = [...list];
  const [it] = copy.splice(from, 1);
  copy.splice(to, 0, it);
  return copy;
}

// ───────────────────────── linha do tempo do card ─────────────────────────

export interface TimelineMilestoneView {
  label: string;
  at: string;
  /** Desde o início do card. */
  sinceStartMs: number;
  /** Desde o marco anterior (null no primeiro). */
  sincePrevMs: number | null;
}

export interface TimelineRowView extends TimelineRow {
  startMs: number;
  endMs: number | null;
  /** Desde o início do card. */
  offsetMs: number;
  /** Duração efetiva (a da API ou fim − início). */
  effectiveMs: number | null;
  day: string;
  /** Posição na barra do período (0–100). */
  leftPct: number;
  widthPct: number;
}

export interface CardTimelineView {
  startedAt: string | null;
  startedBy: string | null;
  endedAt: string | null;
  totalMs: number | null;
  milestones: TimelineMilestoneView[];
  rows: TimelineRowView[];
  /** Tempo somado por tipo (sem marcos e eventos instantâneos). */
  byKind: { kind: TimelineKind; count: number; totalMs: number }[];
}

/**
 * Monta a linha do tempo: ordem cronológica, deslocamento desde o início, duração efetiva, posição na barra e o
 * intervalo entre marcos. Início = primeira atividade do card (ou a primeira linha); fim = maior fim/início.
 */
export function buildCardTimeline(detail: GovernanceCardDetail): CardTimelineView {
  const rows = (detail.timeline ?? [])
    .map((r) => ({ r, s: parseApiDate(r.at) }))
    .filter((x): x is { r: TimelineRow; s: number } => x.s != null)
    .sort((a, b) => a.s - b.s);
  const first = parseApiDate(detail.card.firstActivityAt) ?? rows[0]?.s ?? null;
  if (first == null) return { startedAt: null, startedBy: null, endedAt: null, totalMs: null, milestones: [], rows: [], byKind: [] };
  const start = Math.min(first, rows[0]?.s ?? first);

  let end = parseApiDate(detail.card.lastActivityAt) ?? start;
  for (const { r, s } of rows) {
    const e = parseApiDate(r.endAt) ?? (r.durationMs != null ? s + r.durationMs : s);
    end = Math.max(end, e, s);
  }
  const span = Math.max(1, end - start);

  const views: TimelineRowView[] = rows.map(({ r, s }) => {
    const e = parseApiDate(r.endAt) ?? (r.durationMs != null ? s + r.durationMs : null);
    const eff = r.durationMs ?? (e != null ? Math.max(0, e - s) : null);
    const left = ((s - start) / span) * 100;
    const width = eff != null ? Math.max(0.6, (eff / span) * 100) : 0.6;
    return {
      ...r, startMs: s, endMs: e, offsetMs: s - start, effectiveMs: eff, day: dayKey(new Date(s)),
      leftPct: Math.min(99.4, left), widthPct: Math.min(100 - Math.min(99.4, left), width),
    };
  });

  // Marcos: da linha do tempo (kind milestone) ou, se não vierem, dos marcos do card.
  const msSource = views.filter((v) => v.kind === 'milestone').map((v) => ({ label: v.title, at: v.at, s: v.startMs }));
  const fromCard = (detail.card.milestones ?? [])
    .map((m) => ({ label: m.label, at: m.at, s: parseApiDate(m.at) }))
    .filter((m): m is { label: string; at: string; s: number } => m.s != null)
    .sort((a, b) => a.s - b.s);
  const ms = msSource.length ? msSource : fromCard;
  const milestones = ms.map((m, i) => ({
    label: m.label, at: m.at, sinceStartMs: m.s - start, sincePrevMs: i === 0 ? null : m.s - ms[i - 1].s,
  }));

  const kinds = new Map<TimelineKind, { count: number; totalMs: number }>();
  for (const v of views) {
    if (v.kind === 'milestone' || v.kind === 'event') continue;
    const k = kinds.get(v.kind) ?? { count: 0, totalMs: 0 };
    k.count++;
    k.totalMs += v.effectiveMs ?? 0;
    kinds.set(v.kind, k);
  }

  const firstUser = views.find((v) => v.user)?.user ?? detail.card.users?.[0] ?? null;
  return {
    startedAt: new Date(start).toISOString(),
    startedBy: firstUser,
    endedAt: new Date(end).toISOString(),
    totalMs: detail.card.leadTimeMs ?? end - start,
    milestones,
    rows: views,
    byKind: [...kinds.entries()].map(([kind, v]) => ({ kind, ...v })).sort((a, b) => b.totalMs - a.totalMs),
  };
}

// ───────────────────────── detalhe do usuário ─────────────────────────

/**
 * `GET users/{id}` em qualquer dos formatos: plano (`{ ...resumo, cards: CardRow[], recent }`, com a lista no lugar do
 * número de cards) ou aninhado (`{ summary | user: resumo, cards, recent }`).
 */
export function normalizeUserDetail(raw: unknown, userId: string): GovernanceUserDetail {
  const o = (raw ?? {}) as Record<string, unknown>;
  const nested = (o['summary'] ?? o['user']) as GovernanceUserRow | undefined;
  const cards = Array.isArray(o['cards']) ? (o['cards'] as GovernanceCardRow[]) : [];
  const recent = Array.isArray(o['recent']) ? (o['recent'] as GovernanceEvent[]) : [];
  const flat = { ...(o as unknown as GovernanceUserRow) };
  const summary: GovernanceUserRow = nested && typeof nested === 'object'
    ? { ...nested }
    : { ...flat, cards: typeof o['cards'] === 'number' ? (o['cards'] as number) : (typeof o['cardCount'] === 'number' ? (o['cardCount'] as number) : cards.length) };
  summary.userId ||= userId;
  delete (summary as unknown as Record<string, unknown>)['recent'];
  return { summary, cards, recent };
}

// ───────────────────────── ação barrada / aviso (interceptor) ─────────────────────────

export interface BlockedNotice {
  message: string;
  rules: { key: string; name: string }[];
}

/** Lê o corpo do 403 `governance_blocked` (objeto ou texto JSON). Outro 403 → null. */
export function parseBlockedBody(body: unknown): BlockedNotice | null {
  let b = body;
  if (typeof b === 'string') {
    try {
      b = JSON.parse(b);
    } catch {
      return null;
    }
  }
  if (!b || typeof b !== 'object') return null;
  const o = b as Record<string, unknown>;
  if (o['code'] !== GOVERNANCE_BLOCKED) return null;
  const rules = Array.isArray(o['rules'])
    ? (o['rules'] as unknown[]).map((r) => {
      if (typeof r === 'string') return { key: r, name: r };
      const x = (r ?? {}) as Record<string, unknown>;
      const key = `${x['key'] ?? ''}`;
      return { key, name: `${x['name'] ?? key}` };
    }).filter((r) => r.key || r.name)
    : [];
  const message = `${o['message'] ?? ''}`.trim() || 'Ação barrada pela governança do PRMake.';
  return { message, rules };
}

/** Cabeçalho `X-Governance-Warning`: vem em URL-encoding (cabeçalho HTTP é ASCII); texto inválido volta como veio. */
export function decodeWarningHeader(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;
  const v = value.trim();
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/** Mensagem de erro da API (`{ message }` em 400/409) ou o texto padrão. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const e = err as { error?: unknown; status?: number } | null;
  const body = e?.error;
  if (body && typeof body === 'object' && typeof (body as Record<string, unknown>)['message'] === 'string') {
    const m = `${(body as Record<string, unknown>)['message']}`.trim();
    if (m) return m;
  }
  if (typeof body === 'string' && body.trim() && body.length < 300 && !body.trim().startsWith('<')) return body.trim();
  return fallback;
}

/** Valor de segredo que a API devolve mascarado; mandado de volta igual, mantém o valor guardado. */
export const MASKED_SECRET = '***';

/** Texto curto de uma lista ("a, b e c"). */
export function joinPt(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}
