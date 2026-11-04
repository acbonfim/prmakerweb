import { HttpClient } from '@angular/common/http';
import { Injectable, Signal, WritableSignal, computed, inject, signal } from '@angular/core';
import { Subject, firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { EXECUTION_PLAN_EVENT, executionPlanGroup } from '../components/execution-plan/execution-plan.model';
import { DevOpsActionResult, DevOpsActionsService, apiErrorMessage } from './devops-actions.service';
import { WsService } from './ws.service';

/** Tipos de sugestão do assistente (0077). */
export type CardSuggestionKind = 'initial-estimate' | 'log-hours' | 'situation-auto-post' | string;
export type CardSuggestionStatus = 'open' | 'done' | 'dismissed' | 'failed' | string;

export interface CardSuggestionAction {
  key: string;
  label: string;
  primary: boolean;
}

/** `GET ExecutionPlan/card/{card}/suggestions` (0077) — o PRMake "conversa" com quem trata o card. */
export interface CardSuggestion {
  id: string;
  planId: string;
  kind: CardSuggestionKind;
  title: string;
  /** Markdown curto (pode ter *itálico*). */
  text: string | null;
  actions: CardSuggestionAction[];
  status: CardSuggestionStatus;
  chosenAction: string | null;
  /** Mensagem do resultado (DevOps) — no `failed`, o erro. */
  result: string | null;
  resolvedBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** `GET Azure/card/{id}/effort` (0077). */
export interface CardEffort {
  originalEstimate: number | null;
  completedWork: number | null;
  remainingWork: number | null;
}

export interface CardEffortState {
  status: 'loading' | 'ready' | 'error';
  effort: CardEffort | null;
  error: string | null;
  /** HTTP do erro (0 = sem resposta). */
  httpStatus?: number;
}

/** Sugestão nova chegando pelo tempo real (aviso discreto na tela do card). */
export interface NewSuggestionEvent {
  card: string;
  suggestion: CardSuggestion;
}

/** Sugestões cujo resultado muda as horas do card (recarrega a linha de horas). */
const EFFORT_KINDS = new Set(['initial-estimate', 'log-hours']);
const SUGGESTION_ACTION = 'suggestion';

/**
 * Assistente do card (0077): sugestões que **não travam** nada (estimativa inicial, publicar os resumos de
 * espera, lançar horas), as horas do card no DevOps e a média do time. Cache por card em signals; o tempo
 * real (`executionPlanUpdated` com `action: 'suggestion'`) recarrega com debounce e avisa das sugestões
 * novas (`fresh$`) — a tela mostra um aviso discreto, nunca um modal.
 */
@Injectable({ providedIn: 'root' })
export class CardAssistantService {
  private http = inject(HttpClient);
  private ws = inject(WsService);
  private devops = inject(DevOpsActionsService);
  private base = environment.apiUrl;

  /** Espera do tempo real antes de recarregar (ms). */
  debounceMs = 400;

  private suggestions = new Map<string, WritableSignal<CardSuggestion[] | null>>();
  private efforts = new Map<string, WritableSignal<CardEffortState | null>>();
  private inflight = new Map<string, Promise<CardSuggestion[]>>();
  private watchers = new Map<string, number>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private listening = false;

  /** Sugestão nova (aberta) que chegou pelo tempo real. */
  readonly fresh$ = new Subject<NewSuggestionEvent>();

  // ── Sugestões ─────────────────────────────────────────────────────────────────────────────────

  suggestionsOf(card: string | number | null | undefined): Signal<CardSuggestion[] | null> {
    return this.listOf(norm(card)).asReadonly();
  }

  /** Quantas sugestões abertas (ou que falharam e podem ser tentadas de novo) o card tem. */
  openCountOf(card: string | number | null | undefined): Signal<number> {
    const list = this.listOf(norm(card));
    return computed(() => (list() ?? []).filter(isPending).length);
  }

  loadSuggestions(card: string | number | null | undefined): Promise<CardSuggestion[]> {
    const key = norm(card);
    if (!key) return Promise.resolve([]);
    const running = this.inflight.get(key);
    if (running) return running;
    const p = firstValueFrom(this.http.get<CardSuggestion[]>(`${this.base}ExecutionPlan/card/${encodeURIComponent(key)}/suggestions`))
      .then(res => {
        const list = (res ?? []).map(normalize);
        this.listOf(key).set(list);
        return list;
      })
      .finally(() => { if (this.inflight.get(key) === p) this.inflight.delete(key); });
    this.inflight.set(key, p);
    return p;
  }

  /** Responde a sugestão (de novo, se falhou). A sugestão volta atualizada (done/failed + resultado). */
  async act(card: string, s: CardSuggestion, action: string): Promise<CardSuggestion> {
    const res = normalize(await firstValueFrom(this.http.post<CardSuggestion>(
      `${this.base}ExecutionPlan/suggestions/${encodeURIComponent(s.id)}/act`, { action })));
    this.replace(card, res);
    if (EFFORT_KINDS.has(res.kind) && action !== 'skip') this.loadEffort(card).catch(() => undefined);
    return res;
  }

  async dismiss(card: string, s: CardSuggestion): Promise<CardSuggestion> {
    const res = normalize(await firstValueFrom(this.http.post<CardSuggestion>(
      `${this.base}ExecutionPlan/suggestions/${encodeURIComponent(s.id)}/dismiss`, {})));
    this.replace(card, res);
    return res;
  }

  // ── Horas no DevOps ───────────────────────────────────────────────────────────────────────────

  effortOf(card: string | number | null | undefined): Signal<CardEffortState | null> {
    return this.effortSignal(norm(card)).asReadonly();
  }

  /** Busca as horas (Original · Completed · Remaining). Erro fica no estado (a tela mostra "indisponível"). */
  async loadEffort(card: string | number | null | undefined): Promise<CardEffortState | null> {
    const key = norm(card);
    if (!key) return null;
    const state = this.effortSignal(key);
    const prev = state();
    state.set({ status: 'loading', effort: prev?.effort ?? null, error: null });
    try {
      const res = await firstValueFrom(this.http.get<CardEffort>(`${this.base}Azure/card/${encodeURIComponent(key)}/effort`));
      const next: CardEffortState = { status: 'ready', effort: normalizeEffort(res), error: null };
      state.set(next);
      return next;
    } catch (err: any) {
      const next: CardEffortState = {
        status: 'error', effort: null, httpStatus: err?.status ?? 0,
        error: serverMessage(err, 'O DevOps não respondeu.'),
      };
      state.set(next);
      return next;
    }
  }

  /** Lança horas: soma em Completed e tira do Remaining (sem negativo). Recarrega as horas. */
  async logHours(card: string, hours: number): Promise<DevOpsActionResult> {
    try {
      return await firstValueFrom(this.http.post<DevOpsActionResult>(
        `${this.base}Azure/card/${encodeURIComponent(card)}/actions/log-hours`, { hours }));
    } finally {
      this.loadEffort(card).catch(() => undefined);
    }
  }

  /** Registra a estimativa inicial configurada (AI Configurations). Recarrega as horas. */
  async initialEstimate(card: string): Promise<DevOpsActionResult> {
    try {
      return await this.devops.run(card, 'initial-estimate');
    } finally {
      this.loadEffort(card).catch(() => undefined);
    }
  }

  // ── Média do time (Skills Configurations → AssistantAverageHours) ─────────────────────────────

  private readonly settingsState = signal<{ averageHours: number | null; hoursPerStep: number | null } | null>(null);
  private settingsLoad: Promise<void> | null = null;
  /** Média de horas por card do time (null = não configurada/indisponível). */
  readonly averageHours = computed(() => this.settingsState()?.averageHours ?? null);
  /** Horas sugeridas por etapa (padrão 1). */
  readonly hoursPerStep = computed(() => this.settingsState()?.hoursPerStep ?? 1);

  loadSettings(): Promise<void> {
    this.settingsLoad ??= firstValueFrom(this.http.get<any>(`${this.base}Skills/config`))
      .then(res => {
        const s = res?.settings ?? {};
        this.settingsState.set({ averageHours: hoursValue(s.AssistantAverageHours), hoursPerStep: hoursValue(s.AssistantHoursPerStep) });
      })
      .catch(() => { this.settingsState.set({ averageHours: null, hoursPerStep: null }); });
    return this.settingsLoad;
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
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
  }

  /** Evento de sugestão do card em `watch`: recarrega (debounce) e avisa das novas. */
  schedule(card: string | number | null | undefined): void {
    const key = norm(card);
    if (!key || !this.watchers.has(key)) return;
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      if (!this.watchers.has(key)) return;
      const before = this.listOf(key)();
      const known = new Set((before ?? []).map(s => `${s.id}:${s.status}`));
      const knownIds = new Set((before ?? []).map(s => s.id));
      this.loadSuggestions(key).then(list => {
        for (const s of list) {
          if (before && !knownIds.has(s.id) && s.status === 'open') this.fresh$.next({ card: key, suggestion: s });
          // Outra pessoa (ou aba) lançou horas/estimativa: a linha de horas acompanha.
          if (before && !known.has(`${s.id}:${s.status}`) && s.status === 'done' && EFFORT_KINDS.has(s.kind) && s.chosenAction !== 'skip') {
            this.loadEffort(key).catch(() => undefined);
          }
        }
      }).catch(() => undefined);
    }, this.debounceMs));
  }

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    this.ws.startConnection();
    this.ws.on(EXECUTION_PLAN_EVENT, (payload: { action?: string; cardNumber?: string } | null) => {
      if (payload?.action === SUGGESTION_ACTION) this.schedule(payload.cardNumber);
    });
    this.ws._resynced.subscribe(() => { for (const card of this.watchers.keys()) this.schedule(card); });
  }

  private replace(card: string, s: CardSuggestion): void {
    const list = this.listOf(norm(card));
    const current = list() ?? [];
    list.set(current.some(x => x.id === s.id) ? current.map(x => (x.id === s.id ? s : x)) : [s, ...current]);
  }

  private listOf(key: string): WritableSignal<CardSuggestion[] | null> {
    let s = this.suggestions.get(key);
    if (!s) { s = signal<CardSuggestion[] | null>(null); this.suggestions.set(key, s); }
    return s;
  }

  private effortSignal(key: string): WritableSignal<CardEffortState | null> {
    let s = this.efforts.get(key);
    if (!s) { s = signal<CardEffortState | null>(null); this.efforts.set(key, s); }
    return s;
  }
}

/**
 * Mensagem legível de um erro da API: `{ error }` das rotas do PRMake ou o `Error.Message` do middleware genérico
 * (500 com exceção não tratada) — sem stack trace; senão o texto padrão.
 */
export function serverMessage(err: any, fallback: string): string {
  const own = apiErrorMessage(err, '');
  if (own && typeof own === 'string') return own;
  const generic = err?.error?.Error?.Message ?? err?.error?.error?.Message;
  return typeof generic === 'string' && generic.trim() ? generic.trim() : fallback;
}

/** Aberta ou falhou (dá para tentar de novo): ainda pede a atenção da pessoa. */
export function isPending(s: CardSuggestion): boolean {
  return s.status === 'open' || s.status === 'failed';
}

/** "6h", "1,5h", "—". */
export function formatHours(h: number | null | undefined): string {
  if (h === null || h === undefined || !Number.isFinite(h)) return '—';
  return `${(Math.round(h * 100) / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}h`;
}

function hoursValue(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(`${v}`.trim().replace(',', '.').replace(/h$/i, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeEffort(res: Partial<CardEffort> | null): CardEffort {
  return { originalEstimate: num(res?.originalEstimate), completedWork: num(res?.completedWork), remainingWork: num(res?.remainingWork) };
}

function normalize(s: Partial<CardSuggestion>): CardSuggestion {
  return {
    id: `${s.id ?? ''}`,
    planId: `${s.planId ?? ''}`,
    kind: s.kind ?? '',
    title: s.title ?? '',
    text: s.text ?? null,
    actions: (s.actions ?? []).map(a => ({ key: a.key, label: a.label, primary: !!a.primary })),
    status: s.status ?? 'open',
    chosenAction: s.chosenAction ?? null,
    result: s.result ?? null,
    resolvedBy: s.resolvedBy ?? null,
    createdAt: s.createdAt ?? '',
    resolvedAt: s.resolvedAt ?? null,
  };
}

function norm(card: string | number | null | undefined): string {
  return card === null || card === undefined ? '' : `${card}`.trim();
}
