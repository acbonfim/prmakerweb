import {
  apiErrorMessage, buildCardTimeline, decodeWarningHeader, dayKeys, evaluateLocally, fmtMs, globMatch, groupRulesByCategory, median,
  moveItem, newHook, newRule, normalizeRule, normalizeUserDetail, parseBlockedBody, percentile, perDayStack, periodRange, renumber, ruleMatches,
  slugify, sortRows, toggleSort, validateGlob, validateHook, validateKey, validateMilestones, validateRegex, validateRule,
} from './governance.logic';
import { DEMO_RULES, DEMO_SETTINGS, GovernanceDemoApi, localIso } from './governance.demo';
import { GovernanceCardDetail, GovernanceRule } from './governance.model';

type RuleOver = Partial<Omit<GovernanceRule, 'match' | 'scope'>> & { match?: Partial<GovernanceRule['match']>; scope?: Partial<GovernanceRule['scope']> };

function ruleWith(over: RuleOver): GovernanceRule {
  const base = newRule();
  return normalizeRule({
    ...base, key: 'r', name: 'R', message: 'msg', ...over,
    match: { ...base.match, ...(over.match ?? {}) }, scope: { ...base.scope, ...(over.scope ?? {}) },
  } as GovernanceRule);
}

describe('governance.logic (0098)', () => {
  describe('números', () => {
    it('mediana e percentil', () => {
      expect(median([])).toBeNull();
      expect(median([5, 1, 3])).toBe(3);
      expect(median([1, 2, 3, 4])).toBe(3); // (2+3)/2 arredondado
      expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
      expect(percentile([7], 90)).toBe(7);
    });

    it('duração: vazio, ms e minutos/horas', () => {
      expect(fmtMs(null)).toBe('—');
      expect(fmtMs(420)).toBe('420 ms');
      expect(fmtMs(5 * 60_000)).toBe('5 min');
      expect(fmtMs(125 * 60_000)).toBe('2 h 5 min');
    });
  });

  describe('período', () => {
    it('personalizado inválido cai em 7 dias', () => {
      const now = new Date('2026-11-24T12:00:00').getTime();
      const r = periodRange('custom', '2026-11-30', '2026-11-01', now);
      expect(r.to.getTime()).toBe(now);
      expect(now - r.from.getTime()).toBe(7 * 86_400_000);
    });

    it('personalizado válido vai do início ao fim do dia', () => {
      const r = periodRange('custom', '2026-11-01', '2026-11-02');
      expect(r.from.getHours()).toBe(0);
      expect(r.to.getHours()).toBe(23);
      expect(dayKeys(r.from, r.to)).toEqual(['2026-11-01', '2026-11-02']);
    });

    it('eventos por dia empilhados: ok nunca negativo e dia sem dado = zero', () => {
      const out = perDayStack([{ day: '2026-11-01T00:00:00', events: 10, blocked: 2, warned: 1, errors: 3 }, { day: '2026-11-02', events: 1, blocked: 2, warned: 0, errors: 0 }],
        ['2026-11-01', '2026-11-02', '2026-11-03']);
      expect(out[0].values).toEqual([4, 1, 2, 3]);
      expect(out[1].values).toEqual([0, 0, 2, 0]);
      expect(out[2].values).toEqual([0, 0, 0, 0]);
    });
  });

  describe('ordenação', () => {
    it('nulos no fim, números e texto', () => {
      const rows = [{ n: 2, t: 'b' }, { n: null, t: 'a' }, { n: 5, t: 'c' }];
      expect(sortRows(rows, { key: 'n', dir: -1 }).map((r) => r.n)).toEqual([5, 2, null]);
      expect(sortRows(rows, { key: 'n', dir: 1 }).map((r) => r.n)).toEqual([2, 5, null]);
      expect(sortRows(rows, { key: 't', dir: 1 }).map((r) => r.t)).toEqual(['a', 'b', 'c']);
    });

    it('clique inverte a mesma coluna; texto começa crescente', () => {
      expect(toggleSort({ key: 'a', dir: -1 }, 'a')).toEqual({ key: 'a', dir: 1 });
      expect(toggleSort<'a' | 'name'>({ key: 'a', dir: -1 }, 'name', ['name'])).toEqual({ key: 'name', dir: 1 });
    });
  });

  describe('glob e regex', () => {
    it('ação: * atravessa barras, alternativas com |, sem diferenciar maiúsculas', () => {
      expect(globMatch('POST Azure/card/*/actions/*', 'POST Azure/card/{id}/actions/ready-for-qa')).toBeTrue();
      expect(globMatch('mcp:prmake_pr_*', 'mcp:prmake_pr_open')).toBeTrue();
      expect(globMatch('Bash|Write|Edit|mcp__prmake__*', 'mcp__prmake__prmake_advance')).toBeTrue();
      expect(globMatch('Bash|Write', 'Read')).toBeFalse();
      expect(globMatch('bash', 'Bash')).toBeTrue();
      expect(globMatch('Bash', null)).toBeFalse();
    });

    it('caminho: ** atravessa pastas (inclusive a raiz) e * não passa de /', () => {
      expect(globMatch('**/.aws/credentials', '/Users/x/.aws/credentials', true)).toBeTrue();
      expect(globMatch('**/.aws/credentials', '.aws/credentials', true)).toBeTrue();
      expect(globMatch('**/.prmake/db-credentials*', 'C:\\Users\\x\\.prmake\\db-credentials.json', true)).toBeTrue();
      expect(globMatch('src/*.ts', 'src/a/b.ts', true)).toBeFalse();
      expect(globMatch('src/*.ts', 'src/b.ts', true)).toBeTrue();
    });

    it('valida glob', () => {
      expect(validateGlob('Bash')).toBeNull();
      expect(validateGlob('')).toContain('Informe');
      expect(validateGlob(' Bash')).toContain('espaços');
      expect(validateGlob('a||b')).toContain('vazia');
      expect(validateGlob('src/[ab.ts')).toContain('Colchete');
    });

    it('valida regex (inválida e que casa vazio)', () => {
      expect(validateRegex('git\\s+push')).toBeNull();
      expect(validateRegex('(abc')).toContain('inválida');
      expect(validateRegex('.*')).toContain('vazio');
      expect(validateRegex(' ')).toContain('Informe');
    });
  });

  describe('chaves', () => {
    it('slug sem acento', () => {
      expect(slugify('Não fazer Merge!')).toBe('nao-fazer-merge');
    });

    it('chave em slug e única', () => {
      expect(validateKey('no-merge', [])).toBeNull();
      expect(validateKey('No Merge', [])).toContain('minúsculas');
      expect(validateKey('no-merge', ['no-merge'])).toContain('Já existe');
    });
  });

  describe('regras', () => {
    it('valida campos, regex de allOf e regra sem casamento', () => {
      const r = ruleWith({ key: 'x', name: '', message: '', effect: 'block', match: { allOf: ['(abc'] } });
      const e = validateRule(r, []);
      expect(e['name']).toBeDefined();
      expect(e['message']).toBeDefined();
      expect(e['match.allOf.0']).toContain('inválida');
      expect(validateRule(ruleWith({ key: 'y' }), [])['match']).toContain('nunca casa');
      expect(validateRule(ruleWith({ key: 'z', match: { tools: ['Bash'] }, scope: { roles: ['user'], exceptRoles: ['user'] } }), [])['scope']).toContain('user');
    });

    it('monitor dispensa mensagem', () => {
      expect(validateRule(ruleWith({ key: 'm', effect: 'monitor', message: '', match: { tools: ['Bash'] } }), [])['message']).toBeUndefined();
    });

    it('agrupa por categoria na ordem conhecida, desconhecidas no fim', () => {
      const g = groupRulesByCategory([ruleWith({ key: 'a', category: 'zzz' }), ruleWith({ key: 'b', category: 'git', order: 2 }), ruleWith({ key: 'c', category: 'fluxo' }), ruleWith({ key: 'd', category: 'git', order: 1 })]);
      expect(g.map((x) => x.category)).toEqual(['fluxo', 'git', 'zzz']);
      expect(g[1].rules.map((r) => r.key)).toEqual(['d', 'b']);
      expect(g[1].label).toBe('Git');
    });

    it('cada dimensão preenchida precisa casar; allOf exige todas', () => {
      const r = ruleWith({ match: { tools: ['Bash'], allOf: ['psql', '\\bdelete\\b'] } });
      expect(ruleMatches(r, { source: 'hook', tool: 'Bash', input: 'psql -c "delete from x"' })).toBeTrue();
      expect(ruleMatches(r, { source: 'hook', tool: 'Bash', input: 'psql -c "select 1"' })).toBeFalse();
      expect(ruleMatches(r, { source: 'hook', tool: 'Read', input: 'psql -c "delete from x"' })).toBeFalse();
      expect(ruleMatches(ruleWith({}), { source: 'hook', tool: 'Bash' })).toBeFalse(); // sem dimensão nunca casa
      expect(ruleMatches(ruleWith({ enabled: false, match: { tools: ['Bash'] } }), { source: 'hook', tool: 'Bash' })).toBeFalse();
    });

    it('escopo: origem, papel e papel isento', () => {
      const r = ruleWith({ match: { tools: ['Bash'] }, scope: { sources: ['executor'], exceptRoles: ['admin'] } });
      expect(ruleMatches(r, { source: 'hook', tool: 'Bash' })).toBeFalse();
      expect(ruleMatches(r, { source: 'executor', tool: 'Bash' }, { role: 'user' })).toBeTrue();
      expect(ruleMatches(r, { source: 'executor', tool: 'Bash' }, { role: 'admin' })).toBeFalse();
      const onlyUser = ruleWith({ match: { tools: ['Bash'] }, scope: { roles: ['user'] } });
      expect(ruleMatches(onlyUser, { source: 'hook', tool: 'Bash' }, { role: 'support' })).toBeFalse();
    });

    it('decisão: efeito mais forte; monitor deixa passar com wouldDecide; off não avalia', () => {
      const rules = [
        ruleWith({ key: 'w', effect: 'warn', match: { tools: ['Bash'] } }),
        ruleWith({ key: 'b', effect: 'block', message: 'não pode', match: { tools: ['Bash'], patterns: ['--force'] } }),
      ];
      const req = { source: 'hook' as const, tool: 'Bash', input: 'git push --force' };
      const enforce = evaluateLocally(rules, req, 'enforce');
      expect(enforce.decision).toBe('block');
      expect(enforce.rules.map((r) => r.key).sort()).toEqual(['b', 'w']);
      expect(enforce.reason).toContain('regra b');
      const monitor = evaluateLocally(rules, req, 'monitor');
      expect(monitor.decision).toBe('allow');
      expect(monitor.wouldDecide).toBe('block');
      expect(evaluateLocally(rules, { ...req, input: 'git status' }, 'enforce').decision).toBe('warn');
      expect(evaluateLocally(rules, req, 'off').rules).toEqual([]);
      expect(evaluateLocally([ruleWith({ effect: 'approval', match: { tools: ['Bash'] } })], req, 'enforce').decision).toBe('block');
    });

    it('regras embutidas casam os comandos do Guard e deixam passar os inofensivos', () => {
      const ev = (tool: string, input = '', path?: string) => evaluateLocally(DEMO_RULES, { source: 'hook', tool, input, path }, 'enforce');
      expect(ev('Bash', 'gh pr merge 120 --squash').rules.map((r) => r.key)).toContain('no-merge');
      expect(ev('Bash', 'git push --force origin bugfix/78720').rules.map((r) => r.key)).toContain('no-force-push');
      expect(ev('Bash', 'git push origin master').rules.map((r) => r.key)).toContain('no-push-protected');
      expect(ev('Bash', 'rm -rf ~').rules.map((r) => r.key)).toContain('no-destructive-rm');
      expect(ev('Bash', 'curl -X PATCH https://dev.azure.com/org/_apis/wit/workitems/1').rules.map((r) => r.key)).toContain('writes-through-prmake');
      expect(ev('Bash', 'psql -c "delete from tb_x"').rules.map((r) => r.key)).toContain('no-db-writes');
      expect(ev('Read', '', '/Users/a/.aws/credentials').decision).toBe('block');
      expect(ev('Bash', 'git status').decision).toBe('allow');
      expect(ev('Bash', 'git push origin bugfix/78720').decision).toBe('allow');
      expect(ev('Bash', 'curl https://dev.azure.com/org/_apis/wit/workitems/1').decision).toBe('allow');
      expect(ev('Bash', 'psql -c "select * from tb_x"').decision).toBe('allow');
    });
  });

  describe('hooks', () => {
    it('valida evento, ação compatível e configuração obrigatória', () => {
      const h = { ...newHook(), key: 'x', name: 'X' };
      expect(Object.keys(validateHook(h, []))).toEqual([]);
      expect(validateHook({ ...h, event: 'qualquer' }, [])['event']).toBeDefined();
      expect(validateHook({ ...h, action: 'webhook' }, [])['action']).toContain('Claude Code');
      const wh = { ...h, event: 'server:POST Azure/*', action: 'webhook' as const, config: { url: 'ftp://x' } };
      expect(validateHook(wh, [])['config.url']).toContain('URL');
      expect(validateHook({ ...wh, config: {} }, [])['config.url']).toContain('url');
      expect(validateHook({ ...wh, config: { url: 'https://hooks.exemplo.com/x' } }, [])).toEqual({});
      expect(validateHook({ ...h, event: 'server:*', action: 'evaluate' }, [])['action']).toBeDefined();
    });
  });

  describe('marcos', () => {
    it('chave única, glob e fase só para plano/etapa', () => {
      const ok = DEMO_SETTINGS.milestones;
      expect(validateMilestones(ok)).toEqual({});
      const bad = [
        { key: 'a', label: 'A', order: 1, from: 'plan' as const, at: 'created' as const },
        { key: 'a', label: 'B', order: 2, from: 'plan' as const, at: 'created' as const },
        { key: 'c', label: 'C', order: 3, from: 'task' as const, phase: 'analysis' as const, match: 'pr-open', at: 'finished' as const },
        { key: 'd', label: 'D', order: 4, from: 'event' as const, at: 'finished' as const },
      ];
      const e = validateMilestones(bad);
      expect(e[0]).toBeUndefined();
      expect(e[1]).toContain('Já existe');
      expect(e[2]).toContain('fase');
      expect(e[3]).toContain('casa');
    });

    it('mover e renumerar', () => {
      const list = [{ k: 'a', order: 0 }, { k: 'b', order: 0 }, { k: 'c', order: 0 }];
      expect(moveItem(list, 2, 0).map((x) => x.k)).toEqual(['c', 'a', 'b']);
      expect(moveItem(list, 0, -1)).toBe(list);
      expect(renumber(list).map((x) => x.order)).toEqual([10, 20, 30]);
    });
  });

  describe('linha do tempo do card', () => {
    const t0 = new Date('2026-11-20T09:00:00').getTime();
    const at = (min: number) => localIso(t0 + min * 60_000);
    const detail: GovernanceCardDetail = {
      card: {
        cardNumber: 1, title: 'x', kind: 'Bug', users: ['Ana'], firstActivityAt: at(0), lastActivityAt: at(240),
        milestones: [], analysisMs: null, correctionMs: null, leadTimeMs: null, workItems: 0, tasksDone: 0, blocked: 0, status: null,
      },
      timeline: [
        { at: at(60), endAt: null, durationMs: null, kind: 'milestone', title: 'Análise inicial', user: null, outcome: null, ref: null },
        { at: at(0), endAt: null, durationMs: null, kind: 'milestone', title: 'Iniciou a tarefa', user: null, outcome: null, ref: null },
        { at: at(0), endAt: at(60), durationMs: null, kind: 'plan', title: 'Plano de análise', user: 'Ana', outcome: 'ok', ref: null },
        { at: at(120), endAt: null, durationMs: 30 * 60_000, kind: 'step', title: 'Protótipo', user: 'Bia', outcome: 'ok', ref: null },
        { at: at(240), endAt: null, durationMs: null, kind: 'milestone', title: 'PR aberto', user: null, outcome: null, ref: null },
        { at: 'lixo', endAt: null, durationMs: null, kind: 'event', title: 'inválida', user: null, outcome: null, ref: null },
      ],
    };

    it('ordem cronológica, duração efetiva, deslocamento e quem iniciou', () => {
      const v = buildCardTimeline(detail);
      expect(v.rows.map((r) => r.title)).toEqual(['Iniciou a tarefa', 'Plano de análise', 'Análise inicial', 'Protótipo', 'PR aberto']);
      expect(v.rows[1].effectiveMs).toBe(60 * 60_000);
      expect(v.rows[3].effectiveMs).toBe(30 * 60_000);
      expect(v.rows[3].offsetMs).toBe(120 * 60_000);
      expect(v.startedBy).toBe('Ana');
      expect(v.totalMs).toBe(240 * 60_000);
      expect(v.rows[3].leftPct).toBeCloseTo(50, 5);
    });

    it('marcos com tempo desde o início e desde o anterior', () => {
      const v = buildCardTimeline(detail);
      expect(v.milestones.map((m) => m.label)).toEqual(['Iniciou a tarefa', 'Análise inicial', 'PR aberto']);
      expect(v.milestones[0].sincePrevMs).toBeNull();
      expect(v.milestones[1].sincePrevMs).toBe(60 * 60_000);
      expect(v.milestones[2].sinceStartMs).toBe(240 * 60_000);
      expect(v.byKind.map((k) => k.kind)).toEqual(['plan', 'step']);
    });

    it('sem marcos na linha do tempo usa os do card; sem nada fica vazio', () => {
      const v = buildCardTimeline({ card: { ...detail.card, milestones: [{ key: 'qa', label: 'QA', at: at(200) }] }, timeline: [] });
      expect(v.milestones.map((m) => m.label)).toEqual(['QA']);
      const empty = buildCardTimeline({ card: { ...detail.card, firstActivityAt: null, milestones: [] }, timeline: [] });
      expect(empty.rows).toEqual([]);
      expect(empty.startedAt).toBeNull();
    });
  });

  describe('barrado e aviso', () => {
    it('lê o 403 da governança (objeto, texto, regras como texto) e ignora outros', () => {
      expect(parseBlockedBody({ code: 'governance_blocked', message: 'Sem merge', rules: [{ key: 'no-merge', name: 'Nunca mesclar' }] }))
        .toEqual({ message: 'Sem merge', rules: [{ key: 'no-merge', name: 'Nunca mesclar' }] });
      expect(parseBlockedBody('{"code":"governance_blocked","message":"x","rules":["a"]}')!.rules).toEqual([{ key: 'a', name: 'a' }]);
      expect(parseBlockedBody({ code: 'governance_blocked' })!.message).toContain('barrada');
      expect(parseBlockedBody({ code: 'governance_blocked', message: 'Barrado pela governança: sem merge (regra no-merge)' })!.message).toBe('sem merge (regra no-merge)');
      expect(parseBlockedBody({ code: 'PERSONAL_INTEGRATION_REQUIRED' })).toBeNull();
      expect(parseBlockedBody('não é json')).toBeNull();
      expect(parseBlockedBody(null)).toBeNull();
    });

    it('cabeçalho de aviso: texto puro ou codificado', () => {
      expect(decodeWarningHeader('Cuidado')).toBe('Cuidado');
      expect(decodeWarningHeader('Voc%C3%AA%20passou%20do%20teto%20(regra%20ai-cost-daily)')).toBe('Você passou do teto (regra ai-cost-daily)');
      expect(decodeWarningHeader('100%')).toBe('100%');
      expect(decodeWarningHeader('  ')).toBeNull();
      expect(apiErrorMessage({ status: 409, error: { message: 'Regra embutida não pode ser apagada.' } }, 'x')).toBe('Regra embutida não pode ser apagada.');
      expect(apiErrorMessage({ status: 500, error: '<html>' }, 'Falhou.')).toBe('Falhou.');
    });
  });

  describe('detalhe do usuário', () => {
    it('aceita formato plano (lista no lugar do número) e aninhado', () => {
      const card = { cardNumber: 1 } as never;
      const flat = normalizeUserDetail({ userId: 'u1', userName: 'Ana', events: 3, cards: [card, card], recent: [] }, 'u1');
      expect(flat.summary.cards).toBe(2);
      expect(flat.summary.userName).toBe('Ana');
      expect(flat.cards.length).toBe(2);
      const nested = normalizeUserDetail({ summary: { userId: 'u1', userName: 'Ana', cards: 7 }, cards: [card], recent: [{ id: 1 }] }, 'u1');
      expect(nested.summary.cards).toBe(7);
      expect(nested.recent.length).toBe(1);
      expect(normalizeUserDetail(null, 'u9').summary.userId).toBe('u9');
    });
  });

  describe('demonstração', () => {
    it('gera cards, eventos e agregados coerentes', (done) => {
      const api = new GovernanceDemoApi();
      const range = { from: new Date(Date.now() - 90 * 86_400_000).toISOString(), to: new Date().toISOString() };
      api.overview(range).subscribe((o) => {
        expect(o.kpis.cards).toBe(30);
        expect(o.kpis.events).toBeGreaterThan(100);
        expect(o.perDay.length).toBeGreaterThan(5);
        api.cards({ ...range, size: 5 }).subscribe((p) => {
          expect(p.total).toBe(30);
          expect(p.items.length).toBe(5);
          api.card(p.items[0].cardNumber).subscribe((d) => {
            expect(d.timeline.some((r) => r.kind === 'milestone')).toBeTrue();
            done();
          });
        });
      });
    });

    it('embutida não pode ser apagada', (done) => {
      const api = new GovernanceDemoApi();
      api.deleteRule('r-no-merge').subscribe({ error: (e) => { expect(e.status).toBe(409); done(); } });
    });
  });
});
