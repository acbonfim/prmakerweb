import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  OnDestroy,
  ViewChild,
  computed,
  effect,
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
import { BackNavigationService } from '../../services/back-navigation.service';
import { PlanMarkdownPipe } from './plan-markdown.pipe';
import { PlanFilesDialogComponent, PlanFilesDialogData } from './plan-files-dialog.component';
import { PlanNotesComponent } from './plan-notes.component';
import { PlanChatDialogComponent, PlanChatDialogData } from './plan-chat-dialog.component';
import { StorageService } from '../../services/storage.service';
import { UserPendingService } from '../../services/user-pending.service';
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
  ExecutionUserAction,
  NoteTargetPlan,
  PLAN_STATUS_LABEL,
  PlanStatus,
  executionPlanGroup,
  isPlanActive
} from './execution-plan.model';
import { ExecutionQueueService } from '../../services/execution-queue.service';
import {
  AGENT_INSTALL_COMMAND,
  ExecutionCardQueue,
  ExecutionRequest,
  ExecutionWorker,
  REQUEST_SOURCE_LABEL,
  isRequestActive
} from './execution-queue.model';
import { ExecutorsDialogComponent } from '../executors-dialog/executors-dialog.component';
import { TokenUsageComponent } from '../token-usage/token-usage.component';
import { TokenUsage } from '../../services/token-pricing.service';

/** Evento do card quando os PRs mudam (status sincronizado com o GitHub, PR aberto) — o plano reage na hora (0025). */
const PULLREQUEST_CARD_EVENT = 'pullRequestCardUpdated';

/** Sem sinal da skill por mais que isso (plano ativo) = a sessão provavelmente caiu. */
const STALE_AFTER_MS = 5 * 60 * 1000;
/** Consulta de segurança enquanto o plano está ativo (caso o tempo real esteja fora). */
const SAFETY_POLL_MS = 30_000;
/** Celular (0043): tela cheia com uma coluna por vez (lista de etapas → etapa). */
const NARROW_QUERY = '(max-width: 768px)';
/** Rolagem automática (seguir a etapa/os registros) espera o usuário parar de mexer por este tempo. */
const USER_IDLE_MS = 5000;
/** Junta rajadas de eventos (a skill manda vários pedaços seguidos). */
const REFRESH_DEBOUNCE_MS = 250;
const MAX_LOGS_IN_MEMORY = 3000;
/** Etapa da skill "em andamento" cujo último registro é um aviso, sem nada novo há este tempo: provável bloqueio (0037). */
const STALLED_WARNING_MS = 2 * 60 * 1000;

/** Resumo do plano para o cartão do topo da tela do card (0026). */
export interface PlanHeadline {
  phase: 'analysis' | 'correction';
  status: string;
  done: number;
  total: number;
  /** Etapas aguardando algo externo (merge, chamado, resposta). */
  waiting: number;
  openQuestions: number;
  /** Pendências do usuário: perguntas + etapas dele + etapas travadas esperando ele (0037). */
  userPending: number;
}

/** Status visual da etapa: a etapa em andamento de um plano pausado aparece pausada. */
export type StepView = ExecutionStep & {
  view: 'pending' | 'running' | 'paused' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  /** Títulos das dependências que ainda não terminaram (0024). */
  blockedBy: string[];
  /** 0037: depende do usuário — `unblock` = travada esperando uma ação dele; `turn` = etapa dele, pronta ou em andamento. */
  you: 'unblock' | 'turn' | null;
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
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule, PlanMarkdownPipe, PlanNotesComponent, TokenUsageComponent],
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
  private userPending = inject(UserPendingService);
  private queueApi = inject(ExecutionQueueService);

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

  /** Resumo do plano em tela (ou null sem plano) — para o cartão do topo (0026). */
  @Output() headline = new EventEmitter<PlanHeadline | null>();

  readonly fullscreen = new FullscreenPanel({
    host: () => this.hostRef.nativeElement,
    panel: () => this.panelRef?.nativeElement,
    expandedClass: 'plan--expanded',
    maxWidth: 1320
  });
  readonly expanded = this.fullscreen.expanded;

  // ── 0043: celular ─────────────────────────────────────────────────────────────────────────────

  private readonly back = inject(BackNavigationService);
  private readonly narrowMedia = window.matchMedia(NARROW_QUERY);
  readonly narrow = signal(this.narrowMedia.matches);
  private readonly onNarrowChange = (e: MediaQueryListEvent) => this.narrow.set(e.matches);
  /** Tela cheia no celular: true = mostrando a etapa (ou o resumo); false = a lista de etapas. */
  readonly mobileDetail = signal(false);
  private releaseMobileDetail?: () => void;
  private stepsScrollTop = 0;
  /** Último toque/rolagem do usuário no painel: a rolagem automática não briga com o dedo. */
  private lastInteraction = 0;
  @ViewChild('detailBody') private detailBodyRef?: ElementRef<HTMLDivElement>;

  /** Posição da etapa aberta na lista (para "anterior/próxima" na tela cheia do celular). */
  readonly selectedIndex = computed(() => this.steps().findIndex((s) => s.key === this.selectedKey()));

  markInteraction(): void {
    this.lastInteraction = Date.now();
  }

  private userIsInteracting(): boolean {
    return Date.now() - this.lastInteraction < USER_IDLE_MS;
  }

  /** Abre a etapa (ou o resumo, com `key` null) por cima da lista — o Voltar volta para a lista. */
  openMobileDetail(key: string | null): void {
    this.selectedKey.set(key);
    if (!this.mobileDetail()) {
      this.stepsScrollTop = this.stepsBodyRef?.nativeElement.scrollTop ?? 0;
      this.mobileDetail.set(true);
      this.releaseMobileDetail = this.back.push(() => this.closeMobileDetail());
    }
    setTimeout(() => this.detailBodyRef?.nativeElement.scrollTo({ top: 0 }));
  }

  closeMobileDetail(): void {
    if (!this.mobileDetail()) return;
    this.mobileDetail.set(false);
    this.releaseMobileDetail?.();
    this.releaseMobileDetail = undefined;
    // A lista volta onde estava (display: none perde a rolagem).
    const top = this.stepsScrollTop;
    setTimeout(() => this.stepsBodyRef?.nativeElement.scrollTo({ top }));
  }

  stepNav(delta: number): void {
    const next = this.steps()[this.selectedIndex() + delta];
    if (next) this.openMobileDetail(next.key);
  }

  @ViewChild('panel') private panelRef?: ElementRef<HTMLDivElement>;
  @ViewChild('notes') private notesRef?: PlanNotesComponent;

  // ── 0031: comentários e anexos do usuário ─────────────────────────────────────────────────────

  /** Quem está logado (edita/remove só os próprios comentários). */
  readonly currentUserId: string | null = inject(StorageService).getAccess()?.user?.externalId ?? null;
  readonly panelDropping = signal(false);
  readonly noteCount = computed(() => this.plan()?.notes?.length ?? 0);
  readonly noteSteps = computed(() => this.steps().map((s) => ({ key: s.key, title: s.title, status: s.status })));

  // ── 0037: conversa com o Claude (popup) ───────────────────────────────────────────────────────

  /** O outro plano da dupla análise/correção (o comentário pode ir para ele). Carregado ao abrir a conversa. */
  private readonly otherPlan = signal<ExecutionPlan | null>(null);
  readonly noteTargets = computed<NoteTargetPlan[]>(() => {
    const plan = this.plan();
    if (!plan) return [];
    const toTarget = (p: ExecutionPlan, current: boolean): NoteTargetPlan => ({
      planId: p.id, phase: p.phase ?? 'analysis', title: p.title, current,
      steps: p.steps.slice().sort((a, b) => a.order - b.order).map((s) => ({ key: s.key, title: s.title, status: s.status }))
    });
    const list = [toTarget(plan, true)];
    const other = this.otherPlan();
    const pair = this.pair();
    if (other && other.id !== plan.id && (other.id === pair?.analysisId || other.id === pair?.correctionId)) list.push(toTarget(other, false));
    // Análise antes da correção, como nas abas.
    return list.sort((a, b) => (a.phase === b.phase ? 0 : a.phase === 'analysis' ? -1 : 1));
  });

  openChat(): void {
    const plan = this.plan();
    if (!plan) return;
    const pair = this.pair();
    const otherId = pair ? (pair.analysisId === plan.id ? pair.correctionId : pair.analysisId) : null;
    if (otherId && this.otherPlan()?.id !== otherId) {
      this.api.get(otherId).subscribe({ next: (p) => this.otherPlan.set(p), error: () => {} });
    }
    const data: PlanChatDialogData = {
      card: this.loadedCard() ?? plan.cardNumber,
      plan: this.plan,
      targets: this.noteTargets,
      selectedStepKey: this.selectedKey,
      currentUserId: this.currentUserId,
      serverOffsetMs: () => this.serverOffsetMs,
      refresh: () => this.refresh(),
      openArtifact: (a) => this.openFiles(undefined, a)
    };
    this.dialog.open(PlanChatDialogComponent, {
      data,
      width: '980px',
      maxWidth: '96vw',
      height: '88vh',
      panelClass: 'plan-chat-panel',
      backdropClass: 'plan-chat-backdrop',
      autoFocus: 'textarea',
      restoreFocus: true
    });
  }
  private dropLeaveTimer?: ReturnType<typeof setTimeout>;

  /** Arrastar arquivos para qualquer parte do painel anexa ao comentário em edição. */
  onPanelDragOver(event: DragEvent): void {
    if (!this.plan() || !PlanNotesComponent.hasFiles(event)) return;
    event.preventDefault();
    clearTimeout(this.dropLeaveTimer);
    this.panelDropping.set(true);
  }

  onPanelDragLeave(event: DragEvent): void {
    // dragleave dispara ao passar entre filhos: só some se não voltar logo.
    clearTimeout(this.dropLeaveTimer);
    this.dropLeaveTimer = setTimeout(() => this.panelDropping.set(false), 80);
  }

  onPanelDrop(event: DragEvent): void {
    if (!PlanNotesComponent.hasFiles(event)) return;
    event.preventDefault();
    this.panelDropping.set(false);
    if (!this.plan()) return;
    this.notesRef?.addFiles(event.dataTransfer?.files);
  }

  /** Ctrl+V com imagem em qualquer lugar do painel (fora de outro campo) vai para o comentário. */
  onPanelPaste(event: ClipboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('app-plan-notes') || target?.matches('input, textarea, [contenteditable="true"]')) return;
    const files = PlanNotesComponent.clipboardFiles(event);
    if (!files.length || !this.plan()) return;
    event.preventDefault();
    this.notesRef?.addFiles(files, true);
  }

  focusNotes(): void {
    this.notesRef?.focus();
  }
  @ViewChild('stepsBody') private stepsBodyRef?: ElementRef<HTMLDivElement>;

  readonly steps = computed<StepView[]>(() => {
    const plan = this.plan();
    if (!plan) return [];
    const byKey = new Map(plan.steps.map((s) => [s.key, s]));
    const you = this.youByStep();
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
          : [],
        you: you.get(s.key) ?? null
      }));
  });

  /**
   * Pendências do usuário vindas do servidor (0037). API antiga (sem `userActions`): calcula aqui com a mesma regra —
   * perguntas abertas, etapas travadas esperando o usuário e etapas dele prontas ou em andamento.
   */
  readonly userActions = computed<ExecutionUserAction[]>(() => {
    const plan = this.plan();
    if (!plan || !isPlanActive(plan.status)) return [];
    if (plan.userActions) return plan.userActions;
    const byKey = new Map(plan.steps.map((s) => [s.key, s]));
    const ready = (s: ExecutionStep) => s.status === 'pending'
      && (s.dependsOn ?? []).every((d) => { const dep = byKey.get(d); return !dep || dep.status === 'completed' || dep.status === 'cancelled'; });
    const actions: ExecutionUserAction[] = (plan.questions ?? []).filter((q) => q.status === 'open')
      .map((q) => ({ type: 'question', stepKey: q.stepKey, title: byKey.get(q.stepKey ?? '')?.title ?? 'Pergunta', text: q.text, questionId: q.id }));
    for (const s of plan.steps.slice().sort((a, b) => a.order - b.order)) {
      if (s.status === 'waiting' && s.waitingOn === 'user') actions.push({ type: 'unblock', stepKey: s.key, title: s.title, text: s.statusReason });
      else if ((s.executor ?? 'claude') === 'user' && (s.status === 'running' || ready(s))) actions.push({ type: 'step', stepKey: s.key, title: s.title });
    }
    return actions;
  });

  /** Etapas (não perguntas) que dependem do usuário — o aviso do topo as lista com o botão certo. */
  readonly stepActions = computed(() => this.userActions().filter((a) => a.type !== 'question' && a.stepKey));

  /** Total do aviso "Aguardando você": perguntas abertas (com a resposta otimista já descontada) + etapas. */
  readonly pendingCount = computed(() => this.openQuestions().filter((q) => !this.pendingAnswers()[q.id]).length + this.stepActions().length);

  private readonly youByStep = computed(() => {
    const map = new Map<string, 'unblock' | 'turn'>();
    for (const a of this.userActions()) {
      if (!a.stepKey || a.type === 'question') continue;
      map.set(a.stepKey, a.type === 'unblock' ? 'unblock' : 'turn');
    }
    return map;
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
  /** 0036: resposta enviada e ainda sem confirmação do servidor (id da pergunta → texto) — a tela já mostra a escolha. */
  readonly pendingAnswers = signal<Record<string, string>>({});
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

  // ── 0039: fila de execução (rodar a skill pela tela, sem terminal) ─────────────────────────────

  /** Pedido ativo do card, últimos pedidos e as máquinas de quem está vendo. */
  readonly queue = signal<ExecutionCardQueue | null>(null);
  readonly activeRequest = computed(() => this.queue()?.active ?? null);
  readonly myWorkers = computed(() => this.queue()?.myWorkers ?? []);
  readonly hasWorkers = computed(() => this.myWorkers().length > 0);
  /** Último pedido que terminou mal (mostra o motivo e "tentar de novo") — só se for o mais recente do card. */
  readonly failedRequest = computed(() => {
    if (this.activeRequest()) return null;
    const last = this.queue()?.recent?.[0];
    if (!last || !(last.status === 'failed' || last.status === 'expired')) return null;
    const plan = this.plan();
    // A skill andou depois da falha (outra sessão retomou): o aviso já não vale.
    if (plan?.lastActivityAt && last.finishedAt && Date.parse(plan.lastActivityAt) > Date.parse(last.finishedAt)) return null;
    return last;
  });
  readonly canAskClaude = computed(() => this.hasWorkers() && !this.activeRequest() && !this.pinnedPlanId());
  readonly askLabel = computed(() => this.plan() && this.isActive() ? 'Continuar com Claude' : 'Analisar com Claude');
  readonly askOpen = signal(false);
  readonly showRequestDetail = signal(false);
  askWorkerId: string | null = null;
  askNote = '';
  private queueSub?: Subscription;
  readonly agentInstallCommand = AGENT_INSTALL_COMMAND;
  readonly sourceLabel = REQUEST_SOURCE_LABEL;

  readonly resumeCommand = computed(() => `/analisar-bug ${this.loadedCard() ?? ''}`.trim());
  /** Terminal (0033): volta para a sessão do Claude que trabalhou no card (ou abre uma nova). */
  readonly terminalCommand = computed(() => `bash ~/.claude/skills/analisar-bug/scripts/prmake-card.sh ${this.loadedCard() ?? ''}`.trim());

  /** Consumo das sessões do Claude no plano (0033; 0044: partes da entrada, saída, total e custo num popover). */
  readonly planUsage = computed<TokenUsage | null>(() => {
    const u = this.plan()?.usage;
    if (!u || !u.turns) return null;
    const sessions = `${u.sessions} ${u.sessions === 1 ? 'sessão' : 'sessões'}`;
    return {
      freshInput: u.inputTokens,
      cacheRead: u.cacheReadTokens,
      cacheWrite: u.cacheWriteTokens,
      output: u.outputTokens,
      model: u.model,
      models: (u.models ?? []).map((m) => ({
        model: m.model, turns: m.turns, freshInput: m.inputTokens, cacheRead: m.cacheReadTokens,
        cacheWrite: m.cacheWriteTokens, output: m.outputTokens,
      })),
      turns: u.turns,
      title: 'Consumo do Claude neste plano',
      subtitle: `${sessions} · ${u.turns} respostas`,
      // 0055: de onde leu (engenharia reversa × base × código); sessões antigas ficam com o comparativo da 0045.
      reads: u.sources?.length ? { sources: u.sources, reverseShare: u.reverseShare, exploredFiles: u.exploredFiles ?? [] } : null,
      notes: [
        u.mcpCalls || u.scriptCalls ? `Chamadas ao PRMake: ${u.mcpCalls ?? 0} pelo MCP, ${u.scriptCalls ?? 0} pelo script.` : null,
        !u.sources?.length && (u.kbCalls != null || u.searchCalls != null)
          ? `Base Solvace: ${u.kbCalls ?? 0} ${u.kbCalls === 1 ? 'consulta' : 'consultas'} · buscas no código: ${u.searchCalls ?? 0}${!u.kbCalls && u.searchCalls ? ' (foi direto ao código, sem a base)' : ''}.`
          : null,
        u.updatedAt ? `Atualizado ${this.relativeTime(u.updatedAt)} (o executor manda o valor final quando a sessão termina).` : null,
      ],
    };
  });

  /**
   * Arquivos do plano sem as cópias de anexos de comentário (0032): versões antigas da skill baixavam os anexos
   * e os reenviavam como arquivos dela — mesmo conteúdo (sha256), outro número. Vale o anexo original.
   */
  private readonly planArtifacts = computed(() => {
    const plan = this.plan();
    const own = plan?.artifacts ?? [];
    const attached = new Set((plan?.notes ?? []).flatMap((n) => n.attachments).map((a) => a.sha256));
    return own.filter((a) => a.noteId || !attached.has(a.sha256));
  });

  // ── 0050: o que o Claude está fazendo agora ─────────────────────────────────────────────────────

  /** Atividade atual do pedido rodando (executor 1.0.8+); null na fila ou com executor antigo. */
  readonly liveActivity = computed(() => {
    const r = this.activeRequest();
    return r && r.status !== 'queued' ? r.currentActivity ?? null : null;
  });
  readonly recentActivities = computed(() => {
    const r = this.activeRequest();
    return r && r.status !== 'queued' ? r.recentActivities ?? [] : [];
  });
  readonly showActivityLog = signal(false);
  /** Minutos sem atividade nova com o processo vivo (a partir de 3) — "pode estar pensando". */
  readonly activityQuietMinutes = computed(() => {
    const a = this.liveActivity();
    if (!a) return 0;
    const min = Math.floor((this.now() + this.serverOffsetMs - Date.parse(a.at)) / 60_000);
    return min >= 3 ? min : 0;
  });

  /** "há 12 s" / "há 3 min" (a linha "agora" conta em segundos). */
  activityAge(at?: string | null): string {
    if (!at) return '';
    const sec = Math.max(0, Math.floor((this.now() + this.serverOffsetMs - Date.parse(at)) / 1000));
    if (isNaN(sec)) return '';
    if (sec < 60) return `há ${sec} s`;
    return `há ${Math.floor(sec / 60)} min`;
  }

  activityIcon(tool?: string | null): string {
    if (!tool) return 'bolt';
    if (tool === 'Read') return 'menu_book';
    if (tool === 'Grep' || tool === 'Glob') return 'search';
    if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') return 'edit';
    if (tool.startsWith('mcp__prmake__')) return 'checklist';
    if (tool === 'Task' || tool === 'Agent') return 'hub';
    return 'terminal';
  }

  // ── 0050: texto do chamado na etapa ─────────────────────────────────────────────────────────────

  /** Texto dos arquivos `ticket` por sha (título = 1ª linha, corpo = o resto). */
  readonly ticketTexts = signal<Record<string, { title: string; body: string } | 'loading' | 'error'>>({});

  ticketFile(key: string): ExecutionArtifact | undefined {
    return this.stepArtifacts(key).find((a) => a.kind === 'ticket');
  }

  ticketScripts(key: string): ExecutionArtifact[] {
    return this.stepArtifacts(key).filter((a) => a.kind === 'script');
  }

  ticketText(a: ExecutionArtifact): { title: string; body: string } | 'loading' | 'error' | undefined {
    return this.ticketTexts()[a.sha256];
  }

  private loadTicketTexts(artifacts: ExecutionArtifact[]): void {
    for (const a of artifacts.filter((x) => x.kind === 'ticket')) {
      if (this.ticketTexts()[a.sha256]) continue;
      this.ticketTexts.update((m) => ({ ...m, [a.sha256]: 'loading' }));
      this.api.content(a.planId, a.id).subscribe({
        next: (blob) =>
          blob.text().then((text) => {
            const lines = text.replace(/\r\n/g, '\n').split('\n');
            const first = lines.findIndex((l) => l.trim() !== '');
            const title = first < 0 ? '' : lines[first].replace(/^#+\s*/, '').replace(/^\*\*(.*)\*\*$/, '$1').trim();
            const body = lines.slice(first + 1).join('\n').trim();
            this.ticketTexts.update((m) => ({ ...m, [a.sha256]: { title, body } }));
          }),
        error: () => this.ticketTexts.update((m) => ({ ...m, [a.sha256]: 'error' }))
      });
    }
  }

  copyTicket(a: ExecutionArtifact, part: 'title' | 'body'): void {
    const t = this.ticketText(a);
    if (!t || typeof t === 'string') return;
    this.clipboard.copyFullDescriptionToClipboard(part === 'title' ? t.title : t.body);
  }

  downloadArtifact(a: ExecutionArtifact): void {
    this.api.content(a.planId, a.id).subscribe({
      next: (blob) => saveBlob(blob, a.name),
      error: () => this.snackBar.open(`Não foi possível baixar ${a.name}.`, 'Fechar', { duration: 6000 })
    });
  }

  readonly artifactCounts = computed(() => {
    const artifacts = this.planArtifacts();
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
  /** Arquivos do plano + anexos de comentários feitos no outro plano do card (0031) — tudo abre no visualizador do app. */
  private readonly artifactsSignal = computed(() => {
    const plan = this.plan();
    const own = this.planArtifacts();
    const ids = new Set(own.map((a) => a.id));
    const fromNotes = (plan?.notes ?? []).flatMap((n) => n.attachments).filter((a) => !ids.has(a.id));
    return [...own, ...fromNotes];
  });

  constructor() {
    this.narrowMedia.addEventListener('change', this.onNarrowChange);
    // Saiu da tela cheia (Esc, fundo, Voltar): a próxima abertura começa pela lista.
    effect(() => {
      if (!this.expanded()) this.closeMobileDetail();
    });
    // 0050: texto do chamado pronto para copiar na etapa (arquivos pequenos; carrega uma vez por versão).
    effect(() => this.loadTicketTexts(this.planArtifacts()));
    this.ws.startConnection();
    this.ws.on(EXECUTION_PLAN_EVENT, this.onRealtime);
    this.ws.on(PULLREQUEST_CARD_EVENT, this.onPullRequestsChanged);
    // A conexão voltou depois de cair: os eventos da queda se perderam — recarrega em silêncio.
    this.resyncSub = this.ws._resynced.subscribe(() => this.refresh());
    // 0050: com o Claude rodando, a linha "agora" conta em segundos; fora isso, 15 s bastam.
    let ticks = 0;
    this.clockTimer = setInterval(() => {
      ticks++;
      if (this.liveActivity() || ticks % 15 === 0) this.now.set(Date.now());
    }, 1_000);
    this.pollTimer = setInterval(() => {
      if ((this.isActive() || this.activeRequest()) && !document.hidden) this.refresh();
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
      this.queue.set(null);
      this.askOpen.set(false);
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

  private emitHeadline(plan: ExecutionPlan | null): void {
    if (!plan) { this.headline.emit(null); return; }
    const steps = plan.steps ?? [];
    const cancelled = steps.filter((s) => s.status === 'cancelled').length;
    this.headline.emit({
      phase: plan.phase ?? 'analysis',
      status: plan.status,
      done: steps.filter((s) => s.status === 'completed').length,
      total: steps.length - cancelled,
      waiting: steps.filter((s) => s.status === 'waiting').length,
      openQuestions: (plan.questions ?? []).filter((q) => q.status === 'open').length,
      userPending: isPlanActive(plan.status) ? (plan.userActions?.length ?? plan.userPending ?? 0) : 0
    });
  }

  private clear(): void {
    this.headline.emit(null);
    this.loadSub?.unsubscribe();
    this.logsSub?.unsubscribe();
    this.switchGroup(null);
    this.loadedCard.set(null);
    this.plan.set(null);
    this.queue.set(null);
    this.askOpen.set(false);
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

    this.loadQueue(card);
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
    this.emitHeadline(plan);

    if (!plan) return;
    // Primeira carga: abre o que depende do usuário (0037); senão, a etapa em andamento.
    if (!previous || previous.id !== plan.id) {
      const yours = isPlanActive(plan.status) ? (plan.userActions ?? []).find((a) => a.type !== 'question' && a.stepKey)?.stepKey : null;
      const current = (yours ? plan.steps.find((s) => s.key === yours) : null)
        ?? plan.steps.find((s) => s.status === 'running') ?? plan.steps.find((s) => s.status === 'waiting');
      this.selectedKey.set(current?.key ?? null);
      // Com pendência do usuário o aviso do topo é o mais importante: não rola para longe dele.
      if (!yours) this.scrollToStep(current?.key ?? null);
    } else if (this.selectedKey() && !plan.steps.some((s) => s.key === this.selectedKey())) {
      this.selectedKey.set(null);
    } else {
      // A etapa em andamento mudou e o usuário estava acompanhando a anterior: segue a skill.
      const prevRunning = previous.steps.find((s) => s.status === 'running')?.key ?? null;
      const nowRunning = plan.steps.find((s) => s.status === 'running')?.key ?? null;
      // No celular, com a etapa aberta em tela cheia, não troca o texto que o usuário está lendo.
      if (nowRunning && nowRunning !== prevRunning && !this.mobileDetail() && (this.selectedKey() === prevRunning || !this.selectedKey())) {
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
    // 0050: atividade nova do Claude — atualiza a linha "agora" sem refazer o GET do plano.
    if (payload.action === 'activity') {
      const q = this.queue();
      if (q?.active && q.active.id === payload.requestId) {
        this.queue.set({ ...q, active: { ...q.active, currentActivity: payload.activity ?? null, recentActivities: payload.recent ?? [] } });
        this.now.set(Date.now());
      } else {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => this.refresh(), REFRESH_DEBOUNCE_MS);
      }
      return;
    }
    // Vendo um plano antigo: só interessa se o evento é dele.
    const pinned = this.pinnedPlanId();
    if (pinned && payload.planId !== pinned) {
      this.loadHistory(card);
      return;
    }
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refresh(), REFRESH_DEBOUNCE_MS);
  };

  /** PR do card mudou (ex.: mesclado): o plano sincroniza as etapas de PR na próxima leitura — lê já. */
  private onPullRequestsChanged = (payload: any): void => {
    const card = payload?.cardNumber != null ? `${payload.cardNumber}`.trim() : null;
    if (!card || card !== this.loadedCard() || !this.plan()) return;
    if (!`${payload?.action ?? ''}`.startsWith('github-pr')) return;
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
      if (this.narrow()) this.openMobileDetail(step.key);
      else this.selectedKey.set(step.key);
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
    if (step.you === 'unblock') return `Aguardando você: ${step.statusReason ?? 'faça o que a etapa pede e clique em "Já resolvi"'}`;
    if (step.you === 'turn') return `Sua vez — ${step.status === 'running' ? 'conclua aqui quando terminar' : 'esta etapa é sua e já pode ser feita'}`;
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
      next: () => { this.busy.set(null); this.snackBar.open('Etapa concluída.', 'Ok', { duration: 3000 }); this.refresh(); this.userPending.refresh(); },
      error: (err) => { this.busy.set(null); this.snackBar.open(planApiError(err, 'Não foi possível concluir a etapa.'), 'Fechar', { duration: 8000 }); }
    });
  }

  /** "Já resolvi" (0037): a etapa travada volta a andar e a skill (pelo vigia) tenta de novo. */
  resolveStep(step: StepView): void {
    const plan = this.plan();
    if (!plan || this.busy()) return;
    this.busy.set('step');
    this.api.resolveStep(plan.id, step.key).subscribe({
      next: () => {
        this.busy.set(null);
        this.snackBar.open('Avisado — o Claude tenta de novo.', 'Ok', { duration: 4000 });
        this.refresh();
        this.userPending.refresh();
      },
      error: (err) => { this.busy.set(null); this.snackBar.open(planApiError(err, 'Não foi possível avisar o Claude.'), 'Fechar', { duration: 8000 }); }
    });
  }

  /** Texto de uma linha (sub-linha da etapa): sem marcação de markdown. */
  plain(text?: string | null): string {
    return (text ?? '').replace(/[`*_#>]/g, '').replace(/\s+/g, ' ').trim();
  }

  /** Ação da pendência no aviso do topo: a etapa correspondente (ou null se sumiu). */
  stepOf(action: ExecutionUserAction): StepView | null {
    return (action.stepKey && this.steps().find((s) => s.key === action.stepKey)) || null;
  }

  /** Abre a etapa e rola até ela (do aviso do topo). */
  goToStep(key: string | null | undefined): void {
    if (!key) return;
    if (this.expanded() && this.narrow()) {
      this.openMobileDetail(key);
      return;
    }
    this.selectedKey.set(key);
    this.scrollToStep(key, true);
  }

  /**
   * 0037: etapa da skill "em andamento" cujo último registro é um aviso/erro e nada novo chegou há 2 min — quase
   * sempre está parada esperando algo (ex.: permissão negada no Claude Code). Mostra o aviso na linha da etapa.
   */
  stalledWarning(step: StepView): string | null {
    if (step.view !== 'running' || step.executor === 'user') return null;
    const logs = this.logsFor(step.key);
    const last = logs[logs.length - 1];
    if (!last || (last.kind !== 'warning' && last.kind !== 'error')) return null;
    if (this.now() + this.serverOffsetMs - Date.parse(last.createdAt) < STALLED_WARNING_MS) return null;
    const line = last.message.split('\n').map((l) => l.replace(/[#*`>_]/g, '').trim()).find((l) => l.length > 0) ?? '';
    return line.length > 220 ? line.slice(0, 220) + '…' : line;
  }

  // ── Perguntas ───────────────────────────────────────────────────────────────────────────────

  /** Texto da opção escolhida (a resposta guarda só o rótulo). */
  answerDescription(question: ExecutionQuestion): string | null {
    return this.optionDescription(question, question.answer ?? '');
  }

  optionDescription(question: ExecutionQuestion, label: string): string | null {
    const key = label.trim().toLowerCase();
    return question.options.find((o) => o.label.trim().toLowerCase() === key)?.description ?? null;
  }

  setAnswerDraft(questionId: string, text: string): void {
    this.answerDrafts.update((d) => ({ ...d, [questionId]: text }));
  }

  /**
   * 0036: resposta otimista — a escolha aparece na hora ("Sua resposta: X · enviando…") e as opções somem; a
   * confirmação do servidor troca pela resposta gravada, sem esperar a recarga do plano. Erro: as opções voltam.
   * Não depende do `busy` geral (outra ação em andamento não pode engolir o clique).
   */
  answer(question: ExecutionQuestion, text: string): void {
    const plan = this.plan();
    const value = (text ?? '').trim();
    if (!plan || !value || question.status !== 'open' || this.pendingAnswers()[question.id]) return;
    this.pendingAnswers.update((p) => ({ ...p, [question.id]: value }));
    this.api.answer(plan.id, question.id, value).subscribe({
      next: (answered) => {
        this.patchQuestion(answered ?? { ...question, status: 'answered', answer: value, answeredVia: 'prmake', answeredAt: new Date().toISOString() });
        this.clearPending(question.id);
        this.answerDrafts.update((d) => { const { [question.id]: _, ...rest } = d; return rest; });
        this.refresh();
        this.userPending.refresh();
      },
      error: (err) => {
        this.clearPending(question.id);
        this.snackBar.open(planApiError(err, 'Não foi possível enviar a resposta — escolha de novo.'), 'Fechar', { duration: 8000 });
      }
    });
  }

  pendingAnswer(question: ExecutionQuestion): string | null {
    return question.status === 'open' ? this.pendingAnswers()[question.id] ?? null : null;
  }

  private clearPending(questionId: string): void {
    this.pendingAnswers.update((p) => { const { [questionId]: _, ...rest } = p; return rest; });
  }

  /** Aplica a pergunta confirmada no plano da tela (a recarga discreta traz o resto: etapa saindo de "aguardando"). */
  private patchQuestion(answered: ExecutionQuestion): void {
    const plan = this.plan();
    if (!plan) return;
    const updated = { ...plan, questions: (plan.questions ?? []).map((q) => (q.id === answered.id ? { ...q, ...answered } : q)) };
    this.plan.set(updated);
    this.emitHeadline(updated);
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
      ? `Plano liberado, mas a skill está sem sinal — retome no terminal: ${this.terminalCommand()}`
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

  /** Copia o comando de terminal que retoma a sessão do Claude deste card (0033). */
  copyTerminalCommand(): void {
    this.clipboard.copyFullDescriptionToClipboard(this.terminalCommand());
  }

  // ── 0039: fila de execução ─────────────────────────────────────────────────────────────────────

  private loadQueue(card: string): void {
    this.queueSub?.unsubscribe();
    this.queueSub = this.queueApi.card(card).subscribe({
      next: (q) => { if (this.loadedCard() === card) this.queue.set(q); },
      error: () => {}
    });
  }

  openAsk(): void {
    const workers = this.myWorkers();
    this.askWorkerId = workers.find((w) => w.online && w.status === 'active')?.id ?? null;
    this.askNote = '';
    this.askOpen.set(true);
  }

  /** "Analisar/Continuar com Claude": o executor da máquina escolhida roda a skill sem terminal. */
  confirmAsk(): void {
    const card = this.loadedCard();
    if (!card || this.busy()) return;
    this.busy.set('ask');
    this.queueApi.create(card, { targetWorkerId: this.askWorkerId, note: this.askNote }).subscribe({
      next: (r) => {
        this.busy.set(null);
        this.askOpen.set(false);
        this.applyRequest(r);
        const where = r.waitReason ? ` ${r.waitReason}.` : '';
        this.snackBar.open(`Pedido enviado para o Claude.${where}`, 'Ok', { duration: 6000 });
      },
      error: (err) => {
        this.busy.set(null);
        this.snackBar.open(planApiError(err, 'Não foi possível pedir para o Claude.'), 'Fechar', { duration: 8000 });
      }
    });
  }

  cancelRequest(r: ExecutionRequest): void {
    if (this.busy()) return;
    this.busy.set('request-cancel');
    this.queueApi.cancel(r.id).subscribe({
      next: (updated) => {
        this.busy.set(null);
        this.applyRequest(updated);
        this.snackBar.open(r.status === 'queued' ? 'Pedido cancelado.' : 'Pedido cancelado — o Claude é encerrado em instantes.', 'Ok', { duration: 5000 });
      },
      error: (err) => {
        this.busy.set(null);
        this.snackBar.open(planApiError(err, 'Não foi possível cancelar o pedido.'), 'Fechar', { duration: 8000 });
      }
    });
  }

  retryRequest(r: ExecutionRequest): void {
    if (this.busy()) return;
    this.busy.set('request-retry');
    this.queueApi.retry(r.id).subscribe({
      next: (updated) => { this.busy.set(null); this.applyRequest(updated); },
      error: (err) => {
        this.busy.set(null);
        this.snackBar.open(planApiError(err, 'Não foi possível pedir de novo.'), 'Fechar', { duration: 8000 });
      }
    });
  }

  forceRequest(r: ExecutionRequest): void {
    if (this.busy()) return;
    this.busy.set('request-force');
    this.queueApi.force(r.id).subscribe({
      next: (updated) => { this.busy.set(null); this.applyRequest(updated); },
      error: (err) => {
        this.busy.set(null);
        this.snackBar.open(planApiError(err, 'Não foi possível liberar o pedido.'), 'Fechar', { duration: 8000 });
      }
    });
  }

  /** 0049: o pedido espera mais comentários para retomar uma vez só — "Começar agora" não espera. */
  startNow(): void {
    const plan = this.plan();
    if (!plan || this.busy()) return;
    this.busy.set('request-now');
    this.api.requestResume(plan.id).subscribe({
      next: () => { this.busy.set(null); this.refresh(); },
      error: (err) => {
        this.busy.set(null);
        this.snackBar.open(planApiError(err, 'Não foi possível começar agora.'), 'Fechar', { duration: 8000 });
      }
    });
  }

  private applyRequest(r: ExecutionRequest): void {
    const q = this.queue() ?? { recent: [], myWorkers: [], ownerWorkers: [] };
    const recent = [r, ...q.recent.filter((x) => x.id !== r.id && x.id !== q.active?.id)];
    this.queue.set({ ...q, active: isRequestActive(r.status) ? r : null, recent: isRequestActive(r.status) ? q.recent : recent });
    const card = this.loadedCard();
    if (card) this.loadQueue(card);
  }

  /** Máquina do pedido (para "offline desde"). */
  requestWorker(r: ExecutionRequest): ExecutionWorker | null {
    const q = this.queue();
    const all = [...(q?.myWorkers ?? []), ...(q?.ownerWorkers ?? [])];
    return all.find((w) => w.id === (r.workerId ?? r.targetWorkerId)) ?? (all.length === 1 ? all[0] : null);
  }

  openExecutors(): void {
    this.dialog.open(ExecutorsDialogComponent, {
      width: '760px', maxWidth: '96vw', maxHeight: '92vh', panelClass: 'custom-dialog-container', autoFocus: false
    }).afterClosed().subscribe(() => this.refresh());
  }

  copyAgentInstall(): void {
    this.clipboard.copyFullDescriptionToClipboard(this.agentInstallCommand);
  }

  /** "Continuar sozinho" (0033): o vigia da máquina da sessão retoma a conversa em segundo plano. */
  requestResume(): void {
    if (this.hasWorkers()) {
      this.openAsk();
      return;
    }
    const plan = this.plan();
    if (!plan || this.busy()) return;
    this.busy.set('resume-request');
    this.api.requestResume(plan.id).subscribe({
      next: () => {
        this.busy.set(null);
        const host = plan.executor?.host ? ` em ${plan.executor.host}` : '';
        this.snackBar.open(`Pedido enviado — o vigia${host} retoma a sessão do Claude. Sem vigia ligado, use "Retomar no Claude".`, 'Ok', { duration: 8000 });
        this.refresh();
      },
      error: (err) => {
        this.busy.set(null);
        this.snackBar.open(planApiError(err, 'Não foi possível pedir para continuar.'), 'Fechar', { duration: 8000 });
      }
    });
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
    return this.planArtifacts().filter((a) => a.stepKey === key);
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

  /** `force`: pedido do usuário (ex.: "Ver a etapa"); sem ele, só rola se o usuário não estiver mexendo. */
  private scrollToStep(key: string | null, force = false): void {
    if (!key || (!force && this.userIsInteracting())) return;
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
    // Mexer no scrollTop durante o arrasto corta a rolagem do dedo (iOS).
    if (this.userIsInteracting()) return;
    setTimeout(() => {
      const panel = this.panelRef?.nativeElement;
      panel?.querySelectorAll<HTMLElement>('.plan-logs[data-follow]').forEach((box) => {
        // Só segue o fim se o usuário já estava no fim (não atrapalha quem rolou para ler).
        if (box.scrollHeight - box.scrollTop - box.clientHeight < 80) box.scrollTop = box.scrollHeight;
      });
    });
  }

  ngOnDestroy(): void {
    this.narrowMedia.removeEventListener('change', this.onNarrowChange);
    this.closeMobileDetail();
    this.fullscreen.destroy();
    this.loadSub?.unsubscribe();
    this.logsSub?.unsubscribe();
    this.resyncSub?.unsubscribe();
    this.queueSub?.unsubscribe();
    clearTimeout(this.refreshTimer);
    clearTimeout(this.flashTimer);
    clearInterval(this.pollTimer);
    clearInterval(this.clockTimer);
    if (this.currentGroup) this.ws.removeFromGroup(this.currentGroup);
    this.ws.off(EXECUTION_PLAN_EVENT, this.onRealtime);
    this.ws.off(PULLREQUEST_CARD_EVENT, this.onPullRequestsChanged);
  }
}
