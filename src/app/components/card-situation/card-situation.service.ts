import { Injectable, Signal, WritableSignal, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { WsService } from '../../services/ws.service';
import { EXECUTION_PLAN_EVENT, executionPlanGroup } from '../execution-plan/execution-plan.model';

/** Tipos de "Situação atual" do card (0075/B4) — o que está sendo aguardado. */
export type CardSituationKind = 'none' | 'ticket' | 'ticket-open' | 'pr-review' | 'qa-validation' | 'answer' | 'user';

export interface CardSituationPullRequest {
  repository: string | null;
  number: number | null;
  url: string;
  title: string | null;
  targetBranch: string | null;
  status: 'open' | 'merged' | string | null;
  isQa: boolean;
  checks: 'pending' | 'success' | 'failure' | string | null;
  approvals: number | null;
  changesRequested: number | null;
  /** Revisores que ainda não revisaram (texto, ex.: "ana, bruno"). */
  reviewersPending: string | null;
  openedAt: string;
  mergedAt: string | null;
}

export interface CardSituationTicket {
  url: string;
  title: string | null;
  status: string | null;
  stepTitle: string | null;
  openedAt: string;
  openedBy: string;
  files: string[];
}

/** `GET ExecutionPlan/card/{card}/situation` (0075/B4). */
export interface CardSituation {
  cardNumber: string;
  kind: CardSituationKind | string;
  title: string;
  icon: string;
  since: string | null;
  alsoWaiting: string[];
  planId: string | null;
  phase: 'analysis' | 'correction' | string | null;
  planTitle: string | null;
  planStatus: string | null;
  stepKey: string | null;
  stepTitle: string | null;
  done: string[];
  pullRequests: CardSituationPullRequest[];
  tickets: CardSituationTicket[];
  questions: string[];
  userSteps: string[];
  devTestInQaAt: string | null;
  devTestInQaError: string | null;
  /** Roteiro de validação em QA (markdown). */
  qaChecklist: string | null;
  devOpsState: string | null;
  devOpsColumn: string | null;
  /** Contexto da passagem (markdown; pode citar `[x](ref:id)`). */
  handoff: string | null;
  handoffAt: string | null;
  handoffBy: string | null;
  /** Próximo passo (markdown curto). */
  next: string | null;
  /** Resumo completo pronto para copiar (markdown). */
  markdown: string;
  /** 0076: publicação automática efetiva para este card (preferência do dono do plano ou a padrão). */
  autoPost: boolean;
  /** 0076: último resumo publicado na discussion do DevOps (quando, por quem e o texto). */
  publishedAt?: string | null;
  publishedBy?: string | null;
  publishedMarkdown?: string | null;
  /** 0076: há um resumo diferente do publicado, pronto para publicar. */
  publishPending: boolean;
  /** 0078: de onde vem o `autoPost` deste card — escolhido neste card, preferência do dono do plano ou o padrão. */
  autoPostSource?: 'card' | 'user' | 'global' | string;
}

/** 0078: modo de publicação deste card (o seletor "Neste card"). */
export type CardPostMode = 'auto' | 'manual' | 'follow';

/** Modo do card a partir da situação: só é "automático/manual" quando foi escolhido neste card. */
export function cardPostMode(s: Pick<CardSituation, 'autoPost' | 'autoPostSource'> | null | undefined): CardPostMode {
  if (!s || s.autoPostSource !== 'card') return 'follow';
  return s.autoPost ? 'auto' : 'manual';
}

/** `GET/PUT ExecutionPlan/settings/situation-post` (0076): publicar a situação sozinho na discussion. */
export interface SituationPostSettings {
  /** Preferência do usuário logado; null = segue o padrão. */
  autoPost: boolean | null;
  globalDefault: boolean;
  effective: boolean;
}

/** Ícone (`mat-icon` — 0076: o `icon` com emoji que vem do back é ignorado) e rótulo curto de cada
 *  tipo (cartão, chip da Home, fato do topo do card). */
export const SITUATION_META: Record<string, { icon: string; short: string; tone: 'info' | 'pending' | 'ok' }> = {
  ticket: { icon: 'confirmation_number', short: 'chamado', tone: 'info' },
  'ticket-open': { icon: 'confirmation_number', short: 'abrir chamado', tone: 'pending' },
  'pr-review': { icon: 'call_merge', short: 'aprovação/merge', tone: 'info' },
  'qa-validation': { icon: 'science', short: 'validar em QA', tone: 'pending' },
  answer: { icon: 'help_outline', short: 'resposta', tone: 'pending' },
  user: { icon: 'person', short: 'com você', tone: 'pending' },
};

/** Título de cada tipo (o mesmo do back, `CardSituationKind.Title`). */
export const SITUATION_TITLES: Record<string, string> = {
  ticket: 'Aguardando chamado',
  'ticket-open': 'Aguardando abrir chamado',
  'pr-review': 'Aguardando aprovação e merge',
  'qa-validation': 'Validar em QA',
  answer: 'Aguardando resposta',
  user: 'Aguardando você',
};

export function situationMeta(kind: string | null | undefined): { icon: string; short: string; tone: 'info' | 'pending' | 'ok' } | null {
  return kind && kind !== 'none' ? SITUATION_META[kind] ?? null : null;
}

/** Chip da situação (Home): ícone (`mat-icon`) + "chamado · há 3 d", tom e tooltip; null quando nada é aguardado. */
export function situationChip(kind: string | null | undefined, at: string | null | undefined, now = Date.now()):
  { icon: string; label: string; tone: 'info' | 'pending' | 'ok'; tooltip: string } | null {
  const meta = situationMeta(kind);
  if (!meta) return null;
  const ago = situationAgo(at, now);
  const date = situationDate(at);
  return {
    icon: meta.icon,
    label: `${meta.short}${ago ? ' · ' + ago : ''}`,
    tone: meta.tone,
    tooltip: `Situação atual: ${SITUATION_TITLES[kind!] ?? meta.short}${date ? ' desde ' + date : ''}`,
  };
}

/** Eventos do plano que podem mudar a situação (a própria `situation` e o que a compõe). */
const SITUATION_ACTIONS = new Set(['situation', 'step', 'steps', 'link', 'question', 'status', 'created']);
/** Evento do card quando os PRs mudam (PullRequestRealTimeEvents). */
const PULLREQUEST_CARD_EVENT = 'pullRequestCardUpdated';

/** "agora", "há 5 min", "há 3 h", "há 2 d" (curto, para o cartão/chips). */
export function situationAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}

/** "04/11 às 11:58" (data curta + hora — 0076: quando foi publicado). */
export function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${date} às ${time}`;
}

/** Data/hora completa (title dos "há X"). */
export function situationDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
}

/**
 * "Situação atual" do card (0075/F4) — fonte única do cartão no plano e do fato no topo do card.
 *
 * - **Cache por card** em signal: `situationOf(card)` só lê; `load(card)` busca (uma vez; `force` refaz).
 *   A 1ª carga do cartão vai com `devops=true` (estado/coluna do DevOps, mais lenta); as do tempo real
 *   com `devops=false`, mantendo o estado/coluna do DevOps que já veio.
 * - **Tempo real**: com o card em `watch`, o evento `executionPlanUpdated` do grupo do card com
 *   `action` `situation` (ou o que compõe a situação: etapa, link, pergunta, status) recarrega com
 *   debounce de ~1 s (rajadas da skill viram uma requisição só).
 */
@Injectable({ providedIn: 'root' })
export class CardSituationService {
  private http = inject(HttpClient);
  private ws = inject(WsService);
  private apiUrl = `${environment.apiUrl}ExecutionPlan`;

  /** Espera do tempo real antes de recarregar (ms). */
  debounceMs = 1000;

  private state = new Map<string, WritableSignal<CardSituation | null>>();
  private inflight = new Map<string, Promise<CardSituation | null>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private watchers = new Map<string, number>();
  private listening = false;

  /** Situação em cache do card (null = ainda não carregou). Não dispara a carga. */
  situationOf(card: string | number | null | undefined): Signal<CardSituation | null> {
    return this.stateOf(norm(card)).asReadonly();
  }

  /** Busca a situação (em cache; `force` busca de novo). Erro propaga (o cartão mostra o aviso). */
  load(card: string | number | null | undefined, opts: { devops?: boolean; force?: boolean } = {}): Promise<CardSituation | null> {
    const key = norm(card);
    if (!key) return Promise.resolve(null);
    const cached = this.stateOf(key)();
    if (cached && !opts.force) return Promise.resolve(cached);
    const running = this.inflight.get(key);
    if (running && !opts.force) return running;

    const devops = opts.devops ?? false;
    const p = firstValueFrom(this.http.get<CardSituation>(
      `${this.apiUrl}/card/${encodeURIComponent(key)}/situation`, { params: { devops: `${devops}` } }))
      .then(res => {
        const next = normalize(res, key);
        const prev = this.stateOf(key)();
        // Sem consultar o DevOps, o estado/coluna não vêm: mantém o que a carga completa trouxe.
        if (!devops && prev) {
          next.devOpsState ??= prev.devOpsState;
          next.devOpsColumn ??= prev.devOpsColumn;
        }
        if (this.inflight.get(key) === p) this.stateOf(key).set(next);
        return next;
      })
      .finally(() => { if (this.inflight.get(key) === p) this.inflight.delete(key); });
    this.inflight.set(key, p);
    return p;
  }

  /** Publica (ou atualiza) o resumo na discussion do card no DevOps — 0076: o servidor monta o HTML. */
  publish(card: string | number, markdown?: string | null): Promise<{ commentId: number | string | null }> {
    // 0078: com `markdown`, publica o texto editado pela pessoa (o servidor converte e atualiza o mesmo comentário).
    return firstValueFrom(this.http.post<{ commentId: number | string | null }>(
      `${this.apiUrl}/card/${encodeURIComponent(norm(card))}/situation/publish`, markdown ? { markdown } : {}));
  }

  /** 0078: publicação automática só deste card (`null` = volta a seguir a preferência do dono / o padrão). */
  async setCardAutoPost(card: string | number, autoPost: boolean | null): Promise<CardSituation> {
    const key = norm(card);
    const res = await firstValueFrom(this.http.put<CardSituation>(
      `${this.apiUrl}/card/${encodeURIComponent(key)}/situation/auto-post`, { autoPost }));
    const next = normalize(res, key);
    const prev = this.stateOf(key)();
    next.devOpsState ??= prev?.devOpsState ?? null;
    next.devOpsColumn ??= prev?.devOpsColumn ?? null;
    this.stateOf(key).set(next);
    return next;
  }

  // ── Preferência de publicação automática (0076) ───────────────────────────────────────────────

  private readonly postSettingsState = signal<SituationPostSettings | null>(null);
  private postSettingsLoad: Promise<SituationPostSettings> | null = null;

  /** Preferência do usuário logado (null = ainda não carregou). */
  readonly postSettings = this.postSettingsState.asReadonly();

  loadPostSettings(force = false): Promise<SituationPostSettings> {
    if (!force && this.postSettingsLoad) return this.postSettingsLoad;
    const p = firstValueFrom(this.http.get<SituationPostSettings>(`${this.apiUrl}/settings/situation-post`))
      .then(res => { const v = normalizeSettings(res); this.postSettingsState.set(v); return v; })
      .catch(err => { if (this.postSettingsLoad === p) this.postSettingsLoad = null; throw err; });
    this.postSettingsLoad = p;
    return p;
  }

  /** Grava a preferência (`null` = volta a seguir o padrão). */
  async savePostSettings(autoPost: boolean | null): Promise<SituationPostSettings> {
    const res = await firstValueFrom(this.http.put<SituationPostSettings>(`${this.apiUrl}/settings/situation-post`, { autoPost }));
    const v = normalizeSettings(res);
    this.postSettingsState.set(v);
    this.postSettingsLoad = Promise.resolve(v);
    return v;
  }

  // ── Tempo real ────────────────────────────────────────────────────────────────────────────────

  watch(card: string | number | null | undefined): void {
    const key = norm(card);
    if (!key) return;
    this.listen();
    const count = this.watchers.get(key) ?? 0;
    this.watchers.set(key, count + 1);
    if (count === 0) this.ws.addToGroup(executionPlanGroup(key));
  }

  unwatch(card: string | number | null | undefined): void {
    const key = norm(card);
    const count = this.watchers.get(key) ?? 0;
    if (!key || count === 0) return;
    if (count > 1) { this.watchers.set(key, count - 1); return; }
    this.watchers.delete(key);
    this.ws.removeFromGroup(executionPlanGroup(key));
    const t = this.timers.get(key);
    if (t) { clearTimeout(t); this.timers.delete(key); }
  }

  /** Agenda a recarga do card (debounce); só para cards em `watch`. */
  schedule(card: string | number | null | undefined): void {
    const key = norm(card);
    if (!key || !this.watchers.has(key)) return;
    const prev = this.timers.get(key);
    if (prev) clearTimeout(prev);
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      if (!this.watchers.has(key)) return;
      this.load(key, { devops: false, force: true }).catch(() => undefined);
    }, this.debounceMs));
  }

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    this.ws.startConnection();
    this.ws.on(EXECUTION_PLAN_EVENT, (payload: { action?: string; cardNumber?: string } | null) => {
      if (payload?.action && SITUATION_ACTIONS.has(payload.action)) this.schedule(payload.cardNumber);
    });
    // PR do card mudou (mesclado, CI, revisão) — a tela do card já está no grupo do card.
    this.ws.on(PULLREQUEST_CARD_EVENT, (payload: { action?: string; cardNumber?: string } | null) => {
      if (`${payload?.action ?? ''}`.startsWith('github-pr')) this.schedule(payload?.cardNumber);
    });
    // Voltou a conexão: o que mudou no meio do caminho não chegou.
    this.ws._resynced.subscribe(() => { for (const card of this.watchers.keys()) this.schedule(card); });
  }

  private stateOf(key: string): WritableSignal<CardSituation | null> {
    let s = this.state.get(key);
    if (!s) { s = signal<CardSituation | null>(null); this.state.set(key, s); }
    return s;
  }
}

function norm(card: string | number | null | undefined): string {
  return card === null || card === undefined ? '' : `${card}`.trim();
}

/** Listas sempre presentes (o JSON pode omitir) e `kind` padrão. */
function normalize(res: CardSituation | null, card: string): CardSituation {
  const r = (res ?? {}) as Partial<CardSituation>;
  return {
    ...(r as CardSituation),
    cardNumber: r.cardNumber || card,
    kind: r.kind || 'none',
    title: r.title ?? '',
    icon: r.icon ?? '',
    since: r.since ?? null,
    alsoWaiting: r.alsoWaiting ?? [],
    done: r.done ?? [],
    pullRequests: r.pullRequests ?? [],
    tickets: (r.tickets ?? []).map(t => ({ ...t, files: t.files ?? [] })),
    questions: r.questions ?? [],
    userSteps: r.userSteps ?? [],
    devOpsState: r.devOpsState ?? null,
    devOpsColumn: r.devOpsColumn ?? null,
    markdown: r.markdown ?? '',
    autoPost: !!r.autoPost,
    publishedAt: r.publishedAt ?? null,
    publishedBy: r.publishedBy ?? null,
    publishedMarkdown: r.publishedMarkdown ?? null,
    publishPending: !!r.publishPending,
    autoPostSource: r.autoPostSource ?? 'global',
  };
}

function normalizeSettings(res: Partial<SituationPostSettings> | null): SituationPostSettings {
  const r = res ?? {};
  const globalDefault = !!r.globalDefault;
  const autoPost = r.autoPost === true || r.autoPost === false ? r.autoPost : null;
  return { autoPost, globalDefault, effective: r.effective ?? (autoPost ?? globalDefault) };
}
