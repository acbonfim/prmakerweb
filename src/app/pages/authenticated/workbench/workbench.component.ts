import {
  Component, DestroyRef, ElementRef, OnDestroy, OnInit, computed, effect, inject, signal, untracked, viewChild
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DomSanitizer } from '@angular/platform-browser';

import { environment } from '../../../../environments/environment';
import { CardAlertBarComponent } from '../../../components/card-alert-bar/card-alert-bar.component';
import { CardDetailsDialogComponent } from '../../../components/card-details-dialog/card-details-dialog.component';
import { CardFull } from '../../../components/card-details-dialog/card-full.model';
import { CardPanelComponent } from '../../../components/card-panel/card-panel.component';
import { CardTimelineComponent } from '../../../components/card-timeline/card-timeline.component';
import { CaseCompactComponent } from '../../../components/case-chat/case-compact.component';
import { ExecutionPlanComponent, PlanHeadline } from '../../../components/execution-plan/execution-plan.component';
import { isPlanActive } from '../../../components/execution-plan/execution-plan.model';
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
import { CaseChatStore } from '../../../services/case-chat-store.service';
import { planApiError } from '../../../services/execution-plan.service';
import { ExecutionQueueService } from '../../../services/execution-queue.service';
import { TabsService } from '../../../services/tabs.service';
import { WorkItemsService } from '../../../services/work-items.service';

/** Aba da coluna principal (desktop) — Itens de trabalho | Plano. */
export type WorkbenchMainTab = 'items' | 'plan';
/** Aba no celular (< 1024 px) — Itens | Plano | Especialista | Card. */
export type WorkbenchMobileTab = WorkbenchMainTab | 'chat' | 'card';
type CardState = 'idle' | 'loading' | 'found' | 'missing' | 'error';

const NARROW_QUERY = '(max-width: 1023.98px)';
const REPRO_FIELD = 'Microsoft.VSTS.TCM.ReproSteps';
const DESCRIPTION_FIELD = 'System.Description';
const ACCEPTANCE_FIELD = 'Microsoft.VSTS.Common.AcceptanceCriteria';

const PLAN_STATUS_LABEL: Record<string, string> = {
  pending: 'pendente', running: 'em andamento', paused: 'pausado', completed: 'concluído', failed: 'falhou', cancelled: 'cancelado'
};

/** Texto de um campo do DevOps (identidade → nome, sem o e-mail). */
function fieldText(card: CardFull | null, key: string): string {
  const v = card?.fields?.[key];
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return `${v.displayName ?? v.name ?? ''}`.trim();
  const s = `${v}`.trim();
  return s === '-' ? '' : s;
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
 */
@Component({
  selector: 'app-workbench',
  standalone: true,
  imports: [
    FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressSpinnerModule, MatTooltipModule,
    CardAlertBarComponent, CardPanelComponent, CardTimelineComponent, CaseCompactComponent, ExecutionPlanComponent,
    WorkItemListComponent, WorkbenchPrsComponent, CardHoursInsightComponent
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

  readonly cardType = computed(() => workItemTypeOf(fieldText(this.cardFull(), 'System.WorkItemType')));
  readonly typeIcon = computed(() => workItemTypeIcon(this.cardType()));
  readonly typeLabel = computed(() => workItemTypeLabel(this.cardType()));
  readonly title = computed(() => fieldText(this.cardFull(), 'System.Title'));
  readonly state = computed(() => fieldText(this.cardFull(), 'System.State'));
  readonly stateDone = computed(() => /closed|done|resolved|removed/i.test(this.state()));
  readonly areaPath = computed(() => fieldText(this.cardFull(), 'System.AreaPath'));
  readonly area = computed(() => this.areaPath().split('\\').filter(Boolean).pop() ?? '');
  readonly assigned = computed(() => fieldText(this.cardFull(), 'System.AssignedTo').replace(/\s*<.*>$/, ''));
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
  readonly cardTextOpen = signal(true);

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
  readonly showCardSide = computed(() => !this.narrow() || this.mobileTab() === 'card');

  /** Plano em tela (lido do próprio `app-execution-plan`, sem mudar o componente). */
  readonly currentPlan = computed(() => this.planCmp()?.plan() ?? null);
  readonly canCancelPlan = computed(() => {
    const p = this.currentPlan();
    return !!p && (isPlanActive(p.status) || p.status === 'failed');
  });
  readonly planChip = computed(() => {
    const h = this.planHeadline();
    if (!h) return null;
    const phase = h.phase === 'correction' ? 'Correção' : 'Análise';
    const status = PLAN_STATUS_LABEL[h.status] ?? h.status;
    const progress = h.total ? ` · ${h.done}/${h.total}` : '';
    const you = h.userPending ? ` · aguardando você (${h.userPending})` : h.openQuestions ? ` · ${h.openQuestions} pergunta(s)` : '';
    const tone = h.userPending ? 'warn' : h.status === 'failed' ? 'bad' : h.status === 'completed' ? 'ok' : isPlanActive(h.status as any) ? 'info' : 'muted';
    return { text: `${phase} ${status}${progress}${you}`, tone };
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

    // Busca o plano assim que o componente do plano existe (ele nasce junto com o corpo, depois do card).
    effect(() => {
      const cmp = this.planCmp();
      const card = this.card();
      if (!cmp || !card || this.cardState() !== 'found') return;
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
      this.selectMobile('card');
      // Espera o card abrir (o corpo nasce depois da leitura do DevOps).
      const tryOpen = (left: number) => {
        const tl = this.timelineCmp();
        if (tl && this.cardState() === 'found') this.openTimeline(null);
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

  /** "Analisar bug" / "Analisar US": pede a análise pela fila (a API escolhe a skill pelo tipo do card). */
  analyze(): void {
    const card = this.card();
    if (!card || this.analyzing() || this.planActive()) return;
    this.analyzing.set(true);
    this.queueApi.create(card, { kind: 'analyze' }).subscribe({
      next: (r) => {
        this.analyzing.set(false);
        const where = r.waitReason ? ` ${r.waitReason}.` : '';
        this.snack.open(`Análise pedida para o Claude.${where}`, 'Ok', { duration: 6000 });
        this.selectMain('plan');
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
