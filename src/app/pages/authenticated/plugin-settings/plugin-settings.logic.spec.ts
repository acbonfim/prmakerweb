import {
  buildChanges, collapseDiff, currentValue, formatBool, formatList, lineDiff, matchesSearch, normalizeNumber, parseBool,
  parseList, sameValue, stepKnown, stepsFrom,
} from './plugin-settings.logic';
import { settingsFixture } from './plugin-settings.fixture';
import { SettingField } from './plugin-settings.model';

function fieldOf(key: string): SettingField {
  const all = settingsFixture().sections.flatMap(s => s.groups.flatMap(g => g.fields));
  const f = all.find(x => x.key === key);
  if (!f) throw new Error(`fixture sem ${key}`);
  return f;
}

describe('plugin-settings.logic (0086)', () => {
  describe('formato gravado', () => {
    it('list csv: lê com espaços e grava unido por vírgula sem espaço', () => {
      expect(parseList(' qa , qa-* ,,', 'csv').items).toEqual(['qa', 'qa-*']);
      expect(formatList(['qa', ' release ', ''], 'csv')).toBe('qa,release');
      expect(parseList('', 'csv').items).toEqual([]);
    });

    it('list json: lê array e grava array JSON compacto', () => {
      expect(parseList('["id", "nome"]', 'json').items).toEqual(['id', 'nome']);
      expect(formatList(['id', 'nome'], 'json')).toBe('["id","nome"]');
      expect(formatList([], 'json')).toBe('[]');
    });

    it('list json inválido ou que não é lista: erro sem perder o texto', () => {
      expect(parseList('["id",', 'json').error).toContain('JSON');
      expect(parseList('{"a":1}', 'json').error).toContain('lista');
    });

    it('bool: "true"/"false" (lê True e 1)', () => {
      expect(parseBool('True')).toBeTrue();
      expect(parseBool('1')).toBeTrue();
      expect(parseBool('false')).toBeFalse();
      expect(parseBool('')).toBeFalse();
      expect(formatBool(true)).toBe('true');
      expect(formatBool(false)).toBe('false');
    });

    it('number: invariante (vírgula vira ponto) e faixa', () => {
      expect(normalizeNumber('0,9', 0, 1)).toEqual({ value: '0.9', error: null });
      expect(normalizeNumber(' 420 ')).toEqual({ value: '420', error: null });
      expect(normalizeNumber('11', 1, 10).error).toBe('Máximo 10.');
      expect(normalizeNumber('0', 1, 10).error).toBe('Mínimo 1.');
      expect(normalizeNumber('abc').error).toBe('Número inválido.');
      expect(normalizeNumber('').error).toBe('Informe um número.');
    });

    it('sameValue compara JSON normalizado', () => {
      expect(sameValue('{"a": 1, "b": [1,2]}', '{"a":1,"b":[1,2]}')).toBeTrue();
      expect(sameValue('a', 'b')).toBeFalse();
      expect(sameValue(null, '')).toBeTrue();
    });
  });

  describe('PATCH', () => {
    it('monta só os campos alterados com expected = valor lido', () => {
      const org = fieldOf('Organization');
      const ver = fieldOf('ApiVersion');
      const changes = buildChanges([org, ver], { [org.id]: { value: 'nova' } });
      expect(changes).toEqual([{ pluginId: 8, key: 'Organization', value: 'nova', expected: 'solvace', remove: false }]);
    });

    it('chave inexistente → expected null; remover → value null e remove', () => {
      const missing = fieldOf('SituationPostToDevOps');
      const obsolete = fieldOf('ExecutorNoteDelaySeconds');
      const changes = buildChanges([missing, obsolete], {
        [missing.id]: { value: 'true', create: true },
        [obsolete.id]: { value: '', remove: true },
      });
      expect(changes[0]).toEqual({ pluginId: 10, key: 'SituationPostToDevOps', value: 'true', expected: null, remove: false });
      expect(changes[1]).toEqual({ pluginId: 10, key: 'ExecutorNoteDelaySeconds', value: null, expected: '120', remove: true });
    });

    it('campo de plugin inexistente nunca vai no PATCH', () => {
      const orphan = fieldOf('Model');
      expect(buildChanges([orphan], { [orphan.id]: { value: 'gpt' } })).toEqual([]);
    });

    it('valor em edição: segredo vazio, inexistente mostra o padrão', () => {
      expect(currentValue(fieldOf('PersonalAccessToken'), undefined)).toBe('');
      expect(currentValue(fieldOf('SituationPostToDevOps'), undefined)).toBe('true');
      expect(currentValue(fieldOf('Organization'), { value: 'x' })).toBe('x');
    });
  });

  describe('busca', () => {
    it('casa rótulo, chave, ajuda e valor sem acento/caixa', () => {
      const org = fieldOf('Organization');
      expect(matchesSearch(org, 'solvace', 'organizacao')).toBeTrue();
      expect(matchesSearch(org, 'solvace', 'ORGANIZATION')).toBeTrue();
      expect(matchesSearch(org, 'solvace', 'dev.azure')).toBeTrue();
      expect(matchesSearch(org, 'solvace', 'solv')).toBeTrue();
      expect(matchesSearch(org, 'solvace', 'branch')).toBeFalse();
    });

    it('segredo nunca casa pelo valor', () => {
      expect(matchesSearch(fieldOf('PersonalAccessToken'), 'abc123', 'abc123')).toBeFalse();
    });
  });

  describe('etapas', () => {
    it('lê as chaves de uma lista de etapas e aceita prefixo-*', () => {
      const steps = stepsFrom(fieldOf('AnalysisDefaultSteps').value);
      expect(steps.map(s => s.key)).toContain('montar-analise');
      expect(stepKnown('corrigir-*', steps)).toBeTrue();
      expect(stepKnown('montar-analise', steps)).toBeTrue();
      expect(stepKnown('inexistente', steps)).toBeFalse();
      expect(stepsFrom('lixo')).toEqual([]);
    });
  });

  describe('diff por linhas', () => {
    it('marca incluídas e removidas', () => {
      const d = lineDiff('a\nb\nc', 'a\nB\nc\nd');
      expect(d).toEqual([
        { type: 'same', text: 'a' },
        { type: 'del', text: 'b' },
        { type: 'add', text: 'B' },
        { type: 'same', text: 'c' },
        { type: 'add', text: 'd' },
      ]);
    });

    it('antes inexistente: tudo incluído', () => {
      expect(lineDiff(null, 'x\ny').map(l => l.type)).toEqual(['add', 'add']);
      expect(lineDiff('x', '').map(l => l.type)).toEqual(['del']);
    });

    it('recolhe trechos iguais longos', () => {
      const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
      const after = before.replace('l10', 'L10');
      const c = collapseDiff(lineDiff(before, after), 2);
      expect(c[0]).toEqual({ type: 'skip', text: '8 linha(s) igual(is)' });
      expect(c.filter(l => l.type !== 'skip').length).toBe(6);
      expect(c[c.length - 1].type).toBe('skip');
    });
  });
});
