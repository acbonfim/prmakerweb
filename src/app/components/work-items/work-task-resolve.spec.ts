import { WorkItem, WorkTask, canResolveWait, waitingForResolve } from './work-item.model';
import { loneItemOptions } from '../../pages/authenticated/workbench/workbench.component';

function task(p: Partial<WorkTask>): WorkTask {
  return { id: 't', number: 81, order: 1, title: 'x', kind: 'sql-query', executor: 'claude', params: {}, status: 'waiting', ...p };
}

function item(p: Partial<WorkItem>): WorkItem {
  return {
    id: 'i', number: 80, cardNumber: '77988', type: 'data', title: 'Validar a migration', status: 'waiting', origin: 'specialist',
    createdBy: 'a', createdAt: '', updatedAt: '', editable: false, progress: { done: 0, total: 2 }, links: [], fingerprint: 'f', tasks: [], ...p
  } as WorkItem;
}

describe('"Já resolvi" — sub-tarefa do Claude esperando a pessoa', () => {
  it('sub-tarefa do Claude em espera (sem acesso ao banco) pode ser destravada', () => {
    expect(canResolveWait(task({}))).toBeTrue();
  });

  it('não vale para a sub-tarefa da pessoa (Concluir), nem fora da espera', () => {
    expect(canResolveWait(task({ executor: 'user' }))).toBeFalse();
    for (const status of ['pending', 'running', 'failed', 'completed'] as const) expect(canResolveWait(task({ status }))).toBeFalse();
  });

  it('chamado ou PR aberto destravam sozinhos — sem o botão; resolvido/mesclado não seguram', () => {
    expect(canResolveWait(task({ links: [{ kind: 'ticket', url: 'https://x.com/t/1' }] }))).toBeFalse();
    expect(canResolveWait(task({ links: [{ kind: 'pr', url: 'https://github.com/a/b/pull/1', status: 'open' }] }))).toBeFalse();
    expect(canResolveWait(task({ links: [{ kind: 'pr', url: 'https://github.com/a/b/pull/1', status: 'merged' }] }))).toBeTrue();
    expect(canResolveWait(task({ links: [{ kind: 'ticket', url: 'https://x.com/t/1', status: 'resolved' }] }))).toBeTrue();
  });

  it('waitingForResolve devolve a primeira pela ordem', () => {
    const it = item({ tasks: [task({ number: 82, order: 2 }), task({ number: 81, order: 1 })] });
    expect(waitingForResolve(it)?.number).toBe(81);
    expect(waitingForResolve(item({ tasks: [task({ status: 'pending' })] }))).toBeNull();
    expect(waitingForResolve(null)).toBeNull();
  });
});

describe('seletor da Execução — itens sem plano', () => {
  it('lista só os sem plano, os que esperam você primeiro', () => {
    const items = [
      item({ number: 90, status: 'completed', title: 'feito' }),
      item({ number: 70, planId: 'p', status: 'running' }),
      item({ number: 80, tasks: [task({})] }),
      item({ number: 85, status: 'running' })
    ];
    const opts = loneItemOptions(items);
    expect(opts.map((o) => o.number)).toEqual([80, 85, 90]);
    expect(opts[0].waitsForYou).toBeTrue();
    expect(opts[0].statusLabel).toBe('aguardando você');
  });
});
