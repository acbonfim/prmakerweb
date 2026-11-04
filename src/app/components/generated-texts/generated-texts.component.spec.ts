import { WritableSignal, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { ExecutionPlanService } from '../../services/execution-plan.service';
import { WsService } from '../../services/ws.service';
import { CardSituation, CardSituationService } from '../card-situation/card-situation.service';
import { ExecutionArtifact, ExecutionPlan } from '../execution-plan/execution-plan.model';
import type { MarkdownViewDialogData } from '../markdown-view/markdown-view-dialog.component';
import { GeneratedTextsComponent } from './generated-texts.component';
import { artifactTexts, generatedTextLabel, isGeneratedText } from './generated-texts.model';

const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function art(id: string, name: string, extra: Partial<ExecutionArtifact> = {}): ExecutionArtifact {
  return {
    id, planId: extra.planId ?? 'pa', number: 1, noteId: null, stepKey: null, name, kind: 'analysis', contentType: 'text/markdown',
    size: 10, sha256: '', description: null, createdBy: 'Claude', createdAt: ago(3_600_000), updatedAt: null, ...extra,
  };
}

function plan(id: string, phase: 'analysis' | 'correction', artifacts: ExecutionArtifact[]): ExecutionPlan {
  return {
    id, cardNumber: '75812', kind: 'analisar-bug', title: 'Plano', status: 'running', createdBy: 'Alex', createdAt: ago(0), updatedAt: ago(0),
    stepsTotal: 1, stepsCompleted: 0, phase, steps: [], artifacts, questions: [], links: [], lastLogId: 0, serverTime: ago(0),
  } as ExecutionPlan;
}

describe('generated-texts.model (0076)', () => {
  it('rótulos amigáveis por nome de arquivo', () => {
    expect(generatedTextLabel('analise-inicial.md').label).toBe('Análise');
    expect(generatedTextLabel('solucoes.md').label).toBe('Soluções propostas');
    expect(generatedTextLabel('desc.md').label).toBe('Descrição do PR');
    expect(generatedTextLabel('pr_generated.md').label).toBe('Descrição do PR');
    expect(generatedTextLabel('rca.md').label).toBe('Root cause');
    expect(generatedTextLabel('orientacao-cliente.md').label).toBe('Orientação ao cliente');
    expect(generatedTextLabel('configuracao.md').label).toBe('Passo a passo da configuração');
    expect(generatedTextLabel('chamado-ajuste-filtros.md')).toEqual({ label: 'Texto do chamado · ajuste filtros', icon: 'confirmation_number' });
    expect(generatedTextLabel('analise/impacto_na-base.md').label).toBe('Impacto na base');
  });

  it('só .md da skill (anexo de comentário e script não)', () => {
    expect(isGeneratedText({ name: 'solucoes.md', noteId: null })).toBeTrue();
    expect(isGeneratedText({ name: 'print.md', noteId: 'n1' })).toBeFalse();
    expect(isGeneratedText({ name: '01_ajuste.sql', noteId: null })).toBeFalse();
    const list = artifactTexts([plan('pa', 'analysis', [art('1', 'analise-inicial.md'), art('2', 'x.sql')])]);
    expect(list.map(t => t.label)).toEqual(['Análise']);
  });
});

describe('GeneratedTextsComponent (0076)', () => {
  let f: ComponentFixture<GeneratedTextsComponent>;
  let dialog: jasmine.SpyObj<MatDialog>;
  let situation: WritableSignal<CardSituation | null>;
  let gets: string[];
  const el = () => f.nativeElement as HTMLElement;

  async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
      f.detectChanges();
      await f.whenStable();
      await new Promise(r => setTimeout(r, 0));
    }
  }

  const analysis = plan('pa', 'analysis', [
    art('a1', 'analise-inicial.md', { createdAt: ago(5 * 3_600_000) }),
    art('a2', 'solucoes.md', { createdAt: ago(2 * 3_600_000) }),
    art('a3', 'print.png', { kind: 'image' }),
  ]);
  const correction = plan('pc', 'correction', [art('c1', 'chamado-ajuste.md', { planId: 'pc', kind: 'ticket', createdAt: ago(60_000) })]);

  beforeEach(() => {
    try { localStorage.removeItem('prmake.generated-texts-open'); } catch { /* sem storage */ }
    gets = [];
    situation = signal<CardSituation | null>(null);
    dialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);
    TestBed.configureTestingModule({
      imports: [GeneratedTextsComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialog, useValue: dialog },
        { provide: ExecutionPlanService, useValue: {
          get: (id: string) => { gets.push(id); return of(correction); },
          content: () => of(new Blob(['## Soluções\n\n**Recomendada** opção A'], { type: 'text/markdown' })),
        } },
        { provide: CardSituationService, useValue: { situationOf: () => situation } },
        { provide: WsService, useValue: { on() {}, off() {} } },
      ],
    });
    f = TestBed.createComponent(GeneratedTextsComponent);
    f.componentRef.setInput('cardNumber', '75812');
    f.componentRef.setInput('plan', analysis);
    f.componentRef.setInput('pair', { analysisId: 'pa', correctionId: 'pc' });
  });

  it('lista os textos dos dois planos e o resumo, do mais recente para o mais antigo, com fase', async () => {
    situation.set({ kind: 'ticket', markdown: '**Situação**', since: ago(30 * 60_000), publishPending: true, publishedAt: null } as CardSituation);
    await settle();
    expect(gets).toEqual(['pc']);
    const labels = [...el().querySelectorAll('.gt-item__label')].map(x => x.textContent!.trim());
    expect(labels).toEqual(['Texto do chamado · ajuste', 'Resumo da situação', 'Soluções propostas', 'Análise']);
    const phases = [...el().querySelectorAll('.gt-phase')].map(x => x.textContent!.trim());
    expect(phases).toEqual(['Correção', 'Card', 'Análise', 'Análise']);
    expect(el().querySelector('.gt__count')!.textContent).toBe('4');
    expect(el().textContent).toContain('pronto para publicar');
  });

  it('Ver: arquivo carregado na hora (diálogo com load) e resumo com o markdown', async () => {
    situation.set({ kind: 'ticket', markdown: '**Situação**', since: ago(0), publishPending: false, publishedAt: null } as CardSituation);
    await settle();
    const items = [...el().querySelectorAll<HTMLElement>('.gt-item')];
    const sol = items.find(i => i.textContent!.includes('Soluções propostas'))!;
    sol.querySelector<HTMLButtonElement>('.gt-item__view')!.click();
    const data = dialog.open.calls.mostRecent().args[1]!.data as MarkdownViewDialogData;
    expect(data.title).toBe('Soluções propostas');
    expect(data.card).toBe('75812');
    expect(data.subtitle).toContain('Análise');
    expect(await data.load!()).toContain('**Recomendada** opção A');

    items.find(i => i.textContent!.includes('Resumo da situação'))!.querySelector<HTMLButtonElement>('.gt-item__view')!.click();
    const d2 = dialog.open.calls.mostRecent().args[1]!.data as MarkdownViewDialogData;
    expect(d2.markdown).toBe('**Situação**');
    expect(d2.load).toBeUndefined();
  });

  it('texto novo pelo tempo real → aviso discreto "O Claude gerou: X · Ver" (sem modal)', async () => {
    await settle();
    expect(el().querySelector('.gt__fresh')).toBeNull();
    f.componentRef.setInput('plan', plan('pa', 'analysis', [...analysis.artifacts, art('a9', 'rca.md', { createdAt: new Date().toISOString() })]));
    await settle();
    const fresh = el().querySelector('.gt__fresh')!;
    expect(fresh.textContent).toContain('O Claude gerou');
    expect(fresh.textContent).toContain('Root cause');
    expect(el().querySelector('.gt-item--new .gt-item__label')!.textContent).toContain('Root cause');
    expect(dialog.open).not.toHaveBeenCalled();
    fresh.querySelector<HTMLButtonElement>('.gt__fresh-view')!.click();
    expect((dialog.open.calls.mostRecent().args[1]!.data as MarkdownViewDialogData).title).toBe('Root cause');
    await settle();
    expect(el().querySelector('.gt__fresh')).toBeNull();
  });

  it('recolhe e lembra; sem textos não aparece', async () => {
    await settle();
    el().querySelector<HTMLButtonElement>('.gt__head')!.click();
    await settle();
    expect(el().querySelector('.gt__list')).toBeNull();
    expect(el().querySelector('.gt__latest')!.textContent).toContain('Texto do chamado');
    expect(localStorage.getItem('prmake.generated-texts-open')).toBe('0');
    f.componentRef.setInput('plan', plan('px', 'analysis', []));
    f.componentRef.setInput('pair', null);
    await settle();
    expect(el().querySelector('.gt')).toBeNull();
  });
});
