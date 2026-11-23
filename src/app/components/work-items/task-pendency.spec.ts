import { summarize, taskPendency } from './task-pendency';

/** Card 78655: a sub-tarefa parada mostra o que falta (divergência, motivo da espera) e como destravar. */
describe('taskPendency', () => {
  const reason = 'Confirme como seguir: o fix deste bug JA existe no edv-solvace, feito por outra pessoa em bugfix/78655. Opcoes: (1) cancelar; (2) abrir so um PR.';
  const plan = (over: Record<string, unknown> = {}) => ({
    steps: [{ key: 'pr-edv-solvace', status: 'waiting', waitingOn: 'user', statusReason: reason }],
    divergence: { text: 'A analise assumiu que faltava o fix; a base real ja tem outro fix mesclado em development.', stepKey: 'pr-edv-solvace', at: '', pending: true },
    userActions: [],
    ...over
  }) as never;

  it('traz a divergência pendente e o motivo da espera da etapa', () => {
    const p = taskPendency(plan(), { stepKey: 'pr-edv-solvace', result: null })!;
    expect(p.divergence).toContain('base real');
    expect(p.reason).toBe(reason);
    expect(p.summary).toBe('A analise assumiu que faltava o fix; a base real ja tem outro fix mesclado em development.');
    expect(p.how).toContain('Confirmar e seguir');
  });

  it('sem divergência, o motivo da etapa e o caminho do "Já resolvi"', () => {
    const p = taskPendency(plan({ divergence: null }), { stepKey: 'pr-edv-solvace', result: null })!;
    expect(p.divergence).toBeNull();
    expect(p.summary).toBe('Confirme como seguir: o fix deste bug JA existe no edv-solvace, feito por outra pessoa em bugfix/78655.');
    expect(p.how).toContain('Já resolvi');
  });

  it('divergência confirmada ou de outra etapa não conta', () => {
    const confirmed = plan({ divergence: { text: 'x', stepKey: 'pr-edv-solvace', at: '', pending: false } });
    expect(taskPendency(confirmed, { stepKey: 'pr-edv-solvace' })!.divergence).toBeNull();
    const other = plan({ divergence: { text: 'x', stepKey: 'outra', at: '', pending: true } });
    expect(taskPendency(other, { stepKey: 'pr-edv-solvace' })!.divergence).toBeNull();
  });

  it('cai no texto da ação "destravar" e depois no resultado da sub-tarefa (item avulso)', () => {
    const unblock = plan({ divergence: null, steps: [], userActions: [{ type: 'unblock', stepKey: 'pr-edv-solvace', title: 'x', text: 'Libere a VPN.' }] });
    expect(taskPendency(unblock, { stepKey: 'pr-edv-solvace' })!.reason).toBe('Libere a VPN.');
    expect(taskPendency(null, { stepKey: null, result: 'Sem acesso ao banco.' })!.reason).toBe('Sem acesso ao banco.');
  });

  it('nada a mostrar sem motivo (ou só "Plano concluído")', () => {
    expect(taskPendency(null, { stepKey: null, result: 'Plano concluído' })).toBeNull();
    expect(taskPendency(null, null)).toBeNull();
  });

  it('resumo sem markdown e cortado', () => {
    expect(summarize('**Atenção:** veja [o PR](https://x/1) e `codigo`. Resto do texto.')).toBe('Atenção: veja o PR e codigo. Resto do texto.');
    expect(summarize('a'.repeat(400)).length).toBe(220);
  });
});
