import { BoardColumn, BoardConfig, BoardItem, BoardLane } from './devops.model';

/**
 * 0099 (Mesa de gestão): lógica pura do board do DevOps — agrupar os itens em lane × coluna × (Doing|Done), contar
 * por coluna (limite WIP), saber se a coluna aceita o tipo arrastado, calcular os vizinhos da ordem, aplicar o
 * movimento otimista e filtrar como o DevOps (texto, tipo, responsável, tags, estado).
 */

/** Chave da lane: a padrão é `''` (no DevOps o campo de lane fica vazio na lane padrão). */
export function laneKey(lane: Pick<BoardLane, 'name' | 'isDefault'>): string {
  return lane.isDefault ? '' : (lane.name ?? '').trim();
}

const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** Texto sem acentos e em minúsculas, para buscas. */
export function fold(s: string | null | undefined): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Estado que a coluna representa para o tipo (o mapeamento ignora caixa no nome do tipo). */
export function stateFor(column: Pick<BoardColumn, 'stateMappings'>, type: string): string | null {
  const maps = column.stateMappings ?? {};
  if (type in maps) return maps[type] || null;
  const t = lower(type);
  for (const k of Object.keys(maps)) if (lower(k) === t) return maps[k] || null;
  return null;
}

/** O tipo aparece em alguma coluna do board (senão o card fica fora do fluxo do board e não se arrasta). */
export function typeOnBoard(config: Pick<BoardConfig, 'columns'> | null | undefined, type: string): boolean {
  return !!config?.columns.some((c) => !!stateFor(c, type));
}

/** A coluna aceita o tipo arrastado (tem mapeamento coluna → estado para ele). */
export function canAccept(column: Pick<BoardColumn, 'stateMappings'>, type: string): boolean {
  return !!stateFor(column, type);
}

/** Coluna do item no board: pelo campo de coluna; sem ele (ou de outra configuração), pelo estado mapeado. */
export function columnOf(config: Pick<BoardConfig, 'columns'>, item: Pick<BoardItem, 'column' | 'type' | 'state'>): BoardColumn | null {
  const cols = config.columns ?? [];
  if (!cols.length) return null;
  const byName = item.column ? cols.find((c) => lower(c.name) === lower(item.column)) : undefined;
  if (byName) return byName;
  const byState = cols.find((c) => lower(stateFor(c, item.type)) === lower(item.state) && !!item.state);
  return byState ?? cols[0];
}

/** Lane do item: a do campo de lane, ou a padrão quando vazia/desconhecida. */
export function laneOf(lanes: BoardLane[], item: Pick<BoardItem, 'lane'>): string {
  const k = lower(item.lane);
  if (!k) return '';
  const lane = lanes.find((l) => !l.isDefault && lower(l.name) === k);
  return lane ? laneKey(lane) : '';
}

/** Ordem do board (menor primeiro; sem ordem por último; empate pelo id). */
export function compareOrder(a: Pick<BoardItem, 'order' | 'id'>, b: Pick<BoardItem, 'order' | 'id'>): number {
  const ao = a.order ?? Number.POSITIVE_INFINITY;
  const bo = b.order ?? Number.POSITIVE_INFINITY;
  if (ao !== bo) return ao < bo ? -1 : 1;
  return a.id - b.id;
}

/** Uma célula do board (lane × coluna × Doing|Done) — cada uma é uma lista de soltar. */
export interface BoardCell {
  /** Id DOM único da lista (`cell-<lane>-<coluna>-<d|o>`). */
  id: string;
  lane: string;
  column: string;
  done: boolean;
  items: BoardItem[];
}

export interface BoardLaneView {
  key: string;
  lane: BoardLane;
  /** Título da faixa (vazio na lane padrão quando ela é a única). */
  title: string;
  count: number;
  columns: { column: BoardColumn; doing: BoardCell; done: BoardCell | null }[];
}

/** Lanes do board (a padrão sempre existe, mesmo se o servidor não mandar). */
export function boardLanes(config: Pick<BoardConfig, 'lanes'>): BoardLane[] {
  const lanes = [...(config.lanes ?? [])];
  if (!lanes.some((l) => l.isDefault)) lanes.unshift({ id: 'default', name: null, isDefault: true });
  return lanes;
}

/** Título da faixa da lane: a padrão sem título quando é a única; senão "Padrão" se não tiver nome. */
export function laneTitle(lane: BoardLane, laneCount: number): string {
  if (lane.isDefault) return laneCount > 1 ? (lane.name?.trim() || 'Padrão') : '';
  return lane.name?.trim() || 'Sem nome';
}

function cellId(lane: number, column: number, done: boolean): string {
  return `cell-${lane}-${column}-${done ? 'd' : 'o'}`;
}

/** Agrupa os itens (já filtrados) em lanes × colunas × Doing/Done, na ordem do board. */
export function groupBoard(config: BoardConfig, items: BoardItem[]): BoardLaneView[] {
  const lanes = boardLanes(config);
  const cols = config.columns ?? [];
  const views: BoardLaneView[] = lanes.map((lane, li) => ({
    key: laneKey(lane),
    lane,
    title: laneTitle(lane, lanes.length),
    count: 0,
    columns: cols.map((column, ci) => ({
      column,
      doing: { id: cellId(li, ci, false), lane: laneKey(lane), column: column.name, done: false, items: [] },
      done: column.isSplit ? { id: cellId(li, ci, true), lane: laneKey(lane), column: column.name, done: true, items: [] } : null,
    })),
  }));
  const byLane = new Map(views.map((v) => [v.key, v]));
  for (const item of items) {
    const col = columnOf(config, item);
    if (!col) continue;
    const view = byLane.get(laneOf(lanes, item)) ?? views[0];
    const slot = view.columns.find((c) => c.column === col);
    if (!slot) continue;
    (item.done && slot.done ? slot.done : slot.doing).items.push(item);
    view.count++;
  }
  for (const v of views) {
    for (const c of v.columns) {
      c.doing.items.sort(compareOrder);
      c.done?.items.sort(compareOrder);
    }
  }
  return views;
}

export interface ColumnCount {
  count: number;
  limit: number;
  /** Passou do limite WIP (só colunas "em andamento" têm limite). */
  over: boolean;
}

/** Contagem por coluna (todas as lanes, Doing + Done — como o DevOps conta o WIP). */
export function columnCounts(config: BoardConfig, items: BoardItem[]): Map<string, ColumnCount> {
  const out = new Map<string, ColumnCount>();
  for (const c of config.columns ?? []) out.set(c.name, { count: 0, limit: c.itemLimit ?? 0, over: false });
  for (const item of items) {
    const col = columnOf(config, item);
    if (col) out.get(col.name)!.count++;
  }
  for (const [, v] of out) v.over = v.limit > 0 && v.count > v.limit;
  return out;
}

/**
 * Vizinhos para a ordem (`previousId`/`nextId`) ao soltar o item em `index` de uma célula. `cellItems` é a lista
 * como estava antes de soltar (pode conter o próprio item, quando é reordenação na mesma célula).
 */
export function neighborsAt(cellItems: Pick<BoardItem, 'id'>[], movedId: number, index: number): { previousId: number | null; nextId: number | null } {
  const list = cellItems.filter((i) => i.id !== movedId);
  const at = Math.max(0, Math.min(index, list.length));
  return { previousId: list[at - 1]?.id ?? null, nextId: list[at]?.id ?? null };
}

/** Ordem que fica entre os vizinhos (para o item cair no lugar certo antes da resposta do servidor). */
export function orderBetween(prev: number | null | undefined, next: number | null | undefined): number | null {
  const p = prev ?? null;
  const n = next ?? null;
  if (p !== null && n !== null) return (p + n) / 2;
  if (p !== null) return p + 1;
  if (n !== null) return n - 1;
  return null;
}

export interface DropTarget {
  lane: string;
  column: string;
  done: boolean;
}

/**
 * Movimento otimista: o item vai para a coluna/lane/Done do alvo, com o estado mapeado do tipo e uma ordem entre
 * os vizinhos. Devolve uma lista nova (a anterior serve de rollback).
 */
export function applyMove(
  config: BoardConfig, items: BoardItem[], id: number, target: DropTarget,
  neighbors: { previousId: number | null; nextId: number | null }
): BoardItem[] {
  const col = config.columns.find((c) => c.name === target.column);
  const prev = neighbors.previousId != null ? items.find((i) => i.id === neighbors.previousId) : undefined;
  const next = neighbors.nextId != null ? items.find((i) => i.id === neighbors.nextId) : undefined;
  return items.map((i) => {
    if (i.id !== id) return i;
    const order = orderBetween(prev?.order, next?.order);
    return {
      ...i,
      column: target.column,
      lane: target.lane,
      done: !!(col?.isSplit && target.done),
      state: (col && stateFor(col, i.type)) || i.state,
      order: order ?? i.order,
    };
  });
}

/** Mudou de lugar de verdade (célula diferente ou outra posição na mesma). */
export function isRealMove(sameCell: boolean, previousIndex: number, currentIndex: number): boolean {
  return !sameCell || previousIndex !== currentIndex;
}

// ── Filtros ──

/** Valor do filtro de responsável para "Sem responsável". */
export const UNASSIGNED = '__unassigned__';

export interface BoardFilter {
  text: string;
  types: string[];
  assignedTo: string[];
  tags: string[];
  states: string[];
  /** Nomes das lanes (a padrão sem nome vira `DEFAULT_LANE_NAME`). */
  lanes: string[];
}

export const EMPTY_FILTER: BoardFilter = { text: '', types: [], assignedTo: [], tags: [], states: [], lanes: [] };

/** Nome da lane padrão sem nome no filtro (o servidor entende "padrão"/"default"/vazio como a lane padrão). */
export const DEFAULT_LANE_NAME = 'Padrão';

/** Nome da lane no filtro (ajustes 1): o do DevOps, ou `DEFAULT_LANE_NAME` na padrão sem nome. */
export function laneFilterName(lane: Pick<BoardLane, 'name' | 'isDefault'>): string {
  return lane.isDefault ? (lane.name?.trim() || DEFAULT_LANE_NAME) : (lane.name?.trim() || '');
}

const DEFAULT_LANE_ALIASES = new Set(['', 'default', 'padrao']);

/** O valor do filtro de lane aponta para a lane (nome igual; "padrão"/"default"/vazio = a padrão). */
export function laneMatches(value: string, lane: Pick<BoardLane, 'name' | 'isDefault'>): boolean {
  const v = fold(value);
  if (lane.isDefault && DEFAULT_LANE_ALIASES.has(v)) return true;
  return v === fold(laneFilterName(lane));
}

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => (x as string).trim()) : [];

/** Filtro salvo (do épico — `boardFilters`) para o filtro do board: listas vazias e texto vazio por padrão. */
export function normalizeBoardFilter(raw: unknown): BoardFilter {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    text: typeof r['text'] === 'string' ? (r['text'] as string) : '',
    types: strList(r['types']),
    assignedTo: strList(r['assignedTo']),
    tags: strList(r['tags']),
    states: strList(r['states']),
    lanes: strList(r['lanes']),
  };
}

/** Mesmos filtros (ignora caixa e a ordem das listas; texto sem espaços nas pontas). */
export function sameFilter(a: BoardFilter | null | undefined, b: BoardFilter | null | undefined): boolean {
  const x = normalizeBoardFilter(a);
  const y = normalizeBoardFilter(b);
  const list = (l: string[]) => l.map(lower).sort().join('\u0001');
  return x.text.trim() === y.text.trim() && list(x.types) === list(y.types) && list(x.assignedTo) === list(y.assignedTo)
    && list(x.tags) === list(y.tags) && list(x.states) === list(y.states) && list(x.lanes) === list(y.lanes);
}

export function isFilterActive(f: BoardFilter): boolean {
  return !!f.text.trim() || !!f.types.length || !!f.assignedTo.length || !!f.tags.length || !!f.states.length || !!f.lanes?.length;
}

export function filterCount(f: BoardFilter): number {
  return (f.text.trim() ? 1 : 0) + f.types.length + f.assignedTo.length + f.tags.length + f.states.length + (f.lanes?.length ?? 0);
}

/** Chave do responsável no filtro (uniqueName; sem responsável → `UNASSIGNED`). */
export function assigneeKey(item: Pick<BoardItem, 'assignedTo'>): string {
  return lower(item.assignedTo?.uniqueName || item.assignedTo?.displayName) || UNASSIGNED;
}

/**
 * Filtra como o DevOps: texto (id, título, tags, responsável), e cada lista é "qualquer um de" (OU dentro, E entre
 * filtros). Tags exigem todas as escolhidas, como no filtro de tags do board. Lanes precisam das lanes do board
 * (`lanes`); sem elas o filtro de lane não se aplica.
 */
export function filterItems(items: BoardItem[], f: BoardFilter, lanes?: BoardLane[] | null): BoardItem[] {
  if (!isFilterActive(f)) return items;
  const words = fold(f.text).replace(/^#/, '').split(/\s+/).filter(Boolean);
  const types = new Set(f.types.map(lower));
  const people = new Set(f.assignedTo.map(lower));
  const tags = f.tags.map(lower);
  const states = new Set(f.states.map(lower));
  const laneList = lanes?.length ? lanes : null;
  const wantedLanes = laneList && f.lanes?.length
    ? new Set(laneList.filter((l) => f.lanes.some((v) => laneMatches(v, l))).map(laneKey))
    : null;
  return items.filter((i) => {
    if (types.size && !types.has(lower(i.type))) return false;
    if (states.size && !states.has(lower(i.state))) return false;
    if (people.size && !people.has(assigneeKey(i))) return false;
    if (wantedLanes && !wantedLanes.has(laneOf(laneList!, i))) return false;
    if (tags.length) {
      const own = new Set((i.tags ?? []).map(lower));
      if (!tags.every((t) => own.has(t))) return false;
    }
    if (words.length) {
      const hay = fold([i.id, i.title, ...(i.tags ?? []), i.assignedTo?.displayName ?? '', i.state, i.type].join(' '));
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

export interface FilterOptions {
  types: string[];
  states: string[];
  tags: string[];
  people: { key: string; name: string; imageUrl: string | null }[];
}

/** Opções dos filtros a partir dos itens carregados (ordem alfabética; "Sem responsável" por último). */
export function filterOptions(items: BoardItem[]): FilterOptions {
  const types = new Map<string, string>();
  const states = new Map<string, string>();
  const tags = new Map<string, string>();
  const people = new Map<string, { key: string; name: string; imageUrl: string | null }>();
  let unassigned = false;
  for (const i of items) {
    if (i.type) types.set(lower(i.type), i.type);
    if (i.state) states.set(lower(i.state), i.state);
    for (const t of i.tags ?? []) if (t) tags.set(lower(t), t);
    const k = assigneeKey(i);
    if (k === UNASSIGNED) unassigned = true;
    else if (!people.has(k)) people.set(k, { key: k, name: i.assignedTo?.displayName || i.assignedTo?.uniqueName || k, imageUrl: i.assignedTo?.imageUrl ?? null });
  }
  const byText = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });
  const list = [...people.values()].sort((a, b) => byText(a.name, b.name));
  if (unassigned) list.push({ key: UNASSIGNED, name: 'Sem responsável', imageUrl: null });
  return {
    types: [...types.values()].sort(byText),
    states: [...states.values()].sort(byText),
    tags: [...tags.values()].sort(byText),
    people: list,
  };
}

/** Liga/desliga um valor numa lista de filtro. */
export function toggleValue(list: string[], value: string): string[] {
  return list.some((v) => lower(v) === lower(value)) ? list.filter((v) => lower(v) !== lower(value)) : [...list, value];
}
