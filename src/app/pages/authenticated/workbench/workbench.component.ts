import {
  Component, DestroyRef, ElementRef, OnDestroy, OnInit, computed, effect, inject, signal, untracked, viewChild
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DomSanitizer } from '@angular/platform-browser';

import { environment } from '../../../../environments/environment';
import { CardAlertBarComponent } from '../../../components/card-alert-bar/card-alert-bar.component';
import { CardDetailsDialogComponent } from '../../../components/card-details-dialog/card-details-dialog.component';
import { CardFull } from '../../../components/card-details-dialog/card-full.model';
import { CardAssistantComponent } from '../../../components/card-assistant/card-assistant.component';
import { CardHoursComponent } from '../../../components/card-assistant/card-hours.component';
import { bugInsight, hasNoEstimate, usInsight } from '../../../components/card-hours-insight/hours-insight';
import { CardSituationComponent } from '../../../components/card-situation/card-situation.component';
import { CardSituationService } from '../../../components/card-situation/card-situation.service';
import { CardTimelineComponent } from '../../../components/card-timeline/card-timeline.component';
import { CaseCompactComponent } from '../../../components/case-chat/case-compact.component';
import { ExecutionPlanComponent, PlanHeadline } from '../../../components/execution-plan/execution-plan.component';
import { isPlanActive } from '../../../components/execution-plan/execution-plan.model';
import { PrInfoCardComponent } from '../../../components/pr-info-card/pr-info-card.component';
import { GuidedTourService } from '../../../components/guided-tour/guided-tour.service';
import { TourHelpData, TourHelpDialogComponent, TourHelpResult } from '../../../components/guided-tour/tour-help-dialog.component';
import { TourHost, TourStep } from '../../../components/guided-tour/tour.model';
import { WORKBENCH_TOUR } from '../../../components/guided-tour/workbench.tour';
import {
  CancelWorkDialogComponent, CancelWorkDialogData, CancelWorkDialogResult
} from '../../../components/work-items/cancel-work-dialog.component';
import { workDialogConfig } from '../../../components/work-items/work-dialog-config';
import { WorkItemActionsService } from '../../../components/work-items/work-item-actions.service';
import { WorkItem, WorkItemStatus, formatWorkNumber, itemStatusLook } from '../../../components/work-items/work-item.model';
import { listenWorkItems } from '../../../components/work-items/work-items-live';
import { WorkbenchCardComponent } from '../../../components/workbench-card/workbench-card.component';
import { WorkbenchPrsComponent } from '../../../components/workbench-prs/workbench-prs.component';
import { WorkItemListComponent } from '../../../components/work-items/work-item-list.component';
import { SpecialistToolsComponent } from '../../../components/specialist-tools/specialist-tools.component';
import {
  registerWorkItemTypeIcons, workItemTypeIcon, workItemTypeLabel, workItemTypeOf
} from '../../../helpers/work-item-type-icons';
import { CardAssistantService, formatHours } from '../../../services/card-assistant.service';
import { CaseChatStore } from '../../../services/case-chat-store.service';
import { planApiError } from '../../../services/execution-plan.service';
import { ExecutionQueueService } from '../../../services/execution-queue.service';
import { TabsService } from '../../../services/tabs.service';
import { WorkItemsService } from '../../../services/work-items.service';
import { WsService } from '../../../services/ws.service';
import { cardFieldText, workbenchFacts } from './workbench-facts';

/** Itens com plano em andamento (o seletor da aba Execução abre neles por padrão). */
const ACTIVE_PLAN_ITEM: ReadonlySet<WorkItemStatus> = new Set<WorkItemStatus>(['queued', 'running', 'waiting', 'reverting']);
/** Item "fechado" (versão fechada): concluído, cancelado ou desfeito — mudar = criar outro item. */
const CLOSED_PLAN_ITEM: ReadonlySet<WorkItemStatus> = new Set<WorkItemStatus>(['completed', 'cancelled', 'reverted']);

/** Opção do seletor "Execução do item" (itens de trabalho que têm plano). */
export interface PlanItemOption {
  number: number;
  planId: string;
  title: string;
  status: WorkItemStatus;
  label: string;
  statusLabel: string;
  icon: string;
  color: string;
  spin: boolean;
}

/** Item padrão do seletor: o em andamento mais recente; sem nenhum, o mais recente. */
export function defaultPlanItem(items: readonly WorkItem[]): WorkItem | null {
  const withPlan = items.filter((i) => !!i.planId);
  const recent = (a: WorkItem, b: WorkItem) => (Date.parse(b.createdAt) - Date.parse(a.createdAt)) || (b.number - a.number);
  const active = withPlan.filter((i) => ACTIVE_PLAN_ITEM.has(i.status)).sort(recent);
  return active[0] ?? withPlan.slice().sort(recent)[0] ?? null;
}

/** Aba da coluna principal (desktop) — Itens de trabalho | Execução (plano do item) | Card. */
export type WorkbenchMainTab = 'items' | 'plan' | 'card';
/** Aba no celular (< 1024 px) — Itens | Plano | Especialista | Card. */
export type WorkbenchMobileTab = WorkbenchMainTab | 'chat' | 'card';
type CardState = 'idle' | 'loading' | 'found' | 'missing' | 'error';
/** Corpo da Bancada visível: card lido, ou DevOps indisponível (os dados do PRMake continuam úteis). */
const BODY_STATES: ReadonlySet<CardState> = new Set<CardState>(['found', 'error']);

const NARROW_QUERY = '(max-width: 1023.98px)';

/** Tempo real caído por mais que isto vira o ícone de "sem conexão" (evita piscar numa reconexão rápida). */
const WS_DOWN_AFTER_MS = 6000;

const fieldText = cardFieldText;

/** Estado do robô do cabeçalho (o mesmo indicador do cabeçalho do plano, visível em qualquer aba). */
export interface WorkbenchRobot {
  mode: 'running' | 'queued' | 'idle';
  icon: string;
  tooltip: string;
  /** Para onde o clique leva: o pedido do plano (abre o popover dele) ou os itens em execução. */
  target: 'plan' | 'items';
}

/** Link do card no DevOps: a API devolve a URL REST (`_apis/wit/workItems/N`); a tela abre `_workitems/edit/N`. */
export function devOpsWebUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /^(.*?)\/_apis\/wit\/workItems\/(\d+)/i.exec(url);
  return m ? `${m[1]}/_workitems/edit/${m[2]}` : url;
}

/**
 * 0085: Bancada do card — onde o card é trabalhado: itens de trabalho (com sub-tarefas), o plano do Claude, o
 * Especialista do caso, os PRs (com as ações do GitHub/DevOps), as horas, o texto do card e a timeline. Estado próprio em signals (não usa o `CardPrStateService`, que é
 * da tela de PR). Desktop: coluna principal (Itens | Plano | Card) + coluna lateral; celular: abas Itens | Plano |
 * Especialista | Card. URL: `?card=` (+ `item=`, `focus=plan|items|card|timeline|chat`).
 *
 * Ajustes (0085): como na tela de PR — barra de etiquetas do card (`app-pr-info-card`), timeline num botão (tela
 * cheia), lateral só do Especialista; robô do Claude e perda de conexão no cabeçalho; situação/sugestões e a sugestão
 * de análise inicial na aba Itens. A coluna principal tem a aba **Card** (`app-workbench-card`: horas + lançar horas,
 * dados, texto do card — o botão "Card" da barra abre essa aba; no celular, a aba Card) e a linha de horas do card
 * (`app-card-hours`) fica ao lado do segmentado Itens | Plano | Card.
 *
 * Rodada 3: a aba Plano virou **Execução** — o plano é por item de trabalho (a versão é o item analisado e refinado, sem
 * "Análise v1 / Correção v2"). Um seletor escolhe entre os itens que têm plano (padrão: o em andamento mais recente) e o
 * `app-execution-plan` recebe `[planId]` + `[hideVersions]`. Item fechado = aviso com "+ Novo item" / "Pedir ao
 * especialista". `?item=<n>&focus=plan` abre a aba já no plano daquele item.
 */
@Component({
  selector: 'app-workbench',
  standalone: true,
  imports: [
    FormsModule, OverlayModule, MatButtonModule, MatFormFieldModule, MatIconModule,
    MatInputModule, MatMenuModule, MatProgressSpinnerModule, MatTooltipModule,
    CardAlertBarComponent, CardTimelineComponent, CaseCompactComponent, ExecutionPlanComponent, PrInfoCardComponent,
    CardSituationComponent, CardAssistantComponent, CardHoursComponent, WorkItemListComponent, WorkbenchPrsComponent,
    WorkbenchCardComponent, SpecialistToolsComponent
  ],
  templateUrl: './workbench.component.html',
  styleUrl: './workbench.component.scss'
})
export class WorkbenchComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);
  private tabs = inject(TabsService);
  private tours = inject(GuidedTourService);
  private queueApi = inject(ExecutionQueueService);
  private workItems = inject(WorkItemsService);
  private caseStore = inject(CaseChatStore);
  private situations = inject(CardSituationService);
  private assistant = inject(CardAssistantService);
  private ws = inject(WsService);
  private actions = inject(WorkItemActionsService);
  private host = inject(ElementRef<HTMLElement>);
  /** Abas internas (0065): só a aba ativa mexe na URL e no nome da aba. */
  private tabScreen = this.tabs.bindScreen(inject(DestroyRef));

  private readonly planCmp = viewChild(ExecutionPlanComponent);
  private readonly timelineCmp = viewChild(CardTimelineComponent);

  /** Número digitado na busca. */
  query = '';
  /** Card aberto (buscado). */
  readonly card = signal<string | null>(null);
  readonly cardFull = signal<CardFull | null>(null);
  readonly cardState = signal<CardState>('idle');
  readonly hasBody = computed(() => BODY_STATES.has(this.cardState()));

  readonly cardType = computed(() => workItemTypeOf(fieldText(this.cardFull(), 'System.WorkItemType')));
  readonly typeIcon = computed(() => workItemTypeIcon(this.cardType()));
  readonly typeLabel = computed(() => workItemTypeLabel(this.cardType()));
  readonly title = computed(() => fieldText(this.cardFull(), 'System.Title'));
  readonly devOpsUrl = computed(() => devOpsWebUrl(this.cardFull()?.url));

  // ── Barra do card (etiquetas como na tela de PR) ────────────────────────────────────────────
  /** Quem abriu o card no DevOps e as datas (o lado esquerdo do `app-pr-info-card`). */
  readonly author = computed(() => {
    const cf = this.cardFull();
    if (!cf) return { name: '', label: this.cardState() === 'error' ? 'Card não lido no DevOps' : 'Aberto por', openedAt: null, updatedAt: null };
    const date = (key: string) => fieldText(cf, key) || null;
    return {
      name: fieldText(cf, 'System.CreatedBy').replace(/\s*<.*>$/, ''),
      label: 'Aberto no DevOps por',
      openedAt: date('System.CreatedDate'),
      updatedAt: date('System.ChangedDate')
    };
  });
  readonly facts = computed(() => {
    const c = this.card();
    return workbenchFacts({
      card: this.cardFull(),
      plan: this.planHeadline(),
      situation: c ? this.situations.situationOf(c)() : null
    });
  });

  // ── Horas do card (chip do botão "Card") ────────────────────────────────────────────────────
  private readonly effort = computed(() => {
    const c = this.card();
    return c ? this.assistant.effortOf(c)() : null;
  });
  /** "5h" (Bug: Completed) ou "5h / 8h" (US: realizado / planejado); null sem horas no DevOps. */
  readonly hoursChip = computed<{ text: string; tone: string; tooltip: string } | null>(() => {
    const e = this.effort()?.effort;
    if (!e || hasNoEstimate(e)) return null;
    if (this.cardType() === 'user-story') {
      const us = usInsight(e, null);
      if (!us) return null;
      const text = us.hasPlan ? `${formatHours(us.completed)} / ${formatHours(us.original)}` : formatHours(us.completed);
      const proj = us.projection === 'overrun' ? ` · projeção estoura ${formatHours(us.projectionDelta)}` : '';
      return { text, tone: us.tone, tooltip: `Realizado ${formatHours(us.completed)} · planejado ${formatHours(us.original)}${proj}` };
    }
    const bug = bugInsight(e, null);
    if (!bug) return null;
    return { text: formatHours(bug.completed), tone: 'neutral', tooltip: `Completed ${formatHours(bug.completed)} — abra para comparar com a média dos bugs` };
  });
  // ── Itens × Plano × Card ───────────────────────────────────────────────────────────────────────────
  /** Itens do card (null = a lista ainda não contou). */
  readonly itemCount = signal<number | null>(null);
  readonly planHeadline = signal<PlanHeadline | null>(null);
  /** Aba escolhida pela pessoa (ou pelo `?focus=`); sem escolha, vale a aba em evidência. */
  private readonly pickedTab = signal<WorkbenchMainTab | null>(null);
  /** Em evidência: Itens quando há itens; Plano em cards sem itens (antigos) que têm plano. */
  readonly autoTab = computed<WorkbenchMainTab>(() => {
    const n = this.itemCount();
    if (n && n > 0) return 'items';
    return this.planHeadline() ? 'plan' : 'items';
  });
  readonly mainTab = computed<WorkbenchMainTab>(() => this.pickedTab() ?? this.autoTab());
  private readonly pickedMobileTab = signal<WorkbenchMobileTab | null>(null);
  readonly mobileTab = computed<WorkbenchMobileTab>(() => this.pickedMobileTab() ?? this.mainTab());
  readonly narrow = signal(typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches);
  private readonly narrowMedia = typeof window !== 'undefined' ? window.matchMedia(NARROW_QUERY) : null;
  private readonly onNarrowChange = (e: MediaQueryListEvent) => this.narrow.set(e.matches);

  /** Painel principal visível agora (no celular, nenhum quando a aba é Especialista). */
  readonly visibleMain = computed<WorkbenchMainTab | null>(() => {
    if (!this.narrow()) return this.mainTab();
    const t = this.mobileTab();
    return t === 'chat' ? null : t;
  });
  readonly showChat = computed(() => !this.narrow() || this.mobileTab() === 'chat');

  /** Plano em tela (lido do próprio `app-execution-plan`, sem mudar o componente). */
  readonly currentPlan = computed(() => this.planCmp()?.plan() ?? null);
  readonly canCancelPlan = computed(() => {
    const p = this.currentPlan();
    return !!p && (isPlanActive(p.status) || p.status === 'failed');
  });
  readonly planActive = computed(() => {
    const h = this.planHeadline();
    return !!h && isPlanActive(h.status as any);
  });

  /** PRs do card (contados pelo `app-workbench-prs`). */
  readonly prCount = signal<number | null>(null);
  /** `?item=` repassado para a lista abrir o modal do item. */
  readonly openItem = signal<number | null>(null);
  readonly analyzing = signal(false);
  readonly cancelling = signal(false);
  readonly chatFlash = signal(false);
  /** Rodada 4: painel "Ferramentas do especialista" (sobre a coluna do especialista; tela cheia no celular). */
  readonly toolsOpen = signal(false);
  /** Ferramentas que se aplicam ao card (contagem do botão). */
  readonly toolCount = signal<number | null>(null);
  /** Aba do celular antes de abrir as ferramentas (fechar volta para ela). */
  private tabBeforeTools: WorkbenchMobileTab | null = null;

  // ── Execução do item (0085, rodada 3): a versão é o item de trabalho ────────────────────────
  /** Itens do card que têm plano (lidos aqui para o seletor; a lista de itens tem a sua própria leitura). */
  readonly planItems = signal<WorkItem[]>([]);
  /** Card cujos itens já foram lidos (o plano espera por eles para abrir direto no item certo). */
  private readonly planItemsCard = signal<string | null>(null);
  /** Item escolhido no seletor (ou por `?item=&focus=plan`); null = o padrão (em andamento / mais recente). */
  readonly pickedPlanItem = signal<number | null>(null);
  private stopPlanItems?: () => void;
  private planItemsSub?: Subscription;

  readonly planItemOptions = computed<PlanItemOption[]>(() => this.planItems()
    .filter((i) => !!i.planId)
    .sort((a, b) => b.number - a.number)
    .map((i) => {
      const look = itemStatusLook(i.status);
      const statusLabel = look.label.toLowerCase();
      return {
        number: i.number, planId: i.planId!, title: i.title, status: i.status, statusLabel,
        label: `${formatWorkNumber(i.number)} ${i.title} · ${statusLabel}`,
        icon: look.icon, color: look.color, spin: !!look.spin
      };
    }));
  readonly selectedPlanItem = computed<PlanItemOption | null>(() => {
    const options = this.planItemOptions();
    const picked = this.pickedPlanItem();
    const hit = picked != null ? options.find((o) => o.number === picked) : null;
    if (hit) return hit;
    const def = defaultPlanItem(this.planItems());
    return def ? options.find((o) => o.number === def.number) ?? null : null;
  });
  /** Plano mostrado na aba Execução (null = o plano atual do card, para cards sem itens com plano). */
  readonly selectedPlanId = computed(() => this.selectedPlanItem()?.planId ?? null);
  /** Item fechado em tela: a aba mostra o aviso "versão fechada" com Novo item / Pedir ao especialista. */
  readonly closedPlanItem = computed(() => {
    const it = this.selectedPlanItem();
    return it && CLOSED_PLAN_ITEM.has(it.status) ? it : null;
  });

  readonly caseUnread = computed(() => {
    const c = this.card();
    return c ? this.caseStore.status(c)().unread : 0;
  });

  // ── Robô do Claude + conexão (cabeçalho, qualquer aba) ──────────────────────────────────────
  /** Itens em execução agora (da lista de itens, `executingChange`). */
  readonly executingItems = signal<number[]>([]);
  /** Pedido do Claude na pista principal do card (lido do próprio `app-execution-plan`, sem buscar de novo). */
  readonly claudeRequest = computed(() => this.planCmp()?.activeRequest() ?? null);
  /** "Sem sinal do Claude há N min" (plano ativo sem atividade e sem pedido rodando) — o mesmo do cabeçalho do plano. */
  readonly claudeSilentMinutes = computed(() => {
    const cmp = this.planCmp();
    return cmp && !cmp.activeRequest() ? cmp.staleMinutes() : null;
  });
  readonly canAskClaude = computed(() => !!this.planCmp()?.canAskClaude());
  readonly askLabel = computed(() => this.planCmp()?.askLabel() ?? 'Analisar com Claude');
  readonly robot = computed<WorkbenchRobot>(() => {
    const cmp = this.planCmp();
    const r = this.claudeRequest();
    const items = this.executingItems();
    const itemsText = items.length === 1 ? `o item #${items[0]}` : `${items.length} itens`;
    if (r && r.status !== 'queued') {
      return { mode: 'running', icon: 'smart_toy', target: 'plan',
        tooltip: (cmp?.runTooltip() ?? 'Claude rodando') + (items.length ? ` · executando ${itemsText}` : '') };
    }
    if (items.length) return { mode: 'running', icon: 'smart_toy', target: 'items', tooltip: `Claude executando ${itemsText} (clique para ver)` };
    if (r) return { mode: 'queued', icon: 'hourglass_top', target: 'plan', tooltip: cmp?.runTooltip() ?? 'Na fila do Claude' };
    const c = this.card();
    if (c && this.caseStore.status(c)().working) {
      return { mode: 'running', icon: 'smart_toy', target: 'plan', tooltip: 'O Especialista do caso está trabalhando numa resposta' };
    }
    return { mode: 'idle', icon: 'smart_toy', target: 'plan', tooltip: 'O Claude não está rodando agora neste card' };
  });
  /** Componente do plano (dados do pedido do Claude para o popover do robô da Bancada). */
  readonly runCmp = computed(() => this.planCmp() ?? null);
  /** Popover do robô do cabeçalho da Bancada (ancorado no próprio robô, não no ícone do plano). */
  readonly robotOpen = signal(false);
  readonly robotPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
    { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 6 },
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -6 }
  ];
  readonly specialistWorking = computed(() => {
    const c = this.card();
    return !!c && !!this.caseStore.status(c)().working;
  });

  /** Tempo real (SignalR) caído há mais de alguns segundos: a tela não atualiza sozinha. */
  readonly realtimeDown = signal(false);
  private wsTimer?: ReturnType<typeof setTimeout>;

  // ── Sugestão de análise inicial (card sem plano e sem itens) ────────────────────────────────
  /** Card em que a análise já foi pedida por esta tela (esconde a sugestão até o plano/item aparecer). */
  readonly analysisAskedFor = signal<string | null>(null);
  /** Plano já lido e vazio (sem plano, sem pedido na fila, sem erro). */
  private readonly planKnownEmpty = computed(() => {
    const cmp = this.planCmp();
    const card = this.card();
    if (!cmp || !card || cmp.loadedCard() !== card || cmp.isLoading() || cmp.loadError()) return false;
    return !cmp.plan() && !cmp.activeRequest();
  });
  readonly suggestAnalysis = computed(() =>
    this.cardState() === 'found' && this.itemCount() === 0 && this.planKnownEmpty() && !this.analyzing()
    && this.analysisAskedFor() !== this.card());
  /** Análise pedida aqui e ainda sem plano/itens: "o item aparece quando o Claude começar". */
  readonly analysisWaiting = computed(() =>
    this.analysisAskedFor() === this.card() && this.itemCount() === 0 && !this.planCmp()?.plan());

  private cardSub?: Subscription;
  private querySub?: Subscription;
  private flashTimer?: ReturnType<typeof setTimeout>;

  readonly tourHost: TourHost = {
    hasCard: () => this.cardState() === 'found' && !!document.querySelector('[data-tour="wb-card"]'),
    prepare: (step: TourStep) => this.prepareTourStep(step)
  };

  constructor() {
    registerWorkItemTypeIcons(inject(MatIconRegistry), inject(DomSanitizer));
    this.narrowMedia?.addEventListener('change', this.onNarrowChange);

    // Tempo real: o ícone de "sem conexão" só aparece se a queda durar (uma reconexão rápida não pisca).
    const wsSub = this.ws._wsOn.subscribe((on: boolean) => this.onRealtime(on));
    if (!this.ws.isConnected()) this.onRealtime(false);
    inject(DestroyRef).onDestroy(() => wsSub.unsubscribe());

    // Horas do card (chip do botão "Card"): acompanha o card aberto e busca as horas se ainda não vieram.
    let watchedHours: string | null = null;
    effect(() => {
      const card = this.cardState() === 'found' ? this.card() : null;
      untracked(() => {
        if (card === watchedHours) return;
        if (watchedHours) this.assistant.unwatch(watchedHours);
        watchedHours = card;
        if (!card) return;
        this.assistant.watch(card);
        const st = this.assistant.effortOf(card)();
        if (!st || st.status === 'error') void this.assistant.loadEffort(card).catch(() => undefined);
      });
    });
    inject(DestroyRef).onDestroy(() => { if (watchedHours) this.assistant.unwatch(watchedHours); });

    // Busca o plano assim que o componente do plano existe (ele nasce junto com o corpo, depois do card) e os itens
    // do card foram lidos — assim a aba Execução abre direto no plano do item (sem passar pelo plano atual do card).
    effect(() => {
      const cmp = this.planCmp();
      const card = this.card();
      if (!cmp || !card || !this.hasBody() || this.planItemsCard() !== card) return;
      untracked(() => {
        if (cmp.loadedCard() === card) return;
        cmp.planId = this.selectedPlanId();
        cmp.load(card);
      });
    });

    // Itens com plano (seletor da aba Execução): lê ao abrir o card e acompanha o tempo real dos itens.
    effect(() => {
      const card = this.hasBody() ? this.card() : null;
      untracked(() => this.watchPlanItems(card));
    });
    inject(DestroyRef).onDestroy(() => { this.stopPlanItems?.(); this.planItemsSub?.unsubscribe(); });

    // Nome/status da aba (0065): a aba de card já mostra número e título; aqui só a contagem de itens.
    effect(() => {
      if (!this.tabScreen.active()) return;
      const n = this.itemCount();
      const status = n ? { text: `${n} ${n === 1 ? 'item' : 'itens'} de trabalho`, tone: 'info' as const } : null;
      untracked(() => this.tabs.setMeta(this.tabScreen.tabId(), { label: null, status }));
    });

    // Card aberto: o tour continua/começa com os passos do card.
    effect(() => {
      if (this.cardState() === 'found' && this.tabScreen.active()) {
        untracked(() => this.tours.cardReady(WORKBENCH_TOUR, this.tourHost));
      }
    });
  }

  ngOnInit(): void {
    // Emite já na entrada; depois, a URL muda com a tela aberta (link de outro lugar, Voltar): abre o card novo.
    this.querySub = this.route.queryParamMap.subscribe(() => this.applyQuery());
    if (!this.route.snapshot.queryParamMap.get('card')) {
      setTimeout(() => { if (this.tabScreen.active()) this.tours.autoStart(WORKBENCH_TOUR, this.tourHost); }, 700);
    }
  }

  ngOnDestroy(): void {
    this.narrowMedia?.removeEventListener('change', this.onNarrowChange);
    this.stopPlanItems?.();
    this.cardSub?.unsubscribe();
    this.querySub?.unsubscribe();
    clearTimeout(this.flashTimer);
    clearTimeout(this.wsTimer);
    this.tours.stop(WORKBENCH_TOUR.id);
  }

  // ── Busca e URL ─────────────────────────────────────────────────────────────────────────────

  /** `?card=` (+ `item=`, `focus=`) — na entrada e quando a URL muda com a tela aberta. */
  private applyQuery(): void {
    const params = this.route.snapshot.queryParamMap;
    const card = params.get('card')?.trim() || null;
    const item = Number(params.get('item'));
    const focus = params.get('focus');
    if (card && card !== this.card()) {
      this.query = card;
      this.open(card, false);
    }
    const hasItem = !!card && Number.isFinite(item) && item > 0;
    if (hasItem && focus === 'plan') {
      // "Abrir plano" de um item: a aba Execução já no plano daquele item (sem abrir o modal do item).
      this.pickedPlanItem.set(item);
    } else if (hasItem) {
      this.openItem.set(item);
      this.selectMobile('items');
    }
    if (card && focus) this.applyFocus(focus);
  }

  /** Enter / lupa. */
  search(): void {
    const card = `${this.query ?? ''}`.trim().replace(/^#/, '');
    if (!/^\d+$/.test(card)) {
      this.snack.open('Digite o número do card (só números).', 'Ok', { duration: 4000 });
      return;
    }
    this.openItem.set(null);
    this.open(card, true, true);
  }

  /** Abre o card (lê no DevOps; o corpo aparece quando o card existe). */
  private open(card: string, syncUrl: boolean, force = false): void {
    if (!force && card === this.card() && this.cardState() !== 'error') return;
    if (card !== this.card()) {
      this.itemCount.set(null);
      this.toolsOpen.set(false);
      this.toolCount.set(null);
      this.executingItems.set([]);
      this.prCount.set(null);
      this.planHeadline.set(null);
      this.pickedTab.set(null);
      this.pickedMobileTab.set(null);
      this.planItems.set([]);
      this.planItemsCard.set(null);
      this.pickedPlanItem.set(null);
    }
    this.card.set(card);
    if (syncUrl) this.syncUrl(card);
    this.loadCard(card);
  }

  reload(): void {
    const c = this.card();
    if (c) this.loadCard(c);
  }

  private loadCard(card: string): void {
    this.cardSub?.unsubscribe();
    const keepBody = this.cardState() === 'found' && this.cardFull()?.id === Number(card);
    if (!keepBody) {
      this.cardFull.set(null);
      this.cardState.set('loading');
    }
    this.cardSub = this.http.get<CardFull>(`${environment.apiUrl}Azure/card/${encodeURIComponent(card)}/full`).subscribe({
      next: (res) => {
        if (this.card() !== card) return;
        // O backend responde 200 com { error } quando o card não existe no DevOps.
        const found = !!res && !res.error && !!res.id;
        this.cardFull.set(found ? res : null);
        this.cardState.set(found ? 'found' : 'missing');
        if (found) this.planCmp()?.refresh();
      },
      error: () => {
        if (this.card() !== card) return;
        this.cardFull.set(null);
        this.cardState.set('error');
      }
    });
  }

  /** Leva o card para a URL (?card=) sem empilhar histórico; mantém item/focus só se forem do mesmo card. */
  private syncUrl(card: string | null): void {
    if (!this.tabScreen.active()) return;
    if ((card || null) === (this.route.snapshot.queryParamMap.get('card') || null)) return;
    void this.router.navigate([], { relativeTo: this.route, queryParams: card ? { card } : {}, replaceUrl: true });
  }

  // ── Abas ────────────────────────────────────────────────────────────────────────────────────

  selectMain(tab: WorkbenchMainTab): void {
    this.pickedTab.set(tab);
    this.pickedMobileTab.set(null);
  }

  selectMobile(tab: WorkbenchMobileTab): void {
    if (tab !== 'chat') this.pickedTab.set(tab);
    this.pickedMobileTab.set(tab);
  }

  // ── Execução do item ────────────────────────────────────────────────────────────────────────

  /** Lê os itens do card (os que têm plano entram no seletor) e recarrega a cada mudança dos itens no tempo real. */
  private watchPlanItems(card: string | null): void {
    this.stopPlanItems?.();
    this.stopPlanItems = undefined;
    this.planItemsSub?.unsubscribe();
    if (!card) return;
    this.loadPlanItems(card);
    this.stopPlanItems = listenWorkItems(this.ws, card, (payload) => {
      // Atividade ao vivo (heartbeat) não muda item nem status: não relê.
      if (payload?.action === 'activity') return;
      this.loadPlanItems(card);
    });
  }

  private loadPlanItems(card: string): void {
    this.planItemsSub?.unsubscribe();
    this.planItemsSub = this.workItems.list(card).subscribe({
      next: (items) => {
        if (this.card() !== card) return;
        this.planItems.set(items ?? []);
        this.planItemsCard.set(card);
      },
      // Sem itens (erro): a aba mostra o plano atual do card, como antes.
      error: () => { if (this.card() === card) this.planItemsCard.set(card); }
    });
  }

  /** Seletor "Execução do item". */
  pickPlanItem(number: number): void {
    this.pickedPlanItem.set(number);
  }

  /** "+ Novo item" do aviso de versão fechada: cria o item e mostra a lista. */
  async newItem(): Promise<void> {
    const card = this.card();
    if (!card) return;
    const saved = await this.actions.create(card, this.cardType());
    if (saved && this.card() === card) this.selectMobile('items');
  }

  /** "Pedir ao especialista" do aviso de versão fechada: o pedido vai para a conversa do caso (lateral). */
  async askSpecialistForItem(): Promise<void> {
    const card = this.card();
    if (!card) return;
    const sent = await this.actions.askSpecialist(card, this.cardType());
    if (!sent || this.card() !== card) return;
    if (this.narrow()) this.selectMobile('chat');
    this.flashChat();
  }

  // ── Ferramentas do especialista (rodada 4) ────────────────────────────────────────────────────

  /** Abre o painel de ferramentas; no celular ele cobre a tela (a aba do especialista fica por baixo). */
  openTools(): void {
    if (this.narrow()) {
      this.tabBeforeTools = this.mobileTab();
      if (this.mobileTab() !== 'chat') this.selectMobile('chat');
    }
    this.toolsOpen.set(true);
  }

  closeTools(restore = true): void {
    this.toolsOpen.set(false);
    if (restore && this.narrow() && this.tabBeforeTools && this.tabBeforeTools !== this.mobileTab()) this.selectMobile(this.tabBeforeTools);
    this.tabBeforeTools = null;
  }

  /** Item criado por uma ferramenta: fecha o painel, mostra a lista e abre o item. */
  onToolCreated(n: number): void {
    this.closeTools(false);
    this.selectMobile('items');
    this.openItem.set(null);
    queueMicrotask(() => this.openItem.set(n));
  }

  /** Pedido ao especialista enviado: fecha o painel e mostra a conversa. */
  onToolAsked(): void {
    this.closeTools(false);
    if (this.narrow()) this.selectMobile('chat');
    this.flashChat();
  }

  onCountChange(n: number): void {
    this.itemCount.set(n);
  }

  onHeadline(h: PlanHeadline | null): void {
    this.planHeadline.set(h);
  }

  private applyFocus(focus: string): void {
    if (focus === 'items' || focus === 'plan' || focus === 'card') {
      this.selectMobile(focus);
    } else if (focus === 'chat') {
      this.selectMobile('chat');
      this.flashChat();
    } else if (focus === 'timeline') {
      // Espera o card abrir (o corpo nasce depois da leitura do DevOps); abre a partir do botão "Linha do tempo".
      const tryOpen = (left: number) => {
        const tl = this.timelineCmp();
        if (tl && this.hasBody()) this.openTimeline(this.host.nativeElement.querySelector('[data-tour="wb-timeline-btn"]'));
        else if (left > 0) setTimeout(() => tryOpen(left - 1), 300);
      };
      setTimeout(() => tryOpen(20), 300);
    }
  }

  private flashChat(): void {
    clearTimeout(this.flashTimer);
    this.chatFlash.set(true);
    setTimeout(() => this.host.nativeElement.querySelector('.wb-chat')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 400);
    this.flashTimer = setTimeout(() => this.chatFlash.set(false), 2400);
  }

  openTimeline(origin: HTMLElement | null): void {
    this.timelineCmp()?.openFrom(origin);
  }

  /** Entradas da timeline (contador do botão). */
  readonly timelineCount = computed(() => this.timelineCmp()?.entries().length ?? 0);

  /** Botão "Card" da barra: abre a aba Card (horas, lançar horas, dados e texto do card). */
  showCard(): void {
    this.selectMobile('card');
  }

  onExecuting(numbers: number[]): void {
    this.executingItems.set(numbers ?? []);
  }

  // ── Robô / conexão ──────────────────────────────────────────────────────────────────────────

  /**
   * Clique no robô: os itens em execução (lista) ou o popover do pedido do Claude ancorado no próprio robô do cabeçalho
   * (máquina, desde, tentativa, pedido, agora, últimas atividades, Parar) — os dados vêm do componente do plano.
   */
  openRobot(): void {
    const robot = this.robot();
    if (robot.target === 'items') {
      this.robotOpen.set(false);
      this.selectMobile('items');
      return;
    }
    this.robotOpen.update((open) => !open);
  }

  onRobotKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.robotOpen.set(false);
    }
  }

  /** "Ver itens em execução" do popover do robô. */
  robotToItems(): void {
    this.robotOpen.set(false);
    this.selectMobile('items');
  }

  /** "Analisar/Continuar com Claude" do popover do robô: a barra de pedido do plano (aba Execução). */
  robotAsk(): void {
    this.robotOpen.set(false);
    this.resumeClaude();
  }

  robotExecutors(): void {
    this.robotOpen.set(false);
    this.planCmp()?.openExecutors();
  }

  /** "Sem sinal do Claude": retomar pelo executor (o mesmo diálogo do plano). */
  resumeClaude(): void {
    this.pickedPlanItem.set(null);
    this.selectMobile('plan');
    setTimeout(() => this.planCmp()?.openAsk(), 80);
  }

  copyTerminalCommand(): void {
    this.planCmp()?.copyTerminalCommand();
  }

  private onRealtime(on: boolean): void {
    clearTimeout(this.wsTimer);
    if (on) {
      this.realtimeDown.set(false);
      return;
    }
    this.wsTimer = setTimeout(() => this.realtimeDown.set(!this.ws.isConnected()), WS_DOWN_AFTER_MS);
  }

  /** Ícone "sem conexão": tenta reconectar e recarrega o que está na tela. */
  reconnect(): void {
    this.ws.startConnection();
    this.reload();
    this.planCmp()?.refresh();
    this.timelineCmp()?.load();
    this.snack.open('Reconectando o tempo real e recarregando a Bancada…', 'Ok', { duration: 4000 });
  }

  // ── Ações do cabeçalho ──────────────────────────────────────────────────────────────────────

  openDetails(): void {
    const card = this.cardFull();
    if (!card) return;
    this.dialog.open(CardDetailsDialogComponent, {
      data: { card, cardNumber: this.card() },
      width: '1000px',
      height: '80vh',
      maxWidth: '92vw',
      maxHeight: '90vh',
      panelClass: 'custom-dialog-container'
    });
  }

  /**
   * "Analisar bug" / "Analisar US": pede a análise pela fila (a API escolhe a skill pelo tipo do card).
   * `stay` (sugestão de análise inicial): fica na aba Itens — o item "Análise inicial…" aparece ali ao vivo.
   */
  analyze(stay = false): void {
    const card = this.card();
    if (!card || this.analyzing() || this.planActive()) return;
    this.analyzing.set(true);
    this.queueApi.create(card, { kind: 'analyze' }).subscribe({
      next: (r) => {
        this.analyzing.set(false);
        this.analysisAskedFor.set(card);
        // O item novo da análise vira o padrão do seletor assim que aparecer.
        this.pickedPlanItem.set(null);
        const where = r.waitReason ? ` ${r.waitReason}.` : '';
        this.snack.open(`Análise pedida para o Claude.${where}`, 'Ok', { duration: 6000 });
        if (!stay) this.selectMain('plan');
        this.planCmp()?.refresh();
      },
      error: (err) => {
        this.analyzing.set(false);
        this.snack.open(planApiError(err, 'Não foi possível pedir a análise.'), 'Fechar', { duration: 8000 });
      }
    });
  }

  /** "Cancelar e desfazer" do plano (ação da Bancada; o componente do plano não muda). */
  cancelPlan(): void {
    const plan = this.currentPlan();
    if (!plan || this.cancelling()) return;
    const data: CancelWorkDialogData = { kind: 'plan', title: plan.title, planId: plan.id };
    this.dialog.open<CancelWorkDialogComponent, CancelWorkDialogData, CancelWorkDialogResult>(
      CancelWorkDialogComponent, workDialogConfig(data, '520px')
    ).afterClosed().subscribe((result) => {
      if (!result) return;
      this.cancelling.set(true);
      this.workItems.cancelPlan(plan.id, result.undo, result.reason).subscribe({
        next: () => {
          this.cancelling.set(false);
          this.snack.open(result.undo ? 'Plano cancelado — o desfazer foi para a fila.' : 'Plano cancelado.', 'Ok', { duration: 6000 });
          this.planCmp()?.refresh();
        },
        error: (err: Error) => {
          this.cancelling.set(false);
          this.snack.open(err?.message || 'Não foi possível cancelar o plano.', 'Fechar', { duration: 8000 });
        }
      });
    });
  }

  // ── Tour ────────────────────────────────────────────────────────────────────────────────────

  openHelp(): void {
    const data: TourHelpData = { tour: WORKBENCH_TOUR, hasCard: !!this.tourHost.hasCard?.(), host: this.tourHost };
    this.dialog.open<TourHelpDialogComponent, TourHelpData, TourHelpResult>(TourHelpDialogComponent, {
      data, width: '760px', maxWidth: '96vw', autoFocus: false
    }).afterClosed().subscribe((r) => {
      if (!r) return;
      setTimeout(() => this.tours.start(WORKBENCH_TOUR, this.tourHost, 'from' in r ? r.from : undefined), 250);
    });
  }

  /** `prepare: 'tab:<aba>'` — abre a aba do passo (no desktop só Itens/Plano/Card mudam algo). */
  private prepareTourStep(step: TourStep): 'ready' | 'changed' | 'skip' {
    const tab = step.prepare?.startsWith('tab:') ? step.prepare.slice(4) as WorkbenchMobileTab : null;
    if (!tab) return 'ready';
    if (this.narrow()) {
      if (this.mobileTab() === tab) return 'ready';
      this.selectMobile(tab);
      return 'changed';
    }
    if (tab !== 'chat' && this.mainTab() !== tab) {
      this.selectMain(tab);
      return 'changed';
    }
    return 'ready';
  }
}
