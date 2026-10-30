import { PromotionItem, itemHasPr } from './promotion.model';

/**
 * Cópia do resultado da promoção (0074). O texto segue o formato que o Release Manager já recebe do registro de PR
 * (`<card> [ambiente] - link`); a tabela traz também o título e o repositório.
 */
export interface PromotionCopyOptions {
  /** Inclui conflitos, erros e o que não abriu (com a situação no lugar do link). */
  includeFailures?: boolean;
}

const card = (c: string) => (/^\d+$/.test(c) ? `AB#${c}` : c);

export function selectCopyItems(items: PromotionItem[], options: PromotionCopyOptions = {}): PromotionItem[] {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  return options.includeFailures ? sorted.filter(i => i.status !== 'queued' && i.status !== 'running') : sorted.filter(itemHasPr);
}

const where = (i: PromotionItem) => (itemHasPr(i) ? i.pullRequestUrl! : `(${i.status}${i.message ? `: ${i.message}` : ''})`);

/** `AB#77317 [release-3.274.10] - https://…` — uma linha por PR. */
export function formatPromotionText(items: PromotionItem[]): string {
  return items.map(i => `${card(i.card)} [${i.target}${i.draft ? ' (rascunho)' : ''}] - ${where(i)}`).join('\n');
}

const cell = (v: string) => v.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function formatPromotionMarkdownTable(items: PromotionItem[]): string {
  return [
    '| CARD | TÍTULO | REPOSITÓRIO | DESTINO | PR |',
    '|---|---|---|---|---|',
    ...items.map(i => `| ${card(i.card)} | ${cell(i.title)} | ${cell(i.repository)} | ${cell(i.target)}${i.draft ? ' (rascunho)' : ''} | ${cell(where(i))} |`)
  ].join('\n');
}

const escapeHtml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Tabela HTML — cola como tabela no Teams, Outlook, Word e no DevOps. */
export function formatPromotionHtmlTable(items: PromotionItem[]): string {
  const td = 'style="border:1px solid #999;padding:4px 8px"';
  const head = ['CARD', 'TÍTULO', 'REPOSITÓRIO', 'DESTINO', 'PR'].map(h => `<th ${td}>${h}</th>`).join('');
  const body = items.map(i => {
    const link = itemHasPr(i)
      ? `<a href="${escapeHtml(i.pullRequestUrl!)}">${escapeHtml(i.pullRequestUrl!)}</a>`
      : escapeHtml(where(i));
    return `<tr><td ${td}>${escapeHtml(card(i.card))}</td><td ${td}>${escapeHtml(i.title)}</td><td ${td}>${escapeHtml(i.repository)}</td>` +
      `<td ${td}>${escapeHtml(i.target)}${i.draft ? ' (rascunho)' : ''}</td><td ${td}>${link}</td></tr>`;
  }).join('');
  return `<table style="border-collapse:collapse"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}
