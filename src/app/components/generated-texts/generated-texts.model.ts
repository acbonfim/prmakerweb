import type { ExecutionArtifact, PlanPhase } from '../execution-plan/execution-plan.model';

/** Um texto que o Claude/PRMake gerou no card (0076). */
export interface GeneratedText {
  /** Chave estável (lista). */
  key: string;
  /** `artifact` = arquivo `.md` de um plano; `summary` = resumo da situação; `published` = o publicado. */
  source: 'artifact' | 'summary' | 'published';
  label: string;
  icon: string;
  phase: PlanPhase | null;
  /** Quando foi gerado/atualizado (ISO). */
  at: string | null;
  by: string | null;
  /** Detalhe curto ("pronto para publicar", nome do arquivo). */
  detail?: string | null;
  planId?: string;
  artifactId?: string;
  /** `name@updatedAt` — muda quando o texto é regravado (aviso "O Claude gerou"). */
  version: string;
  markdown?: string | null;
}

const KNOWN: { test: RegExp; label: string; icon: string }[] = [
  { test: /^analise[-_]inicial$/, label: 'Análise', icon: 'troubleshoot' },
  { test: /^solucoes$/, label: 'Soluções propostas', icon: 'lightbulb' },
  { test: /^(desc|pr[-_]generated)$/, label: 'Descrição do PR', icon: 'call_merge' },
  { test: /^rca$/, label: 'Root cause', icon: 'bug_report' },
  { test: /^orientacao[-_]cliente$/, label: 'Orientação ao cliente', icon: 'support_agent' },
  { test: /^configuracao$/, label: 'Passo a passo da configuração', icon: 'tune' },
];

function baseName(name: string): string {
  const n = (name ?? '').replace(/\\/g, '/');
  return n.slice(n.lastIndexOf('/') + 1);
}

/** O arquivo é um texto gerado? (`.md` da skill — não anexo de comentário). */
export function isGeneratedText(a: Pick<ExecutionArtifact, 'name' | 'noteId'>): boolean {
  return !a.noteId && /\.md$/i.test(baseName(a.name));
}

/** "impacto_na-base" → "Impacto na base". */
function readable(stem: string): string {
  const t = stem.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? t.charAt(0).toLocaleUpperCase('pt-BR') + t.slice(1) : stem;
}

/** Rótulo amigável e ícone (`mat-icon`) de um arquivo `.md` do plano. */
export function generatedTextLabel(name: string): { label: string; icon: string } {
  const stem = baseName(name).replace(/\.md$/i, '');
  const key = stem.toLowerCase();
  const known = KNOWN.find(k => k.test.test(key));
  if (known) return { label: known.label, icon: known.icon };
  const ticket = /^chamado(?:[-_](.+))?$/i.exec(stem);
  if (ticket) {
    return { label: ticket[1] ? `Texto do chamado · ${readable(ticket[1]).toLowerCase()}` : 'Texto do chamado', icon: 'confirmation_number' };
  }
  return { label: readable(stem), icon: 'description' };
}

export const PHASE_LABEL: Record<string, string> = { analysis: 'Análise', correction: 'Correção' };

/** Textos dos planos do card (os `.md` gerados), do mais recente para o mais antigo. */
export function artifactTexts(plans: ({ id: string; phase?: PlanPhase | null; artifacts?: ExecutionArtifact[] | null } | null | undefined)[]): GeneratedText[] {
  const out: GeneratedText[] = [];
  const seen = new Set<string>();
  for (const p of plans) {
    if (!p) continue;
    for (const a of p.artifacts ?? []) {
      if (!isGeneratedText(a) || seen.has(a.id)) continue;
      seen.add(a.id);
      const { label, icon } = generatedTextLabel(a.name);
      const at = a.updatedAt || a.createdAt || null;
      out.push({
        key: `a:${a.id}`,
        source: 'artifact',
        label,
        icon,
        phase: (p.phase ?? 'analysis') as PlanPhase,
        at,
        by: a.createdBy || null,
        detail: baseName(a.name),
        planId: a.planId || p.id,
        artifactId: a.id,
        version: `${a.id}@${at ?? ''}`,
      });
    }
  }
  return out.sort((x, y) => time(y.at) - time(x.at));
}

export function time(iso: string | null | undefined): number {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}
