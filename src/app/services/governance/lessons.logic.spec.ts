import { Lesson, filterLessons, parseScope, scopeText, skillsOf, sourceCards, validateLesson } from './lessons.logic';
import { changesRequestedLook } from '../../components/work-items/work-item.model';

function lesson(p: Partial<Lesson>): Lesson {
  return {
    id: 1, code: 'L1', scope: [], trigger: 'a pessoa pede a análise inicial', text: 'use prmake_analysis_start', why: '', sources: [],
    status: 'active', origin: 'agent', hits: 1, createdAt: '2026-11-27T10:00:00Z', createdBy: 'Claude', lastSeenAt: '2026-11-27T10:00:00Z', ...p,
  };
}

describe('0106 — lições aprendidas e pedido de mudanças', () => {
  it('escopo: vazio = todas as skills; texto vira lista sem repetir', () => {
    expect(scopeText([])).toBe('todas as skills');
    expect(scopeText(['especialista-do-caso'])).toBe('especialista-do-caso');
    expect(parseScope(' Especialista-do-caso, all,especialista-do-caso ,analisar-bug')).toEqual(['especialista-do-caso', 'analisar-bug']);
    expect(parseScope('todas')).toEqual([]);
  });

  it('filtra por skill e busca (sem acento, código e card) e põe as reincidentes primeiro', () => {
    const a = lesson({ id: 1, code: 'L1', scope: ['especialista-do-caso'], hits: 1 });
    const b = lesson({ id: 2, code: 'L2', trigger: 'PR já mesclado', text: 'mesma branch e PR novo', hits: 3, sources: [{ card: '79047' }] });
    const c = lesson({ id: 3, code: 'L3', scope: ['analisar-bug'], text: 'outra', trigger: 'outra' });
    expect(filterLessons([a, b, c], '', null).map((l) => l.code)).toEqual(['L2', 'L1', 'L3']);
    expect(filterLessons([a, b, c], '', 'especialista-do-caso').map((l) => l.code)).toEqual(['L2', 'L1']);
    expect(filterLessons([a, b, c], 'ANALISE inicial', null).map((l) => l.code)).toEqual(['L1']);
    expect(filterLessons([a, b, c], '79047', null).map((l) => l.code)).toEqual(['L2']);
    expect(filterLessons([a, b, c], 'l3', null).map((l) => l.code)).toEqual(['L3']);
    expect(skillsOf([a, b, c])).toEqual(['analisar-bug', 'especialista-do-caso']);
  });

  it('cards de origem sem repetir, os mais recentes primeiro', () => {
    expect(sourceCards(lesson({ sources: [{ card: '79047' }, { card: '80001' }, { card: '79047' }, { ref: 'msg 3' }] }))).toEqual(['79047', '80001']);
  });

  it('valida situação e lição', () => {
    expect(validateLesson({ scope: [], trigger: '', text: 'x', why: '' })).toContain('situação');
    expect(validateLesson({ scope: [], trigger: 'x', text: ' ', why: '' })).toContain('lição');
    expect(validateLesson({ scope: [], trigger: 'x', text: 'y', why: '' })).toBeNull();
  });

  it('selo "Mudanças pedidas" só em PR aberto com pedido valendo', () => {
    expect(changesRequestedLook({ kind: 'pr', status: 'open', changesRequested: 1 })?.label).toBe('Mudanças pedidas');
    expect(changesRequestedLook({ kind: 'pr', status: 'open', changesRequested: 2 })?.label).toBe('Mudanças pedidas (2)');
    expect(changesRequestedLook({ kind: 'pr', status: 'merged', changesRequested: 1 })).toBeNull();
    expect(changesRequestedLook({ kind: 'pr', status: 'open', changesRequested: 0 })).toBeNull();
    expect(changesRequestedLook({ kind: 'ticket', status: 'open', changesRequested: 1 })).toBeNull();
  });
});
