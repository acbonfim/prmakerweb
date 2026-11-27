/**
 * 0100: aba AWS da Bancada — o retrato que a máquina (CLI da AWS, somente leitura) grava no PRMake: por ambiente, as
 * esteiras de deploy do(s) repositório(s) do card e se o nosso código já está lá. Contrato: `AwsDeployController`
 * (`GET AwsDeploy/card/{card}`, `POST .../refresh`, `GET AwsDeploy/config`) — ver features/0100/plan.md.
 */

/** Veredito por ambiente (o pior das pipelines do card naquele ambiente). */
export type AwsVerdict = 'deployed' | 'partial' | 'deploying' | 'waiting' | 'failed' | 'absent' | 'broken' | 'not-applicable' | 'unknown';

export interface AwsEnvironmentConfig {
  key: string;
  label: string;
  host?: string | null;
  tier?: string | null;
  order?: number | null;
}

/** `GET AwsDeploy/config`. */
export interface AwsDeployConfig {
  environments: AwsEnvironmentConfig[];
  refreshFollowMinutes?: number | null;
  refreshFollowMax?: number | null;
}

export interface AwsPipelineLatest {
  status?: string | null;
  sha?: string | null;
  startedAt?: string | null;
}

export interface AwsEnvPipeline {
  name: string;
  repository?: string | null;
  branch?: string | null;
  /** Status da última execução: Succeeded | Failed | InProgress | Stopped | Stopping | Superseded | Cancelled… */
  status?: string | null;
  stage?: string | null;
  lastRunAt?: string | null;
  lastRunEndedAt?: string | null;
  durationSec?: number | null;
  trigger?: string | null;
  /** Commit implantado (último Succeeded da pipeline/ação). */
  deployedSha?: string | null;
  deployedMessage?: string | null;
  deployedAt?: string | null;
  /** Algum commit do card está na branch da pipeline. */
  inBranch?: boolean | null;
  /** O commit implantado contém o nosso código. */
  deployed?: boolean | null;
  verdict?: AwsVerdict | string | null;
  consoleUrl?: string | null;
  buildUrl?: string | null;
  action?: string | null;
  latest?: AwsPipelineLatest | null;
  failedLogTail?: string[] | null;
  /**
   * Esteira principal do ambiente (decide o veredito). `false` = secundária (ex.: rdc/lambdas do mesmo repositório quando
   * existe a esteira que publica no servidor do ambiente) — mostrada depois, esmaecida. Ausente = principal.
   */
  primary?: boolean | null;
  /** Nome curto do app (edv-solvace-centerline-dev → centerline). */
  app?: string | null;
  /** direct = o card mexeu no projeto do app; shared = só no código compartilhado (lib) que entra no build dele. */
  impact?: 'direct' | 'shared' | null;
  /** Esteira quebrada: desde quando falha e se já falhava antes do nosso código (verdict `broken` = não é do card). */
  brokenSince?: string | null;
  brokenBeforeUs?: boolean | null;
  /** Tipo do que a esteira entrega ("Front Angular", "Legado"…) e o que ela faz, em português. */
  kind?: string | null;
  what?: string | null;
}

export interface AwsLogError {
  at?: string | null;
  message: string;
}

export interface AwsLogGroup {
  group: string;
  url?: string | null;
  storedBytes?: number | null;
  lastEventAt?: string | null;
  errors?: AwsLogError[] | null;
}

export interface AwsEnvironment {
  key: string;
  label: string;
  host?: string | null;
  tier?: string | null;
  verdict: AwsVerdict | string;
  /** Título curto: "Nosso código está em QA", "Parcial em SandboxRT: 2 de 24 apps", "Ainda não está em Produção". */
  message?: string | null;
  /** Onde falta e por quê, numa linha (apps sem o código, esteira quebrada antes do card, PR que falta). */
  detail?: string | null;
  summary?: { apps?: number; withCode?: number; broken?: string[]; failed?: string[]; deploying?: string[]; waiting?: string[]; absent?: string[] } | null;
  /** PR do card para a branch deste ambiente. */
  pr?: { number?: number | null; base?: string | null; status?: string | null; url?: string | null } | null;
  pipelines?: AwsEnvPipeline[] | null;
  logs?: AwsLogGroup[] | null;
  resources?: {
    cloudfront?: { id?: string | null; aliases?: string[] | null } | null;
    elasticBeanstalk?: string[] | null;
  } | null;
}

export interface AwsCommit {
  sha: string;
  title?: string | null;
  date?: string | null;
}

export interface AwsRepository {
  repository: string;
  /** revamp-frontend | legacy | revamp-backend | integration-api — e o texto para quem lê. */
  kind?: string | null;
  kindLabel?: string | null;
  localPath?: boolean | string | null;
  fetchedAt?: string | null;
  commits?: AwsCommit[] | null;
  files?: number | null;
  branches?: string[] | null;
}

export interface AwsLambda {
  name: string;
  runtime?: string | null;
  lastModified?: string | null;
}

export interface AwsAlarm {
  name: string;
  state?: string | null;
  since?: string | null;
  reason?: string | null;
}

/** `AwsCardSnapshot` (jsonb gravado pelo script `aws.sh collect <card>`). */
export interface AwsCardSnapshot {
  version?: number;
  card?: number | string;
  requestId?: string | null;
  collectedAt?: string | null;
  collectedBy?: string | null;
  machine?: string | null;
  durationMs?: number | null;
  account?: string | null;
  region?: string | null;
  index?: { total?: number | null; upserted?: number | null; removed?: number | null; updatedAt?: string | null } | null;
  repositories?: AwsRepository[] | null;
  environments?: AwsEnvironment[] | null;
  resources?: { lambdas?: AwsLambda[] | null; alarms?: AwsAlarm[] | null } | null;
  denied?: string[] | null;
  warnings?: string[] | null;
  /** Explicações para quem lê (ex.: monorepo com lib compartilhada). */
  notes?: string[] | null;
}

/** Pedido de coleta (`AwsRefresh`): roda no executor de quem pediu. */
export interface AwsRefresh {
  id: string;
  /** queued | running (ou claimed) | done | failed | expired */
  status: string;
  requestedBy?: string | null;
  requestedAt?: string | null;
  error?: string | null;
  /** button | follow | task — `follow` é o acompanhamento automático do deploy em andamento. */
  source?: string | null;
  /** Acompanhamento: só sai da fila a partir desta hora ("Atualizar" antecipa). */
  notBefore?: string | null;
  finishedAt?: string | null;
}

/** `GET AwsDeploy/card/{card}`. */
export interface AwsCardState {
  snapshot: AwsCardSnapshot | null;
  collectedAt?: string | null;
  collectedBy?: string | null;
  refresh?: AwsRefresh | null;
  executorOnline?: boolean | null;
}

/** Comando manual da coleta (sem executor ligado). */
export function awsCollectCommand(card: string | number): string {
  return `bash ~/.claude/skills/aws-deploy/scripts/aws.sh collect ${card}`;
}

// ── Aparência ────────────────────────────────────────────────────────────────────────────────

export type AwsTone = 'ok' | 'info' | 'warn' | 'bad' | 'muted';

export interface AwsLook {
  icon: string;
  tone: AwsTone;
  /** Ícone girando (deploy/execução em andamento). */
  spin?: boolean;
  label: string;
}

const KNOWN_VERDICTS: ReadonlySet<string> = new Set(['deployed', 'partial', 'deploying', 'waiting', 'failed', 'absent', 'broken', 'not-applicable', 'unknown']);

export function normalizeVerdict(v: string | null | undefined): AwsVerdict {
  const k = `${v ?? ''}`.trim().toLowerCase();
  return (KNOWN_VERDICTS.has(k) ? k : 'unknown') as AwsVerdict;
}

/** Cor/ícone/rótulo curto de cada veredito. */
export function verdictLook(v: string | null | undefined): AwsLook {
  switch (normalizeVerdict(v)) {
    case 'deployed': return { icon: 'check_circle', tone: 'ok', label: 'Implantado' };
    // Card 79047: versão anterior implantada; o ajuste mais recente ainda não chegou.
    case 'partial': return { icon: 'timelapse', tone: 'warn', label: 'Parte implantada' };
    case 'deploying': return { icon: 'sync', tone: 'info', spin: true, label: 'Deploy em andamento' };
    case 'waiting': return { icon: 'hourglass_top', tone: 'warn', label: 'Aguardando deploy' };
    case 'failed': return { icon: 'error', tone: 'bad', label: 'Deploy falhou' };
    case 'absent': return { icon: 'remove_circle_outline', tone: 'muted', label: 'Ainda não está' };
    case 'broken': return { icon: 'construction', tone: 'muted', label: 'Esteira quebrada antes do card' };
    case 'not-applicable': return { icon: 'do_not_disturb_on', tone: 'muted', label: 'Não se aplica' };
    default: return { icon: 'help_outline', tone: 'warn', label: 'Sem resposta' };
  }
}

/** Frase do veredito quando o retrato não trouxe `message` (mesmos textos do script). */
export function verdictMessage(v: string | null | undefined, label: string): string {
  const env = label?.trim() || 'este ambiente';
  switch (normalizeVerdict(v)) {
    case 'deployed': return `Nosso código está em ${env}`;
    case 'partial': return `Parte do nosso código está em ${env} (o ajuste mais recente ainda não)`;
    case 'deploying': return `Deploy em andamento em ${env}`;
    case 'waiting': return `Na branch de ${env}, aguardando o deploy`;
    case 'failed': return `Deploy falhou em ${env}`;
    case 'absent': return `Ainda não está em ${env}`;
    case 'broken': return `Ainda não está em ${env} (esteira quebrada antes do nosso código)`;
    case 'not-applicable': return `Não se aplica — este repositório não vai para ${env}`;
    default: return `Não deu para saber se o nosso código está em ${env}`;
  }
}

export function environmentMessage(env: Pick<AwsEnvironment, 'verdict' | 'message' | 'label' | 'key'>): string {
  return env.message?.trim() || verdictMessage(env.verdict, env.label || env.key);
}

/** Chip do status da execução da pipeline (CodePipeline). */
export function pipelineStatusLook(status: string | null | undefined): AwsLook {
  const s = `${status ?? ''}`.trim();
  switch (s.toLowerCase()) {
    case 'succeeded': return { icon: 'check', tone: 'ok', label: 'Sucesso' };
    case 'failed': return { icon: 'close', tone: 'bad', label: 'Falhou' };
    case 'inprogress': return { icon: 'sync', tone: 'info', spin: true, label: 'Rodando' };
    case 'stopping': return { icon: 'pause', tone: 'warn', label: 'Parando' };
    case 'stopped': return { icon: 'stop', tone: 'muted', label: 'Parada' };
    case 'superseded': return { icon: 'fast_forward', tone: 'muted', label: 'Substituída' };
    case 'cancelled': return { icon: 'block', tone: 'muted', label: 'Cancelada' };
    case '': return { icon: 'remove', tone: 'muted', label: 'Nunca rodou' };
    default: return { icon: 'help_outline', tone: 'muted', label: s };
  }
}

/** Ambiente com algo pedindo atenção (ponto na aba): deploy falhou ou em andamento. */
export function snapshotAlert(snapshot: AwsCardSnapshot | null | undefined): 'failed' | 'deploying' | null {
  const verdicts = (snapshot?.environments ?? []).map((e) => normalizeVerdict(e.verdict));
  if (verdicts.includes('failed')) return 'failed';
  if (verdicts.includes('deploying')) return 'deploying';
  return null;
}

/**
 * Ambientes na ordem da configuração (os do retrato que a config não conhece vão no fim, na ordem do retrato). Sem
 * config, a ordem do retrato.
 */
export function orderEnvironments(envs: readonly AwsEnvironment[], config: readonly AwsEnvironmentConfig[] | null | undefined): AwsEnvironment[] {
  if (!config?.length) return [...envs];
  const rank = new Map<string, number>();
  [...config]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .forEach((c, i) => rank.set(c.key.toLowerCase(), i));
  return envs
    .map((e, i) => ({ e, i, r: rank.get(`${e.key}`.toLowerCase()) ?? config.length + i }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.e);
}

// ── Formatação ───────────────────────────────────────────────────────────────────────────────

export function shortSha(sha: string | null | undefined): string {
  return (sha ?? '').trim().slice(0, 7);
}

export function firstLine(text: string | null | undefined): string {
  return `${text ?? ''}`.split(/\r?\n/).map((l) => l.trim()).find((l) => !!l) ?? '';
}

/** 354 → "5 min 54 s"; 42 → "42 s"; 3720 → "1 h 2 min". */
export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '';
  const s = Math.round(sec);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

function toDate(at: string | null | undefined): Date | null {
  if (!at) return null;
  const t = Date.parse(at);
  return Number.isFinite(t) ? new Date(t) : null;
}

const pad = (n: number) => `${n}`.padStart(2, '0');

/** "24/11 16:30" (no horário local). */
export function formatShortDate(at: string | null | undefined): string {
  const d = toDate(at);
  return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
}

/** "24/11/2026 16:30:05" (tooltip). */
export function formatFullDate(at: string | null | undefined): string {
  const d = toDate(at);
  return d ? d.toLocaleString('pt-BR') : '';
}

/** "agora", "há 5 min", "há 3 h", "há 2 dias". */
export function relativeAgo(at: string | null | undefined, now: number = Date.now()): string {
  const d = toDate(at);
  if (!d) return '';
  const min = Math.floor((now - d.getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const days = Math.floor(h / 24);
  return `há ${days} ${days === 1 ? 'dia' : 'dias'}`;
}

/**
 * Texto do pedido de coleta em andamento (ou null quando não há nada a mostrar). Pedido na fila com hora marcada
 * (acompanhamento do deploy, `notBefore` no futuro) não está esperando o executor: é a próxima conferência agendada
 * (`scheduled`, sem `busy` — "Atualizar" antecipa).
 */
export function refreshStatusText(refresh: AwsRefresh | null | undefined, now: number = Date.now()):
  { text: string; busy: boolean; tone: AwsTone; scheduled?: boolean } | null {
  if (!refresh) return null;
  switch (`${refresh.status ?? ''}`.toLowerCase()) {
    case 'queued': {
      const at = toDate(refresh.notBefore);
      if (at && at.getTime() > now) {
        const when = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
        const text = `${refresh.source === 'follow' ? 'Acompanhando o deploy' : 'Coleta agendada'} — próxima conferência às ${when}`;
        return { text, busy: false, tone: 'info', scheduled: true };
      }
      return { text: 'Pedido na fila — aguardando o seu executor', busy: true, tone: 'info' };
    }
    case 'claimed':
    case 'running': return { text: 'Coletando na sua máquina…', busy: true, tone: 'info' };
    case 'failed': return { text: `A coleta falhou${refresh.error ? ': ' + refresh.error : ''}`, busy: false, tone: 'bad' };
    case 'expired': return { text: 'O pedido expirou sem o executor pegar — confira se ele está ligado', busy: false, tone: 'warn' };
    default: return null;
  }
}

/** Esteira secundária (não decide o veredito do ambiente). */
export function isSecondary(p: Pick<AwsEnvPipeline, 'primary'>): boolean {
  return p.primary === false;
}

export interface PipelineGroups {
  /** Mostradas direto: todas (lista curta) ou as que ainda não têm o nosso código implantado (lista longa). */
  shown: AwsEnvPipeline[];
  /** Lista longa: as que já têm o nosso código, recolhidas. */
  folded: AwsEnvPipeline[];
  deployed: number;
  total: number;
  /** Principais (decidem o veredito): quantas e quantas já com o nosso código implantado. */
  primaryTotal: number;
  primaryDeployed: number;
  /** Secundárias (não decidem o veredito). */
  secondary: number;
}

/** Até quantas esteiras a lista do ambiente aparece inteira. */
export const PIPES_INLINE_MAX = 6;

/**
 * Ordem das esteiras do ambiente: principais antes das secundárias e, em cada grupo, as que ainda não têm o nosso código
 * implantado primeiro (ordem estável). Lista longa (> `max`, ex.: lib compartilhada do edv-solvace-apps com 25 esteiras):
 * as já implantadas ficam recolhidas.
 */
export function groupPipelines(pipes: readonly AwsEnvPipeline[], max = PIPES_INLINE_MAX): PipelineGroups {
  const rank = (p: AwsEnvPipeline) => (isSecondary(p) ? 2 : 0) + (p.deployed === true ? 1 : 0);
  const sorted = pipes.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map((x) => x.p);
  const isDone = (p: AwsEnvPipeline) => p.deployed === true;
  const primaries = pipes.filter((p) => !isSecondary(p));
  const counts = {
    deployed: pipes.filter(isDone).length,
    total: pipes.length,
    primaryTotal: primaries.length,
    primaryDeployed: primaries.filter(isDone).length,
    secondary: pipes.length - primaries.length
  };
  if (pipes.length <= max) return { shown: sorted, folded: [], ...counts };
  const shown = sorted.filter((p) => !isDone(p));
  const folded = sorted.filter(isDone);
  // Nada a destacar (todas implantadas): mostra as primeiras e recolhe o resto.
  if (!shown.length) return { shown: folded.slice(0, max), folded: folded.slice(max), ...counts };
  return { shown, folded, ...counts };
}

// ── Tabela por ambiente (0100, card 78560: "não consigo saber se o meu código está lá") ─────────

/** Veredito do ambiente para a linha da tabela: parcial (parte dos apps com o código) vira âmbar, não vermelho. */
export function environmentLook(env: AwsEnvironment): AwsLook & { verdict: AwsVerdict; message: string; partial: boolean } {
  const verdict = normalizeVerdict(env.verdict);
  const sm = env.summary;
  const partial = verdict !== 'deployed' && !!sm?.withCode && (sm.apps ?? 0) > sm.withCode;
  const base = verdictLook(verdict);
  const look = partial && verdict !== 'deploying' ? { ...base, icon: 'timelapse', tone: 'warn' as AwsTone } : base;
  return { ...look, verdict, partial, message: environmentMessage(env) };
}

/** Coluna "Nosso código" de uma esteira — responde se o código do card está no que foi implantado. */
export function codeLook(p: AwsEnvPipeline): AwsLook & { hint: string } {
  if (p.deployed) return { icon: 'check_circle', tone: 'ok', label: 'Implantado', hint: 'O commit implantado contém o nosso código' };
  switch (normalizeVerdict(p.verdict)) {
    case 'broken': return { icon: 'construction', tone: 'muted', label: 'Esteira quebrada', hint: `Esta esteira já falhava antes do nosso código chegar${p.brokenSince ? ' (desde ' + formatShortDate(p.brokenSince) + ')' : ''} — não é do card; o nosso código não chegou a este app porque nenhum build passou` };
    case 'deploying': return { icon: 'sync', tone: 'info', spin: true, label: 'Deploy em andamento', hint: 'A execução que está rodando já leva o nosso código' };
    case 'failed': return { icon: 'error', tone: 'bad', label: 'Deploy falhou', hint: 'A execução com o nosso código falhou (e a esteira passava antes dela) — veja o log do build' };
    case 'waiting': return { icon: 'hourglass_top', tone: 'warn', label: 'Na branch, falta deploy', hint: `O nosso código já está na branch ${p.branch ?? ''}, mas esta esteira ainda não rodou com ele` };
    default: return { icon: 'remove_circle_outline', tone: 'muted', label: 'Não está', hint: `O nosso código ainda não chegou na branch ${p.branch ?? ''}` };
  }
}

const CODE_ORDER = ['failed', 'deploying', 'waiting', 'absent', 'broken', 'deployed'];

/** Esteiras do ambiente para a tabela: principais antes; em cada grupo, o que pede atenção primeiro. */
export function sortPipelines(pipes: readonly AwsEnvPipeline[]): AwsEnvPipeline[] {
  const rank = (p: AwsEnvPipeline) => {
    const v = p.deployed ? 'deployed' : normalizeVerdict(p.verdict);
    const i = CODE_ORDER.indexOf(v);
    return (isSecondary(p) ? 10 : 0) + (i < 0 ? 3 : i);
  };
  return pipes.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map((x) => x.p);
}

/** Último deploy do ambiente (o mais recente entre as esteiras principais). */
export function lastDeployAt(env: AwsEnvironment): string | null {
  const pipes = (env.pipelines ?? []).filter((p) => !isSecondary(p));
  return pipes.map((p) => p.deployedAt ?? null).filter((d): d is string => !!d).sort().pop() ?? null;
}

/** Nome do app (ou da esteira, quando não há app). */
export function appName(p: AwsEnvPipeline): string {
  return p.app?.trim() || p.name;
}
