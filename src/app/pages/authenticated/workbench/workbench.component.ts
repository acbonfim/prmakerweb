import {
  Component, DestroyRef, ElementRef, OnDestroy, OnInit, computed, effect, inject, signal, untracked, viewChild
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NgTemplateOutlet } from '@angular/common';
import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
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
import { WorkbenchPrsComponent } from '../../../components/workbench-prs/workbench-prs.component';
import { CardHoursInsightComponent } from '../../../components/card-hours-insight/card-hours-insight.component';
import { WorkItemListComponent } from '../../../components/work-items/work-item-list.component';
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

/** Aba da coluna principal (desktop) — Itens de trabalho | Plano. */
export type WorkbenchMainTab = 'items' | 'plan';
/** Aba no celular (< 1024 px) — Itens | Plano | Especialista | Card. */
export type WorkbenchMobileTab = WorkbenchMainTab | 'chat' | 'card';
type CardState = 'idle' | 'loading' | 'found' | 'missing' | 'error';
/** Corpo da Bancada visível: card lido, ou DevOps indisponível (os dados do PRMake continuam úteis). */
const BODY_STATES: ReadonlySet<CardState> = new Set<CardState>(['found', 'error']);

const NARROW_QUERY = '(max-width: 1023.98px)';
const REPRO_FIELD = 'Microsoft.VSTS.TCM.ReproSteps';
const DESCRIPTION_FIELD = 'System.Description';
const ACCEPTANCE_FIELD = 'Microsoft.VSTS.Common.AcceptanceCriteria';

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
 * da tela de PR). Desktop: coluna principal (Itens | Plano) + coluna lateral; celular: abas Itens | Plano |
 * Especialista | Card. URL: `?card=` (+ `item=`, `focus=plan|items|timeline|chat`).
 *
 * Ajustes (0085): como na tela de PR — barra de etiquetas do card (`app-pr-info-card`), timeline num botão (tela
 * cheia), lateral só do Especialista; horas + texto do card num botão "Card" (popover; no celular, a aba Card);
 * robô do Claude e perda de conexão no cabeçalho; situação/sugestões e a sugestão de análise inicial na aba Itens.
 */
@Component({
  selector: 'app-workbench',
  standalone: true,
  imports: [
    FormsModule, NgTemplateOutlet, CdkConnectedOverlay, CdkOverlayOrigin, MatButtonModule, MatFormFieldModule, MatIconModule,
    MatInputModule, MatMenuModule, MatProgressSpinnerModule, MatTooltipModule,
    CardAlertBarComponent, CardTimelineComponent, CaseCompactComponent, ExecutionPlanComponent, PrInfoCardComponent,
    CardSituationComponent, CardAssistantComponent, WorkItemListComponent, WorkbenchPrsComponent, CardHoursInsightComponent
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

  /** Texto do card na coluna lateral: Repro Steps (Bug) ou Descrição + Critérios de aceite (US). */
  readonly cardSections = computed<{ title: string; html: string }[]>(() => {
    const card = this.cardFull();
    if (!card) return [];
    const html = (key: string) => {
      const v = card.fields?.[key];
      return typeof v === 'string' ? v.trim() : '';
    };
    const sections = this.cardType() === 'user-story'
      ? [{ title: 'Descrição', html: html(DESCRIPTION_FIELD) }, { title: 'Critérios de aceite', html: html(ACCEPTANCE_FIELD) }]
      : [{ title: 'Repro Steps', html: html(REPRO_FIELD) || html(DESCRIPTION_FIELD) }];
    return sections.filter((s) => !!s.html);
  });

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
  /** Popover "Card" (desktop): horas + texto do card. */
  readonly cardOpen = signal(false);
  readonly popPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -6 }
  ];

  // ── Itens × Plano ───────────────────────────────────────────────────────────────────────────
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

  /** Painel principal visível agora (no celular, nenhum quando a aba é Especialista/Card). */
  readonly visibleMain = computed<WorkbenchMainTab | null>(() => {
    if (!this.narrow()) return this.mainTab();
    const t = this.mobileTab();
    return t === 'items' || t === 'plan' ? t : null;
  });
  readonly showChat = computed(() => !this.narrow() || this.mobileTab() === 'chat');
  /** Aba "Card" do celular (horas + texto do card); no desktop é o popover do botão "Card". */
  readonly showCardTab = computed(() => this.narrow() && this.mobileTab() === 'card');

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

    // Busca o plano assim que o componente do plano existe (ele nasce junto com o corpo, depois do card).
    effect(() => {
      const cmp = this.planCmp();
      const card = this.card();
      if (!cmp || !card || !this.hasBody()) return;
      untracked(() => { if (cmp.loadedCard() !== card) cmp.load(card); });
    });

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
    if (card && Number.isFinite(item) && item > 0) {
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
      this.executingItems.set([]);
      this.cardOpen.set(false);
      this.prCount.set(null);
      this.planHeadline.set(null);
      this.pickedTab.set(null);
      this.pickedMobileTab.set(null);
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
    if (tab === 'items' || tab === 'plan') this.pickedTab.set(tab);
    this.pickedMobileTab.set(tab);
  }

  onCountChange(n: number): void {
    this.itemCount.set(n);
  }

  onHeadline(h: PlanHeadline | null): void {
    this.planHeadline.set(h);
  }

  private applyFocus(focus: string): void {
    if (focus === 'items' || focus === 'plan') {
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

  /** Botão "Card": popover no desktop; no celular, a aba Card. */
  toggleCard(): void {
    if (this.narrow()) {
      this.selectMobile('card');
      return;
    }
    this.cardOpen.set(!this.cardOpen());
  }

  onCardPopKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cardOpen.set(false);
    }
  }

  onExecuting(numbers: number[]): void {
    this.executingItems.set(numbers ?? []);
  }

  // ── Robô / conexão ──────────────────────────────────────────────────────────────────────────

  /** Clique no robô: abre o pedido do Claude no plano (popover do próprio plano) ou os itens em execução. */
  openRobot(): void {
    const robot = this.robot();
    if (robot.target === 'items') {
      this.selectMobile('items');
      return;
    }
    this.selectMobile('plan');
    if (this.claudeRequest()) {
      // O ícone do plano precisa estar visível para o popover se ancorar nele.
      setTimeout(() => this.planCmp()?.runOpen.set(true), 80);
    }
  }

  /** "Sem sinal do Claude": retomar pelo executor (o mesmo diálogo do plano). */
  resumeClaude(): void {
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

  /** `prepare: 'tab:<aba>'` — abre a aba do passo (no desktop só Itens/Plano mudam algo). */
  private prepareTourStep(step: TourStep): 'ready' | 'changed' | 'skip' {
    const tab = step.prepare?.startsWith('tab:') ? step.prepare.slice(4) as WorkbenchMobileTab : null;
    if (!tab) return 'ready';
    if (this.narrow()) {
      if (this.mobileTab() === tab) return 'ready';
      this.selectMobile(tab);
      return 'changed';
    }
    if ((tab === 'items' || tab === 'plan') && this.mainTab() !== tab) {
      this.selectMain(tab);
      return 'changed';
    }
    return 'ready';
  }
}
