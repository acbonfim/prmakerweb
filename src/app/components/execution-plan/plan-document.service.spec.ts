import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ExecutionPlanService } from '../../services/execution-plan.service';
import { CodeRefService } from '../code-ref/code-ref.service';
import { CodeRef, CodeRefHead } from '../code-ref/code-ref.model';
import { ExecutionArtifact, ExecutionPlan, ExecutionPlanSummary, ExecutionStep } from './execution-plan.model';
import { PlanDocumentService, isEmptyVersion } from './plan-document.service';

const step = (key: string, order: number, status: string, extra: Partial<ExecutionStep> = {}): ExecutionStep =>
  ({ id: key, key, order, title: `Etapa ${key}`, status, executor: 'claude', kind: 'task', dependsOn: [], updatedAt: '', ...extra }) as ExecutionStep;
const file = (id: string, name: string, stepKey: string | null = null): ExecutionArtifact =>
  ({ id, planId: 'p', number: 1, name, kind: 'analysis', size: 10, stepKey, createdAt: '', updatedAt: '' }) as ExecutionArtifact;
const plan = (id: string, phase: 'analysis' | 'correction', steps: ExecutionStep[], artifacts: ExecutionArtifact[] = [],
  extra: Partial<ExecutionPlan> = {}): ExecutionPlan =>
  ({ id, cardNumber: '77900', kind: 'analisar-bug', title: `Plano ${id}`, phase, status: 'pending', createdBy: 'Ana',
    createdAt: '2026-11-04T10:00:00Z', updatedAt: '', stepsTotal: steps.length, stepsCompleted: steps.filter((s) => s.status === 'completed').length,
    steps, artifacts, questions: [], links: [], lastLogId: 0, serverTime: '', ...extra }) as ExecutionPlan;
const summary = (p: ExecutionPlan, versionNumber: number, extra: Partial<ExecutionPlanSummary> = {}): ExecutionPlanSummary =>
  ({ ...p, versionNumber, ...extra }) as ExecutionPlanSummary;

describe('PlanDocumentService (0082)', () => {
  let svc: PlanDocumentService;
  let contents: Record<string, string>;
  let plans: Record<string, ExecutionPlan>;
  let heads: CodeRefHead[];
  let refs: Record<string, CodeRef>;

  beforeEach(() => {
    contents = {};
    plans = {};
    heads = [];
    refs = {};
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ExecutionPlanService, useValue: {
          content: (_p: string, id: string) => of(new Blob([contents[id] ?? ''])),
          get: (id: string) => of(plans[id]),
        } },
        { provide: CodeRefService, useValue: {
          loadHeads: async () => heads,
          get: async (_c: string, ref: string) => refs[ref] ?? null,
        } },
      ],
    });
    svc = TestBed.inject(PlanDocumentService);
  });

  it('versão vazia = cancelada sem etapa concluída', () => {
    expect(isEmptyVersion({ status: 'cancelled', stepsCompleted: 0 })).toBeTrue();
    expect(isEmptyVersion({ status: 'cancelled', stepsCompleted: 3 })).toBeFalse();
    expect(isEmptyVersion({ status: 'pending', stepsCompleted: 0 })).toBeFalse();
  });

  it('junta resumo, documentos (títulos rebaixados fora de código), etapas e scripts', async () => {
    const a = plan('a1', 'analysis', [step('causa-raiz', 2, 'completed', { checkpoint: 'Causa: filtro por planta' }), step('coletar', 1, 'completed')],
      [file('f1', 'analise-inicial.md', 'montar-analise'), file('f2', '00_consulta.sql', 'consultar-ambiente'), file('f3', 'print.png')],
      { summary: 'Resumo da análise', status: 'completed' });
    contents = { f1: '# Causa\n```bash\n# não mexe\n```', f2: 'select 1;' };
    const md = await svc.build(a, [summary(a, 1)]);

    expect(md).toContain('# Análise v1 — Plano a1');
    expect(md).toContain('## Resumo\n\nResumo da análise');
    expect(md).toContain('### Causa');
    expect(md).toContain('# não mexe');
    expect(md.indexOf('Etapa coletar')).toBeLessThan(md.indexOf('Etapa causa-raiz'));
    expect(md).toContain('Causa: filtro por planta');
    expect(md).toContain('```sql\nselect 1;\n```');
    expect(md).toContain('**Outros arquivos:** `print.png`');
  });

  it('análise vazia mostra a última análise feita, avisando', async () => {
    const done = plan('a1', 'analysis', [step('x', 1, 'completed')], [], { createdAt: '2026-11-04T09:00:00Z' });
    const empty = plan('a2', 'analysis', [step('x', 1, 'pending')], [], { createdAt: '2026-11-04T11:00:00Z' });
    plans = { a1: done };
    const md = await svc.build(empty, [summary(empty, 2, { stepsCompleted: 0 }), summary(done, 1)]);

    expect(md).toContain('A **análise v2** não chegou a ser feita');
    expect(md).toContain('# Análise v1 — Plano a1');
  });

  it('correção traz o código que muda da análise de origem (hoje × como fica), sem as só-leitura', async () => {
    const c = plan('c1', 'correction', [step('corrigir', 1, 'pending', { kind: 'code' })], [], { parentPlanId: 'a1' });
    const head = (ref: string, change: string): CodeRefHead => ({ id: ref, planId: 'a1', ref, path: 'qma.asp', startLine: 107, endLine: 107,
      change, hasProposal: true, hasImplemented: false, updatedAt: '' });
    heads = [head('legenda', 'change'), head('barra', 'read'), { ...head('outro-card', 'change'), planId: 'zz' }];
    refs = { legenda: { ...head('legenda', 'change'), cardNumber: '77900', language: 'asp', firstLine: 107, annotations: [],
      snapshot: 'WHERE TeamId=1', proposal: 'WHERE SiteId=12 AND TeamId=1', why: 'Filtra a planta' } };
    const md = await svc.build(c, [summary(c, 1)]);

    expect(md).toContain('## Código que muda');
    expect(md).toContain('### Alterar · `qma.asp` L107');
    expect(md).toContain('**Hoje**\n\n```asp\nWHERE TeamId=1\n```');
    expect(md).toContain('**Como fica**\n\n```asp\nWHERE SiteId=12 AND TeamId=1\n```');
    expect(md).not.toContain('barra');
  });
});
