import { WorkItem } from './work-item.model';
import { WorkItemFile, normalizeFileKind } from './work-item-files';

/**
 * Card 78262: Visão geral do item de **análise** — o que vai ser feito (curto e objetivo), o entregável (com o que já
 * foi entregue) e, publicada a análise, o próprio texto dela na tela (o mesmo que vai para a Timeline do card), sem
 * precisar abrir o arquivo.
 */

/** Item que espelha o plano de análise (a análise inicial ou uma nova versão dela). */
export function isAnalysisItem(item: Pick<WorkItem, 'type' | 'origin' | 'planPhase'> | null | undefined): boolean {
  if (!item) return false;
  return item.planPhase === 'analysis' || item.type === 'analysis' || (item.origin === 'analysis' && !item.planPhase);
}

/** O que a análise faz, em uma frase (bug × User Story). A descrição do item, quando houver, vale por cima. */
export function analysisBrief(us: boolean): string {
  return us
    ? 'Entender a história e decidir com você a solução: ler a US e os critérios de aceite, consultar a Base Solvace, ' +
      'mapear no código onde a mudança entra e propor as opções.'
    : 'Descobrir por que o problema acontece e decidir com você como corrigir: ler o card e as evidências, consultar a ' +
      'Base Solvace, confirmar no código e nos dados, chegar à causa raiz e propor as soluções.';
}

export interface AnalysisDeliverable {
  icon: string;
  title: string;
  detail: string;
  done: boolean;
}

const stepDone = (item: Pick<WorkItem, 'tasks'>, key: string) =>
  (item.tasks ?? []).some((t) => (t.stepKey ?? '').toLowerCase() === key && t.status === 'completed');

/** O entregável da análise, com o que já foi entregue marcado (pelas etapas do plano espelhadas nas sub-tarefas). */
export function analysisDeliverables(item: Pick<WorkItem, 'tasks' | 'status'>, us: boolean, hasAnalysisFile: boolean): AnalysisDeliverable[] {
  const finished = item.status === 'completed';
  const decided = finished || stepDone(item, 'propor-solucoes');
  return [
    {
      icon: 'description',
      title: 'A análise',
      detail: us
        ? 'Resumo da história, onde a mudança entra e o que vai ser feito — publicada na Timeline do card.'
        : 'Problema, causa raiz confirmada e o que vai ser feito — publicada na Timeline do card.',
      done: hasAnalysisFile || finished || stepDone(item, 'publicar')
    },
    {
      icon: 'rule',
      title: 'A solução decidida com você',
      detail: 'As opções com prós, contras e riscos; a sua resposta define o caminho.',
      done: decided
    },
    {
      icon: 'account_tree',
      title: us ? 'O plano de implementação' : 'O plano de correção',
      detail: 'Nasce da decisão e vira um item de trabalho próprio na Bancada.',
      done: decided
    }
  ];
}

const SIDE_FILES = /^(solucoes|solu[cç][oõ]es|plano|summary|resumo|card-resumo|lacuna|regras|divergencia)/i;

/**
 * O arquivo da análise entre os arquivos do item: `.md` de tipo análise gravado pelo plano — de preferência
 * `analise*.md` (o que a skill publica na Timeline), o mais recente. Sem ele, null.
 */
export function pickAnalysisFile(files: readonly WorkItemFile[]): WorkItemFile | null {
  const md = files.filter((f) => normalizeFileKind(f.kind) === 'analysis' && f.source !== 'document' && /\.md$/i.test(f.name ?? ''));
  const time = (f: WorkItemFile) => Date.parse(f.updatedAt ?? f.createdAt ?? '') || 0;
  const newest = (list: WorkItemFile[]) => list.slice().sort((a, b) => time(b) - time(a))[0] ?? null;
  return newest(md.filter((f) => /^an[aá]lise/i.test(f.name))) ?? newest(md.filter((f) => !SIDE_FILES.test(f.name)));
}
