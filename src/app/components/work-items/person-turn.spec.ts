import { WorkItem, WorkTask, itemLook, personTurnTask, waitsForPerson } from './work-item.model';

/** Card 78720 (#1020): só sobrou "Validar em QA" (da pessoa) — o item aparece "Aguardando você", não "Em andamento". */
function task(p: Partial<WorkTask>): WorkTask {
  return { id: `t${p.number}`, number: 1, order: 1, title: 'x', kind: 'research', executor: 'claude', params: {}, status: 'completed', ...p };
}

function deps(dependsOn: number[]): Partial<WorkTask> {
  return { controls: { dependsOn, dependents: [] } };
}

function item(p: Partial<WorkItem>): WorkItem {
  return {
    id: 'i', number: 1020, cardNumber: '78720', type: 'fix', title: 'Correção', status: 'waiting', origin: 'correction', planId: 'p',
    createdBy: 'a', createdAt: '', updatedAt: '', editable: false, progress: { done: 4, total: 6 }, links: [], fingerprint: 'f', ...p
  } as WorkItem;
}

const tasks78720 = (): WorkTask[] => [
  task({ number: 1023, order: 3, kind: 'pr' }),
  task({ number: 1024, order: 4, kind: 'validation', executor: 'user', status: 'pending', title: 'Validar em QA', ...deps([1023]) }),
  task({ number: 1025, order: 5, kind: 'pr-text', ...deps([1023]) }),
  task({ number: 1026, order: 6, kind: 'devops-action', status: 'pending', ...deps([1024, 1025]) })
];

describe('vez da pessoa no item (card 78720)', () => {
  it('validar em QA pronto e o resto dependendo dele: aguardando você, laranja', () => {
    const it = item({ tasks: tasks78720() });
    expect(personTurnTask(it)?.number).toBe(1024);
    expect(waitsForPerson(it)).toBeTrue();
    expect(itemLook(it).label).toBe('Aguardando você');
    expect(itemLook(it).spin).toBeFalsy();
  });

  it('sub-tarefa da pessoa ainda presa a uma dependência não é a vez dela', () => {
    const t = tasks78720();
    t[0] = task({ number: 1023, order: 3, kind: 'pr', status: 'waiting' });
    expect(personTurnTask(item({ tasks: t }))).toBeNull();
  });

  it('pausada não é a vez da pessoa', () => {
    const t = tasks78720();
    t[1] = { ...t[1], held: true };
    expect(personTurnTask(item({ tasks: t }))).toBeNull();
  });

  it('item em andamento continua "Em andamento"', () => {
    const it = item({ status: 'running', tasks: tasks78720() });
    expect(waitsForPerson(it)).toBeFalse();
    expect(itemLook(it).label).toBe('Em andamento');
  });

  it('chamado da pessoa já iniciado pelo plano (78794, #1079): aguardando você, com a sub-tarefa', () => {
    const it = item({
      number: 1077, cardNumber: '78794',
      tasks: [
        task({ number: 1078, order: 1, kind: 'task' }),
        task({ number: 1079, order: 2, kind: 'ticket', executor: 'user', status: 'running', title: 'Abrir o chamado', ...deps([1078]) }),
        task({ number: 1080, order: 3, kind: 'sql-query', status: 'pending', ...deps([1079]) })
      ]
    });
    expect(personTurnTask(it)?.number).toBe(1079);
    expect(waitsForPerson(it)).toBeTrue();
    expect(itemLook(it).label).toBe('Aguardando você');
  });

  it('sem dependências informadas vale a ordem', () => {
    const it = item({ tasks: [task({ number: 1, order: 1 }), task({ number: 2, order: 2, executor: 'user', status: 'pending' })] });
    expect(personTurnTask(it)?.number).toBe(2);
  });
});
