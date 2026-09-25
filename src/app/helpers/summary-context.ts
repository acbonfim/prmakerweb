import { CardFull } from '../components/card-details-dialog/card-full.model';
import { TimelineEntry } from '../components/card-timeline/timeline.model';
import { GithubPullRequest } from '../services/pull-request.service';
import { RepoCommitSelection } from '../services/card-pr-state.service';
import { buildMultiRepoDiffContext } from './ai-prompt';

/** Limite do bloco de alterações de código no contexto (o resto é cortado com aviso). */
export const MAX_SUMMARY_DIFF_CHARS = 60000;
const MAX_COMMENTS = 20;
const MAX_TIMELINE = 30;

/** Tudo o que o resumo não técnico usa (feature 0011): o que aparece na aba "Contexto" e vai para a IA. */
export interface SummaryContextInput {
  cardNumber: string;
  card: CardFull;
  /** Campo de repro steps configurado no plugin do DevOps (padrão Microsoft.VSTS.TCM.ReproSteps). */
  reproField: string;
  description: string;
  rootCause: string;
  timeline: TimelineEntry[];
  githubPrs: GithubPullRequest[];
  /** Commits marcados (com o diff carregado). */
  diffs: RepoCommitSelection[];
}

/** Há algo que mostre a solução? Sem isso, o prompt proíbe dizer que o problema foi corrigido. */
export function solutionEvidence(input: SummaryContextInput): string[] {
  return [
    input.githubPrs.length ? `${input.githubPrs.length} Pull Request(s)` : '',
    input.description.trim() ? 'descrição do PR' : '',
    input.rootCause.trim() ? 'root cause' : '',
    input.diffs.length ? `${input.diffs.length} commit(s) com alterações de código` : '',
  ].filter(Boolean);
}

export function htmlToText(html: unknown): string {
  return (html ?? '').toString()
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*/g, '\n').trim();
}

function field(card: CardFull, name: string): string {
  const v = card.fields?.[name];
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return v.displayName ?? v.uniqueName ?? JSON.stringify(v);
  return String(v);
}

function date(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  return isNaN(d.getTime()) ? value : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Seções do contexto, na ordem em que aparecem na tela e no prompt. */
export function buildSummaryContextSections(input: SummaryContextInput): { title: string; body: string }[] {
  const { card } = input;
  const evidence = solutionEvidence(input);

  const situation = [
    `- Card: ${input.cardNumber} — ${field(card, 'System.Title')}`,
    `- Tipo: ${field(card, 'System.WorkItemType')}`,
    `- Estado atual: ${field(card, 'System.State')}`,
    `- Área: ${field(card, 'System.AreaPath')}`,
    `- Responsável: ${field(card, 'System.AssignedTo')}`,
    `- Criado em: ${date(card.fields?.['System.CreatedDate']) || '—'}`,
    evidence.length
      ? `- Evidência de solução: SIM (${evidence.join(', ')})`
      : '- Evidência de solução: NÃO — ainda não há Pull Request, descrição do PR, root cause nem alterações de código. O problema NÃO foi corrigido até o momento.',
  ].join('\n');

  const repro = htmlToText(card.fields?.[input.reproField] ?? card.fields?.['System.Description']) || '—';

  const comments = (card.comments ?? [])
    .slice(-MAX_COMMENTS)
    .map(c => `- ${c.createdByName ?? '—'} (${date(c.createdDate)}): ${htmlToText(c.text) || '—'}`)
    .join('\n') || '—';

  const timeline = [...input.timeline]
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
    .slice(-MAX_TIMELINE)
    .map(t => `- ${t.userName ?? '—'} (${date(t.createdAt)}): ${t.description}`)
    .join('\n') || '—';

  const prs = input.githubPrs
    .map(pr => `- ${pr.repositoryId}: ${pr.branchPrefix}${pr.branchName} → ${pr.targetBranch} · ${pr.status}${pr.number ? ` · #${pr.number}` : ''}${pr.title ? ` · ${pr.title}` : ''}`)
    .join('\n') || '—';

  let diff = buildMultiRepoDiffContext(input.diffs) || '—';
  if (diff.length > MAX_SUMMARY_DIFF_CHARS) {
    diff = `${diff.substring(0, MAX_SUMMARY_DIFF_CHARS)}\n... [alterações truncadas: ${diff.length - MAX_SUMMARY_DIFF_CHARS} caracteres omitidos]`;
  }

  return [
    { title: 'Situação do card', body: situation },
    { title: 'Problema relatado', body: repro },
    { title: `Discussion do DevOps (${(card.comments ?? []).length})`, body: comments },
    { title: `Linha do tempo do PRMake (${input.timeline.length})`, body: timeline },
    { title: `Pull Requests no GitHub (${input.githubPrs.length})`, body: prs },
    { title: 'Descrição do PR (PRMake)', body: input.description.trim() || '—' },
    { title: 'Root cause (PRMake)', body: input.rootCause.trim() || '—' },
    { title: `Alterações de código (${input.diffs.length} commit(s))`, body: diff },
  ];
}

export function buildSummaryContext(input: SummaryContextInput): string {
  return buildSummaryContextSections(input).map(s => `## ${s.title}\n${s.body}`).join('\n\n');
}

/**
 * Prompt final: o modelo do admin (AI Configurations → BugSummaryPrompt) com `{context}` e os
 * placeholders antigos. Modelo sem `{context}` (anterior aos ajustes) recebe o contexto no fim.
 */
export function buildSummaryPrompt(template: string, input: SummaryContextInput): string {
  const context = buildSummaryContext(input);
  const values: Record<string, string> = {
    cardNumber: input.cardNumber,
    title: field(input.card, 'System.Title'),
    reproSteps: htmlToText(input.card.fields?.[input.reproField] ?? input.card.fields?.['System.Description']) || '—',
    description: input.description.trim() || '—',
    rootCause: input.rootCause.trim() || '—',
    context,
  };
  const filled = template.replace(/\{(cardNumber|title|reproSteps|description|rootCause|context)\}/g, (_, k: string) => values[k]);
  if (template.includes('{context}')) return filled;
  // Modelo antigo: sem a regra de veracidade — acrescenta junto com o contexto.
  return `${filled}\n\nREGRA OBRIGATÓRIA: use SOMENTE o CONTEXTO abaixo e não invente nada. `
    + `Se "Evidência de solução" for NÃO, não diga que o problema foi corrigido: descreva o problema e diga que está em análise.`
    + `\n\nCONTEXTO:\n${context}`;
}
