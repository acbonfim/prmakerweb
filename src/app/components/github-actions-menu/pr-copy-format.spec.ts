import { formatPrHtmlTable, formatPrMarkdownTable, formatPrText } from './pr-copy-format';

describe('pr-copy-format', () => {
  const rows = [
    { card: '75294', env: 'HV', url: 'https://github.com/org/repo/pull/12' },
    { card: '75294', env: 'DEV', url: 'https://github.com/org/repo/pull/13?a=1&b=2' },
  ];

  it('texto: uma linha "<card> [AMBIENTE] - link" por PR', () => {
    expect(formatPrText(rows)).toBe(
      '75294 [HV] - https://github.com/org/repo/pull/12\n' +
      '75294 [DEV] - https://github.com/org/repo/pull/13?a=1&b=2');
  });

  it('tabela markdown: colunas CARD, AMBIENTE, PR', () => {
    expect(formatPrMarkdownTable(rows).split('\n').slice(0, 3)).toEqual([
      '| CARD | AMBIENTE | PR |',
      '|---|---|---|',
      '| 75294 | HV | https://github.com/org/repo/pull/12 |',
    ]);
  });

  it('tabela html: cabeçalho, link e escape de &', () => {
    const html = formatPrHtmlTable(rows);
    expect(html).toContain('>CARD</th>');
    expect(html).toContain('>AMBIENTE</th>');
    expect(html).toContain('<a href="https://github.com/org/repo/pull/13?a=1&amp;b=2">');
  });
});
