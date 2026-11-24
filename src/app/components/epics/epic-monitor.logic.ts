/**
 * 0099 (ajustes 2): **Acompanhamento** da aba Cards da Mesa — por card do épico, os PRs (registro do PRMake, status e
 * branch de destino) e os ambientes onde o código já está (retrato da AWS gravado pela máquina, `AwsCardSnapshots`).
 * Contrato: `GET Epics/{n}/monitor` (features/0099/ajustes-2.md, "Acompanhamento"). Lógica pura (sem Angular).
 */

export type MonitorPrStatus = 'open' | 'merged' | 'closed';
export type MonitorEnvStatus = 'deployed' | 'pending' | 'failed' | 'unknown';

export interface EpicMonitorPr {
  repository?: string | null;
  number?: number | null;
  url?: string | null;
  title?: string | null;
  status?: MonitorPrStatus | string | null;
  isDraft?: boolean | null;
  targetBranch?: string | null;
  branch?: string | null;
  /** O registro não guarda a data do merge (null); `statusSyncedAt` = quando o PRMake viu o status. */
  mergedAt?: string | null;
  statusSyncedAt?: string | null;
}

export interface EpicMonitorEnv {
  name: string;
  status?: MonitorEnvStatus | string | null;
  at?: string | null;
  /** Chave do ambiente na configuração da aba AWS (dev, qa, sandboxefeso, sandboxrt, prod). */
  key?: string | null;
  tier?: string | null;
  /** Veredito original do retrato (deployed, waiting, deploying, absent, failed, not-applicable, unknown). */
  verdict?: string | null;
  message?: string | null;
  /** O servidor já diz se é produção. */
  isProduction?: boolean | null;
}

export interface EpicMonitorCard {
  card: string | number;
  title?: string | null;
  type?: string | null;
  state?: string | null;
  column?: string | null;
  assignedTo?: string | null;
  prs?: EpicMonitorPr[] | null;
  /** null = sem retrato da AWS para o card. */
  environments?: EpicMonitorEnv[] | null;
  awsCollectedAt?: string | null;
  awsCollectedBy?: string | null;
  /** Link do card no DevOps. */
  url?: string | null;
  /** Papel do card no épico: created | linked | mentioned. */
  role?: string | null;
  updatedAt?: string | null;
}

/** Resposta do `GET Epics/{n}/monitor`: a lista, ou um objeto com `cards` (aceita os dois). */
export type EpicMonitorResponse = EpicMonitorCard[] | { cards?: EpicMonitorCard[] | null; [k: string]: unknown } | null;

export function normalizeMonitor(res: EpicMonitorResponse | undefined): EpicMonitorCard[] {
  const list = Array.isArray(res) ? res : (res?.cards ?? []);
  return (list ?? []).filter((c): c is EpicMonitorCard => !!c && c.card != null && `${c.card}`.trim() !== '');
}

export function normalizeEnvStatus(status: string | null | undefined): MonitorEnvStatus {
  const s = `${status ?? ''}`.trim().toLowerCase();
  if (s === 'deployed' || s === 'pending' || s === 'failed') return s;
  // Vereditos da aba AWS (0100), caso o back repasse o original.
  if (s === 'deploying' || s === 'waiting' || s === 'absent') return 'pending';
  return 'unknown';
}

export function normalizePrStatus(status: string | null | undefined): MonitorPrStatus {
  const s = `${status ?? ''}`.trim().toLowerCase();
  if (s === 'merged' || s === 'completed') return 'merged';
  if (s === 'closed' || s === 'abandoned' || s === 'declined') return 'closed';
  return 'open';
}

function fold(v: string | null | undefined): string {
  return `${v ?? ''}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Ambiente de produção: tier `prod` ou nome/chave começando com "prod"/"produção"/"production". */
export function isProductionEnv(env: Pick<EpicMonitorEnv, 'name' | 'key' | 'tier' | 'isProduction'>): boolean {
  if (env.isProduction != null) return !!env.isProduction;
  if (fold(env.tier) === 'prod' || fold(env.tier) === 'production') return true;
  return [env.name, env.key].some(v => /^(prod|produc)/.test(fold(v)));
}

export interface EnvBadge {
  status: MonitorEnvStatus;
  symbol: string;
  label: string;
  /** ok | warn | bad | none — classe de cor. */
  tone: 'ok' | 'warn' | 'bad' | 'none';
}

const ENV_BADGES: Record<MonitorEnvStatus, Omit<EnvBadge, 'status'>> = {
  deployed: { symbol: '✓', label: 'implantado', tone: 'ok' },
  pending: { symbol: '⏳', label: 'aguardando', tone: 'warn' },
  failed: { symbol: '✕', label: 'falhou', tone: 'bad' },
  unknown: { symbol: '—', label: 'sem informação', tone: 'none' },
};

export function envBadge(status: string | null | undefined): EnvBadge {
  const s = normalizeEnvStatus(status);
  return { status: s, ...ENV_BADGES[s] };
}

/** Legenda da visão (na ordem em que aparece na tela). */
export const MONITOR_LEGEND: { symbol: string; label: string; tone: EnvBadge['tone'] }[] = [
  { symbol: '✓', label: 'implantado', tone: 'ok' },
  { symbol: '⏳', label: 'aguardando deploy', tone: 'warn' },
  { symbol: '✕', label: 'deploy falhou', tone: 'bad' },
  { symbol: '—', label: 'sem retrato da AWS', tone: 'none' },
];

export interface PrLook {
  status: MonitorPrStatus;
  draft: boolean;
  label: string;
  icon: string;
  tone: 'ok' | 'info' | 'merged' | 'none';
}

export function prLook(pr: EpicMonitorPr): PrLook {
  const status = normalizePrStatus(pr.status);
  const draft = status === 'open' && !!pr.isDraft;
  if (status === 'merged') return { status, draft: false, label: 'mesclado', icon: 'merge', tone: 'merged' };
  if (status === 'closed') return { status, draft: false, label: 'fechado', icon: 'block', tone: 'none' };
  return draft
    ? { status, draft, label: 'rascunho', icon: 'edit_note', tone: 'info' }
    : { status, draft, label: 'aberto', icon: 'call_split', tone: 'ok' };
}

/** "repo #123" (ou só "#123"/"PR"). */
export function prName(pr: EpicMonitorPr): string {
  const repo = `${pr.repository ?? ''}`.trim();
  const num = pr.number != null && `${pr.number}` !== '' ? `#${pr.number}` : '';
  return [repo, num].filter(Boolean).join(' ') || 'PR';
}

export function hasMergedPr(card: EpicMonitorCard): boolean {
  return (card.prs ?? []).some(p => normalizePrStatus(p.status) === 'merged');
}

export function inProduction(card: EpicMonitorCard): boolean {
  return (card.environments ?? []).some(e => isProductionEnv(e) && normalizeEnvStatus(e.status) === 'deployed');
}

export function hasFailure(card: EpicMonitorCard): boolean {
  return (card.environments ?? []).some(e => normalizeEnvStatus(e.status) === 'failed');
}

export interface MonitorSummary {
  total: number;
  withPr: number;
  withMergedPr: number;
  inProduction: number;
  failed: number;
  withoutSnapshot: number;
}

export function summarizeMonitor(cards: readonly EpicMonitorCard[]): MonitorSummary {
  const s: MonitorSummary = { total: cards.length, withPr: 0, withMergedPr: 0, inProduction: 0, failed: 0, withoutSnapshot: 0 };
  for (const c of cards) {
    if ((c.prs ?? []).length) s.withPr++;
    if (hasMergedPr(c)) s.withMergedPr++;
    if (inProduction(c)) s.inProduction++;
    if (hasFailure(c)) s.failed++;
    if (c.environments == null) s.withoutSnapshot++;
  }
  return s;
}

/** "N cards · X com PR mesclado · Y em produção" (+ falhas, quando houver). */
export function summaryText(s: MonitorSummary): string {
  const parts = [
    `${s.total} ${s.total === 1 ? 'card' : 'cards'}`,
    `${s.withMergedPr} com PR mesclado`,
    `${s.inProduction} em produção`,
  ];
  if (s.failed) parts.push(`${s.failed} com deploy falhando`);
  return parts.join(' · ');
}

/**
 * Ordem das colunas de ambiente: a ordem em que aparecem nos cards (o back manda na ordem da configuração da aba AWS),
 * sem repetir (pelo nome, sem caixa/acento).
 */
export function environmentOrder(cards: readonly EpicMonitorCard[]): string[] {
  const seen = new Map<string, string>();
  for (const c of cards) {
    for (const e of c.environments ?? []) {
      const k = fold(e.name);
      if (k && !seen.has(k)) seen.set(k, e.name);
    }
  }
  return [...seen.values()];
}

/** Os ambientes do card na ordem comum (ambiente que o card não tem vira `unknown`). Sem retrato → null. */
export function envRow(card: EpicMonitorCard, order: readonly string[]): EpicMonitorEnv[] | null {
  if (card.environments == null) return null;
  const byName = new Map(card.environments.map(e => [fold(e.name), e]));
  return order.map(name => byName.get(fold(name)) ?? { name, status: 'unknown' });
}

/** "retrato de 24/11 14:05" (data local; sem data → ''). */
export function snapshotLabel(at: string | null | undefined, now: Date = new Date()): string {
  if (!at) return '';
  const d = new Date(at);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => `${n}`.padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = d.toDateString() === now.toDateString();
  const sameYear = d.getFullYear() === now.getFullYear();
  const day = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}${sameYear ? '' : '/' + d.getFullYear()}`;
  return `retrato de ${sameDay ? 'hoje' : day} ${time}`;
}

/** Visão da aba Cards: quem tem o papel management começa no Acompanhamento; os demais na Lista. Escolha salva vence. */
export type CardsView = 'list' | 'monitor';

export function defaultCardsView(saved: string | null | undefined, management: boolean): CardsView {
  if (saved === 'list' || saved === 'monitor') return saved;
  return management ? 'monitor' : 'list';
}

/** `devopsCardsUpdated` toca um card do épico? (sem ids no payload = sim, por garantia). */
export function touchesCards(payload: { ids?: (string | number)[] | null } | null | undefined, cards: readonly (string | number)[]): boolean {
  const ids = payload?.ids;
  if (!ids || !ids.length) return true;
  const set = new Set(cards.map(c => `${c}`));
  return ids.some(id => set.has(`${id}`));
}
