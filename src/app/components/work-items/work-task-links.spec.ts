import {
  WorkItem,
  WorkTask,
  currentTicket,
  isTaskTurn,
  linkKey,
  pullRequestLinks,
  taskExtraOutputLinks,
  taskLinkCiLook,
  taskLinkStatusLook,
  taskLinks,
  taskPrHint,
  ticketTaskActions
} from './work-item.model';

function task(p: Partial<WorkTask>): WorkTask {
  return { id: 't', number: 2, order: 1, title: 'x', kind: 'ticket', executor: 'user', params: {}, status: 'pending', ...p };
}

function item(p: Partial<WorkItem>): WorkItem {
  return {
    id: 'i', number: 1, cardNumber: '77434', type: 'task', title: 'Item', status: 'running', origin: 'user', createdBy: 'a',
    createdAt: '', updatedAt: '', editable: false, progress: { done: 0, total: 0 }, links: [], fingerprint: 'f', tasks: [], ...p
  } as WorkItem;
}

const PR = 'https://github.com/solvace/api/pull/12';
const TICKET = 'https://solvace.freshservice.com/helpdesk/tickets/1234';

describe('chamado na Bancada — links da sub-tarefa', () => {
  it('links ausentes (backend antigo) viram lista vazia; URL inválida sai; mesma URL não repete', () => {
    expect(taskLinks(task({}))).toEqual([]);
    expect(taskLinks(task({ links: null }))).toEqual([]);
    const links = taskLinks(task({
      links: [
        { kind: 'pr', url: PR, status: 'open' },
        { kind: 'pr', url: ` ${PR.toUpperCase()}/ `, status: 'merged' },
        { kind: 'ticket', url: 'não é link' },
        { kind: 'ticket', url: TICKET, title: '#1234' }
      ]
    }));
    expect(links.map((l) => `${l.kind}|${l.url}|${l.status ?? ''}`)).toEqual([`pr|${PR}|open`, `ticket|${TICKET}|`]);
    expect(linkKey(`${PR}/`)).toBe(linkKey(PR.toUpperCase()));
  });

  it('saídas-link que já aparecem como link da sub-tarefa não repetem', () => {
    const t = task({ kind: 'pr', executor: 'claude', links: [{ kind: 'pr', url: PR, status: 'open' }],
      output: { prUrl: PR + '/', branch: 'https://github.com/solvace/api/tree/hotfix/77434' } });
    expect(taskExtraOutputLinks(t).map((o) => o.kind)).toEqual(['branch']);
  });

  it('PRs das sub-tarefas entram nos PRs do item, sem repetir os do item', () => {
    const it = item({
      links: [{ kind: 'pr', url: PR, title: 'PR do item' }],
      tasks: [task({ kind: 'pr', links: [{ kind: 'pr', url: PR + '/' }, { kind: 'pr', url: 'https://github.com/solvace/web/pull/7', title: 'Front' }, { kind: 'ticket', url: TICKET }] })]
    });
    expect(pullRequestLinks(it).map((p) => p.title)).toEqual(['PR do item', 'Front']);
  });

  it('rótulo do status: chamado Aberto/Resolvido/Fechado, PR Aberto/Mesclado/Fechado (sem status = aberto) e CI só no PR aberto', () => {
    expect(taskLinkStatusLook({ kind: 'ticket' })!.label).toBe('Aberto');
    expect(taskLinkStatusLook({ kind: 'ticket', status: 'resolved' })!.label).toBe('Resolvido');
    expect(taskLinkStatusLook({ kind: 'ticket', status: 'closed' })!.label).toBe('Fechado');
    expect(taskLinkStatusLook({ kind: 'pr', status: 'merged' })!.label).toBe('Mesclado');
    expect(taskLinkStatusLook({ kind: 'pr', status: 'closed' })!.label).toBe('Fechado');
    expect(taskLinkStatusLook({ kind: 'doc', status: 'open' })).toBeNull();
    expect(taskLinkCiLook({ kind: 'pr', status: 'open', checksStatus: 'failure' })!.label).toBe('CI falhou');
    expect(taskLinkCiLook({ kind: 'pr', checksStatus: 'success' })!.label).toBe('CI ok');
    expect(taskLinkCiLook({ kind: 'pr', status: 'merged', checksStatus: 'success' })).toBeNull();
  });

  it('etapa de PR pendente com PR aberto/mesclado não mostra "Pendente"', () => {
    expect(taskPrHint(task({ kind: 'pr', links: [{ kind: 'pr', url: PR, status: 'open' }] }))).toBe('PR aberto');
    expect(taskPrHint(task({ kind: 'pr', links: [{ kind: 'pr', url: PR, status: 'merged' }] }))).toBe('PR mesclado');
    expect(taskPrHint(task({ kind: 'pr', links: [{ kind: 'pr', url: PR, status: 'closed' }] }))).toBeNull();
    expect(taskPrHint(task({ kind: 'pr', status: 'completed', links: [{ kind: 'pr', url: PR }] }))).toBeNull();
  });
});

describe('chamado na Bancada — ações do chamado', () => {
  const ticketOpen = { id: 'l1', kind: 'ticket', url: TICKET, status: 'open' as const };

  it('chamado em foco: o último aberto; sem aberto, o último', () => {
    const a = { id: 'a', kind: 'ticket', url: TICKET + '?a', status: 'closed' as const };
    const b = { id: 'b', kind: 'ticket', url: TICKET + '?b', status: 'open' as const };
    const c = { id: 'c', kind: 'ticket', url: TICKET + '?c', status: 'resolved' as const };
    expect(currentTicket(task({ links: [a, b, c] }))!.id).toBe('b');
    expect(currentTicket(task({ links: [a, c] }))!.id).toBe('c');
    expect(currentTicket(task({}))).toBeNull();
  });

  it('vez da sub-tarefa: pendente só com as anteriores finalizadas', () => {
    const t1 = task({ number: 2, order: 1, kind: 'branch', executor: 'claude', status: 'completed' });
    const t2 = task({ number: 3, order: 2 });
    const t3 = task({ number: 4, order: 3 });
    const it = item({ tasks: [t1, t2, t3] });
    expect(isTaskTurn(it, t2)).toBeTrue();
    expect(isTaskTurn(it, t3)).toBeFalse();
    expect(isTaskTurn(it, { ...t3, status: 'waiting' })).toBeTrue();
  });

  it('sem chamado → anexar; aberto → resolvido/fechado; fechado → anexar outro/reabrir; resolvido → reabrir', () => {
    const at = (t: WorkTask) => ticketTaskActions(item({ tasks: [t] }), t);
    expect(at(task({}))).toEqual(['attach']);
    expect(at(task({ status: 'waiting', links: [ticketOpen] }))).toEqual(['resolved', 'closed']);
    expect(at(task({ status: 'running', links: [{ ...ticketOpen, status: 'closed' }] }))).toEqual(['attach', 'open']);
    expect(at(task({ status: 'waiting', links: [{ ...ticketOpen, status: 'resolved' }] }))).toEqual(['open']);
  });

  it('nada para sub-tarefa concluída, de outro kind/executor, fora da vez ou com o item fechado/cancelado/desfeito', () => {
    const t = task({ status: 'waiting', links: [ticketOpen] });
    expect(ticketTaskActions(item({ tasks: [t] }), { ...t, status: 'completed' })).toEqual([]);
    expect(ticketTaskActions(item({ tasks: [t] }), { ...t, executor: 'claude' })).toEqual([]);
    expect(ticketTaskActions(item({ tasks: [t] }), { ...t, kind: 'manual' })).toEqual([]);
    for (const status of ['completed', 'cancelled', 'reverted', 'reverting'] as const) {
      expect(ticketTaskActions(item({ status, tasks: [t] }), t)).toEqual([]);
    }
    const first = task({ number: 2, order: 1, kind: 'manual' });
    const later = task({ number: 3, order: 2 });
    expect(ticketTaskActions(item({ tasks: [first, later] }), later)).toEqual([]);
  });
});
