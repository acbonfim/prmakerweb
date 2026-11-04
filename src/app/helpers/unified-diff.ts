/**
 * Diff unificado (git/difflib) → linhas com os números antigo/novo. Extraído do `git-diff-viewer`
 * (0075/F2) para o popover da fotografia de código reaproveitar.
 *
 * - `@@ -a,b +c,d @@` → linha `info` e reinicia a numeração;
 * - `+` adição (só número novo), `-` remoção (só número antigo), ` ` contexto (os dois);
 * - cabeçalho do arquivo (`diff --git`, `index`, `--- a/x`, `+++ b/x`) antes do 1º trecho é ignorado,
 *   assim como `\ No newline at end of file`;
 * - linha vazia dentro de um trecho que ainda espera linhas conta como contexto vazio (ferramentas que
 *   tiram o espaço do fim da linha).
 */

export type DiffLineType = 'addition' | 'deletion' | 'context' | 'info';

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parsePatch(patch: string | null | undefined): DiffLine[] {
  if (!patch) return [];

  const lines = patch.replace(/\r\n/g, '\n').split('\n');
  const out: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let oldLeft = 0;
  let newLeft = 0;
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      const m = HUNK.exec(line);
      if (m) {
        oldLine = parseInt(m[1], 10);
        newLine = parseInt(m[3], 10);
        oldLeft = m[2] !== undefined ? parseInt(m[2], 10) : 1;
        newLeft = m[4] !== undefined ? parseInt(m[4], 10) : 1;
        // "-0,0": arquivo novo — a numeração antiga não existe
        if (oldLeft === 0 && oldLine === 0) oldLine = 1;
      }
      inHunk = true;
      out.push({ type: 'info', content: line });
      continue;
    }
    if (!inHunk) continue; // cabeçalho do arquivo (---/+++/diff/index)
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"

    if (line.startsWith('+')) {
      out.push({ type: 'addition', content: line.substring(1), newLineNumber: newLine++ });
      newLeft--;
    } else if (line.startsWith('-')) {
      out.push({ type: 'deletion', content: line.substring(1), oldLineNumber: oldLine++ });
      oldLeft--;
    } else if (line.startsWith(' ') || (line === '' && oldLeft > 0 && newLeft > 0)) {
      out.push({ type: 'context', content: line.substring(1), oldLineNumber: oldLine++, newLineNumber: newLine++ });
      oldLeft--;
      newLeft--;
    }
  }

  return out;
}

/** Totais de linhas adicionadas/removidas. */
export function diffStats(lines: DiffLine[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const l of lines) {
    if (l.type === 'addition') additions++;
    else if (l.type === 'deletion') deletions++;
  }
  return { additions, deletions };
}
