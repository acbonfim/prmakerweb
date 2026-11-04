import type { TimelineEntry } from '../card-timeline/timeline.model';
import type { CardSituation } from '../card-situation/card-situation.service';
import type { ExecutionArtifact, PlanPhase } from '../execution-plan/execution-plan.model';
import { generatedTextLabel, isGeneratedText } from '../generated-texts/generated-texts.model';
import { shortDateTime } from '../card-situation/card-situation.service';

/** Grupos da lista (ordem da tela). */
export type TextGroup = 'client' | 'devops' | 'analysis' | 'correction' | 'handover';

export const TEXT_GROUPS: { id: TextGroup; label: string }[] = [
  { id: 'client', label: 'Para o cliente' },
  { id: 'devops', label: 'DevOps' },
  { id: 'analysis', label: 'Análise' },
  { id: 'correction', label: 'Correção' },
  { id: 'handover', label: 'Handover' },
];

/**
 * Estado de envio do texto:
 * - `none` — tem destino fora do PRMake e ainda não foi enviado;
 * - `sent` — o que está lá é igual ao texto atual;
 * - `stale` — editado depois do envio (o que o cliente/time lê está desatualizado);
 * - `unknown` — o PRMake não registra o envio (ex.: Root Cause enviado por outro caminho);
 * - `local` — só existe no PRMake (sem destino de envio).
 */
export type TextSendState = 'none' | 'sent' | 'stale' | 'unknown' | 'local';

/** Onde salvar a edição. */
export type TextSaveTarget = 'artifact' | 'summary' | 'register-root-cause' | 'register-description' | 'situation-draft' | 'handover';
/** Para onde enviar. */
export type TextSendTarget = 'summary' | 'situation' | 'root-cause' | 'timeline' | null;

export interface TextItem {
  /** Chave estável: `a:<artifactId>`, `summary`, `situation`, `root-cause`, `pr-description`, `handover`. */
  key: string;
  group: TextGroup;
  label: string;
  icon: string;
  /** Quem escreveu: "Claude", "PRMake", "Editado por Ana". */
  origin: string;
  /** Quando foi gerado/editado (ISO) e o verbo ("gerado", "editado", "salvo"). */
  at: string | null;
  atVerb: string;
  /** Onde o texto vive/vai: "discussion do DevOps", "Timeline", "campo Root Cause do DevOps", "só no PRMake". */
  where: string;
  /** Texto atual (null = ainda carregando o arquivo). */
  markdown: string | null;
  sendState: TextSendState;
  sentAt: string | null;
  sentBy: string | null;
  /** Rascunho local (situação editada e não publicada). */
  draft?: boolean;
  saveTarget: TextSaveTarget;
  sendTarget: TextSendTarget;
  /** Arquivo do plano. */
  planId?: string;
  artifactId?: string;
  phase?: PlanPhase | null;
  /** Entrada da Timeline que publicou o texto (mesma primeira linha) — "Atualizar na Timeline". */
  timelineEntryId?: number | null;
}

/** Registro do card (`PullRequest/GetByCardNumber`) — só o que a central usa. */
export interface RegisterTexts {
  description?: string | null;
  rootCause?: string | null;
  summary?: string | null;
  summaryUpdatedAt?: string | null;
  summaryPublishedAt?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  createdBy?: string | null;
}

export interface HandoverTexts {
  content?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  isPublic?: boolean | null;
}

/** Último envio feito pela central (o PRMake não registra o do Root Cause). */
export interface SentRecord {
  at: string;
  by: string | null;
  hash: string;
}

export interface TextSources {
  artifacts: { planId: string; phase: PlanPhase | null; artifact: ExecutionArtifact; content: string | null }[];
  situation: CardSituation | null;
  situationDraft: string | null;
  register: RegisterTexts | null;
  handover: HandoverTexts | null;
  /** null = Timeline indisponível. */
  timeline: TimelineEntry[] | null;
  rootCauseSent: SentRecord | null;
}

/** Ordem dos itens conhecidos dentro do grupo. */
const ORDER: Record<string, number> = {
  summary: 0, situation: 1, 'root-cause': 2, 'a-rca': 3, 'a-analise': 4, 'a-solucoes': 5, 'pr-description': 6, 'a-desc': 7, 'a-chamado': 8,
  'a-orientacao': 9, 'a-configuracao': 10, handover: 11,
};

function stemOf(name: string): string {
  const n = (name ?? '').replace(/\\/g, '/');
  return n.slice(n.lastIndexOf('/') + 1).replace(/\.md$/i, '').toLowerCase();
}

/** Grupo, destino e ordem de um `.md` do plano. */
export function classifyArtifact(a: Pick<ExecutionArtifact, 'name' | 'kind'>, phase: PlanPhase | null):
  { group: TextGroup; send: TextSendTarget; order: string } {
  const stem = stemOf(a.name);
  if (/^analise[-_]inicial$/.test(stem)) return { group: 'analysis', send: 'timeline', order: 'a-analise' };
  if (/^solucoes$/.test(stem)) return { group: 'analysis', send: 'timeline', order: 'a-solucoes' };
  if (/^rca$/.test(stem)) return { group: 'devops', send: 'root-cause', order: 'a-rca' };
  if (/^(desc|pr[-_]generated)$/.test(stem)) return { group: 'correction', send: null, order: 'a-desc' };
  if (/^chamado/.test(stem) || a.kind === 'ticket') return { group: 'correction', send: null, order: 'a-chamado' };
  if (/^orientacao[-_]cliente$/.test(stem)) return { group: 'correction', send: null, order: 'a-orientacao' };
  if (/^configuracao$/.test(stem)) return { group: 'correction', send: null, order: 'a-configuracao' };
  return phase === 'correction'
    ? { group: 'correction', send: null, order: 'z' }
    : { group: 'analysis', send: 'timeline', order: 'z' };
}

/** Texto comparável (fim de linha, espaços nas pontas). */
export function normText(text: string | null | undefined): string {
  return (text ?? '').replace(/\r\n/g, '\n').split('\n').map(l => l.replace(/\s+$/, '')).join('\n').trim();
}

/** Primeira linha com conteúdo, sem marcação ("## **Análise**" → "análise"). */
export function firstLine(text: string | null | undefined): string {
  const line = normText(text).split('\n').find(l => l.trim()) ?? '';
  return line.replace(/^#+\s*/, '').replace(/[*_`>]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Entrada da Timeline que publicou o texto (mesma primeira linha), a mais recente. */
export function findTimelineEntry(entries: TimelineEntry[] | null, markdown: string | null): TimelineEntry | null {
  const head = firstLine(markdown);
  if (!entries?.length || !head || head.length < 4) return null;
  return entries
    .filter(e => firstLine(e.description) === head)
    .sort((a, b) => time(b.updatedAt ?? b.createdAt) - time(a.updatedAt ?? a.createdAt))[0] ?? null;
}

/** Hash curto (djb2) — versão de um texto. */
export function textHash(text: string | null | undefined): string {
  const t = normText(text);
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Monta a lista da central com o que existe no card (sem texto = não entra). */
export function buildTextItems(src: TextSources): TextItem[] {
  const items: (TextItem & { order: string })[] = [];

  const reg = src.register;
  if (reg?.summary?.trim()) {
    const pub = reg.summaryPublishedAt ?? null;
    const upd = reg.summaryUpdatedAt ?? null;
    const stale = !!pub && !!upd && time(upd) > time(pub) + 1000;
    items.push({
      key: 'summary', order: 'summary', group: 'client', label: 'Resumo não técnico (PT/EN)', icon: 'translate',
      origin: 'PRMake', at: upd ?? pub, atVerb: 'salvo', where: 'discussion do DevOps', markdown: reg.summary,
      sendState: !pub ? 'none' : stale ? 'stale' : 'sent', sentAt: pub, sentBy: null,
      saveTarget: 'summary', sendTarget: 'summary',
    });
  }

  const s = src.situation;
  if (s?.markdown && s.kind && s.kind !== 'none') {
    const draft = src.situationDraft && normText(src.situationDraft) !== normText(s.markdown) ? src.situationDraft : null;
    const current = draft ?? s.markdown;
    const published = s.publishedAt ? (s.publishedMarkdown ?? null) : null;
    const differs = published !== null ? normText(published) !== normText(current) : !!s.publishPending || !!draft;
    items.push({
      key: 'situation', order: 'situation', group: 'client', label: 'Resumo da situação', icon: 'summarize',
      origin: draft ? 'Editado por você (rascunho)' : 'PRMake', at: s.since, atVerb: draft ? 'editado' : 'atualizado',
      where: 'discussion do DevOps', markdown: current, draft: !!draft,
      sendState: !s.publishedAt ? 'none' : differs ? 'stale' : 'sent', sentAt: s.publishedAt ?? null, sentBy: s.publishedBy ?? null,
      saveTarget: 'situation-draft', sendTarget: 'situation',
    });
  }

  if (reg?.rootCause?.trim()) {
    const sent = src.rootCauseSent;
    items.push({
      key: 'root-cause', order: 'root-cause', group: 'devops', label: 'Root cause', icon: 'bug_report',
      origin: 'PRMake', at: reg.updatedAt ?? reg.createdAt ?? null, atVerb: 'salvo',
      where: 'campo Root Cause do DevOps', markdown: reg.rootCause,
      sendState: sent ? (sent.hash === textHash(reg.rootCause) ? 'sent' : 'stale') : 'unknown',
      sentAt: sent?.at ?? null, sentBy: sent?.by ?? null,
      saveTarget: 'register-root-cause', sendTarget: 'root-cause',
    });
  }

  if (reg?.description?.trim()) {
    items.push({
      key: 'pr-description', order: 'pr-description', group: 'correction', label: 'Descrição do PR', icon: 'call_merge',
      origin: 'PRMake', at: reg.updatedAt ?? reg.createdAt ?? null, atVerb: 'salvo',
      where: 'registro do card no PRMake (vai no PR)', markdown: reg.description,
      sendState: 'local', sentAt: null, sentBy: null, saveTarget: 'register-description', sendTarget: null,
    });
  }

  const seen = new Set<string>();
  for (const { planId, phase, artifact: a, content } of src.artifacts) {
    if (!isGeneratedText(a) || seen.has(a.id)) continue;
    seen.add(a.id);
    const { label, icon } = generatedTextLabel(a.name);
    const c = classifyArtifact(a, phase);
    const edited = /^Editado por (.+?) em /.exec(a.description ?? '');
    const entry = c.send === 'timeline' && content !== null ? findTimelineEntry(src.timeline, content) : null;
    let sendState: TextSendState = 'local';
    if (c.send === 'timeline') sendState = content === null ? 'none' : entry ? (normText(entry.description) === normText(content) ? 'sent' : 'stale') : 'none';
    else if (c.send === 'root-cause') sendState = 'unknown';
    items.push({
      key: `a:${a.id}`, order: c.order, group: c.group,
      label: c.order === 'a-rca' ? 'Root cause · rascunho da skill' : c.order === 'a-desc' && reg?.description?.trim() ? 'Descrição do PR · rascunho da skill' : label,
      icon, origin: edited ? `Editado por ${edited[1]}` : 'Claude',
      at: a.updatedAt || a.createdAt || null, atVerb: edited ? '' : 'gerado',
      where: c.send === 'timeline' ? 'Timeline do card' : c.send === 'root-cause' ? 'campo Root Cause do DevOps' : 'só no PRMake',
      markdown: content,
      sendState,
      sentAt: entry ? entry.updatedAt ?? entry.createdAt : null, sentBy: entry?.userName ?? null,
      saveTarget: 'artifact', sendTarget: c.send,
      planId: a.planId || planId, artifactId: a.id, phase,
      timelineEntryId: entry?.id ?? null,
    });
  }

  const h = src.handover;
  if (h?.content?.trim()) {
    items.push({
      key: 'handover', order: 'handover', group: 'handover', label: 'Passagem de conhecimento', icon: 'swap_horiz',
      origin: 'PRMake (IA)', at: h.updatedAt ?? h.createdAt ?? null, atVerb: 'salvo',
      where: h.isPublic === false ? 'só no PRMake (privado)' : 'só no PRMake', markdown: h.content,
      sendState: 'local', sentAt: null, sentBy: null, saveTarget: 'handover', sendTarget: null,
    });
  }

  return items
    .sort((x, y) => groupIndex(x.group) - groupIndex(y.group) || (ORDER[x.order] ?? 50) - (ORDER[y.order] ?? 50) || time(y.at) - time(x.at))
    .map(({ order: _order, ...item }) => item);
}

function groupIndex(g: TextGroup): number {
  return TEXT_GROUPS.findIndex(x => x.id === g);
}

/** Rótulo do estado de envio ("Enviado em 04/11 às 11:58 por Ana"). */
export function sendStateLabel(item: Pick<TextItem, 'sendState' | 'sentAt' | 'sentBy' | 'sendTarget'>): string {
  switch (item.sendState) {
    case 'none': return 'Não enviado';
    case 'sent': {
      const when = shortDateTime(item.sentAt);
      return `Enviado${when ? ' em ' + when : ''}${item.sentBy ? ' por ' + item.sentBy : ''}`;
    }
    case 'stale': return 'Editado depois do envio';
    case 'unknown': return 'Envio não registrado no PRMake';
    default: return 'Só no PRMake';
  }
}

/** Texto do botão de envio. */
export function sendLabel(item: Pick<TextItem, 'sendTarget' | 'sendState' | 'timelineEntryId'>): string | null {
  switch (item.sendTarget) {
    case 'summary':
    case 'situation': return item.sendState === 'none' ? 'Enviar para a discussion' : 'Atualizar na discussion';
    case 'root-cause': return 'Enviar ao campo Root Cause';
    case 'timeline': return item.timelineEntryId ? 'Atualizar na Timeline' : 'Publicar na Timeline';
    default: return null;
  }
}

// ── IA ────────────────────────────────────────────────────────────────────────────────────────

export type AiContextId = 'card' | 'discussion' | 'analysis' | 'situation' | 'prDescription' | 'current';

export interface AiContextPart {
  id: AiContextId;
  label: string;
  /** Texto do contexto (null = indisponível). */
  text: string | null;
  /** Por que não há (ex.: "card indisponível no DevOps"). */
  unavailable?: string | null;
}

/** Limite de cada bloco de contexto no prompt (o resto é cortado com aviso). */
export const AI_PART_LIMIT = 12_000;

const AUDIENCE: Partial<Record<TextGroup, string>> = {
  client: 'O texto é lido pelo CLIENTE na discussion do card: linguagem simples, sem jargão técnico, sem nomes de classes, tabelas ou arquivos.',
  devops: 'O texto vai para o campo Root Cause do card no DevOps: técnico, objetivo, explicando a causa do problema.',
  analysis: 'O texto é a análise técnica do card, lida pelo time (Timeline do PRMake).',
  correction: 'O texto apoia a correção (PR, chamado, orientação ou configuração) e é lido pelo time ou pelo suporte.',
  handover: 'O texto é a passagem de conhecimento do card para o próximo turno.',
};

/**
 * Prompt de "Gerar de novo com IA" (0077): instruções da pessoa + o contexto que ela marcou. Claro e em
 * português; pede só o texto novo, em markdown, sem inventar nada fora do contexto.
 */
export function buildRegeneratePrompt(card: string, item: Pick<TextItem, 'label' | 'where' | 'group'>, instructions: string,
  parts: Pick<AiContextPart, 'label' | 'text'>[]): string {
  const asked = instructions.trim() || 'Melhore a clareza e a organização, mantendo o conteúdo e o tamanho aproximado.';
  const blocks = parts.filter(p => p.text?.trim()).map(p => {
    let text = p.text!.trim();
    if (text.length > AI_PART_LIMIT) text = `${text.slice(0, AI_PART_LIMIT)}\n… [cortado: ${text.length - AI_PART_LIMIT} caracteres]`;
    return `### ${p.label}\n${text}`;
  });
  return [
    `Você vai reescrever o texto "${item.label}" do card ${card} (PRMake). Destino: ${item.where}.`,
    AUDIENCE[item.group] ?? '',
    '',
    '## O que a pessoa pediu',
    asked,
    '',
    '## Regras',
    '- Use SOMENTE as informações do contexto abaixo; não invente fatos, números, datas, nomes nem soluções.',
    '- Se o contexto não mostra que o problema foi corrigido, não diga que foi corrigido.',
    '- Responda em português do Brasil, a menos que a pessoa peça outro idioma.',
    '- Responda APENAS com o novo texto, em markdown, sem comentários antes ou depois e sem cercar com ```.',
    '',
    '## Contexto',
    blocks.length ? blocks.join('\n\n') : '(a pessoa não marcou nenhum contexto — use só o pedido)',
  ].filter((l, i, all) => !(l === '' && all[i - 1] === '')).join('\n');
}

export function time(iso: string | null | undefined): number {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}
