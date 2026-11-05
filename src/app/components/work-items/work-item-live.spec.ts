import {
  WorkItem,
  WorkTask,
  buildLiveFeed,
  changedTaskNumbers,
  executingNumbers,
  formatElapsed,
  isExecutingItem,
  pullRequestLinks,
  requestStatusLabel,
  sortExecutingFirst,
  taskOutputLinks,
  waitCodeLabel
} from './work-item.model';

function task(p: Partial<WorkTask>): WorkTask {
  return { id: 't', number: 2, order: 1, title: 'x', kind: 'branch', executor: 'claude', params: {}, status: 'pending', ...p };
}

function item(p: Partial<WorkItem>): WorkItem {
  return {
    id: 'i', number: 1, cardNumber: '77434', type: 'bug', title: 'Item', status: 'pending', origin: 'user', createdBy: 'a',
    createdAt: '', updatedAt: '', editable: true, progress: { done: 0, total: 0 }, links: [], fingerprint: 'f', tasks: [], ...p
  } as WorkItem;
}

describe('sessão de execução — regras puras (0085 ajustes)', () => {
  it('em execução = na fila, rodando, esperando ou desfazendo', () => {
    for (const s of ['queued', 'running', 'waiting', 'reverting'] as const) expect(isExecutingItem(item({ status: s }))).toBeTrue();
    for (const s of ['pending', 'completed', 'failed', 'cancelled', 'reverted'] as const) expect(isExecutingItem(item({ status: s }))).toBeFalse();
    expect(isExecutingItem(null)).toBeFalse();
  });

  it('itens em execução no topo (por número), o resto na ordem recebida', () => {
    const list = [item({ number: 1 }), item({ number: 9, status: 'running' }), item({ number: 3, status: 'completed' }), item({ number: 5, status: 'queued' })];
    expect(sortExecutingFirst(list).map((x) => x.number)).toEqual([5, 9, 1, 3]);
    expect(executingNumbers(list)).toEqual([5, 9]);
    expect(sortExecutingFirst([])).toEqual([]);
  });

  it('motivo da espera traduzido; código desconhecido não some', () => {
    expect(waitCodeLabel('offline')).toBe('Seu executor está offline');
    expect(waitCodeLabel('budget')).toContain('Limite diário');
    expect(waitCodeLabel('novo-codigo')).toBe('Aguardando (novo-codigo)');
    expect(waitCodeLabel(null)).toBeNull();
    expect(requestStatusLabel('claimed')).toBe('Começando');
    expect(requestStatusLabel('x')).toBe('x');
  });

  it('feed junta atividades e registros, sem repetir, mais novo por último', () => {
    const feed = buildLiveFeed({
      activity: { label: 'Abrindo PR', tool: 'Bash', at: '2026-11-05T10:00:05Z' },
      recent: [
        { label: 'Lendo arquivo', tool: 'Read', at: '2026-11-05T10:00:02Z' },
        { label: 'Abrindo PR', tool: 'Bash', at: '2026-11-05T10:00:05Z' }
      ],
      logs: [
        { at: '2026-11-05T10:00:00Z', kind: 'status', text: 'Execução iniciada' },
        { at: '2026-11-05T10:00:03Z', kind: 'task', text: 'Branch criada', taskNumber: 4 }
      ]
    });
    expect(feed.map((e) => e.text)).toEqual(['Execução iniciada', 'Lendo arquivo', 'Branch criada', 'Abrindo PR']);
    expect(feed[2].taskNumber).toBe(4);
    expect(feed[1].source).toBe('activity');
    expect(buildLiveFeed(null)).toEqual([]);
  });

  it('duração legível', () => {
    expect(formatElapsed(45_000)).toBe('45 s');
    expect(formatElapsed(192_000)).toBe('3 min 12 s');
    expect(formatElapsed(3_900_000)).toBe('1 h 05 min');
    expect(formatElapsed(-1)).toBe('');
    expect(formatElapsed(null)).toBe('');
  });

  it('sub-tarefas que mudaram de status entre cargas', () => {
    const before = [task({ number: 2, status: 'running' }), task({ number: 3, status: 'pending' })];
    const after = [task({ number: 2, status: 'completed' }), task({ number: 3, status: 'pending' }), task({ number: 4, status: 'pending' })];
    expect(changedTaskNumbers(before, after)).toEqual([2]);
    expect(changedTaskNumbers(null, after)).toEqual([]);
  });

  it('PRs do item: links pr + saídas das sub-tarefas, sem repetir', () => {
    const it = item({
      links: [{ kind: 'pr', title: 'PR #10', url: 'https://github.com/o/r/pull/10' }, { kind: 'doc', title: 'Doc', url: 'https://x.dev/doc' }],
      tasks: [
        task({ title: 'Abrir PR', output: { prUrl: 'https://github.com/o/r/pull/10' } }),
        task({ title: 'PR DevOps', output: { url: 'https://dev.azure.com/o/p/_git/r/pullrequest/77' } }),
        task({ title: 'Branch', output: { branch: 'https://github.com/o/r/tree/hotfix/77434-rv' } })
      ]
    });
    expect(pullRequestLinks(it).map((p) => p.url)).toEqual(['https://github.com/o/r/pull/10', 'https://dev.azure.com/o/p/_git/r/pullrequest/77']);
    expect(pullRequestLinks(null)).toEqual([]);
  });

  it('saídas da sub-tarefa classificadas em PR, branch ou link', () => {
    const links = taskOutputLinks(task({ output: { pr: 'https://github.com/o/r/pull/3', branch: 'https://github.com/o/r/tree/x', doc: 'https://x.dev', sha: 'abc' } }));
    expect(links.map((l) => l.kind)).toEqual(['pr', 'branch', 'link']);
  });
});
