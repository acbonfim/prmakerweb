import { firstValueFrom } from 'rxjs';
import {
  changedFields, checkLocally, compareCode, decide, draftSummary, eventRepository, filterStandards, groupStandards, inlineMd, isOutOfScopeLine,
  joinExamples, newStandard, normalizeDraft, normalizeStandard, parseErRefs, sortStandards, splitExamples, standardAdherence, standardFacets,
  switchCheckKind, validateReadOnlySql, validateStandard, wordDiff,
} from './standards.logic';
import { DEMO_STANDARDS, demoWikiSnapshot } from './standards.demo';
import { GovernanceDemoApi } from './governance.demo';
import { GovernanceEvent, Standard, StandardCheckTarget } from './governance.model';

function std(over: Partial<Standard> & { key: string }): Standard {
  return normalizeStandard({ id: `id-${over.key}`, code: over.key.toUpperCase(), title: over.key, textPt: 'texto', status: 'active', ...over });
}

function ev(over: Partial<GovernanceEvent>): GovernanceEvent {
  return {
    id: 1, startedAt: '2026-11-20T10:00:00', finishedAt: null, durationMs: null, userId: 'u', userName: 'U', role: null, source: 'hook',
    action: 'hook:PostToolUse:Write', category: 'standard', cardNumber: null, planId: null, phase: null, stepKey: null, workItemNumber: null,
    taskNumber: null, outcome: 'monitored', statusCode: null, rules: [], detail: null, sessionId: null, machine: null, ...over,
  };
}

describe('standards.logic (0101)', () => {
  describe('normalização e ordem', () => {
    it('preenche o que falta sem perder o que veio', () => {
      const s = normalizeStandard({ id: 'x', key: 'db-fk7', title: 'T', textPt: 'P' } as Partial<Standard>);
      expect(s.code).toBe('DB-FK7');
      expect(s.area).toBe('database');
      expect(s.topic).toBe('general');
      expect(s.status).toBe('proposed');
      expect(s.effect).toBe('monitor');
      expect(s.examples).toEqual({ good: [], bad: [] });
      expect(s.appliesTo.repositories).toEqual([]);
      expect(s.check.kind).toBe('none');
      expect(s.source.kind).toBe('manual');
    });

    it('padrão manual novo começa proposto e em monitorar', () => {
      const s = newStandard('application');
      expect(s.status).toBe('proposed');
      expect(s.effect).toBe('monitor');
      expect(s.topic).toBe('layers');
    });

    it('ordem natural dos códigos (G2 < G10, IX < IXU)', () => {
      expect(['G10', 'IXU1', 'G2', 'IX11', 'IX2', 'FK10', 'FK7'].sort(compareCode)).toEqual(['FK7', 'FK10', 'G2', 'G10', 'IX2', 'IX11', 'IXU1']);
      expect(sortStandards([std({ key: 'b', code: 'N10' }), std({ key: 'a', code: 'N2' })]).map((s) => s.code)).toEqual(['N2', 'N10']);
    });
  });

  describe('filtros e grupos', () => {
    const list = [
      std({ key: 'db-fk7', code: 'FK7', topic: 'fk', title: 'Toda FK com índice', status: 'proposed', textPt: 'índice de suporte' }),
      std({ key: 'db-c1', code: 'C1', topic: 'query', title: 'Sem SELECT *', effect: 'warn' }),
      std({ key: 'app-ap-layers', code: 'AP1', area: 'application', topic: 'layers', title: 'Camadas',
        appliesTo: { platforms: [], repositories: ['solvace-revamp-*'], modules: ['actionplan'], objects: [] },
        source: { kind: 'reverse-engineering', ref: 'actionplan#ARQ-001', version: null, url: null } }),
    ];

    it('área, estado, efeito, origem e busca por vários termos', () => {
      expect(filterStandards(list, { area: 'application' }).map((s) => s.code)).toEqual(['AP1']);
      expect(filterStandards(list, { status: 'proposed' }).map((s) => s.code)).toEqual(['FK7']);
      expect(filterStandards(list, { effect: 'warn' }).map((s) => s.code)).toEqual(['C1']);
      expect(filterStandards(list, { source: 'reverse-engineering' }).map((s) => s.code)).toEqual(['AP1']);
      expect(filterStandards(list, { search: 'fk7' }).map((s) => s.code)).toEqual(['FK7']);
      expect(filterStandards(list, { search: 'índice suporte' }).map((s) => s.code)).toEqual(['FK7']);
      expect(filterStandards(list, { search: 'ARQ-001' }).map((s) => s.code)).toEqual(['AP1']);
    });

    it('repositório/módulo: lista vazia vale para todos; glob casa', () => {
      expect(filterStandards(list, { repository: 'solvace-revamp-actionplan-api' }).length).toBe(3);
      expect(filterStandards(list, { repository: 'edv-solvace-api' }).map((s) => s.code)).toEqual(['FK7', 'C1']);
      expect(filterStandards(list, { module: 'kpi' }).map((s) => s.code)).toEqual(['FK7', 'C1']);
    });

    it('agrupa banco antes de aplicação e assuntos na ordem do catálogo', () => {
      const g = groupStandards(list);
      expect(g.map((x) => x.area)).toEqual(['database', 'application']);
      expect(g[0].topics.map((t) => t.topic)).toEqual(['fk', 'query']);
      expect(g[0].topics[0].label).toBe('Chave estrangeira');
    });

    it('facetas e contagens', () => {
      const f = standardFacets(list);
      expect(f.counts).toEqual({ total: 3, active: 2, proposed: 1, deprecated: 0, withCheck: 0, enforcing: 1 });
      expect(f.repositories).toEqual(['solvace-revamp-*']);
      expect(f.modules).toEqual(['actionplan']);
    });

    it('referências da ER', () => {
      expect(parseErRefs('actionplan#ARQ-001 actionplan#ARQ-004, kpi')).toEqual([
        { module: 'actionplan', item: 'ARQ-001' }, { module: 'actionplan', item: 'ARQ-004' }, { module: 'kpi', item: null },
      ]);
      expect(parseErRefs('')).toEqual([]);
    });
  });

  describe('validação do editor', () => {
    it('título, texto, código e chave (só no novo)', () => {
      const e = validateStandard({ ...newStandard(), key: 'Chave Ruim' }, []);
      expect(Object.keys(e).sort()).toEqual(['code', 'key', 'textPt', 'title']);
      const ok = { ...newStandard(), key: 'db-x1', code: 'X1', title: 'T', textPt: 'P' };
      expect(validateStandard(ok, [])).toEqual({});
      expect(validateStandard(ok, ['db-x1'])['key']).toContain('Já existe');
    });

    it('regex inválida, sem alvo, glob e consulta só de leitura', () => {
      const base = { ...newStandard(), key: 'k', code: 'K', title: 'T', textPt: 'P' };
      expect(validateStandard({ ...base, check: { ...base.check, kind: 'regex', target: 'sql', pattern: '(abc' } }, [])['check.pattern']).toContain('inválida');
      expect(validateStandard({ ...base, check: { ...base.check, kind: 'regex', target: null, pattern: 'abc' } }, [])['check.target']).toBeTruthy();
      expect(validateStandard({ ...base, check: { ...base.check, kind: 'path', target: 'path', pattern: '**/[x' } }, [])['check.pattern']).toContain('Colchete');
      expect(validateStandard({ ...base, check: { ...base.check, kind: 'sql', sql: 'DELETE FROM x' } }, [])['check.sql']).toBeTruthy();
    });

    it('consulta de validação: SELECT/WITH sim; gravar/executar não (texto e comentário não contam)', () => {
      expect(validateReadOnlySql("SELECT s.name FROM sys.schemas AS s WHERE s.name LIKE '%[^A-Za-z0-9]%'")).toBeNull();
      expect(validateReadOnlySql("WITH n AS (SELECT 1 AS x) SELECT * FROM n CROSS APPLY (VALUES ('Into'), ('Update')) AS p(w)")).toBeNull();
      expect(validateReadOnlySql('-- update antes\nSELECT 1')).toBeNull();
      expect(validateReadOnlySql('UPDATE t SET x = 1')).toContain('SELECT ou WITH');
      expect(validateReadOnlySql('SELECT * INTO #t FROM x')).toContain('INTO');
      expect(validateReadOnlySql('SELECT 1; EXEC sp_who')).toContain('EXEC');
      expect(validateReadOnlySql('')).toBeTruthy();
    });

    it('todas as consultas de validação dos exemplos passam como somente leitura', () => {
      for (const s of DEMO_STANDARDS.filter((x) => x.check.kind === 'sql')) expect(validateReadOnlySql(s.check.sql)).withContext(s.code).toBeNull();
    });

    it('trocar o tipo da conferência ajusta o alvo', () => {
      const c = normalizeStandard({ key: 'k' }).check;
      expect(switchCheckKind(c, 'regex').target).toBe('sql');
      expect(switchCheckKind(c, 'path')).toEqual(jasmine.objectContaining({ target: 'path', mustMatch: true }));
      expect(switchCheckKind({ ...c, kind: 'regex', pattern: 'x', target: 'code' }, 'none').pattern).toBeNull();
    });

    it('exemplos: um por bloco', () => {
      expect(splitExamples('a\nb\n\n\nc\n')).toEqual(['a\nb', 'c']);
      expect(splitExamples(joinExamples(['x', 'y\nz']))).toEqual(['x', 'y\nz']);
    });
  });

  describe('conferência local', () => {
    const byCode = (c: string) => DEMO_STANDARDS.find((s) => s.code === c)!;

    // Os exemplos certo/errado da própria wiki viram casos de teste (os que são código, não só um nome).
    const cases: [string, StandardCheckTarget][] = [['FK5', 'sql'], ['C2', 'sql'], ['N14', 'sql'], ['IX3', 'sql'], ['PK10', 'sql'], ['G7', 'migration']];
    for (const [code, target] of cases) {
      it(`${code}: exemplos errados acham, certos não`, () => {
        const s = byCode(code);
        const asCode = (x: string) => /\s|\(|\./.test(x);
        const bad = s.examples.bad.filter(asCode);
        const good = s.examples.good.filter(asCode);
        expect(bad.length).withContext('tem exemplo errado em código').toBeGreaterThan(0);
        for (const x of bad) expect(checkLocally([s], { text: x, target }).findings.length).withContext(x).toBeGreaterThan(0);
        for (const x of good) expect(checkLocally([s], { text: x, target }).findings.length).withContext(x).toBe(0);
      });
    }

    it('linha, trecho e dica; dbo e histórico do EF ficam fora', () => {
      const text = 'SELECT LanguageId FROM language.Language;\nSELECT * FROM actionPlan.ActionPlan;\nSELECT * FROM dbo.TB_WCM_SITE;\nSELECT * FROM __EFMigrationsHistory;';
      const r = checkLocally([byCode('C1')], { text, target: 'sql' });
      expect(r.findings.length).toBe(1);
      expect(r.findings[0]).toEqual(jasmine.objectContaining({ code: 'C1', line: 2, excerpt: 'SELECT * FROM actionPlan.ActionPlan;' }));
      expect(r.findings[0].hint).toContain('colunas');
      expect(isOutOfScopeLine('CREATE TABLE [dbo].[X]')).toBeTrue();
      expect(isOutOfScopeLine('CREATE TABLE language.X')).toBeFalse();
    });

    it('SQL também é conferido dentro de migração; código não confere SQL', () => {
      const s = byCode('FK5');
      expect(checkLocally([s], { text: 'migrationBuilder.Sql("... ON DELETE CASCADE")', target: 'migration' }).findings.length).toBe(1);
      expect(checkLocally([s], { text: 'ON DELETE CASCADE', target: 'code' }).findings.length).toBe(0);
    });

    it('precisa conter (mustMatch) e caminho', () => {
      const must = std({ key: 'm', check: { kind: 'regex', target: 'code', pattern: 'ApiVersion', mustMatch: true, sql: null } });
      expect(checkLocally([must], { text: 'class X {}', target: 'code' }).findings[0].line).toBeNull();
      expect(checkLocally([must], { text: '[ApiVersion("1.0")]', target: 'code' }).findings.length).toBe(0);
      const path = std({ key: 'p', check: { kind: 'path', target: 'path', pattern: '**/*.domain/**/*Controller.cs', mustMatch: false, sql: null } });
      expect(checkLocally([path], { text: '', target: 'path', path: 'src/ap.domain/Web/XController.cs' }).findings.length).toBe(1);
      expect(checkLocally([path], { text: '', target: 'path', path: 'src/ap.api/Controllers/XController.cs' }).findings.length).toBe(0);
      // caminho também vale quando o alvo é SQL e o arquivo foi informado
      const root = std({ key: 'r', check: { kind: 'path', target: 'path', pattern: '*.sql', mustMatch: false, sql: null } });
      expect(checkLocally([root], { text: 'SELECT 1', target: 'sql', path: 'fix.sql' }).findings.length).toBe(1);
      expect(checkLocally([root], { text: 'SELECT 1', target: 'sql', path: 'Scripts/fix.sql' }).findings.length).toBe(0);
    });

    it('descontinuado não confere; repositório fora do aplica-se não confere', () => {
      const s = byCode('C1');
      expect(checkLocally([{ ...s, status: 'deprecated' }], { text: 'SELECT * FROM a.B', target: 'sql' }).findings.length).toBe(0);
      const scoped = { ...s, appliesTo: { ...s.appliesTo, repositories: ['solvace-revamp-*'] } };
      expect(checkLocally([scoped], { text: 'SELECT * FROM a.B', target: 'sql', repository: 'edv-solvace-api' }).findings.length).toBe(0);
      expect(checkLocally([scoped], { text: 'SELECT * FROM a.B', target: 'sql', repository: 'solvace-revamp-kpi-api' }).findings.length).toBe(1);
    });

    it('efeito: proposto só monitora; decisão depende do modo', () => {
      const block = { ...byCode('C1'), effect: 'block' as const, status: 'active' as const };
      const r = checkLocally([block], { text: 'SELECT * FROM a.B', target: 'sql' }, 'enforce');
      expect(r.decision).toBe('block');
      expect(r.findings[0].effect).toBe('block');
      expect(checkLocally([block], { text: 'SELECT * FROM a.B', target: 'sql' }, 'monitor')).toEqual(jasmine.objectContaining({ decision: 'allow', wouldDecide: 'block' }));
      const proposed = { ...block, status: 'proposed' as const };
      expect(checkLocally([proposed], { text: 'SELECT * FROM a.B', target: 'sql' }, 'enforce').decision).toBe('allow');
      expect(decide([{ effect: 'warn' }, { effect: 'monitor' }], 'enforce').decision).toBe('warn');
      expect(decide([], 'enforce').decision).toBe('allow');
    });
  });

  describe('importação', () => {
    const cur = [std({ key: 'db-fk7', code: 'FK7', textPt: 'Toda FK deve ter um índice de suporte.' }), std({ key: 'db-pk3', code: 'PK3' })];

    it('novos, alterados ({before, after} ou só o padrão) e removidos (padrão ou chave)', () => {
      const after = { ...cur[0], textPt: 'Toda FK deve ter um índice de suporte com SiteId.' };
      const rows = normalizeDraft({
        id: 'd', version: '2.1', added: [std({ key: 'db-g5', code: 'G5', status: 'proposed' })], changed: [after], removed: ['db-pk3'],
      }, cur);
      expect(rows.map((r) => `${r.kind}:${r.code}`)).toEqual(['added:G5', 'changed:FK7', 'removed:PK3']);
      expect(rows[1].fields.map((f) => f.key)).toEqual(['textPt']);
      expect(rows[2].before?.code).toBe('PK3');
      expect(draftSummary(rows)).toEqual({ added: 1, changed: 1, removed: 1, proposed: 1 });

      const rows2 = normalizeDraft({ id: 'd', version: null, added: [], changed: [{ before: cur[0], after }], removed: [cur[1]] }, []);
      expect(rows2.map((r) => r.kind)).toEqual(['changed', 'removed']);
      expect(rows2[0].fields.map((f) => f.label)).toEqual(['Texto PT']);
    });

    it('campos que mudaram', () => {
      const a = cur[0];
      expect(changedFields(a, { ...a, effect: 'warn', examples: { good: ['x'], bad: [] } }).map((f) => f.key)).toEqual(['examples', 'effect']);
      expect(changedFields(a, a)).toEqual([]);
    });

    it('diferença por palavra remonta os dois textos', () => {
      const a = 'Toda FK deve ter um índice de suporte.';
      const b = 'Toda FK precisa ter um índice de suporte com SiteId.';
      const d = wordDiff(a, b);
      expect(d.filter((x) => x.op !== 'ins').map((x) => x.text).join('')).toBe(a);
      expect(d.filter((x) => x.op !== 'del').map((x) => x.text).join('')).toBe(b);
      expect(d.find((x) => x.op === 'del')?.text.trim()).toBe('deve');
      expect(d.some((x) => x.op === 'ins' && x.text.includes('SiteId'))).toBeTrue();
      expect(wordDiff('', '')).toEqual([]);
      expect(wordDiff(null, 'novo')).toEqual([{ op: 'ins', text: 'novo' }]);
    });

    it('demonstração: wiki v2.1 traz 8 novos (NEW = proposto), 2 alterados e 1 que saiu; aplicar zera a diferença', async () => {
      const api = new GovernanceDemoApi();
      const before = await firstValueFrom(api.standards());
      const d = await firstValueFrom(api.importStandardsWiki('https://dev.azure.com/x/_wiki/wikis/y/236'));
      const rows = normalizeDraft(d, before);
      const sum = draftSummary(rows);
      expect(sum).toEqual(jasmine.objectContaining({ added: 8, changed: 2, removed: 1 }));
      expect(rows.filter((r) => r.kind === 'changed').map((r) => r.code).sort()).toEqual(['C2', 'FK7']);
      expect(rows.filter((r) => r.kind === 'added').every((r) => r.after!.effect === 'monitor')).toBeTrue();
      expect(rows.find((r) => r.code === 'P5')!.after!.status).toBe('proposed');
      expect(rows.find((r) => r.code === 'N6')!.after!.status).toBe('active');
      const res = await firstValueFrom(api.applyStandardsImport(d.id, rows.map((r) => r.key)));
      expect(res).toEqual(jasmine.objectContaining({ added: 8, changed: 2, removed: 1 }));
      const again = await firstValueFrom(api.importStandardsWiki('https://dev.azure.com/x/_wiki/wikis/y/236'));
      expect(draftSummary(normalizeDraft(again, await firstValueFrom(api.standards())))).toEqual({ added: 0, changed: 0, removed: 0, proposed: 0 });
    });

    it('demonstração: a cópia da wiki tem os itens (NEW) como propostos e tudo em monitorar', () => {
      const snap = demoWikiSnapshot();
      expect(snap.every((s) => s.effect === 'monitor')).toBeTrue();
      expect(snap.filter((s) => s.status === 'proposed').map((s) => s.code)).toContain('FK7');
      expect(snap.find((s) => s.code === 'FK5')!.status).toBe('active');
    });
  });

  describe('aderência', () => {
    const list = [std({ key: 'db-fk7', code: 'FK7', id: 'g-1' }), std({ key: 'db-c1', code: 'C1' })];

    it('repositório do evento: campo, "repo:" no detalhe ou nada', () => {
      expect(eventRepository(ev({ detail: 'repo: edv-solvace-api · Scripts/x.sql:3 · SELECT *' }))).toBe('edv-solvace-api');
      expect(eventRepository(ev({ detail: 'repository=prform.api; x' }))).toBe('prform.api');
      expect(eventRepository({ ...ev({}), repository: 'r1' } as GovernanceEvent)).toBe('r1');
      expect(eventRepository(ev({ detail: 'sem repo aqui' }))).toBeNull();
    });

    it('conta por padrão (chave, id ou código), repositório e card', () => {
      const events = [
        ev({ id: 1, rules: ['db-fk7'], cardNumber: 10, detail: 'repo: a', startedAt: '2026-11-20T10:00:00' }),
        ev({ id: 2, rules: ['g-1', 'C1'], cardNumber: 10, detail: 'repo: b', outcome: 'blocked', startedAt: '2026-11-21T10:00:00' }),
        ev({ id: 3, rules: ['FK7'], cardNumber: 11, outcome: 'warned', startedAt: '2026-11-19T10:00:00' }),
      ];
      const v = standardAdherence(events, list);
      expect(v.total).toBe(3);
      expect(v.blocked).toBe(1);
      expect(v.warned).toBe(1);
      expect(v.byStandard.map((r) => [r.code, r.count, r.cards, r.repositories])).toEqual([['FK7', 3, 2, 2], ['C1', 1, 1, 1]]);
      expect(v.byStandard[0].lastAt).toBe('2026-11-21T10:00:00');
      expect(v.byRepository.map((r) => [r.key, r.count])).toEqual([['b', 1], ['a', 1], ['—', 1]]);
      expect(v.repositories).toBe(2);
      expect(v.byCard.map((r) => [r.card, r.count, r.standards])).toEqual([[10, 2, ['C1', 'FK7']], [11, 1, ['FK7']]]);
      expect(v.recent.map((e) => e.id)).toEqual([2, 1, 3]);
    });

    it('demonstração: a trilha tem achados de padrões', async () => {
      const api = new GovernanceDemoApi();
      const now = new Date();
      const page = await firstValueFrom(api.events({ category: 'standard', from: new Date(now.getTime() - 60 * 86_400_000).toISOString(), to: now.toISOString(), size: 1000 }));
      expect(page.total).toBeGreaterThan(30);
      const v = standardAdherence(page.items, await firstValueFrom(api.standards()));
      expect(v.byStandard.length).toBeGreaterThanOrEqual(5);
      expect(v.repositories).toBeGreaterThan(1);
    });
  });

  it('markdown de linha: código e negrito, resto escapado', () => {
    expect(inlineMd('Use `PK_[schema]` e **sempre** <b>x</b>')).toBe('Use <code>PK_[schema]</code> e <b>sempre</b> &lt;b&gt;x&lt;/b&gt;');
    expect(inlineMd(null)).toBe('');
  });
});
