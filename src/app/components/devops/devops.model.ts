/**
 * 0099 (Mesa de gestão): modelos da API `api/v1/DevOps` — board do time (colunas, lanes, mapeamento coluna→estado),
 * itens do board, metadados do projeto (tipos, campos, tags, áreas/iterações, pessoas) e o card com os campos.
 * Espelham o contrato do plano da feature (seção "REST api/v1/DevOps").
 */

/** Tipo de campo do DevOps, já normalizado pelo servidor. */
export type DevOpsFieldType =
  | 'string' | 'integer' | 'double' | 'dateTime' | 'html' | 'plainText' | 'boolean'
  | 'treePath' | 'identity' | 'picklistString' | 'picklistInteger';

/** `GET DevOps/meta/types`. `color` vem como no DevOps (hex com ou sem `#`); `icon` é o id (`icon_insect`) ou a URL. */
export interface DevOpsWorkItemType {
  name: string;
  color: string | null;
  icon: string | null;
  description?: string | null;
  isDisabled?: boolean;
}

/** `GET DevOps/meta/fields?type=`. */
export interface DevOpsFieldDef {
  referenceName: string;
  name: string;
  type: DevOpsFieldType | string;
  required: boolean;
  readOnly: boolean;
  allowedValues: string[];
  defaultValue?: unknown;
  helpText?: string | null;
}

/** `GET DevOps/meta/areas` / `meta/iterations` (árvore achatada). */
export interface DevOpsClassificationNode {
  path: string;
  name: string;
  depth: number;
}

/** `GET DevOps/meta/people?q=`. */
export interface DevOpsPerson {
  displayName: string;
  uniqueName: string;
  id?: string | null;
  imageUrl?: string | null;
}

export interface DevOpsTeam { id: string; name: string; }
export interface DevOpsBoardRef { id: string; name: string; }

export type BoardColumnType = 'incoming' | 'inProgress' | 'outgoing';

export interface BoardColumn {
  id: string;
  name: string;
  itemLimit: number;
  columnType: BoardColumnType | string;
  isSplit: boolean;
  description?: string | null;
  /** Tipo do card → estado que a coluna representa. Sem o tipo, a coluna não aceita aquele tipo. */
  stateMappings: Record<string, string>;
}

export interface BoardLane {
  id: string;
  name: string | null;
  isDefault: boolean;
}

/** `GET DevOps/board?team=&board=`. */
export interface BoardConfig {
  team: string;
  board: string;
  configHash: string;
  columns: BoardColumn[];
  lanes: BoardLane[];
  fields: { column: string; lane: string; done: string };
  types: { name: string; color: string | null }[];
  orderField: string;
}

export type BoardScope = 'epic' | 'board';

/** `POST DevOps/board/items` (corpo). */
export interface BoardItemsRequest {
  team: string;
  board: string;
  epic?: number | null;
  scope: BoardScope;
  text?: string | null;
  types?: string[];
  assignedTo?: string[];
  tags?: string[];
  states?: string[];
  top?: number;
}

export interface DevOpsIdentityRef {
  displayName: string;
  uniqueName: string;
  imageUrl?: string | null;
}

export interface BoardItem {
  id: number;
  rev: number;
  type: string;
  title: string;
  state: string;
  assignedTo?: DevOpsIdentityRef | null;
  tags: string[];
  column: string | null;
  done: boolean;
  lane: string | null;
  order: number | null;
  priority?: number | null;
  parentId?: number | null;
  changedDate?: string | null;
}

export interface BoardItemsResponse {
  configHash: string;
  items: BoardItem[];
}

/** `POST DevOps/query`. */
export interface DevOpsQueryRequest {
  wiql?: string | null;
  filter?: {
    types?: string[]; states?: string[]; areaPath?: string; iterationPath?: string; tags?: string[];
    assignedTo?: string[]; text?: string; createdFrom?: string; createdTo?: string; changedFrom?: string;
  } | null;
  fields?: string[];
  top?: number;
}

export interface DevOpsQueryResponse {
  count: number;
  items: { id: number; fields: Record<string, unknown> }[];
}

export interface CardRelation {
  rel: string;
  id?: number | null;
  url: string;
}

/** `GET DevOps/workitems/{id}` (e retorno de criar/editar/mover). */
export interface CardDetail {
  id: number;
  rev: number;
  type: string;
  title: string;
  state: string;
  fields: Record<string, unknown>;
  tags: string[];
  url: string;
  relations: CardRelation[];
}

/** `POST DevOps/workitems`. */
export interface CreateCardRequest {
  type: string;
  title: string;
  fields?: Record<string, unknown>;
  tags?: string[];
  parentId?: number | null;
  epic?: number | null;
  team?: string | null;
  board?: string | null;
  column?: string | null;
  lane?: string | null;
}

/** `PATCH DevOps/workitems/{id}`: só o que mudou; `null` limpa o campo. */
export interface UpdateCardRequest {
  fields?: Record<string, unknown>;
  addTags?: string[];
  removeTags?: string[];
  comment?: string | null;
}

/** `POST DevOps/workitems/{id}/move`. */
export interface MoveCardRequest {
  team: string;
  board: string;
  column: string;
  lane?: string | null;
  done?: boolean | null;
  previousId?: number | null;
  nextId?: number | null;
}

/** Corpo dos erros 400/403/409 do DevOps (a mensagem é a do próprio DevOps). */
export interface DevOpsError {
  code?: string;
  message?: string;
}

/** `EpicSummary` reduzido (só o que o painel do card usa para "Adicionar ao épico"). */
export interface EpicRef {
  number: number;
  key?: string;
  title?: string;
  color?: string | null;
}

/** Referências dos campos usados pela tela. */
export const F = {
  title: 'System.Title',
  state: 'System.State',
  tags: 'System.Tags',
  assignedTo: 'System.AssignedTo',
  area: 'System.AreaPath',
  iteration: 'System.IterationPath',
  description: 'System.Description',
  reproSteps: 'Microsoft.VSTS.TCM.ReproSteps',
  acceptance: 'Microsoft.VSTS.Common.AcceptanceCriteria',
  systemInfo: 'Microsoft.VSTS.TCM.SystemInfo',
  priority: 'Microsoft.VSTS.Common.Priority',
  severity: 'Microsoft.VSTS.Common.Severity',
  workItemType: 'System.WorkItemType',
  reason: 'System.Reason',
  history: 'System.History',
  createdBy: 'System.CreatedBy',
  createdDate: 'System.CreatedDate',
  changedBy: 'System.ChangedBy',
  changedDate: 'System.ChangedDate',
} as const;

/** Mensagem legível de um erro HTTP da API (corpo `{code, message}`, `{error}` ou texto). */
export function devOpsErrorMessage(e: unknown, fallback = 'Não foi possível concluir a operação no DevOps.'): string {
  const err = e as { error?: unknown; message?: string; status?: number } | null | undefined;
  const body = err?.error as { message?: string; error?: string; title?: string } | string | null | undefined;
  if (typeof body === 'string' && body.trim()) return body.trim();
  if (body && typeof body === 'object') {
    const msg = body.message || body.error || body.title;
    if (msg) return msg;
  }
  if (err?.status === 0) return 'Sem conexão com o PRMake.';
  return fallback;
}

/** Cor do tipo como CSS (o DevOps manda `CC293D`, sem `#`). */
export function typeColorCss(color: string | null | undefined, fallback = '#8a8f98'): string {
  const c = (color ?? '').trim();
  if (!c) return fallback;
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(c)) return `#${c.length === 8 ? c.slice(2) : c}`;
  return c;
}

/** Ícone do tipo (ids do DevOps → Material Icons). */
const TYPE_ICONS: Record<string, string> = {
  icon_insect: 'bug_report',
  icon_book: 'menu_book',
  icon_clipboard: 'assignment',
  icon_crown: 'military_tech',
  icon_trophy: 'emoji_events',
  icon_list: 'list',
  icon_check_box: 'check_box',
  icon_test_beaker: 'science',
  icon_test_plan: 'fact_check',
  icon_test_suite: 'folder_special',
  icon_test_case: 'rule',
  icon_test_step: 'checklist',
  icon_test_parameter: 'tune',
  icon_sticky_note: 'sticky_note_2',
  icon_traffic_cone: 'warning',
  icon_chat_bubble: 'chat',
  icon_flame: 'local_fire_department',
  icon_megaphone: 'campaign',
  icon_code_review: 'rate_review',
  icon_code_response: 'reply',
  icon_review: 'reviews',
  icon_response: 'reply',
  icon_star: 'star',
  icon_ribbon: 'workspace_premium',
  icon_headphone: 'headset_mic',
  icon_key: 'key',
  icon_airplane: 'flight',
  icon_car: 'directions_car',
  icon_diamond: 'diamond',
  icon_asterisk: 'emergency',
  icon_database_storage: 'storage',
  icon_government: 'account_balance',
  icon_gavel: 'gavel',
  icon_parachute: 'paragliding',
  icon_paint_brush: 'brush',
  icon_palette: 'palette',
  icon_gear: 'settings',
  icon_broken_lightbulb: 'lightbulb',
  icon_clipboard_issue: 'assignment_late',
  icon_health: 'health_and_safety',
  icon_github: 'code',
};

/** Ícone Material para o tipo do card (pelo id do ícone do DevOps ou, sem ele, pelo nome do tipo). */
export function typeIcon(icon: string | null | undefined, typeName?: string | null): string {
  const id = /icon_[a-z_]+/i.exec(icon ?? '')?.[0]?.toLowerCase();
  if (id && TYPE_ICONS[id]) return TYPE_ICONS[id];
  switch ((typeName ?? '').trim().toLowerCase()) {
    case 'bug': return 'bug_report';
    case 'user story': case 'product backlog item': return 'menu_book';
    case 'task': return 'assignment';
    case 'epic': return 'military_tech';
    case 'feature': return 'emoji_events';
    case 'issue': case 'impediment': return 'warning';
    default: return 'description';
  }
}

/** Link do card no DevOps para abrir no navegador (a API pode devolver a URL REST `_apis/wit/workItems/{id}`). */
export function devOpsWebUrl(url: string | null | undefined, id: number | string): string | null {
  const u = (url ?? '').trim();
  if (!u) return null;
  const m = /^(.*?)\/_apis\/wit\/workItems\/(\d+)/i.exec(u);
  return m ? `${m[1]}/_workitems/edit/${m[2] || id}` : u;
}

/** Nome para exibir de um valor de identidade (objeto do DevOps, `Nome <email>` ou e-mail). */
export function identityName(v: unknown): string {
  if (v == null || v === '') return '';
  if (typeof v === 'object') {
    const o = v as { displayName?: string; uniqueName?: string };
    return o.displayName || o.uniqueName || '';
  }
  const s = `${v}`;
  const m = /^(.*?)\s*<([^>]+)>\s*$/.exec(s);
  return m ? (m[1] || m[2]) : s;
}

/** Chave estável de uma identidade (o `uniqueName`/e-mail), para comparar e gravar. */
export function identityKey(v: unknown): string {
  if (v == null || v === '') return '';
  if (typeof v === 'object') {
    const o = v as { displayName?: string; uniqueName?: string };
    return (o.uniqueName || o.displayName || '').trim();
  }
  const s = `${v}`;
  const m = /<([^>]+)>\s*$/.exec(s);
  return (m ? m[1] : s).trim();
}

/** Imagem de uma identidade, quando o DevOps manda. */
export function identityImage(v: unknown): string | null {
  if (v && typeof v === 'object') {
    const o = v as { imageUrl?: string; _links?: { avatar?: { href?: string } } };
    return o.imageUrl || o._links?.avatar?.href || null;
  }
  return null;
}
