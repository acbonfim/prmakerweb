import { LocalBrowserList, LocalBrowserSession, browserStreamUrl, pickBrowserSession } from './live-browser';

function session(p: Partial<LocalBrowserSession>): LocalBrowserSession {
  return { sid: 'qa-admin', card: '78161', task: '7', env: 'qa', label: 'QA', readOnly: false, started: '2026-11-12 10:00:00', stream: '/live/qa-admin/stream', ...p };
}

function list(sessions: LocalBrowserSession[], worker: string | null = 'mac-alex'): LocalBrowserList {
  return { worker, token: 'tok', sessions };
}

describe('tela ao vivo — sessão do item (0095)', () => {
  it('sem executor nesta máquina ou sem card não mostra nada', () => {
    expect(pickBrowserSession(null, '78161', 'mac-alex', [7])).toBeNull();
    expect(pickBrowserSession(list([session({})]), null, 'mac-alex', [7])).toBeNull();
  });

  it('só a sessão do mesmo card', () => {
    expect(pickBrowserSession(list([session({ card: '99999' })]), '78161', 'mac-alex', [7])).toBeNull();
    expect(pickBrowserSession(list([session({})]), '78161', 'mac-alex', [7])?.sid).toBe('qa-admin');
  });

  it('o pedido roda em outra máquina: o executor local não é o dele', () => {
    expect(pickBrowserSession(list([session({})], 'outro-mac'), '78161', 'mac-alex', [7])).toBeNull();
    expect(pickBrowserSession(list([session({})], 'MAC-ALEX'), '78161', 'mac-alex', [7])).not.toBeNull();
    expect(pickBrowserSession(list([session({})]), '78161', null, [7])).not.toBeNull();
  });

  it('sessão de uma sub-tarefa de outro item do card fica de fora; sem sub-tarefa, vale', () => {
    expect(pickBrowserSession(list([session({ task: '12' })]), '78161', 'mac-alex', [7, 8])).toBeNull();
    expect(pickBrowserSession(list([session({ task: null })]), '78161', 'mac-alex', [7, 8])).not.toBeNull();
  });

  it('duas sessões do card: a mais recente', () => {
    const older = session({ sid: 'a', started: '2026-11-12 09:00:00' });
    const newer = session({ sid: 'b', started: '2026-11-12 11:00:00' });
    expect(pickBrowserSession(list([older, newer]), '78161', 'mac-alex', [7])?.sid).toBe('b');
  });

  it('a URL do vídeo leva o token e é estável para a mesma sessão', () => {
    const l = list([session({})]);
    const url = browserStreamUrl(l, l.sessions[0]);
    expect(url).toBe('http://127.0.0.1:47615/live/qa-admin/stream?t=tok&v=2026-11-12%2010%3A00%3A00');
    expect(browserStreamUrl(l, l.sessions[0])).toBe(url);
  });
});
