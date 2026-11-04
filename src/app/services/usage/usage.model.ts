/**
 * Dados de uso (0079): contrato com a API (`api/v1/Usage`) e com o hub de tempo real (presença).
 * Ver `features/0079/plan.md` no backend.
 */

/** Estado de presença de uma aba. */
export type PresenceState = 'active' | 'busy' | 'background' | 'away';

/** Tipos de evento gravados em lote. */
export type UsageEventKind = 'view' | 'click' | 'action' | 'error' | 'slow' | 'track' | 'login' | 'logout';

export interface UsageClientInfo {
  browser: string;
  os: string;
  device: string;
  screenSize: string;
  language: string;
  timeZone: string;
  appVersion: string;
}

export interface UsageEvent {
  at: string;
  kind: UsageEventKind;
  screen: string | null;
  route: string | null;
  card: string | null;
  name: string;
  detail?: string | null;
  durationMs?: number | null;
  status?: number | null;
}

export interface UsageBatch {
  session: {
    id: string;
    startedAt: string;
    screen: string | null;
    route: string | null;
    foregroundMs: number;
    backgroundMs: number;
    awayMs: number;
    ended: boolean;
    client: UsageClientInfo;
  };
  events: UsageEvent[];
}

/** Enviado ao hub por `UpdatePresence`. */
export interface PresenceReport {
  sessionId: string;
  state: PresenceState;
  visible: boolean;
  focused: boolean;
  screen: string | null;
  route: string | null;
  card: string | null;
  busy: string | null;
  lastInputAt: string;
  since: string;
  startedAt: string;
  fullName: string | null;
  client: UsageClientInfo;
}

/** Uma aba conectada, como o hub devolve (`WatchPresence` / `presenceChanged`). */
export interface PresenceEntry {
  connectionId: string;
  userId: string | null;
  userName: string | null;
  fullName: string | null;
  sessionId: string | null;
  state: PresenceState | null;
  visible: boolean;
  focused: boolean;
  screen: string | null;
  route: string | null;
  card: string | null;
  busy: string | null;
  lastInputAt: string | null;
  since: string | null;
  startedAt: string | null;
  connectedAt: string | null;
  updatedAt: string | null;
  ip: string | null;
  userAgent: string | null;
  client: Partial<UsageClientInfo> | null;
}

// ---- leituras de análise (admin) ----

export interface UsageKpis {
  activeUsers: number;
  sessions: number;
  logins: number;
  failedLogins: number;
  avgSessionMs: number;
  foregroundMs: number;
  views: number;
  actions: number;
  errors: number;
}

export interface UsageDay {
  day: string;
  activeUsers: number;
  sessions: number;
  logins: number;
  failedLogins: number;
  views: number;
  actions: number;
}

export interface UsageHeatCell {
  /** 0 = domingo … 6 = sábado, no fuso do navegador. */
  weekday: number;
  hour: number;
  count: number;
}

export interface UsageScreenStat {
  screen: string;
  views: number;
  foregroundMs: number;
  users: number;
}

export interface UsageActionStat {
  name: string;
  screen?: string | null;
  count: number;
  users: number;
}

export interface UsageErrorStat {
  name: string;
  status: number | null;
  count: number;
}

export interface UsageNamedCount {
  name: string;
  count: number;
}

export interface UsageUserStat {
  userExternalId: string | null;
  userName: string;
  sessions: number;
  logins: number;
  foregroundMs: number;
  views: number;
  actions: number;
  errors: number;
  lastSeenAt: string | null;
}

export interface UsageSummary {
  kpis: UsageKpis;
  days: UsageDay[];
  heatmap: UsageHeatCell[];
  screens: UsageScreenStat[];
  actions: UsageActionStat[];
  errors: UsageErrorStat[];
  clients: { browsers: UsageNamedCount[]; os: UsageNamedCount[]; devices: UsageNamedCount[] };
  users: UsageUserStat[];
}

export interface UsageLoginItem {
  id: number;
  at: string;
  userExternalId: string | null;
  userName: string;
  success: boolean;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
}

export interface UsageSessionItem {
  id: string;
  userExternalId: string | null;
  userName: string;
  startedAt: string;
  lastSeenAt: string;
  endedAt: string | null;
  ip: string | null;
  userAgent: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  screenSize: string | null;
  language: string | null;
  timeZone: string | null;
  appVersion: string | null;
  lastScreen: string | null;
  foregroundMs: number;
  backgroundMs: number;
  awayMs: number;
  views: number;
  actions: number;
}

export interface UsageEventItem {
  id: number;
  at: string;
  sessionId: string;
  userExternalId: string | null;
  userName: string;
  kind: UsageEventKind;
  screen: string | null;
  route: string | null;
  card: string | null;
  name: string;
  detail: string | null;
  durationMs: number | null;
  status: number | null;
}

export interface UsagePage<T> {
  items: T[];
  total: number;
}

export interface UsageLastSeen {
  userExternalId: string;
  lastSeenAt: string | null;
  lastScreen: string | null;
  lastIp: string | null;
  lastLoginAt: string | null;
}

export interface UsageUserDetail {
  logins?: UsageLoginItem[] | null;
  sessions?: UsageSessionItem[] | null;
  events?: UsageEventItem[] | null;
  totals?: { sessions: number; logins: number; foregroundMs: number; views: number; actions: number; errors: number } | null;
}

// ---- rótulos e formatação ----

export const PRESENCE_LABEL: Record<PresenceState | 'offline', string> = {
  busy: 'Executando',
  active: 'Ativo',
  background: 'Em segundo plano',
  away: 'Ausente',
  offline: 'Offline',
};

/** Ordem do "mais ativo" quando o usuário tem várias abas. */
export const PRESENCE_RANK: Record<PresenceState, number> = { busy: 4, active: 3, background: 2, away: 1 };

export const EVENT_KIND_LABEL: Record<UsageEventKind, string> = {
  view: 'Tela',
  click: 'Clique',
  action: 'Ação',
  error: 'Erro',
  slow: 'Lenta',
  track: 'Marco',
  login: 'Login',
  logout: 'Logout',
};

export const LOGIN_REASON_LABEL: Record<string, string> = {
  ok: 'Sucesso',
  wrong_password: 'Senha incorreta',
  not_found: 'Usuário não encontrado',
  inactive: 'Usuário desativado',
  unconfirmed: 'E-mail não confirmado',
  error: 'Erro no servidor',
};

/** "1 h 12 min", "8 min", "40 s". */
export function formatDuration(ms: number | null | undefined): string {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours} h ${rest} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} d ${hours % 24} h`;
}

/** "agora", "há 3 min", "há 2 h", "há 4 dias". */
export function formatAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const t = parseApiDate(iso);
  if (!t) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'agora';
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'há 1 dia' : `há ${d} dias`;
}

/**
 * Datas da API: `DateTimeOffset` vem com fuso; `DateTime` (auth, sem fuso) vem sem "Z" e é horário local do servidor —
 * tratado como local do navegador (mesmo comportamento das demais telas).
 */
export function parseApiDate(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

export function formatDateTime(iso: string | null | undefined): string {
  const t = parseApiDate(iso);
  if (t == null) return '—';
  return new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}
