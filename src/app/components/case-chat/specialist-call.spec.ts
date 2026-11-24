import { CaseMessage } from './case-chat.model';
import { callsSpecialist, composerHint, silentTail } from './specialist-call';

const msg = (over: Partial<CaseMessage>): CaseMessage => ({
  id: over.id ?? Math.random().toString(36), number: 1, authorKind: 'person', authorName: 'Ana', kind: 'text', text: 'ola',
  peopleOnly: false, deep: false, mentions: [], steps: [], createdAt: '2026-11-24T20:00:00Z', files: [], ...over
});

describe('specialist-call (quando o especialista é chamado)', () => {
  it('uma pessoa: qualquer mensagem chama', () => expect(callsSpecialist(msg({ text: 'ola' }), 1)).toBeTrue());
  it('duas pessoas: "ola" não chama; "?" e @especialista chamam', () => {
    expect(callsSpecialist(msg({ text: 'ola' }), 2)).toBeFalse();
    expect(callsSpecialist(msg({ text: 'tudo certo?' }), 2)).toBeTrue();
    expect(callsSpecialist(msg({ text: 'oi @especialista' }), 2)).toBeTrue();
    expect(callsSpecialist(msg({ text: 'oi', mentions: ['Claude'] }), 2)).toBeTrue();
  });
  it('voz usa a transcrição; só entre pessoas nunca chama', () => {
    expect(callsSpecialist(msg({ kind: 'voice', text: '', transcript: 'qual o status?' }), 3)).toBeTrue();
    expect(callsSpecialist(msg({ text: 'e aí?', peopleOnly: true }), 1)).toBeFalse();
  });
  it('silentTail: só as mensagens depois da última resposta que não chamaram', () => {
    const list = [msg({ id: 'a', text: 'ola' }), msg({ id: 'a2', authorName: 'Bia', text: 'oi?' }), msg({ id: 's', authorKind: 'specialist', text: 'resposta' }),
      msg({ id: 'b', text: 'teste' }), msg({ id: 'c', authorName: 'Bia', text: 'oi' })];
    expect([...silentTail(list, 2)].sort()).toEqual(['b', 'c']);
    expect(silentTail(list, 1).size).toBe(0);
    const asked = [...list, msg({ id: 'd', text: 'e agora?' })];
    expect(silentTail(asked, 2).size).toBe(0);
  });
  it('silentTail: quem estava sozinho chamou o especialista mesmo que outra pessoa entre depois', () => {
    const list = [msg({ id: 'a', authorName: 'Bruno', text: 'bom dia' }), msg({ id: 'b', authorName: 'Maria', text: 'ola' })];
    expect([...silentTail(list, 2)]).toEqual(['b']);
    const solo = [msg({ id: 'x', authorName: 'Bruno', text: 'oi' }), msg({ id: 'y', authorName: 'Bruno', text: 'tudo bem' })];
    expect(silentTail(solo, 2).size).toBe(0);
  });
  it('composerHint lembra o ? e o @ com 2+ pessoas', () => {
    expect(composerHint(2, false)).toContain('@especialista');
    expect(composerHint(1, false)).not.toContain('?' + ' ou');
    expect(composerHint(2, true)).toContain('lê quando terminar');
  });
});
