import {
  WorkItemFile,
  fileIcon,
  fileKindLook,
  fileMeta,
  filePreviewKind,
  fileSizeLabel,
  fileTextAsMarkdown,
  filesCountLabel,
  filesOfTask,
  groupFiles,
  guessUploadKind,
  isFilesEvent,
  isTextFile,
  normalizeFileKind,
  normalizeFiles,
  resolveFileContentUrl
} from './work-item-files';

const f = (p: Partial<WorkItemFile>): WorkItemFile => ({ id: '1', name: 'a.md', kind: 'analysis', ...p } as WorkItemFile);

describe('0085 r5 — arquivos do item', () => {
  it('normaliza: kind desconhecido vira anexo, sem id/nome some, repetido some, mais novo primeiro', () => {
    const list = normalizeFiles([
      { id: 1, name: 'velho.sql', kind: 'script', createdAt: '2026-11-01T10:00:00' },
      { id: 2, name: 'print.png', kind: 'image', createdAt: '2026-11-03T10:00:00' },
      { id: 3, name: ' ', kind: 'text' },
      { id: 1, name: 'velho.sql', kind: 'script' },
      { id: 1, name: 'do-plano.md', kind: 'analysis', source: 'plan', createdAt: '2026-11-02T10:00:00' },
      { name: 'sem-id.txt' }
    ]);
    expect(list.map((x) => `${x.source}:${x.id}:${x.kind}`)).toEqual(['item:2:attachment', 'plan:1:analysis', 'item:1:script']);
    expect(normalizeFiles({ files: [{ id: 'x', name: 'c.md', kind: 'ticket' }] })[0].kind).toBe('ticket');
    expect(normalizeFiles(null)).toEqual([]);
    expect(normalizeFileKind('TICKET')).toBe('ticket');
  });

  it('agrupa na ordem Chamados, Scripts, Análises, Dados, Textos, Anexos (sem grupos vazios)', () => {
    const groups = groupFiles([
      f({ id: 'a', kind: 'attachment', name: 'x.pdf' }),
      f({ id: 'b', kind: 'script', name: 'fix.sql' }),
      f({ id: 'c', kind: 'ticket', name: 'chamado.md' }),
      f({ id: 'd', kind: 'script', name: 'rollback.sql' }),
      f({ id: 'e', kind: 'data', name: 'antes.csv' })
    ]);
    expect(groups.map((g) => `${g.look.group}:${g.files.length}`)).toEqual(['Chamados:1', 'Scripts:2', 'Dados:1', 'Anexos:1']);
  });

  it('filtra pela sub-tarefa', () => {
    const all = [f({ id: 'a', taskNumber: 12 }), f({ id: 'b', taskNumber: 13 }), f({ id: 'c' })];
    expect(filesOfTask(all, 12).map((x) => x.id)).toEqual(['a']);
    expect(filesOfTask(all, null).length).toBe(3);
  });

  it('rótulos: contagem, tamanho, linha de detalhes e ícones', () => {
    expect(filesCountLabel(0)).toBe('Nenhum arquivo');
    expect(filesCountLabel(1)).toBe('1 arquivo');
    expect(filesCountLabel(3)).toBe('3 arquivos');
    expect(fileSizeLabel(512)).toBe('512 B');
    expect(fileSizeLabel(2048)).toBe('2.0 KB');
    expect(fileSizeLabel(null)).toBe('');
    expect(fileMeta(f({ size: 2048, taskNumber: 7, source: 'plan' }), (n) => `#${n}`)).toBe('2.0 KB · sub-tarefa #7 · do plano');
    expect(fileKindLook('ticket').label).toBe('Chamado');
    expect(fileKindLook('whatever').group).toBe('Anexos');
    expect(fileIcon(f({ kind: 'attachment', name: 'print.png' }))).toBe('image');
    expect(fileIcon(f({ kind: 'script', name: 'x.sql' }))).toBe('code');
  });

  it('prévia: markdown, código, JSON, imagem; chamado sem extensão é markdown; binário só baixa', () => {
    expect(filePreviewKind(f({ name: 'chamado.md', kind: 'ticket' }))).toBe('markdown');
    expect(filePreviewKind(f({ name: 'Chamado 77988', kind: 'ticket' }))).toBe('markdown');
    expect(filePreviewKind(f({ name: 'fix.sql', kind: 'script' }))).toBe('code');
    expect(filePreviewKind(f({ name: 'saida.json', kind: 'data' }))).toBe('json');
    expect(filePreviewKind(f({ name: 'x', kind: 'attachment', contentType: 'image/png' }))).toBe('image');
    expect(filePreviewKind(f({ name: 'planilha.xlsx', kind: 'data' }))).toBe('none');
    expect(isTextFile(f({ name: 'fix.sql' }))).toBeTrue();
    expect(isTextFile(f({ name: 'planilha.xlsx' }))).toBeFalse();
  });

  it('texto vira markdown para o visualizador (código cercado com a linguagem)', () => {
    expect(fileTextAsMarkdown(f({ name: 'a.md' }), '# Oi')).toBe('# Oi');
    expect(fileTextAsMarkdown(f({ name: 'fix.sql' }), 'select 1;\n')).toBe('```sql\nselect 1;\n```');
    expect(fileTextAsMarkdown(f({ name: 'x.json' }), '{"a":1}')).toBe('```json\n{\n  "a": 1\n}\n```');
    expect(fileTextAsMarkdown(f({ name: 'x.sh' }), 'echo "```"')).toBe('~~~~bash\necho "```"\n~~~~');
  });

  it('URL do conteúdo: do item, relativa à API, com /api/ e absoluta', () => {
    const api = 'https://api.x.com/api/v1/';
    expect(resolveFileContentUrl(api, 41, { id: 'a b' })).toBe('https://api.x.com/api/v1/WorkItems/41/files/a%20b/content');
    expect(resolveFileContentUrl(api, 41, { id: '1', contentUrl: 'ExecutionPlan/p/artifacts/9/content' })).toBe('https://api.x.com/api/v1/ExecutionPlan/p/artifacts/9/content');
    expect(resolveFileContentUrl(api, 41, { id: '1', contentUrl: '/api/v1/ExecutionPlan/p/artifacts/9/content' })).toBe('https://api.x.com/api/v1/ExecutionPlan/p/artifacts/9/content');
    expect(resolveFileContentUrl(api, 41, { id: '1', contentUrl: 'https://cdn/x' })).toBe('https://cdn/x');
  });

  it('tempo real: action file do item recarrega; de outro item não', () => {
    expect(isFilesEvent(null, 5)).toBeTrue();
    expect(isFilesEvent({ action: 'file', number: 5 }, 5)).toBeTrue();
    expect(isFilesEvent({ action: 'file', number: 6 }, 5)).toBeFalse();
    expect(isFilesEvent({ action: 'activity', number: 5 }, 5)).toBeFalse();
  });

  it('kind sugerido no upload', () => {
    expect(guessUploadKind('fix.sql')).toBe('script');
    expect(guessUploadKind('dados.csv')).toBe('data');
    expect(guessUploadKind('chamado-77988.md')).toBe('ticket');
    expect(guessUploadKind('print.png', 'image/png')).toBe('attachment');
  });
});
