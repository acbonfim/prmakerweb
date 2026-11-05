import {
  countFilesByItem,
  filesOfItem,
  WorkItemFile,
  fileIcon,
  fileKindLook,
  fileMeta,
  filePreviewKind,
  fileSizeLabel,
  CASE_FILES_KEY,
  fileSourceChip,
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

describe('0087 — arquivos do card por item', () => {
  const list = [
    f({ id: 'a', workItemNumber: 10 }), f({ id: 'b', workItemNumber: 10, source: 'plan' }),
    f({ id: 'c', workItemNumber: 11 }), f({ id: 'd', workItemNumber: 0, source: 'plan' }), f({ id: 'e' })
  ];

  it('sem filtro devolve todos', () => {
    expect(filesOfItem(list, undefined).length).toBe(5);
    expect(filesOfItem(list, null).length).toBe(5);
  });

  it('filtra pelo item e 0 pega os de plano sem item (e os sem número)', () => {
    expect(filesOfItem(list, 10).map((x) => x.id)).toEqual(['a', 'b']);
    expect(filesOfItem(list, 11).map((x) => x.id)).toEqual(['c']);
    expect(filesOfItem(list, 0).map((x) => x.id)).toEqual(['d', 'e']);
  });

  it('conta os arquivos por item', () => {
    const counts = countFilesByItem(list);
    expect(counts.get(10)).toBe(2);
    expect(counts.get(11)).toBe(1);
    expect(counts.get(0)).toBe(2);
  });

  it('origem dos arquivos do plano: evidência do DevOps e anexo de comentário ganham selo próprio', () => {
    const list = normalizeFiles([
      { id: 'e', name: 'ev01-descricao-image.png', kind: 'image', source: 'plan', origin: 'evidence' },
      { id: 'c', name: 'print.png', kind: 'image', source: 'plan', origin: 'comment' },
      { id: 'p', name: 'analise-us.md', kind: 'analysis', source: 'plan' },
      { id: 'i', name: 'resumo.md', kind: 'text', origin: 'evidence' }
    ]);
    const by = new Map(list.map((x) => [x.id, x]));
    expect(by.get('e')!.origin).toBe('evidence');
    expect(by.get('e')!.kind).toBe('attachment');
    expect(by.get('i')!.origin).toBeNull();           // origem só vale para os do plano
    expect(fileSourceChip(by.get('e')!)!.label).toBe('DevOps');
    expect(fileSourceChip(by.get('c')!)!.label).toBe('comentário');
    expect(fileSourceChip(by.get('p')!)!.label).toBe('plano');
    expect(fileSourceChip(by.get('i')!)).toBeNull();
    expect(fileMeta(by.get('e')!)).toContain('do DevOps');
  });

  it('arquivos da conversa do especialista: origem própria e filtro separado dos planos sem item', () => {
    const list = normalizeFiles([
      { id: 'c1', name: 'print.png', kind: 'attachment', source: 'case', workItemNumber: 0, contentUrl: 'CaseChat/77988/files/c1/content' },
      { id: 'p1', name: 'antiga.md', kind: 'analysis', source: 'plan', workItemNumber: 0 },
      { id: 'i1', name: 'resumo.md', kind: 'text', workItemNumber: 34 }
    ]);
    expect(list.find((x) => x.id === 'c1')!.source).toBe('case');
    expect(filesOfItem(list, CASE_FILES_KEY).map((x) => x.id)).toEqual(['c1']);
    expect(filesOfItem(list, 0).map((x) => x.id)).toEqual(['p1']);
    expect(countFilesByItem(list).get(CASE_FILES_KEY)).toBe(1);
    expect(fileSourceChip(list.find((x) => x.id === 'c1')!)!.label).toBe('especialista');
    expect(resolveFileContentUrl('https://api/api/v1/', 0, list.find((x) => x.id === 'c1')!)).toBe('https://api/api/v1/CaseChat/77988/files/c1/content');
  });
});
