/**
 * Padrões de banco e de aplicação (0101): lógica pura da aba "Padrões" — normalização, filtros, agrupamento, validação
 * do editor, conferência local (demonstração e prévia do rascunho), rascunho de importação com diferença por item e a
 * aderência a partir da trilha. Sem Angular: tudo testado em `standards.logic.spec.ts`.
 */
import {
  GovDecision, GovMode, GovernanceEvent, STANDARD_TOPICS, STANDARD_AREAS, STANDARD_TOPIC_LABEL, STANDARD_AREA_LABEL, Standard, StandardArea,
  StandardCheck, StandardCheckRequest, StandardCheckResponse, StandardCheckTarget, StandardDraft, StandardDraftChange, StandardEffect,
  StandardFinding, StandardSourceKind, StandardStatus,
} from './governance.model';
import { globMatch, validateGlob, validateKey, validateRegex } from './governance.logic';
import { parseApiDate } from '../usage/usage.model';

// ───────────────────────── normalização ─────────────────────────

const AREAS: StandardArea[] = ['database', 'application'];
const STATUSES: StandardStatus[] = ['proposed', 'active', 'deprecated'];
const EFFECTS: StandardEffect[] = ['monitor', 'warn', 'block'];

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => `${x ?? ''}`.trim()).filter((x) => x.length) : [];
}

export function emptyCheck(): StandardCheck {
  return { kind: 'none', target: null, pattern: null, mustMatch: false, sql: null, hint: null };
}

/** Preenche o que a API não mandou (listas vazias, conferência "none"), sem mudar o que veio. */
export function normalizeStandard(raw: Partial<Standard> | null | undefined): Standard {
  const r = (raw ?? {}) as Partial<Standard>;
  const ex = (r.examples ?? {}) as Partial<Standard['examples']>;
  const ap = (r.appliesTo ?? {}) as Partial<Standard['appliesTo']>;
  const src = (r.source ?? {}) as Partial<Standard['source']>;
  const ck = (r.check ?? {}) as Partial<StandardCheck>;
  const key = `${r.key ?? ''}`;
  return {
    id: `${r.id ?? ''}`,
    key,
    code: `${r.code ?? ''}` || key.toUpperCase(),
    area: AREAS.includes(r.area as StandardArea) ? (r.area as StandardArea) : 'database',
    topic: `${r.topic ?? ''}`.trim().toLowerCase() || 'general',
    title: `${r.title ?? ''}`,
    textPt: `${r.textPt ?? ''}`,
    textEn: r.textEn ? `${r.textEn}` : null,
    examples: { good: strList(ex.good), bad: strList(ex.bad) },
    appliesTo: {
      platforms: strList(ap.platforms), repositories: strList(ap.repositories), modules: strList(ap.modules),
      objects: strList(ap.objects) as Standard['appliesTo']['objects'],
    },
    source: {
      kind: (['wiki', 'reverse-engineering', 'manual'].includes(`${src.kind}`) ? src.kind : 'manual') as StandardSourceKind,
      ref: `${src.ref ?? ''}`, version: src.version ?? null, url: src.url ?? null,
    },
    status: STATUSES.includes(r.status as StandardStatus) ? (r.status as StandardStatus) : 'proposed',
    effect: EFFECTS.includes(r.effect as StandardEffect) ? (r.effect as StandardEffect) : 'monitor',
    check: {
      kind: (['none', 'regex', 'path', 'sql', 'builtin'].includes(`${ck.kind}`) ? ck.kind : 'none') as StandardCheck['kind'],
      target: (ck.target ?? null) as StandardCheckTarget | null,
      pattern: ck.pattern ?? null,
      mustMatch: !!ck.mustMatch,
      sql: ck.sql ?? null,
      hint: ck.hint ?? null,
    },
    ...(r.order != null ? { order: r.order } : {}),
    updatedAt: r.updatedAt ?? null,
    updatedBy: r.updatedBy ?? null,
  };
}

/** Padrão manual novo (começa proposto e em monitorar, como tudo na 0101). */
export function newStandard(area: StandardArea = 'database'): Standard {
  return normalizeStandard({
    id: '', key: '', code: '', area, topic: area === 'database' ? 'general' : 'layers', title: '', textPt: '', textEn: null,
    status: 'proposed', effect: 'monitor', source: { kind: 'manual', ref: '', version: null, url: null },
  });
}

/** Efeito que vale de fato: proposto/descontinuado só monitora (igual ao `EffectiveEffect` do backend). */
export function effectiveEffect(s: Pick<Standard, 'status' | 'effect'>): StandardEffect {
  return s.status === 'active' ? s.effect : 'monitor';
}

// ───────────────────────── ordem, filtros e grupos ─────────────────────────

/** Ordem natural dos códigos da origem: G1 < G2 < G10 < IX1 < IXU1 < N1. */
export function compareCode(a: string, b: string): number {
  const pa = /^([^\d]*)(\d*)(.*)$/.exec(a.toUpperCase())!;
  const pb = /^([^\d]*)(\d*)(.*)$/.exec(b.toUpperCase())!;
  if (pa[1] !== pb[1]) return pa[1].localeCompare(pb[1]);
  const na = pa[2] ? Number(pa[2]) : -1;
  const nb = pb[2] ? Number(pb[2]) : -1;
  if (na !== nb) return na - nb;
  return pa[3].localeCompare(pb[3]);
}

export function sortStandards(list: Standard[]): Standard[] {
  return [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || compareCode(a.code, b.code) || a.key.localeCompare(b.key));
}

export interface StandardListFilter {
  area?: StandardArea | '' | null;
  topic?: string | null;
  status?: StandardStatus | '' | null;
  effect?: StandardEffect | '' | null;
  source?: StandardSourceKind | '' | null;
  /** Mostra os que valem para o repositório (lista vazia no padrão = vale para todos). */
  repository?: string | null;
  module?: string | null;
  search?: string | null;
}

function appliesToValue(list: string[], value: string): boolean {
  if (!list.length) return true;
  const v = value.trim().toLowerCase();
  return list.some((x) => x.toLowerCase() === v || globMatch(x, v));
}

export function filterStandards(list: Standard[], f: StandardListFilter): Standard[] {
  const q = (f.search ?? '').trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  return list.filter((s) => {
    if (f.area && s.area !== f.area) return false;
    if (f.topic && s.topic !== f.topic) return false;
    if (f.status && s.status !== f.status) return false;
    if (f.effect && s.effect !== f.effect) return false;
    if (f.source && s.source.kind !== f.source) return false;
    if (f.repository?.trim() && !appliesToValue(s.appliesTo.repositories, f.repository)) return false;
    if (f.module?.trim() && !appliesToValue(s.appliesTo.modules, f.module)) return false;
    if (terms.length) {
      const hay = `${s.code} ${s.key} ${s.title} ${s.textPt} ${s.textEn ?? ''} ${s.source.ref}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
}

export interface StandardTopicGroup {
  topic: string;
  label: string;
  items: Standard[];
}

export interface StandardAreaGroup {
  area: StandardArea;
  label: string;
  count: number;
  topics: StandardTopicGroup[];
}

/** Área (Banco de dados · Aplicação) → assunto (ordem do catálogo; desconhecidos no fim, em ordem alfabética). */
export function groupStandards(list: Standard[]): StandardAreaGroup[] {
  const out: StandardAreaGroup[] = [];
  for (const area of STANDARD_AREAS) {
    const inArea = list.filter((s) => s.area === area);
    if (!inArea.length) continue;
    const topics = [...new Set(inArea.map((s) => s.topic))].sort((a, b) => topicRank(a) - topicRank(b) || a.localeCompare(b));
    out.push({
      area, label: STANDARD_AREA_LABEL[area], count: inArea.length,
      topics: topics.map((t) => ({ topic: t, label: STANDARD_TOPIC_LABEL[t] ?? t, items: sortStandards(inArea.filter((s) => s.topic === t)) })),
    });
  }
  return out;
}

function topicRank(t: string): number {
  const i = STANDARD_TOPICS.indexOf(t);
  return i < 0 ? 999 : i;
}

export interface StandardFacets {
  topics: string[];
  repositories: string[];
  modules: string[];
  counts: { total: number; active: number; proposed: number; deprecated: number; withCheck: number; enforcing: number };
}

export function standardFacets(list: Standard[]): StandardFacets {
  const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b));
  return {
    topics: [...new Set(list.map((s) => s.topic))].sort((a, b) => topicRank(a) - topicRank(b) || a.localeCompare(b)),
    repositories: uniq(list.flatMap((s) => s.appliesTo.repositories)),
    modules: uniq(list.flatMap((s) => s.appliesTo.modules)),
    counts: {
      total: list.length,
      active: list.filter((s) => s.status === 'active').length,
      proposed: list.filter((s) => s.status === 'proposed').length,
      deprecated: list.filter((s) => s.status === 'deprecated').length,
      withCheck: list.filter((s) => s.check.kind !== 'none').length,
      enforcing: list.filter((s) => effectiveEffect(s) !== 'monitor').length,
    },
  };
}

// ───────────────────────── origem ─────────────────────────

export interface ErRef {
  module: string;
  item: string | null;
}

/** `ref` da engenharia reversa: "actionplan#ARQ-003" (vários separados por vírgula/espaço). */
export function parseErRefs(ref: string | null | undefined): ErRef[] {
  if (!ref) return [];
  return ref.split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const [module, item] = p.split('#');
    return { module: module.trim(), item: item?.trim() || null };
  }).filter((r) => r.module);
}

// ───────────────────────── validação do editor ─────────────────────────

const SQL_FORBIDDEN = /\b(insert|update|delete|merge|drop|alter|truncate|create|exec|execute|grant|revoke|deny|into|backup|restore|dbcc|shutdown|kill|bulk|openrowset|opendatasource|xp_\w+|sp_\w+)\b/i;

/** Tira comentários (`--`, `/* *\/`) e textos entre aspas, para conferir só os comandos. */
export function stripSqlNoise(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/N?'(?:[^']|'')*'/g, "''");
}

/** A consulta de validação roda no banco de um ambiente: só SELECT/WITH, sem comandos que gravam ou executam. */
export function validateReadOnlySql(sql: string | null | undefined): string | null {
  if (!sql || !sql.trim()) return 'Informe a consulta de validação.';
  const body = stripSqlNoise(sql).trim();
  if (!/^(select|with)\b/i.test(body)) return 'A consulta precisa começar com SELECT ou WITH (somente leitura).';
  const bad = SQL_FORBIDDEN.exec(body);
  if (bad) return `Comando não permitido na consulta de validação: ${bad[1].toUpperCase()} (somente leitura).`;
  return null;
}

/** Erros do padrão em edição (chave → mensagem). */
export function validateStandard(s: Standard, otherKeys: string[]): Record<string, string> {
  const e: Record<string, string> = {};
  if (!s.id) {
    const k = validateKey(s.key, otherKeys);
    if (k) e['key'] = k;
  }
  if (!s.code.trim()) e['code'] = 'Informe o código (ex.: FK7).';
  else if (s.code.length > 20) e['code'] = 'Código com no máximo 20 caracteres.';
  if (!s.title.trim()) e['title'] = 'Informe o título.';
  if (!s.textPt.trim()) e['textPt'] = 'Informe o texto em português.';
  const c = s.check;
  if (c.kind === 'regex') {
    const r = validateRegex(c.pattern ?? '');
    if (r) e['check.pattern'] = r;
    if (!c.target || c.target === 'path') e['check.target'] = 'Escolha sobre o que a expressão é conferida (SQL, migração ou código).';
  } else if (c.kind === 'path') {
    const g = validateGlob(c.pattern ?? '');
    if (g) e['check.pattern'] = g;
  } else if (c.kind === 'builtin') {
    if (!c.pattern?.trim()) e['check.pattern'] = 'Informe o nome da conferência embutida.';
  } else if (c.kind === 'sql') {
    const q = validateReadOnlySql(c.sql);
    if (q) e['check.sql'] = q;
  }
  return e;
}

/** Ajusta a conferência ao trocar o tipo (alvo coerente; sem lixo de outro tipo). */
export function switchCheckKind(c: StandardCheck, kind: StandardCheck['kind']): StandardCheck {
  if (kind === c.kind) return c;
  const base = { ...emptyCheck(), kind, hint: c.hint ?? null };
  if (kind === 'regex') return { ...base, target: c.target && c.target !== 'path' ? c.target : 'sql', pattern: c.kind === 'regex' ? c.pattern : null };
  if (kind === 'path') return { ...base, target: 'path', mustMatch: true };
  if (kind === 'sql') return { ...base, target: 'sql', sql: c.sql };
  if (kind === 'builtin') return { ...base, target: c.target ?? 'sql' };
  return base;
}

// ───────────────────────── conferência local ─────────────────────────

/**
 * Linhas fora do escopo da wiki (G8, S5, T3, P4, V5): objetos do `dbo` (legado) e a tabela de histórico do EF.
 */
export function isOutOfScopeLine(line: string): boolean {
  return /\[?\bdbo\b\]?\s*\./i.test(line) || /__EFMigrations?History/i.test(line);
}

function targetApplies(std: StandardCheckTarget | null, req: StandardCheckTarget): boolean {
  if (req === 'path') return std === 'path';
  if (!std) return true;
  if (std === req) return true;
  // SQL vale também dentro de migração (migrationBuilder.Sql / scripts .sql da migração).
  return std === 'sql' && req === 'migration';
}

function applies(s: Standard, req: StandardCheckRequest): boolean {
  if (s.status === 'deprecated') return false;
  if (req.repository && s.appliesTo.repositories.length && !appliesToValue(s.appliesTo.repositories, req.repository)) return false;
  return true;
}

function excerptOf(line: string, max = 160): string {
  const t = line.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function hintOf(s: Standard): string {
  return s.check.hint?.trim() || `${s.code}: ${s.title}`;
}

function finding(s: Standard, line: number | null, excerpt: string, hint = hintOf(s)): StandardFinding {
  return { key: s.key, code: s.code, title: s.title, effect: effectiveEffect(s), line, excerpt, hint };
}

/**
 * Conferência no navegador (só regex e caminho) — usada nos dados de demonstração e na prévia do rascunho em edição.
 * A real é `POST standards/check` (backend, com as conferências embutidas). A regex roda linha a linha, sem diferenciar
 * maiúsculas, e ignora linhas do `dbo`/histórico do EF.
 */
export function checkLocally(standards: Standard[], req: StandardCheckRequest, mode: GovMode = 'monitor'): StandardCheckResponse {
  const findings: StandardFinding[] = [];
  const lines = (req.text ?? '').split(/\r?\n/);
  const path = (req.path ?? (req.target === 'path' ? req.text : '') ?? '').trim();
  for (const s of standards) {
    if (!applies(s, req)) continue;
    const c = s.check;
    if (c.kind === 'regex' && c.pattern && targetApplies(c.target, req.target)) {
      let re: RegExp;
      try {
        re = new RegExp(c.pattern, 'i');
      } catch {
        continue;
      }
      let any = false;
      lines.forEach((ln, i) => {
        if (!ln.trim() || isOutOfScopeLine(ln)) return;
        if (re.test(ln)) {
          any = true;
          if (!c.mustMatch) findings.push(finding(s, i + 1, excerptOf(ln)));
        }
      });
      if (c.mustMatch && !any && req.text.trim()) findings.push(finding(s, null, '', `${hintOf(s)} (não encontrado no texto)`));
    } else if (c.kind === 'path' && c.pattern && path) {
      const hit = globMatch(c.pattern, path, true);
      if (hit !== c.mustMatch) findings.push(finding(s, null, path));
    }
  }
  return { ...decide(findings, mode), findings };
}

/** Decisão a partir dos efeitos dos achados e do modo global (monitorando = deixa passar, com o "teria barrado"). */
export function decide(findings: Pick<StandardFinding, 'effect'>[], mode: GovMode): { decision: GovDecision; wouldDecide: GovDecision; mode: GovMode } {
  const would: GovDecision = findings.some((f) => f.effect === 'block') ? 'block' : findings.some((f) => f.effect === 'warn') ? 'warn' : 'allow';
  return { decision: mode === 'enforce' ? would : 'allow', wouldDecide: would, mode };
}

/** Achados agrupados por linha (para marcar as linhas do texto testado). */
export function findingsByLine(findings: StandardFinding[]): Map<number, StandardFinding[]> {
  const m = new Map<number, StandardFinding[]>();
  for (const f of findings) {
    if (f.line == null) continue;
    if (!m.has(f.line)) m.set(f.line, []);
    m.get(f.line)!.push(f);
  }
  return m;
}

// ───────────────────────── importação: rascunho e diferença ─────────────────────────

export type DraftKind = 'added' | 'changed' | 'removed';

export interface DraftField {
  key: 'title' | 'textPt' | 'textEn' | 'examples' | 'status' | 'effect' | 'appliesTo' | 'check' | 'topic' | 'code' | 'source';
  label: string;
}

export interface DraftRow {
  key: string;
  kind: DraftKind;
  code: string;
  title: string;
  area: StandardArea;
  topic: string;
  before: Standard | null;
  after: Standard | null;
  fields: DraftField[];
}

const FIELD_LABEL: Record<DraftField['key'], string> = {
  title: 'Título', textPt: 'Texto PT', textEn: 'Texto EN', examples: 'Exemplos', status: 'Estado', effect: 'Efeito',
  appliesTo: 'Aplica-se a', check: 'Conferência', topic: 'Assunto', code: 'Código', source: 'Origem',
};

/** O que mudou entre o catálogo e a origem (efeito/estado do catálogo contam só se a origem mandar diferente). */
export function changedFields(before: Standard, after: Standard): DraftField[] {
  const keys: DraftField['key'][] = [];
  if (before.code !== after.code) keys.push('code');
  if (before.title !== after.title) keys.push('title');
  if (before.textPt !== after.textPt) keys.push('textPt');
  if ((before.textEn ?? '') !== (after.textEn ?? '')) keys.push('textEn');
  if (JSON.stringify(before.examples) !== JSON.stringify(after.examples)) keys.push('examples');
  if (before.topic !== after.topic) keys.push('topic');
  if (before.status !== after.status) keys.push('status');
  if (before.effect !== after.effect) keys.push('effect');
  if (JSON.stringify(before.appliesTo) !== JSON.stringify(after.appliesTo)) keys.push('appliesTo');
  if (JSON.stringify(before.check) !== JSON.stringify(after.check)) keys.push('check');
  if ((before.source.version ?? '') !== (after.source.version ?? '') || before.source.ref !== after.source.ref) keys.push('source');
  return keys.map((key) => ({ key, label: FIELD_LABEL[key] }));
}

function isChange(x: unknown): x is StandardDraftChange {
  return !!x && typeof x === 'object' && 'after' in (x as object) && !!(x as StandardDraftChange).after;
}

/** Rascunho → linhas (aceita `changed` como `{before, after}` ou só o padrão; `removed` como padrão ou chave). */
export function normalizeDraft(draft: StandardDraft, current: Standard[]): DraftRow[] {
  const byKey = new Map(current.map((s) => [s.key, s]));
  const rows: DraftRow[] = [];
  for (const a of draft.added ?? []) {
    const after = normalizeStandard(a);
    rows.push(row(after.key, 'added', null, after));
  }
  for (const c of draft.changed ?? []) {
    const after = normalizeStandard(isChange(c) ? c.after : (c as Standard));
    const before = isChange(c) && c.before ? normalizeStandard(c.before) : byKey.get(after.key) ?? null;
    const r = row(after.key, 'changed', before, after);
    r.fields = before ? changedFields(before, after) : [];
    rows.push(r);
  }
  for (const x of draft.removed ?? []) {
    const before = typeof x === 'string' ? byKey.get(x) ?? null : normalizeStandard(x);
    const key = typeof x === 'string' ? x : before!.key;
    rows.push(row(key, 'removed', before, null));
  }
  return rows.sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.area.localeCompare(b.area) || compareCode(a.code, b.code));
}

function kindRank(k: DraftKind): number {
  return k === 'added' ? 0 : k === 'changed' ? 1 : 2;
}

function row(key: string, kind: DraftKind, before: Standard | null, after: Standard | null): DraftRow {
  const s = after ?? before;
  return {
    key, kind, code: s?.code ?? key, title: s?.title ?? key, area: s?.area ?? 'database', topic: s?.topic ?? 'general',
    before, after, fields: [],
  };
}

export interface DraftSummary {
  added: number;
  changed: number;
  removed: number;
  /** Novos que entram como propostos (itens (NEW) da wiki). */
  proposed: number;
}

export function draftSummary(rows: DraftRow[]): DraftSummary {
  return {
    added: rows.filter((r) => r.kind === 'added').length,
    changed: rows.filter((r) => r.kind === 'changed').length,
    removed: rows.filter((r) => r.kind === 'removed').length,
    proposed: rows.filter((r) => r.kind === 'added' && r.after?.status === 'proposed').length,
  };
}

export interface DiffSegment {
  op: 'eq' | 'del' | 'ins';
  text: string;
}

/**
 * Diferença por palavra (LCS) entre dois textos — "o que mudou" no item da wiki. Textos grandes demais para a tabela
 * (> 4 milhões de células) voltam como "tirou tudo / pôs tudo".
 */
export function wordDiff(a: string | null | undefined, b: string | null | undefined): DiffSegment[] {
  const x = tokenize(a ?? '');
  const y = tokenize(b ?? '');
  if (!x.length && !y.length) return [];
  if (x.length * y.length > 4_000_000) return merge([...(a ? [{ op: 'del' as const, text: a }] : []), ...(b ? [{ op: 'ins' as const, text: b }] : [])]);
  const n = x.length;
  const m = y.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const out: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ op: 'eq', text: x[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ op: 'del', text: x[i++] });
    } else {
      out.push({ op: 'ins', text: y[j++] });
    }
  }
  while (i < n) out.push({ op: 'del', text: x[i++] });
  while (j < m) out.push({ op: 'ins', text: y[j++] });
  return merge(out);
}

/** Palavras e espaços como tokens separados (o texto remontado fica igual ao original; "x." e "x. " casam). */
function tokenize(s: string): string[] {
  return s.match(/\s+|\S+/g) ?? [];
}

function merge(segs: DiffSegment[]): DiffSegment[] {
  const out: DiffSegment[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && last.op === s.op) last.text += s.text;
    else out.push({ ...s });
  }
  return out;
}

// ───────────────────────── aderência (a partir da trilha) ─────────────────────────

/**
 * Repositório do achado. A trilha (0098) não tem coluna de repositório: usa `repository` se a API mandar no evento, senão
 * "repo: <nome>" no detalhe; sem isso, "—".
 */
export function eventRepository(e: GovernanceEvent): string | null {
  const direct = (e as GovernanceEvent & { repository?: string | null }).repository;
  if (direct) return direct;
  const m = /(?:^|[\s·|;,(])repo(?:sitory|sitório)?\s*[:=]\s*([^\s·|;,)]+)/i.exec(e.detail ?? '');
  return m ? m[1] : null;
}

export interface AdherenceStandardRow {
  key: string;
  code: string;
  title: string;
  status: StandardStatus | null;
  effect: StandardEffect | null;
  count: number;
  blocked: number;
  warned: number;
  cards: number;
  repositories: number;
  lastAt: string | null;
}

export interface AdherenceGroupRow {
  key: string;
  count: number;
  blocked: number;
  warned: number;
  standards: string[];
  lastAt: string | null;
}

export interface AdherenceView {
  total: number;
  blocked: number;
  warned: number;
  monitored: number;
  cards: number;
  repositories: number;
  byStandard: AdherenceStandardRow[];
  byRepository: AdherenceGroupRow[];
  byCard: (AdherenceGroupRow & { card: number })[];
  recent: GovernanceEvent[];
}

/** Acha o padrão de um id da trilha (`rules`): chave, id ou código. */
export function standardLookup(standards: Standard[]): (ref: string) => Standard | null {
  const m = new Map<string, Standard>();
  for (const s of standards) {
    m.set(s.key.toLowerCase(), s);
    if (s.id) m.set(s.id.toLowerCase(), s);
  }
  for (const s of standards) if (!m.has(s.code.toLowerCase())) m.set(s.code.toLowerCase(), s);
  return (ref) => m.get(`${ref}`.toLowerCase()) ?? null;
}

/** Achados por padrão, por repositório e por card (eventos da categoria `standard`). */
export function standardAdherence(events: GovernanceEvent[], standards: Standard[], recentTake = 20): AdherenceView {
  const find = standardLookup(standards);
  const std = new Map<string, AdherenceStandardRow & { cardSet: Set<number>; repoSet: Set<string> }>();
  const repos = new Map<string, AdherenceGroupRow & { set: Set<string> }>();
  const cards = new Map<number, AdherenceGroupRow & { set: Set<string> }>();
  const later = (a: string | null, b: string) => (!a || (parseApiDate(b) ?? 0) > (parseApiDate(a) ?? 0) ? b : a);
  const sorted = [...events].sort((a, b) => (parseApiDate(b.startedAt) ?? 0) - (parseApiDate(a.startedAt) ?? 0));
  for (const e of sorted) {
    const blocked = e.outcome === 'blocked' ? 1 : 0;
    const warned = e.outcome === 'warned' ? 1 : 0;
    const repo = eventRepository(e);
    const keys = [...new Set((e.rules ?? []).map((r) => find(r)?.key ?? r))];
    for (const k of keys) {
      const s = find(k);
      const cur = std.get(k) ?? {
        key: k, code: s?.code ?? k, title: s?.title ?? k, status: s?.status ?? null, effect: s?.effect ?? null,
        count: 0, blocked: 0, warned: 0, cards: 0, repositories: 0, lastAt: null, cardSet: new Set<number>(), repoSet: new Set<string>(),
      };
      cur.count++;
      cur.blocked += blocked;
      cur.warned += warned;
      cur.lastAt = later(cur.lastAt, e.startedAt);
      if (e.cardNumber != null) cur.cardSet.add(e.cardNumber);
      if (repo) cur.repoSet.add(repo);
      std.set(k, cur);
    }
    const codes = keys.map((k) => find(k)?.code ?? k);
    const bump = <K>(map: Map<K, AdherenceGroupRow & { set: Set<string> }>, id: K, label: string) => {
      const g = map.get(id) ?? { key: label, count: 0, blocked: 0, warned: 0, standards: [], lastAt: null, set: new Set<string>() };
      g.count++;
      g.blocked += blocked;
      g.warned += warned;
      g.lastAt = later(g.lastAt, e.startedAt);
      codes.forEach((c) => g.set.add(c));
      map.set(id, g);
    };
    bump(repos, repo ?? '—', repo ?? '—');
    if (e.cardNumber != null) bump(cards, e.cardNumber, `${e.cardNumber}`);
  }
  const finishGroup = (g: AdherenceGroupRow & { set: Set<string> }): AdherenceGroupRow => {
    const { set, ...rest } = g;
    return { ...rest, standards: [...set].sort(compareCode) };
  };
  const byCount = (a: { count: number; lastAt: string | null }, b: { count: number; lastAt: string | null }) =>
    b.count - a.count || (parseApiDate(b.lastAt) ?? 0) - (parseApiDate(a.lastAt) ?? 0);
  return {
    total: events.length,
    blocked: events.filter((e) => e.outcome === 'blocked').length,
    warned: events.filter((e) => e.outcome === 'warned').length,
    monitored: events.filter((e) => e.outcome === 'monitored').length,
    cards: cards.size,
    repositories: [...repos.keys()].filter((k) => k !== '—').length,
    byStandard: [...std.values()].map(({ cardSet, repoSet, ...r }) => ({ ...r, cards: cardSet.size, repositories: repoSet.size })).sort(byCount),
    byRepository: [...repos.values()].map(finishGroup).sort(byCount),
    byCard: [...cards.entries()].map(([card, g]) => ({ ...finishGroup(g), card })).sort(byCount),
    recent: sorted.slice(0, recentTake),
  };
}

// ───────────────────────── texto ─────────────────────────

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Markdown de linha da wiki (só `código` e **negrito**) → HTML seguro (o resto é escapado). */
export function inlineMd(text: string | null | undefined): string {
  if (!text) return '';
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}

/** Exemplo de lista vinda de textarea: um por bloco, separados por linha em branco. */
export function splitExamples(text: string): string[] {
  return text.split(/\n\s*\n/).map((x) => x.replace(/^\n+|\s+$/g, '')).filter((x) => x.trim().length);
}

export function joinExamples(list: string[]): string {
  return list.join('\n\n');
}
