import { HttpErrorResponse } from '@angular/common/http';
import {
  WorkItem,
  WorkTask,
  canExecute,
  canUndo,
  formatWorkNumber,
  itemProgress,
  itemStatusLook,
  kindInfo,
  kindParams,
  matchesFilter,
  matchesSearch,
  originLabel,
  outputEntries,
  taskStatusLook,
  userTaskActions
} from './work-item.model';
import { toWorkItemError } from '../../services/work-items.service';

function task(p: Partial<WorkTask>): WorkTask {
  return { id: 't', number: 2, order: 1, title: 'x', kind: 'branch', executor: 'claude', params: {}, status: 'pending', ...p };
}

function item(p: Partial<WorkItem>): WorkItem {
  return {
    id: 'i', number: 1, cardNumber: '77434', type: 'bug', title: 'Item', status: 'pending', origin: 'user', createdBy: 'a',
    createdAt: '', updatedAt: '', editable: true, progress: { done: 0, total: 0 }, links: [], fingerprint: 'f', tasks: [], ...p
  } as WorkItem;
}

describe('work-item.model (0085)', () => {
  it('formata o número sem zeros à esquerda', () => {
    expect(formatWorkNumber(123)).toBe('#123');
    expect(formatWorkNumber('0000042')).toBe('#42');
    expect(formatWorkNumber(null)).toBe('');
  });

  it('rótulos pt-BR de status e origem', () => {
    expect(itemStatusLook('running').label).toBe('Em andamento');
    expect(itemStatusLook('reverted').label).toBe('Desfeito');
    expect(taskStatusLook('skipped').label).toBe('Pulada');
    expect(itemStatusLook('estranho').label).toBe('estranho');
    expect(originLabel('correction')).toBe('Plano');
    expect(originLabel('specialist')).toBe('Especialista');
    expect(originLabel('template')).toBe('Modelo');
    expect(originLabel('user')).toBe('Manual');
  });

  it('progresso usa o do servidor ou conta concluídas + puladas', () => {
    expect(itemProgress(item({ progress: { done: 2, total: 3 } }))).toEqual({ done: 2, total: 3, pct: 67 });
    const it = item({ progress: undefined as never, tasks: [task({ status: 'completed' }), task({ status: 'skipped' }), task({ status: 'running' }), task({})] });
    expect(itemProgress(it)).toEqual({ done: 2, total: 4, pct: 50 });
    expect(itemProgress(item({ progress: { done: 0, total: 0 } })).pct).toBe(0);
  });

  it('filtros por status', () => {
    expect(matchesFilter(item({ status: 'running' }), 'open')).toBeTrue();
    expect(matchesFilter(item({ status: 'completed' }), 'done')).toBeTrue();
    expect(matchesFilter(item({ status: 'reverted' }), 'cancelled')).toBeTrue();
    expect(matchesFilter(item({ status: 'cancelled' }), 'open')).toBeFalse();
    expect(matchesFilter(item({ status: 'cancelled' }), 'all')).toBeTrue();
  });

  it('busca por número (do item ou de sub-tarefa) e por título sem acento', () => {
    const it = item({ number: 742, title: 'GS-105 — Registrar Ação de melhoria', tasks: [task({ number: 743 })] });
    expect(matchesSearch(it, '')).toBeTrue();
    expect(matchesSearch(it, '#742')).toBeTrue();
    expect(matchesSearch(it, '74')).toBeTrue();
    expect(matchesSearch(it, '743')).toBeTrue();
    expect(matchesSearch(it, '105')).toBeTrue();
    expect(matchesSearch(it, '#999')).toBeFalse();
    expect(matchesSearch(it, 'acao REGISTRAR')).toBeTrue();
    expect(matchesSearch(it, 'gs-105')).toBeTrue();
    expect(matchesSearch(it, 'gs-104')).toBeFalse();
    expect(itemStatusLook('reverting').spin).toBeFalsy();
    expect(itemStatusLook('reverting').bob).toBeTrue();
  });

  it('executar só pending/failed; desfazer só com sub-tarefa concluída', () => {
    expect(canExecute(item({ status: 'pending' }))).toBeTrue();
    expect(canExecute(item({ status: 'failed' }))).toBeTrue();
    expect(canExecute(item({ status: 'running' }))).toBeFalse();
    expect(canUndo(item({ status: 'cancelled', tasks: [task({ status: 'completed' })] }))).toBeTrue();
    expect(canUndo(item({ status: 'cancelled', tasks: [task({ status: 'cancelled' })] }))).toBeFalse();
  });

  it('ações rápidas só para sub-tarefa do usuário', () => {
    expect(userTaskActions(task({ executor: 'claude' }))).toEqual([]);
    expect(userTaskActions(task({ executor: 'user', status: 'pending' }))).toEqual(['start', 'complete', 'skip']);
    expect(userTaskActions(task({ executor: 'user', status: 'running' }))).toEqual(['complete', 'fail', 'skip']);
    expect(userTaskActions(task({ executor: 'user', status: 'completed' }))).toEqual([]);
  });

  it('kind: catálogo tem preferência, padrão quando não tem', () => {
    const catalog = { taskKinds: [{ kind: 'pr', label: 'Abrir PR', icon: 'call_merge', params: ['repository', { key: 'target', label: 'Destino', required: true }] }], templates: [] };
    expect(kindInfo('pr', catalog)).toEqual({ label: 'Abrir PR', icon: 'call_merge' });
    expect(kindInfo('branch', catalog).label).toBe('Branch');
    expect(kindInfo('novo', null)).toEqual({ label: 'novo', icon: 'task_alt' });
    expect(kindParams('pr', catalog).map((p) => p.label)).toEqual(['repository', 'Destino']);
  });

  it('saídas: URL vira link', () => {
    const out = outputEntries({ pr: 'https://github.com/x/y/pull/1', sha: 'abc', n: 3 });
    expect(out).toEqual([
      { key: 'pr', value: 'https://github.com/x/y/pull/1', url: true },
      { key: 'sha', value: 'abc', url: false },
      { key: 'n', value: '3', url: false }
    ]);
  });

  it('409 duplicate/notEditable viram mensagens claras', () => {
    const dup = toWorkItemError(new HttpErrorResponse({ status: 409, error: { code: 'duplicate', existing: { number: 12, title: 'PR rv', status: 'running' } } }), 'x');
    expect(dup.code).toBe('duplicate');
    expect(dup.existing?.number).toBe(12);
    expect(dup.message).toContain('#12');
    const ne = toWorkItemError(new HttpErrorResponse({ status: 409, error: { code: 'notEditable' } }), 'x');
    expect(ne.code).toBe('notEditable');
    expect(ne.message).toContain('crie um novo');
    expect(toWorkItemError(new HttpErrorResponse({ status: 500, error: { error: 'falhou' } }), 'x').message).toBe('falhou');
  });
});
