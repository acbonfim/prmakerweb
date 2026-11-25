import { historyFieldLabel, historySummary, historyValue } from './devops-card-history.component';

describe('aba Histórico do card — texto das revisões', () => {
  it('nome do campo: o do tipo, o conhecido ou a referência legível', () => {
    expect(historyFieldLabel('Microsoft.VSTS.Common.Severity', { 'Microsoft.VSTS.Common.Severity': 'Severidade' })).toBe('Severidade');
    expect(historyFieldLabel('System.BoardColumn', {})).toBe('Coluna do board');
    expect(historyFieldLabel('Microsoft.VSTS.Scheduling.RemainingWork', {})).toBe('Remaining Work');
  });

  it('valor: HTML vira texto, booleano Sim/Não, vazio some', () => {
    expect(historyValue('<div>Passo 1</div><div>Passo&nbsp;2 &amp; 3</div>')).toBe('Passo 1\nPasso 2 & 3');
    expect(historyValue('true')).toBe('Sim');
    expect(historyValue(null)).toBe('');
    expect(historyValue('Test QA')).toBe('Test QA');
  });

  it('resumo de uma linha: estado, campos, links e comentário; criação', () => {
    const e = {
      created: false,
      changes: [
        { field: 'System.State', oldValue: 'New', newValue: 'Test QA' },
        { field: 'System.AssignedTo', oldValue: null, newValue: 'Ana' },
      ],
      linksAdded: [{ rel: 'System.LinkTypes.Related', id: 2, url: 'u', name: null }],
      linksRemoved: [],
      comment: '<p>ok</p>',
    };
    expect(historySummary(e, {})).toBe('Estado: New → Test QA · Responsável · +1 link · comentou');
    expect(historySummary({ ...e, created: true }, {})).toBe('Criou o card');
  });
});
