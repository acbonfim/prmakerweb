/**
 * 0099: regras puras dos épicos da Mesa de gestão — chave do dono (`E{n}`), status, cores, papéis dos cards e os
 * filtros do trilho. Sem Angular (testável direto).
 */

/** Status do épico (registro do PRMake — não é o Epic do DevOps). */
export type EpicStatus = 'active' | 'paused' | 'done' | 'archived';

/** Como o card entrou no épico: criado pela Mesa, adicionado à mão ou mencionado por `#<épico>`. */
export type EpicCardRole = 'created' | 'linked' | 'mentioned';

/** Contagens do épico (`EpicSummary.counts`). */
export interface EpicCounts {
  cards: number;
  items: number;
  openItems: number;
}

/** `EpicSummary` do contrato (`GET Epics`, `GET Epics/by-card/{card}`). */
export interface EpicSummary {
  id: string;
  number: number;
  key: string;
  title: string;
  status: EpicStatus;
  color: string | null;
  tags: string[];
  devOpsTeam?: string | null;
  devOpsBoard?: string | null;
  devOpsCardId?: string | null;
  /** 0104: o Especialista do caso dos cards do épico pode escrever rascunhos de histórias (ausente = ligado). */
  allowCardStoryDrafts?: boolean;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  counts: EpicCounts;
  /** Ajustes 1: filtros do board salvos no épico (o especialista usa no board do time). */
  boardFilters?: EpicBoardFilters | null;
}

/**
 * Ajustes 1: filtros do board salvos no épico (`PUT Epics/{n}/board-filters`) — valem na tela ("Cards do épico" e
 * "Board do time") e para o especialista. `assignedTo` = uniqueName; `lanes` = nomes das lanes (as únicas faixas
 * mostradas); `hiddenColumns` = colunas que o board não mostra.
 */
export interface EpicBoardFilters {
  lanes: string[];
  types: string[];
  states: string[];
  assignedTo: string[];
  tags: string[];
  text: string;
  /** Colunas ocultas do board (nomes; vazio = todas — coluna nova do DevOps aparece sozinha). */
  hiddenColumns: string[];
}

/** `EpicCardResponse`. */
export interface EpicCard {
  card: string;
  role: EpicCardRole;
  title?: string | null;
  workItemType?: string | null;
  addedByName?: string | null;
  addedAt: string;
}

/** `EpicResponse` = summary + descrição + cards. */
export interface Epic extends EpicSummary {
  description: string | null;
  cards: EpicCard[];
}

/** `SaveEpicRequest` (criar/editar). */
export interface SaveEpicRequest {
  title: string;
  description?: string | null;
  color?: string | null;
  tags?: string[] | null;
  devOpsTeam?: string | null;
  devOpsBoard?: string | null;
  devOpsCardId?: string | null;
  /** Ajustes 1: filtros do board (null/ausente = não mexe). */
  boardFilters?: EpicBoardFilters | null;
  /** 0104: rascunhos de histórias pelos cards (criar: ausente = ligado; editar: ausente = não mexe). */
  allowCardStoryDrafts?: boolean | null;
}

/** Evento de tempo real do grupo `epics`. */
export const EPICS_EVENT = 'epicsUpdated';
export const EPICS_GROUP = 'epics';
export interface EpicsUpdatedPayload {
  number: number;
  action: 'created' | 'updated' | 'status' | 'cards' | 'filters' | 'stories' | string;
}

// ── Chave do dono ────────────────────────────────────────────────────────────────────────────

/** Chave do épico usada como "card" (itens, conversa, arquivos, relatados, tempo real): `E1234`. */
export function epicKey(number: number | null | undefined): string | null {
  return number != null && Number.isFinite(number) && number > 0 ? `E${Math.trunc(number)}` : null;
}

/** `E1234` (ou `e1234`) → 1234; o resto → null. */
export function parseEpicKey(value: string | null | undefined): number | null {
  const m = /^\s*[eE](\d+)\s*$/.exec(`${value ?? ''}`);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}

export function isEpicKey(value: string | null | undefined): boolean {
  return parseEpicKey(value) !== null;
}

/** Número do épico vindo da URL/busca: `1234`, `#1234` ou `E1234`. */
export function parseEpicNumber(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : null;
  const raw = `${value ?? ''}`.trim().replace(/^#/, '');
  if (!raw) return null;
  const key = parseEpicKey(raw);
  if (key) return key;
  return /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
}

// ── Status ───────────────────────────────────────────────────────────────────────────────────

export interface EpicStatusLook {
  key: EpicStatus;
  label: string;
  icon: string;
  color: string;
}

export const EPIC_STATUSES: readonly EpicStatusLook[] = [
  { key: 'active', label: 'Ativo', icon: 'play_circle', color: '#3fb950' },
  { key: 'paused', label: 'Pausado', icon: 'pause_circle', color: '#d29922' },
  { key: 'done', label: 'Concluído', icon: 'check_circle', color: '#58a6ff' },
  { key: 'archived', label: 'Arquivado', icon: 'inventory_2', color: '#8b949e' }
];

export function epicStatusLook(status: string | null | undefined): EpicStatusLook {
  return EPIC_STATUSES.find((s) => s.key === status) ?? EPIC_STATUSES[0];
}

// ── Cores ────────────────────────────────────────────────────────────────────────────────────

/** Paleta do diálogo (contraste bom no tema escuro). */
export const EPIC_COLORS: readonly string[] = [
  '#7a5cff', '#58a6ff', '#2ea8a0', '#3fb950', '#a3b545', '#d29922', '#f0883e', '#f85149', '#db61a2', '#8b949e'
];

export const DEFAULT_EPIC_COLOR = EPIC_COLORS[0];

/** Cor válida (`#rgb`/`#rrggbb`) ou a padrão. */
export function epicColor(color: string | null | undefined): string {
  const c = `${color ?? ''}`.trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) ? c : DEFAULT_EPIC_COLOR;
}

// ── Cards do épico ───────────────────────────────────────────────────────────────────────────

export interface EpicCardRoleLook {
  label: string;
  icon: string;
  hint: string;
}

const ROLE_LOOKS: Record<EpicCardRole, EpicCardRoleLook> = {
  created: { label: 'Criado aqui', icon: 'add_circle', hint: 'Card criado pela Mesa de gestão dentro deste épico' },
  linked: { label: 'Adicionado', icon: 'link', hint: 'Card adicionado ao épico à mão' },
  mentioned: { label: 'Mencionado', icon: 'alternate_email', hint: 'Card que citou este épico (#número) numa conversa, Timeline ou nota' }
};

export function epicCardRoleLook(role: string | null | undefined): EpicCardRoleLook {
  return ROLE_LOOKS[role as EpicCardRole] ?? ROLE_LOOKS.linked;
}

/** Cor do tipo do card do DevOps (as do processo padrão; o resto fica neutro). */
const DEVOPS_TYPE_COLORS: Record<string, string> = {
  bug: '#cc293d',
  'user story': '#009ccc',
  task: '#f2cb1d',
  feature: '#773b93',
  epic: '#ff7b00',
  issue: '#b4009e',
  'test case': '#004b50'
};

export function devOpsTypeColor(type: string | null | undefined): string {
  return DEVOPS_TYPE_COLORS[`${type ?? ''}`.trim().toLowerCase()] ?? '#8b949e';
}

/** Número de card do DevOps digitado (`123`, `#123`); o resto → null. */
export function parseCardId(value: string | number | null | undefined): string | null {
  const raw = `${value ?? ''}`.trim().replace(/^#/, '');
  return /^\d+$/.test(raw) && Number(raw) > 0 ? `${Number(raw)}` : null;
}

/** Cards na ordem da aba: os mais recentes primeiro (criados/adicionados antes dos só mencionados no empate). */
export function sortEpicCards(cards: readonly EpicCard[]): EpicCard[] {
  const rank = (c: EpicCard) => (c.role === 'mentioned' ? 1 : 0);
  return cards.slice().sort((a, b) => (Date.parse(b.addedAt) || 0) - (Date.parse(a.addedAt) || 0) || rank(a) - rank(b));
}

// ── Tags ─────────────────────────────────────────────────────────────────────────────────────

/** Tags sem espaço sobrando, sem vazias e sem repetir (ignora caixa; fica a primeira grafia). */
export function normalizeTags(tags: readonly (string | null | undefined)[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags ?? []) {
    const v = `${t ?? ''}`.trim().replace(/\s+/g, ' ');
    const k = v.toLowerCase();
    if (!v || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

// ── Filtros do trilho ────────────────────────────────────────────────────────────────────────

/** Filtro de status do trilho: abertos (ativos + pausados), um status ou todos. */
export type EpicStatusFilter = 'open' | EpicStatus | 'all';

export const EPIC_STATUS_FILTERS: readonly { key: EpicStatusFilter; label: string }[] = [
  { key: 'open', label: 'Abertos' },
  { key: 'active', label: 'Ativos' },
  { key: 'paused', label: 'Pausados' },
  { key: 'done', label: 'Concluídos' },
  { key: 'archived', label: 'Arquivados' },
  { key: 'all', label: 'Todos' }
];

export function matchesStatus(status: string | null | undefined, filter: EpicStatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'open') return status === 'active' || status === 'paused';
  return status === filter;
}

function fold(text: string | null | undefined): string {
  return `${text ?? ''}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Busca do trilho: cada palavra precisa aparecer no título, numa tag, na chave (`E12`), no número (`#12`/`12`) ou no
 * time/board. Ignora acentos e caixa.
 */
export function matchesEpicQuery(epic: Pick<EpicSummary, 'number' | 'title' | 'tags' | 'devOpsTeam' | 'devOpsBoard'>, query: string | null | undefined): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold([epic.title, ...(epic.tags ?? []), epic.devOpsTeam ?? '', epic.devOpsBoard ?? ''].join(' '));
  const num = `${epic.number}`;
  return words.every((w) => {
    const n = w.replace(/^#/, '').replace(/^e(?=\d+$)/, '');
    if (/^\d+$/.test(n)) return num.startsWith(n) || hay.includes(w);
    return hay.includes(w);
  });
}

export function filterEpics<T extends EpicSummary>(epics: readonly T[], query: string | null | undefined, status: EpicStatusFilter): T[] {
  return epics.filter((e) => matchesStatus(e.status, status) && matchesEpicQuery(e, query));
}

/** Contagem por filtro de status (as pastilhas do trilho), já aplicada a busca. */
export function countByStatusFilter(epics: readonly EpicSummary[], query?: string | null): Record<EpicStatusFilter, number> {
  const searched = epics.filter((e) => matchesEpicQuery(e, query));
  const out = {} as Record<EpicStatusFilter, number>;
  for (const f of EPIC_STATUS_FILTERS) out[f.key] = searched.filter((e) => matchesStatus(e.status, f.key)).length;
  return out;
}

// ── Abas da Mesa ─────────────────────────────────────────────────────────────────────────────

/** Ajustes 2: `stories` = aba Histórias (histórias/bugs escritos no PRMake antes de virarem card), entre Board e Itens. */
export type DeskTab = 'board' | 'stories' | 'items' | 'cards' | 'files' | 'reported';
export const DESK_TABS: readonly DeskTab[] = ['board', 'stories', 'items', 'cards', 'files', 'reported'];

export function parseDeskTab(value: string | null | undefined): DeskTab | null {
  return (DESK_TABS as readonly string[]).includes(`${value ?? ''}`) ? (value as DeskTab) : null;
}
