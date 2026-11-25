import {
  SCHEDULE_COLOR, WorkItem, WorkTask, awaitsSchedule, formatSchedule, isTaskScheduled, isoToLocalInput, itemLook, localInputToIso, workTaskLook
} from './work-item.model';
import { toTaskInput, toTaskDraft } from './work-item-editor-dialog.component';

function task(p: Partial<WorkTask>): WorkTask {
  return { id: 't', number: 1, order: 1, title: 'x', kind: 'env-validation', executor: 'claude', params: {}, status: 'pending', ...p };
}

function item(p: Partial<WorkItem>): WorkItem {
  return {
    id: 'i', number: 1200, cardNumber: '78794', type: 'task', title: 'Validar', status: 'pending', origin: 'specialist',
    createdAt: '', updatedAt: '', editable: true, progress: { done: 0, total: 1 }, links: [], fingerprint: 'f', tasks: [], ...p
  } as WorkItem;
}

describe('0103 — agendamento de itens e sub-tarefas', () => {
  const now = new Date(2026, 10, 25, 17, 0);

  it('formata o horário relativo ao dia (hoje, amanhã, data)', () => {
    expect(formatSchedule(new Date(2026, 10, 25, 19, 30).toISOString(), now)).toBe('hoje 19:30');
    expect(formatSchedule(new Date(2026, 10, 26, 4, 30).toISOString(), now)).toBe('amanhã 04:30');
    expect(formatSchedule(new Date(2026, 10, 28, 8, 0).toISOString(), now)).toBe('28/11 08:00');
    expect(formatSchedule(null, now)).toBe('');
  });

  it('datetime-local ida e volta mantém o horário do navegador', () => {
    const local = '2026-11-26T04:30';
    const iso = localInputToIso(local)!;
    expect(new Date(iso).getHours()).toBe(4);
    expect(isoToLocalInput(iso)).toBe(local);
    expect(localInputToIso('')).toBeNull();
  });

  it('sub-tarefa agendada mostra o relógio lilás com o horário', () => {
    const at = new Date(Date.now() + 3 * 3600_000).toISOString();
    const t = task({ held: true, scheduledAt: at });
    expect(isTaskScheduled(t)).toBeTrue();
    const look = workTaskLook(t);
    expect(look.icon).toBe('alarm');
    expect(look.color).toBe(SCHEDULE_COLOR);
    expect(look.label).toContain('Agendada');
    // Pausada sem data continua "Pendente" (o selo "Pausada" fica no controle).
    expect(workTaskLook(task({ held: true })).icon).not.toBe('alarm');
  });

  it('item agendado, em espera ou só com sub-tarefa agendada fica lilás', () => {
    const at = new Date(Date.now() + 3 * 3600_000).toISOString();
    expect(itemLook(item({ scheduledAt: at })).label).toContain('Agendado');
    expect(itemLook(item({ parked: true })).label).toBe('Em espera · sem data');
    expect(itemLook(item({ nextScheduledAt: at })).color).toBe(SCHEDULE_COLOR);
    expect(itemLook(item({ status: 'running', nextScheduledAt: at })).color).not.toBe(SCHEDULE_COLOR);
    expect(awaitsSchedule(item({ parked: true }))).toBeTrue();
    expect(awaitsSchedule(item({}))).toBeFalse();
  });

  it('editor manda o agendamento só da sub-tarefa nova', () => {
    const draft = toTaskDraft({ title: 'Validar em QA', kind: 'env-validation' });
    draft.scheduleAt = '2026-11-26T04:30';
    expect(toTaskInput(draft).scheduledAt).toBe(localInputToIso('2026-11-26T04:30'));
    const existing = toTaskDraft({ number: 10, title: 'Validar', kind: 'env-validation' });
    existing.scheduleAt = '2026-11-26T04:30';
    expect(toTaskInput(existing).scheduledAt).toBeUndefined();
  });
});
