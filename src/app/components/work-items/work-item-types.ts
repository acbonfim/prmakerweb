import { WI_BUG_COLOR, WI_BUG_ICON, WI_US_COLOR, WI_US_ICON } from '../../helpers/work-item-type-icons';

/**
 * 0085 rodada 4 — **tipos do item de trabalho** (≠ tipo do card no DevOps). Um item é uma tarefa (abrir PR, revisar PR,
 * fechamento…), não uma US/Bug: os tipos vêm do catálogo (`catalog.itemTypes`, configuráveis em Skills Configurations
 * `WorkItemTypes`) com a reserva local abaixo (os semeados). `bug`/`user-story` só aparecem em itens antigos (exibição,
 * com a joaninha/livrinho) e não são oferecidos ao criar.
 */
export interface WorkItemTypeInfo {
  key: string;
  label: string;
  /** Ícone do Material (ligadura). */
  icon?: string | null;
  color?: string | null;
  description?: string | null;
}

/** Os tipos semeados (reserva quando o catálogo não traz `itemTypes`). */
export const DEFAULT_ITEM_TYPES: readonly WorkItemTypeInfo[] = [
  { key: 'task', label: 'Tarefa', icon: 'task_alt', color: '#58a6ff', description: 'Tarefa simples do card.' },
  { key: 'pull-request', label: 'Pull request', icon: 'merge', color: '#a371f7', description: 'Branch, cherry-pick e PR para um destino.' },
  { key: 'review', label: 'Revisão de PR', icon: 'rate_review', color: '#d29922', description: 'Revisar um pull request.' },
  { key: 'analysis', label: 'Análise', icon: 'manage_search', color: '#39c5cf', description: 'Análise do card (plano de análise).' },
  { key: 'fix', label: 'Correção', icon: 'build', color: '#ff7b72', description: 'Correção de código (plano de correção do bug).' },
  { key: 'implementation', label: 'Implementação', icon: 'construction', color: '#3fb950', description: 'Implementação da US (plano de correção da US).' },
  { key: 'adjustment', label: 'Ajuste', icon: 'tune', color: '#e3b341', description: 'Ajuste depois de QA/revisão.' },
  { key: 'closing', label: 'Fechamento', icon: 'flag', color: '#8b949e', description: 'Root cause, classificação, resumo e estado do card.' },
  { key: 'data', label: 'Dados/Script', icon: 'storage', color: '#db61a2', description: 'Consultas e scripts de dados.' },
  { key: 'ticket', label: 'Chamado', icon: 'confirmation_number', color: '#f0883e', description: 'Chamado para outra equipe.' },
  { key: 'text', label: 'Textos/Resumo', icon: 'description', color: '#79c0ff', description: 'Resumo PT/EN, comentários e textos.' },
  { key: 'validation', label: 'Validação', icon: 'verified', color: '#56d364', description: 'Validar a demanda num ambiente, com prints de evidência.' }
];

/** Tipos legados (itens antigos): só exibição. */
export const LEGACY_ITEM_TYPES: ReadonlySet<string> = new Set(['bug', 'user-story']);

/** Tipo padrão de um item novo sem modelo. */
export const DEFAULT_ITEM_TYPE = 'task';

/** Tipos do catálogo (válidos), senão os semeados. */
export function itemTypes(catalog?: { itemTypes?: WorkItemTypeInfo[] | null } | null): WorkItemTypeInfo[] {
  const list = (catalog?.itemTypes ?? []).filter((t) => t && `${t.key ?? ''}`.trim());
  return list.length ? list.map((t) => ({ ...t, key: `${t.key}`.trim(), label: `${t.label ?? ''}`.trim() || `${t.key}` })) : [...DEFAULT_ITEM_TYPES];
}

/** Tipos oferecidos ao criar (sem os legados). */
export function offeredItemTypes(catalog?: { itemTypes?: WorkItemTypeInfo[] | null } | null): WorkItemTypeInfo[] {
  return itemTypes(catalog).filter((t) => !LEGACY_ITEM_TYPES.has(t.key.toLowerCase()));
}

/** Tipo inicial do item novo: o do modelo (se oferecido), senão `task` (ou o primeiro oferecido). */
export function defaultItemType(templateType: string | null | undefined, catalog?: { itemTypes?: WorkItemTypeInfo[] | null } | null): string {
  const offered = offeredItemTypes(catalog);
  const wanted = `${templateType ?? ''}`.trim().toLowerCase();
  const hit = offered.find((t) => t.key.toLowerCase() === wanted);
  if (hit) return hit.key;
  return offered.find((t) => t.key === DEFAULT_ITEM_TYPE)?.key ?? offered[0]?.key ?? DEFAULT_ITEM_TYPE;
}

/** Aparência do tipo do item: SVG (legados), ou ícone + cor do tipo. */
export interface ItemTypeLook {
  key: string;
  label: string;
  /** Nome do SVG registrado (joaninha/livrinho) — só itens legados. */
  svg: string | null;
  icon: string;
  color: string | null;
}

export function itemTypeLook(type: string | null | undefined, catalog?: { itemTypes?: WorkItemTypeInfo[] | null } | null): ItemTypeLook {
  const key = `${type ?? ''}`.trim();
  const lower = key.toLowerCase();
  if (lower === 'bug') return { key, label: 'Bug', svg: WI_BUG_ICON, icon: 'bug_report', color: WI_BUG_COLOR };
  if (lower === 'user-story') return { key, label: 'User Story', svg: WI_US_ICON, icon: 'menu_book', color: WI_US_COLOR };
  const info = itemTypes(catalog).find((t) => t.key.toLowerCase() === lower)
    ?? DEFAULT_ITEM_TYPES.find((t) => t.key === lower);
  if (info) return { key: info.key, label: info.label, svg: null, icon: info.icon || 'task_alt', color: info.color ?? null };
  return { key, label: key || 'Tarefa', svg: null, icon: 'task_alt', color: null };
}
