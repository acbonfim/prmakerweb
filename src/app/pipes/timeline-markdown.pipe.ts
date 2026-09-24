import { Pipe, PipeTransform } from '@angular/core';
import { marked } from 'marked';
import { looksLikeMarkdown } from '../helpers/markdown-detect';

/**
 * Texto da linha do tempo → HTML quando estiver em markdown (detecção automática), ou null para
 * texto comum (exibido como sempre). Puro: só reprocessa quando o texto muda. O HTML é ligado via
 * [innerHTML], que passa pelo sanitizador do Angular (remove scripts e atributos perigosos).
 */
@Pipe({ name: 'timelineMarkdown', standalone: true, pure: true })
export class TimelineMarkdownPipe implements PipeTransform {
  transform(text: string | null | undefined): string | null {
    if (!looksLikeMarkdown(text)) return null;
    return marked.parse(text!, { gfm: true, breaks: true, async: false }) as string;
  }
}
