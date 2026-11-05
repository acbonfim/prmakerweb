/**
 * Configurações por seção (0086) — regras puras da tela (sem Angular): formato gravado dos editores simples,
 * montagem do PATCH, busca e diff por linhas da revisão. Testadas em `plugin-settings.logic.spec.ts`.
 */
import { SettingChange, SettingField } from './plugin-settings.model';

// ── Formato gravado ───────────────────────────────────────────────────────────────────────────

/** Lê uma lista gravada: `csv` (a,b,c) ou `json` (["a","b"]). JSON inválido → erro (o texto cru não é perdido). */
export function parseList(value: string | null | undefined, format: 'csv' | 'json' | null | undefined): { items: string[]; error: string | null } {
  const text = (value ?? '').trim();
  if (!text) return { items: [], error: null };
  if (format === 'json') {
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return { items: [], error: 'O valor gravado não é uma lista JSON.' };
      return { items: parsed.map(x => (typeof x === 'string' ? x : JSON.stringify(x))), error: null };
    } catch {
      return { items: [], error: 'O valor gravado não é um JSON válido.' };
    }
  }
  return { items: text.split(',').map(s => s.trim()).filter(Boolean), error: null };
}

/** Grava uma lista no formato que o leitor espera: `csv` unido por vírgula sem espaço; `json` array compacto. */
export function formatList(items: string[], format: 'csv' | 'json' | null | undefined): string {
  const clean = items.map(s => s.trim()).filter(Boolean);
  return format === 'json' ? JSON.stringify(clean) : clean.join(',');
}

/** "true"/"True"/"1" → true; o resto → false. */
export function parseBool(value: string | null | undefined): boolean {
  const t = (value ?? '').trim().toLowerCase();
  return t === 'true' || t === '1' || t === 'sim' || t === 'yes';
}

export function formatBool(on: boolean): string {
  return on ? 'true' : 'false';
}

/**
 * Número digitado → texto invariante (`0,9` → `0.9`) e erro de faixa. Vazio é erro (o leitor cai no padrão, mas a
 * tela não grava número vazio).
 */
export function normalizeNumber(text: string | null | undefined, min?: number | null, max?: number | null): { value: string; error: string | null } {
  const raw = (text ?? '').trim().replace(',', '.');
  if (!raw) return { value: '', error: 'Informe um número.' };
  if (!/^-?\d+(\.\d+)?$/.test(raw) && !/^-?\.\d+$/.test(raw)) return { value: raw, error: 'Número inválido.' };
  const n = Number(raw);
  const value = String(n);
  if (min != null && n < min) return { value, error: `Mínimo ${min}.` };
  if (max != null && n > max) return { value, error: `Máximo ${max}.` };
  return { value, error: null };
}

/** Compara dois valores gravados: textos iguais ou JSON equivalente (ignorando espaços/identação). */
export function sameValue(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = a ?? '';
  const y = b ?? '';
  if (x === y) return true;
  const nx = normalizeJson(x);
  const ny = normalizeJson(y);
  return nx !== null && nx === ny;
}

function normalizeJson(text: string): string | null {
  const t = text.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return null;
  try {
    return JSON.stringify(JSON.parse(t));
  } catch {
    return null;
  }
}

/** JSON identado (2 espaços) para leitura/diff; texto que não é JSON volta como está. */
export function prettyJson(text: string | null | undefined): string {
  const t = (text ?? '').trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return text ?? '';
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return text ?? '';
  }
}

/** Tipos cujo valor é JSON (o diff da revisão compara a versão identada). */
export const JSON_TYPES = new Set(['json', 'table', 'map']);

// ── Edição ────────────────────────────────────────────────────────────────────────────────────

/** Alteração pendente de um campo (por `field.id`). */
export interface PendingChange {
  value: string;
  /** Apagar a chave (obsoletas e fora do catálogo). */
  remove?: boolean;
  /** Gravar mesmo igual ao mostrado (chave inexistente "usando o padrão" → "gravar"). */
  create?: boolean;
}

/**
 * Valor que o editor mostra sem edição: segredo → '' (vazio = não muda); chave inexistente → o padrão (é o que o
 * código usa); senão o valor gravado.
 */
export function baselineOf(field: SettingField): string {
  if (field.type === 'secret') return '';
  if (!field.exists) return field.default ?? '';
  return field.value ?? '';
}

/** Valor em edição (pendente ou o de base). */
export function currentValue(field: SettingField, pending: PendingChange | undefined): string {
  return pending && !pending.remove ? pending.value : baselineOf(field);
}

/** Monta as alterações do PATCH: só os campos com pendência; `expected` = valor que a tela leu (null = não existia). */
export function buildChanges(fields: SettingField[], pending: Record<string, PendingChange>): SettingChange[] {
  const out: SettingChange[] = [];
  const seen = new Set<string>();
  for (const f of fields) {
    const p = pending[f.id];
    if (!p || f.pluginId == null || seen.has(f.id)) continue;
    seen.add(f.id);
    out.push({
      pluginId: f.pluginId,
      key: f.key,
      value: p.remove ? null : p.value,
      expected: f.exists ? f.value ?? null : null,
      remove: !!p.remove,
    });
  }
  return out;
}

// ── Busca ─────────────────────────────────────────────────────────────────────────────────────

/** Minúsculas e sem acento (busca "configuracao" acha "Configuração"). */
export function foldText(text: string | null | undefined): string {
  return (text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** A busca casa com rótulo, chave, plugin, ajuda ou valor (em edição; segredo nunca pelo valor). */
export function matchesSearch(field: SettingField, value: string, query: string): boolean {
  const q = foldText(query.trim());
  if (!q) return true;
  const hay = [field.label, field.key, field.pluginName, field.help ?? '', field.type === 'secret' ? '' : value];
  return hay.some(h => foldText(h).includes(q));
}

// ── Etapas ────────────────────────────────────────────────────────────────────────────────────

export interface StepOption {
  key: string;
  title: string;
}

/** Etapas de uma lista de etapas gravada (`[{key,title,…}]`); JSON inválido → nenhuma. */
export function stepsFrom(value: string | null | undefined): StepOption[] {
  try {
    const parsed = JSON.parse(value ?? '');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(s => s && typeof s.key === 'string' && s.key)
      .map(s => ({ key: s.key as string, title: typeof s.title === 'string' ? s.title : s.key }));
  } catch {
    return [];
  }
}

/** A etapa citada existe (aceita "prefixo-*", que casa com qualquer etapa que comece pelo prefixo). */
export function stepKnown(step: string, options: StepOption[]): boolean {
  if (step.endsWith('*')) {
    const prefix = step.slice(0, -1);
    return options.some(o => o.key.startsWith(prefix));
  }
  return options.some(o => o.key === step);
}

// ── Diff por linhas (revisão antes → depois) ──────────────────────────────────────────────────

export type LineDiffType = 'same' | 'add' | 'del' | 'skip';

export interface LineDiff {
  type: LineDiffType;
  text: string;
}

/** Acima disso (linhas × linhas) não roda o LCS: mostra tudo removido e tudo incluído. */
const MAX_CELLS = 4_000_000;

/** Diff simples por linhas (LCS). */
export function lineDiff(before: string | null | undefined, after: string | null | undefined): LineDiff[] {
  const a = (before ?? '').replace(/\r\n/g, '\n').split('\n');
  const b = (after ?? '').replace(/\r\n/g, '\n').split('\n');
  if (before == null || before === '') a.length = 0;
  if (after == null || after === '') b.length = 0;

  // Prefixo e sufixo iguais saem do LCS (caso comum: uma linha mudou num texto longo).
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const head: LineDiff[] = a.slice(0, start).map(text => ({ type: 'same', text }));
  const tail: LineDiff[] = a.slice(endA).map(text => ({ type: 'same', text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  let mid: LineDiff[];
  if (midA.length * midB.length > MAX_CELLS) {
    mid = [...midA.map(text => ({ type: 'del' as const, text })), ...midB.map(text => ({ type: 'add' as const, text }))];
  } else {
    mid = lcsDiff(midA, midB);
  }
  return [...head, ...mid, ...tail];
}

function lcsDiff(a: string[], b: string[]): LineDiff[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS de a[i..] e b[j..]
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: LineDiff[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: 'same', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: a[i] }); i++; }
    else { out.push({ type: 'add', text: b[j] }); j++; }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] });
  while (j < m) out.push({ type: 'add', text: b[j++] });
  return out;
}

/** Recolhe trechos iguais longos, deixando `context` linhas em volta de cada mudança (`skip` = "n linhas iguais"). */
export function collapseDiff(lines: LineDiff[], context = 3): LineDiff[] {
  const keep = lines.map(() => false);
  lines.forEach((l, i) => {
    if (l.type === 'same') return;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
  });
  const out: LineDiff[] = [];
  let skipped = 0;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (skipped) out.push({ type: 'skip', text: `${skipped} linha(s) igual(is)` });
      skipped = 0;
      out.push(l);
    } else {
      skipped++;
    }
  });
  if (skipped) out.push({ type: 'skip', text: `${skipped} linha(s) igual(is)` });
  return out;
}

/** Valor curto o bastante para mostrar "antes → depois" numa linha (sem diff). */
export function isShortValue(value: string | null | undefined): boolean {
  const t = value ?? '';
  return t.length <= 80 && !t.includes('\n');
}
