import { Pipe, PipeTransform } from '@angular/core';
import { marked } from 'marked';

/**
 * Markdown → HTML para textos do plano (descrição da etapa, pedaços de andamento, análises). Sempre
 * renderiza (a skill escreve em markdown). Ligado via [innerHTML], que passa pelo sanitizador do Angular.
 */
@Pipe({ name: 'planMarkdown', standalone: true, pure: true })
export class PlanMarkdownPipe implements PipeTransform {
  transform(text: string | null | undefined): string {
    if (!text) return '';
    return marked.parse(text, { gfm: true, breaks: true, async: false }) as string;
  }
}
