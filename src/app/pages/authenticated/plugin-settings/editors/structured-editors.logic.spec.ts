import { SettingField } from '../plugin-settings.model';
import {
  collapseDiff, diffLines, duplicateRow, extraProps, findVariables, insertAt, mapData, moveItem, newRow,
  normalizeJsLiteral, parseJson, parseMap, parseTable, renderPreview, serializeMap, serializeTable, setCell,
  tableErrors, unknownVariables, validateMap, validateTable,
} from './structured-editors.logic';

function field(partial: Partial<SettingField>): SettingField {
  return {
    id: '1:X', pluginId: 1, pluginName: 'Skills Configurations', key: 'X', label: 'X', type: 'table',
    value: null, hasValue: true, exists: true, isDefault: false, ...partial,
  };
}

const steps = field({
  key: 'AnalysisDefaultSteps',
  columns: [
    { key: 'key', label: 'Chave', type: 'text', required: true },
    { key: 'title', label: 'Título', type: 'text', required: true },
    { key: 'description', label: 'Descrição', type: 'textarea' },
    { key: 'kind', label: 'Tipo', type: 'enum', options: [{ value: '', label: 'Etapa' }, { value: 'question', label: 'Pergunta' }] },
  ],
});

const prices = field({
  key: 'AiModelPricesUsdPerMillion',
  rowKey: 'model',
  columns: [
    { key: 'model', label: 'Modelo', type: 'text', required: true },
    { key: 'input', label: 'Entrada', type: 'number', required: true },
    { key: 'output', label: 'Saída', type: 'number', required: true },
    { key: 'cacheRead', label: 'Cache (leitura)', type: 'number' },
    { key: 'cacheWrite', label: 'Cache (escrita)', type: 'number' },
  ],
});

const branches = field({
  key: 'ActiveBranchs',
  columns: [
    { key: 'label', label: 'Rótulo', type: 'text', required: true },
    { key: 'branchName', label: 'Branch', type: 'text', required: true },
  ],
});

describe('structured-editors.logic (0086/FB)', () => {
  describe('table', () => {
    it('preserva propriedades que não são colunas (ex.: kind desconhecido, extra) ao editar uma célula', () => {
      const value = '[{"key":"a","title":"A","kind":"novo-tipo","extra":{"x":1}},{"key":"b","title":"B"}]';
      const parsed = parseTable(value, steps);
      expect(parsed.ok).toBeTrue();
      expect(parsed.rows.length).toBe(2);
      expect(extraProps(parsed.rows[0], steps)).toEqual(['extra']);

      setCell(parsed.rows[0], steps.columns![1], 'A2');
      const out = JSON.parse(serializeTable(parsed.rows, steps, value));
      expect(out[0]).toEqual({ key: 'a', title: 'A2', kind: 'novo-tipo', extra: { x: 1 } });
      expect(out[1]).toEqual({ key: 'b', title: 'B' });
    });

    it('não reformata quando nada mudou (devolve o texto original), inclusive depois de editar e desfazer', () => {
      const value = '[\n    { "key": "a", "title": "A" }\n]';
      const parsed = parseTable(value, steps);
      expect(serializeTable(parsed.rows, steps, value)).toBe(value);
      setCell(parsed.rows[0], steps.columns![1], 'Outro');
      expect(serializeTable(parsed.rows, steps, value)).not.toBe(value);
      setCell(parsed.rows[0], steps.columns![1], 'A');
      expect(serializeTable(parsed.rows, steps, value)).toBe(value);
    });

    it('grava compacto se o original era numa linha e com 2 espaços se tinha várias linhas', () => {
      const compact = '[{"key":"a","title":"A"}]';
      const rows = parseTable(compact, steps).rows;
      setCell(rows[0], steps.columns![1], 'B');
      expect(serializeTable(rows, steps, compact)).toBe('[{"key":"a","title":"B"}]');

      const pretty = '[\n  {"key":"a","title":"A"}\n]';
      const rows2 = parseTable(pretty, steps).rows;
      setCell(rows2[0], steps.columns![1], 'B');
      expect(serializeTable(rows2, steps, pretty)).toBe('[\n  {\n    "key": "a",\n    "title": "B"\n  }\n]');
    });

    it('coluna opcional vazia não cria a propriedade; a que já existia fica vazia', () => {
      const value = '[{"key":"a","title":"A","description":"texto"}]';
      const rows = parseTable(value, steps).rows;
      setCell(rows[0], steps.columns![3], ''); // kind não existia
      setCell(rows[0], steps.columns![2], ''); // description existia
      expect(JSON.parse(serializeTable(rows, steps, value))[0]).toEqual({ key: 'a', title: 'A', description: '' });
    });

    it('rowKey: objeto {modelo: {…}} ↔ linhas, números como número e propriedades extras preservadas', () => {
      const value = '{"claude-opus":{"input":15,"output":75,"cacheRead":1.5,"tier":"x"},"gpt":{"input":2,"output":8}}';
      const parsed = parseTable(value, prices);
      expect(parsed.ok).toBeTrue();
      expect(parsed.rows.map(r => r.text['model'])).toEqual(['claude-opus', 'gpt']);
      expect(parsed.rows[0].text['cacheRead']).toBe('1.5');

      setCell(parsed.rows[1], prices.columns![1], '2,5');
      setCell(parsed.rows[1], prices.columns![0], 'gpt-5');
      const out = JSON.parse(serializeTable(parsed.rows, prices, value));
      expect(Object.keys(out)).toEqual(['claude-opus', 'gpt-5']);
      expect(out['gpt-5']).toEqual({ input: 2.5, output: 8 });
      expect(out['claude-opus']).toEqual({ input: 15, output: 75, cacheRead: 1.5, tier: 'x' });
      expect(out['gpt-5'].model).toBeUndefined();
    });

    it('rowKey: chave repetida ou vazia é erro; obrigatório vazio e número inválido também', () => {
      const rows = parseTable('{"a":{"input":1,"output":2},"b":{"input":1,"output":2}}', prices).rows;
      expect(validateTable(rows, prices)).toBeNull();
      setCell(rows[1], prices.columns![0], 'a');
      expect(validateTable(rows, prices)).toContain('repetida');
      setCell(rows[1], prices.columns![0], '');
      expect(validateTable(rows, prices)).toContain('Modelo');
      setCell(rows[1], prices.columns![0], 'b');
      setCell(rows[1], prices.columns![1], 'abc');
      const errors = tableErrors(rows, prices);
      expect(errors).toEqual([{ row: 1, column: 'input', message: 'Linha 2: "Entrada" deve ser um número.' }]);
    });

    it('duplicar com rowKey cria chave nova; linha nova traz só os obrigatórios', () => {
      const rows = parseTable('{"a":{"input":1,"output":2}}', prices).rows;
      const copy = duplicateRow(rows[0], rows, prices);
      expect(copy.data['model']).toBe('a-copia');
      expect(copy.data).not.toBe(rows[0].data);
      expect(Object.keys(newRow(steps).data)).toEqual(['key', 'title']);
    });

    it('valor literal JS (ActiveBranchs) é lido pela normalização e marcado', () => {
      const value = "[{label:'Dev', branchName:'development'},]";
      const parsed = parseTable(value, branches);
      expect(parsed.ok).toBeTrue();
      expect(parsed.normalized).toBeTrue();
      expect(parsed.rows[0].data).toEqual({ label: 'Dev', branchName: 'development' });
      // Sem mudança: o literal original volta intacto.
      expect(serializeTable(parsed.rows, branches, value)).toBe(value);
      // Com mudança: vira JSON estrito.
      setCell(parsed.rows[0], branches.columns![0], 'Desenvolvimento');
      expect(serializeTable(parsed.rows, branches, value)).toBe('[{"label":"Desenvolvimento","branchName":"development"}]');
    });

    it('raiz errada ou JSON ilegível é erro (o editor cai no modo JSON); vazio = tabela vazia', () => {
      expect(parseTable('{"a":1}', steps).ok).toBeFalse();
      expect(parseTable('[1,2]', steps).error).toContain('linha 1');
      expect(parseTable('[{"a":', steps).ok).toBeFalse();
      expect(parseTable('[]', prices).ok).toBeFalse();
      expect(parseTable('', steps)).toEqual({ ok: true, rows: [], normalized: false });
    });

    it('moveItem reordena sem mexer na lista original', () => {
      const list = ['a', 'b', 'c'];
      expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a']);
      expect(moveItem(list, 2, 1)).toEqual(['a', 'c', 'b']);
      expect(moveItem(list, 0, 5)).toEqual(list);
      expect(list).toEqual(['a', 'b', 'c']);
    });
  });

  describe('map', () => {
    const suffix = field({ type: 'map', key: 'BranchSuffixByTarget', mapKeyLabel: 'Destino', mapValueLabel: 'Sufixo', mapValueType: 'text' });
    const supersedes = field({ type: 'map', key: 'ReverseEngineeringSupersedes', mapValueType: 'list' });

    it('texto: objeto ↔ pares, sem reformatar quando nada mudou', () => {
      const value = '{"development":"-dev","qa":"-qa"}';
      const parsed = parseMap(value, suffix);
      expect(parsed.entries.map(e => [e.key, e.text])).toEqual([['development', '-dev'], ['qa', '-qa']]);
      expect(serializeMap(parsed.entries, suffix, value)).toBe(value);
      parsed.entries[1].text = '-q';
      expect(serializeMap(parsed.entries, suffix, value)).toBe('{"development":"-dev","qa":"-q"}');
    });

    it('lista: arrays de textos ↔ "a, b"', () => {
      const value = '{"Arquitetura":["arquitetura","spec-arquitetura"],"Visão":[]}';
      const parsed = parseMap(value, supersedes);
      expect(parsed.ok).toBeTrue();
      expect(parsed.entries[0].text).toBe('arquitetura, spec-arquitetura');
      parsed.entries[1].text = ' visao ,, pratica ';
      expect(mapData(parsed.entries, supersedes)).toEqual({ Arquitetura: ['arquitetura', 'spec-arquitetura'], 'Visão': ['visao', 'pratica'] });
      expect(parseMap('{"a":"texto"}', supersedes).ok).toBeFalse();
      expect(parseMap('{"a":{"b":1}}', suffix).ok).toBeFalse();
    });

    it('chave vazia ou repetida é erro (com o rótulo da chave)', () => {
      const parsed = parseMap('{"a":"1","b":"2"}', suffix);
      expect(validateMap(parsed.entries, suffix)).toBeNull();
      parsed.entries[1].key = 'a ';
      expect(validateMap(parsed.entries, suffix)).toBe('Linha 2: "a" está repetida.');
      parsed.entries[1].key = ' ';
      expect(validateMap(parsed.entries, suffix)).toBe('Linha 2: preencha "Destino".');
    });
  });

  describe('normalizeJsLiteral', () => {
    it('converte o literal do ActiveBranchs (aspas simples, chaves sem aspas, vírgula final)', () => {
      const out = normalizeJsLiteral("[{label:'Dev', branchName:'development'},]");
      expect(out).not.toBeNull();
      expect(JSON.parse(out!)).toEqual([{ label: 'Dev', branchName: 'development' }]);
    });

    it('trata aspas dentro de textos, comentários, ponto e vírgula final e várias linhas', () => {
      const src = "[\n  // ramo principal\n  { label: 'Main \"x\"', branchName: 'it\\'s', n: 1, ok: true, },\n  /* fim */\n];";
      expect(JSON.parse(normalizeJsLiteral(src)!)).toEqual([{ label: 'Main "x"', branchName: "it's", n: 1, ok: true }]);
    });

    it('não estraga JSON válido e devolve null quando não há conserto', () => {
      expect(JSON.parse(normalizeJsLiteral('{"a": [1, 2]}')!)).toEqual({ a: [1, 2] });
      expect(normalizeJsLiteral("[{label: 'aberto}]")).toBeNull();
      expect(normalizeJsLiteral('[{a: b c}]')).toBeNull();
      expect(normalizeJsLiteral('')).toBeNull();
    });
  });

  describe('json', () => {
    it('erro com linha e coluna', () => {
      const r = parseJson('{\n  "a": 1,\n  "b": \n}');
      expect(r.ok).toBeFalse();
      expect(r.line).toBe(4);
      expect(r.error).toContain('linha 4');
    });
  });

  describe('variáveis', () => {
    const vars = [
      { name: 'card', description: 'número do card', example: '77434' },
      { name: 'summary', description: 'resumo', example: 'corrige X' },
      { name: 'suffix', description: 'sufixo do destino', example: '-dev' },
    ];

    it('acha {nome} e {nome:arg}; ignora JSON e {{ }}', () => {
      expect(findVariables('AB#{card} {summary}').map(v => v.name)).toEqual(['card', 'summary']);
      expect(findVariables('{suffix:qa} {"a": 1} {{card}}').map(v => v.token)).toEqual(['{suffix:qa}']);
    });

    it('avisa variável desconhecida ({suffix:x} conta como conhecida se suffix estiver na lista)', () => {
      expect(unknownVariables('AB#{card} {TARGET} {suffix:qa} {Card} {TARGET}', vars)).toEqual(['{TARGET}']);
      expect(unknownVariables('{qualquer}', [])).toEqual([]);
    });

    it('prévia substitui pelo exemplo e marca a variável', () => {
      const parts = renderPreview('AB#{card} {summary}{suffix:qa} {x}', vars);
      expect(parts.map(p => p.text).join('')).toBe('AB#77434 corrige X-dev {x}');
      expect(parts.filter(p => p.variable).map(p => p.variable)).toEqual(['card', 'summary', 'suffix']);
    });

    it('insere no cursor (substituindo a seleção)', () => {
      expect(insertAt('hotfix/', 7, 7, '{card}')).toEqual({ text: 'hotfix/{card}', caret: 13 });
      expect(insertAt('a XX b', 2, 4, '{card}')).toEqual({ text: 'a {card} b', caret: 8 });
    });
  });

  describe('diff por linhas', () => {
    it('marca linhas iguais, adicionadas e removidas com a numeração de cada lado', () => {
      const d = diffLines('a\nb\nc\nd', 'a\nB\nc\nd\ne');
      expect(d.map(l => `${l.type}:${l.text}`)).toEqual(['same:a', 'del:b', 'add:B', 'same:c', 'same:d', 'add:e']);
      expect(d[2].newLine).toBe(2);
      expect(d[5].newLine).toBe(5);
      expect(d[1].oldLine).toBe(2);
    });

    it('textos iguais não têm mudança; recolhe trechos iguais longos', () => {
      expect(diffLines('x\ny', 'x\ny').every(l => l.type === 'same')).toBeTrue();
      const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
      const after = before.replace('l10', 'L10');
      const collapsed = collapseDiff(diffLines(before, after), 2);
      expect(collapsed.map(l => l.type)).toEqual(['skip', 'same', 'same', 'del', 'add', 'same', 'same', 'skip']);
      expect(collapsed[0].text).toBe('8 linhas iguais');
    });
  });
});
