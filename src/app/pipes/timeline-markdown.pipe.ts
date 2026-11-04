import { Pipe, PipeTransform } from '@angular/core';
import { looksLikeMarkdown } from '../helpers/markdown-detect';
import { hasCitation, hasReRef, renderMarkdown } from '../helpers/markdown-ext';

/**
 * Texto da linha do tempo → HTML quando estiver em markdown (detecção automática) ou citar código
 * (`caminho:linha`, que vira link — 0075) ou item da engenharia reversa (`UC-121` — 0076), ou null para texto comum (exibido como sempre). Puro: só
 * reprocessa quando o texto muda. O HTML é ligado via [innerHTML], que passa pelo sanitizador do
 * Angular (remove scripts e atributos perigosos).
 */
@Pipe({ name: 'timelineMarkdown', standalone: true, pure: true })
export class TimelineMarkdownPipe implements PipeTransform {
  transform(text: string | null | undefined): string | null {
    if (!looksLikeMarkdown(text) && !hasCitation(text) && !hasReRef(text)) return null;
    return renderMarkdown(text!, { codeRefs: true, reRefs: true });
  }
}
