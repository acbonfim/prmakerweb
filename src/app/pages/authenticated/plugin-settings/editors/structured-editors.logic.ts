import { SettingColumn, SettingField, SettingVariable } from '../plugin-settings.model';

/**
 * Funções puras dos editores estruturados (0086/FB): leitura/gravação de `table`, `map` e `json`, normalização de
 * literal JS, variáveis de `pattern`/`prompt` e diferença por linhas. Os editores só montam a tela em cima disto.
 * Regra de ouro: o valor gravado continua no mesmo formato; propriedades que a tela não conhece são preservadas e,
 * se nada mudou de fato, o texto original volta intacto (sem reformatar).
 */

// ── JSON ──────────────────────────────────────────────────────────────────────────────────────────

export interface JsonParseResult {
  ok: boolean;
  value?: unknown;
  /** Mensagem pronta para a tela (com linha/coluna quando possível). */
  error?: string;
  line?: number;
  column?: number;
}

/** `JSON.parse` com a posição do erro traduzida em linha/coluna. */
export function parseJson(text: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e: unknown) {
    const raw = e instanceof Error ? e.message : String(e);
    let line: number | undefined;
    let column: number | undefined;
    const lc = /line (\d+) column (\d+)/i.exec(raw);
    const pos = /position (\d+)/i.exec(raw);
    if (lc) {
      line = +lc[1];
      column = +lc[2];
    } else {
      // Algumas mensagens do navegador não trazem a posição ("Unexpected token '}', …") → localiza aqui.
      const at = pos ? +pos[1] : locateJsonError(text);
      if (at >= 0) ({ line, column } = lineColumnAt(text, at));
    }
    const where = line ? `linha ${line}, coluna ${column}: ` : '';
    return { ok: false, error: `JSON inválido — ${where}${describeJsonError(raw)}`, line, column };
  }
}

/** Mensagem do `JSON.parse` em português (as mais comuns); o resto vai como veio, sem o trecho repetido do texto. */
function describeJsonError(raw: string): string {
  const msg = raw.replace(/\s*in JSON at position \d+.*$/i, '').replace(/^JSON\.parse:\s*/i, '');
  let m: RegExpExecArray | null;
  if ((m = /^Unexpected token '?(.+?)'?,\s/.exec(msg)) || (m = /^Unexpected token '?(.)'?$/.exec(msg)))
    return `caractere inesperado "${m[1]}"`;
  if (/^Expected property name or '}'/i.test(msg) || /^Expected double-quoted property name/i.test(msg))
    return 'esperava o nome de uma propriedade entre aspas duplas (vírgula sobrando ou chave sem aspas?)';
  if ((m = /^Expected ',' or '(.)' after/i.exec(msg))) return `falta "," ou "${m[1]}"`;
  if (/^Expected ':' after property name/i.test(msg)) return 'falta ":" depois do nome da propriedade';
  if (/^Unterminated string/i.test(msg)) return 'texto sem as aspas de fechamento';
  if (/^Unexpected end of JSON input/i.test(msg)) return 'o texto acabou antes de fechar tudo';
  if (/^Bad control character/i.test(msg)) return 'quebra de linha ou tabulação dentro de um texto (use \\n)';
  if (/^Unexpected non-whitespace character after JSON/i.test(msg)) return 'há conteúdo depois do fim do JSON';
  if (/^Bad escaped character/i.test(msg)) return 'escape inválido dentro de um texto';
  return msg;
}

/** Posição (índice) do primeiro erro de sintaxe JSON, ou -1. Só localiza — quem valida é o `JSON.parse`. */
export function locateJsonError(text: string): number {
  let i = 0;
  const n = text.length;
  const num = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const ws = () => { while (i < n && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++; };
  const fail = (): never => { throw i; };
  const str = (): void => {
    i++;
    while (i < n) {
      const c = text[i];
      if (c === '"') { i++; return; }
      if (c === '\\') { i += 2; continue; }
      if (c < ' ') fail();
      i++;
    }
    fail();
  };
  const value = (): void => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++; ws();
      if (text[i] === '}') { i++; return; }
      for (;;) {
        ws();
        if (text[i] !== '"') fail();
        str(); ws();
        if (text[i] !== ':') fail();
        i++; value(); ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return; }
        fail();
      }
    }
    if (c === '[') {
      i++; ws();
      if (text[i] === ']') { i++; return; }
      for (;;) {
        value(); ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return; }
        fail();
      }
    }
    if (c === '"') return str();
    num.lastIndex = i;
    const m = num.exec(text);
    if (m && m[0]) { i += m[0].length; return; }
    for (const w of ['true', 'false', 'null']) if (text.startsWith(w, i)) { i += w.length; return; }
    fail();
  };
  try {
    value(); ws();
    if (i < n) fail();
    return -1;
  } catch (p) {
    return typeof p === 'number' ? p : -1;
  }
}

/** Linha/coluna (base 1) de uma posição do texto. */
export function lineColumnAt(text: string, position: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, Math.min(position, text.length)));
  const lines = before.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/** Indentação a usar ao gravar: o texto original em várias linhas → 2 espaços; numa linha só → compacto. */
export function indentOf(original: string | null | undefined): number {
  return original && original.includes('\n') ? 2 : 0;
}

export function stringifyJson(value: unknown, indent: number): string {
  return indent ? JSON.stringify(value, null, indent) : JSON.stringify(value);
}

/** Mesma estrutura (ordem das chaves conta — trocar a ordem das linhas é uma mudança real). */
export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Lê o texto como JSON estrito ou, se não der, como literal JS normalizado. */
export function parseLenient(text: string): { ok: boolean; value?: unknown; normalized: boolean; error?: string } {
  const strict = parseJson(text);
  if (strict.ok) return { ok: true, value: strict.value, normalized: false };
  const normalized = normalizeJsLiteral(text);
  if (normalized !== null) return { ok: true, value: JSON.parse(normalized), normalized: true };
  return { ok: false, normalized: false, error: strict.error };
}

/**
 * Converte um literal JS simples (o que o front antigo lia com `eval`, ex.: `ActiveBranchs`) em JSON estrito:
 * aspas simples → duplas, chaves sem aspas → com aspas, vírgula final removida, comentários removidos.
 * Devolve o JSON (mantendo a disposição das linhas) ou null se mesmo assim não for JSON válido.
 */
export function normalizeJsLiteral(text: string): string | null {
  if (!text || !text.trim()) return null;
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    // Comentários.
    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    // Textos entre aspas (simples, duplas ou crase) → aspas duplas.
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      let s = '';
      i++;
      while (i < n && text[i] !== quote) {
        if (text[i] === '\\' && i + 1 < n) {
          const next = text[i + 1];
          // \' não existe em JSON; o resto do escape segue igual.
          s += next === "'" ? "'" : next === '`' ? '`' : '\\' + next;
          i += 2;
          continue;
        }
        if (text[i] === '"') s += '\\"';
        else if (text[i] === '\n') s += '\\n';
        else if (text[i] === '\r') s += '\\r';
        else if (text[i] === '\t') s += '\\t';
        else s += text[i];
        i++;
      }
      if (i >= n) return null; // aspas sem fechar
      i++;
      out += `"${s}"`;
      continue;
    }
    // Identificador: chave sem aspas (seguida de ":") ou palavra-chave.
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[\w$]/.test(text[j])) j++;
      const word = text.slice(i, j);
      if (text[skipBlank(text, j)] === ':') out += `"${word}"`;
      else if (word === 'undefined') out += 'null';
      else out += word;
      i = j;
      continue;
    }
    // Vírgula final antes de } ou ].
    if (c === ',') {
      const k = skipBlank(text, i + 1);
      if (text[k] === '}' || text[k] === ']') {
        i++;
        continue;
      }
    }
    out += c;
    i++;
  }
  // Um ";" no fim (literal copiado de código) não faz parte do valor.
  out = out.replace(/;\s*$/, '');
  try {
    JSON.parse(out);
    return out;
  } catch {
    return null;
  }
}

/** Pula espaços e comentários (`//`, `/* *\/`) a partir de `k`. */
function skipBlank(text: string, k: number): number {
  const n = text.length;
  for (;;) {
    while (k < n && /\s/.test(text[k])) k++;
    if (text[k] === '/' && text[k + 1] === '/') {
      while (k < n && text[k] !== '\n') k++;
    } else if (text[k] === '/' && text[k + 1] === '*') {
      const end = text.indexOf('*/', k + 2);
      k = end < 0 ? n : end + 2;
    } else return k;
  }
}

// ── Tabela ────────────────────────────────────────────────────────────────────────────────────────

/** Uma linha da tabela em edição: o objeto gravado (com as propriedades extras) + o texto de cada célula. */
export interface TableRow {
  uid: number;
  data: Record<string, unknown>;
  /** Texto exibido em cada coluna (o que o usuário digitou, mesmo se ainda inválido). */
  text: Record<string, string>;
  /** Linha aberta (colunas de texto longo visíveis). */
  open: boolean;
}

export interface TableParseResult {
  ok: boolean;
  rows: TableRow[];
  /** O valor gravado era literal JS (não JSON estrito). */
  normalized: boolean;
  error?: string;
}

let rowSeq = 0;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function makeRow(data: Record<string, unknown>, columns: SettingColumn[]): TableRow {
  const text: Record<string, string> = {};
  for (const col of columns) text[col.key] = cellText(data[col.key], col);
  return { uid: ++rowSeq, data, text, open: false };
}

/** Texto de uma célula para a tela. */
export function cellText(v: unknown, col: SettingColumn): string {
  if (v === undefined || v === null) return '';
  if (col.type === 'list') return Array.isArray(v) ? v.map(x => `${x}`).join(', ') : `${v}`;
  if (col.type === 'bool') return v === true || `${v}`.toLowerCase() === 'true' ? 'true' : 'false';
  if (typeof v === 'object') return JSON.stringify(v);
  return `${v}`;
}

/** Valor gravado vazio = tabela vazia. Objeto quando `rowKey`, senão array de objetos. */
export function parseTable(value: string | null | undefined, field: SettingField): TableParseResult {
  const columns = field.columns ?? [];
  if (!value || !value.trim()) return { ok: true, rows: [], normalized: false };
  const parsed = parseLenient(value);
  if (!parsed.ok) return { ok: false, rows: [], normalized: false, error: parsed.error };
  const root = parsed.value;
  if (field.rowKey) {
    if (!isPlainObject(root)) return fail('O valor deve ser um objeto JSON ({ "chave": { … } }).');
    const rows: TableRow[] = [];
    for (const [key, inner] of Object.entries(root)) {
      if (!isPlainObject(inner)) return fail(`O item "${key}" não é um objeto.`);
      rows.push(makeRow({ [field.rowKey]: key, ...inner }, columns));
    }
    return { ok: true, rows, normalized: parsed.normalized };
  }
  if (!Array.isArray(root)) return fail('O valor deve ser uma lista JSON ([ { … } ]).');
  const rows: TableRow[] = [];
  for (let i = 0; i < root.length; i++) {
    if (!isPlainObject(root[i])) return fail(`A linha ${i + 1} não é um objeto.`);
    rows.push(makeRow({ ...(root[i] as Record<string, unknown>) }, columns));
  }
  return { ok: true, rows, normalized: parsed.normalized };

  function fail(error: string): TableParseResult {
    return { ok: false, rows: [], normalized: parsed.normalized, error };
  }
}

/**
 * Atualiza uma célula: guarda o texto digitado e converte para o tipo da coluna. Vazio numa coluna opcional remove a
 * propriedade (se ela não existia) ou grava vazio (se já existia) — o formato que os leitores já conhecem.
 */
export function setCell(row: TableRow, col: SettingColumn, text: string): void {
  row.text[col.key] = text;
  const had = Object.prototype.hasOwnProperty.call(row.data, col.key);
  const previous = row.data[col.key];
  const empty = text.trim() === '';
  if (empty && col.type !== 'bool') {
    if (!col.required && !had) return;
    if (!col.required && col.type !== 'text' && col.type !== 'textarea' && col.type !== 'enum') {
      delete row.data[col.key];
      return;
    }
    row.data[col.key] = Array.isArray(previous) ? [] : '';
    return;
  }
  switch (col.type) {
    case 'number': {
      const num = Number(text.trim().replace(',', '.'));
      // Inválido fica como texto (a validação aponta); válido mantém o tipo original (número, ou texto se era texto).
      row.data[col.key] = Number.isFinite(num) ? (typeof previous === 'string' ? `${num}` : num) : text;
      break;
    }
    case 'bool': {
      const b = text === 'true';
      row.data[col.key] = typeof previous === 'string' ? `${b}` : b;
      break;
    }
    case 'list': {
      const items = text.split(',').map(s => s.trim()).filter(Boolean);
      row.data[col.key] = typeof previous === 'string' ? items.join(',') : items;
      break;
    }
    default:
      row.data[col.key] = text;
  }
}

/** Objeto/array a gravar a partir das linhas. */
export function tableData(rows: TableRow[], field: SettingField): unknown {
  if (field.rowKey) {
    const out: Record<string, unknown> = {};
    for (const r of rows) {
      const { [field.rowKey]: key, ...inner } = r.data;
      out[`${key ?? ''}`] = inner;
    }
    return out;
  }
  return rows.map(r => r.data);
}

/** Texto gravado: o original intacto se a estrutura não mudou; senão JSON na indentação do original. */
export function serializeTable(rows: TableRow[], field: SettingField, original: string | null | undefined): string {
  return serializeKeepingOriginal(tableData(rows, field), original);
}

function serializeKeepingOriginal(data: unknown, original: string | null | undefined): string {
  if (original && original.trim()) {
    const before = parseLenient(original);
    if (before.ok && sameJson(before.value, data)) return original;
  }
  return stringifyJson(data, indentOf(original));
}

export interface RowError {
  /** Índice (base 0) da linha. */
  row: number;
  /** Coluna com problema (para destacar a célula). */
  column: string;
  message: string;
}

/** Erros da tabela: obrigatório vazio, número inválido, chave (`rowKey`) vazia ou repetida — um por linha. */
export function tableErrors(rows: TableRow[], field: SettingField): RowError[] {
  const columns = field.columns ?? [];
  const errors: RowError[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let error: RowError | null = null;
    for (const col of columns) {
      const t = (r.text[col.key] ?? '').trim();
      if ((col.required || col.key === field.rowKey) && !t && col.type !== 'bool') {
        error = { row: i, column: col.key, message: `Linha ${i + 1}: preencha "${col.label}".` };
        break;
      }
      if (col.type === 'number' && t && !Number.isFinite(Number(t.replace(',', '.')))) {
        error = { row: i, column: col.key, message: `Linha ${i + 1}: "${col.label}" deve ser um número.` };
        break;
      }
    }
    if (!error && field.rowKey) {
      const key = (r.text[field.rowKey] ?? `${r.data[field.rowKey] ?? ''}`).trim();
      if (seen.has(key)) error = { row: i, column: field.rowKey, message: `Linha ${i + 1}: a chave "${key}" está repetida.` };
      seen.add(key);
    }
    if (error) errors.push(error);
  }
  return errors;
}

/** Primeiro erro da tabela ou null. */
export function validateTable(rows: TableRow[], field: SettingField): string | null {
  return tableErrors(rows, field)[0]?.message ?? null;
}

/** Propriedades da linha que não são colunas (preservadas, mostradas só como aviso). */
export function extraProps(row: TableRow, field: SettingField): string[] {
  const known = new Set((field.columns ?? []).map(c => c.key));
  if (field.rowKey) known.add(field.rowKey);
  return Object.keys(row.data).filter(k => !known.has(k));
}

/** Cópia de uma linha (com as propriedades extras); com `rowKey`, a chave ganha um sufixo para não repetir. */
export function duplicateRow(row: TableRow, rows: TableRow[], field: SettingField): TableRow {
  const data = JSON.parse(JSON.stringify(row.data)) as Record<string, unknown>;
  if (field.rowKey) {
    const base = `${data[field.rowKey] ?? ''}`;
    let candidate = `${base}-copia`;
    let n = 2;
    while (rows.some(r => `${r.data[field.rowKey!] ?? ''}` === candidate)) candidate = `${base}-copia${n++}`;
    data[field.rowKey] = candidate;
  }
  return makeRow(data, field.columns ?? []);
}

/** Linha nova: só as colunas obrigatórias (vazias) e a primeira opção dos enums obrigatórios. */
export function newRow(field: SettingField): TableRow {
  const data: Record<string, unknown> = {};
  for (const col of field.columns ?? []) {
    if (col.type === 'enum' && col.required && col.options?.length) data[col.key] = col.options[0].value;
    else if (col.required || col.key === field.rowKey) data[col.key] = col.type === 'bool' ? false : '';
  }
  return makeRow(data, field.columns ?? []);
}

/** Move um item da lista (setas e arrastar). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const copy = [...list];
  if (from < 0 || from >= copy.length || to < 0 || to >= copy.length || from === to) return copy;
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

// ── Mapa ──────────────────────────────────────────────────────────────────────────────────────────

export interface MapEntry {
  uid: number;
  key: string;
  /** Texto exibido (lista: itens separados por vírgula). */
  text: string;
  open: boolean;
}

export interface MapParseResult {
  ok: boolean;
  entries: MapEntry[];
  error?: string;
}

/** Objeto JSON chave → valor (texto, ou lista de textos quando `mapValueType: list`). */
export function parseMap(value: string | null | undefined, field: SettingField): MapParseResult {
  if (!value || !value.trim()) return { ok: true, entries: [] };
  const parsed = parseLenient(value);
  if (!parsed.ok) return { ok: false, entries: [], error: parsed.error };
  if (!isPlainObject(parsed.value)) return { ok: false, entries: [], error: 'O valor deve ser um objeto JSON ({ "chave": … }).' };
  const asList = field.mapValueType === 'list';
  const entries: MapEntry[] = [];
  for (const [key, v] of Object.entries(parsed.value)) {
    if (asList) {
      if (!Array.isArray(v) || v.some(x => typeof x === 'object' && x !== null))
        return { ok: false, entries: [], error: `O valor de "${key}" não é uma lista de textos.` };
      entries.push({ uid: ++rowSeq, key, text: v.map(x => `${x}`).join(', '), open: false });
    } else {
      if (typeof v === 'object' && v !== null)
        return { ok: false, entries: [], error: `O valor de "${key}" não é texto.` };
      entries.push({ uid: ++rowSeq, key, text: v === null ? '' : `${v}`, open: false });
    }
  }
  return { ok: true, entries };
}

export function newMapEntry(): MapEntry {
  return { uid: ++rowSeq, key: '', text: '', open: true };
}

export function splitList(text: string): string[] {
  return text.split(',').map(s => s.trim()).filter(Boolean);
}

export function mapData(entries: MapEntry[], field: SettingField): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const e of entries) out[e.key.trim()] = field.mapValueType === 'list' ? splitList(e.text) : e.text;
  return out;
}

export function serializeMap(entries: MapEntry[], field: SettingField, original: string | null | undefined): string {
  return serializeKeepingOriginal(mapData(entries, field), original);
}

/** Chave vazia ou repetida = erro. */
export function validateMap(entries: MapEntry[], field: SettingField): string | null {
  const keyLabel = field.mapKeyLabel || 'Chave';
  const seen = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    const k = entries[i].key.trim();
    if (!k) return `Linha ${i + 1}: preencha "${keyLabel}".`;
    if (seen.has(k)) return `Linha ${i + 1}: "${k}" está repetida.`;
    seen.add(k);
  }
  return null;
}

// ── Variáveis (pattern/prompt) ────────────────────────────────────────────────────────────────────

export interface VariableUse {
  /** Nome (antes do ":" em `{suffix:x}`). */
  name: string;
  /** Texto completo, com as chaves. */
  token: string;
  start: number;
  end: number;
}

const VARIABLE_RE = /\{([A-Za-z_][\w.-]*)(?::([^{}\n]*))?\}/g;

/** Variáveis `{nome}` / `{nome:arg}` usadas no texto. `{{` e JSON (`{"a": 1}`) não contam. */
export function findVariables(text: string): VariableUse[] {
  const out: VariableUse[] = [];
  if (!text) return out;
  for (const m of text.matchAll(VARIABLE_RE)) {
    const start = m.index ?? 0;
    if (text[start - 1] === '{') continue;
    out.push({ name: m[1], token: m[0], start, end: start + m[0].length });
  }
  return out;
}

/** Nomes usados que não estão na lista do campo (sem lista declarada não há como saber → nada). */
export function unknownVariables(text: string, variables: SettingVariable[] | null | undefined): string[] {
  if (!variables?.length) return [];
  const known = new Set(variables.map(v => v.name.toLowerCase()));
  const unknown: string[] = [];
  for (const use of findVariables(text)) {
    if (!known.has(use.name.toLowerCase()) && !unknown.includes(use.token)) unknown.push(use.token);
  }
  return unknown;
}

export interface PreviewPart {
  text: string;
  /** Nome da variável substituída (para destacar na prévia). */
  variable?: string;
}

/** Texto com o `example` de cada variável conhecida no lugar de `{nome}` (desconhecidas ficam como estão). */
export function renderPreview(text: string, variables: SettingVariable[] | null | undefined): PreviewPart[] {
  const byName = new Map((variables ?? []).map(v => [v.name.toLowerCase(), v]));
  const parts: PreviewPart[] = [];
  let last = 0;
  for (const use of findVariables(text)) {
    const v = byName.get(use.name.toLowerCase());
    if (!v || v.example === null || v.example === undefined) continue;
    if (use.start > last) parts.push({ text: text.slice(last, use.start) });
    parts.push({ text: v.example, variable: v.name });
    last = use.end;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** Insere `snippet` no lugar da seleção; devolve o texto novo e a posição do cursor depois do trecho. */
export function insertAt(text: string, start: number, end: number, snippet: string): { text: string; caret: number } {
  const s = Math.max(0, Math.min(start, text.length));
  const e = Math.max(s, Math.min(end, text.length));
  return { text: text.slice(0, s) + snippet + text.slice(e), caret: s + snippet.length };
}

// ── Diferença por linhas ──────────────────────────────────────────────────────────────────────────

export interface DiffLine {
  type: 'same' | 'add' | 'del' | 'skip';
  text: string;
  oldLine?: number;
  newLine?: number;
}

/** Diferença por linhas (LCS) de `before` → `after`. Textos enormes caem numa comparação linha a linha simples. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  // Prefixo/sufixo iguais saem da tabela do LCS (o caso comum: poucas linhas mudadas).
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const am = a.slice(pre, a.length - suf);
  const bm = b.slice(pre, b.length - suf);

  const out: DiffLine[] = [];
  for (let i = 0; i < pre; i++) out.push({ type: 'same', text: a[i], oldLine: i + 1, newLine: i + 1 });

  const middle: DiffLine[] = [];
  if (am.length * bm.length > 4_000_000) {
    am.forEach((t, i) => middle.push({ type: 'del', text: t, oldLine: pre + i + 1 }));
    bm.forEach((t, j) => middle.push({ type: 'add', text: t, newLine: pre + j + 1 }));
  } else {
    const m = am.length;
    const n = bm.length;
    const lcs: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
    for (let i = m - 1; i >= 0; i--)
      for (let j = n - 1; j >= 0; j--)
        lcs[i][j] = am[i] === bm[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < m || j < n) {
      if (i < m && j < n && am[i] === bm[j]) {
        middle.push({ type: 'same', text: am[i], oldLine: pre + i + 1, newLine: pre + j + 1 });
        i++;
        j++;
      } else if (i < m && (j >= n || lcs[i + 1][j] >= lcs[i][j + 1])) {
        // Empate: a remoção vem antes da adição (lê-se "trocou X por Y").
        middle.push({ type: 'del', text: am[i], oldLine: pre + i + 1 });
        i++;
      } else {
        middle.push({ type: 'add', text: bm[j], newLine: pre + j + 1 });
        j++;
      }
    }
  }
  out.push(...middle);
  for (let k = 0; k < suf; k++) {
    const oi = a.length - suf + k;
    const ni = b.length - suf + k;
    out.push({ type: 'same', text: a[oi], oldLine: oi + 1, newLine: ni + 1 });
  }
  return out;
}

/** Recolhe trechos iguais longos, deixando `context` linhas em volta de cada mudança. */
export function collapseDiff(lines: DiffLine[], context = 3): DiffLine[] {
  const changed = lines.map(l => l.type !== 'same');
  const keep = lines.map((_, i) => {
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) if (changed[k]) return true;
    return false;
  });
  const out: DiffLine[] = [];
  let skipped = 0;
  for (let i = 0; i < lines.length; i++) {
    if (keep[i]) {
      if (skipped) out.push({ type: 'skip', text: `${skipped} linha${skipped > 1 ? 's' : ''} igua${skipped > 1 ? 'is' : 'l'}` });
      skipped = 0;
      out.push(lines[i]);
    } else skipped++;
  }
  if (skipped) out.push({ type: 'skip', text: `${skipped} linha${skipped > 1 ? 's' : ''} igua${skipped > 1 ? 'is' : 'l'}` });
  return out;
}

/** Texto para comparar: JSON válido é reformatado (2 espaços) para a diferença não acusar só espaçamento. */
export function comparableJson(text: string | null | undefined): string {
  const t = text ?? '';
  const parsed = parseLenient(t);
  return parsed.ok ? JSON.stringify(parsed.value, null, 2) : t;
}
