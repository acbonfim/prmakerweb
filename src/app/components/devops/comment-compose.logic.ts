import { DevOpsMention } from './devops.model';

/**
 * 0099 ajustes 3: lógica pura do compositor da discussion — `@` (pessoa) e `#` (card do DevOps) no cursor, inserir a
 * menção escolhida e quais pessoas citadas ainda estão no texto (só essas vão para o servidor).
 */

export type MentionKind = 'person' | 'card';

export interface MentionTrigger {
  kind: MentionKind;
  /** O que foi digitado depois do `@`/`#`. */
  query: string;
  /** Posição do `@`/`#` no texto. */
  start: number;
}

/** `@`/`#` sendo digitado no cursor (começo do texto ou depois de espaço/parêntese), ou null. */
export function mentionTrigger(text: string, caret: number): MentionTrigger | null {
  const before = (text ?? '').slice(0, Math.max(0, caret));
  const m = /(^|[\s(\[])([@#])([^\s@#()\[\]]{0,40})$/u.exec(before);
  if (!m) return null;
  const start = before.length - m[3].length - 1;
  return { kind: m[2] === '@' ? 'person' : 'card', query: m[3], start };
}

/** Troca o `@consulta`/`#consulta` em [start, caret) pelo `token` + espaço; devolve o texto e o cursor novo. */
export function insertMention(text: string, start: number, caret: number, token: string): { text: string; caret: number } {
  const head = text.slice(0, start);
  const tail = text.slice(caret).replace(/^[^\s]*/, '');
  const spaced = tail.startsWith(' ');
  const inserted = `${token}${spaced ? '' : ' '}`;
  return { text: `${head}${inserted}${tail}`, caret: head.length + inserted.length + (spaced ? 1 : 0) };
}

/** Pessoas escolhidas cujo `@Nome` ainda está no texto (sem repetir pelo login). */
export function activeMentions(text: string, picked: DevOpsMention[]): DevOpsMention[] {
  const lower = (text ?? '').toLowerCase();
  const seen = new Set<string>();
  return picked.filter((p) => {
    const key = (p.uniqueName || p.displayName).toLowerCase();
    if (seen.has(key) || !lower.includes(`@${p.displayName.toLowerCase()}`)) return false;
    seen.add(key);
    return true;
  });
}
