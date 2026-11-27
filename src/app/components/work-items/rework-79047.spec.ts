import { WorkItem, WorkTask, claudeItems, isYourTurn, itemLook, mergeWaitTask, openPrTitles, workTaskLookIn } from './work-item.model';
import { normalizeVerdict, verdictLook, verdictMessage } from '../aws-deploy/aws-deploy.model';

function task(p: Partial<WorkTask>): WorkTask {
  return { id: `t${p.number}`, number: 1, order: 1, title: 'x', kind: 'manual', executor: 'claude', params: {}, status: 'pending', ...p } as WorkTask;
}

function item(p: Partial<WorkItem>): WorkItem {
  return {
    id: 'i', number: 1187, cardNumber: '79047', type: 'fix', title: 'Correcao 79047', status: 'waiting', origin: 'correction', createdBy: 'a',
    createdAt: '', updatedAt: '', editable: false, progress: { done: 0, total: 0 }, links: [], fingerprint: 'f', tasks: [], ...p
  } as WorkItem;
}

const prOpen = { id: 'l1', kind: 'pr', title: '#31443 edv-solvace -> qa', url: 'https://github.com/electradv/edv-solvace/pull/31443', status: 'open' };

describe('card 79047 — vez da pessoa, merge e robô', () => {
  it('validar em QA fica amarelo ("Aguardando você") quando é a vez dela, mesmo ainda pendente', () => {
    const it = item({ tasks: [
      task({ number: 1221, order: 13, status: 'completed' }),
      task({ number: 1194, order: 14, executor: 'user', title: 'Validar em QA', controls: { dependsOn: [1221] } as WorkTask['controls'] })
    ] });
    const qa = it.tasks[1];
    expect(isYourTurn(it, qa)).toBeTrue();
    expect(workTaskLookIn(it, qa).label).toBe('Aguardando você');
    expect(itemLook(it).label).toBe('Aguardando você');
  });

  it('com o ajuste inserido antes ainda rodando, não é a vez da pessoa', () => {
    const it = item({ status: 'running', tasks: [
      task({ number: 1221, order: 13, status: 'running' }),
      task({ number: 1194, order: 14, executor: 'user', controls: { dependsOn: [1221] } as WorkTask['controls'] })
    ] });
    expect(isYourTurn(it, it.tasks[1])).toBeFalse();
    expect(workTaskLookIn(it, it.tasks[1]).label).toBe('Pendente');
  });

  it('PR do ajuste aberto: o item aguarda o merge, não a pessoa', () => {
    const it = item({ tasks: [
      task({ number: 1191, order: 5, kind: 'pr', status: 'waiting', links: [prOpen] as WorkTask['links'] }),
      task({ number: 1194, order: 14, executor: 'user', controls: { dependsOn: [1191] } as WorkTask['controls'] })
    ] });
    expect(isYourTurn(it, it.tasks[1])).toBeFalse();
    expect(mergeWaitTask(it)?.number).toBe(1191);
    expect(openPrTitles(it.tasks[0])).toEqual(['#31443 edv-solvace -> qa']);
    expect(itemLook(it).label).toBe('Aguardando o merge');
  });

  it('robô: só item rodando/desfazendo gira; em espera não conta; na fila à parte', () => {
    const busy = claudeItems([
      item({ number: 1187, status: 'waiting' }), item({ number: 1196, status: 'running' }),
      item({ number: 1200, status: 'queued' }), item({ number: 1201, status: 'reverting' })
    ]);
    expect(busy).toEqual({ running: [1196, 1201], queued: [1200] });
    expect(claudeItems([item({ status: 'waiting' })])).toEqual({ running: [], queued: [] });
  });

  it('AWS: veredito "partial" (versão anterior lá, ajuste ainda não)', () => {
    expect(normalizeVerdict('partial')).toBe('partial');
    expect(verdictLook('partial').tone).toBe('warn');
    expect(verdictMessage('partial', 'QA')).toContain('Parte do nosso código está em QA');
  });
});
