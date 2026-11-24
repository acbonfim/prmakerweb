/**
 * 0099 ajustes 1: lógica pura do `app-pm-combo` (campo com digitação + lista do PRMake) — busca sem acento/caixa
 * (começa com > começo de palavra > contém), destaque do trecho digitado, rótulo do valor escolhido, lista múltipla
 * (incluir/tirar sem duplicar, ignora caixa) e o texto de "Criar «x»". Sem Angular (testável direto).
 */

/** Uma opção do combo. `value` é a chave (texto); o resto é visual. */
export interface PmComboOption {
  value: string;
  /** Texto principal (é nele que a busca procura primeiro). */
  label: string;
  /** Texto menor à direita (e-mail, contagem, origem…); também entra na busca. */
  hint?: string | null;
  /** Ícone do Material antes do rótulo. */
  icon?: string | null;
  /** Cor do ícone (ou da bolinha, quando não há ícone). */
  color?: string | null;
  /** Avatar (pessoas): nome para as iniciais e a imagem, quando houver. */
  avatar?: { name: string; imageUrl?: string | null } | null;
  /** Palavras extras para a busca (não aparecem). */
  keywords?: string | null;
  /** Rótulo curto mostrado sem busca (árvore: só o nome do nó); com busca aparece o `label` inteiro. */
  short?: string | null;
  /** Recuo na árvore (sem busca). */
  depth?: number;
  disabled?: boolean;
  /** Dado livre de quem chamou (ex.: a pessoa inteira) — volta no `picked`. */
  data?: unknown;
}

/** Texto sem acentos, em minúsculas e sem espaços nas pontas. */
export function foldText(s: string | null | undefined): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const same = (a: string | null | undefined, b: string | null | undefined) => foldText(a) === foldText(b);

/**
 * Nota da opção para o texto (menor = melhor; `-1` = não casa): 0 rótulo começa com o texto, 1 alguma palavra do
 * rótulo começa com ele, 2 o rótulo contém, 3 a dica/palavras extras contêm. Várias palavras: todas precisam estar em
 * algum lugar (a nota é a da primeira).
 */
export function matchRank(option: Pick<PmComboOption, 'label' | 'hint' | 'keywords' | 'value'>, query: string): number {
  const q = foldText(query);
  if (!q) return 0;
  const label = foldText(option.label);
  const rest = foldText(`${option.hint ?? ''} ${option.keywords ?? ''} ${option.value ?? ''}`);
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1 && !words.every((w) => label.includes(w) || rest.includes(w))) return -1;
  const first = words.length > 1 ? words[0] : q;
  if (label.startsWith(q)) return 0;
  if (label.split(/[\s/\\\-_.@()]+/).some((w) => w.startsWith(first))) return 1;
  if (label.includes(first)) return 2;
  if (rest.includes(first)) return 3;
  return words.length > 1 ? 3 : -1;
}

/**
 * Opções que casam com o texto, na ordem da nota (empate: a ordem original — a árvore e as listas ordenadas pelo
 * servidor continuam na ordem delas). Sem texto, todas na ordem original. `limit` corta a lista.
 */
export function filterComboOptions(options: readonly PmComboOption[], query: string, limit = 200): PmComboOption[] {
  const q = foldText(query);
  if (!q) return options.slice(0, limit);
  const ranked: { o: PmComboOption; r: number; i: number }[] = [];
  options.forEach((o, i) => {
    const r = matchRank(o, q);
    if (r >= 0) ranked.push({ o, r, i });
  });
  ranked.sort((a, b) => a.r - b.r || a.i - b.i);
  return ranked.slice(0, limit).map((x) => x.o);
}

/** Pedaço do rótulo para o destaque (`match` = trecho que casa com o texto digitado). */
export interface HighlightPart {
  text: string;
  match: boolean;
}

/**
 * Divide o rótulo para destacar a primeira ocorrência de cada palavra digitada (sem acento/caixa — o texto original
 * é preservado, com os acentos).
 */
export function highlightParts(label: string | null | undefined, query: string | null | undefined): HighlightPart[] {
  const text = label ?? '';
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (!text || !words.length) return text ? [{ text, match: false }] : [];
  // Texto dobrado caractere a caractere, guardando de qual caractere original veio cada um.
  let folded = '';
  const from: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const f = text[i].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (let k = 0; k < f.length; k++) { folded += f[k]; from.push(i); }
  }
  const marks = new Array<boolean>(text.length).fill(false);
  for (const w of words) {
    const at = folded.indexOf(w);
    if (at < 0) continue;
    for (let k = at; k < at + w.length; k++) marks[from[k]] = true;
  }
  const parts: HighlightPart[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.match === marks[i]) last.text += text[i];
    else parts.push({ text: text[i], match: marks[i] });
  }
  return parts;
}

/** Opção do valor (ignora caixa/acento quando não há igual exato). */
export function findOption(options: readonly PmComboOption[], value: string | null | undefined): PmComboOption | null {
  if (value == null || value === '') return null;
  return options.find((o) => o.value === value) ?? options.find((o) => same(o.value, value)) ?? null;
}

/** Texto do campo para o valor: o rótulo da opção, senão `fallback`, senão o próprio valor. */
export function labelForValue(options: readonly PmComboOption[], value: string | null | undefined, fallback?: string | null): string {
  if (value == null || value === '') return '';
  return findOption(options, value)?.label ?? (fallback || value);
}

/** O valor está na lista (ignora caixa/acento). */
export function hasValue(values: readonly string[], value: string): boolean {
  return values.some((v) => same(v, value));
}

/** Inclui sem duplicar (ignora caixa/acento); vazio não entra. */
export function addValue(values: readonly string[], value: string): string[] {
  const v = (value ?? '').trim();
  if (!v || hasValue(values, v)) return [...values];
  return [...values, v];
}

export function removeValue(values: readonly string[], value: string): string[] {
  return values.filter((v) => !same(v, value));
}

/** Liga/desliga o valor na lista. */
export function toggleComboValue(values: readonly string[], value: string): string[] {
  return hasValue(values, value) ? removeValue(values, value) : addValue(values, value);
}

/**
 * Texto para "Criar «x»": o digitado (limpo), só quando não é igual a nenhuma opção (rótulo ou valor) nem a um valor
 * já escolhido.
 */
export function createCandidate(options: readonly PmComboOption[], chosen: readonly string[], query: string | null | undefined): string | null {
  const q = (query ?? '').replace(/\s+/g, ' ').trim();
  if (!q) return null;
  if (options.some((o) => same(o.label, q) || same(o.value, q))) return null;
  if (chosen.some((v) => same(v, q))) return null;
  return q;
}

/**
 * Opção que o texto digitado escolhe ao confirmar (Enter/sair do campo): a de rótulo ou valor igual (ignora
 * caixa/acento), senão a única que casa com o texto.
 */
export function exactOrOnly(options: readonly PmComboOption[], query: string | null | undefined): PmComboOption | null {
  const q = foldText(query);
  if (!q) return null;
  const exact = options.find((o) => !o.disabled && (foldText(o.label) === q || foldText(o.value) === q));
  if (exact) return exact;
  const hits = filterComboOptions(options.filter((o) => !o.disabled), q, 2);
  return hits.length === 1 ? hits[0] : null;
}

/** Junta listas de texto sem duplicar (ignora caixa/acento; fica a primeira grafia). */
export function mergeDistinct(...lists: readonly (readonly (string | null | undefined)[] | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const list of lists) {
    for (const raw of list ?? []) {
      const v = (raw ?? '').trim();
      if (v && !hasValue(out, v)) out.push(v);
    }
  }
  return out;
}
