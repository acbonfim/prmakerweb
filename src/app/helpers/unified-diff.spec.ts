import { diffStats, parsePatch } from './unified-diff';

describe('unified-diff (0075/F2)', () => {
  it('numera as linhas antigas e novas a partir do cabeçalho do trecho', () => {
    const patch = [
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -10,4 +10,5 @@ class X {',
      ' const a = 1;',
      '-const b = 2;',
      '+const b = 3;',
      '+const c = 4;',
      ' const d = 5;',
      ' return a;',
    ].join('\n');
    const lines = parsePatch(patch);
    expect(lines.map(l => l.type)).toEqual(['info', 'context', 'deletion', 'addition', 'addition', 'context', 'context']);
    expect(lines.map(l => [l.oldLineNumber ?? null, l.newLineNumber ?? null])).toEqual([
      [null, null], [10, 10], [11, null], [null, 11], [null, 12], [12, 13], [13, 14],
    ]);
    expect(lines[2].content).toBe('const b = 2;');
    expect(diffStats(lines)).toEqual({ additions: 2, deletions: 1 });
  });

  it('ignora o cabeçalho do arquivo (---/+++ não viram remoção/adição) e o "\\ No newline"', () => {
    const patch = 'diff --git a/x b/x\nindex 1..2\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n';
    const lines = parsePatch(patch);
    expect(lines.length).toBe(3);
    expect(lines[1]).toEqual({ type: 'deletion', content: 'old', oldLineNumber: 1 });
    expect(lines[2]).toEqual({ type: 'addition', content: 'new', newLineNumber: 1 });
  });

  it('arquivo novo (difflib: @@ -0,0 +1,2 @@) e vários trechos', () => {
    const created = parsePatch('--- a/n.ts\n+++ b/n.ts\n@@ -0,0 +1,2 @@\n+a\n+b\n');
    expect(created.filter(l => l.type === 'addition').map(l => l.newLineNumber)).toEqual([1, 2]);

    const two = parsePatch('@@ -1,2 +1,2 @@\n a\n-b\n+B\n@@ -50,1 +50,2 @@\n x\n+y\n');
    expect(two.filter(l => l.type === 'info').length).toBe(2);
    expect(two[two.length - 1]).toEqual({ type: 'addition', content: 'y', newLineNumber: 51 });
  });

  it('linha vazia dentro do trecho é contexto vazio; a quebra final não cria linha fantasma', () => {
    const lines = parsePatch('@@ -1,3 +1,3 @@\n a\n\n-c\n+C\n');
    expect(lines.map(l => l.type)).toEqual(['info', 'context', 'context', 'deletion', 'addition']);
    expect(lines[2]).toEqual({ type: 'context', content: '', oldLineNumber: 2, newLineNumber: 2 });
  });

  it('patch do GitHub (sem cabeçalho) continua igual ao viewer antigo', () => {
    const lines = parsePatch('@@ -3,2 +3,2 @@\n x\n-y\n+z');
    expect(lines).toEqual([
      { type: 'info', content: '@@ -3,2 +3,2 @@' },
      { type: 'context', content: 'x', oldLineNumber: 3, newLineNumber: 3 },
      { type: 'deletion', content: 'y', oldLineNumber: 4 },
      { type: 'addition', content: 'z', newLineNumber: 4 },
    ]);
    expect(parsePatch(null)).toEqual([]);
  });
});
