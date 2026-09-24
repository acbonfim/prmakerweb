import { Observable } from 'rxjs';

export interface FilterOption {
  value: number | string;
  label: string;
}

export interface FilterDef {
  key: string;
  label: string;
  /** Quando true, aceita vários valores selecionados; quando false/omitido, só um por vez (8.7). */
  multiple?: boolean;
  /** Busca os valores possíveis desse filtro (8.4) — chamada com debounce a cada digitação. */
  search: (term: string) => Observable<FilterOption[]>;
}

/**
 * Contrato genérico (8.6): qualquer service que queira oferecer filtros ao cc-filter-bar
 * implementa isso, descrevendo quais filtros existem e como buscar os valores de cada um.
 */
export interface FilterProvider {
  getFilterDefs(): FilterDef[];
}

/** Seleção atual por filtro — sempre uma lista, mesmo quando o filtro é de item único. */
export type FilterValues = Record<string, FilterOption[]>;
