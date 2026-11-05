import { bugInsight, hasNoEstimate, parseHoursSetting, pickAverage, toneVsAverage, usInsight } from './hours-insight';

describe('hours-insight (0085)', () => {
  describe('bug × média dos bugs', () => {
    it('acima da média até +50% é atenção, com o delta e a razão', () => {
      const r = bugInsight({ originalEstimate: 4, completedWork: 4, remainingWork: 0 }, 3)!;
      expect(r.position).toBe('above');
      expect(r.delta).toBe(1);
      expect(r.ratioPct).toBe(133);
      expect(r.tone).toBe('warn');
    });

    it('acima de +50% é alerta', () => {
      const r = bugInsight({ originalEstimate: 4, completedWork: 5, remainingWork: 1 }, 3)!;
      expect(r.delta).toBe(2);
      expect(r.tone).toBe('bad');
    });

    it('abaixo ou igual à média é ok', () => {
      expect(bugInsight({ originalEstimate: 4, completedWork: 2, remainingWork: 2 }, 3)!.position).toBe('below');
      expect(bugInsight({ originalEstimate: 4, completedWork: 2, remainingWork: 2 }, 3)!.tone).toBe('ok');
      const eq = bugInsight({ originalEstimate: 3, completedWork: 3, remainingWork: 0 }, 3)!;
      expect(eq.position).toBe('equal');
      expect(eq.delta).toBe(0);
      expect(eq.tone).toBe('ok');
    });

    it('a barra vai até 2× a média (ou o Completed, se maior) e marca média e faixa de atenção', () => {
      const r = bugInsight({ originalEstimate: 4, completedWork: 3, remainingWork: 1 }, 3)!;
      expect(r.scale).toBe(6);
      expect(r.completedPct).toBe(50);
      expect(r.averagePct).toBe(50);
      expect(r.warnPct).toBe(75);
      const big = bugInsight({ originalEstimate: 4, completedWork: 12, remainingWork: 0 }, 3)!;
      expect(big.scale).toBe(12);
      expect(big.completedPct).toBe(100);
      expect(big.averagePct).toBe(25);
    });

    it('sem média: tom neutro e barra contra o Original', () => {
      const r = bugInsight({ originalEstimate: 8, completedWork: 2, remainingWork: 6 }, null)!;
      expect(r.average).toBeNull();
      expect(r.delta).toBeNull();
      expect(r.position).toBeNull();
      expect(r.tone).toBe('neutral');
      expect(r.completedPct).toBe(25);
      expect(r.averagePct).toBeNull();
    });

    it('sem estimativa → null (nada quebra)', () => {
      expect(bugInsight(null, 3)).toBeNull();
      expect(bugInsight({ originalEstimate: null, completedWork: 0, remainingWork: null }, 3)).toBeNull();
    });
  });

  describe('US planejado × realizado', () => {
    it('projeção acima do Original = estouro (e % consumido)', () => {
      const r = usInsight({ originalEstimate: 10, completedWork: 8, remainingWork: 4 }, 16)!;
      expect(r.projected).toBe(12);
      expect(r.projection).toBe('overrun');
      expect(r.projectionDelta).toBe(2);
      expect(r.consumedPct).toBe(80);
      expect(r.tone).toBe('warn');
      expect(r.scale).toBe(12);
      expect(r.originalPct).toBeCloseTo(83.33, 1);
      expect(r.averageDelta).toBe(-4);
    });

    it('estouro acima de 20% do Original é alerta; Completed além do Original é sinalizado', () => {
      const r = usInsight({ originalEstimate: 10, completedWork: 11, remainingWork: 3 }, null)!;
      expect(r.projectionDelta).toBe(4);
      expect(r.tone).toBe('bad');
      expect(r.completedOverPlan).toBeTrue();
      expect(r.consumedPct).toBe(110);
    });

    it('projeção abaixo do Original = folga; barra empilhada contra o Original', () => {
      const r = usInsight({ originalEstimate: 20, completedWork: 5, remainingWork: 12 }, 18)!;
      expect(r.projection).toBe('slack');
      expect(r.projectionDelta).toBe(-3);
      expect(r.tone).toBe('ok');
      expect(r.scale).toBe(20);
      expect(r.completedPct).toBe(25);
      expect(r.remainingPct).toBe(60);
      expect(r.originalPct).toBe(100);
    });

    it('igual ao Original = no plano', () => {
      const r = usInsight({ originalEstimate: 6, completedWork: 2, remainingWork: 4 }, null)!;
      expect(r.projection).toBe('on-plan');
      expect(r.tone).toBe('ok');
    });

    it('sem Original: sem plano, só projeção e referência à média', () => {
      const r = usInsight({ originalEstimate: null, completedWork: 3, remainingWork: 2 }, 4)!;
      expect(r.hasPlan).toBeFalse();
      expect(r.projection).toBeNull();
      expect(r.consumedPct).toBeNull();
      expect(r.tone).toBe('neutral');
      expect(r.averageDelta).toBe(1);
    });

    it('sem estimativa → null', () => {
      expect(usInsight({ originalEstimate: 0, completedWork: 0, remainingWork: 0 }, 4)).toBeNull();
    });
  });

  it('helpers: tom, média escolhida, configuração e "sem estimativa"', () => {
    expect(toneVsAverage(3, null)).toBe('neutral');
    expect(toneVsAverage(4.5, 3)).toBe('warn');
    expect(toneVsAverage(4.6, 3)).toBe('bad');
    expect(pickAverage(null, 0, 5)).toBe(5);
    expect(pickAverage(2, 5)).toBe(2);
    expect(pickAverage(null, undefined)).toBeNull();
    expect(parseHoursSetting('2,5')).toBe(2.5);
    expect(parseHoursSetting('4h')).toBe(4);
    expect(parseHoursSetting('')).toBeNull();
    expect(parseHoursSetting('abc')).toBeNull();
    expect(parseHoursSetting(0)).toBeNull();
    expect(hasNoEstimate({ originalEstimate: null, completedWork: null, remainingWork: null })).toBeTrue();
    expect(hasNoEstimate({ originalEstimate: null, completedWork: 1, remainingWork: null })).toBeFalse();
  });
});
