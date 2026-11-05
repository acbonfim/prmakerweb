import type { TaskKindParam, TaskParamOption, WorkItemCatalog, WorkItemTemplate, WorkItemTemplateTask } from '../work-items/work-item.model';
import { splitTargets } from '../work-item-pickers/param-input';
import { defaultItemType, itemTypeLook } from '../work-items/work-item-types';

/**
 * 0085 rodada 4 — lógica pura das **Ferramentas do especialista** (sem Angular, testada em specialist-tools.logic.spec.ts):
 * as ferramentas são os modelos do catálogo (`GET WorkItems/catalog?card=` → `templates`) com os campos opcionais da
 * rodada 4 (`when`, `ask`, `applicable`, `reason` e, se vierem, `group`/`icon`). Aqui ficam o grupo de cada ferramenta,
 * o ícone, se ela se aplica ao card, a busca, as respostas iniciais dos `ask`, a prévia das sub-tarefas (os marcadores
 * `{ask:x}`, `{suffix:@x}`… trocados no cliente só para mostrar) e a mensagem do "Pedir ao especialista".
 */

/** Pergunta da ferramenta (`templates[].ask[]`) — `options`/`default` já resolvidos pelo servidor quando ele sabe. */
export interface ToolAsk {
  key: string;
  label?: string | null;
  input?: string | null;
  /** Lista resolvida; texto (ex.: "{promotionTargets}") = o servidor não resolveu — vira sem opções. */
  options?: TaskParamOption[] | string | null;
  default?: string | null;
  required?: boolean | null;
  placeholder?: string | null;
}

/** Quando a ferramenta se aplica (o servidor filtra; o cliente só usa como reserva para `type`). */
export interface ToolWhen {
  type?: string[] | null;
  flow?: string[] | null;
  repoKinds?: string[] | null;
  states?: string[] | null;
}

/** Modelo do catálogo com os campos da rodada 4. */
export interface SpecialistTool extends WorkItemTemplate {
  when?: ToolWhen | null;
  ask?: ToolAsk[] | null;
  applicable?: boolean | null;
  reason?: string | null;
  group?: string | null;
  icon?: string | null;
}

export type ToolGroupKey = 'prs' | 'ajustes' | 'qa' | 'dados' | 'textos' | 'outras';

export const TOOL_GROUPS: readonly { key: ToolGroupKey; label: string; icon: string }[] = [
  { key: 'prs', label: 'PRs e promoção', icon: 'call_split' },
  { key: 'ajustes', label: 'Ajustes', icon: 'build' },
  { key: 'qa', label: 'QA e fechamento', icon: 'fact_check' },
  { key: 'dados', label: 'Dados e chamado', icon: 'storage' },
  { key: 'textos', label: 'Textos', icon: 'translate' },
  { key: 'outras', label: 'Outras', icon: 'widgets' }
];

/** Ferramentas conhecidas (F1–F15 + modelos já semeados) → grupo. */
const KNOWN_GROUPS: Record<string, ToolGroupKey> = {
  'pr-para-branch': 'prs',
  'prs-fluxo-producao': 'prs',
  'promover-revamp': 'prs',
  'pr-hotfix-version': 'prs',
  'pr-release-version': 'prs',
  'resolver-conflito-promocao': 'prs',
  'revisar-pr': 'prs',
  'ajuste-pos-qa': 'ajustes',
  'usar-termo-existente': 'ajustes',
  'corrigir-sonar': 'ajustes',
  'replicar-correcao': 'ajustes',
  'fechamento-code-fix': 'qa',
  'validar-em-qa': 'qa',
  'fechamento-sem-codigo': 'qa',
  'fechar-como-duplicado': 'qa',
  'mover-card': 'qa',
  'script-com-chamado': 'dados',
  'diagnostico-usuario': 'dados',
  'abrir-chamado': 'dados',
  'novo-resumo': 'textos'
};

const KNOWN_ICONS: Record<string, string> = {
  'pr-para-branch': 'call_split',
  'prs-fluxo-producao': 'alt_route',
  'promover-revamp': 'rocket_launch',
  'pr-hotfix-version': 'local_fire_department',
  'pr-release-version': 'new_releases',
  'resolver-conflito-promocao': 'merge',
  'revisar-pr': 'rate_review',
  'ajuste-pos-qa': 'build',
  'usar-termo-existente': 'translate',
  'corrigir-sonar': 'verified',
  'fechamento-code-fix': 'task_alt',
  'validar-em-qa': 'fact_check',
  'fechamento-sem-codigo': 'support_agent',
  'mover-card': 'swap_horiz',
  'script-com-chamado': 'storage',
  'diagnostico-usuario': 'person_search',
  'abrir-chamado': 'confirmation_number',
  'novo-resumo': 'notes'
};

const GROUP_ALIASES: Record<string, ToolGroupKey> = {
  prs: 'prs', pr: 'prs', promocao: 'prs', 'prs e promocao': 'prs', promotion: 'prs',
  ajustes: 'ajustes', ajuste: 'ajustes', fix: 'ajustes',
  qa: 'qa', fechamento: 'qa', 'qa e fechamento': 'qa', closing: 'qa',
  dados: 'dados', chamado: 'dados', 'dados e chamado': 'dados', data: 'dados', 'dados/chamado': 'dados',
  textos: 'textos', texto: 'textos', text: 'textos', texts: 'textos'
};

/** Sem acento e em minúsculas (busca e comparação de grupo). */
export function fold(text: string | null | undefined): string {
  return `${text ?? ''}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function kindsOf(t: Pick<WorkItemTemplate, 'tasks'>): Set<string> {
  return new Set((t.tasks ?? []).map((x) => `${x?.kind ?? ''}`.toLowerCase()));
}

/** Grupo: o `group` do catálogo (se for conhecido), a lista das ferramentas conhecidas, palavras da chave e os kinds. */
export function toolGroup(t: Pick<SpecialistTool, 'key' | 'title' | 'group' | 'tasks'>): ToolGroupKey {
  const declared = GROUP_ALIASES[fold(t.group)];
  if (declared) return declared;
  const key = fold(t.key);
  if (KNOWN_GROUPS[key]) return KNOWN_GROUPS[key];
  const words = `${key} ${fold(t.title)}`;
  if (/resumo|comentario|texto|summary/.test(words)) return 'textos';
  if (/chamado|script|sql|diagnostico|banco|dados/.test(words)) return 'dados';
  if (/fechamento|validar|ready|test-in|mover|classific|encerr/.test(words)) return 'qa';
  if (/ajuste|corrig|sonar|termo|replicar/.test(words)) return 'ajustes';
  if (/(^|[-\s])prs?([-\s]|$)|promov|promoc|branch|release|hotfix|edge|revis/.test(words)) return 'prs';
  const kinds = kindsOf(t);
  if (kinds.has('ticket') || kinds.has('sql-script') || kinds.has('sql-query')) return 'dados';
  if (kinds.has('code')) return 'ajustes';
  if (kinds.has('pr') || kinds.has('pr-review') || kinds.has('branch') || kinds.has('cherry-pick')) return 'prs';
  if (kinds.has('devops-action') || kinds.has('devops-state') || kinds.has('validation')) return 'qa';
  if (kinds.has('comment') || kinds.has('notify') || kinds.has('pr-text')) return 'textos';
  return 'outras';
}

/** Ícone: o do catálogo, o da ferramenta conhecida ou o do grupo. */
export function toolIcon(t: Pick<SpecialistTool, 'key' | 'icon'>, group: ToolGroupKey): string {
  const declared = `${t.icon ?? ''}`.trim();
  if (declared && /^[a-z0-9_]+$/.test(declared)) return declared;
  return KNOWN_ICONS[fold(t.key)] ?? TOOL_GROUPS.find((g) => g.key === group)?.icon ?? 'handyman';
}

const TYPE_LABEL: Record<string, string> = { bug: 'Bug', 'user-story': 'User Story' };

/**
 * Se a ferramenta vale para o card: `applicable` do servidor manda; sem ele, a reserva confere só o tipo do card
 * (`when.type`).
 */
export function toolApplicability(t: Pick<SpecialistTool, 'applicable' | 'reason' | 'when'>, cardType?: string | null): { applicable: boolean; reason: string | null } {
  if (t.applicable === false) return { applicable: false, reason: `${t.reason ?? ''}`.trim() || 'Não se aplica a este card.' };
  if (t.applicable === true) return { applicable: true, reason: null };
  const ct = fold(cardType);
  if (!ct) return { applicable: true, reason: null };
  // `when.type` é o tipo do CARD (bug/user-story); o `type` do modelo é o tipo do item (rodada 4) e não entra aqui.
  const types = (t.when?.type ?? []).map(fold).filter(Boolean);
  if (types.length && !types.includes(ct)) {
    return { applicable: false, reason: `Só para ${types.map((x) => TYPE_LABEL[x] ?? x).join(' ou ')}.` };
  }
  return { applicable: true, reason: null };
}

/** Ferramenta pronta para a tela. */
export interface ToolView {
  key: string;
  title: string;
  description: string;
  icon: string;
  group: ToolGroupKey;
  applicable: boolean;
  reason: string | null;
  ask: ToolAsk[];
  /** Tipo do item que a ferramenta cria (o do modelo, senão `task`) e a cor dele. */
  itemType: string;
  color: string | null;
  tool: SpecialistTool;
}

/** Contexto do card para os marcadores (vem do catálogo `?card=`). */
export interface ToolContext {
  card?: string | null;
  mainBranch?: string | null;
  branchesByTarget?: Record<string, string> | null;
  defaultRepository?: string | null;
  flowTargets?: string | string[] | null;
  qaBranch?: string | null;
}

export function toolContext(catalog: (WorkItemCatalog & { qaBranch?: string | null }) | null | undefined, card?: string | null): ToolContext {
  return {
    card: catalog?.card ?? card ?? null,
    mainBranch: catalog?.mainBranch ?? null,
    branchesByTarget: catalog?.branchesByTarget ?? null,
    defaultRepository: catalog?.defaultRepository ?? null,
    flowTargets: catalog?.flowTargets ?? null,
    qaBranch: catalog?.qaBranch ?? null
  };
}

/** Lista do catálogo → ferramentas (ordem: aplicáveis primeiro, na ordem do catálogo). */
export function buildToolViews(catalog: Pick<WorkItemCatalog, 'templates' | 'itemTypes'> | null | undefined, cardType?: string | null): ToolView[] {
  const list = ((catalog?.templates ?? []) as SpecialistTool[]).filter((t) => t?.key);
  const views = list.map((t) => {
    const group = toolGroup(t);
    const { applicable, reason } = toolApplicability(t, cardType);
    const itemType = defaultItemType(t.type, catalog);
    return {
      key: t.key,
      title: displayTitle(t.title || t.key, t.ask ?? []),
      description: `${t.description ?? ''}`.trim(),
      icon: toolIcon(t, group),
      group,
      applicable,
      reason,
      ask: (t.ask ?? []).filter((a) => a?.key),
      itemType,
      color: itemTypeLook(itemType, catalog).color,
      tool: t
    } satisfies ToolView;
  });
  return [...views.filter((v) => v.applicable), ...views.filter((v) => !v.applicable)];
}

/** Título na lista: `{ask:x}` sem resposta vira "…" (ex.: "Resolver conflito do PR para …"). */
export function displayTitle(title: string, ask: ToolAsk[], answers?: Record<string, string> | null): string {
  return `${title ?? ''}`.replace(/\{ask:([\w.-]+)\}/g, (_, k: string) => `${answers?.[k] ?? ''}`.trim() || '…');
}

/** Busca por título, descrição, chave e nome do grupo (sem acento; todas as palavras precisam aparecer). */
export function filterTools(views: ToolView[], query: string | null | undefined): ToolView[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return views;
  return views.filter((v) => {
    const hay = fold(`${v.title} ${v.description} ${v.key} ${TOOL_GROUPS.find((g) => g.key === v.group)?.label ?? ''}`);
    return words.every((w) => hay.includes(w));
  });
}

export interface ToolGroupView {
  key: ToolGroupKey;
  label: string;
  icon: string;
  tools: ToolView[];
}

/** Agrupa na ordem fixa dos grupos (grupos vazios saem). */
export function groupTools(views: ToolView[]): ToolGroupView[] {
  return TOOL_GROUPS
    .map((g) => ({ ...g, tools: views.filter((v) => v.group === g.key) }))
    .filter((g) => g.tools.length > 0);
}

/** Opções da pergunta (lista resolvida); texto/marcador = sem opções. */
export function askOptions(ask: Pick<ToolAsk, 'options'>): string[] {
  const raw = ask.options;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((o) => (typeof o === 'string' ? o : `${o?.value ?? ''}`))
    .map((x) => x.trim())
    .filter((x) => x && !/^\{[\w:@.-]+\}$/.test(x));
}

/** A pergunta como parâmetro do `app-wi-param-field` (o controle certo pelo `input`). */
export function askToParam(ask: ToolAsk): TaskKindParam {
  const input = `${ask.input ?? ''}`.trim().toLowerCase();
  const options = Array.isArray(ask.options) ? ask.options.filter((o) => (typeof o === 'string' ? !/^\{[\w:@.-]+\}$/.test(o) : true)) : null;
  // Destino/branch com opções continua sendo o autocomplete de branch (as opções viram sugestões).
  const keepOptions = input !== 'target-branch' && input !== 'branch' && input !== 'repository';
  return {
    key: ask.key,
    label: ask.label || ask.key,
    required: isRequired(ask),
    placeholder: ask.placeholder ?? null,
    input: input || (keepOptions && options?.length ? 'select' : null),
    options: keepOptions ? options : null
  };
}

/** Pergunta obrigatória: a não ser que o catálogo diga `required: false` (a ferramenta perguntou porque precisa). */
export function isRequired(ask: Pick<ToolAsk, 'required'>): boolean {
  return ask.required !== false;
}

/** Respostas iniciais: o `default` (marcadores resolvidos no cliente quando o servidor não resolveu). */
export function initialAnswers(ask: ToolAsk[], ctx: ToolContext): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of ask) {
    const raw = `${a.default ?? ''}`;
    const value = raw.includes('{') ? renderMarkers(raw, {}, ctx, { keepUnknown: false }) : raw;
    out[a.key] = value.trim();
  }
  return out;
}

/** Perguntas obrigatórias sem resposta (rótulos). */
export function missingAnswers(ask: ToolAsk[], answers: Record<string, string | null | undefined>): string[] {
  return ask.filter((a) => isRequired(a) && !`${answers[a.key] ?? ''}`.trim()).map((a) => a.label || a.key);
}

/** Sufixos usuais por destino (reserva da prévia quando o catálogo não traz a branch por destino). */
const DEFAULT_SUFFIX: Record<string, string> = {
  'release-version': '-rv',
  'hotfix-version': '-hv',
  development: '-dev',
  qa: '-qa',
  edge: '-edge',
  master: ''
};

/** Sufixo do destino: tirado da branch por destino do catálogo (hotfix/77434-rv − hotfix/77434), ou o usual. */
export function suffixFor(target: string, ctx: ToolContext): string {
  const t = `${target ?? ''}`.trim();
  if (!t) return '';
  const main = `${ctx.mainBranch ?? ''}`.trim();
  const byTarget = branchFor(t, ctx);
  if (byTarget && main && byTarget.startsWith(main)) return byTarget.slice(main.length);
  const known = DEFAULT_SUFFIX[t.toLowerCase()];
  if (known !== undefined) return known;
  return `-${t.replace(/[^\w.-]+/g, '-')}`;
}

function branchFor(target: string, ctx: ToolContext): string | null {
  const map = ctx.branchesByTarget ?? {};
  const hit = Object.keys(map).find((k) => k.toLowerCase() === target.toLowerCase());
  return hit ? `${map[hit] ?? ''}`.trim() || null : null;
}

/**
 * Troca os marcadores para a **prévia** (o servidor renderiza de verdade ao criar): `{ask:x}`, `{branch}{suffix:@x}` /
 * `{suffix:destino}` (branch por destino do catálogo ou sufixo usual), `{branch}`, `{repository}`, `{card}`,
 * `{qaBranch}`, `{flowTargets}`/`{promotionTargets}`. Sem valor: `{ask:x}` vira "…"; os outros ficam como estão
 * (`keepUnknown`) ou somem.
 */
export function renderMarkers(text: string, answers: Record<string, string | null | undefined>, ctx: ToolContext, opts: { keepUnknown?: boolean; promotionTargets?: string[] } = {}): string {
  const keep = opts.keepUnknown !== false;
  const main = `${ctx.mainBranch ?? ''}`.trim();
  const targetOf = (spec: string) => (spec.startsWith('@') ? `${answers[spec.slice(1)] ?? ''}`.trim() : spec.trim());
  let out = `${text ?? ''}`;
  // Branch + sufixo: a branch por destino inteira, quando o catálogo conhece (padrões como "_hotfix/77434-rv").
  const branchPrefixes = ['{branch}', ...(main ? [main] : [])].map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  out = out.replace(new RegExp(`(${branchPrefixes.join('|')})\\{suffix:([@\\w.-]+)\\}`, 'g'), (whole, _b: string, spec: string) => {
    const target = targetOf(spec);
    if (!target) return keep ? `${main || '{branch}'}-…` : '';
    return branchFor(target, ctx) ?? `${main || '{branch}'}${suffixFor(target, ctx)}`;
  });
  out = out.replace(/\{suffix:([@\w.-]+)\}/g, (_, spec: string) => {
    const target = targetOf(spec);
    return target ? suffixFor(target, ctx) : keep ? '-…' : '';
  });
  out = out.replace(/\{ask:([\w.-]+)\}/g, (_, k: string) => `${answers[k] ?? ''}`.trim() || (keep ? '…' : ''));
  const flow = splitTargets(ctx.flowTargets);
  const promo = opts.promotionTargets?.length ? opts.promotionTargets : flow;
  const known: Record<string, string> = {
    branch: main,
    repository: `${ctx.defaultRepository ?? ''}`.trim(),
    card: `${ctx.card ?? ''}`.trim(),
    qabranch: `${ctx.qaBranch ?? ''}`.trim() || 'qa',
    flowtargets: flow.join(', '),
    promotiontargets: promo.join(', ')
  };
  out = out.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = known[name.toLowerCase()];
    if (v) return v;
    return keep ? whole : '';
  });
  return out;
}

export interface PreviewTask {
  title: string;
  kind: string;
  /** Parâmetros já trocados (só os com valor), para o detalhe da prévia. */
  params: { key: string; value: string }[];
}

/** Prévia das sub-tarefas com as respostas (o `{repository}` padrão é o repositório respondido, se houver). */
export function previewTasks(tool: Pick<SpecialistTool, 'tasks' | 'ask'>, answers: Record<string, string | null | undefined>, ctx: ToolContext): PreviewTask[] {
  const promotionTargets = (tool.ask ?? []).flatMap((a) => askOptions(a));
  return (tool.tasks ?? []).map((t: WorkItemTemplateTask) => ({
    title: renderMarkers(t.title, answers, ctx, { promotionTargets }),
    kind: `${t.kind ?? ''}`,
    params: Object.entries(t.params ?? {})
      .map(([key, value]) => ({ key, value: renderMarkers(`${value ?? ''}`, answers, ctx, { promotionTargets }).trim() }))
      .filter((p) => p.value)
  }));
}

/** Respostas como texto ("Repositório: edv-solvace-api; Branch de destino: release-version"). */
export function answersText(ask: ToolAsk[], answers: Record<string, string | null | undefined>): string {
  return ask
    .map((a) => ({ label: a.label || a.key, value: `${answers[a.key] ?? ''}`.trim() }))
    .filter((x) => x.value)
    .map((x) => `${x.label}: ${x.value}`)
    .join('; ');
}

/**
 * Mensagem do "Pedir ao especialista" na conversa do caso — `@especialista` faz o servidor chamá-lo mesmo com várias
 * pessoas na conversa; a chave da ferramenta deixa ele rodar `prmake_tool_run` sem adivinhar.
 */
export function specialistToolMessage(tool: Pick<ToolView, 'key' | 'title'>, ask: ToolAsk[], answers: Record<string, string | null | undefined>, note?: string | null, itemType?: string | null): string {
  const given = answersText(ask, answers);
  const head = `@especialista Use a ferramenta "${tool.title}" (${tool.key})${given ? ` com: ${given}` : ''}.`
    + (`${itemType ?? ''}`.trim() ? ` Tipo do item: ${`${itemType}`.trim()}.` : '');
  const extra = `${note ?? ''}`.trim();
  return [
    head,
    extra ? `Observação: ${extra}` : '',
    'Crie o item de trabalho pela ferramenta (prmake_tool_run) seguindo as regras do PRMake para este card — sem duplicar item existente.'
  ].filter(Boolean).join('\n\n');
}
