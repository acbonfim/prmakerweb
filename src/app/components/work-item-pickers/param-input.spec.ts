import {
  ALL_CARD_COMMITS,
  BASE_BRANCHES,
  branchSuggestions,
  formatCommits,
  githubBase,
  mergeBranchOptions,
  orderStates,
  paramDisplay,
  paramInput,
  paramLink,
  paramOptions,
  parseCommits,
  pickerErrorHint,
  prOptions,
  splitTargets,
  targetSuggestions
} from './param-input';

describe('0085 r3 — controles dos parâmetros (param-input)', () => {
  describe('paramInput', () => {
    it('usa o input do catálogo quando é conhecido', () => {
      expect(paramInput({ key: 'x', input: 'state' })).toBe('state');
      expect(paramInput({ key: 'repository', input: 'TEXTAREA' })).toBe('textarea');
    });

    it('input desconhecido cai na reserva pelo nome', () => {
      expect(paramInput({ key: 'repository', input: 'combo-mágico' })).toBe('repository');
    });

    it('reserva pelo nome do parâmetro', () => {
      expect(paramInput({ key: 'repository' })).toBe('repository');
      expect(paramInput({ key: 'branch' })).toBe('branch');
      expect(paramInput({ key: 'source' })).toBe('branch');
      expect(paramInput({ key: 'from' })).toBe('branch');
      expect(paramInput({ key: 'target' }, 'pr')).toBe('target-branch');
      expect(paramInput({ key: 'state' })).toBe('state');
      expect(paramInput({ key: 'commits' })).toBe('commits');
      expect(paramInput({ key: 'description' })).toBe('textarea');
      expect(paramInput({ key: 'instructions' })).toBe('textarea');
      expect(paramInput({ key: 'message' })).toBe('textarea');
      expect(paramInput({ key: 'title' })).toBe('text');
      expect(paramInput({ key: 'Priority' })).toBe('text');
    });

    it('target de comentário/aviso/chamado é texto, não branch', () => {
      expect(paramInput({ key: 'target' }, 'comment')).toBe('text');
      expect(paramInput({ key: 'target' }, 'notify')).toBe('text');
    });

    it('com options vira select; draft sem options vira Sim/Não', () => {
      expect(paramInput({ key: 'priority', options: ['1', '2'] })).toBe('select');
      expect(paramInput({ key: 'draft' })).toBe('select');
      expect(paramOptions({ key: 'draft' }).map((o) => o.label)).toEqual(['Não', 'Sim']);
      expect(paramOptions({ key: 'draft', options: ['false', 'true'] }).map((o) => `${o.value}=${o.label}`)).toEqual(['false=Não', 'true=Sim']);
      expect(paramOptions({ key: 'p', options: ['a', { value: 'b', label: 'Bê' }, { value: '' }] })).toEqual([
        { value: 'a', label: 'a' },
        { value: 'b', label: 'Bê' }
      ]);
    });
  });

  describe('sugestões de branch', () => {
    const ctx = {
      mainBranch: 'hotfix/77434',
      branchesByTarget: { 'release-version': 'hotfix/77434-rv', 'hotfix-version': 'hotfix/77434-hv' },
      flowTargets: 'development, qa'
    };

    it('destino: fluxo primeiro, depois destinos com regra, depois as bases — sem repetir', () => {
      const names = targetSuggestions(ctx).map((o) => `${o.tag}:${o.name}`);
      expect(names.slice(0, 4)).toEqual(['fluxo:development', 'fluxo:qa', 'regra:release-version', 'regra:hotfix-version']);
      expect(names.slice(4)).toEqual(['base:master', 'base:edge']);
    });

    it('branch: a do card, as por destino (hotfix/77434-rv) e as bases', () => {
      const list = branchSuggestions(ctx);
      expect(list[0]).toEqual(jasmine.objectContaining({ name: 'hotfix/77434', tag: 'card' }));
      expect(list[1]).toEqual(jasmine.objectContaining({ name: 'hotfix/77434-rv', tag: 'regra', hint: '→ release-version' }));
      expect(list.slice(3).map((o) => o.name)).toEqual([...BASE_BRANCHES]);
    });

    it('sem regras só sugere as bases', () => {
      expect(targetSuggestions(null).map((o) => o.name)).toEqual([...BASE_BRANCHES]);
    });

    it('destinos do fluxo: vírgula e "a/b" separam; prefixo de branch não', () => {
      expect(splitTargets('release-version/hotfix-version, qa')).toEqual(['release-version', 'hotfix-version', 'qa']);
      expect(splitTargets('hotfix/77434, QA, qa')).toEqual(['hotfix/77434', 'QA']);
      expect(splitTargets(['development', ' '])).toEqual(['development']);
      expect(splitTargets(null)).toEqual([]);
    });

    it('junta com o GitHub: sugestões que batem primeiro, padrão do GitHub antes das outras, sem duplicar', () => {
      const remote = [
        { name: 'feature/x' },
        { name: 'master', isDefault: true, protected: true },
        { name: 'qa', protected: true }
      ];
      const all = mergeBranchOptions(targetSuggestions(ctx), remote, '');
      expect(all.filter((o) => o.name === 'qa').length).toBe(1);
      expect(all.find((o) => o.name === 'qa')!.tag).toBe('fluxo');
      expect(all.find((o) => o.name === 'master')!.hint).toBe('padrão');
      expect(all[all.length - 1]).toEqual({ name: 'feature/x', tag: 'github', hint: null });

      const filtered = mergeBranchOptions(branchSuggestions(ctx), [{ name: 'hotfix/77434-rv' }, { name: 'hotfix/77434-old' }], '77434');
      expect(filtered.map((o) => o.name)).toEqual(['hotfix/77434', 'hotfix/77434-rv', 'hotfix/77434-hv', 'hotfix/77434-old']);
    });
  });

  describe('estados do card', () => {
    const cs = {
      type: 'Bug',
      current: 'Active',
      states: [
        { name: 'New' },
        { name: 'Active', suggested: true },
        { name: 'Ready for QA', suggested: true },
        { name: 'Closed' },
        { name: 'Dev Test in QA', suggested: true }
      ]
    };

    it('sugeridos no topo (na ordem do servidor); o atual fica marcado fora do topo', () => {
      const list = orderStates(cs);
      expect(list.map((s) => s.name)).toEqual(['Ready for QA', 'Dev Test in QA', 'New', 'Active', 'Closed']);
      expect(list.find((s) => s.name === 'Active')!.current).toBeTrue();
    });

    it('respeita o current que vem em cada estado', () => {
      const list = orderStates({ current: null, states: [{ name: 'A', suggested: true, current: true }, { name: 'B', suggested: true }] });
      expect(list.map((s) => `${s.name}${s.current ? '*' : ''}`)).toEqual(['B', 'A*']);
    });

    it('sem integração (409/403) o aviso é discreto; outro erro avisa', () => {
      expect(pickerErrorHint(409, 'branches', 'x').warn).toBeFalse();
      expect(pickerErrorHint(403, 'estados', 'x').text).toContain('DevOps');
      expect(pickerErrorHint(502, 'estados', 'Falhou')).toEqual({ text: 'Falhou', warn: true });
    });

    it('filtra pelo texto', () => {
      expect(orderStates(cs, 'qa').map((s) => s.name)).toEqual(['Ready for QA', 'Dev Test in QA']);
      expect(orderStates(null)).toEqual([]);
    });
  });

  describe('commits', () => {
    it('"card" ou vazio = todos os do card', () => {
      expect(parseCommits(ALL_CARD_COMMITS)).toEqual({ all: true, shas: [] });
      expect(parseCommits('')).toEqual({ all: true, shas: [] });
      expect(paramDisplay('commits', 'card')).toBe('Todos os commits do card');
    });

    it('SHAs separados por vírgula/espaço, sem repetir', () => {
      expect(parseCommits('abc1234, def5678 abc1234')).toEqual({ all: false, shas: ['abc1234', 'def5678'] });
      expect(formatCommits(false, ['abc', ' def ', 'abc'])).toBe('abc,def');
      expect(formatCommits(true, ['abc'])).toBe('card');
      expect(paramDisplay('commits', 'abcdef1234,1234567890')).toBe('abcdef1, 1234567');
    });
  });

  describe('links do GitHub', () => {
    it('base pelo catálogo ou pelo owner', () => {
      expect(githubBase('https://github.com/solvace/')).toBe('https://github.com/solvace');
      expect(githubBase(null, 'solvace')).toBe('https://github.com/solvace');
      expect(githubBase(null, null)).toBeNull();
    });

    it('repositório e branch viram link; sem base, sem repo ou com vários destinos, texto', () => {
      const b = 'https://github.com/solvace';
      expect(paramLink('repository', 'edv-solvace-api', b)).toBe('https://github.com/solvace/edv-solvace-api');
      expect(paramLink('branch', 'hotfix/77434-rv', b, 'edv')).toBe('https://github.com/solvace/edv/tree/hotfix/77434-rv');
      expect(paramLink('target-branch', 'development, qa', b, 'edv')).toBeNull();
      expect(paramLink('branch', 'x', null, 'edv')).toBeNull();
      expect(paramLink('branch', 'x', b, null)).toBeNull();
      expect(paramLink('state', 'Closed', b, 'edv')).toBeNull();
    });
  });

  describe('rodada 4 — pull request (kind pr-review)', () => {
    it('paramInput: input pull-request e reserva pelo nome', () => {
      expect(paramInput({ key: 'x', input: 'pull-request' })).toBe('pull-request');
      expect(paramInput({ key: 'pullRequest' })).toBe('pull-request');
      expect(paramInput({ key: 'focus' })).toBe('textarea');
    });

    it('paramLink: URL do PR vira link (sem precisar da base)', () => {
      expect(paramLink('pull-request', 'https://github.com/o/r/pull/12', null)).toBe('https://github.com/o/r/pull/12');
      expect(paramLink('pull-request', '12', 'https://github.com/o')).toBeNull();
    });

    const pr = (over: Record<string, unknown>) => ({
      id: 1, pullRequestRegisterId: 1, cardNumber: '77434', repositoryId: 'edv-solvace', branchPrefix: 'hotfix', branchName: 'hotfix/77434-dev',
      targetBranch: 'development', number: 10, url: 'https://github.com/o/edv-solvace/pull/10', title: 'Fix OEE', description: '', status: 'OPEN',
      isDraft: false, statusSyncedAt: null, statusStale: false, alreadyExisted: false, userId: 'u', createdAt: '2026-11-01T10:00:00', updatedAt: null,
      ...over
    }) as any;

    it('prOptions: repositório escolhido primeiro, abertos antes, mais novos primeiro; filtra', () => {
      const list = [
        pr({ id: 1, number: 10, url: 'u10', repositoryId: 'edv-solvace', status: 'MERGED' }),
        pr({ id: 2, number: 11, url: 'u11', repositoryId: 'edv-solvace-api', status: 'OPEN' }),
        pr({ id: 3, number: 12, url: 'u12', repositoryId: 'edv-solvace', status: 'OPEN', createdAt: '2026-11-03T10:00:00' }),
        pr({ id: 4, number: null, url: '', status: 'LEGACY' })
      ];
      const o = prOptions(list, 'edv-solvace');
      expect(o.map((x) => x.value)).toEqual(['u12', 'u10', 'u11']);
      expect(o[0].label).toBe('#12 Fix OEE');
      expect(o[0].hint).toBe('edv-solvace: hotfix/77434-dev → development');
      expect(o[0].status).toBe('aberto');
      expect(o[0].open).toBeTrue();
      expect(o[1].status).toBe('mesclado');
      expect(prOptions(list, null, '#11').map((x) => x.value)).toEqual(['u11']);
      expect(prOptions(null)).toEqual([]);
    });

    it('prOptions: sem URL usa repo#número', () => {
      expect(prOptions([pr({ url: '', number: 7 })])[0].value).toBe('edv-solvace#7');
    });
  });
});
