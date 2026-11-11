import { analysisDeliverables, isAnalysisItem, pickAnalysisFile } from './analysis-overview';
import { WorkItemFile } from './work-item-files';

const file = (name: string, kind = 'analysis', at = '2026-11-11T14:00:00Z', source: WorkItemFile['source'] = 'plan'): WorkItemFile =>
  ({ id: name, name, kind, source, updatedAt: at } as WorkItemFile);

describe('analysis-overview (card 78262)', () => {
  it('reconhece o item que espelha a análise', () => {
    expect(isAnalysisItem({ type: 'analysis', origin: 'analysis', planPhase: 'analysis' })).toBeTrue();
    expect(isAnalysisItem({ type: 'fix', origin: 'correction', planPhase: 'correction' })).toBeFalse();
    expect(isAnalysisItem(null)).toBeFalse();
  });

  it('escolhe o analise*.md mais recente, nunca soluções nem o plano completo', () => {
    const files = [
      file('solucoes.md', 'analysis', '2026-11-11T15:00:00Z'),
      file('analise-inicial.md', 'analysis', '2026-11-11T13:00:00Z'),
      file('analise-inicial-v2.md', 'analysis', '2026-11-11T14:30:00Z'),
      file('analise-completa-item-744.md', 'analysis', '2026-11-11T16:00:00Z', 'document'),
      file('00_78262_consulta.sql', 'script')
    ];
    expect(pickAnalysisFile(files)?.name).toBe('analise-inicial-v2.md');
    expect(pickAnalysisFile([file('solucoes.md')])).toBeNull();
  });

  it('marca o entregável pelo andamento das etapas', () => {
    const tasks = [
      { stepKey: 'publicar', status: 'completed' },
      { stepKey: 'propor-solucoes', status: 'waiting' }
    ] as any;
    const open = analysisDeliverables({ tasks, status: 'waiting' }, false, false);
    expect(open.map((d) => d.done)).toEqual([true, false, false]);
    const done = analysisDeliverables({ tasks, status: 'completed' }, false, true);
    expect(done.every((d) => d.done)).toBeTrue();
  });
});
