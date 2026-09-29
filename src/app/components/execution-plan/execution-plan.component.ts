import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  Input,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription } from 'rxjs';
import { WsService } from '../../services/ws.service';
import { CliipboardService } from '../../services/cliipboard.service';
import {
  ExecutionPlanService,
  fileNameFromResponse,
  planApiError,
  saveBlob
} from '../../services/execution-plan.service';
import { FullscreenPanel } from '../../helpers/fullscreen-panel';
import { PlanMarkdownPipe } from './plan-markdown.pipe';
import { PlanFilesDialogComponent, PlanFilesDialogData } from './plan-files-dialog.component';
import {
  ARTIFACT_GROUPS,
  ArtifactGroup,
  EXECUTION_PLAN_EVENT,
  ExecutionArtifact,
  ExecutionLink,
  ExecutionLog,
  ExecutionPlan,
  ExecutionPlanRealtimePayload,
  ExecutionPlanSummary,
  ExecutionQuestion,
  ExecutionStep,
  PLAN_STATUS_LABEL,
  PlanStatus,
  executionPlanGroup,
  isPlanActive
} from './execution-plan.model';

/** Sem sinal da skill por mais que isso (plano ativo) = a sessão provavelmente caiu. */
const STALE_AFTER_MS = 5 * 60 * 1000;
/** Consulta de segurança enquanto o plano está ativo (caso o tempo real esteja fora). */
const SAFETY_POLL_MS = 30_000;
/** Junta rajadas de eventos (a skill manda vários pedaços seguidos). */
const REFRESH_DEBOUNCE_MS = 250;
const MAX_LOGS_IN_MEMORY = 3000;

/** Status visual da etapa: a etapa em andamento de um plano pausado aparece pausada. */
export type StepView = ExecutionStep & {
  view: 'pending' | 'running' | 'paused' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  /** Títulos das dependências que ainda não terminaram (0024). */
  blockedBy: string[];
};

/** Formulário "anexar link" aberto numa etapa (0024). */
interface LinkDraft {
  key: string;
  url: string;
  title: string;
  blocks: boolean;
}

/**
 * Plano de execução da skill (analisar-bug) no card — feature 0023. Fica entre os PRs e a linha do
 * tempo: etapas animadas (concluída / em andamento / pendente / cancelada), o que a skill está
 * fazendo ao vivo, detalhes por etapa (hover/clique), status no cabeçalho, pausar/continuar/cancelar,
 * tela cheia e os arquivos no rodapé. Tempo real = sinal + refetch (como a timeline) e, enquanto o
 * plano está ativo, uma consulta de segurança a cada 30 s. Estado em signals (app zoneless).
 */
@Component({
  selector: 'app-execution-plan',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule, PlanMarkdownPipe],
  templateUrl: './execution-plan.component.html',
  styleUrls: ['./execution-plan.component.css']
})
export class ExecutionPlanComponent implements OnDestroy {
  private api = inject(ExecutionPlanService);
  private ws = inject(WsService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private clipboard = inject(CliipboardService);
  private hostRef = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly plan = signal<ExecutionPlan | null>(null);
  readonly history = signal<ExecutionPlanSummary[]>([]);
  readonly logs = signal<ExecutionLog[]>([]);
  readonly isLoading = signal(false);
  readonly loadError = signal(false);
  /** Card buscado (o que está carregado — não o que está sendo digitado). */
  readonly loadedCard = signal<string | null>(null);
  /** Vendo um plano antigo do histórico (não segue o "mais recente" automaticamente). */
  readonly pinnedPlanId = signal<string | null>(null);
  /** Etapa aberta (detalhes); na tela cheia, a etapa do painel da direita. */
  readonly selectedKey = signal<string | null>(null);
  readonly busy = signal<string | null>(null);
  readonly confirmCancelPlan = signal(false);
  cancelPlanReason = '';
  readonly skipKey = signal<string | null>(null);
  skipReason = '';
  /** Etapas que acabaram de mudar (brilho de "chegou agora"). */
  readonly flashKeys = signal<ReadonlySet<string>>(new Set());

  /** Relógio para "há X min" e "sem sinal" (ajustado pela hora do servidor). */
  readonly now = signal(Date.now());
  private serverOffsetMs = 0;

  readonly groups = ARTIFACT_GROUPS;
  readonly statusLabel = PLAN_STATUS_LABEL;

  readonly fullscreen = new FullscreenPanel({
    host: () => this.hostRef.nativeElement,
    panel: () => this.panelRef?.nativeElement,
    expandedClass: 'plan--expanded',
    maxWidth: 1320
  });
  readonly expanded = this.fullscreen.expanded;

  @ViewChild('panel') private panelRef?: ElementRef<HTMLDivElement>;
  @ViewChild('stepsBody') private stepsBodyRef?: ElementRef<HTMLDivElement>;

  readonly steps = computed<StepView[]>(() => {
    const plan = this.plan();
    if (!plan) return [];
    const byKey = new Map(plan.steps.map((s) => [s.key, s]));
    return plan.steps
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        ...s,
        executor: s.executor ?? 'claude',
        kind: s.kind ?? 'task',
        dependsOn: s.dependsOn ?? [],
        view: s.status === 'running' && plan.status === 'paused' ? 'paused' : s.status,
        blockedBy: s.status === 'pending'
          ? (s.dependsOn ?? []).map((d) => byKey.get(d)).filter((d) => !!d && d.status !== 'completed' && d.status !== 'cancelled').map((d) => d!.title)
          : []
      }));
  });

  // ── 0024: abas Análise / Correção ─────────────────────────────────────────────────────────────

  /** Par análise ↔ correção do plano em tela (a correção nasce da análise). */
  readonly pair = computed(() => {
    const plan = this.plan();
    if (!plan) return null;
    const history = this.history();
    if ((plan.phase ?? 'analysis') === 'correction') {
      return { analysisId: plan.parentPlanId ?? null, correctionId: plan.id };
    }
    const correction = history.find((h) => h.phase === 'correction' && h.parentPlanId === plan.id);
    return { analysisId: plan.id, correctionId: correction?.id ?? null };
  });

  readonly phase = computed(() => this.plan()?.phase ?? 'analysis');

  // ── 0024: perguntas e links ───────────────────────────────────────────────────────────────────

  readonly openQuestions = computed(() => (this.plan()?.questions ?? []).filter((q) => q.status === 'open'));
  readonly answerDrafts = signal<Record<string, string>>({});
  readonly linkDraft = signal<LinkDraft | null>(null);

  readonly counts = computed(() => {
    const steps = this.plan()?.steps ?? [];
    const done = steps.filter((s) => s.status === 'completed').length;
    const cancelled = steps.filter((s) => s.status === 'cancelled').length;
    // Canceladas saem da conta (o progresso não "trava" por uma etapa pulada).
    const total = steps.length - cancelled;
    return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
  });

  readonly currentStep = computed(() => this.steps().find((s) => s.view === 'running' || s.view === 'paused') ?? null);

  questionsFor(key: string): ExecutionQuestion[] {
    return (this.plan()?.questions ?? []).filter((q) => q.stepKey === key);
  }

  linksFor(key: string): ExecutionLink[] {
    return (this.plan()?.links ?? []).filter((l) => l.stepKey === key);
  }
  readonly selectedStep = computed(() => {
    const key = this.selectedKey();
    return (key && this.steps().find((s) => s.key === key)) || null;
  });
  /** Pedaços de andamento agrupados por etapa. */
  private readonly logsByStep = computed(() => {
    const map = new Map<string, ExecutionLog[]>();
    for (const log of this.logs()) {
      if (!log.stepKey) continue;
      const list = map.get(log.stepKey);
      if (list) list.push(log);
      else map.set(log.stepKey, [log]);
    }
    return map;
  });
  /** Pedaços sem etapa (gerais do plano) — aparecem no painel da tela cheia sem etapa escolhida. */
  readonly generalLogs = computed(() => this.logs().filter((l) => !l.stepKey));

  readonly isActive = computed(() => isPlanActive(this.plan()?.status));

  /** Minutos sem sinal da skill (null = não se aplica). */
  readonly staleMinutes = computed(() => {
    const plan = this.plan();
    if (!plan || !isPlanActive(plan.status) || !plan.lastActivityAt) return null;
    const idle = this.now() + this.serverOffsetMs - Date.parse(plan.lastActivityAt);
    return idle > STALE_AFTER_MS ? Math.floor(idle / 60000) : null;
  });

  readonly resumeCommand = computed(() => `/analisar-bug ${this.loadedCard() ?? ''}`.trim());

  readonly artifactCounts = computed(() => {
    const artifacts = this.plan()?.artifacts ?? [];
    const map: Record<string, number> = {};
    for (const g of ARTIFACT_GROUPS) map[g.id] = artifacts.filter((a) => g.kinds.includes(a.kind)).length;
    return map;
  });

  private _cardNumber: string | null = null;
  @Input()
  set cardNumber(value: string | number | null | undefined) {
    const normalized = value !== null && value !== undefined && `${value}`.trim() !== '' ? `${value}`.trim() : null;
    this._cardNumber = normalized;
    // Limpar (card vazio) zera o painel; um número diferente só vale depois da busca (load()).
    if (!normalized) this.clear();
  }
  get cardNumber(): string | null {
    return this._cardNumber;
  }

  private currentGroup: string | null = null;
  private loadSub?: Subscription;
  private logsSub?: Subscription;
  private resyncSub?: Subscription;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private pollTimer?: ReturnType<typeof setInterval>;
  private clockTimer?: ReturnType<typeof setInterval>;
  private flashTimer?: ReturnType<typeof setTimeout>;
  private filesDialogOpen = false;
  private readonly artifactsSignal = computed(() => this.plan()?.artifacts ?? []);

  constructor() {
    this.ws.startConnection();
    this.ws.on(EXECUTION_PLAN_EVENT, this.onRealtime);
    // A conexão voltou depois de cair: os eventos da queda se perderam — recarrega em silêncio.
    this.resyncSub = this.ws._resynced.subscribe(() => this.refresh());
    this.clockTimer = setInterval(() => this.now.set(Date.now()), 15_000);
    this.pollTimer = setInterval(() => {
      if (this.isActive() && !document.hidden) this.refresh();
    }, SAFETY_POLL_MS);
  }

  /** Busca o plano do card (chamado pela busca da tela, junto com a timeline). */
  load(card?: string | number | null): void {
    const normalized = card !== null && card !== undefined && `${card}`.trim() !== '' ? `${card}`.trim() : this._cardNumber;
    if (!normalized) {
      this.clear();
      return;
    }
    const changed = normalized !== this.loadedCard();
    this.loadedCard.set(normalized);
    this.switchGroup(normalized);
    if (changed) {
      this.plan.set(null);
      this.logs.set([]);
      this.history.set([]);
      this.pinnedPlanId.set(null);
      this.selectedKey.set(null);
    }
    this.fetch({ silent: false });
  }

  /** Recarrega sem piscar (tempo real, reconexão, consulta de segurança). */
  refresh(): void {
    if (this.loadedCard()) this.fetch({ silent: true });
  }

  private clear(): void {
    this.loadSub?.unsubscribe();
    this.logsSub?.unsubscribe();
    this.switchGroup(null);
    this.loadedCard.set(null);
    this.plan.set(null);
    this.logs.set([]);
    this.history.set([]);
    this.pinnedPlanId.set(null);
    this.selectedKey.set(null);
    this.isLoading.set(false);
    this.loadError.set(false);
    this.confirmCancelPlan.set(false);
    this.skipKey.set(null);
  }

  private fetch(options: { silent: boolean }): void {
    const card = this.loadedCard();
    if (!card) return;
    const silent = options.silent && !!this.plan();
    if (!silent) {
      this.isLoading.set(true);
      this.loadError.set(false);
    }

    const pinned = this.pinnedPlanId();
    const request = pinned ? this.api.get(pinned) : this.api.getCurrent(card);
    this.loadSub?.unsubscribe();
    this.loadSub = request.subscribe({
      next: (plan) => {
        if (this.loadedCard() !== card) return;
        this.isLoading.set(false);
        this.applyPlan(plan ?? null);
        this.loadHistory(card);
      },
      error: () => {
        if (this.loadedCard() !== card) return;
        this.isLoading.set(false);
        // Numa atualização discreta a tela mantém o que já mostra.
        if (!silent) this.loadError.set(true);
      }
    });
  }

  private applyPlan(plan: ExecutionPlan | null): void {
    const previous = this.plan();
    if (plan?.serverTime) this.serverOffsetMs = Date.parse(plan.serverTime) - Date.now();
    this.now.set(Date.now());

    if (plan && previous && previous.id === plan.id) this.flashChanged(previous, plan);
    if (!plan || previous?.id !== plan.id) this.logs.set([]);
    this.plan.set(plan);

    if (!plan) return;
    // Primeira carga: abre a etapa em andamento (o usuário vê o que está acontecendo sem clicar).
    if (!previous || previous.id !== plan.id) {
      const current = plan.steps.find((s) => s.status === 'running') ?? plan.steps.find((s) => s.status === 'waiting');
      this.selectedKey.set(current?.key ?? null);
      this.scrollToStep(current?.key ?? null);
    } else if (this.selectedKey() && !plan.steps.some((s) => s.key === this.selectedKey())) {
      this.selectedKey.set(null);
    } else {
      // A etapa em andamento mudou e o usuário estava acompanhando a anterior: segue a skill.
      const prevRunning = previous.steps.find((s) => s.status === 'running')?.key ?? null;
      const nowRunning = plan.steps.find((s) => s.status === 'running')?.key ?? null;
      if (nowRunning && nowRunning !== prevRunning && (this.selectedKey() === prevRunning || !this.selectedKey())) {
        this.selectedKey.set(nowRunning);
        this.scrollToStep(nowRunning);
      }
    }
    this.loadNewLogs(plan);
  }

  /** Busca só os registros novos (cursor pelo id). */
  private loadNewLogs(plan: ExecutionPlan): void {
    const current = this.logs();
    const afterId = current.length ? current[current.length - 1].id : 0;
    if (plan.lastLogId <= afterId) return;

    this.logsSub?.unsubscribe();
    this.logsSub = this.api.logs(plan.id, afterId).subscribe({
      next: (items) => {
        if (this.plan()?.id !== plan.id || !items.length) return;
        const merged = [...this.logs(), ...items.filter((i) => i.id > afterId)];
        this.logs.set(merged.length > MAX_LOGS_IN_MEMORY ? merged.slice(-MAX_LOGS_IN_MEMORY) : merged);
        // Página cheia: ainda há mais (plano longo) — continua.
        if (items.length >= 1000) this.loadNewLogs(plan);
        this.scrollLogsToEnd();
      },
      error: () => {}
    });
  }

  private loadHistory(card: string): void {
    this.api.history(card).subscribe({
      next: (list) => {
        if (this.loadedCard() === card) this.history.set(list ?? []);
      },
      error: () => {}
    });
  }

  private onRealtime = (payload: ExecutionPlanRealtimePayload): void => {
    const card = payload?.cardNumber != null ? `${payload.cardNumber}`.trim() : null;
    if (!card || card !== this.loadedCard()) return;
    // Vendo um plano antigo: só interessa se o evento é dele.
    const pinned = this.pinnedPlanId();
    if (pinned && payload.planId !== pinned) {
      this.loadHistory(card);
      return;
    }
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refresh(), REFRESH_DEBOUNCE_MS);
  };

  private switchGroup(card: string | null): void {
    const group = card ? executionPlanGroup(card) : null;
    if (group === this.currentGroup) return;
    if (this.currentGroup) this.ws.removeFromGroup(this.currentGroup);
    this.currentGroup = group;
    if (group) this.ws.addToGroup(group);
  }

  /** Marca por ~1,6 s as etapas cujo status mudou (animação de "chegou agora"). */
  private flashChanged(previous: ExecutionPlan, next: ExecutionPlan): void {
    const before = new Map(previous.steps.map((s) => [s.key, s.status]));
    const changed = next.steps.filter((s) => before.get(s.key) !== s.status).map((s) => s.key);
    if (!changed.length) return;
    this.flashKeys.set(new Set(changed));
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.flashKeys.set(new Set()), 1600);
  }

  // ── Interação com as etapas ─────────────────────────────────────────────────────────────────────

  toggleStep(step: StepView): void {
    if (this.expanded()) {
      this.selectedKey.set(step.key);
      return;
    }
    this.selectedKey.update((k) => (k === step.key ? null : step.key));
    this.skipKey.set(null);
  }

  stepTooltip(step: StepView): string {
    if (step.view === 'cancelled') {
      return `Cancelada${step.statusReason ? ': ' + step.statusReason : ''}`;
    }
    if (step.view === 'failed') return `Falhou${step.statusReason ? ': ' + step.statusReason : ''}`;
    if (step.view === 'waiting') return step.statusReason?.startsWith('Aguardando') ? step.statusReason : `Aguardando${step.statusReason ? ': ' + step.statusReason : ''}`;
    const desc = (step.description ?? '').replace(/[#*_`>]/g, '').trim();
    const head = { pending: 'Pendente', running: 'Em andamento', paused: 'Pausada', completed: 'Concluída' }[step.view];
    const who = step.executor === 'user' ? ' · executada por você' : '';
    const deps = step.blockedBy.length ? `\nDepende de: ${step.blockedBy.join(', ')}` : '';
    const body = desc ? ` — ${desc.length > 280 ? desc.slice(0, 280) + '…' : desc}` : '';
    return `${head}${who}${body}${deps}`;
  }

  kindIcon(step: StepView): string | null {
    return ({ code: 'code', pr: 'merge', ticket: 'confirmation_number', question: 'help', validation: 'fact_check', task: null } as Record<string, string | null>)[step.kind] ?? null;
  }

  kindLabel(step: StepView): string {
    return ({ code: 'Código', pr: 'Pull requests', ticket: 'Chamado', question: 'Perguntas', validation: 'Validação', task: 'Tarefa' } as Record<string, string>)[step.kind] ?? 'Tarefa';
  }

  stepIcon(step: StepView): string {
    switch (step.view) {
      case 'completed': return 'check';
      case 'cancelled': return 'block';
      case 'failed': return 'priority_high';
      case 'paused': return 'pause';
      case 'waiting': return 'hourglass_top';
      default: return '';
    }
  }

  canSkip(step: StepView): boolean {
    const plan = this.plan();
    return !!plan && isPlanActive(plan.status) && (step.status === 'pending' || step.status === 'running' || step.status === 'waiting');
  }

  /** Etapa do usuário: ele inicia/conclui pela tela (0024). */
  canStart(step: StepView): boolean {
    return this.isActive() && step.executor === 'user' && step.status === 'pending';
  }

  canComplete(step: StepView): boolean {
    return this.isActive() && step.executor === 'user' && (step.status === 'running' || step.status === 'waiting' || step.status === 'pending');
  }

  /** Anexar link: etapas não canceladas de planos ativos (chamado resolvido/fechado → pode abrir outro). */
  canAddLink(step: StepView): boolean {
    return this.isActive() && step.status !== 'cancelled';
  }

  startStep(step: StepView): void {
    const plan = this.plan();
    if (!plan || this.busy()) return;
    this.busy.set('step');
    this.api.startStep(plan.id, step.key).subscribe({
      next: () => { this.busy.set(null); this.refresh(); },
      error: (err) => { this.busy.set(null); this.snackBar.open(planApiError(err, 'Não foi possível iniciar a etapa.'), 'Fechar', { duration: 8000 }); }
    });
  }

  completeStep(step: StepView): void {
    const plan = this.plan();
    if (!plan || this.busy()) return;
    this.busy.set('step');
    this.api.completeStep(plan.id, step.key).subscribe({
      next: () => { this.busy.set(null); this.snackBar.open('Etapa concluída.', 'Ok', { duration: 3000 }); this.refresh(); },
      error: (err) => { this.busy.set(null); this.snackBar.open(planApiError(err, 'Não foi possível concluir a etapa.'), 'Fechar', { duration: 8000 }); }
    });
  }

  // ── Perguntas ───────────────────────────────────────────────────────────────────────────────

  setAnswerDraft(questionId: string, text: string): void {
    this.answerDrafts.update((d) => ({ ...d, [questionId]: text }));
  }

  answer(question: ExecutionQuestion, text: string): void {
    const plan = this.plan();
    const value = (text ?? '').trim();
    if (!plan || !value || this.busy()) return;
    this.busy.set('answer:' + question.id);
    this.api.answer(plan.id, question.id, value).subscribe({
      next: () => {
        this.busy.set(null);
        this.answerDrafts.update((d) => { const { [question.id]: _, ...rest } = d; return rest; });
        this.snackBar.open('Resposta enviada — a skill segue com ela.', 'Ok', { duration: 4000 });
        this.refresh();
      },
      error: (err) => {
        this.busy.set(null);
        this.snackBar.open(planApiError(err, 'Não foi possível enviar a resposta.'), 'Fechar', { duration: 8000 });
      }
    });
  }

  // ── Links (chamados, PRs, documentos) ─────────────────────────────────────────────────────

  openLinkForm(step: StepView): void {
    this.linkDraft.set({ key: step.key, url: '', title: '', blocks: step.kind === 'ticket' });
  }

  updateLinkDraft(changes: Partial<LinkDraft>): void {
    this.linkDraft.update((d) => (d ? { ...d, ...changes } : d));
  }

  saveLink(): void {
    const plan = this.plan();
    const draft = this.linkDraft();
    if (!plan || !draft || !draft.url.trim() || this.busy()) return;
    this.busy.set('link');
    this.api.addLink(plan.id, draft.key, { url: draft.url.trim(), title: draft.title.trim() || null, blocksStep: draft.blocks }).subscribe({
      next: () => { this.busy.set(null); this.linkDraft.set(null); this.refresh(); },
      error: (err) => { this.busy.set(null); this.snackBar.open(planApiError(err, 'Não foi possível anexar o link.'), 'Fechar', { duration: 8000 }); }
    });
  }

  setLinkStatus(link: ExecutionLink, status: 'open' | 'resolved' | 'closed'): void {
    const plan = this.plan();
    if (!plan || this.busy()) return;
    this.busy.set('link');
    this.api.updateLink(plan.id, link.id, { status }).subscribe({
      next: () => { this.busy.set(null); this.refresh(); },
      error: (err) => { this.busy.set(null); this.snackBar.open(planApiError(err, 'Não foi possível atualizar o chamado.'), 'Fechar', { duration: 8000 }); }
    });
  }

  removeLink(link: ExecutionLink): void {
    const plan = this.plan();
    if (!plan || this.busy()) return;
    this.busy.set('link');
    this.api.deleteLink(plan.id, link.id).subscribe({
      next: () => { this.busy.set(null); this.refresh(); },
      error: (err) => { this.busy.set(null); this.snackBar.open(planApiError(err, 'Não foi possível remover o link.'), 'Fechar', { duration: 8000 }); }
    });
  }

  linkIcon(link: ExecutionLink): string {
    return { ticket: 'confirmation_number', pr: 'merge', doc: 'description', other: 'link' }[link.kind] ?? 'link';
  }

  linkStatusLabel(link: ExecutionLink): string {
    const labels: Record<string, string> = link.kind === 'pr'
      ? { open: 'Aberto', merged: 'Mesclado', closed: 'Fechado' }
      : link.kind === 'ticket' ? { open: 'Aberto', resolved: 'Resolvido', closed: 'Fechado' } : {};
    return labels[link.status ?? 'open'] ?? '';
  }

  /** Abre o plano de análise ou o de correção do par (abas). */
  selectPhase(target: 'analysis' | 'correction'): void {
    const pair = this.pair();
    const id = target === 'analysis' ? pair?.analysisId : pair?.correctionId;
    if (!id || id === this.plan()?.id) return;
    const latest = this.history()[0];
    this.pinnedPlanId.set(latest && latest.id === id ? null : id);
    this.selectedKey.set(null);
    this.plan.set(null);
    this.logs.set([]);
    this.fetch({ silent: false });
  }

  startSkip(step: StepView): void {
    this.skipKey.set(step.key);
    this.skipReason = '';
  }

  confirmSkip(step: StepView): void {
    const plan = this.plan();
    if (!plan || this.busy()) return;
    const reason = this.skipReason.trim() || 'Pulada pelo usuário';
    this.busy.set('skip');
    this.api.cancelStep(plan.id, step.key, reason).subscribe({
      next: () => {
        this.busy.set(null);
        this.skipKey.set(null);
        this.snackBar.open('Etapa cancelada — a skill vai pular esta etapa.', 'Ok', { duration: 4000 });
        this.refresh();
      },
      error: (err) => {
        this.busy.set(null);
        this.snackBar.open(planApiError(err, 'Não foi possível cancelar a etapa.'), 'Fechar', { duration: 8000 });
      }
    });
  }

  // ── Ações do plano ──────────────────────────────────────────────────────────────────────────────

  pause(): void {
    this.changeStatus('paused', null, 'Plano pausado — a skill para na próxima checagem e espera você continuar.');
  }

  resume(): void {
    const stale = this.staleMinutes() !== null;
    this.changeStatus('running', null, stale
      ? `Plano liberado, mas a skill está sem sinal — retome no Claude Code: ${this.resumeCommand()}`
      : 'Plano retomado.');
  }

  askCancelPlan(): void {
    this.cancelPlanReason = '';
    this.confirmCancelPlan.set(true);
  }

  confirmCancel(): void {
    const reason = this.cancelPlanReason.trim() || null;
    this.changeStatus('cancelled', reason, 'Plano cancelado.', () => this.confirmCancelPlan.set(false));
  }

  private changeStatus(status: PlanStatus, reason: string | null, done: string, after?: () => void): void {
    const plan = this.plan();
    if (!plan || this.busy()) return;
    this.busy.set(status);
    this.api.changeStatus(plan.id, status, reason).subscribe({
      next: (updated) => {
        this.busy.set(null);
        after?.();
        if (updated) this.applyPlan(updated);
        this.snackBar.open(done, 'Ok', { duration: 5000 });
      },
      error: (err) => {
        this.busy.set(null);
        this.snackBar.open(planApiError(err, 'Não foi possível alterar o plano.'), 'Fechar', { duration: 8000 });
        this.refresh();
      }
    });
  }

  selectHistory(item: ExecutionPlanSummary): void {
    const latest = this.history()[0];
    this.pinnedPlanId.set(latest && item.id === latest.id ? null : item.id);
    this.selectedKey.set(null);
    this.plan.set(null);
    this.logs.set([]);
    this.fetch({ silent: false });
  }

  copyResumeCommand(): void {
    this.clipboard.copyFullDescriptionToClipboard(this.resumeCommand());
  }

  // ── Arquivos ────────────────────────────────────────────────────────────────────────────────────

  openFiles(group?: ArtifactGroup, artifact?: ExecutionArtifact): void {
    const plan = this.plan();
    if (!plan || this.filesDialogOpen) return;
    const data: PlanFilesDialogData = {
      planId: plan.id,
      cardNumber: plan.cardNumber,
      artifacts: this.artifactsSignal,
      groupId: group?.id ?? (artifact ? ARTIFACT_GROUPS.find((g) => g.kinds.includes(artifact.kind))?.id : undefined),
      artifactId: artifact?.id,
      stepTitle: (key) => this.plan()?.steps.find((s) => s.key === key)?.title ?? null
    };
    this.filesDialogOpen = true;
    this.dialog
      .open(PlanFilesDialogComponent, {
        data,
        width: 'min(1200px, 96vw)',
        maxWidth: '96vw',
        height: 'min(860px, 92vh)',
        panelClass: 'plan-files-dialog-panel',
        autoFocus: false
      })
      .afterClosed()
      .subscribe(() => (this.filesDialogOpen = false));
  }

  logsFor(key: string): ExecutionLog[] {
    return this.logsByStep().get(key) ?? [];
  }

  stepArtifacts(key: string): ExecutionArtifact[] {
    return (this.plan()?.artifacts ?? []).filter((a) => a.stepKey === key);
  }

  downloadZip(): void {
    const plan = this.plan();
    if (!plan || this.busy()) return;
    this.busy.set('zip');
    this.api.zip(plan.id).subscribe({
      next: (res) => {
        this.busy.set(null);
        if (res.body) saveBlob(res.body, fileNameFromResponse(res, `card-${plan.cardNumber}.zip`));
      },
      error: () => {
        this.busy.set(null);
        this.snackBar.open('Não foi possível baixar os arquivos.', 'Fechar', { duration: 6000 });
      }
    });
  }

  // ── Formatação ──────────────────────────────────────────────────────────────────────────────────

  relativeTime(value?: string | null): string {
    if (!value) return '';
    const diff = this.now() + this.serverOffsetMs - Date.parse(value);
    if (isNaN(diff)) return '';
    const sec = Math.max(0, Math.floor(diff / 1000));
    if (sec < 60) return 'agora mesmo';
    const min = Math.floor(sec / 60);
    if (min < 60) return `há ${min} min`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return `há ${hours} h`;
    return this.formatDateTime(value);
  }

  duration(step: ExecutionStep): string {
    if (!step.startedAt) return '';
    const end = step.finishedAt ? Date.parse(step.finishedAt) : this.now() + this.serverOffsetMs;
    const sec = Math.max(0, Math.round((end - Date.parse(step.startedAt)) / 1000));
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} min${sec % 60 ? ` ${sec % 60}s` : ''}`;
    return `${Math.floor(min / 60)} h ${min % 60} min`;
  }

  formatDateTime(value?: string | null): string {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  formatTime(value?: string | null): string {
    if (!value) return '';
    const d = new Date(value);
    const p = (n: number) => String(n).padStart(2, '0');
    return isNaN(d.getTime()) ? '' : `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  logIcon(log: ExecutionLog): string {
    return { info: 'chevron_right', progress: 'autorenew', finding: 'search', decision: 'alt_route', warning: 'warning', error: 'error' }[log.kind] ?? 'chevron_right';
  }

  trackStep = (_: number, s: StepView) => s.key;
  trackLog = (_: number, l: ExecutionLog) => l.id;

  private scrollToStep(key: string | null): void {
    if (!key) return;
    setTimeout(() => {
      const body = this.stepsBodyRef?.nativeElement;
      const el = body?.querySelector<HTMLElement>(`[data-step-key="${key}"]`);
      if (!body || !el) return;
      // Posição relativa ao container (independe do offsetParent); a etapa fica no alto, com o
      // título visível e os detalhes abaixo. Já visível inteira: não mexe.
      const box = body.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (r.top >= box.top && r.bottom <= box.bottom) return;
      body.scrollTo({ top: Math.max(0, body.scrollTop + r.top - box.top - 8), behavior: 'smooth' });
    });
  }

  private scrollLogsToEnd(): void {
    setTimeout(() => {
      const panel = this.panelRef?.nativeElement;
      panel?.querySelectorAll<HTMLElement>('.plan-logs[data-follow]').forEach((box) => {
        // Só segue o fim se o usuário já estava no fim (não atrapalha quem rolou para ler).
        if (box.scrollHeight - box.scrollTop - box.clientHeight < 80) box.scrollTop = box.scrollHeight;
      });
    });
  }

  ngOnDestroy(): void {
    this.fullscreen.destroy();
    this.loadSub?.unsubscribe();
    this.logsSub?.unsubscribe();
    this.resyncSub?.unsubscribe();
    clearTimeout(this.refreshTimer);
    clearTimeout(this.flashTimer);
    clearInterval(this.pollTimer);
    clearInterval(this.clockTimer);
    if (this.currentGroup) this.ws.removeFromGroup(this.currentGroup);
    this.ws.off(EXECUTION_PLAN_EVENT, this.onRealtime);
  }
}
