import {
  CANCEL_COMMAND, ComposerItem, ComposerTool, applySuggestion, crossCardSuggestions, detectTrigger, hashSuggestions, isCancelable, moveActive, parseCommand,
  slashSuggestions
} from './composer-suggest';

const TOOLS: ComposerTool[] = [
  { key: 'pr-para-branch', title: 'PR para uma branch', description: 'Abre o PR da branch do card para o destino', icon: 'call_split' },
  { key: 'validar-em-qa', title: 'Validar em QA', description: 'Roteiro de teste e evidências', icon: 'fact_check' },
  { key: 'novo-resumo', title: 'Novo resumo', description: 'Resumo para o cliente', icon: 'notes' }
];

const ITEMS: ComposerItem[] = [
  { number: 12, title: 'PR para release-version', status: 'completed', cardNumber: '77988', done: true },
  { number: 120, title: 'Ajuste pós-QA', status: 'pending', cardNumber: '77988',
    tasks: [{ number: 121, title: 'Criar branch do ajuste', status: 'pending' }, { number: 122, title: 'Abrir PR', status: 'pending' }] },
  { number: 45, title: 'Promover revamp', status: 'cancelled', cardNumber: '77988', done: false },
  { number: 7, title: 'Desfeito', status: 'reverted', cardNumber: '77988', done: true }
];

describe('composer-suggest (0090)', () => {
  describe('detectTrigger', () => {
    it('/ só no começo da mensagem e antes do primeiro espaço', () => {
      expect(detectTrigger('/', 1)).toEqual({ kind: 'slash', query: '', start: 0, end: 1 });
      expect(detectTrigger('/val', 4)).toEqual({ kind: 'slash', query: 'val', start: 0, end: 4 });
      expect(detectTrigger('veja /val', 9)).toBeNull();
      expect(detectTrigger(' /val', 5)).toBeNull();
      expect(detectTrigger('/clear agora', 12)).toBeNull();
    });

    it('# no começo de uma palavra, com número ou texto', () => {
      expect(detectTrigger('olha o #12', 10)).toEqual({ kind: 'hash', query: '12', start: 7, end: 10, command: null, scope: 'card' });
      expect(detectTrigger('#', 1)).toEqual({ kind: 'hash', query: '', start: 0, end: 1, command: null, scope: 'card' });
      expect(detectTrigger('(#pro', 5)?.kind).toBe('hash');
      expect(detectTrigger('abc#12', 6)).toBeNull();
      expect(detectTrigger('#12 e mais', 10)).toBeNull();
    });

    it('## busca em outros cards (o trecho inclui os dois #)', () => {
      expect(detectTrigger('veja ##77', 9)).toEqual({ kind: 'hash', query: '77', start: 5, end: 9, command: null, scope: 'all' });
      expect(detectTrigger('##', 2)).toEqual({ kind: 'hash', query: '', start: 0, end: 2, command: null, scope: 'all' });
      expect(detectTrigger('###1', 4)).toBeNull();
    });

    it('marca o # do /cancelar-item-de-trabalho', () => {
      const t = `/${CANCEL_COMMAND} #1`;
      expect(detectTrigger(t, t.length)).toEqual(jasmine.objectContaining({ kind: 'hash', query: '1', command: 'cancel' }));
    });
  });

  describe('slashSuggestions', () => {
    it('sem filtro: comandos e todas as ferramentas', () => {
      const s = slashSuggestions('', TOOLS);
      expect(s.map((x) => x.id)).toEqual(['cmd:clear', `cmd:${CANCEL_COMMAND}`, 'tool:novo-resumo', 'tool:pr-para-branch', 'tool:validar-em-qa']);
      expect(s[2].detail).toBe('Resumo para o cliente');
    });

    it('filtra por chave, título e descrição (sem acento), chave primeiro', () => {
      expect(slashSuggestions('cle', TOOLS).map((x) => x.id)).toEqual(['cmd:clear']);
      expect(slashSuggestions('cancel', TOOLS).map((x) => x.id)).toEqual([`cmd:${CANCEL_COMMAND}`]);
      expect(slashSuggestions('qa', TOOLS).map((x) => x.id)).toEqual(['tool:validar-em-qa']);
      expect(slashSuggestions('evidencias', TOOLS).map((x) => x.id)).toEqual(['tool:validar-em-qa']);
      expect(slashSuggestions('pr', TOOLS)[0].id).toBe('tool:pr-para-branch');
    });
  });

  describe('hashSuggestions', () => {
    const hash = (q: string, command: 'cancel' | null = null) => ({ kind: 'hash' as const, query: q, start: 0, end: q.length + 1, command, scope: 'card' as const });

    it('pelo começo do número (o exato primeiro, depois os mais recentes); pela palavra no título', () => {
      expect(hashSuggestions(hash('12'), '77988', ITEMS).map((s) => s.number)).toEqual([12, 122, 121, 120]);
      expect(hashSuggestions(hash(''), '77988', ITEMS).map((s) => s.number)).toEqual([120, 45, 12, 7]);
      expect(hashSuggestions(hash('promo'), '77988', ITEMS).map((s) => s.number)).toEqual([45]);
    });

    it('sub-tarefas do card entram quando a pessoa digita (com o item dono); fora do cancelar', () => {
      const [t] = hashSuggestions(hash('121'), '77988', ITEMS);
      expect(t).toEqual(jasmine.objectContaining({ kind: 'item', number: 121, parentNumber: 120 }));
      expect(t.detail).toContain('sub-tarefa de #120');
      expect(hashSuggestions(hash('branch'), '77988', ITEMS).map((s) => s.number)).toEqual([121]);
      expect(hashSuggestions(hash(''), '77988', ITEMS).some((s) => s.parentNumber)).toBeFalse();
      expect(hashSuggestions(hash('121', 'cancel'), '77988', ITEMS).some((s) => s.number === 121)).toBeFalse();
    });

    it('sub-tarefa buscada pelo número: aparece; no cancelar avisa para cancelar o item', () => {
      const sub: ComposerItem = { number: 300, title: 'Sub', status: 'pending', cardNumber: '77988', parentNumber: 299, parentTitle: 'Item' };
      expect(hashSuggestions(hash('300'), '77988', [], sub)[0]).toEqual(jasmine.objectContaining({ number: 300, parentNumber: 299 }));
      expect(hashSuggestions(hash('300', 'cancel'), '77988', [], sub)[0].detail).toContain('sub-tarefa do item #299');
    });

    it('número fora do card: carregando, encontrado (com o card) e inexistente', () => {
      expect(hashSuggestions(hash('99'), '77988', ITEMS, 'loading').at(-1)?.detail).toBe('Buscando o item…');
      const other = hashSuggestions(hash('99'), '77988', ITEMS, { number: 99, title: 'Outro', status: 'pending', cardNumber: '70000' });
      expect(other.at(-1)).toEqual(jasmine.objectContaining({ kind: 'item', number: 99, otherCard: '70000' }));
      expect(hashSuggestions(hash('99'), '77988', ITEMS, null).at(-1)?.kind).toBe('info');
    });

    it('com itens do card pelo prefixo, sem a linha de "buscando"/"não existe" do número exato', () => {
      expect(hashSuggestions(hash('4'), '77988', ITEMS, null).map((s) => s.number)).toEqual([45]);
      expect(hashSuggestions(hash('4'), '77988', ITEMS, 'loading').map((s) => s.kind)).toEqual(['item']);
    });

    it('no /cancelar só itens do card que dá para cancelar ou desfazer', () => {
      expect(hashSuggestions(hash('', 'cancel'), '77988', ITEMS).map((s) => s.number)).toEqual([120, 12]);
      const outside = hashSuggestions(hash('99', 'cancel'), '77988', ITEMS, { number: 99, title: 'Outro', status: 'pending', cardNumber: '70000' });
      expect(outside.at(-1)).toEqual(jasmine.objectContaining({ kind: 'info' }));
    });

    it('lista ainda não carregada', () => {
      expect(hashSuggestions(hash(''), '77988', null)[0].detail).toContain('Carregando');
    });
  });

  it('isCancelable', () => {
    expect(isCancelable({ status: 'running' })).toBeTrue();
    expect(isCancelable({ status: 'failed' })).toBeTrue();
    expect(isCancelable({ status: 'completed', done: true })).toBeTrue();
    expect(isCancelable({ status: 'cancelled', done: false })).toBeFalse();
    expect(isCancelable({ status: 'reverting', done: true })).toBeFalse();
  });

  describe('applySuggestion', () => {
    it('item troca o #trecho pelo número e um espaço', () => {
      const text = 'cancela o #1 por favor';
      const t = detectTrigger(text, 12)!;
      expect(applySuggestion(text, t, { id: 'item:12', kind: 'item', icon: '', label: '#12', detail: '', number: 12 }))
        .toEqual({ kind: 'insert', text: 'cancela o #12 por favor', caret: 14 });
    });

    it('comandos e ferramentas viram ação', () => {
      const t = detectTrigger('/c', 2)!;
      expect(applySuggestion('/c', t, { id: 'cmd:clear', kind: 'command', icon: '', label: '', detail: '', command: 'clear' })).toEqual({ kind: 'clear' });
      expect(applySuggestion('/c', t, { id: 'x', kind: 'command', icon: '', label: '', detail: '', command: CANCEL_COMMAND }))
        .toEqual({ kind: 'insert', text: `/${CANCEL_COMMAND} #`, caret: CANCEL_COMMAND.length + 3 });
      expect(applySuggestion('/v', t, { id: 'tool:v', kind: 'tool', icon: '', label: '', detail: '', tool: 'validar-em-qa' }))
        .toEqual({ kind: 'tool', key: 'validar-em-qa' });
      expect(applySuggestion('/v', t, { id: 'info', kind: 'info', icon: '', label: '', detail: '' })).toBeNull();
    });
  });

  describe('parseCommand', () => {
    it('reconhece os comandos', () => {
      expect(parseCommand(' /clear ')).toEqual({ kind: 'clear' });
      expect(parseCommand(`/${CANCEL_COMMAND} #12`)).toEqual({ kind: 'cancel', number: 12, reason: null });
      expect(parseCommand(`/${CANCEL_COMMAND} 12 não precisa mais`)).toEqual({ kind: 'cancel', number: 12, reason: 'não precisa mais' });
      expect(parseCommand(`/${CANCEL_COMMAND}`)).toEqual({ kind: 'cancel', number: null, reason: null });
      expect(parseCommand('/Validar-em-QA', ['validar-em-qa'])).toEqual({ kind: 'tool', key: 'validar-em-qa' });
      expect(parseCommand('/xyz', ['validar-em-qa'])).toEqual({ kind: 'unknown', name: 'xyz' });
    });

    it('texto comum não é comando', () => {
      expect(parseCommand('olá /clear')).toBeNull();
      expect(parseCommand('/etc/hosts está errado')).toBeNull();
      expect(parseCommand('/clearing')).toEqual({ kind: 'unknown', name: 'clearing' });
    });
  });

  it('moveActive dá a volta', () => {
    expect(moveActive(0, -1, 3)).toBe(2);
    expect(moveActive(2, 1, 3)).toBe(0);
    expect(moveActive(0, 1, 0)).toBe(0);
  });

  describe('crossCardSuggestions (##)', () => {
    const all = (q: string, command: 'cancel' | null = null) => ({ kind: 'hash' as const, query: q, start: 0, end: q.length + 2, command, scope: 'all' as const });

    it('buscando, nada encontrado e resultados de outros cards (com o card e a sub-tarefa)', () => {
      expect(crossCardSuggestions(all('9'), '77988', 'loading')[0].kind).toBe('info');
      expect(crossCardSuggestions(all('9'), '77988', undefined)[0].kind).toBe('info');
      expect(crossCardSuggestions(all('9'), '77988', [])[0].icon).toBe('search_off');
      const res = crossCardSuggestions(all('pr'), '77988', [
        { number: 900, title: 'PR para release', status: 'completed', cardNumber: '70000' },
        { number: 901, title: 'Abrir PR', status: 'completed', cardNumber: '70000', parentNumber: 900, parentTitle: 'PR para release' }
      ]);
      expect(res.map((r) => [r.number, r.otherCard, r.parentNumber])).toEqual([[900, '70000', null], [901, '70000', 900]]);
    });

    it('no cancelar só avisa; a escolha troca o ## pelo #n', () => {
      expect(crossCardSuggestions(all('9', 'cancel'), '77988', [])[0].detail).toContain('Só dá para cancelar itens deste card');
      const t = detectTrigger('ver ##90', 8)!;
      const [s] = crossCardSuggestions(t as never, '77988', [{ number: 900, title: 'X', status: 'pending', cardNumber: '70000' }]);
      expect(applySuggestion('ver ##90', t, s)).toEqual({ kind: 'insert', text: 'ver #900 ', caret: 9 });
    });
  });
});
