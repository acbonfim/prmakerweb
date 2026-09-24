/**
 * Detecta se um texto livre (ex.: registro da linha do tempo) está em markdown, para renderizar
 * formatado sem o usuário precisar marcar nada. Conservador: só retorna true com um sinal forte —
 * texto comum com um asterisco ou hífen solto continua sendo texto comum.
 */
const STRONG_SIGNALS: RegExp[] = [
  /^\s{0,3}```/m,                        // bloco de código
  /^\s{0,3}#{1,6}\s+\S/m,                // título (# Título)
  /\*\*[^*\n]*\S[^*\n]*\*\*/,            // **negrito**
  /(^|[^\w])__[^_\n]*\S[^_\n]*__(?!\w)/, // __negrito__
  /`[^`\n]+`/,                           // `código`
  /\[[^\]\n]+\]\((https?:\/\/|\/|#)[^)\s]*\)/, // [link](url)
  /^\s{0,3}>\s+\S/m,                     // > citação
  /^\s*\|?.*\|.*\n\s*\|?\s*:?-{3,}:?\s*\|/m,  // tabela (linha + |---|)
];

const BULLET_LINE = /^\s{0,3}[-*+]\s+\S/;
const ORDERED_LINE = /^\s{0,3}\d{1,3}[.)]\s+\S/;

export function looksLikeMarkdown(text: string | null | undefined): boolean {
  if (!text || text.length < 3) return false;
  if (STRONG_SIGNALS.some(re => re.test(text))) return true;

  // Listas só contam com 2+ itens (um "- algo" isolado é texto comum).
  const lines = text.split(/\r?\n/);
  const bullets = lines.filter(l => BULLET_LINE.test(l)).length;
  const ordered = lines.filter(l => ORDERED_LINE.test(l)).length;
  return bullets >= 2 || ordered >= 2;
}
