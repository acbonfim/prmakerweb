import { marked } from 'marked';
import TurndownService from 'turndown';

/**
 * Conversões usadas pelos editores WYSIWYG: o markdown é a fonte da verdade (salvo no
 * banco / enviado ao GitHub) e o HTML só existe para exibir formatado no p-editor.
 */
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-'
});

// Tachado (~~texto~~) não é tratado pelo turndown por padrão — mapeamos manualmente
// para manter o markdown limpo ao converter o HTML do editor de volta.
turndown.addRule('strikethrough', {
  filter: ['del', 's', 'strike'] as any,
  replacement: (content: string) => `~~${content}~~`,
});

export function mdToHtml(markdown: string | null | undefined): string {
  if (!markdown) return '';
  marked.setOptions({ gfm: true, breaks: true });
  return (marked.parse(markdown) as string) ?? '';
}

export function htmlToMd(html: string | null | undefined): string {
  return html ? turndown.turndown(html) : '';
}
