/** Uma linha da cópia: card, ambiente (rótulo do destino, ex.: HV) e link do PR. */
export interface PrCopyRow {
  card: string;
  env: string;
  url: string;
}

export type PrCopyFormat = 'text' | 'table';

/** `<card> [HV] - link`, uma linha por PR. */
export function formatPrText(rows: PrCopyRow[]): string {
  return rows.map(r => `${r.card} [${r.env}] - ${r.url}`).join('\n');
}

/** Tabela em Markdown (texto puro da cópia em tabela). */
export function formatPrMarkdownTable(rows: PrCopyRow[]): string {
  const cell = (v: string) => v.replace(/\|/g, '\\|');
  return [
    '| CARD | AMBIENTE | PR |',
    '|---|---|---|',
    ...rows.map(r => `| ${cell(r.card)} | ${cell(r.env)} | ${cell(r.url)} |`),
  ].join('\n');
}

const escapeHtml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Tabela HTML (cola como tabela no Teams, Outlook, Word, DevOps...). */
export function formatPrHtmlTable(rows: PrCopyRow[]): string {
  const td = 'style="border:1px solid #999;padding:4px 8px"';
  const head = ['CARD', 'AMBIENTE', 'PR'].map(h => `<th ${td}>${h}</th>`).join('');
  const body = rows.map(r =>
    `<tr><td ${td}>${escapeHtml(r.card)}</td><td ${td}>${escapeHtml(r.env)}</td>` +
    `<td ${td}><a href="${escapeHtml(r.url)}">${escapeHtml(r.url)}</a></td></tr>`).join('');
  return `<table style="border-collapse:collapse"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}
