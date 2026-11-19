import { WorkItem, WorkTask, canControlTask, openDependencies } from './work-item.model';

function task(p: Partial<WorkTask>): WorkTask {
  return {
    id: 't' + (p.number ?? 1), number: 1, order: 1, title: 'x', kind: 'research', executor: 'claude', params: {}, status: 'pending',
    controls: { dependsOn: [], dependents: [] }, ...p
  };
}

function item(tasks: WorkTask[], status: WorkItem['status'] = 'queued'): WorkItem {
  return {
    id: 'i', number: 950, cardNumber: '78680', type: 'fix', title: 'Correção', status, origin: 'correction',
    createdBy: 'a', createdAt: '', updatedAt: '', editable: false, progress: { done: 0, total: tasks.length }, links: [], fingerprint: 'f', tasks
  } as WorkItem;
}

describe('Card 78680 — mexer numa sub-tarefa sem cancelar o item', () => {
  it('só sub-tarefa ainda não feita de item aberto tem o menu', () => {
    const t = task({});
    expect(canControlTask(item([t]), t)).toBeTrue();
    expect(canControlTask(item([t], 'completed'), t)).toBeFalse();
    expect(canControlTask(item([t], 'cancelled'), t)).toBeFalse();
    for (const status of ['completed', 'skipped', 'cancelled'] as const) expect(canControlTask(item([t]), task({ status }))).toBeFalse();
    expect(canControlTask(item([t]), task({ controls: null }))).toBeFalse();
  });

  it('mostra só as dependências que ainda seguram a sub-tarefa', () => {
    const har = task({ number: 951, title: 'Obter o HAR', status: 'completed' });
    const analisar = task({ number: 952, title: 'Analisar o HAR', controls: { dependsOn: [951], dependents: [953] } });
    const decidir = task({ number: 953, title: 'Decidir', controls: { dependsOn: [952], dependents: [] } });
    const it = item([har, analisar, decidir]);
    expect(openDependencies(it, analisar)).toEqual([]);
    expect(openDependencies(it, decidir).map((t) => t.number)).toEqual([952]);
  });
});
