import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { WorkItemPickerSource } from '../work-item-pickers/work-item-picker-source.service';
import { WorkDeliverablesComponent } from './work-deliverables.component';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import {
  WorkDeliverable,
  WorkItem,
  WorkTask,
  deliverableGroupKey,
  deliverableHours,
  deliverableIcon,
  deliverableLabel,
  deliverableUrls,
  deliverablesOf,
  formatHours,
  groupDeliverables,
  prStatusLabel,
  prStatusOf,
  pullRequestLinks,
  shortSha,
  taskDeliverableLinks,
  ticketStatusLabel
} from './work-item.model';
import { WorkItemsService } from '../../services/work-items.service';

function d(p: Partial<WorkDeliverable>): WorkDeliverable {
  return { id: p.id ?? `${p.kind}:${p.taskNumber ?? 'item'}:${p.url ?? p.branch ?? ''}`, kind: 'doc', data: {}, source: 'auto', reverted: false, hasDiff: false, ...p };
}

function task(p: Partial<WorkTask>): WorkTask {
  return { id: 't', number: 2, order: 1, title: 'x', kind: 'pr', executor: 'claude', params: {}, status: 'completed', ...p };
}

function item(p: Partial<WorkItem>): WorkItem {
  return {
    id: 'i', number: 56, cardNumber: '77988', type: 'implementation', title: 'Item', status: 'completed', origin: 'correction',
    createdAt: '', updatedAt: '', editable: false, progress: { done: 0, total: 0 }, links: [], fingerprint: 'f', tasks: [], ...p
  } as WorkItem;
}

describe('entregas do item (0091)', () => {
  const pr = d({ id: 'pr:edv-solvace#4521', kind: 'pr', taskNumber: 63, url: 'https://github.com/o/edv-solvace/pull/4521', number: 4521,
    repository: 'edv-solvace', branch: 'feature/77988-dev', target: 'development', status: 'open' });
  const branch = d({ kind: 'branch', taskNumber: 58, url: 'https://github.com/o/edv-solvace/tree/feature/77988', branch: 'feature/77988', target: 'development' });
  const code = d({ kind: 'code', taskNumber: 58, repository: 'edv-solvace', branch: 'feature/77988', hasDiff: true });
  const ticket = d({ kind: 'ticket', taskNumber: 60, url: 'https://jira/x/1', status: 'resolved' });
  const hours = d({ kind: 'hours', taskNumber: null, text: '1.5' });
  const comment = d({ kind: 'comment', taskNumber: 61, text: 'Publicado' });
  const notify = d({ kind: 'notify', taskNumber: 62, text: 'Avisei o time' });
  const prText = d({ kind: 'pr-text', taskNumber: 63, text: 'Descrição' });

  it('rótulos e ícones pt-BR por tipo (tipo desconhecido vira Link)', () => {
    expect(deliverableLabel('pr')).toBe('Pull request');
    expect(deliverableLabel('code')).toBe('Código alterado');
    expect(deliverableLabel('devops-state')).toBe('Card no DevOps');
    expect(deliverableLabel('hours')).toBe('Horas lançadas');
    expect(deliverableLabel('doc')).toBe('Link');
    expect(deliverableLabel('qualquer')).toBe('Link');
    expect(deliverableIcon('pr')).toBe('merge');
    expect(deliverableIcon(null)).toBe('link');
  });

  it('deliverablesOf: todas sem sub-tarefa; com ela, só as daquela sub-tarefa (as do item ficam de fora)', () => {
    const it = item({ deliverables: [branch, code, pr, hours] });
    expect(deliverablesOf(it).length).toBe(4);
    expect(deliverablesOf(it, 58)).toEqual([branch, code]);
    expect(deliverablesOf(it, 63)).toEqual([pr]);
    expect(deliverablesOf(it, 99)).toEqual([]);
    expect(deliverablesOf(item({}), 58)).toEqual([]);
    expect(deliverablesOf(null)).toEqual([]);
  });

  it('agrupa na ordem PRs → código e branches → chamados → card → outros, só os grupos com entrega', () => {
    const groups = groupDeliverables([notify, hours, ticket, code, pr, comment, branch, prText]);
    expect(groups.map((g) => g.key)).toEqual(['prs', 'code', 'tickets', 'card', 'other']);
    expect(groups[0].items).toEqual([pr, prText]);
    expect(groups[1].items).toEqual([code, branch]);
    expect(groups[3].items).toEqual([hours, comment]);
    expect(groups[4].items).toEqual([notify]);
    expect(groupDeliverables([ticket]).map((g) => g.key)).toEqual(['tickets']);
    expect(groupDeliverables([])).toEqual([]);
    expect(deliverableGroupKey('timeline')).toBe('card');
    expect(deliverableGroupKey('commit')).toBe('code');
    expect(deliverableGroupKey('doc')).toBe('other');
  });

  it('pullRequestLinks prefere as entregas pr (com o estado) e cai nos links/saídas quando não há', () => {
    const old = { links: [{ kind: 'pr', title: 'Antigo', url: 'https://github.com/o/r/pull/1' }], tasks: [task({ output: { prUrl: 'https://github.com/o/r/pull/2' } })] };
    const fromDeliverables = pullRequestLinks({ ...old, deliverables: [pr, d({ ...pr, id: 'dup' })] });
    expect(fromDeliverables.map((p) => p.url)).toEqual(['https://github.com/o/edv-solvace/pull/4521']);
    expect(fromDeliverables[0].title).toBe('PR #4521 · edv-solvace');
    expect(fromDeliverables[0].status).toBe('open');

    expect(pullRequestLinks({ ...old, deliverables: [branch] }).map((p) => p.url))
      .toEqual(['https://github.com/o/r/pull/1', 'https://github.com/o/r/pull/2']);
    expect(pullRequestLinks({ ...old, deliverables: undefined }).length).toBe(2);
    // PR sem URL não conta como entrega de PR: volta para os links antigos.
    expect(pullRequestLinks({ ...old, deliverables: [d({ kind: 'pr', url: null })] }).length).toBe(2);
  });

  it('estado do PR: rascunho por status ou por isDraft; rótulos de PR e chamado', () => {
    expect(prStatusOf({ status: 'open', data: { isDraft: true } })).toBe('draft');
    expect(prStatusOf({ status: 'MERGED', data: {} })).toBe('merged');
    expect(prStatusOf({ status: null, data: null })).toBeNull();
    expect(prStatusLabel('merged')).toBe('Mesclado');
    expect(prStatusLabel('draft')).toBe('Rascunho');
    expect(ticketStatusLabel('resolved')).toBe('Resolvido');
  });

  it('links da sub-tarefa na sessão: PR/branch das entregas; sem elas, o output', () => {
    const it = item({ deliverables: [branch, code, pr] });
    expect(taskDeliverableLinks(it, task({ number: 58 })).map((l) => [l.kind, l.title])).toEqual([['branch', 'feature/77988']]);
    expect(taskDeliverableLinks(it, task({ number: 63 }))[0]).toEqual(jasmine.objectContaining({ kind: 'pr', status: 'open' }));
    const fallback = taskDeliverableLinks(it, task({ number: 70, output: { branch: 'https://github.com/o/r/tree/x' } }));
    expect(fallback.map((l) => l.kind)).toEqual(['branch']);
  });

  it('horas, sha curto e URLs das entregas', () => {
    expect(deliverableHours(hours)).toBe(1.5);
    expect(deliverableHours(d({ kind: 'hours', data: { hours: 2 } }))).toBe(2);
    expect(deliverableHours(d({ kind: 'hours', text: 'x' }))).toBeNull();
    expect(formatHours(1.5)).toBe('1,5h');
    expect(shortSha('a1b2c3d4e5')).toBe('a1b2c3d');
    expect([...deliverableUrls([pr, code, ticket])]).toEqual(['https://github.com/o/edv-solvace/pull/4521', 'https://jira/x/1']);
  });
});

describe('app-work-deliverables / app-deliverable-diff (0091)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NoopAnimationsModule],
      providers: [
        provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(),
        { provide: WorkItemPickerSource, useValue: { githubUrl: signal('https://github.com/o'), ensureGithubUrl: () => {} } }
      ]
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('desenha um cartão por entrega com estado, selos e o diff sob demanda', async () => {
    const f = TestBed.createComponent(WorkDeliverablesComponent);
    f.componentRef.setInput('itemNumber', 56);
    f.componentRef.setInput('showTask', true);
    f.componentRef.setInput('grouped', true);
    f.componentRef.setInput('deliverables', [
      d({ id: 'p1', kind: 'pr', taskNumber: 63, url: 'https://github.com/o/r/pull/9', number: 9, repository: 'r', branch: 'a', target: 'b', status: 'merged',
        data: { checks: 'success', approvals: 2, alreadyExisted: true }, hasDiff: true }),
      d({ id: 'c1', kind: 'code', taskNumber: 58, repository: 'r', branch: 'feature/x', target: 'development', hasDiff: true, source: 'deduced',
        data: { commits: [{ sha: 'abcdef123', title: 'fix: x' }], files: 1, additions: 3, deletions: 1, fileList: [{ path: 'a.cs', status: 'modified', additions: 3, deletions: 1 }] } }),
      d({ id: 'h1', kind: 'hours', taskNumber: 58, text: '1.5', reverted: true })
    ]);
    await f.whenStable();
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelectorAll('.wdl-card').length).toBe(3);
    expect(el.textContent).toContain('Mesclado');
    expect(el.textContent).toContain('2 aprovações');
    expect(el.textContent).toContain('deduzido');
    expect(el.textContent).toContain('desfeito');
    expect(el.textContent).toContain('1,5h');
    expect(el.textContent).toContain('#63');
    expect(el.querySelector('a[href="https://github.com/o/r/tree/feature/x"]')).not.toBeNull();

    const btn = [...el.querySelectorAll<HTMLButtonElement>('.wdl-btn')].find((b) => b.textContent?.includes('Ver código alterado'))!;
    btn.click();
    await f.whenStable();
    http.expectOne((r) => r.url.endsWith('WorkItems/56/deliverables/c1/diff')).flush({
      source: 'snapshot', repository: 'r', base: 'development', head: 'feature/x', truncated: true, compareUrl: 'https://github.com/o/r/compare/development...feature/x',
      files: [{ path: 'a.cs', status: 'modified', additions: 1, deletions: 1, patch: '@@ -1,2 +1,2 @@\n ctx\n-old\n+new' }]
    });
    await f.whenStable();
    await new Promise((r) => setTimeout(r));
    await f.whenStable();
    expect(el.querySelector('app-deliverable-diff')).not.toBeNull();
    expect(el.textContent).toContain('Diff grande');
    expect(el.querySelectorAll('.dd-row--addition').length).toBe(1);
    expect(el.querySelectorAll('.dd-row--deletion').length).toBe(1);
  });

  it('lista vazia não desenha nada', async () => {
    const f = TestBed.createComponent(WorkDeliverablesComponent);
    f.componentRef.setInput('deliverables', []);
    await f.whenStable();
    expect((f.nativeElement as HTMLElement).querySelector('.wdl')).toBeNull();
  });
});

describe('WorkItemsService — entregas (0091)', () => {
  let svc: WorkItemsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()] });
    svc = TestBed.inject(WorkItemsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('codifica o id sintético no caminho do diff e devolve null no 404', async () => {
    const p = firstValueFrom(svc.deliverableDiff(56, 'pr:edv-solvace#123'));
    const req = http.expectOne((r) => r.url.endsWith('WorkItems/56/deliverables/pr%3Aedv-solvace%23123/diff'));
    req.flush({ message: 'sem diff' }, { status: 404, statusText: 'Not Found' });
    expect(await p).toBeNull();
  });

  it('erro do GitHub no corpo vira diff com `error` (a tela mostra o aviso com o link)', async () => {
    const p = firstValueFrom(svc.deliverableDiff(56, 'abc'));
    http.expectOne((r) => r.url.endsWith('WorkItems/56/deliverables/abc/diff'))
      .flush({ error: 'branch apagada', compareUrl: 'https://github.com/o/r/compare/a...b' }, { status: 502, statusText: 'Bad Gateway' });
    const diff = await p;
    expect(diff?.error).toBe('branch apagada');
    expect(diff?.files).toEqual([]);
  });

  it('lista de entregas: servidor sem o endpoint → vazio', async () => {
    const p = firstValueFrom(svc.deliverables(56));
    http.expectOne((r) => r.url.endsWith('WorkItems/56/deliverables')).flush(null, { status: 404, statusText: 'Not Found' });
    expect(await p).toEqual([]);
  });
});
