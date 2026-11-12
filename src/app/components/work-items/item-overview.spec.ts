import { briefMarkdown, docLabel, hasRichOverview, isEditableText, itemCode, itemDocuments, itemImages, overviewFileName, parseItemBrief, pickItemDocument, resultHeadline, stepTitle, titleSeverity } from './item-overview';
import { WorkItemFile } from './work-item-files';

/** Descrição real do item #96 do card 78161 (formato antigo do especialista, sem acento). */
const LEGACY_96 = [
  '**O que sera feito:** analise aprofundada (somente leitura, nada e alterado) do achado GS-001 (RCA, Critica, esforco P, confianca alta), terminando em decisao: corrigir no legado, no revamp, em ambos ou descartar.',
  '**Achado (resumo):** uploadFroala.asp nao inclui inc_auth.asp; upFolder, upPlant, upFileType e o nome do arquivo vem do multipart.',
  '**Impacto:** envio anonimo de .asp para pasta publicada do IIS = execucao remota de codigo no legado.',
  '**Onde (a confirmar em origin/master, fotografias na sub-tarefa 3):** arquivo uploadFroala.asp, repo edv-solvace.',
  '**Itens da Base Solvace:** edv-solvace#GAP-531, edv-solvace#GAP-1344, edv-solvace#GAP-909.',
  '**Proposta inicial (a validar):** remover uploadFroala.asp do deploy (sem chamadores).',
  "**Criterios de aceite:** POST anonimo retorna 401/404 e nada e gravado; nenhum upload aceita .asp/.aspx/.config/.exe; '..' e '\\' sao rejeitados.",
  '**Regras:** apenas analise; nao explorar em ambiente; nunca copiar valores de segredos.'
].join('\n\n');

const file = (name: string, taskNumber: number | null, kind = 'analysis', extra: Partial<WorkItemFile> = {}): WorkItemFile =>
  ({ id: name, name, kind, source: 'item', taskNumber, ...extra } as WorkItemFile);

describe('item-overview (card 78161)', () => {
  it('tira a gravidade do título e devolve o selo', () => {
    const r = titleSeverity('GS-001 — [Crítica] uploadFroala.asp grava arquivo de qualquer tipo');
    expect(r.severity).toEqual({ severity: 'critical', label: 'Crítica' });
    expect(r.title).toBe('GS-001 — uploadFroala.asp grava arquivo de qualquer tipo');
    expect(titleSeverity('GS-064 — [Media] Relatório').severity?.label).toBe('Média');
    expect(titleSeverity('Abrir PR para release').severity).toBeNull();
  });

  it('formato antigo: para que serve em destaque e a ficha com resumo, seções e regras', () => {
    const b = parseItemBrief(LEGACY_96);
    expect(b.legacy).toBeTrue();
    expect(b.purpose).toContain('analise aprofundada');
    expect(b.body).toContain('> [!SUMMARY]');
    expect(b.body).toContain('> **Problema:** uploadFroala.asp');
    expect(b.body).toContain('> **Impacto:** envio anonimo');
    expect(b.body).toContain('> **Proposta inicial (a validar):** remover');
    expect(b.body).toContain('### Onde\narquivo uploadFroala.asp');
    expect(b.body).toContain('*A confirmar em origin/master, fotografias na sub-tarefa 3.*');
    expect(b.body).toContain('### Base Solvace\nedv-solvace#GAP-531');
    expect(b.body).toContain('### Critérios de aceite\n- POST anonimo retorna 401/404 e nada e gravado\n- nenhum upload');
    expect(b.body).toMatch(/> \[!WARNING\]\n> \*\*Regras:\*\* apenas analise/);
    expect(b.body!.indexOf('[!SUMMARY]')).toBeLessThan(b.body!.indexOf('### Onde'));
  });

  it('descrição nova em markdown: usa a seção Para que serve e mantém o resto', () => {
    const b = parseItemBrief('## Para que serve\nAnalisar o GS-002 e decidir.\n\n> [!SUMMARY]\n> **Problema:** x\n\n## Onde\n`a.cs:1-2`');
    expect(b.legacy).toBeFalse();
    expect(b.purpose).toBe('Analisar o GS-002 e decidir.');
    expect(b.body).toBe('> [!SUMMARY]\n> **Problema:** x\n\n## Onde\n`a.cs:1-2`');
  });

  it('descrição comum continua igual (sem para que serve)', () => {
    expect(parseItemBrief('Abrir o PR da hotfix/77434 para a release.')).toEqual({ purpose: null, body: 'Abrir o PR da hotfix/77434 para a release.', legacy: false });
    expect(parseItemBrief('**Atenção:** só um parágrafo.').legacy).toBeFalse();
    expect(parseItemBrief(null)).toEqual({ purpose: null, body: null, legacy: false });
  });

  it('manchete do resultado: o negrito do começo ou a primeira frase', () => {
    expect(resultHeadline('**Legado: persiste.** `edv-solvace:a.asp:1-53` @ origin/master')).toBe('**Legado: persiste.**');
    expect(resultHeadline('Caso GS-001 lido (anexo parte-01, achados.json, README). `uploadFroala.asp` sem login.'))
      .toBe('Caso GS-001 lido (anexo parte-01, achados.json, README).');
    expect(resultHeadline('Veja `a.b.c` e o resto do texto que continua sem ponto final')).toBe('Veja `a.b.c` e o resto do texto que continua sem ponto final');
    expect(resultHeadline('')).toBeNull();
  });

  it('títulos das etapas sem número nem o código do item', () => {
    expect(itemCode('GS-002 — [Crítica] Gestão de usuários')).toBe('GS-002');
    expect(stepTitle('3. Analisar a fundo no codigo (GS-002)', 'GS-002')).toBe('Analisar a fundo no codigo');
    expect(stepTitle('4. Reproduzir o problema em sandboxefeso (GS-002) — OBRIGATORIO, com sequencia de prints', 'GS-002'))
      .toBe('Reproduzir o problema em sandboxefeso');
  });

  it('documentos do item: visão geral primeiro, depois pela ordem das sub-tarefas; nunca os anexos do card', () => {
    const tasks = [{ number: 97, order: 1 }, { number: 98, order: 2 }, { number: 101, order: 5 }];
    const files = [
      file('ev-94f7a6-anexo-78161-itens-parte-01.md', null, 'attachment'),
      file('05-proposta-GS-001.md', 101),
      file('01-resumo-do-caso-GS-001.md', 97),
      file('02-engenharia-reversa-GS-001.md', 98),
      file('analise-inicial.md', 97, 'analysis', { source: 'plan' }),
      file('print.jpg', 98, 'evidence', { contentType: 'image/jpeg' })
    ];
    const docs = itemDocuments(files, tasks);
    expect(docs.map((d) => d.name)).toEqual(['01-resumo-do-caso-GS-001.md', '02-engenharia-reversa-GS-001.md', '05-proposta-GS-001.md']);
    expect(pickItemDocument(docs)?.name).toBe('05-proposta-GS-001.md');
    const withOverview = itemDocuments([...files, file('00-visao-geral-GS-001.md', null)], tasks);
    expect(withOverview[0].name).toBe('00-visao-geral-GS-001.md');
    expect(pickItemDocument(withOverview)?.name).toBe('00-visao-geral-GS-001.md');
    expect(itemImages(files).map((f) => f.name)).toEqual(['print.jpg']);
  });

  it('rótulos dos documentos', () => {
    expect(docLabel('05-proposta-GS-001.md', 'GS-001')).toBe('Proposta');
    expect(docLabel('02-engenharia-reversa-GS-001.md', 'GS-001')).toBe('Engenharia reversa');
    expect(docLabel('gs-104-codigo.md', 'GS-104')).toBe('Código');
    expect(docLabel('GS-018-proposta-de-solucao.md', 'GS-018')).toBe('Proposta de solução');
    expect(docLabel('04-reproducao-sandboxefeso-GS-001.md', 'GS-001')).toBe('Reprodução sandboxefeso');
    expect(docLabel('00-visao-geral-GS-001.md', 'GS-001')).toBe('Visão geral');
  });

  it('visão rica só quando há o que mostrar', () => {
    const plain = parseItemBrief('Abrir o PR.');
    expect(hasRichOverview({ tasks: [] } as any, plain, [])).toBeFalse();
    expect(hasRichOverview({ tasks: [] } as any, parseItemBrief(LEGACY_96), [])).toBeTrue();
    expect(hasRichOverview({ tasks: [{ result: 'PR aberto.' }] } as any, plain, [])).toBeTrue();
  });
});

describe('item-overview — rótulos na mesma linha', () => {
  it('separa **Modulos:** e **Base Solvace:** colados e não corta a manchete em dois-pontos', () => {
    const b = parseItemBrief('**O que sera feito:** analisar.\n\n**Achado:** x.\n\n**Modulos:** legado-moc, revamp-users. **Base Solvace:** legado-moc#GAP-267.');
    expect(b.body).toContain('### Módulos\nlegado-moc, revamp-users.');
    expect(b.body).toContain('### Base Solvace\nlegado-moc#GAP-267.');
    expect(resultHeadline('Base Solvace consultada: GAP-531 e GAP-909 confirmam o achado. Mais texto.'))
      .toBe('Base Solvace consultada: GAP-531 e GAP-909 confirmam o achado.');
  });
});

describe('item-overview — manchetes e rótulos do #738', () => {
  it('negrito com itálico dentro e negrito aberto não vazam **', () => {
    expect(resultHeadline('**Encerrado como improcedente por decisão de Alex (opção 3 do *Já resolvi*).** Resto.'))
      .toBe('**Encerrado como improcedente por decisão de Alex (opção 3 do *Já resolvi*).**');
    expect(resultHeadline('**Encerrado como improcedente por decisão de Alex (opção 3 do *Já resolvi*). Sem fechar'))
      .toBe('Encerrado como improcedente por decisão de Alex (opção 3 do *Já resolvi*).');
  });

  it('Por que existe vira o para que serve e Entregável ganha seção', () => {
    const b = parseItemBrief('**Por que existe:** refazer a reprodução.\n\n**Achado GS-018:** apaga donos.\n\n**Entregavel:** sequencia de prints.');
    expect(b.purpose).toBe('refazer a reprodução.');
    expect(b.body).toContain('### Entregável\nsequencia de prints.');
  });
});

describe('item-overview — visão geral como arquivo', () => {
  it('nome do arquivo pelo código do item e prévia a partir da ficha', () => {
    expect(overviewFileName({ title: 'GS-002 — [Crítica] Gestão', number: 102 })).toBe('00-visao-geral-GS-002.md');
    expect(overviewFileName({ title: 'Abrir PR', number: 7 })).toBe('00-visao-geral-item-7.md');
    const md = briefMarkdown(parseItemBrief('## Para que serve\nAnalisar.\n\n> [!SUMMARY]\n> **Problema:** x'), 'GS-002 — Gestão')!;
    expect(md).toBe('**GS-002 — Gestão**\n\n## Para que serve\nAnalisar.\n\n> [!SUMMARY]\n> **Problema:** x');
    expect(briefMarkdown(parseItemBrief(null))).toBeNull();
    expect(isEditableText({ name: '05-proposta.md' })).toBeTrue();
    expect(isEditableText({ name: 'print.jpg', contentType: 'image/jpeg' })).toBeFalse();
  });
});
