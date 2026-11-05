import type { TaskKindParam, TaskParamInput, TaskParamOption } from '../work-items/work-item.model';
import type { CardStates, GitHubBranch } from '../../services/work-items.service';

/**
 * 0085 rodada 3 — lógica pura dos controles dos parâmetros das sub-tarefas (sem Angular, testada em
 * param-input.spec.ts): qual controle cada parâmetro usa, as sugestões de branch/destino, a ordem dos estados do
 * card, o valor dos commits e os links do GitHub.
 */

export const PARAM_INPUTS: readonly TaskParamInput[] = ['repository', 'branch', 'target-branch', 'state', 'commits', 'text', 'textarea', 'select'];

/** Bases do fluxo Solvace (destinos usuais de PR), na ordem em que aparecem nas sugestões. */
export const BASE_BRANCHES: readonly string[] = ['release-version', 'hotfix-version', 'qa', 'development', 'master', 'edge'];

/** Valor de `commits` que significa "todos os commits do card" (padrão dos modelos). */
export const ALL_CARD_COMMITS = 'card';

/** Kinds em que `target` é texto (onde comentar/avisar), não branch de destino. */
const TEXT_TARGET_KINDS = new Set(['comment', 'notify', 'ticket']);

/**
 * Controle do parâmetro: o `input` do catálogo quando é conhecido; senão a reserva pelo nome
 * (repository→repository; branch/source/from→branch; target→target-branch; state→state; commits→commits;
 * description/instructions/message/text→textarea; com `options`→select).
 */
export function paramInput(param: Pick<TaskKindParam, 'key' | 'input' | 'options'>, kind?: string | null): TaskParamInput {
  const declared = `${param.input ?? ''}`.trim().toLowerCase();
  if ((PARAM_INPUTS as readonly string[]).includes(declared)) return declared as TaskParamInput;
  if (param.options?.length) return 'select';
  const key = `${param.key ?? ''}`.trim().toLowerCase();
  switch (key) {
    case 'repository':
    case 'repo':
      return 'repository';
    case 'branch':
    case 'source':
    case 'from':
    case 'base':
      return 'branch';
    case 'target':
      return TEXT_TARGET_KINDS.has(`${kind ?? ''}`) ? 'text' : 'target-branch';
    case 'state':
      return 'state';
    case 'commits':
      return 'commits';
    case 'description':
    case 'instructions':
    case 'message':
    case 'text':
      return 'textarea';
    case 'draft':
      return 'select';
    default:
      return 'text';
  }
}

export interface ParamOption {
  value: string;
  label: string;
}

/** Opções do `select` (do catálogo; `draft` sem opções vira Sim/Não). */
export function paramOptions(param: Pick<TaskKindParam, 'key' | 'options'>): ParamOption[] {
  const raw: TaskParamOption[] = param.options?.length
    ? param.options
    : `${param.key}`.toLowerCase() === 'draft' ? [{ value: 'false', label: 'Não' }, { value: 'true', label: 'Sim' }] : [];
  return raw
    .map((o) => (typeof o === 'string' ? { value: o, label: o } : { value: `${o?.value ?? ''}`, label: `${o?.label || o?.value || ''}` }))
    .map((o) => (o.label === 'true' ? { ...o, label: 'Sim' } : o.label === 'false' ? { ...o, label: 'Não' } : o))
    .filter((o) => o.value !== '');
}

/** De onde veio a sugestão de branch (selo na lista). */
export type BranchTag = 'fluxo' | 'regra' | 'card' | 'base' | 'github';

export interface BranchOption {
  name: string;
  tag: BranchTag;
  /** Texto curto ao lado (ex.: "→ release-version", "padrão", "protegida"). */
  hint?: string | null;
}

/** Contexto das sugestões: regras do card (catálogo `?card=` e/ou `Skills/rules`). */
export interface BranchSuggestContext {
  mainBranch?: string | null;
  branchesByTarget?: Record<string, string> | null;
  flowTargets?: string | string[] | null;
}

const PREFIXES = new Set(['hotfix', 'bugfix', 'feature', 'release', 'users', 'user']);

/**
 * Destinos do fluxo ("development, qa"; "release-version/hotfix-version" = um ou outro) → lista. Barra só separa
 * quando nenhum pedaço é prefixo de branch (hotfix/77434 continua inteira).
 */
export function splitTargets(raw: string | string[] | null | undefined): string[] {
  const parts = (Array.isArray(raw) ? raw : `${raw ?? ''}`.split(/[,;\n]/)).map((x) => `${x ?? ''}`.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const pieces = p.split('/').map((x) => x.trim());
    if (pieces.length > 1 && pieces.every((x) => x && !PREFIXES.has(x.toLowerCase()))) out.push(...pieces);
    else out.push(p);
  }
  return dedupe(out);
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((x) => {
    const k = x.toLowerCase();
    if (!x || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function pushOnce(list: BranchOption[], o: BranchOption): void {
  if (o.name && !list.some((x) => x.name.toLowerCase() === o.name.toLowerCase())) list.push(o);
}

/** Sugestões do destino do PR: destinos do fluxo, destinos com regra de branch e as bases. */
export function targetSuggestions(ctx: BranchSuggestContext | null | undefined): BranchOption[] {
  const out: BranchOption[] = [];
  for (const t of splitTargets(ctx?.flowTargets)) pushOnce(out, { name: t, tag: 'fluxo', hint: 'destino do fluxo' });
  for (const t of Object.keys(ctx?.branchesByTarget ?? {})) pushOnce(out, { name: t, tag: 'regra', hint: 'destino com regra' });
  for (const b of BASE_BRANCHES) pushOnce(out, { name: b, tag: 'base' });
  return out;
}

/** Sugestões de branch de trabalho: a branch principal do card, a branch por destino (hotfix/77434-rv) e as bases. */
export function branchSuggestions(ctx: BranchSuggestContext | null | undefined): BranchOption[] {
  const out: BranchOption[] = [];
  const main = `${ctx?.mainBranch ?? ''}`.trim();
  if (main) pushOnce(out, { name: main, tag: 'card', hint: 'branch do card' });
  for (const [target, branch] of Object.entries(ctx?.branchesByTarget ?? {})) {
    if (`${branch ?? ''}`.trim()) pushOnce(out, { name: `${branch}`.trim(), tag: 'regra', hint: `→ ${target}` });
  }
  for (const b of BASE_BRANCHES) pushOnce(out, { name: b, tag: 'base' });
  return out;
}

/**
 * Lista do autocomplete: sugestões que batem com o texto (na ordem das regras) e depois as branches do GitHub que
 * ainda não apareceram (padrão primeiro). O texto vazio mostra tudo.
 */
export function mergeBranchOptions(suggested: BranchOption[], remote: GitHubBranch[] | null | undefined, query: string | null | undefined, limit = 60): BranchOption[] {
  const q = `${query ?? ''}`.trim().toLowerCase();
  const match = (name: string) => !q || name.toLowerCase().includes(q);
  const out: BranchOption[] = [];
  for (const s of suggested) if (match(s.name)) pushOnce(out, s);
  const sorted = [...(remote ?? [])].filter((b) => b?.name).sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault));
  for (const b of sorted) {
    if (!match(b.name)) continue;
    const hint = b.isDefault ? 'padrão' : b.protected ? 'protegida' : null;
    const existing = out.find((x) => x.name.toLowerCase() === b.name.toLowerCase());
    if (existing) { if (!existing.hint && hint) existing.hint = hint; continue; }
    out.push({ name: b.name, tag: 'github', hint });
  }
  return out.slice(0, limit);
}

/** Estado na lista: sugeridos primeiro (na ordem do servidor), depois os demais; o atual vem marcado. */
export interface StateOption {
  name: string;
  category?: string | null;
  suggested: boolean;
  current: boolean;
}

export function orderStates(cs: CardStates | null | undefined, query?: string | null): StateOption[] {
  const current = `${cs?.current ?? ''}`.trim().toLowerCase();
  const q = `${query ?? ''}`.trim().toLowerCase();
  const list = (cs?.states ?? [])
    .filter((s) => s?.name)
    .map((s) => ({ name: s.name, category: s.category ?? null, suggested: !!s.suggested, current: !!s.current || s.name.toLowerCase() === current }));
  const seen = new Set<string>();
  const unique = list.filter((s) => (seen.has(s.name.toLowerCase()) ? false : (seen.add(s.name.toLowerCase()), true)));
  const filtered = q ? unique.filter((s) => s.name.toLowerCase().includes(q)) : unique;
  return [...filtered.filter((s) => s.suggested && !s.current), ...filtered.filter((s) => !s.suggested || s.current)];
}

/** Erro de lista (branches/estados) → aviso discreto; sem integração (409/403) o campo segue como texto livre. */
export function pickerErrorHint(status: number | null | undefined, what: 'branches' | 'estados', fallback: string): { text: string; warn: boolean } {
  if (status === 409 || status === 403) {
    return { text: what === 'branches' ? 'Sem a integração do GitHub para listar — digite o nome da branch.' : 'Sem a integração do DevOps para listar — digite o nome do estado.', warn: false };
  }
  return { text: fallback, warn: true };
}

/** `commits`: "card" (ou vazio) = todos os do card; senão SHAs separados por vírgula/espaço. */
export function parseCommits(value: string | null | undefined): { all: boolean; shas: string[] } {
  const v = `${value ?? ''}`.trim();
  if (!v || v.toLowerCase() === ALL_CARD_COMMITS) return { all: true, shas: [] };
  return { all: false, shas: dedupe(v.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)) };
}

export function formatCommits(all: boolean, shas: string[]): string {
  return all ? ALL_CARD_COMMITS : dedupe(shas.map((x) => x.trim()).filter(Boolean)).join(',');
}

/** `https://github.com/<owner>` a partir da URL do catálogo ou do Owner da integração (sem barra no fim). */
export function githubBase(url?: string | null, owner?: string | null): string | null {
  const u = `${url ?? ''}`.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(u)) return u;
  const o = `${owner ?? ''}`.trim().replace(/^\/+|\/+$/g, '');
  return o ? `https://github.com/${o}` : null;
}

/** Link do valor do parâmetro no GitHub (repositório ou branch); sem base/repositório → null (mostra texto). */
export function paramLink(input: TaskParamInput, value: string | null | undefined, base: string | null | undefined, repository?: string | null): string | null {
  const v = `${value ?? ''}`.trim();
  const b = `${base ?? ''}`.trim();
  if (!v || !b) return null;
  if (input === 'repository') return `${b}/${encodeURIComponent(v)}`;
  const repo = `${repository ?? ''}`.trim();
  if (!repo) return null;
  // Destino com mais de um valor ("development, qa") não vira link.
  if ((input === 'branch' || input === 'target-branch') && !/[\s,;]/.test(v)) {
    return `${b}/${encodeURIComponent(repo)}/tree/${v.split('/').map(encodeURIComponent).join('/')}`;
  }
  return null;
}

/** Texto do valor para leitura (modal da sub-tarefa). */
export function paramDisplay(input: TaskParamInput, value: string | null | undefined, options?: ParamOption[]): string {
  const v = `${value ?? ''}`.trim();
  if (input === 'commits') {
    const c = parseCommits(v);
    return c.all ? 'Todos os commits do card' : c.shas.map((s) => s.slice(0, 7)).join(', ');
  }
  if (input === 'select') return options?.find((o) => o.value === v)?.label ?? v;
  return v;
}
