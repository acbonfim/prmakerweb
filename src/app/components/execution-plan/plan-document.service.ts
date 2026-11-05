import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ExecutionPlanService } from '../../services/execution-plan.service';
import { CodeRefService } from '../code-ref/code-ref.service';
import { CodeRef, changeMeta, linesLabel } from '../code-ref/code-ref.model';
import { generatedTextLabel } from '../generated-texts/generated-texts.model';
import { ExecutionArtifact, ExecutionPlan, ExecutionPlanSummary, PLAN_STATUS_LABEL } from './execution-plan.model';
import { isUsPlan, planTerms } from './plan-terms';
export { planDocumentFileName } from './plan-terms';

const STEP_LABEL: Record<string, string> = {
  pending: 'pendente', running: 'em andamento', waiting: 'aguardando', paused: 'pausada',
  completed: 'concluída', failed: 'falhou', cancelled: 'cancelada',
};
const STEP_MARK: Record<string, string> = {
  completed: '✅', running: '⏳', waiting: '✋', paused: '⏸️', failed: '❌', cancelled: '🚫', pending: '○',
};
/** Arquivos de texto que entram no documento (o resto aparece só pelo nome). */
const TEXT_FILE = /\.(md|sql|txt|sh|ps1|json|cs|ts|js|asp|vb|xml|ya?ml)$/i;
const MAX_FILE_CHARS = 60_000;

/** Análise "vazia" (0082): a versão que nasceu e foi cancelada sem nenhuma etapa concluída. */
export const isEmptyVersion = (s: Pick<ExecutionPlanSummary, 'status' | 'stepsCompleted'>) =>
  s.status === 'cancelled' && !s.stepsCompleted;

/**
 * 0082: o plano inteiro de uma versão num documento só — resumo, documentos (análise, soluções, chamado…), etapas com o
 * que cada uma registrou, scripts/consultas, o código que muda (fotografias da 0075: hoje × como fica) e os links. A
 * análise vazia (cancelada sem nada feito) mostra a última análise feita do card, avisando.
 */
@Injectable({ providedIn: 'root' })
export class PlanDocumentService {
  private api = inject(ExecutionPlanService);
  private codeRefs = inject(CodeRefService);

  /** `opts.us` (0085, rodada 5): plano de US — "Plano de implementação" no lugar de "Plano de correção". */
  async build(plan: ExecutionPlan, history: ExecutionPlanSummary[], opts?: { us?: boolean }): Promise<string> {
    const phase = plan.phase ?? 'analysis';
    const versionOf = (id: string | null | undefined) => history.find((h) => h.id === id)?.versionNumber ?? null;
    const out: string[] = [];

    let shown = plan;
    if (phase === 'analysis' && !plan.steps.some((s) => s.status === 'completed') && !(plan.artifacts ?? []).length) {
      const done = history
        .filter((h) => (h.phase ?? 'analysis') === 'analysis' && h.id !== plan.id && h.stepsCompleted > 0)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
      if (!done) return `> Esta versão ainda não tem análise — nenhuma etapa foi concluída.`;
      out.push(`> A **análise v${versionOf(plan.id) ?? '?'}** não chegou a ser feita. Abaixo, a **análise v${done.versionNumber ?? '?'}**, a última feita do card.`, '');
      shown = await firstValueFrom(this.api.get(done.id));
    }

    const v = versionOf(shown.id);
    const kind = phase === 'correction' ? planTerms(!!opts?.us || isUsPlan(shown, history)).fixPlan : 'Análise';
    out.push(`# ${kind}${v ? ' v' + v : ''} — ${shown.title}`, '');
    const parent = phase === 'correction' && shown.parentPlanId ? versionOf(shown.parentPlanId) : null;
    out.push([
      `**${PLAN_STATUS_LABEL[shown.status] ?? shown.status}**`,
      `criada por ${shown.createdBy} em ${this.when(shown.createdAt)}`,
      parent ? `gerada da análise v${parent}` : '',
      `${shown.stepsCompleted ?? shown.steps.filter((s) => s.status === 'completed').length} de ${shown.steps.length} etapas concluídas`,
    ].filter(Boolean).join(' · '), '');
    if (shown.statusReason) out.push(`> ${shown.statusReason}`, '');
    if (shown.summary?.trim()) out.push('## Resumo', '', shown.summary.trim(), '');

    const files = (shown.artifacts ?? []).filter((a) => !a.noteId);
    const [contents, refs] = await Promise.all([this.loadTexts(shown.id, files), this.loadRefs(shown, phase)]);

    const docs = files.filter((a) => /\.md$/i.test(a.name) && contents.has(a.id));
    if (docs.length) {
      out.push('## Documentos', '');
      for (const a of docs) out.push(`### ${generatedTextLabel(a.name).label} · \`${a.name}\``, '', this.demote(contents.get(a.id)!), '');
    }

    out.push('## Etapas', '');
    for (const [i, s] of [...shown.steps].sort((a, b) => a.order - b.order).entries()) {
      const who = s.executor === 'user' ? ' · **você**' : '';
      out.push(`### ${i + 1}. ${STEP_MARK[s.status] ?? ''} ${s.title}`, '', `_${STEP_LABEL[s.status] ?? s.status}${who}${s.repository ? ' · ' + s.repository : ''}_`, '');
      if (s.description?.trim()) out.push(s.description.trim(), '');
      if (s.statusReason?.trim() && s.status !== 'completed') out.push(`> ${s.statusReason.trim()}`, '');
      if (s.checkpoint?.trim()) out.push('**Onde parou / o que registrou**', '', s.checkpoint.trim(), '');
      const own = files.filter((a) => a.stepKey === s.key).map((a) => `\`${a.name}\``);
      if (own.length) out.push(`Arquivos: ${own.join(', ')}`, '');
    }

    const scripts = files.filter((a) => !/\.md$/i.test(a.name) && contents.has(a.id));
    if (scripts.length) {
      out.push('## Scripts, consultas e arquivos', '');
      for (const a of scripts) {
        const lang = (a.name.split('.').pop() ?? '').toLowerCase();
        out.push(`### \`${a.name}\`${a.description ? ' — ' + a.description : ''}`, '', '```' + lang, contents.get(a.id)!.trimEnd(), '```', '');
      }
    }
    const others = files.filter((a) => !contents.has(a.id));
    if (others.length) out.push('**Outros arquivos:** ' + others.map((a) => `\`${a.name}\``).join(', '), '');

    if (refs.length) {
      out.push(phase === 'correction' ? '## Código que muda' : '## Código citado', '');
      for (const r of refs) {
        const meta = changeMeta(r.change);
        const lang = r.language ?? '';
        out.push(`### ${meta.label} · \`${r.path}\` L${linesLabel(r.startLine, r.endLine)}${r.title ? ' — ' + r.title : ''}`, '');
        if (r.repository) out.push(`_${r.repository}${r.branch ? ' · ' + r.branch : ''}${r.commitSha ? ' · ' + r.commitSha.slice(0, 10) : ''}_`, '');
        if (r.why?.trim()) out.push(r.why.trim(), '');
        if (r.snapshot?.trim()) out.push(r.change === 'create' ? '' : '**Hoje**', '', '```' + lang, r.snapshot.trimEnd(), '```', '');
        if (r.proposal?.trim()) out.push('**Como fica**', '', '```' + lang, r.proposal.trimEnd(), '```', '');
        if (r.implemented?.trim()) out.push(`**Implementado**${r.implementedSha ? ' (' + r.implementedSha.slice(0, 10) + ')' : ''}`, '', '```' + lang, r.implemented.trimEnd(), '```', '');
      }
    }

    const links = shown.links ?? [];
    if (links.length) {
      out.push('## Links', '');
      for (const l of links) out.push(`- [${l.title || l.url}](${l.url})${l.status ? ' · ' + l.status : ''}${l.targetBranch ? ' → ' + l.targetBranch : ''}`);
      out.push('');
    }
    return out.join('\n');
  }

  /** O documento de um plano pelo id (aba Arquivos da Bancada: um por item com plano, sem versões). */
  async buildById(planId: string, us?: boolean): Promise<string> {
    const plan = await firstValueFrom(this.api.get(planId));
    return this.build(plan, [], { us: us ?? isUsPlan(plan) });
  }

  private async loadTexts(planId: string, files: ExecutionArtifact[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    await Promise.all(files.filter((a) => TEXT_FILE.test(a.name)).map(async (a) => {
      try {
        const text = await (await firstValueFrom(this.api.content(planId, a.id))).text();
        map.set(a.id, text.length > MAX_FILE_CHARS ? text.slice(0, MAX_FILE_CHARS) + '\n\n… (cortado — baixe o arquivo para ver tudo)' : text);
      } catch { /* sem o conteúdo, aparece só pelo nome */ }
    }));
    return map;
  }

  /** Fotografias do plano (e, na correção, as da análise de origem — é lá que a proposta de código costuma estar). */
  private async loadRefs(plan: ExecutionPlan, phase: string): Promise<CodeRef[]> {
    const owners = new Set([plan.id, ...(phase === 'correction' && plan.parentPlanId ? [plan.parentPlanId] : [])]);
    const heads = (await this.codeRefs.loadHeads(plan.cardNumber))
      .filter((h) => owners.has(h.planId) && (phase !== 'correction' || h.change !== 'read'));
    const refs = await Promise.all(heads.map((h) => this.codeRefs.get(plan.cardNumber, h.ref).catch(() => null)));
    const order = ['change', 'create', 'remove', 'suspect', 'read'];
    return refs.filter((r): r is CodeRef => !!r)
      .sort((a, b) => order.indexOf(a.change) - order.indexOf(b.change) || a.path.localeCompare(b.path) || a.startLine - b.startLine);
  }

  /** Os títulos do arquivo descem dois níveis para caber sob "Documentos". */
  private demote(md: string): string {
    let fenced = false;
    return md.split('\n').map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      return fenced ? line : line.replace(/^(#{1,4})\s/, (_m, h: string) => '#'.repeat(Math.min(6, h.length + 2)) + ' ');
    }).join('\n');
  }

  private when(iso: string): string {
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
}
