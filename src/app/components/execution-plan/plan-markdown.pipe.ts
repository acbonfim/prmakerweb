import { Pipe, PipeTransform } from '@angular/core';
import { renderMarkdown } from '../../helpers/markdown-ext';

/**
 * Markdown → HTML para textos do plano (descrição da etapa, pedaços de andamento, análises). Sempre
 * renderiza (a skill escreve em markdown). Com as extensões da 0075 (callouts, links de código `ref:`,
 * citações `caminho:linha`, imagens `anexo:`). Ligado via [innerHTML], que passa pelo sanitizador do Angular.
 */
@Pipe({ name: 'planMarkdown', standalone: true, pure: true })
export class PlanMarkdownPipe implements PipeTransform {
  transform(text: string | null | undefined): string {
    if (!text) return '';
    return renderMarkdown(text, { codeRefs: true });
  }
}
