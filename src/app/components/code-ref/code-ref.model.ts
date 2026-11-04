/** Fotografia do código citado na análise/correção (0075 — B1). Em sincronia com o backend. */

export type CodeChange = 'change' | 'create' | 'remove' | 'suspect' | 'read';

/** Cabeça (lista do card, sem o código) — liga citações e pinta o link. */
export interface CodeRefHead {
  id: string;
  planId: string;
  ref: string;
  repository?: string | null;
  path: string;
  startLine: number;
  endLine: number;
  change: CodeChange | string;
  title?: string | null;
  commitSha?: string | null;
  hasProposal: boolean;
  hasImplemented: boolean;
  updatedAt: string;
}

export interface CodeRefAnnotation {
  side?: 'old' | 'new' | string | null;
  from: number;
  to?: number | null;
  text?: string | null;
}

/** Ref completa (o popover). */
export interface CodeRef extends CodeRefHead {
  cardNumber: string;
  branch?: string | null;
  language?: string | null;
  why?: string | null;
  snapshot?: string | null;
  firstLine: number;
  proposal?: string | null;
  implemented?: string | null;
  implementedSha?: string | null;
  annotations: CodeRefAnnotation[];
  createdBy?: string | null;
}

/** O que o link aponta: uma ref (`#ref/<id>`) ou uma citação `caminho:ini-fim` (`#cite/...`). */
export type CodeRefTarget =
  | { kind: 'ref'; id: string }
  | { kind: 'cite'; path: string; start: number; end: number };

export interface ChangeMeta { icon: string; label: string; }

export const CHANGE_META: Record<string, ChangeMeta> = {
  change: { icon: '✏️', label: 'Alterar' },
  create: { icon: '➕', label: 'Criar' },
  remove: { icon: '🗑️', label: 'Remover' },
  suspect: { icon: '⚠️', label: 'Suspeito' },
  read: { icon: '👁️', label: 'Leitura' },
};

export const changeMeta = (change: string | null | undefined): ChangeMeta =>
  CHANGE_META[change ?? ''] ?? CHANGE_META['read'];

export const CODE_CHANGES: CodeChange[] = ['change', 'create', 'remove', 'suspect', 'read'];

/** `L239–289` / `L325`. */
export function linesLabel(start: number, end: number): string {
  return end > start ? `${start}–${end}` : `${start}`;
}

/** `caminho:239-289` (o que se cola numa conversa/no editor). */
export function citationText(path: string, start: number, end: number): string {
  return end > start ? `${path}:${start}-${end}` : `${path}:${start}`;
}

/** `#ref/<id>` → ref; `#cite/<caminho codificado>:<ini>-<fim>` → citação; outro → null. */
export function parseCodeHref(href: string | null | undefined): CodeRefTarget | null {
  const h = (href ?? '').trim();
  if (h.startsWith('#ref/')) {
    const id = safeDecode(h.slice(5)).trim().toLowerCase();
    return id ? { kind: 'ref', id } : null;
  }
  if (h.startsWith('#cite/')) {
    const body = h.slice(6);
    const m = /^(.*):(\d+)(?:-(\d+))?$/.exec(body);
    if (!m) return null;
    const path = safeDecode(m[1]);
    const a = Number(m[2]);
    const b = m[3] !== undefined ? Number(m[3]) : a;
    if (!path || !a || !b) return null;
    return { kind: 'cite', path, start: Math.min(a, b), end: Math.max(a, b) };
  }
  return null;
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/**
 * A citação aponta para a ref? Mesma regra do back (`ExecutionCodeRef.Matches`): o caminho citado é o
 * caminho da ref, ou o fim dele (`.../<citado>`), ou `repositório/caminho` — sem diferenciar
 * maiúsculas —, e as linhas se sobrepõem.
 */
export function citationMatches(head: Pick<CodeRefHead, 'path' | 'repository' | 'startLine' | 'endLine'>,
                                citedPath: string, start: number, end: number): boolean {
  const cited = citedPath.trim().replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  if (!cited) return false;
  const path = (head.path ?? '').toLowerCase();
  const samePath = path === cited
    || path.endsWith('/' + cited)
    || (!!head.repository && `${head.repository}/${head.path}`.toLowerCase() === cited);
  return samePath && start <= head.endLine && end >= head.startLine;
}

/**
 * Melhor ref para a citação: entre as que casam, a de maior sobreposição relativa (interseção ÷ união
 * das faixas — premia o foco mais próximo e menor); empate → faixa menor → caminho igual ao citado.
 */
export function matchCitation<T extends Pick<CodeRefHead, 'path' | 'repository' | 'startLine' | 'endLine'>>(
  heads: readonly T[] | null | undefined, citedPath: string, start: number, end: number): T | null {
  let best: T | null = null;
  let bestScore = -1;
  let bestSpan = Infinity;
  let bestExact = false;
  const cited = citedPath.trim().replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  for (const h of heads ?? []) {
    if (!citationMatches(h, citedPath, start, end)) continue;
    const inter = Math.min(end, h.endLine) - Math.max(start, h.startLine) + 1;
    const union = Math.max(end, h.endLine) - Math.min(start, h.startLine) + 1;
    const score = inter / union;
    const span = h.endLine - h.startLine;
    const exact = h.path.toLowerCase() === cited;
    const better = score > bestScore + 1e-9
      || (Math.abs(score - bestScore) <= 1e-9 && (span < bestSpan || (span === bestSpan && exact && !bestExact)));
    if (better) { best = h; bestScore = score; bestSpan = span; bestExact = exact; }
  }
  return best;
}

/** Marcador numerado da anotação: ①…⑳, depois (21). */
export function noteMarker(index: number): string {
  return index < 20 ? String.fromCharCode(0x2460 + index) : `(${index + 1})`;
}
