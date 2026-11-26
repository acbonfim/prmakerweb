import {
  appName, awsCollectCommand, codeLook, environmentLook, environmentMessage, firstLine, lastDeployAt, sortPipelines, formatDuration, groupPipelines, normalizeVerdict, orderEnvironments, pipelineStatusLook,
  refreshStatusText, relativeAgo, shortSha, snapshotAlert, verdictLook, verdictMessage
} from './aws-deploy.model';
import { AWS_CARD_STATE_MOCK } from './aws-deploy.mock';

describe('aws-deploy.model (0100/F2)', () => {
  it('veredito desconhecido vira unknown', () => {
    expect(normalizeVerdict('deployed')).toBe('deployed');
    expect(normalizeVerdict('NOT-APPLICABLE')).toBe('not-applicable');
    expect(normalizeVerdict('whatever')).toBe('unknown');
    expect(normalizeVerdict(null)).toBe('unknown');
  });

  it('frase do veredito pelo rótulo do ambiente (fallback sem message)', () => {
    expect(verdictMessage('deployed', 'QA')).toBe('Nosso código está em QA');
    expect(verdictMessage('absent', 'Sandboxefeso')).toBe('Ainda não está em Sandboxefeso');
    expect(verdictMessage('waiting', 'QA')).toBe('Na branch de QA, aguardando o deploy');
    expect(verdictMessage('deploying', 'QA')).toBe('Deploy em andamento em QA');
    expect(verdictMessage('failed', 'QA')).toBe('Deploy falhou em QA');
    expect(environmentMessage({ key: 'qa', label: 'QA', verdict: 'deployed', message: '  ' })).toBe('Nosso código está em QA');
    expect(environmentMessage({ key: 'qa', label: 'QA', verdict: 'deployed', message: 'Texto do script' })).toBe('Texto do script');
  });

  it('cores: implantado verde, andamento azul girando, aguardando âmbar, falhou vermelho', () => {
    expect(verdictLook('deployed').tone).toBe('ok');
    expect(verdictLook('deploying')).toEqual(jasmine.objectContaining({ tone: 'info', spin: true }));
    expect(verdictLook('waiting').tone).toBe('warn');
    expect(verdictLook('failed').tone).toBe('bad');
    expect(verdictLook('absent').tone).toBe('muted');
    expect(pipelineStatusLook('InProgress').spin).toBeTrue();
    expect(pipelineStatusLook('Failed').tone).toBe('bad');
    expect(pipelineStatusLook(null).label).toBe('Nunca rodou');
  });

  it('ambientes na ordem da config; desconhecidos no fim', () => {
    const envs = [{ key: 'qa', label: 'QA', verdict: 'deployed' }, { key: 'x', label: 'X', verdict: 'absent' }, { key: 'dev', label: 'DEV', verdict: 'deployed' }];
    const ordered = orderEnvironments(envs, [{ key: 'dev', label: 'DEV', order: 1 }, { key: 'qa', label: 'QA', order: 2 }]);
    expect(ordered.map((e) => e.key)).toEqual(['dev', 'qa', 'x']);
    expect(orderEnvironments(envs, null).map((e) => e.key)).toEqual(['qa', 'x', 'dev']);
  });

  it('ponto da aba: falhou vence andamento', () => {
    expect(snapshotAlert(AWS_CARD_STATE_MOCK.snapshot)).toBeNull();
    expect(snapshotAlert({ environments: [{ key: 'a', label: 'A', verdict: 'deploying' }, { key: 'b', label: 'B', verdict: 'failed' }] })).toBe('failed');
    expect(snapshotAlert({ environments: [{ key: 'a', label: 'A', verdict: 'deploying' }] })).toBe('deploying');
  });

  it('esteiras: principais antes das secundárias, sem o nosso código primeiro; lista longa recolhe as implantadas', () => {
    const short = groupPipelines([
      { name: 'sec', primary: false, deployed: false },
      { name: 'ok', deployed: true },
      { name: 'falta', primary: true, deployed: false }
    ]);
    expect(short.shown.map((p) => p.name)).toEqual(['falta', 'ok', 'sec']);
    expect(short.folded.length).toBe(0);
    expect(short.deployed).toBe(1);
    expect([short.primaryTotal, short.primaryDeployed, short.secondary]).toEqual([2, 1, 1]);

    const many = Array.from({ length: 25 }, (_, i) => ({ name: `p${i}`, deployed: i !== 3 && i !== 7 }));
    const long = groupPipelines(many);
    expect(long.shown.map((p) => p.name)).toEqual(['p3', 'p7']);
    expect(long.folded.length).toBe(23);
    expect(long.deployed).toBe(23);

    const allOk = groupPipelines(Array.from({ length: 9 }, (_, i) => ({ name: `q${i}`, deployed: true })));
    expect(allOk.shown.length).toBe(6);
    expect(allOk.folded.length).toBe(3);
  });

  it('formatação: sha, primeira linha, duração, "há X"', () => {
    expect(shortSha('38f2a1a9c1d2e3f4')).toBe('38f2a1a');
    expect(firstLine('\n  Merge pull request #1  \nAB#1')).toBe('Merge pull request #1');
    expect(formatDuration(42)).toBe('42 s');
    expect(formatDuration(354)).toBe('5 min 54 s');
    expect(formatDuration(3720)).toBe('1 h 2 min');
    expect(formatDuration(null)).toBe('');
    const now = Date.parse('2026-11-24T20:00:00Z');
    expect(relativeAgo('2026-11-24T19:55:00Z', now)).toBe('há 5 min');
    expect(relativeAgo('2026-11-22T20:00:00Z', now)).toBe('há 2 dias');
  });

  it('pedido de coleta e comando manual', () => {
    expect(refreshStatusText({ id: '1', status: 'queued' })?.busy).toBeTrue();
    expect(refreshStatusText({ id: '1', status: 'running' })?.text).toContain('Coletando na sua máquina');
    expect(refreshStatusText({ id: '1', status: 'done' })).toBeNull();
    expect(refreshStatusText({ id: '1', status: 'failed', error: 'sem credencial' })?.text).toContain('sem credencial');
    expect(awsCollectCommand('77971')).toBe('bash ~/.claude/skills/aws-deploy/scripts/aws.sh collect 77971');
  });

  it('acompanhamento com hora marcada não aparece como "aguardando o executor" (card 79019)', () => {
    const now = Date.parse('2026-11-26T19:47:00Z');
    const follow = { id: '1', status: 'queued', source: 'follow', notBefore: '2026-11-26T19:48:41Z' };
    const info = refreshStatusText(follow, now);
    expect(info?.scheduled).toBeTrue();
    expect(info?.busy).toBeFalse();
    expect(info?.text).toContain('Acompanhando o deploy — próxima conferência às');
    expect(info?.text).not.toContain('aguardando o seu executor');
    // passou da hora: aí sim está na fila esperando o executor
    expect(refreshStatusText(follow, Date.parse('2026-11-26T19:49:00Z'))?.text).toContain('aguardando o seu executor');
    expect(refreshStatusText({ id: '2', status: 'queued', notBefore: '2026-11-26T19:50:00Z' }, now)?.text).toContain('Coleta agendada');
  });

  it('esteira quebrada antes do nosso código não pesa contra o card (card 78560)', () => {
    expect(normalizeVerdict('broken')).toBe('broken');
    expect(codeLook({ name: 'edv-solvace-centerline-dev', verdict: 'broken', brokenSince: '2026-11-12T14:41:00Z' }).label).toBe('Esteira quebrada');
    expect(codeLook({ name: 'x', verdict: 'failed', deployed: true }).label).toBe('Implantado');
    expect(codeLook({ name: 'x', verdict: 'waiting', branch: 'release-version' }).hint).toContain('release-version');
    const order = sortPipelines([
      { name: 'a', deployed: true, verdict: 'deployed' }, { name: 'b', verdict: 'broken' }, { name: 'c', verdict: 'waiting' },
      { name: 'd', verdict: 'failed', primary: false }
    ]).map((p) => p.name);
    expect(order).toEqual(['c', 'b', 'a', 'd']);
    expect(appName({ name: 'edv-solvace-centerline-dev', app: 'centerline' })).toBe('centerline');
    expect(lastDeployAt({ key: 'qa', label: 'QA', verdict: 'deployed', pipelines: [
      { name: 'a', deployedAt: '2026-11-24T17:00:00Z' }, { name: 'b', deployedAt: '2026-11-24T18:00:00Z' },
      { name: 'c', deployedAt: '2026-11-25T18:00:00Z', primary: false }] })).toBe('2026-11-24T18:00:00Z');
  });

  it('ambiente parcial fica âmbar, não vermelho', () => {
    const v = environmentLook({ key: 'rt', label: 'SandboxRT', verdict: 'waiting', summary: { apps: 24, withCode: 2 } });
    expect(v.partial).toBeTrue();
    expect(v.tone).toBe('warn');
    expect(environmentLook({ key: 'qa', label: 'QA', verdict: 'deployed', summary: { apps: 25, withCode: 24 } }).tone).toBe('ok');
  });
});
