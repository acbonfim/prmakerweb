import { splitMarkdown } from './split-markdown';

describe('splitMarkdown', () => {
  const item = (n: number) => `### RN-${String(n).padStart(3, '0')} — regra ${n}\n- **Onde:** src/a.cs:${n}\n${'texto '.repeat(40)}\n`;

  it('corta antes de um cabeçalho e guarda os IDs de cada pedaço', () => {
    const doc = '# Doc\n\n## Regras\n\n' + Array.from({ length: 50 }, (_, i) => item(i + 1)).join('\n');
    const chunks = splitMarkdown(doc, 2_000);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.map(c => c.text).join('\n')).toBe(doc);
    expect(chunks.flatMap(c => c.ids)).toEqual(Array.from({ length: 50 }, (_, i) => `RN-${String(i + 1).padStart(3, '0')}`));
    for (const c of chunks.slice(1)) expect(c.text.startsWith('#')).toBeTrue();
  });

  it('não corta dentro de bloco de código nem conta cabeçalho dentro dele', () => {
    const code = '```\n' + Array.from({ length: 200 }, (_, i) => `## não é cabeçalho ${i}\n### RN-900 — falso`).join('\n') + '\n```';
    const doc = '## Diagramas\n\n' + code + '\n\n### RN-001 — real\ntexto';
    const chunks = splitMarkdown(doc, 500);
    expect(chunks.some(c => c.text.includes('```\n## não é cabeçalho 0') && c.text.includes('não é cabeçalho 199\n### RN-900 — falso\n```'))).toBeTrue();
    expect(chunks.flatMap(c => c.ids)).toEqual(['RN-001']);
  });

  it('documento vazio vira um pedaço vazio', () => {
    expect(splitMarkdown('').length).toBe(1);
  });
});
