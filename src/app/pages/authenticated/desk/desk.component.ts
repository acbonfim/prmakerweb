import { Component, DestroyRef, ElementRef, OnDestroy, OnInit, TemplateRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';

import { CardFilesComponent } from '../../../components/card-files/card-files.component';
import { CaseCompactComponent } from '../../../components/case-chat/case-compact.component';
import { DevOpsBoardComponent } from '../../../components/devops/devops-board.component';
import { DevOpsCardPanelComponent } from '../../../components/devops/devops-card-panel.component';
import { openDevOpsCardCreate } from '../../../components/devops/devops-card-create';
import { openEpicDialog } from '../../../components/epics/epic-dialog.component';
import { EpicStoriesComponent } from '../../../components/epics/epic-stories.component';
import { EpicMonitorComponent } from '../../../components/epics/epic-monitor.component';
import { CardsView, defaultCardsView } from '../../../components/epics/epic-monitor.logic';
import {
  DeskTab, EPIC_STATUSES, EPIC_STATUS_FILTERS, Epic, EpicCard, EpicStatus, EpicStatusFilter, EpicSummary,
  countByStatusFilter, devOpsTypeColor, epicCardRoleLook, epicColor, epicKey, epicStatusLook, filterEpics, parseCardId,
  parseDeskTab, parseEpicKey, parseEpicNumber, sortEpicCards
} from '../../../components/epics/epic.logic';
import { PlanMarkdownPipe } from '../../../components/execution-plan/plan-markdown.pipe';
import { DESK_TOUR } from '../../../components/guided-tour/desk.tour';
import { GuidedTourService } from '../../../components/guided-tour/guided-tour.service';
import { TourHelpData, TourHelpDialogComponent, TourHelpResult } from '../../../components/guided-tour/tour-help-dialog.component';
import { TourHost, TourStep } from '../../../components/guided-tour/tour.model';
import { CardFilesStore } from '../../../components/work-items/card-files.store';
import { WorkItemListComponent } from '../../../components/work-items/work-item-list.component';
import { WorkItem } from '../../../components/work-items/work-item.model';
import { listenWorkItems } from '../../../components/work-items/work-items-live';
import { CaseChatStore } from '../../../services/case-chat-store.service';
import { EpicCardLive, EpicsService, epicApiError } from '../../../services/epics.service';
import { RoleService } from '../../../services/role.service';
import { TabsService } from '../../../services/tabs.service';
import { WorkItemsService } from '../../../services/work-items.service';
import { WsService } from '../../../services/ws.service';

/** Aba no celular (< 1024 px): as da coluna principal + Épicos (o trilho) + Especialista. */
export type DeskMobileTab = DeskTab | 'rail' | 'chat';
type EpicState = 'idle' | 'loading' | 'found' | 'missing' | 'error';

const NARROW_QUERY = '(max-width: 1023.98px)';
const CHAT_COLLAPSED_KEY = 'dk.chat.collapsed';
const RAIL_COLLAPSED_KEY = 'dk.rail.collapsed';
const RAIL_MINE_KEY = 'dk.rail.mine';
const RAIL_STATUS_KEY = 'dk.rail.status';
const BOARD_SCOPE_KEY = 'dk.board.scope';
const CARDS_VIEW_KEY = 'dk.cards.view';
/** Duração da animação de recolher/mostrar a lateral (igual à transição no scss). */
const SLIDE_MS = 320;

function readText(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeText(key: string, value: string | null): void {
  try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch { /* sem armazenamento: vale só nesta sessão */ }
}

const readFlag = (key: string) => readText(key) === '1';
const writeFlag = (key: string, on: boolean) => writeText(key, on ? '1' : null);

/**
 * 0099: **Mesa de gestão** — par da Bancada, onde se *gere*: épicos (temas de trabalho do PRMake, não o Epic do DevOps)
 * com as tarefas de gestão (itens de trabalho de relatório, duplicados, entendimento, RCA, gestão de cards…), os cards
 * do DevOps do épico, o board do time, os arquivos, os relatados e o Especialista de gestão.
 *
 * Layout (desktop): trilho de épicos à esquerda (busca, meus/todos, status, "+ Novo épico", recolhível), cabeçalho do
 * épico, abas `Board | Histórias | Itens | Cards | Arquivos | Relatado` e a lateral do Especialista (`app-case-compact` com a chave
 * `E{n}` e `cardType='epic'`, recolhível como na Bancada). A busca de card no topo abre o painel do card do DevOps (com
 * ou sem épico). Celular (< 1024): abas Épicos | Board | Histórias | Itens | Cards | Arquivos | Relatado | Especialista.
 *
 * A chave `E{n}` é o "card" dos componentes da Bancada (itens, conversa, arquivos, relatados, tempo real) — eles
 * funcionam sem mudança. URL: `?epic=<n>&card=<id>&item=<n>&tab=board|stories|items|cards|files|reported`.
 */
@Component({
  selector: 'app-desk',
  standalone: true,
  imports: [
    DatePipe, FormsModule, MatButtonModule, MatIconModule, MatMenuModule, MatProgressSpinnerModule, MatTooltipModule,
    PlanMarkdownPipe, CaseCompactComponent, WorkItemListComponent, CardFilesComponent, DevOpsBoardComponent, DevOpsCardPanelComponent,
    EpicStoriesComponent, EpicMonitorComponent
  ],
  templateUrl: './desk.component.html',
  styleUrl: './desk.component.scss'
})
export class DeskComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);
  private api = inject(EpicsService);
  private workItems = inject(WorkItemsService);
  private ws = inject(WsService);
  private caseStore = inject(CaseChatStore);
  private tabs = inject(TabsService);
  private tours = inject(GuidedTourService);
  private host = inject(ElementRef<HTMLElement>);
  private tabScreen = this.tabs.bindScreen(inject(DestroyRef));

  readonly statusFilters = EPIC_STATUS_FILTERS;
  readonly statuses = EPIC_STATUSES;

  // ── Trilho de épicos ────────────────────────────────────────────────────────────────────────
  readonly epics = signal<EpicSummary[]>([]);
  readonly railLoading = signal(false);
  readonly railLoaded = signal(false);
  readonly railError = signal<string | null>(null);
  readonly railQuery = signal('');
  readonly railMine = signal(readFlag(RAIL_MINE_KEY));
  readonly railStatus = signal<EpicStatusFilter>(
    (EPIC_STATUS_FILTERS.some((f) => f.key === readText(RAIL_STATUS_KEY)) ? readText(RAIL_STATUS_KEY) : 'open') as EpicStatusFilter);
  readonly railCollapsed = signal(readFlag(RAIL_COLLAPSED_KEY));
  readonly visibleEpics = computed(() => filterEpics(this.epics(), this.railQuery(), this.railStatus()));
  readonly statusCounts = computed(() => countByStatusFilter(this.epics(), this.railQuery()));
  private listSub?: Subscription;

  // ── Épico aberto ────────────────────────────────────────────────────────────────────────────
  readonly epicNumber = signal<number | null>(null);
  readonly epic = signal<Epic | null>(null);
  readonly epicState = signal<EpicState>('idle');
  /** Chave do dono (`E{n}`) com o épico lido — é o "card" da lista de itens, da conversa, dos arquivos e dos relatados. */
  readonly key = computed(() => (this.epicState() === 'found' ? epicKey(this.epicNumber()) : null));
  readonly epicLook = computed(() => {
    const e = this.epic();
    return e ? { color: epicColor(e.color), status: epicStatusLook(e.status) } : null;
  });
  readonly cards = computed(() => sortEpicCards(this.epic()?.cards ?? []));
  readonly cardIds = computed(() => this.cards().map((c) => c.card));
  /** Ajustes 2: aba Cards em "Lista" ou "Acompanhamento" (PRs e ambientes) — management começa no Acompanhamento. */
  private roles = inject(RoleService);
  readonly cardsView = signal<CardsView>(defaultCardsView(readText(CARDS_VIEW_KEY), this.roles.isManagement));
  /** "Abrir na Bancada" só para admin ou desenvolvedor (management sem papel de dev não acessa a Bancada). */
  readonly canOpenWorkbench = this.roles.canOpenWorkbenchFromDesk;
  readonly hasBoard = computed(() => !!this.epic()?.devOpsTeam && !!this.epic()?.devOpsBoard);
  readonly descOpen = signal(false);
  readonly statusBusy = signal(false);
  private epicSub?: Subscription;

  // ── Abas ────────────────────────────────────────────────────────────────────────────────────
  private readonly pickedTab = signal<DeskTab | null>(null);
  /** Sem escolha: Board quando o épico tem time/board; senão Itens. */
  readonly mainTab = computed<DeskTab>(() => this.pickedTab() ?? (this.hasBoard() ? 'board' : 'items'));
  private readonly pickedMobileTab = signal<DeskMobileTab | null>(null);
  readonly narrow = signal(typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches);
  private readonly narrowMedia = typeof window !== 'undefined' ? window.matchMedia(NARROW_QUERY) : null;
  private readonly onNarrowChange = (e: MediaQueryListEvent) => this.narrow.set(e.matches);
  /** No celular, sem épico aberto, a aba é a lista de épicos. */
  readonly mobileTab = computed<DeskMobileTab>(() => this.pickedMobileTab() ?? (this.epicState() === 'idle' ? 'rail' : this.mainTab()));
  readonly visibleMain = computed<DeskTab | null>(() => {
    if (!this.narrow()) return this.mainTab();
    const t = this.mobileTab();
    return t === 'chat' || t === 'rail' ? null : t;
  });
  readonly showRail = computed(() => (this.narrow() ? this.mobileTab() === 'rail' : true));
  readonly showChat = computed(() => !this.narrow() || this.mobileTab() === 'chat');

  readonly boardScope = signal<'epic' | 'board'>(readText(BOARD_SCOPE_KEY) === 'board' ? 'board' : 'epic');

  // ── Itens (contagem e filtro dos arquivos) ──────────────────────────────────────────────────
  readonly items = signal<WorkItem[]>([]);
  readonly itemCount = signal<number | null>(null);
  /** Ajustes 2: histórias/bugs a converter (rascunhos + prontas) — contagem da aba Histórias. */
  readonly storyCount = signal<number | null>(null);
  readonly openItem = signal<number | null>(null);
  private stopItems?: () => void;
  private itemsSub?: Subscription;

  readonly files = new CardFilesStore();
  readonly filesItem = signal<number | undefined>(undefined);

  // ── Cards ───────────────────────────────────────────────────────────────────────────────────
  addCardQuery = '';
  readonly addingCard = signal(false);
  readonly removing = signal<string | null>(null);

  // ── Painel do card (busca do topo, cartão do board, aba Cards) ──────────────────────────────
  cardQuery = '';
  readonly panelCard = signal<string | null>(null);
  /**
   * Modal do card (ajustes 3): um diálogo com o template da página — fica acima da barra do topo e os combos/popovers/
   * visualizador abertos por dentro ficam acima dele. Esc e clique fora fecham (perguntando se há alterações).
   */
  readonly cardPanel = viewChild<DevOpsCardPanelComponent>('cardModal');
  private readonly cardModalTpl = viewChild.required<TemplateRef<unknown>>('cardModalTpl');
  private cardDialog: MatDialogRef<unknown> | null = null;

  // ── Especialista ────────────────────────────────────────────────────────────────────────────
  readonly chatCollapsed = signal(readFlag(CHAT_COLLAPSED_KEY));
  readonly chatSliding = signal(false);
  readonly chatHidden = computed(() => this.chatCollapsed() && !this.narrow());
  readonly chatFlash = signal(false);
  readonly caseUnread = computed(() => {
    const k = this.key();
    return k ? this.caseStore.status(k)().unread : 0;
  });
  private slideTimer?: ReturnType<typeof setTimeout>;
  private flashTimer?: ReturnType<typeof setTimeout>;
  private liveTimer?: ReturnType<typeof setTimeout>;
  private querySub?: Subscription;

  readonly tourHost: TourHost = {
    hasCard: () => this.epicState() === 'found' && !!document.querySelector('[data-tour="dk-epic"]'),
    prepare: (step: TourStep) => this.prepareTourStep(step)
  };

  constructor() {
    this.narrowMedia?.addEventListener('change', this.onNarrowChange);

    // Modal do card: abre/fecha com o card do painel (URL ?card=, busca, board, aba Cards).
    effect(() => {
      const open = !!this.panelCard();
      untracked(() => (open ? this.openCardOverlay() : this.disposeCardOverlay()));
    });
    inject(DestroyRef).onDestroy(() => this.disposeCardOverlay());

    // Tempo real dos épicos: a lista relê; o épico aberto relê quando é ele (ou na volta da conexão).
    const stopEpics = this.api.listen((payload) => {
      clearTimeout(this.liveTimer);
      this.liveTimer = setTimeout(() => {
        this.loadEpics();
        const n = this.epicNumber();
        if (n && (!payload || payload.number === n)) this.loadEpic(n, true);
      }, 300);
    });
    inject(DestroyRef).onDestroy(() => stopEpics());

    // Itens do épico (para o filtro de arquivos) + tempo real dos itens.
    effect(() => {
      const key = this.key();
      untracked(() => this.watchItems(key));
    });

    // Arquivos do épico (aba Arquivos): lê ao abrir e acompanha o tempo real.
    let filesKey: string | null = null;
    effect(() => {
      const key = this.key();
      untracked(() => {
        if (filesKey && key !== filesKey) this.filesItem.set(undefined);
        filesKey = key;
        this.files.watch(key);
      });
    });

    // Nome/status da aba (0065): o épico aberto e as tarefas em aberto.
    effect(() => {
      if (!this.tabScreen.active()) return;
      const e = this.epic();
      const open = e?.counts?.openItems ?? 0;
      const label = e && this.epicState() === 'found' ? `#${e.number} ${e.title}` : null;
      const status = open ? { text: `${open} ${open === 1 ? 'tarefa em aberto' : 'tarefas em aberto'}`, tone: 'info' as const } : null;
      untracked(() => this.tabs.setMeta(this.tabScreen.tabId(), { label, status }));
    });

    // Épico aberto: o tour continua/começa com os passos do épico.
    effect(() => {
      if (this.epicState() === 'found' && this.tabScreen.active()) {
        untracked(() => this.tours.cardReady(DESK_TOUR, this.tourHost));
      }
    });
  }

  ngOnInit(): void {
    this.loadEpics();
    this.querySub = this.route.queryParamMap.subscribe(() => this.applyQuery());
    if (!this.route.snapshot.queryParamMap.get('epic')) {
      setTimeout(() => { if (this.tabScreen.active()) this.tours.autoStart(DESK_TOUR, this.tourHost); }, 700);
    }
  }

  ngOnDestroy(): void {
    this.narrowMedia?.removeEventListener('change', this.onNarrowChange);
    this.listSub?.unsubscribe();
    this.epicSub?.unsubscribe();
    this.itemsSub?.unsubscribe();
    this.stopItems?.();
    this.querySub?.unsubscribe();
    clearTimeout(this.slideTimer);
    clearTimeout(this.flashTimer);
    clearTimeout(this.liveTimer);
    this.tours.stop(DESK_TOUR.id);
  }

  // ── URL ─────────────────────────────────────────────────────────────────────────────────────

  /** `?epic=&card=&item=&tab=` — na entrada e quando a URL muda com a tela aberta (link de outro lugar, Voltar). */
  private applyQuery(): void {
    const params = this.route.snapshot.queryParamMap;
    const epic = parseEpicNumber(params.get('epic'));
    const card = parseCardId(params.get('card'));
    const item = Number(params.get('item'));
    const tab = parseDeskTab(params.get('tab'));
    if (epic && epic !== this.epicNumber()) this.openEpic(epic, false);
    if (!epic && this.epicNumber()) this.closeEpic(false);
    if (card !== this.panelCard()) this.panelCard.set(card);
    if (tab) this.selectMobile(tab);
    if (epic && Number.isInteger(item) && item > 0) {
      this.openItem.set(item);
      if (!tab) this.selectMobile('items');
    }
  }

  /** Leva o estado para a URL sem empilhar histórico (só a aba ativa mexe na URL). */
  private syncUrl(): void {
    if (!this.tabScreen.active()) return;
    const queryParams: Record<string, string | number> = {};
    const n = this.epicNumber();
    if (n) queryParams['epic'] = n;
    const card = this.panelCard();
    if (card) queryParams['card'] = card;
    if (n && this.pickedTab()) queryParams['tab'] = this.pickedTab()!;
    const current = this.route.snapshot.queryParamMap;
    const same = ['epic', 'card', 'tab'].every((k) => (current.get(k) ?? null) === (queryParams[k] != null ? `${queryParams[k]}` : null));
    if (same) return;
    void this.router.navigate([], { relativeTo: this.route, queryParams, replaceUrl: true });
  }

  // ── Trilho ──────────────────────────────────────────────────────────────────────────────────

  loadEpics(): void {
    this.listSub?.unsubscribe();
    this.railLoading.set(true);
    const mine = this.railMine();
    this.listSub = this.api.list({ mine }).subscribe({
      next: (list) => {
        this.epics.set(list ?? []);
        this.railLoading.set(false);
        this.railLoaded.set(true);
        this.railError.set(null);
      },
      error: (e) => {
        this.railLoading.set(false);
        this.railLoaded.set(true);
        this.railError.set(epicApiError(e, 'Não foi possível carregar os épicos.'));
      }
    });
  }

  setRailMine(mine: boolean): void {
    if (this.railMine() === mine) return;
    this.railMine.set(mine);
    writeFlag(RAIL_MINE_KEY, mine);
    this.loadEpics();
  }

  setRailStatus(status: EpicStatusFilter): void {
    this.railStatus.set(status);
    writeText(RAIL_STATUS_KEY, status === 'open' ? null : status);
  }

  setRailCollapsed(on: boolean): void {
    this.railCollapsed.set(on);
    writeFlag(RAIL_COLLAPSED_KEY, on);
  }

  pickEpic(e: EpicSummary): void {
    this.openEpic(e.number, true);
    if (this.narrow()) this.pickedMobileTab.set(null);
  }

  color(e: Pick<EpicSummary, 'color'>): string {
    return epicColor(e.color);
  }

  statusLook(status: string | null | undefined) {
    return epicStatusLook(status);
  }

  // ── Épico ───────────────────────────────────────────────────────────────────────────────────

  private openEpic(number: number, syncUrl: boolean): void {
    if (number !== this.epicNumber()) {
      this.epic.set(null);
      this.pickedTab.set(null);
      this.pickedMobileTab.set(null);
      this.itemCount.set(null);
      this.storyCount.set(null);
      this.items.set([]);
      this.openItem.set(null);
      this.descOpen.set(false);
    }
    this.epicNumber.set(number);
    this.loadEpic(number);
    if (syncUrl) this.syncUrl();
  }

  private closeEpic(syncUrl: boolean): void {
    this.epicSub?.unsubscribe();
    this.epicNumber.set(null);
    this.epic.set(null);
    this.epicState.set('idle');
    this.pickedTab.set(null);
    if (syncUrl) this.syncUrl();
  }

  /** `quiet`: releitura (tempo real/ação) sem esconder o que está na tela. */
  private loadEpic(number: number, quiet = false): void {
    this.epicSub?.unsubscribe();
    if (!quiet || this.epicState() !== 'found') this.epicState.set('loading');
    this.epicSub = this.api.get(number).subscribe({
      next: (e) => {
        if (this.epicNumber() !== number) return;
        this.epic.set(e);
        this.epicState.set('found');
      },
      error: (err) => {
        if (this.epicNumber() !== number) return;
        if (quiet && this.epicState() === 'found') return;
        this.epic.set(null);
        this.epicState.set(err?.status === 404 ? 'missing' : 'error');
      }
    });
  }

  /** Aba Cards: estado/coluna/responsável do DevOps por card (enfeite — sem DevOps a lista segue sem eles). */
  readonly cardLive = signal<Record<string, EpicCardLive>>({});
  private cardLiveKey = '';
  private readonly cardLiveSync = effect(() => {
    const cards = (this.epic()?.cards ?? []).map((c) => c.card).filter((c) => /^\d+$/.test(c));
    const key = cards.join(',');
    if (key === this.cardLiveKey) return;
    this.cardLiveKey = key;
    if (!cards.length) { this.cardLive.set({}); return; }
    untracked(() => this.api.cardsSummary(cards).subscribe({
      next: (rows) => this.cardLive.set(Object.fromEntries(rows.map((r) => [`${r.id}`, r]))),
      error: () => undefined
    }));
  });

  reloadEpic(): void {
    const n = this.epicNumber();
    if (n) this.loadEpic(n, true);
  }

  async newEpic(): Promise<void> {
    const saved = await openEpicDialog(this.dialog);
    if (!saved) return;
    this.snack.open(`Épico #${saved.number} criado.`, 'Ok', { duration: 4000 });
    this.epics.update((list) => [saved, ...list.filter((e) => e.number !== saved.number)]);
    // O filtro de status não pode esconder o épico recém-criado.
    if (this.railStatus() !== 'all' && this.railStatus() !== 'open' && this.railStatus() !== saved.status) this.setRailStatus('open');
    this.openEpic(saved.number, true);
    this.loadEpics();
  }

  async editEpic(): Promise<void> {
    const e = this.epic();
    if (!e) return;
    const saved = await openEpicDialog(this.dialog, e);
    if (!saved || this.epicNumber() !== e.number) return;
    this.epic.set({ ...e, ...saved, cards: saved.cards ?? e.cards });
    this.loadEpics();
  }

  setStatus(status: EpicStatus): void {
    const e = this.epic();
    if (!e || e.status === status || this.statusBusy()) return;
    this.statusBusy.set(true);
    this.api.setStatus(e.number, status).subscribe({
      next: () => {
        this.statusBusy.set(false);
        if (this.epicNumber() === e.number) this.epic.update((cur) => (cur ? { ...cur, status } : cur));
        this.epics.update((list) => list.map((x) => (x.number === e.number ? { ...x, status } : x)));
        this.snack.open(`Épico #${e.number}: ${epicStatusLook(status).label.toLowerCase()}.`, 'Ok', { duration: 3000 });
      },
      error: (err) => {
        this.statusBusy.set(false);
        this.snack.open(epicApiError(err, 'Não foi possível mudar o status do épico.'), 'Fechar', { duration: 8000 });
      }
    });
  }

  // ── Abas ────────────────────────────────────────────────────────────────────────────────────

  selectMain(tab: DeskTab): void {
    this.pickedTab.set(tab);
    this.pickedMobileTab.set(null);
    this.syncUrl();
  }

  selectMobile(tab: DeskMobileTab): void {
    if (tab !== 'chat' && tab !== 'rail') this.pickedTab.set(tab);
    this.pickedMobileTab.set(tab);
    this.syncUrl();
  }

  setBoardScope(scope: 'epic' | 'board'): void {
    this.boardScope.set(scope);
    writeText(BOARD_SCOPE_KEY, scope === 'board' ? 'board' : null);
  }

  /** Primeira escolha de time/board no board fica gravada no épico (o que já estiver definido não muda). */
  private pickedBoard: { team: string | null; board: string | null } = { team: null, board: null };
  onBoardPicked(team: string | null, board: string | null): void {
    const e = this.epic();
    if (team) this.pickedBoard = { team, board: null };
    if (board) this.pickedBoard = { ...this.pickedBoard, board };
    if (!e) return;
    const nextTeam = e.devOpsTeam || this.pickedBoard.team;
    const nextBoard = e.devOpsBoard || this.pickedBoard.board;
    if (nextTeam === e.devOpsTeam && nextBoard === e.devOpsBoard) return;
    if (!nextTeam || !nextBoard) return;
    this.api.update(e.number, {
      title: e.title, description: e.description, color: e.color, tags: e.tags,
      devOpsTeam: nextTeam, devOpsBoard: nextBoard, devOpsCardId: e.devOpsCardId ?? null
    }).subscribe({ next: () => this.reloadEpic(), error: () => undefined });
  }

  // ── Itens ───────────────────────────────────────────────────────────────────────────────────

  private watchItems(key: string | null): void {
    this.stopItems?.();
    this.stopItems = undefined;
    this.itemsSub?.unsubscribe();
    if (!key) return;
    const load = () => {
      this.itemsSub?.unsubscribe();
      this.itemsSub = this.workItems.list(key).subscribe({
        next: (list) => { if (this.key() === key) this.items.set(list ?? []); },
        error: () => undefined
      });
    };
    load();
    this.stopItems = listenWorkItems(this.ws, key, (payload) => {
      if (payload?.action === 'activity') return;
      load();
    });
  }

  onItemCount(n: number): void {
    this.itemCount.set(n);
  }

  /** Item criado/aberto por uma ferramenta da conversa: mostra a lista e abre o item. */
  onItemOpened(n: number): void {
    this.selectMobile('items');
    this.openItem.set(null);
    queueMicrotask(() => this.openItem.set(n));
  }

  // ── Cards do épico ──────────────────────────────────────────────────────────────────────────

  cardColor(c: EpicCard): string {
    return devOpsTypeColor(c.workItemType);
  }

  roleLook(c: EpicCard) {
    return epicCardRoleLook(c.role);
  }

  addCard(): void {
    const e = this.epic();
    const id = parseCardId(this.addCardQuery);
    if (!e) return;
    if (!id) {
      this.snack.open('Digite o número do card do DevOps (só números).', 'Ok', { duration: 4000 });
      return;
    }
    if (e.cards.some((c) => c.card === id)) {
      this.snack.open(`O card #${id} já está neste épico.`, 'Ok', { duration: 4000 });
      return;
    }
    this.addingCard.set(true);
    this.api.addCard(e.number, id).subscribe({
      next: (card) => {
        this.addingCard.set(false);
        this.addCardQuery = '';
        if (this.epicNumber() === e.number) {
          this.epic.update((cur) => (cur ? { ...cur, cards: [card, ...cur.cards.filter((c) => c.card !== card.card)] } : cur));
        }
        this.reloadEpic();
        this.snack.open(`Card #${id} adicionado ao épico.`, 'Ok', { duration: 3000 });
      },
      error: (err) => {
        this.addingCard.set(false);
        this.snack.open(epicApiError(err, `Não foi possível adicionar o card #${id}.`), 'Fechar', { duration: 8000 });
      }
    });
  }

  removeCard(c: EpicCard): void {
    const e = this.epic();
    if (!e || this.removing()) return;
    this.removing.set(c.card);
    this.api.removeCard(e.number, c.card).subscribe({
      next: () => {
        this.removing.set(null);
        if (this.epicNumber() === e.number) this.epic.update((cur) => (cur ? { ...cur, cards: cur.cards.filter((x) => x.card !== c.card) } : cur));
        this.reloadEpic();
        // Desfazer: devolve com o mesmo papel (criado/adicionado/mencionado).
        this.snack.open(`Card #${c.card} removido do épico.`, 'Desfazer', { duration: 6000 }).onAction().subscribe(() => {
          this.api.addCard(e.number, c.card, c.role).subscribe({ next: () => this.reloadEpic(), error: () => undefined });
        });
      },
      error: (err) => {
        this.removing.set(null);
        this.snack.open(epicApiError(err, `Não foi possível remover o card #${c.card}.`), 'Fechar', { duration: 8000 });
      }
    });
  }

  setCardsView(view: CardsView): void {
    this.cardsView.set(view);
    writeText(CARDS_VIEW_KEY, view);
  }

  openInWorkbench(card: string): void {
    if (!this.canOpenWorkbench) return;
    void this.router.navigate(['/auth/workbench'], { queryParams: { card } });
  }

  /** "Novo card" (aba Cards / Board): diálogo do DevOps no time/board do épico; o card entra no épico como `created`. */
  async newCard(): Promise<void> {
    const e = this.epic();
    const created = await firstValueFrom(openDevOpsCardCreate(this.dialog, {
      epic: e?.number ?? null, team: e?.devOpsTeam ?? null, board: e?.devOpsBoard ?? null
    }), { defaultValue: undefined });
    if (!created) return;
    this.reloadEpic();
    if (created.id) this.openCard(`${created.id}`);
  }

  // ── Painel do card ──────────────────────────────────────────────────────────────────────────

  /** Busca do topo: número de card abre o painel; `E12`/`#E12` abre o épico. */
  searchCard(): void {
    const raw = `${this.cardQuery ?? ''}`.trim();
    const epic = parseEpicKey(raw.replace(/^#/, ''));
    if (epic) {
      this.cardQuery = '';
      this.openEpic(epic, true);
      return;
    }
    const id = parseCardId(raw);
    if (!id) {
      this.snack.open('Digite o número do card do DevOps (ou E + número para abrir um épico).', 'Ok', { duration: 4000 });
      return;
    }
    this.openCard(id);
  }

  openCard(card: string | number): void {
    const id = parseCardId(card);
    if (!id) return;
    this.panelCard.set(id);
    this.syncUrl();
  }

  closeCard(): void {
    this.panelCard.set(null);
    this.syncUrl();
  }

  private openCardOverlay(): void {
    if (this.cardDialog) return;
    const ref = this.dialog.open(this.cardModalTpl(), {
      width: 'min(1560px, 96vw)',
      maxWidth: '96vw',
      height: 'min(1000px, 94vh)',
      panelClass: 'dk-card-dialog',
      autoFocus: false,
      restoreFocus: true,
      disableClose: true,
    });
    ref.backdropClick().subscribe(() => this.cardPanel()?.close());
    ref.keydownEvents().subscribe((e) => { if (e.key === 'Escape') this.onEscape(e); });
    ref.afterClosed().subscribe(() => { if (this.cardDialog === ref) this.cardDialog = null; });
    this.cardDialog = ref;
  }

  private disposeCardOverlay(): void {
    const ref = this.cardDialog;
    this.cardDialog = null;
    ref?.close();
  }

  /** Esc fecha o modal do card — menos quando um combo/menu já tratou a tecla ou o foco está num campo (aí só sai do campo). */
  onEscape(event: KeyboardEvent): void {
    const panel = this.cardPanel();
    if (!panel || event.defaultPrevented) return;
    const t = event.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) { t.blur(); return; }
    panel.close();
  }

  // ── Especialista ────────────────────────────────────────────────────────────────────────────

  setChatCollapsed(on: boolean): void {
    if (this.chatCollapsed() === on) return;
    clearTimeout(this.slideTimer);
    this.chatSliding.set(true);
    this.chatCollapsed.set(on);
    writeFlag(CHAT_COLLAPSED_KEY, on);
    this.slideTimer = setTimeout(() => this.chatSliding.set(false), SLIDE_MS + 40);
  }

  /** "Pedir ao especialista" do estado sem board: leva para a conversa. */
  focusChat(): void {
    if (this.narrow()) {
      this.selectMobile('chat');
      return;
    }
    this.setChatCollapsed(false);
    clearTimeout(this.flashTimer);
    this.chatFlash.set(true);
    setTimeout(() => this.host.nativeElement.querySelector('.dk-chat')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 300);
    this.flashTimer = setTimeout(() => this.chatFlash.set(false), 2400);
  }

  // ── Tour ────────────────────────────────────────────────────────────────────────────────────

  openHelp(): void {
    const data: TourHelpData = { tour: DESK_TOUR, hasCard: !!this.tourHost.hasCard?.(), host: this.tourHost };
    this.dialog.open<TourHelpDialogComponent, TourHelpData, TourHelpResult>(TourHelpDialogComponent, {
      data, width: '760px', maxWidth: '96vw', autoFocus: false
    }).afterClosed().subscribe((r) => {
      if (!r) return;
      setTimeout(() => this.tours.start(DESK_TOUR, this.tourHost, 'from' in r ? r.from : undefined), 250);
    });
  }

  /** `prepare: 'tab:<aba>'` — abre a aba do passo (Especialista recolhido volta). */
  private prepareTourStep(step: TourStep): 'ready' | 'changed' | 'skip' {
    const tab = step.prepare?.startsWith('tab:') ? step.prepare.slice(4) as DeskMobileTab : null;
    if (!tab) return 'ready';
    if (this.narrow()) {
      if (this.mobileTab() === tab) return 'ready';
      this.selectMobile(tab);
      return 'changed';
    }
    if (tab === 'chat') {
      if (!this.chatCollapsed()) return 'ready';
      this.setChatCollapsed(false);
      return 'changed';
    }
    if (tab !== 'rail' && this.mainTab() !== tab) {
      this.selectMain(tab);
      return 'changed';
    }
    return 'ready';
  }
}
