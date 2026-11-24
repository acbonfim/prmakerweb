import { fold } from './board.logic';

/**
 * 0099 (Mesa de gestão): tags do card — sugestões com busca nas tags do projeto (ignora caixa e acento), "Criar tag
 * «x»" quando o texto não existe, inclusão sem duplicar (usa a grafia que o projeto já tem) e a diferença
 * adicionar/remover para o PATCH.
 */

/** Tag limpa: sem espaços sobrando e sem `;` (o DevOps separa as tags por `;`). */
export function normalizeTag(raw: string | null | undefined): string {
  return (raw ?? '').replace(/;/g, ' ').replace(/\s+/g, ' ').trim();
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export interface TagSuggestions {
  /** Tags do projeto que casam com o texto (fora as já escolhidas). */
  options: string[];
  /** Texto para "Criar tag «x»" — só quando não existe no projeto nem entre as escolhidas. */
  create: string | null;
}

/**
 * Sugestões para o texto digitado: primeiro as que começam com ele, depois as que contêm; sem texto, as primeiras
 * do projeto em ordem alfabética.
 */
export function suggestTags(all: string[], selected: string[], query: string, limit = 50): TagSuggestions {
  const q = normalizeTag(query);
  const fq = fold(q);
  const chosen = new Set(selected.map((t) => t.toLowerCase()));
  const pool = all.filter((t) => t && !chosen.has(t.toLowerCase()));
  let options: string[];
  if (!fq) {
    options = [...pool].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  } else {
    const starts: string[] = [];
    const contains: string[] = [];
    for (const t of pool) {
      const ft = fold(t);
      if (ft.startsWith(fq)) starts.push(t);
      else if (ft.includes(fq)) contains.push(t);
    }
    const byText = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });
    options = [...starts.sort(byText), ...contains.sort(byText)];
  }
  const exists = !!q && (all.some((t) => same(t, q)) || selected.some((t) => same(t, q)));
  return { options: options.slice(0, limit), create: q && !exists ? q : null };
}

/** Inclui a tag (com a grafia do projeto, se já existir) sem duplicar. */
export function addTag(selected: string[], raw: string, all: string[] = []): string[] {
  const tag = normalizeTag(raw);
  if (!tag || selected.some((t) => same(t, tag))) return selected;
  const canonical = all.find((t) => same(t, tag)) ?? tag;
  return [...selected, canonical];
}

export function removeTag(selected: string[], tag: string): string[] {
  return selected.filter((t) => !same(t, tag));
}

/** Diferença entre as tags do card e as da tela (ignora caixa). */
export function diffTags(original: string[], current: string[]): { addTags: string[]; removeTags: string[] } {
  const addTags = current.filter((t) => !original.some((o) => same(o, t)));
  const removeTags = original.filter((o) => !current.some((t) => same(o, t)));
  return { addTags, removeTags };
}

/** Lê `System.Tags` (`"a; b"`) ou uma lista. */
export function parseTags(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((t) => normalizeTag(`${t}`)).filter(Boolean);
  if (typeof v !== 'string') return [];
  return v.split(';').map(normalizeTag).filter(Boolean);
}
