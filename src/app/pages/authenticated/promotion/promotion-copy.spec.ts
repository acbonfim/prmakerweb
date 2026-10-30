import { PromotionItem } from './promotion.model';
import {
  formatPromotionHtmlTable, formatPromotionMarkdownTable, formatPromotionText, selectCopyItems
} from './promotion-copy';

function item(position: number, card: string, target: string, status: PromotionItem['status'], extra: Partial<PromotionItem> = {}): PromotionItem {
  return {
    id: `i${position}`, position, card, title: `Título ${card}`, repository: 'Solvace-Org/edv-solvace-apps', sourceBranch: `hotfix/${card}`,
    target, draft: false, mode: 'cherry-pick', status, conflictFiles: [], commitCount: 2,
    pullRequestUrl: status === 'opened' || status === 'already_open' ? `https://github.com/x/y/pull/${position}` : null, ...extra
  };
}

describe('promotion-copy (0074)', () => {
  const items = [
    item(3, '76607', 'master', 'conflict', { message: 'Conflito ao aplicar abc em master.' }),
    item(1, '77317', 'release-3.274.10', 'opened'),
    item(2, '77317', 'master', 'opened', { draft: true }),
    item(4, '76462', 'edge', 'already_open'),
    item(5, '76601', 'edge', 'queued')
  ];

  it('só os PRs abertos por padrão, na ordem do lote', () => {
    expect(selectCopyItems(items).map(i => i.position)).toEqual([1, 2, 4]);
  });

  it('com falhas inclui o que terminou sem PR, mas não o que ainda está na fila', () => {
    expect(selectCopyItems(items, { includeFailures: true }).map(i => i.position)).toEqual([1, 2, 3, 4]);
  });

  it('texto no formato do registro de PR: card [destino] - link', () => {
    const text = formatPromotionText(selectCopyItems(items));
    expect(text.split('\n')).toEqual([
      'AB#77317 [release-3.274.10] - https://github.com/x/y/pull/1',
      'AB#77317 [master (rascunho)] - https://github.com/x/y/pull/2',
      'AB#76462 [edge] - https://github.com/x/y/pull/4'
    ]);
  });

  it('falha sai com a situação no lugar do link', () => {
    const text = formatPromotionText(selectCopyItems(items, { includeFailures: true }));
    expect(text).toContain('AB#76607 [master] - (conflict: Conflito ao aplicar abc em master.)');
  });

  it('tabela markdown escapa o pipe e traz título e repositório', () => {
    const md = formatPromotionMarkdownTable([item(1, '77317', 'release-3.274.10', 'opened', { title: 'Botão | sobreposto' })]);
    const lines = md.split('\n');
    expect(lines[0]).toBe('| CARD | TÍTULO | REPOSITÓRIO | DESTINO | PR |');
    expect(lines[2]).toBe('| AB#77317 | Botão \\| sobreposto | Solvace-Org/edv-solvace-apps | release-3.274.10 | https://github.com/x/y/pull/1 |');
  });

  it('tabela HTML escapa o conteúdo e linka o PR', () => {
    const html = formatPromotionHtmlTable([item(1, '77317', 'master', 'opened', { title: '<b>x</b> & "y"' })]);
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;');
    expect(html).toContain('<a href="https://github.com/x/y/pull/1">https://github.com/x/y/pull/1</a>');
    expect(html.startsWith('<table')).toBeTrue();
  });
});
