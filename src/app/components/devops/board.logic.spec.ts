import {
  DEFAULT_LANE_NAME, EMPTY_FILTER, UNASSIGNED, applyMove, canAccept, columnCounts, columnOf, filterCount, filterItems, filterOptions,
  groupBoard, isFilterActive, isRealMove, laneFilterName, laneMatches, laneOf, neighborsAt, normalizeBoardFilter, orderBetween, sameFilter,
  stateFor, toggleValue, typeOnBoard
} from './board.logic';
import { BoardConfig, BoardItem } from './devops.model';

function config(extra: Partial<BoardConfig> = {}): BoardConfig {
  return {
    team: 'Time', board: 'Stories', configHash: 'h1',
    columns: [
      { id: 'c1', name: 'New', itemLimit: 0, columnType: 'incoming', isSplit: false, stateMappings: { Bug: 'New', 'User Story': 'New' } },
      { id: 'c2', name: 'Active', itemLimit: 2, columnType: 'inProgress', isSplit: true, stateMappings: { Bug: 'Active', 'User Story': 'Active' } },
      { id: 'c3', name: 'QA', itemLimit: 0, columnType: 'inProgress', isSplit: false, stateMappings: { 'User Story': 'Resolved' } },
      { id: 'c4', name: 'Closed', itemLimit: 0, columnType: 'outgoing', isSplit: false, stateMappings: { Bug: 'Closed', 'User Story': 'Closed' } },
    ],
    lanes: [{ id: 'l0', name: null, isDefault: true }, { id: 'l1', name: 'Expedite', isDefault: false }],
    fields: { column: 'WEF_X_Kanban.Column', lane: 'WEF_X_Kanban.Lane', done: 'WEF_X_Kanban.Column.Done' },
    types: [{ name: 'Bug', color: 'CC293D' }, { name: 'User Story', color: '009CCC' }],
    orderField: 'Microsoft.VSTS.Common.StackRank',
    ...extra,
  };
}

function item(id: number, extra: Partial<BoardItem> = {}): BoardItem {
  return { id, rev: 1, type: 'Bug', title: `Card ${id}`, state: 'New', tags: [], column: 'New', done: false, lane: null, order: id, ...extra };
}

describe('board.logic (0099)', () => {
  it('estado mapeado ignora caixa do tipo e coluna sem mapeamento não aceita', () => {
    const cfg = config();
    expect(stateFor(cfg.columns[1], 'bug')).toBe('Active');
    expect(canAccept(cfg.columns[2], 'Bug')).toBeFalse();
    expect(canAccept(cfg.columns[2], 'User Story')).toBeTrue();
    expect(typeOnBoard(cfg, 'Task')).toBeFalse();
    expect(typeOnBoard(cfg, 'Bug')).toBeTrue();
  });

  it('coluna do item pelo campo, senão pelo estado mapeado, senão a primeira', () => {
    const cfg = config();
    expect(columnOf(cfg, item(1, { column: 'active' }))!.name).toBe('Active');
    expect(columnOf(cfg, item(2, { column: null, state: 'Closed' }))!.name).toBe('Closed');
    expect(columnOf(cfg, item(3, { column: 'Sumiu', state: 'Estranho' }))!.name).toBe('New');
  });

  it('lane desconhecida ou vazia vai para a padrão', () => {
    const lanes = config().lanes;
    expect(laneOf(lanes, { lane: 'expedite' })).toBe('Expedite');
    expect(laneOf(lanes, { lane: '' })).toBe('');
    expect(laneOf(lanes, { lane: 'Outra' })).toBe('');
  });

  it('agrupa por lane × coluna × Doing/Done na ordem do board', () => {
    const cfg = config();
    const views = groupBoard(cfg, [
      item(1, { order: 30 }),
      item(2, { order: 10 }),
      item(3, { column: 'Active', done: true }),
      item(4, { column: 'Active', lane: 'Expedite' }),
      item(5, { column: 'New', done: true }), // coluna não dividida: o done é ignorado
    ]);
    expect(views.length).toBe(2);
    expect(views[0].title).toBe('Padrão');
    expect(views[1].title).toBe('Expedite');
    expect(views[0].columns[0].doing.items.map((i) => i.id)).toEqual([5, 2, 1]);
    expect(views[0].columns[1].done!.items.map((i) => i.id)).toEqual([3]);
    expect(views[0].columns[0].done).toBeNull();
    expect(views[1].columns[1].doing.items.map((i) => i.id)).toEqual([4]);
    expect(views[1].count).toBe(1);
    // ids DOM únicos
    const ids = views.flatMap((v) => v.columns.flatMap((c) => [c.doing.id, c.done?.id].filter(Boolean)));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lane padrão sem título quando é a única', () => {
    const views = groupBoard(config({ lanes: [{ id: 'l0', name: null, isDefault: true }] }), [item(1)]);
    expect(views.length).toBe(1);
    expect(views[0].title).toBe('');
  });

  it('conta o WIP por coluna (todas as lanes, Doing + Done) e marca o estouro', () => {
    const counts = columnCounts(config(), [
      item(1, { column: 'Active' }), item(2, { column: 'Active', done: true }), item(3, { column: 'Active', lane: 'Expedite' }),
    ]);
    expect(counts.get('Active')).toEqual({ count: 3, limit: 2, over: true });
    expect(counts.get('New')).toEqual({ count: 0, limit: 0, over: false });
  });

  it('vizinhos da ordem ao soltar (outra célula e reordenação na mesma)', () => {
    const cell = [item(1), item(2), item(3)];
    expect(neighborsAt(cell, 9, 0)).toEqual({ previousId: null, nextId: 1 });
    expect(neighborsAt(cell, 9, 3)).toEqual({ previousId: 3, nextId: null });
    // reordenar: o 1 vai para o fim
    expect(neighborsAt(cell, 1, 2)).toEqual({ previousId: 3, nextId: null });
    // o 3 vai para o meio
    expect(neighborsAt(cell, 3, 1)).toEqual({ previousId: 1, nextId: 2 });
    expect(neighborsAt([], 1, 0)).toEqual({ previousId: null, nextId: null });
  });

  it('ordem entre vizinhos', () => {
    expect(orderBetween(10, 20)).toBe(15);
    expect(orderBetween(10, null)).toBe(11);
    expect(orderBetween(null, 20)).toBe(19);
    expect(orderBetween(null, undefined)).toBeNull();
  });

  it('movimento otimista grava coluna, lane, done, estado mapeado e ordem', () => {
    const cfg = config();
    const items = [item(1, { order: 10 }), item(2, { column: 'Active', order: 20 }), item(3, { column: 'Active', order: 40 })];
    const moved = applyMove(cfg, items, 1, { lane: 'Expedite', column: 'Active', done: true }, { previousId: 2, nextId: 3 });
    expect(moved).not.toBe(items);
    expect(items[0].column).toBe('New'); // a lista anterior continua intacta (rollback)
    const m = moved.find((i) => i.id === 1)!;
    expect(m.column).toBe('Active');
    expect(m.lane).toBe('Expedite');
    expect(m.done).toBeTrue();
    expect(m.state).toBe('Active');
    expect(m.order).toBe(30);
    // done só vale em coluna dividida
    const m2 = applyMove(cfg, items, 1, { lane: '', column: 'Closed', done: true }, { previousId: null, nextId: null }).find((i) => i.id === 1)!;
    expect(m2.done).toBeFalse();
    expect(m2.state).toBe('Closed');
    expect(m2.order).toBe(10);
  });

  it('só é movimento real se mudar de célula ou de posição', () => {
    expect(isRealMove(true, 1, 1)).toBeFalse();
    expect(isRealMove(true, 1, 2)).toBeTrue();
    expect(isRealMove(false, 0, 0)).toBeTrue();
  });

  it('filtra por texto (id, título, tags, responsável), tipo, responsável, tags (todas) e estado', () => {
    const ana = { displayName: 'Ana Souza', uniqueName: 'ana@x.com' };
    const items = [
      item(101, { title: 'Erro na exportação', tags: ['Cliente', 'Urgente'], assignedTo: ana }),
      item(102, { type: 'User Story', title: 'Nova tela de relatório', state: 'Active', tags: ['Cliente'] }),
      item(103, { title: 'Ajuste de layout', state: 'Closed' }),
    ];
    const ids = (f: Partial<typeof EMPTY_FILTER>) => filterItems(items, { ...EMPTY_FILTER, ...f }).map((i) => i.id);
    expect(ids({})).toEqual([101, 102, 103]);
    expect(ids({ text: 'exportacao' })).toEqual([101]);
    expect(ids({ text: '#102' })).toEqual([102]);
    expect(ids({ text: 'souza' })).toEqual([101]);
    expect(ids({ types: ['user story'] })).toEqual([102]);
    expect(ids({ assignedTo: ['ana@x.com'] })).toEqual([101]);
    expect(ids({ assignedTo: [UNASSIGNED] })).toEqual([102, 103]);
    expect(ids({ tags: ['cliente', 'urgente'] })).toEqual([101]);
    expect(ids({ tags: ['Cliente'] })).toEqual([101, 102]);
    expect(ids({ states: ['Closed', 'Active'] })).toEqual([102, 103]);
  });

  it('opções dos filtros a partir dos itens', () => {
    const opts = filterOptions([
      item(1, { tags: ['b', 'A'], assignedTo: { displayName: 'Zé', uniqueName: 'ze@x' } }),
      item(2, { type: 'User Story', state: 'Active', tags: ['a'] }),
    ]);
    expect(opts.types).toEqual(['Bug', 'User Story']);
    expect(opts.states).toEqual(['Active', 'New']);
    expect(opts.tags.map((t) => t.toLowerCase())).toEqual(['a', 'b']);
    expect(opts.people.map((p) => p.key)).toEqual(['ze@x', UNASSIGNED]);
  });

  it('liga/desliga valor de filtro ignorando caixa', () => {
    expect(toggleValue(['Bug'], 'bug')).toEqual([]);
    expect(toggleValue(['Bug'], 'Task')).toEqual(['Bug', 'Task']);
  });

  // ── Ajustes 1: lanes no filtro e filtros salvos no épico ──

  it('nome da lane no filtro: a padrão sem nome vira "Padrão"; casa por nome ou apelido da padrão', () => {
    const [def, exp] = config().lanes;
    expect(laneFilterName(def)).toBe(DEFAULT_LANE_NAME);
    expect(laneFilterName(exp)).toBe('Expedite');
    expect(laneMatches('padrao', def)).toBeTrue();
    expect(laneMatches('Default', def)).toBeTrue();
    expect(laneMatches('expedite', exp)).toBeTrue();
    expect(laneMatches('Padrão', exp)).toBeFalse();
  });

  it('filtra por lane com as lanes do board (sem elas o filtro de lane não se aplica)', () => {
    const cfg = config();
    const items = [item(1), item(2, { lane: 'Expedite' }), item(3, { lane: 'Sumiu' })];
    const f = { ...EMPTY_FILTER, lanes: ['Expedite'] };
    expect(filterItems(items, f, cfg.lanes).map((i) => i.id)).toEqual([2]);
    expect(filterItems(items, { ...EMPTY_FILTER, lanes: ['Padrão'] }, cfg.lanes).map((i) => i.id)).toEqual([1, 3]);
    expect(filterItems(items, f).map((i) => i.id)).toEqual([1, 2, 3]);
    expect(isFilterActive(f)).toBeTrue();
    expect(filterCount({ ...f, text: 'x', types: ['Bug'] })).toBe(3);
  });

  it('normaliza o filtro salvo (listas vazias por padrão, ignora lixo) e compara sem caixa/ordem', () => {
    expect(normalizeBoardFilter(null)).toEqual(EMPTY_FILTER);
    expect(normalizeBoardFilter({ lanes: ['Expedite', 3, ' '], text: 7, tags: 'x' })).toEqual({ ...EMPTY_FILTER, lanes: ['Expedite'] });
    expect(sameFilter({ ...EMPTY_FILTER, types: ['Bug', 'Task'] }, { ...EMPTY_FILTER, types: ['task', 'bug'] })).toBeTrue();
    expect(sameFilter({ ...EMPTY_FILTER, text: ' a ' }, { ...EMPTY_FILTER, text: 'a' })).toBeTrue();
    expect(sameFilter({ ...EMPTY_FILTER, lanes: ['A'] }, EMPTY_FILTER)).toBeFalse();
  });
});
