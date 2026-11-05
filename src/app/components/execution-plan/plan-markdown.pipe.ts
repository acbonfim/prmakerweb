import { Pipe, PipeTransform } from '@angular/core';
import { renderMarkdown } from '../../helpers/markdown-ext';

/**
 * Markdown → HTML para textos do plano (descrição da etapa, pedaços de andamento, análises). Sempre
 * renderiza (a skill escreve em markdown). Com as extensões da 0075 (callouts, links de código `ref:`,
 * citações `caminho:linha`, imagens `anexo:`). Ligado via [innerHTML], que passa pelo sanitizador do Angular.
 * `| planMarkdown:'card'` (0076): textos de um card — liga os links dos itens da engenharia reversa
 * (`UC-121`), que abrem o popover do item pela `appCodeRefHost` do contêiner. `| planMarkdown:'case'` (0090): conversa do
 * especialista — o mesmo de `'card'` e mais `#123` = item de trabalho (popover do item).
 */
@Pipe({ name: 'planMarkdown', standalone: true, pure: true })
export class PlanMarkdownPipe implements PipeTransform {
  transform(text: string | null | undefined, context?: 'card' | 'case'): string {
    if (!text) return '';
    return renderMarkdown(text, { codeRefs: true, reRefs: context === 'card' || context === 'case', workRefs: context === 'case' });
  }
}
