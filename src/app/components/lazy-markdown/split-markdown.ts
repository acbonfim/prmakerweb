/** Pedaço do documento: começa num cabeçalho (quando dá) e guarda os IDs dos itens (### RN-012 — …) que contém. */
export interface MarkdownChunk { text: string; ids: string[]; estimate: number; }

const ITEM_HEADING = /^#{2,4}\s+[*`_]*([A-Z]{2,4}-\d{1,4})\b/;
const LINE_PX = 23;
const CHARS_PER_LINE = 100;

/** Altura aproximada de uma linha do markdown já desenhada (o espaço reservado usa a soma — evita a barra pular muito). */
function lineHeight(line: string, heading: boolean, fence: boolean): number {
  if (heading) return 46;
  if (!line.trim()) return fence ? LINE_PX : 6;
  return Math.ceil(line.length / CHARS_PER_LINE) * LINE_PX + (fence ? 0 : 4);
}

/**
 * Divide o markdown em pedaços de ~`target` caracteres, cortando antes de um cabeçalho (fora de bloco de código). Uma
 * seção sem cabeçalhos maior que 3× o alvo é cortada numa linha em branco fora de bloco de código.
 */
export function splitMarkdown(text: string, target = 30_000): MarkdownChunk[] {
  const chunks: MarkdownChunk[] = [];
  let lines: string[] = [], ids: string[] = [], size = 0, height = 0, fence = false;
  const flush = () => {
    if (!lines.length) return;
    chunks.push({ text: lines.join('\n'), ids, estimate: Math.max(Math.round(height), 40) });
    lines = []; ids = []; size = 0; height = 0;
  };
  for (const line of (text ?? '').replace(/\r\n/g, '\n').split('\n')) {
    const trimmed = line.trimStart();
    const isFence = trimmed.startsWith('```');
    const heading = !fence && !isFence && /^#{1,4}\s/.test(line);
    if (heading && size >= target) flush();
    else if (!fence && !isFence && size >= target * 3 && trimmed === '') flush();
    lines.push(line);
    size += line.length + 1;
    height += lineHeight(line, heading, fence);
    if (heading) { const m = ITEM_HEADING.exec(line); if (m) ids.push(m[1]); }
    // Abre/fecha bloco de código; ```mermaid``` inline (abre e fecha na mesma linha) não conta.
    if (isFence && (fence || trimmed.indexOf('```', 3) < 0)) fence = !fence;
  }
  flush();
  return chunks;
}
