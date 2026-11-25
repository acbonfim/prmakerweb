import { Subject, of } from 'rxjs';
import { ArchitectureService, BaseQuestion } from '../../../services/architecture.service';
import { WsService } from '../../../services/ws.service';
import { POLL_QUEUED_MS, POLL_RUNNING_MS, baseQuestionError, baseQuestionProgress, pollDelay, watchBaseQuestion } from './kb-ask-executor';

const question = (patch: Partial<BaseQuestion> = {}): BaseQuestion => ({
  id: 'q1', key: 'BQ-0123456789AB', question: 'Como transfiro um usuário?', deep: false, status: 'queued', requestId: 'r1',
  createdAt: '2026-11-25T12:00:00Z', ...patch
});

class FakeWs {
  handlers = new Map<string, (p: any) => void>();
  groups = new Set<string>();
  _resynced = new Subject<void>();
  startConnection() {}
  on(event: string, h: (p: any) => void) { this.handlers.set(event, h); }
  off(event: string) { this.handlers.delete(event); }
  addToGroup(g: string) { this.groups.add(g); }
  removeFromGroup(g: string) { this.groups.delete(g); }
  emit(payload: any) { this.handlers.get('executionPlanUpdated')?.(payload); }
}

describe('kb-ask-executor (0102)', () => {
  it('ouve o grupo da pergunta, atualiza a atividade sem GET e para ao receber a resposta', () => {
    const ws = new FakeWs();
    const answered = question({ status: 'done', answer: { question: 'x', answer: 'Passo a passo', results: [], terms: [], aiUsed: true } });
    const api = { baseQuestion: jasmine.createSpy('baseQuestion').and.returnValue(of(answered)) };
    const seen: BaseQuestion[] = [];

    watchBaseQuestion(ws as unknown as WsService, api as unknown as ArchitectureService, question(), q => seen.push(q));
    expect(ws.groups.has('execplan:BQ-0123456789AB')).toBeTrue();

    ws.emit({ cardNumber: 'OUTRA', action: 'activity', activity: { label: 'x', at: '' } });
    ws.emit({ cardNumber: 'BQ-0123456789AB', action: 'activity', activity: { label: 'Buscando na Base Solvace', at: '' } });
    expect(api.baseQuestion).not.toHaveBeenCalled();
    expect(seen.at(-1)!.status).toBe('running');
    expect(baseQuestionProgress(seen.at(-1)!)).toBe('Buscando na Base Solvace');

    ws.emit({ cardNumber: 'BQ-0123456789AB', action: 'answer' });
    expect(api.baseQuestion).toHaveBeenCalledWith('q1');
    expect(seen.at(-1)!.answer?.answer).toBe('Passo a passo');
    expect(ws.groups.size).toBe(0);
    expect(ws.handlers.size).toBe(0);
  });

  it('consulta a cada 2 s com o Claude rodando e a cada 5 s na fila', () => {
    expect(pollDelay(question({ status: 'queued' }))).toBe(POLL_QUEUED_MS);
    expect(pollDelay(question({ status: 'running' }))).toBe(POLL_RUNNING_MS);
    expect(pollDelay(question({ status: 'claimed' }))).toBe(POLL_RUNNING_MS);
    expect(POLL_RUNNING_MS).toBeLessThan(POLL_QUEUED_MS);
  });

  it('textos de espera e de erro', () => {
    expect(baseQuestionProgress(question({ waitReason: 'A máquina mac está offline' }))).toBe('A máquina mac está offline');
    expect(baseQuestionProgress(question({ status: 'running', workerName: 'mac-alex' }))).toContain('mac-alex');
    expect(baseQuestionError(question({ status: 'cancelled' }))).toBe('Pergunta cancelada.');
    expect(baseQuestionError(question({ status: 'failed', error: 'O Claude terminou sem gravar a resposta.' }))).toContain('sem gravar');
  });
});
