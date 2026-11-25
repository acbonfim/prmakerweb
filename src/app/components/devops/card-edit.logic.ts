import { CardDetail, CreateCardRequest, DevOpsFieldDef, F, UpdateCardRequest, identityKey, identityName } from './devops.model';
import { diffTags } from './tags.logic';

/**
 * 0099 (Mesa de gestão): lógica pura da edição de campos do card — qual controle cada campo usa, como agrupar os
 * campos do tipo (principais primeiro), comparar valores e montar o PATCH só com o que mudou (e o POST de criar).
 */

export type FieldInputKind =
  | 'picklist' | 'area' | 'iteration' | 'identity' | 'number' | 'date' | 'boolean' | 'html' | 'multiline' | 'text';

const IDENTITY_FIELDS = new Set(['System.AssignedTo', 'System.CreatedBy', 'System.ChangedBy', 'Microsoft.VSTS.Common.ActivatedBy',
  'Microsoft.VSTS.Common.ResolvedBy', 'Microsoft.VSTS.Common.ClosedBy']);

/** Controle do campo conforme o tipo do DevOps (picklist quando há `allowedValues`). */
export function inputKind(f: Pick<DevOpsFieldDef, 'type' | 'referenceName' | 'allowedValues'>): FieldInputKind {
  const t = `${f.type ?? ''}`;
  // Campos de pessoa conhecidos valem como identidade mesmo quando o DevOps devolve o tipo "string".
  if (t === 'identity' || IDENTITY_FIELDS.has(f.referenceName)) return 'identity';
  if (t === 'treePath') return f.referenceName === F.iteration ? 'iteration' : 'area';
  if (t === 'boolean') return 'boolean';
  if (f.allowedValues?.length) return 'picklist';
  if (t === 'integer' || t === 'double' || t === 'picklistInteger') return 'number';
  if (t === 'dateTime') return 'date';
  if (t === 'html') return 'html';
  if (t === 'plainText') return 'multiline';
  return 'text';
}

/** Campos que a tela não edita como campo comum (título/estado/tags têm controle próprio; o resto é do sistema). */
const HIDDEN = new Set<string>([
  F.title, F.state, F.tags, F.workItemType, F.history, F.reason,
  'System.Id', 'System.Rev', 'System.TeamProject', 'System.AreaId', 'System.IterationId', 'System.NodeName',
  'System.Watermark', 'System.AuthorizedAs', 'System.AuthorizedDate', 'System.RevisedDate', 'System.PersonId',
  'System.BoardColumn', 'System.BoardColumnDone', 'System.BoardLane', 'System.AreaLevel1', 'System.AreaLevel2',
  'System.CommentCount', 'System.ExternalLinkCount', 'System.HyperLinkCount', 'System.AttachedFileCount',
  'System.RelatedLinkCount', 'System.RemoteLinkCount', 'System.Parent', 'System.Links.LinkType',
  'Microsoft.VSTS.Common.StackRank', 'Microsoft.VSTS.Common.BacklogPriority', 'System.IsDeleted',
]);

/** Principais, na ordem em que aparecem (como o cabeçalho do formulário do DevOps). */
export const MAIN_FIELDS = [F.assignedTo, F.area, F.iteration, F.priority, F.severity];
/** Textos longos conhecidos (sempre aparecem quando o tipo tem o campo). */
export const TEXT_FIELDS = [F.description, F.reproSteps, F.acceptance, F.systemInfo];

export function isHiddenField(ref: string): boolean {
  return HIDDEN.has(ref) || /^WEF_/i.test(ref) || /_Kanban\./i.test(ref);
}

export function hasValue(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

export interface FieldGroups {
  main: DevOpsFieldDef[];
  texts: DevOpsFieldDef[];
  others: DevOpsFieldDef[];
  readOnly: DevOpsFieldDef[];
}

const byName = (a: DevOpsFieldDef, b: DevOpsFieldDef) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });

/**
 * Agrupa os campos do tipo: principais (responsável, área, iteração, prioridade, severidade e as picklists),
 * textos (descrição, passos…), outros (editáveis com valor ou obrigatórios — todos com `showAll`) e somente
 * leitura (com valor).
 */
export function groupFields(defs: DevOpsFieldDef[], values: Record<string, unknown>, showAll = false): FieldGroups {
  const main: DevOpsFieldDef[] = [];
  const texts: DevOpsFieldDef[] = [];
  const others: DevOpsFieldDef[] = [];
  const readOnly: DevOpsFieldDef[] = [];
  const pickExtra: DevOpsFieldDef[] = [];
  for (const f of defs) {
    if (isHiddenField(f.referenceName)) continue;
    const v = values[f.referenceName];
    if (f.readOnly) {
      if (hasValue(v)) readOnly.push(f);
      continue;
    }
    const kind = inputKind(f);
    if (MAIN_FIELDS.includes(f.referenceName as (typeof MAIN_FIELDS)[number])) { main.push(f); continue; }
    if (kind === 'html' || kind === 'multiline') {
      if (TEXT_FIELDS.includes(f.referenceName as (typeof TEXT_FIELDS)[number]) || f.required || hasValue(v) || showAll) texts.push(f);
      continue;
    }
    if (kind === 'picklist' && !f.referenceName.startsWith('System.')) { pickExtra.push(f); continue; }
    if (showAll || f.required || hasValue(v)) others.push(f);
  }
  main.sort((a, b) => MAIN_FIELDS.indexOf(a.referenceName as never) - MAIN_FIELDS.indexOf(b.referenceName as never));
  texts.sort((a, b) => {
    const ia = TEXT_FIELDS.indexOf(a.referenceName as never);
    const ib = TEXT_FIELDS.indexOf(b.referenceName as never);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || byName(a, b);
  });
  return { main: [...main, ...pickExtra.sort(byName)], texts, others: others.sort(byName), readOnly: readOnly.sort(byName) };
}

/** Campos do diálogo de criar: comuns (descrição/passos, área, iteração, responsável, prioridade) + obrigatórios. */
export function createFields(defs: DevOpsFieldDef[]): DevOpsFieldDef[] {
  const common = [F.assignedTo, F.area, F.iteration, F.priority, F.description, F.reproSteps] as string[];
  const out: DevOpsFieldDef[] = [];
  for (const ref of common) {
    const f = defs.find((d) => d.referenceName === ref && !d.readOnly);
    if (f) out.push(f);
  }
  const required = defs
    .filter((d) => d.required && !d.readOnly && !isHiddenField(d.referenceName) && !out.includes(d))
    .sort(byName);
  // Textos longos por último, como no formulário do DevOps.
  const isText = (d: DevOpsFieldDef) => ['html', 'multiline'].includes(inputKind(d));
  const all = [...out, ...required];
  return [...all.filter((d) => !isText(d)), ...all.filter(isText)];
}

const blank = (v: unknown) => v == null || (typeof v === 'string' && v.trim() === '');

/** Valores iguais para o campo (identidade pelo uniqueName; número pelo valor; vazio = nulo). */
export function sameValue(f: Pick<DevOpsFieldDef, 'type' | 'referenceName' | 'allowedValues'> | undefined, a: unknown, b: unknown): boolean {
  if (blank(a) && blank(b)) return true;
  if (blank(a) !== blank(b)) return false;
  const kind = f ? inputKind(f) : 'text';
  if (kind === 'identity') return identityKey(a).toLowerCase() === identityKey(b).toLowerCase();
  if (kind === 'number') return Number(a) === Number(b);
  if (kind === 'boolean') return !!a === !!b;
  if (kind === 'date') return `${a}`.slice(0, 10) === `${b}`.slice(0, 10);
  return `${a}` === `${b}`;
}

/** Valor como vai para o servidor (vazio → `null`, que limpa o campo; identidade → uniqueName; número → number). */
export function outgoingValue(f: Pick<DevOpsFieldDef, 'type' | 'referenceName' | 'allowedValues'> | undefined, v: unknown): unknown {
  if (blank(v)) return null;
  const kind = f ? inputKind(f) : 'text';
  if (kind === 'identity') return identityKey(v) || null;
  if (kind === 'number') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (kind === 'boolean') return !!v;
  if (kind === 'picklist' && ['picklistInteger', 'integer', 'double'].includes(`${f?.type}`)) {
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  }
  return v;
}

/**
 * PATCH do card só com o que mudou: campos alterados (vazio limpa), título, tags (adicionar/remover) e comentário.
 * Nada mudou → `null`.
 */
export function buildPatch(
  original: Pick<CardDetail, 'title' | 'fields' | 'tags'>,
  defs: DevOpsFieldDef[],
  values: Record<string, unknown>,
  title: string,
  tags: string[],
  comment = ''
): UpdateCardRequest | null {
  const byRef = new Map(defs.map((d) => [d.referenceName, d]));
  const fields: Record<string, unknown> = {};
  for (const [ref, v] of Object.entries(values)) {
    const def = byRef.get(ref);
    if (def?.readOnly) continue;
    if (!sameValue(def, original.fields?.[ref], v)) fields[ref] = outgoingValue(def, v);
  }
  const t = (title ?? '').trim();
  if (t && t !== (original.title ?? '').trim()) fields[F.title] = t;
  const { addTags, removeTags } = diffTags(original.tags ?? [], tags);
  const c = (comment ?? '').trim();
  const body: UpdateCardRequest = {};
  if (Object.keys(fields).length) body.fields = fields;
  if (addTags.length) body.addTags = addTags;
  if (removeTags.length) body.removeTags = removeTags;
  if (c) body.comment = c;
  return Object.keys(body).length ? body : null;
}

/** Campos alterados (para marcar na tela). */
export function changedFields(original: Pick<CardDetail, 'fields'>, defs: DevOpsFieldDef[], values: Record<string, unknown>): Set<string> {
  const byRef = new Map(defs.map((d) => [d.referenceName, d]));
  const out = new Set<string>();
  for (const [ref, v] of Object.entries(values)) {
    const def = byRef.get(ref);
    if (def?.readOnly) continue;
    if (!sameValue(def, original.fields?.[ref], v)) out.add(ref);
  }
  return out;
}

/** Corpo do POST de criar: só campos preenchidos (o título vai à parte). */
export function buildCreate(
  type: string, title: string, defs: DevOpsFieldDef[], values: Record<string, unknown>, tags: string[],
  extra: Omit<CreateCardRequest, 'type' | 'title' | 'fields' | 'tags'> = {}
): CreateCardRequest {
  const byRef = new Map(defs.map((d) => [d.referenceName, d]));
  const fields: Record<string, unknown> = {};
  for (const [ref, v] of Object.entries(values)) {
    if (ref === F.title) continue;
    const out = outgoingValue(byRef.get(ref), v);
    if (out !== null && out !== '') fields[ref] = out;
  }
  const body: CreateCardRequest = { type, title: title.trim(), ...extra };
  if (Object.keys(fields).length) body.fields = fields;
  if (tags.length) body.tags = tags;
  return body;
}

/** Obrigatórios ainda vazios (nomes, para o aviso do diálogo). */
export function missingRequired(defs: DevOpsFieldDef[], values: Record<string, unknown>): string[] {
  return defs.filter((d) => d.required && !d.readOnly && d.referenceName !== F.title && blank(values[d.referenceName]))
    .map((d) => d.name);
}

/** Texto para exibir um valor somente leitura. */
export function displayValue(f: Pick<DevOpsFieldDef, 'type' | 'referenceName' | 'allowedValues'>, v: unknown): string {
  if (blank(v)) return '—';
  switch (inputKind(f)) {
    case 'identity': return identityName(v);
    case 'boolean': return v ? 'Sim' : 'Não';
    case 'date': {
      const d = new Date(`${v}`);
      return isNaN(d.getTime()) ? `${v}` : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    }
    case 'html': return `${v}`.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    default: return typeof v === 'object' ? JSON.stringify(v) : `${v}`;
  }
}

/** Uma alteração pendente, para o "antes × depois" (ajustes 3). */
export interface PendingChange {
  /** referenceName do campo, `tags` ou `comment`. */
  ref: string;
  label: string;
  before: string;
  after: string;
}

/** Texto curto de um valor para o "antes × depois" (HTML vira texto; longo é cortado). */
function shortValue(f: Pick<DevOpsFieldDef, 'type' | 'referenceName' | 'allowedValues'> | undefined, v: unknown, max = 280): string {
  const text = f ? displayValue(f, v) : (blank(v) ? '—' : typeof v === 'object' ? identityName(v) || JSON.stringify(v) : `${v}`);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Lista legível do que mudou (ajustes 3: link "Alterado: n campos" e a confirmação do Salvar): título, cada campo com o
 * valor gravado e o novo, tags somadas/tiradas. Mesma regra do PATCH (`buildPatch`), na ordem dos campos do tipo.
 */
export function describeChanges(
  original: Pick<CardDetail, 'title' | 'fields' | 'tags'>,
  defs: DevOpsFieldDef[],
  values: Record<string, unknown>,
  title: string,
  tags: string[],
): PendingChange[] {
  const out: PendingChange[] = [];
  const t = (title ?? '').trim();
  if (t && t !== (original.title ?? '').trim()) out.push({ ref: F.title, label: 'Título', before: original.title || '—', after: t });
  const byRef = new Map(defs.map((d) => [d.referenceName, d]));
  const order = new Map(defs.map((d, i) => [d.referenceName, i]));
  const refs = Object.keys(values)
    .filter((ref) => !byRef.get(ref)?.readOnly && !sameValue(byRef.get(ref), original.fields?.[ref], values[ref]))
    .sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
  for (const ref of refs) {
    const def = byRef.get(ref);
    out.push({
      ref,
      label: ref === F.state ? 'Estado' : def?.name ?? ref,
      before: shortValue(def, original.fields?.[ref]),
      after: shortValue(def, values[ref]),
    });
  }
  const { addTags, removeTags } = diffTags(original.tags ?? [], tags);
  if (addTags.length || removeTags.length) {
    out.push({
      ref: 'tags',
      label: 'Tags',
      before: (original.tags ?? []).join(', ') || '—',
      after: tags.join(', ') || '—',
    });
  }
  return out;
}

/** "Alterado: 2 campos, tags" (o mesmo resumo da barra), a partir das alterações. */
export function changesLabel(changes: PendingChange[]): string {
  const fields = changes.filter((c) => c.ref !== 'tags' && c.ref !== 'comment').length;
  const parts: string[] = [];
  if (fields) parts.push(`${fields} ${fields === 1 ? 'campo' : 'campos'}`);
  if (changes.some((c) => c.ref === 'tags')) parts.push('tags');
  return parts.length ? `Alterado: ${parts.join(', ')}` : '';
}
