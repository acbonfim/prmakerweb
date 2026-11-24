import {
  EpicMonitorCard, defaultCardsView, envBadge, envRow, environmentOrder, hasMergedPr, inProduction, isProductionEnv,
  normalizeEnvStatus, normalizeMonitor, prLook, prName, snapshotLabel, summarizeMonitor, summaryText, touchesCards
} from './epic-monitor.logic';

const card = (id: number, extra: Partial<EpicMonitorCard> = {}): EpicMonitorCard => ({ card: `${id}`, title: `Card ${id}`, ...extra });

describe('epic-monitor.logic (0099 ajustes 2 — acompanhamento)', () => {
  it('normalizeMonitor aceita lista ou {cards} e ignora linha sem card', () => {
    expect(normalizeMonitor([card(1)]).length).toBe(1);
    expect(normalizeMonitor({ cards: [card(1), card(2)] }).length).toBe(2);
    expect(normalizeMonitor(null)).toEqual([]);
    expect(normalizeMonitor([{ card: '' } as EpicMonitorCard, card(3)]).map(c => c.card)).toEqual(['3']);
  });

  it('selos dos ambientes: ✓ / ⏳ / ✕ / —', () => {
    expect(envBadge('deployed')).toEqual(jasmine.objectContaining({ symbol: '✓', tone: 'ok' }));
    expect(envBadge('pending')).toEqual(jasmine.objectContaining({ symbol: '⏳', tone: 'warn' }));
    expect(envBadge('failed')).toEqual(jasmine.objectContaining({ symbol: '✕', tone: 'bad' }));
    expect(envBadge('qualquer')).toEqual(jasmine.objectContaining({ symbol: '—', status: 'unknown' }));
    expect(normalizeEnvStatus('waiting')).toBe('pending');
    expect(normalizeEnvStatus('DEPLOYED')).toBe('deployed');
  });

  it('PRs: mesclado, aberto, rascunho e fechado; nome "repo #n"', () => {
    expect(prLook({ status: 'merged', isDraft: true }).label).toBe('mesclado');
    expect(prLook({ status: 'open', isDraft: true }).label).toBe('rascunho');
    expect(prLook({ status: 'open' }).label).toBe('aberto');
    expect(prLook({ status: 'closed' }).label).toBe('fechado');
    expect(prName({ repository: 'edv-solvace-api', number: 12 })).toBe('edv-solvace-api #12');
    expect(prName({})).toBe('PR');
  });

  it('produção pelo tier ou pelo nome', () => {
    expect(isProductionEnv({ name: 'Produção' })).toBeTrue();
    expect(isProductionEnv({ name: 'prod' })).toBeTrue();
    expect(isProductionEnv({ name: 'Ambiente', tier: 'prod' })).toBeTrue();
    expect(isProductionEnv({ name: 'QA' })).toBeFalse();
    expect(isProductionEnv({ name: 'Sandboxefeso' })).toBeFalse();
    // O servidor já diz (isProduction) — vence o nome.
    expect(isProductionEnv({ name: 'Cliente X', isProduction: true })).toBeTrue();
    expect(isProductionEnv({ name: 'prod-like', isProduction: false })).toBeFalse();
  });

  it('resumo: N cards · X com PR mesclado · Y em produção', () => {
    const cards = [
      card(1, { prs: [{ status: 'merged' }], environments: [{ name: 'QA', status: 'deployed' }, { name: 'Produção', status: 'deployed' }] }),
      card(2, { prs: [{ status: 'open' }, { status: 'merged' }], environments: [{ name: 'Produção', status: 'pending' }] }),
      card(3, { prs: [], environments: null }),
      card(4, { prs: [{ status: 'open' }], environments: [{ name: 'QA', status: 'failed' }] }),
    ];
    const s = summarizeMonitor(cards);
    expect(s).toEqual({ total: 4, withPr: 3, withMergedPr: 2, inProduction: 1, failed: 1, withoutSnapshot: 1 });
    expect(summaryText(s)).toBe('4 cards · 2 com PR mesclado · 1 em produção · 1 com deploy falhando');
    expect(summaryText(summarizeMonitor([card(9)]))).toBe('1 card · 0 com PR mesclado · 0 em produção');
    expect(hasMergedPr(cards[1])).toBeTrue();
    expect(inProduction(cards[1])).toBeFalse();
  });

  it('colunas de ambiente na ordem de chegada, sem repetir; card sem o ambiente vira "—"', () => {
    const cards = [
      card(1, { environments: [{ name: 'DEV', status: 'deployed' }, { name: 'QA', status: 'pending' }] }),
      card(2, { environments: [{ name: 'qa', status: 'deployed' }, { name: 'Produção', status: 'failed' }] }),
      card(3, { environments: null }),
    ];
    const order = environmentOrder(cards);
    expect(order).toEqual(['DEV', 'QA', 'Produção']);
    expect(envRow(cards[0], order)!.map(e => normalizeEnvStatus(e.status))).toEqual(['deployed', 'pending', 'unknown']);
    expect(envRow(cards[1], order)!.map(e => normalizeEnvStatus(e.status))).toEqual(['unknown', 'deployed', 'failed']);
    expect(envRow(cards[2], order)).toBeNull();
  });

  it('retrato de <data>', () => {
    const now = new Date(2026, 10, 24, 15, 0);
    expect(snapshotLabel(new Date(2026, 10, 24, 9, 5).toISOString(), now)).toBe('retrato de hoje 09:05');
    expect(snapshotLabel(new Date(2026, 10, 20, 18, 30).toISOString(), now)).toBe('retrato de 20/11 18:30');
    expect(snapshotLabel(new Date(2025, 0, 2, 8, 0).toISOString(), now)).toBe('retrato de 02/01/2025 08:00');
    expect(snapshotLabel(null, now)).toBe('');
    expect(snapshotLabel('xx', now)).toBe('');
  });

  it('visão padrão: management no Acompanhamento; escolha salva vence', () => {
    expect(defaultCardsView(null, true)).toBe('monitor');
    expect(defaultCardsView(null, false)).toBe('list');
    expect(defaultCardsView('list', true)).toBe('list');
    expect(defaultCardsView('lixo', false)).toBe('list');
  });

  it('devopsCardsUpdated só recarrega quando toca um card do épico (sem ids = recarrega)', () => {
    expect(touchesCards({ ids: ['10', '11'] }, ['11'])).toBeTrue();
    expect(touchesCards({ ids: [12] }, ['11'])).toBeFalse();
    expect(touchesCards(null, ['11'])).toBeTrue();
  });
});
