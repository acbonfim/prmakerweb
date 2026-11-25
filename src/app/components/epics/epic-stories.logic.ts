/**
 * 0099 (ajustes 2): histórias e bugs escritos no PRMake dentro do épico (aba "Histórias") antes de virarem card no
 * DevOps — modelo do contrato (`GET Epics/{n}/stories`, `EpicStories/{number}`), rótulos, filtro/ordem por status,
 * validação do editor e os campos do DevOps guardados na história. Sem Angular (testável direto).
 */
import { canAccept } from '../devops/board.logic';
import { BoardColumn, DevOpsFieldDef, F, identityKey, identityName, typeIcon } from '../devops/devops.model';
import { devOpsTypeColor } from './epic.logic';

export type EpicStoryType = 'user-story' | 'bug';
export type EpicStoryStatus = 'draft' | 'ready' | 'converted' | 'discarded';

/** História/bug do épico (`EpicStoryResponse`). `fields` = `{referência do DevOps: valor}` (área, iteração, responsável…). */
export interface EpicStory {
  id: string;
  number: number;
  epicNumber?: number | null;
  type: EpicStoryType;
  title: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
  reproSteps?: string | null;
  priority?: number | null;
  severity?: string | null;
  tags: string[];
  fields: Record<string, unknown>;
  status: EpicStoryStatus;
  cardId?: string | number | null;
  convertedAt?: string | null;
  convertedByName?: string | null;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Corpo de `POST Epics/{n}/stories` e `PUT EpicStories/{number}`. */
export interface SaveEpicStoryRequest {
  type: EpicStoryType;
  title: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
  reproSteps?: string | null;
  priority?: number | null;
  severity?: string | null;
  tags?: string[];
  fields?: Record<string, unknown>;
  status?: 'draft' | 'ready';
}

/** Corpo de `POST EpicStories/{number}/convert` — onde o card entra no board (tudo opcional). */
export interface ConvertEpicStoryRequest {
  team?: string | null;
  board?: string | null;
  column?: string | null;
  lane?: string | null;
  /** Campos do DevOps preenchidos na conversão (por cima dos da história) — os obrigatórios que faltavam. */
  fields?: Record<string, unknown> | null;
}

/** `GET EpicStories/required-fields?type=`: o tipo do DevOps e os obrigatórios que ele não preenche sozinho (ex.: Module). */
export interface StoryRequiredFields {
  type: string;
  fields: DevOpsFieldDef[];
}

// ── Tipo ─────────────────────────────────────────────────────────────────────────────────────

export interface StoryTypeLook {
  key: EpicStoryType;
  label: string;
  /** Nome do tipo no DevOps (seed do `DeskStoryFieldMap`; o servidor manda no mapeamento real). */
  devOpsType: string;
  icon: string;
  color: string;
}

export const STORY_TYPES: readonly StoryTypeLook[] = [
  { key: 'user-story', label: 'História', devOpsType: 'User Story', icon: typeIcon(null, 'User Story'), color: devOpsTypeColor('user story') },
  { key: 'bug', label: 'Bug', devOpsType: 'Bug', icon: typeIcon(null, 'Bug'), color: devOpsTypeColor('bug') }
];

export function storyTypeLook(type: string | null | undefined): StoryTypeLook {
  return STORY_TYPES.find((t) => t.key === type) ?? STORY_TYPES[0];
}

// ── Status ───────────────────────────────────────────────────────────────────────────────────

export interface StoryStatusLook {
  key: EpicStoryStatus;
  label: string;
  icon: string;
  color: string;
  hint: string;
}

export const STORY_STATUSES: readonly StoryStatusLook[] = [
  { key: 'draft', label: 'Rascunho', icon: 'edit_note', color: '#d29922', hint: 'Ainda sendo escrita (pessoa ou Especialista)' },
  { key: 'ready', label: 'Pronta', icon: 'task_alt', color: '#3fb950', hint: 'Revisada — pronta para virar card no DevOps' },
  { key: 'converted', label: 'Convertida', icon: 'move_up', color: '#58a6ff', hint: 'Virou card no DevOps (só leitura)' },
  { key: 'discarded', label: 'Descartada', icon: 'delete_outline', color: '#8b949e', hint: 'Descartada — dá para restaurar' }
];

export function storyStatusLook(status: string | null | undefined): StoryStatusLook {
  return STORY_STATUSES.find((s) => s.key === status) ?? STORY_STATUSES[0];
}

/** Convertida não se edita mais (o servidor responde 409 `notEditable`). */
export function isStoryEditable(story: Pick<EpicStory, 'status'> | null | undefined): boolean {
  return !!story && story.status !== 'converted';
}

/** Pode virar card: não convertida, não descartada e com título. */
export function canConvertStory(story: Pick<EpicStory, 'status' | 'title' | 'cardId'> | null | undefined): boolean {
  return !!story && !story.cardId && (story.status === 'draft' || story.status === 'ready') && !!`${story.title ?? ''}`.trim();
}

/** Número do card convertido como texto (`"123"`), ou null. */
export function storyCardId(story: Pick<EpicStory, 'cardId'> | null | undefined): string | null {
  const raw = `${story?.cardId ?? ''}`.trim().replace(/^#/, '');
  return /^\d+$/.test(raw) && Number(raw) > 0 ? `${Number(raw)}` : null;
}

// ── Filtro e ordem ───────────────────────────────────────────────────────────────────────────

export type StoryFilter = 'all' | EpicStoryStatus;

export const STORY_FILTERS: readonly { key: StoryFilter; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'draft', label: 'Rascunhos' },
  { key: 'ready', label: 'Prontas' },
  { key: 'converted', label: 'Convertidas' },
  { key: 'discarded', label: 'Descartadas' }
];

export function parseStoryFilter(value: string | null | undefined): StoryFilter {
  return (STORY_FILTERS.some((f) => f.key === value) ? value : 'all') as StoryFilter;
}

const STATUS_RANK: Record<EpicStoryStatus, number> = { draft: 0, ready: 1, converted: 2, discarded: 3 };

/** Ordem da lista: rascunhos, prontas, convertidas, descartadas; dentro do status, a mais recente primeiro. */
export function sortStories<T extends Pick<EpicStory, 'status' | 'updatedAt' | 'number'>>(stories: readonly T[]): T[] {
  const rank = (s: T) => STATUS_RANK[s.status] ?? 0;
  return stories.slice().sort((a, b) =>
    rank(a) - rank(b) || (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) || b.number - a.number);
}

/** "Todas" = todas (as descartadas no fim); o resto = o status. */
export function filterStories<T extends Pick<EpicStory, 'status' | 'updatedAt' | 'number'>>(stories: readonly T[], filter: StoryFilter): T[] {
  return sortStories(filter === 'all' ? stories : stories.filter((s) => s.status === filter));
}

export function countByStoryFilter(stories: readonly Pick<EpicStory, 'status'>[]): Record<StoryFilter, number> {
  const out = { all: stories.length, draft: 0, ready: 0, converted: 0, discarded: 0 } as Record<StoryFilter, number>;
  for (const s of stories) if (s.status in STATUS_RANK) out[s.status]++;
  return out;
}

/** Contagem da aba: as que ainda vão virar card (rascunhos + prontas). */
export function openStoryCount(stories: readonly Pick<EpicStory, 'status'>[]): number {
  return stories.filter((s) => s.status === 'draft' || s.status === 'ready').length;
}

// ── Prioridade e severidade ──────────────────────────────────────────────────────────────────

export const STORY_PRIORITIES: readonly { value: number; label: string; hint: string }[] = [
  { value: 1, label: '1', hint: 'mais alta' },
  { value: 2, label: '2', hint: 'alta' },
  { value: 3, label: '3', hint: 'média' },
  { value: 4, label: '4', hint: 'baixa' }
];

/** Severidade padrão do processo Agile do DevOps (quando a lista do projeto não vem). */
export const DEFAULT_SEVERITIES: readonly string[] = ['1 - Critical', '2 - High', '3 - Medium', '4 - Low'];

/** Valores da severidade: os do campo do DevOps (`GET DevOps/meta/fields?type=Bug`), senão os padrões. */
export function severityValues(defs: readonly Pick<DevOpsFieldDef, 'referenceName' | 'allowedValues'>[] | null | undefined): string[] {
  const f = (defs ?? []).find((d) => d.referenceName === F.severity);
  const list = (f?.allowedValues ?? []).map((v) => `${v ?? ''}`.trim()).filter(Boolean);
  return list.length ? list : [...DEFAULT_SEVERITIES];
}

/** Prioridade válida (1–4) ou null. */
export function normalizePriority(value: unknown): number | null {
  const n = Number(value);
  return value != null && value !== '' && Number.isInteger(n) && n >= 1 && n <= 4 ? n : null;
}

// ── Campos do DevOps guardados na história ──────────────────────────────────────────────────

/** Campos editados pelos `app-devops-field-input` (a referência do DevOps é a chave em `fields`). */
export const STORY_FIELD_DEFS: readonly DevOpsFieldDef[] = [
  { referenceName: F.area, name: 'Área', type: 'treePath', required: false, readOnly: false, allowedValues: [] },
  { referenceName: F.iteration, name: 'Iteração', type: 'treePath', required: false, readOnly: false, allowedValues: [] },
  { referenceName: F.assignedTo, name: 'Responsável', type: 'identity', required: false, readOnly: false, allowedValues: [] }
];

/** Pessoa como o DevOps aceita gravar: `Nome <email>` (só o e-mail quando não há nome). */
export function identityText(value: unknown): string | null {
  const key = identityKey(value);
  if (!key) return null;
  const name = identityName(value);
  return name && name !== key ? `${name} <${key}>` : key;
}

/** `fields` a gravar: sem vazios, texto aparado e pessoa como `Nome <email>`. */
export function normalizeStoryFields(fields: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [ref, raw] of Object.entries(fields ?? {})) {
    if (!ref) continue;
    let v: unknown = raw;
    if (ref === F.assignedTo) v = identityText(raw);
    else if (typeof raw === 'string') v = raw.trim();
    if (v == null || v === '') continue;
    out[ref] = v;
  }
  return out;
}

/** Valor do campo para mostrar (pessoa pelo nome). */
export function storyFieldText(ref: string, value: unknown): string {
  if (value == null || value === '') return '';
  return ref === F.assignedTo ? identityName(value) : `${value}`;
}

// ── Editor ───────────────────────────────────────────────────────────────────────────────────

export const STORY_TITLE_MAX = 300;

/** O que o editor tem em mãos. */
export interface StoryDraft {
  type: EpicStoryType;
  title: string;
  description: string;
  acceptanceCriteria: string;
  reproSteps: string;
  priority: number | null;
  severity: string | null;
  tags: string[];
  fields: Record<string, unknown>;
  status: 'draft' | 'ready';
}

export function emptyStoryDraft(type: EpicStoryType = 'user-story'): StoryDraft {
  return {
    type, title: '', description: '', acceptanceCriteria: '', reproSteps: '', priority: null,
    severity: null, tags: [], fields: {}, status: 'draft'
  };
}

export function storyToDraft(s: EpicStory): StoryDraft {
  return {
    type: s.type === 'bug' ? 'bug' : 'user-story',
    title: s.title ?? '',
    description: s.description ?? '',
    acceptanceCriteria: s.acceptanceCriteria ?? '',
    reproSteps: s.reproSteps ?? '',
    priority: normalizePriority(s.priority),
    severity: s.severity || null,
    tags: [...(s.tags ?? [])],
    fields: { ...(s.fields ?? {}) },
    status: s.status === 'ready' ? 'ready' : 'draft'
  };
}

export interface StoryValidation {
  /** Impedem salvar. */
  errors: string[];
  /** Recomendações (não impedem). */
  warnings: string[];
  ok: boolean;
}

/**
 * Regras do editor: título obrigatório (até 300); História sem critérios de aceite → recomendação; Bug sem passos de
 * reprodução → recomendação no rascunho e erro ao marcar como pronta (o bug pronto precisa dizer como reproduzir).
 */
export function validateStory(d: Pick<StoryDraft, 'type' | 'title' | 'acceptanceCriteria' | 'reproSteps' | 'status'> & { fields?: Record<string, unknown> },
  required: readonly DevOpsFieldDef[] = []): StoryValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  // Card 1109 (E1093): o DevOps recusa o card sem os obrigatórios do tipo (ex.: Module da User Story).
  const missing = missingStoryFields(required, d.fields ?? {}).map((f) => f.name);
  if (missing.length) {
    const what = `${missing.join(', ')} (o DevOps exige para virar card)`;
    if (d.status === 'ready') errors.push(`Preencha ${what}.`);
    else warnings.push(`Falta ${what}.`);
  }
  const title = `${d.title ?? ''}`.trim();
  if (!title) errors.push('Dê um título.');
  else if (title.length > STORY_TITLE_MAX) errors.push(`O título passa de ${STORY_TITLE_MAX} caracteres.`);
  if (d.type === 'bug') {
    if (!`${d.reproSteps ?? ''}`.trim()) {
      if (d.status === 'ready') errors.push('Bug pronto precisa dos passos de reprodução.');
      else warnings.push('Bug pede os passos de reprodução (o que fazer para ver o erro, o esperado e o que acontece).');
    }
  } else if (!`${d.acceptanceCriteria ?? ''}`.trim()) {
    warnings.push('Recomendado: critérios de aceite (como saber que a história está pronta).');
  }
  return { errors, warnings, ok: !errors.length };
}

/** Obrigatórios do DevOps ainda vazios nos campos da história. */
export function missingStoryFields(required: readonly DevOpsFieldDef[], fields: Record<string, unknown>): DevOpsFieldDef[] {
  return required.filter((f) => {
    const v = fields[f.referenceName];
    return v == null || (typeof v === 'string' && v.trim() === '');
  });
}

/** Corpo do salvar: só o texto do tipo (critérios na História, passos no Bug; severidade só no Bug). */
export function buildSaveStory(d: StoryDraft): SaveEpicStoryRequest {
  const text = (v: string | null | undefined) => `${v ?? ''}`.trim() || null;
  const bug = d.type === 'bug';
  return {
    type: d.type,
    title: `${d.title ?? ''}`.trim(),
    description: text(d.description),
    acceptanceCriteria: bug ? null : text(d.acceptanceCriteria),
    reproSteps: bug ? text(d.reproSteps) : null,
    priority: normalizePriority(d.priority),
    severity: bug ? (text(d.severity) ?? null) : null,
    tags: normalizeStoryTags(d.tags),
    fields: normalizeStoryFields(d.fields),
    status: d.status === 'ready' ? 'ready' : 'draft'
  };
}

function normalizeStoryTags(tags: readonly (string | null | undefined)[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags ?? []) {
    const v = `${t ?? ''}`.trim().replace(/\s+/g, ' ');
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
  }
  return out;
}

// ── Conversão ────────────────────────────────────────────────────────────────────────────────

/** Colunas do board onde o card do tipo pode entrar (as que mapeiam o tipo); nenhuma mapeia → todas. */
export function storyBoardColumns<T extends Pick<BoardColumn, 'name' | 'stateMappings'>>(columns: readonly T[] | null | undefined, devOpsType: string): T[] {
  const all = [...(columns ?? [])];
  const ok = all.filter((c) => canAccept(c, devOpsType));
  return ok.length ? ok : all;
}

/** O que falta/recomenda antes de converter (mostrado na confirmação; não impede). */
export function convertWarnings(s: Pick<EpicStory, 'type' | 'status' | 'acceptanceCriteria' | 'reproSteps' | 'description'>): string[] {
  const out: string[] = [];
  if (s.type === 'bug' && !`${s.reproSteps ?? ''}`.trim()) out.push('O bug está sem passos de reprodução.');
  if (s.type !== 'bug' && !`${s.acceptanceCriteria ?? ''}`.trim()) out.push('A história está sem critérios de aceite.');
  if (!`${s.description ?? ''}`.trim()) out.push('Sem descrição.');
  if (s.status === 'draft') out.push('Ainda está como rascunho.');
  return out;
}

// ── Erros da API ─────────────────────────────────────────────────────────────────────────────

export interface StoryApiError {
  code: string | null;
  message: string;
  /** `alreadyConverted`: o card que já existe. */
  cardId: string | null;
  /** `required_fields` (422): os campos obrigatórios do DevOps que faltaram. */
  fields?: DevOpsFieldDef[];
}

/** Erro da API das histórias (`{code, message, cardId}`, `{error}` ou texto) com mensagens dos 409 conhecidos. */
export function storyApiError(err: unknown, fallback: string): StoryApiError {
  const e = err as { error?: unknown; status?: number } | null | undefined;
  const body = e?.error as { code?: string; message?: string; error?: string; title?: string; cardId?: unknown } | string | null | undefined;
  if (typeof body === 'string' && body.trim()) return { code: null, message: body.trim(), cardId: null };
  const code = body && typeof body === 'object' ? body.code ?? null : null;
  const cardId = body && typeof body === 'object' ? storyCardId({ cardId: body.cardId as string | number | null }) : null;
  if (code === 'alreadyConverted') {
    return { code, cardId, message: cardId ? `Esta história já virou o card #${cardId}.` : 'Esta história já virou card.' };
  }
  if (code === 'notEditable') return { code, cardId, message: 'História convertida não se edita mais — mude o card no DevOps.' };
  const msg = body && typeof body === 'object' ? body.message || body.error || body.title : null;
  const fields = body && typeof body === 'object' && Array.isArray((body as { fields?: unknown }).fields)
    ? (body as { fields: DevOpsFieldDef[] }).fields : undefined;
  if (msg) return fields ? { code, cardId, message: msg, fields } : { code, cardId, message: msg };
  if (e?.status === 0) return { code: null, cardId: null, message: 'Sem conexão com o PRMake.' };
  return { code, cardId, message: fallback };
}
