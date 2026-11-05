import { isUsPlan, planTerms } from './plan-terms';

describe('plan-terms (0085 rodada 5)', () => {
  it('plano de US fala em implementação; Bug continua em correção', () => {
    expect(planTerms(true).fixPlan).toBe('Plano de implementação');
    expect(planTerms(true).fix).toBe('implementação');
    expect(planTerms(false).fixPlan).toBe('Plano de correção');
    expect(planTerms(false).Fix).toBe('Correção');
  });

  it('reconhece a US pelo kind do plano ou do pai (correção)', () => {
    expect(isUsPlan({ id: 'a', kind: 'analisar-us' })).toBeTrue();
    expect(isUsPlan({ id: 'b', kind: 'analisar-bug' })).toBeFalse();
    expect(isUsPlan({ id: 'c', kind: 'correcao', parentPlanId: 'a' }, [{ id: 'a', kind: 'analisar-us' }])).toBeTrue();
    expect(isUsPlan({ id: 'c', kind: 'correcao', parentPlanId: 'b' }, [{ id: 'b', kind: 'analisar-bug' }])).toBeFalse();
    expect(isUsPlan(null)).toBeFalse();
  });
});
