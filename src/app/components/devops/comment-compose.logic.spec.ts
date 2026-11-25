import { activeMentions, insertMention, mentionTrigger } from './comment-compose.logic';

describe('comment-compose.logic (0099 ajustes 3)', () => {
  it('acha @ e # no cursor só no começo de palavra', () => {
    expect(mentionTrigger('oi @al', 6)).toEqual({ kind: 'person', query: 'al', start: 3 });
    expect(mentionTrigger('#78', 3)).toEqual({ kind: 'card', query: '78', start: 0 });
    expect(mentionTrigger('ver (#', 6)).toEqual({ kind: 'card', query: '', start: 5 });
    expect(mentionTrigger('email a@b', 9)).toBeNull();
    expect(mentionTrigger('oi @al ', 7)).toBeNull();
    expect(mentionTrigger('abc#12', 6)).toBeNull();
  });

  it('insere a menção no lugar da consulta e põe o cursor depois', () => {
    const r = insertMention('oi @al tudo', 3, 6, '@Alex Carlos');
    expect(r.text).toBe('oi @Alex Carlos tudo');
    expect(r.caret).toBe('oi @Alex Carlos '.length);
    const end = insertMention('ver #7', 4, 6, '#78794');
    expect(end.text).toBe('ver #78794 ');
  });

  it('só manda as pessoas que continuam no texto', () => {
    const picked = [
      { displayName: 'Alex Carlos', uniqueName: 'alex@x.com' },
      { displayName: 'Nissy Mbambu', uniqueName: 'nissy@x.com' },
      { displayName: 'Alex Carlos', uniqueName: 'alex@x.com' },
    ];
    expect(activeMentions('ok @alex carlos', picked)).toEqual([picked[0]]);
  });
});
