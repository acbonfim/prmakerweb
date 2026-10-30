import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { ExecutionPlanSummary } from './execution-plan.model';
import { PlanHistoryComponent } from './plan-history.component';

function plan(id: string, phase: 'analysis' | 'correction', createdAt: string, extra: Partial<ExecutionPlanSummary> = {}): ExecutionPlanSummary {
  return {
    id, cardNumber: '77317', kind: 'bug', title: `Plano ${id}`, status: 'completed', createdBy: 'Alex Carlos', createdAt,
    updatedAt: createdAt, stepsTotal: 8, stepsCompleted: 8, phase, ...extra
  } as ExecutionPlanSummary;
}

describe('PlanHistoryComponent (0074)', () => {
  function create(items: ExecutionPlanSummary[], current: string | null = null) {
    TestBed.configureTestingModule({
      imports: [PlanHistoryComponent],
      providers: [provideZonelessChangeDetection(), { provide: AuthService, useValue: { getPhotosByExternalIds: () => of({ object: [] }) } }]
    });
    const fixture = TestBed.createComponent(PlanHistoryComponent);
    fixture.componentRef.setInput('items', items);
    fixture.componentRef.setInput('currentId', current);
    fixture.componentRef.setInput('cardNumber', '77317');
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  // Ordem do servidor: do mais novo para o mais antigo.
  const items = [
    plan('a3', 'analysis', '2026-10-05T10:00:00Z'),
    plan('c2', 'correction', '2026-10-04T10:00:00Z', { parentPlanId: 'a2' }),
    plan('a2', 'analysis', '2026-10-03T10:00:00Z'),
    plan('c1', 'correction', '2026-10-02T10:00:00Z', { parentPlanId: 'a1' }),
    plan('a1', 'analysis', '2026-10-01T10:00:00Z')
  ];

  it('numera por fase quando a API não manda versionNumber', () => {
    const c = create(items);
    const v = Object.fromEntries(c.rows().map((r) => [r.item.id, r.version]));
    expect(v).toEqual({ a3: 3, c2: 2, a2: 2, c1: 1, a1: 1 });
  });

  it('usa o versionNumber do servidor quando existe', () => {
    const c = create([plan('x', 'analysis', '2026-10-01T10:00:00Z', { versionNumber: 7 })]);
    expect(c.rows()[0].version).toBe(7);
  });

  it('marca a mais recente e liga a correção à análise de origem', () => {
    const c = create(items);
    expect(c.rows().filter((r) => r.isLatest).map((r) => r.item.id)).toEqual(['a3']);
    expect(c.rows().find((r) => r.item.id === 'c2')?.parent).toEqual({ id: 'a2', label: 'Análise v2' });
    expect(c.rows().find((r) => r.item.id === 'a1')?.parent).toBeNull();
  });

  it('subtítulo e filtro por fase', () => {
    const c = create(items);
    expect(c.subtitle()).toBe('Card 77317 · 5 versões (3 análises, 2 correções)');
    expect(c.showFilter()).toBeTrue();
    c.filter.set('correction');
    expect(c.rows().map((r) => r.item.id)).toEqual(['c2', 'c1']);
  });

  it('só mostra "alterada por" quando outra pessoa ou outro momento mexeu', () => {
    const same = plan('s', 'analysis', '2026-10-01T10:00:00Z', { statusChangedBy: 'Alex Carlos' });
    const other = plan('o', 'analysis', '2026-10-01T10:00:00Z', { statusChangedBy: 'Bruno Ferreira' });
    const later = plan('l', 'analysis', '2026-10-01T10:00:00Z', { statusChangedBy: 'Alex Carlos', updatedAt: '2026-10-01T12:00:00Z' });
    const c = create([same, other, later]);
    const by = Object.fromEntries(c.rows().map((r) => [r.item.id, r.changedBy]));
    expect(by).toEqual({ s: null, o: 'Bruno Ferreira', l: 'Alex Carlos' });
  });

  it('formata a duração e a data', () => {
    const done = plan('d', 'analysis', '2026-10-01T10:00:00Z', { startedAt: '2026-10-01T10:00:00Z', finishedAt: '2026-10-01T11:05:00Z' });
    const c = create([done]);
    expect(c.rows()[0].duration).toBe('1 h 5 min');
    expect(c.formatDateTime('invalido')).toBe('');
  });
});
