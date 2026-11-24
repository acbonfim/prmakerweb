import {
  PmComboOption, addValue, createCandidate, exactOrOnly, filterComboOptions, findOption, foldText, hasValue, highlightParts,
  labelForValue, matchRank, mergeDistinct, removeValue, toggleComboValue
} from './pm-combo.logic';

const opt = (value: string, label = value, extra: Partial<PmComboOption> = {}): PmComboOption => ({ value, label, ...extra });

describe('pm-combo.logic (0099 ajustes 1)', () => {
  it('foldText tira acento, caixa e espaços das pontas', () => {
    expect(foldText('  Ação Rápida ')).toBe('acao rapida');
    expect(foldText(null)).toBe('');
  });

  describe('matchRank / filterComboOptions', () => {
    const people = [
      opt('ana@x.com', 'Ana Souza'),
      opt('alex.carlos@solvace.com', 'Alex Carlos'),
      opt('joao@x.com', 'João Alexandre'),
      opt('maria@x.com', 'Maria', { hint: 'alexia@x.com' }),
      opt('bob@x.com', 'Bob', { keywords: 'qa' }),
    ];

    it('começa com > começo de palavra > contém > dica', () => {
      expect(matchRank(people[1], 'alex')).toBe(0);
      expect(matchRank(people[2], 'alex')).toBe(1);
      expect(matchRank(opt('x', 'Kalexa'), 'alex')).toBe(2);
      expect(matchRank(people[3], 'alex')).toBe(3);
      expect(matchRank(people[0], 'alex')).toBe(-1);
    });

    it('ordena pela nota e mantém a ordem original no empate', () => {
      expect(filterComboOptions(people, 'alex').map((o) => o.label)).toEqual(['Alex Carlos', 'João Alexandre', 'Maria']);
    });

    it('ignora acento e caixa', () => {
      expect(filterComboOptions(people, 'JOAO').map((o) => o.label)).toEqual(['João Alexandre']);
      expect(filterComboOptions([opt('Em análise')], 'analise').length).toBe(1);
    });

    it('várias palavras: todas precisam aparecer (rótulo, dica ou palavras extras)', () => {
      expect(filterComboOptions(people, 'alex car').map((o) => o.label)).toEqual(['Alex Carlos']);
      expect(filterComboOptions(people, 'bob qa').map((o) => o.label)).toEqual(['Bob']);
      expect(filterComboOptions(people, 'ana zzz')).toEqual([]);
    });

    it('sem texto devolve todas (com limite)', () => {
      expect(filterComboOptions(people, '').length).toBe(5);
      expect(filterComboOptions(people, '', 2).length).toBe(2);
    });

    it('caminhos da árvore casam pelo nó', () => {
      const tree = [opt('Proj\\Time A\\Back', 'Proj\\Time A\\Back'), opt('Proj\\Backlog', 'Proj\\Backlog')];
      expect(filterComboOptions(tree, 'back').map((o) => o.value)).toEqual(['Proj\\Time A\\Back', 'Proj\\Backlog']);
    });
  });

  describe('highlightParts', () => {
    it('destaca o trecho digitado preservando acentos', () => {
      expect(highlightParts('João Alexandre', 'joao')).toEqual([
        { text: 'João', match: true }, { text: ' Alexandre', match: false }
      ]);
    });

    it('destaca cada palavra', () => {
      const parts = highlightParts('Alex Carlos', 'car alex');
      expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual(['Alex', 'Car']);
    });

    it('sem texto ou sem ocorrência volta o rótulo inteiro', () => {
      expect(highlightParts('Doing', '')).toEqual([{ text: 'Doing', match: false }]);
      expect(highlightParts('Doing', 'xyz')).toEqual([{ text: 'Doing', match: false }]);
      expect(highlightParts('', 'a')).toEqual([]);
    });
  });

  describe('valor e rótulo', () => {
    const states = [opt('Active'), opt('Closed'), opt('u@x.com', 'Usuário')];

    it('findOption: exato, depois sem caixa/acento', () => {
      expect(findOption(states, 'Active')?.label).toBe('Active');
      expect(findOption(states, 'closed')?.value).toBe('Closed');
      expect(findOption(states, '')).toBeNull();
      expect(findOption(states, 'Novo')).toBeNull();
    });

    it('labelForValue: rótulo, senão o texto de reserva, senão o valor', () => {
      expect(labelForValue(states, 'u@x.com')).toBe('Usuário');
      expect(labelForValue(states, 'z@x.com', 'Zé')).toBe('Zé');
      expect(labelForValue(states, 'z@x.com')).toBe('z@x.com');
      expect(labelForValue(states, null)).toBe('');
    });

    it('exactOrOnly: igual (rótulo ou valor) ou a única que casa', () => {
      expect(exactOrOnly(states, 'active')?.value).toBe('Active');
      expect(exactOrOnly(states, 'usuario')?.value).toBe('u@x.com');
      expect(exactOrOnly(states, 'clo')?.value).toBe('Closed');
      expect(exactOrOnly([opt('Doing'), opt('Done')], 'do')).toBeNull();
      expect(exactOrOnly(states, '')).toBeNull();
    });
  });

  describe('lista múltipla', () => {
    it('inclui sem duplicar (ignora caixa/acento) e não inclui vazio', () => {
      expect(addValue(['Bug'], 'bug')).toEqual(['Bug']);
      expect(addValue(['Bug'], ' Front ')).toEqual(['Bug', 'Front']);
      expect(addValue([], '  ')).toEqual([]);
    });

    it('tira e liga/desliga', () => {
      expect(removeValue(['Expedite', 'Padrão'], 'padrao')).toEqual(['Expedite']);
      expect(toggleComboValue(['a'], 'A')).toEqual([]);
      expect(toggleComboValue(['a'], 'b')).toEqual(['a', 'b']);
      expect(hasValue(['Ação'], 'acao')).toBeTrue();
    });

    it('mergeDistinct junta listas na ordem, sem repetir', () => {
      expect(mergeDistinct(['Mesa', 'gestão'], ['mesa', 'Bug', null, ''], undefined)).toEqual(['Mesa', 'gestão', 'Bug']);
    });
  });

  describe('createCandidate', () => {
    const tags = [opt('Front'), opt('Back')];

    it('oferece criar só quando o texto não existe', () => {
      expect(createCandidate(tags, [], 'nova  tag ')).toBe('nova tag');
      expect(createCandidate(tags, [], 'front')).toBeNull();
      expect(createCandidate(tags, ['Minha'], 'minha')).toBeNull();
      expect(createCandidate(tags, [], '  ')).toBeNull();
    });
  });
});
