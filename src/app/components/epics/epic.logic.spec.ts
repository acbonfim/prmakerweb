import {
  EpicCard, EpicSummary, countByStatusFilter, epicCardRoleLook, epicColor, epicKey, epicStatusLook, filterEpics, isEpicKey,
  matchesEpicQuery, matchesStatus, normalizeTags, parseCardId, parseDeskTab, parseEpicKey, parseEpicNumber, sortEpicCards
} from './epic.logic';

function epic(number: number, title: string, status: EpicSummary['status'] = 'active', extra: Partial<EpicSummary> = {}): EpicSummary {
  return {
    id: `id-${number}`, number, key: `E${number}`, title, status, color: null, tags: [], createdByName: 'Ana',
    createdAt: '2026-11-20T10:00:00', updatedAt: '2026-11-20T10:00:00', counts: { cards: 0, items: 0, openItems: 0 },
    ...extra
  };
}

describe('epic.logic (0099/F1)', () => {
  describe('chave do épico', () => {
    it('número → E{n}; inválido → null', () => {
      expect(epicKey(1234)).toBe('E1234');
      expect(epicKey(0)).toBeNull();
      expect(epicKey(null)).toBeNull();
      expect(epicKey(Number.NaN)).toBeNull();
    });

    it('E{n} → número (ignora caixa e espaços); card numérico não é épico', () => {
      expect(parseEpicKey('E1234')).toBe(1234);
      expect(parseEpicKey(' e7 ')).toBe(7);
      expect(parseEpicKey('1234')).toBeNull();
      expect(parseEpicKey('E')).toBeNull();
      expect(parseEpicKey('E0')).toBeNull();
      expect(isEpicKey('E12')).toBeTrue();
      expect(isEpicKey('78720')).toBeFalse();
    });

    it('número da URL aceita 12, #12 e E12', () => {
      expect(parseEpicNumber('12')).toBe(12);
      expect(parseEpicNumber('#12')).toBe(12);
      expect(parseEpicNumber('E12')).toBe(12);
      expect(parseEpicNumber(12)).toBe(12);
      expect(parseEpicNumber('abc')).toBeNull();
      expect(parseEpicNumber('')).toBeNull();
      expect(parseEpicNumber(null)).toBeNull();
      expect(parseEpicNumber(-3)).toBeNull();
    });

    it('id de card digitado', () => {
      expect(parseCardId('#78720')).toBe('78720');
      expect(parseCardId(' 0042 ')).toBe('42');
      expect(parseCardId('E12')).toBeNull();
      expect(parseCardId('')).toBeNull();
    });
  });

  describe('filtros do trilho', () => {
    const list = [
      epic(10, 'Relatório de bugs de novembro', 'active', { tags: ['Relatórios'], devOpsTeam: 'Time Azul' }),
      epic(11, 'Duplicados do módulo de ações', 'paused'),
      epic(12, 'Entendimento das histórias de 5S', 'done', { tags: ['5S'] }),
      epic(130, 'Arquivo morto', 'archived')
    ];

    it('abertos = ativos + pausados', () => {
      expect(matchesStatus('active', 'open')).toBeTrue();
      expect(matchesStatus('paused', 'open')).toBeTrue();
      expect(matchesStatus('done', 'open')).toBeFalse();
      expect(matchesStatus('archived', 'all')).toBeTrue();
      expect(filterEpics(list, '', 'open').map((e) => e.number)).toEqual([10, 11]);
      expect(filterEpics(list, '', 'done').map((e) => e.number)).toEqual([12]);
    });

    it('busca por título sem acento, tag, time e número (#n, E n, prefixo)', () => {
      expect(matchesEpicQuery(list[0], 'relatorio')).toBeTrue();
      expect(matchesEpicQuery(list[0], 'RELATÓRIOS novembro')).toBeTrue();
      expect(matchesEpicQuery(list[0], 'azul')).toBeTrue();
      expect(matchesEpicQuery(list[1], 'acoes')).toBeTrue();
      expect(matchesEpicQuery(list[2], '5s')).toBeTrue();
      expect(filterEpics(list, '#1', 'all').map((e) => e.number)).toEqual([10, 11, 12, 130]);
      expect(filterEpics(list, 'E13', 'all').map((e) => e.number)).toEqual([130]);
      expect(filterEpics(list, '12', 'all').map((e) => e.number)).toEqual([12]);
      expect(matchesEpicQuery(list[0], 'inexistente')).toBeFalse();
    });

    it('contagem por filtro respeita a busca', () => {
      const c = countByStatusFilter(list, '');
      expect(c.open).toBe(2);
      expect(c.all).toBe(4);
      expect(c.archived).toBe(1);
      expect(countByStatusFilter(list, 'duplicados').open).toBe(1);
      expect(countByStatusFilter(list, 'duplicados').done).toBe(0);
    });
  });

  it('status, cor e papel têm reserva', () => {
    expect(epicStatusLook('paused').label).toBe('Pausado');
    expect(epicStatusLook('x').key).toBe('active');
    expect(epicColor('#abc')).toBe('#abc');
    expect(epicColor('red')).toBe('#7a5cff');
    expect(epicCardRoleLook('created').label).toBe('Criado aqui');
    expect(epicCardRoleLook(undefined).label).toBe('Adicionado');
  });

  it('tags sem repetir (ignora caixa) e sem vazias', () => {
    expect(normalizeTags([' Relatório ', 'relatório', '', null, 'a  b'])).toEqual(['Relatório', 'a b']);
    expect(normalizeTags(null)).toEqual([]);
  });

  it('cards mais recentes primeiro', () => {
    const cards: EpicCard[] = [
      { card: '1', role: 'linked', addedAt: '2026-11-01T10:00:00' },
      { card: '2', role: 'mentioned', addedAt: '2026-11-03T10:00:00' },
      { card: '3', role: 'created', addedAt: '2026-11-03T10:00:00' }
    ];
    expect(sortEpicCards(cards).map((c) => c.card)).toEqual(['3', '2', '1']);
  });

  it('aba da URL', () => {
    expect(parseDeskTab('cards')).toBe('cards');
    expect(parseDeskTab('stories')).toBe('stories');
    expect(parseDeskTab('plan')).toBeNull();
    expect(parseDeskTab(null)).toBeNull();
  });
});
