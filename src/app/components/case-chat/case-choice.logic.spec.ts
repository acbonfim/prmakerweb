import { CaseChoice } from './case-chat.model';
import { canSendChoice, choiceOpen, choicePick } from './case-choice.logic';

const opt = (id: string) => ({ id, label: id.toUpperCase(), style: 'neutral' as const, recommended: false });
const choice = (mode: CaseChoice['mode'], allowOther = false): CaseChoice => ({ mode, options: [opt('a'), opt('b'), opt('c')], allowOther });

describe('0107 escolha do especialista', () => {
  it('escolha única: exatamente uma opção ou a outra resposta', () => {
    const c = choice('single', true);
    expect(canSendChoice(c, [], '')).toBeFalse();
    expect(canSendChoice(c, ['a'], '')).toBeTrue();
    expect(canSendChoice(c, ['a', 'b'], '')).toBeFalse();
    expect(canSendChoice(c, [], 'outra')).toBeTrue();
    expect(choicePick(c, [], ' outra ')).toEqual({ selected: [], other: 'outra' });
  });

  it('checklist: várias opções na ordem da escolha, com a outra resposta junto', () => {
    const c = choice('multi', true);
    expect(canSendChoice(c, ['c', 'a'], '')).toBeTrue();
    expect(choicePick(c, ['c', 'a'], 'mais um')).toEqual({ selected: ['a', 'c'], other: 'mais um' });
  });

  it('sem "outra resposta" o texto é ignorado e opção desconhecida não conta', () => {
    const c = choice('select');
    expect(canSendChoice(c, [], 'texto')).toBeFalse();
    expect(canSendChoice(c, ['zz'], '')).toBeFalse();
    expect(choicePick(c, ['b'], 'texto')).toEqual({ selected: ['b'], other: null });
  });

  it('aberta só sem resposta e sem ter sido substituída', () => {
    expect(choiceOpen({ choice: choice('buttons') })).toBeTrue();
    expect(choiceOpen({ choice: { ...choice('buttons'), closedAt: '2026-11-27T18:00:00Z' } })).toBeFalse();
    expect(choiceOpen({ choice: { ...choice('buttons'), answer: { by: 'Alex', at: '2026-11-27T18:00:00Z', selected: ['a'] } } })).toBeFalse();
    expect(choiceOpen({ choice: null })).toBeFalse();
  });
});
