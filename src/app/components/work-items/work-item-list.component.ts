import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DomSanitizer } from '@angular/platform-browser';
import { WorkItemsService } from '../../services/work-items.service';
import { ExecutionPlanService } from '../../services/execution-plan.service';
import { WsService } from '../../services/ws.service';
import { ExecutionPlanSummary } from '../execution-plan/execution-plan.model';
import { registerWorkItemTypeIcons, workItemTypeIcon, workItemTypeLabel } from '../../helpers/work-item-type-icons';
import {
  TASK_ACTION_LABELS,
  WorkItem,
  WorkItemCatalog,
  WorkItemFilter,
  WorkTask,
  WorkTaskAction,
  canCancel,
  canExecute,
  canUndo,
  executorLabel,
  formatWorkNumber,
  isItemBusy,
  isOpenItem,
  itemProgress,
  itemStatusLook,
  kindInfo,
  matchesFilter,
  originIcon,
  originLabel,
  taskStatusLook,
  userTaskActions
} from './work-item.model';
import { WorkItemActionsService } from './work-item-actions.service';
import { WorkItemDialogComponent, WorkItemDialogData, WorkItemDialogResult } from './work-item-dialog.component';
import { workDialogConfig } from './work-dialog-config';
import { listenWorkItems } from './work-items-live';

const FILTERS: { key: WorkItemFilter; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'open', label: 'Abertos' },
  { key: 'done', label: 'Concluídos' },
  { key: 'cancelled', label: 'Cancelados' }
];

const EXPANDED_KEY = (card: string) => `wi-expanded:${card}`;

/**
 * 0085: lista dos itens de trabalho do card (aba "Itens de trabalho" da Bancada). Cada item é uma linha expansível
 * com as sub-tarefas; executar/editar/cancelar/desfazer por item (itens rodam em paralelo — cada botão é
 * independente); título → modal do item; sub-tarefa → modal da sub-tarefa. Tempo real pelo grupo `execplan:{card}`
 * (`workItemsUpdated` é só sinal: refaz o GET). Expansão guardada por card no sessionStorage.
 *
 * API pública: `[card]`, `[cardType]` ('bug' | 'user-story', padrão do item novo), `[openItem]` (número — abre o modal
 * do item; vem do `?item=`), `(countChange)` (quantidade de itens do card a cada carga).
 */
@Component({
  selector: 'app-work-item-list',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wil">
      <div class="wil__bar">
        <button mat-flat-button color="primary" class="wil__new" (click)="create()" [disabled]="!card()"><mat-icon>add</mat-icon>Novo item</button>
        <button mat-stroked-button class="wil__ask" (click)="askSpecialist()" [disabled]="!card()" matTooltip="O especialista do caso monta o item pelas regras do PRMake">
          <mat-icon>psychology</mat-icon>Pedir ao especialista
        </button>
        <span class="wil__spacer"></span>
        <div class="wil__filters" role="radiogroup" aria-label="Filtrar itens">
          @for (f of filters; track f.key) {
            <button type="button" role="radio" [attr.aria-checked]="filter() === f.key" [class.on]="filter() === f.key" (click)="filter.set(f.key)">
              {{ f.label }}<small>{{ counts()[f.key] }}</small>
            </button>
          }
        </div>
        <button mat-icon-button (click)="expandAll()" matTooltip="Expandir todos" aria-label="Expandir todos" [disabled]="!items().length"><mat-icon>unfold_more</mat-icon></button>
        <button mat-icon-button (click)="collapseAll()" matTooltip="Recolher todos" aria-label="Recolher todos" [disabled]="!items().length"><mat-icon>unfold_less</mat-icon></button>
      </div>

      @if (loadError()) {
        <div class="wil__msg wil__msg--err"><mat-icon>error_outline</mat-icon><span>{{ loadError() }}</span><button mat-button (click)="load()">Tentar de novo</button></div>
      }

      @if (loading() && !items().length) {
        <div class="wil__msg"><mat-icon class="wil__spin">autorenew</mat-icon>Carregando itens…</div>
      } @else if (!items().length && !loadError()) {
        <div class="wil__empty">
          <mat-icon class="wil__empty-ico">checklist</mat-icon>
          <p><b>Nenhum item de trabalho neste card.</b><br>
            <span>Itens são entregas com sub-tarefas (branch, cherry-pick, código, PR, estado no DevOps…) que o Claude executa — vários em paralelo.</span></p>
          <div class="wil__empty-actions">
            <button mat-flat-button color="primary" (click)="create()" [disabled]="!card()"><mat-icon>add</mat-icon>Novo item</button>
            @if (correctionPlan(); as p) {
              <button mat-stroked-button (click)="generateFromPlan(p)" [disabled]="generating()">
                <mat-icon>account_tree</mat-icon>{{ generating() ? 'Gerando…' : 'Gerar itens a partir do plano' }}
              </button>
            }
          </div>
        </div>
      } @else {
        @if (!visible().length) { <div class="wil__msg">Nenhum item neste filtro.</div> }
        <ul class="wil__list">
          @for (it of visible(); track it.id) {
            <li class="wil__item" [class.wil__item--open]="isExpanded(it.number)" [class.wil__item--dim]="it.status === 'cancelled' || it.status === 'reverted'">
              <div class="wil__row">
                <button class="wil__chev" (click)="toggle(it.number)" [attr.aria-expanded]="isExpanded(it.number)"
                        [attr.aria-label]="(isExpanded(it.number) ? 'Recolher ' : 'Expandir ') + num(it.number)" [disabled]="!it.tasks.length">
                  <mat-icon>{{ isExpanded(it.number) ? 'expand_more' : 'chevron_right' }}</mat-icon>
                </button>
                <mat-icon class="wil__type" [svgIcon]="typeIcon(it.type)" [matTooltip]="typeLabel(it.type)"></mat-icon>
                <button class="wil__title" (click)="openItemDialog(it.number, it)" [title]="it.title">
                  <span class="wil__num">{{ num(it.number) }}</span><span class="wil__title-text">{{ it.title }}</span>
                </button>
                <div class="wil__meta">
                  <span class="wil__chip" [matTooltip]="'Origem: ' + origin(it.origin)"><mat-icon>{{ originIco(it.origin) }}</mat-icon>{{ origin(it.origin) }}</span>
                  <span class="wil__status" [style.color]="look(it).color"><mat-icon [class.wil__spin]="look(it).spin">{{ look(it).icon }}</mat-icon>{{ look(it).label }}</span>
                  @if (progress(it); as p) {
                    @if (p.total) {
                      <span class="wil__prog" [matTooltip]="p.done + ' de ' + p.total + ' sub-tarefas'">
                        <span class="wil__bar-track"><span class="wil__bar-fill" [style.width.%]="p.pct" [style.background]="look(it).color"></span></span>
                        <span class="wil__prog-num">{{ p.done }}/{{ p.total }}</span>
                      </span>
                    }
                  }
                  <span class="wil__actions">
                    @if (busy(it)) {
                      <span class="wil__running" [matTooltip]="it.activity || look(it).label">
                        <mat-icon class="wil__spin">autorenew</mat-icon><span class="wil__running-text">{{ it.activity || (it.status === 'queued' ? 'Na fila' : it.status === 'reverting' ? 'Desfazendo' : 'Executando') }}</span>
                      </span>
                    } @else {
                      <button mat-stroked-button class="wil__run" (click)="execute(it)" [disabled]="!canRun(it) || pending().has(it.number)"
                              [matTooltip]="canRun(it) ? 'Executar este item (roda em paralelo aos outros)' : 'Só itens pendentes ou que falharam'">
                        <mat-icon>play_arrow</mat-icon>Executar
                      </button>
                    }
                    @if (it.editable) {
                      <button mat-icon-button (click)="edit(it)" matTooltip="Editar" aria-label="Editar" [disabled]="pending().has(it.number)"><mat-icon>edit</mat-icon></button>
                    }
                    <button mat-icon-button [matMenuTriggerFor]="menu" aria-label="Mais ações" [disabled]="pending().has(it.number)"><mat-icon>more_horiz</mat-icon></button>
                    <mat-menu #menu="matMenu" xPosition="before">
                      <button mat-menu-item (click)="duplicate(it)"><mat-icon>content_copy</mat-icon>Criar novo a partir deste</button>
                      @if (canCancelIt(it)) { <button mat-menu-item (click)="cancel(it)"><mat-icon>stop_circle</mat-icon>Cancelar…</button> }
                      @if (canUndoIt(it)) { <button mat-menu-item (click)="undo(it)"><mat-icon>undo</mat-icon>Desfazer</button> }
                      @if (it.planId) { <button mat-menu-item (click)="openPlan()"><mat-icon>account_tree</mat-icon>Abrir plano</button> }
                    </mat-menu>
                  </span>
                </div>
              </div>
              @if (isExpanded(it.number) && it.tasks.length) {
                <ol class="wil__tasks">
                  @for (t of it.tasks; track t.id) {
                    <li class="wil__task">
                      <mat-icon class="wil__task-st" [style.color]="taskLook(t).color" [class.wil__spin]="taskLook(t).spin" [matTooltip]="taskLook(t).label">{{ taskLook(t).icon }}</mat-icon>
                      <button class="wil__task-main" (click)="openTask(it, t)" [title]="t.title">
                        <span class="wil__num">{{ num(t.number) }}</span>
                        <mat-icon class="wil__task-kind" [matTooltip]="kind(t).label">{{ kind(t).icon }}</mat-icon>
                        <span class="wil__task-title">{{ t.title }}</span>
                      </button>
                      <span class="wil__task-st-label" [style.color]="taskLook(t).color">{{ taskLook(t).label }}</span>
                      <span class="wil__chip wil__chip--exec">{{ executor(t.executor) }}</span>
                      @for (a of quick(t); track a) {
                        <button mat-icon-button class="wil__qa" (click)="taskAct(t, a)" [disabled]="pendingTask() === t.number"
                                [matTooltip]="actionLook(a).label" [attr.aria-label]="actionLook(a).label + ' ' + num(t.number)"><mat-icon>{{ actionLook(a).icon }}</mat-icon></button>
                      }
                    </li>
                  }
                </ol>
              }
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: [`
    :host { display: block; container-type: inline-size; font-size: 13px; color: var(--mat-sys-on-surface); }
    .wil { display: flex; flex-direction: column; gap: 8px; }
    .wil__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .wil__bar .mat-mdc-button-base mat-icon { margin-right: 4px; }
    .wil__spacer { flex: 1; }
    .wil__ask { border-color: rgba(196,167,255,.35) !important; }
    .wil__ask mat-icon { color: #c4a7ff; }
    .wil__filters { display: inline-flex; border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); border-radius: 8px; overflow: hidden; }
    .wil__filters button { background: transparent; border: 0; color: var(--cc-text-2); font: inherit; font-size: 12px; padding: 5px 9px; cursor: pointer; }
    .wil__filters button small { margin-left: 5px; opacity: .65; font-variant-numeric: tabular-nums; }
    .wil__filters button.on { background: color-mix(in srgb, var(--mat-sys-primary) 16%, transparent); color: var(--mat-sys-on-surface); }
    .wil__msg { display: flex; align-items: center; gap: 8px; padding: 10px 4px; color: var(--cc-text-2); font-size: 12.5px; }
    .wil__msg--err { color: #f85149; }
    .wil__empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; padding: 28px 12px;
      border: 1px dashed var(--cc-surface-border-strong, rgba(255,255,255,.18)); border-radius: 12px; }
    .wil__empty p { margin: 0; line-height: 1.5; max-width: 520px; }
    .wil__empty p span { color: var(--cc-text-2); font-size: 12.5px; }
    .wil__empty-ico { font-size: 30px; width: 30px; height: 30px; color: var(--cc-text-3); }
    .wil__empty-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
    .wil__empty-actions mat-icon { margin-right: 4px; }
    .wil__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .wil__item { border: 1px solid var(--cc-surface-border, rgba(255,255,255,.08)); border-radius: 10px; background: var(--surface-1, #262b33); }
    .wil__item--open { border-color: var(--cc-surface-border-strong, rgba(255,255,255,.18)); }
    .wil__item--dim { opacity: .7; }
    .wil__row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 4px 8px 4px 2px; min-height: 40px; }
    .wil__chev { background: none; border: 0; color: var(--cc-text-2); cursor: pointer; width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; padding: 0; flex: none; }
    .wil__chev:hover:not(:disabled) { background: rgba(255,255,255,.06); }
    .wil__chev:disabled { opacity: .3; cursor: default; }
    .wil__type { width: 16px; height: 16px; flex: none; }
    .wil__title { flex: 1 1 200px; min-width: 0; display: flex; align-items: baseline; gap: 6px; background: none; border: 0; color: inherit; font: inherit; text-align: left; cursor: pointer; padding: 4px 0; }
    .wil__title-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
    .wil__title:hover .wil__title-text { text-decoration: underline; }
    .wil__num { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--cc-text-2); flex: none; }
    .wil__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin-left: auto; }
    .wil__chip { display: inline-flex; align-items: center; gap: 4px; padding: 0 7px; border-radius: 999px; font-size: 11px; line-height: 18px; white-space: nowrap;
      border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); color: var(--cc-text-2); }
    .wil__chip mat-icon { font-size: 13px; width: 13px; height: 13px; }
    .wil__status { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; white-space: nowrap; }
    .wil__status mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .wil__prog { display: inline-flex; align-items: center; gap: 6px; }
    .wil__bar-track { width: 54px; height: 4px; border-radius: 2px; background: rgba(255,255,255,.1); overflow: hidden; }
    .wil__bar-fill { display: block; height: 100%; border-radius: 2px; transition: width .3s ease; }
    .wil__prog-num { font-size: 11px; color: var(--cc-text-2); font-variant-numeric: tabular-nums; }
    .wil__actions { display: inline-flex; align-items: center; gap: 2px; }
    .wil__actions .mat-mdc-icon-button { width: 32px; height: 32px; padding: 4px; }
    .wil__actions .mat-mdc-icon-button mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .wil__run { height: 28px; font-size: 12px; padding: 0 10px; }
    .wil__run mat-icon { margin-right: 2px !important; }
    .wil__running { display: inline-flex; align-items: center; gap: 4px; max-width: 220px; font-size: 11.5px; color: #58a6ff; padding: 0 6px; }
    .wil__running mat-icon { font-size: 16px; width: 16px; height: 16px; flex: none; }
    .wil__running-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wil__tasks { list-style: none; margin: 0; padding: 0 10px 8px 34px; display: flex; flex-direction: column; }
    .wil__task { display: flex; align-items: center; gap: 6px; padding: 2px 4px; border-left: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); min-height: 30px; }
    .wil__task:hover { background: rgba(255,255,255,.03); }
    .wil__task-st { font-size: 16px; width: 16px; height: 16px; flex: none; margin-left: 4px; }
    .wil__task-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; background: none; border: 0; color: inherit; font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; padding: 2px 0; }
    .wil__task-main .wil__num { font-size: 12px; }
    .wil__task-kind { font-size: 15px; width: 15px; height: 15px; color: var(--cc-text-3); flex: none; }
    .wil__task-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wil__task-main:hover .wil__task-title { text-decoration: underline; }
    .wil__task-st-label { font-size: 11px; white-space: nowrap; }
    .wil__chip--exec { font-size: 10.5px; }
    .wil__qa.mat-mdc-icon-button { width: 26px; height: 26px; padding: 1px; }
    .wil__qa mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .wil__spin { animation: wil-spin 1.1s linear infinite; }
    @keyframes wil-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .wil__spin { animation: none; } .wil__bar-fill { transition: none; } }
    @container (max-width: 560px) {
      .wil__meta { width: 100%; margin-left: 30px; }
      .wil__actions { margin-left: auto; }
      .wil__task-st-label { display: none; }
      .wil__tasks { padding-left: 16px; }
      .wil__spacer { display: none; }
    }
  `]
})
export class WorkItemListComponent {
  readonly card = input<string | null>();
  readonly cardType = input<'bug' | 'user-story'>('bug');
  readonly openItem = input<number | null>(null);
  readonly countChange = output<number>();

  private api = inject(WorkItemsService);
  private plans = inject(ExecutionPlanService);
  private actions = inject(WorkItemActionsService);
  private dialog = inject(MatDialog);
  private router = inject(Router);
  private ws = inject(WsService);

  readonly filters = FILTERS;
  readonly items = signal<WorkItem[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly filter = signal<WorkItemFilter>('all');
  readonly expanded = signal<ReadonlySet<number>>(new Set());
  /** Itens com uma ação em curso (HTTP) — cada item é independente. */
  readonly pending = signal<ReadonlySet<number>>(new Set());
  readonly pendingTask = signal<number | null>(null);
  readonly catalog = signal<WorkItemCatalog | null>(null);
  /** Plano de correção do card (vazio → "Gerar itens a partir do plano"). */
  readonly correctionPlan = signal<ExecutionPlanSummary | null>(null);
  readonly generating = signal(false);

  readonly visible = computed(() => this.items().filter((it) => matchesFilter(it, this.filter())));
  readonly counts = computed(() => {
    const all = this.items();
    return {
      all: all.length,
      open: all.filter((x) => matchesFilter(x, 'open')).length,
      done: all.filter((x) => matchesFilter(x, 'done')).length,
      cancelled: all.filter((x) => matchesFilter(x, 'cancelled')).length
    } as Record<WorkItemFilter, number>;
  });

  readonly num = formatWorkNumber;
  readonly origin = originLabel;
  readonly originIco = originIcon;
  readonly executor = executorLabel;
  readonly typeIcon = workItemTypeIcon;
  readonly typeLabel = workItemTypeLabel;
  readonly look = (it: WorkItem) => itemStatusLook(it.status);
  readonly progress = (it: WorkItem) => itemProgress(it);
  readonly busy = (it: WorkItem) => isItemBusy(it);
  readonly canRun = (it: WorkItem) => canExecute(it);
  readonly canCancelIt = (it: WorkItem) => canCancel(it);
  readonly canUndoIt = (it: WorkItem) => canUndo(it);
  readonly taskLook = (t: WorkTask) => taskStatusLook(t.status);
  readonly kind = (t: WorkTask) => kindInfo(t.kind, this.catalog());
  readonly quick = (t: WorkTask) => userTaskActions(t).filter((a) => a === 'complete' || a === 'skip');
  readonly actionLook = (a: WorkTaskAction) => TASK_ACTION_LABELS[a];

  private currentCard: string | null = null;
  private stopLive: (() => void) | null = null;
  private lastOpened: string | null = null;
  private loadSeq = 0;

  constructor() {
    registerWorkItemTypeIcons(inject(MatIconRegistry), inject(DomSanitizer));

    effect(() => {
      const card = (this.card() ?? '').trim() || null;
      untracked(() => this.switchCard(card));
    });

    effect(() => {
      const n = this.openItem();
      const card = (this.card() ?? '').trim();
      if (!n || !card) { this.lastOpened = null; return; }
      const key = `${card}:${n}`;
      if (key === this.lastOpened) return;
      this.lastOpened = key;
      untracked(() => this.openItemDialog(n, this.items().find((x) => x.number === n), true));
    });

    inject(DestroyRef).onDestroy(() => this.stopLive?.());
  }

  // ── carga e tempo real ───────────────────────────────────────────────────────────────────────

  private switchCard(card: string | null): void {
    if (card === this.currentCard) return;
    this.stopLive?.();
    this.stopLive = null;
    this.currentCard = card;
    this.items.set([]);
    this.loadError.set(null);
    this.correctionPlan.set(null);
    this.catalog.set(null);
    this.expanded.set(new Set());
    if (!card) return;
    this.load();
    this.actions.catalogOrNull(card).then((c) => { if (c && this.currentCard === card) this.catalog.set(c); });
    this.stopLive = listenWorkItems(this.ws, card, () => this.load(true));
  }

  load(quiet = false): void {
    const card = this.currentCard;
    if (!card) return;
    const seq = ++this.loadSeq;
    if (!quiet) this.loading.set(true);
    this.api.list(card).subscribe({
      next: (list) => {
        if (seq !== this.loadSeq || card !== this.currentCard) return;
        const first = !this.items().length;
        const sorted = (list ?? []).map((it) => ({ ...it, tasks: (it.tasks ?? []).slice().sort((a, b) => a.order - b.order), links: it.links ?? [] }))
          .sort((a, b) => a.number - b.number);
        this.items.set(sorted);
        this.loading.set(false);
        this.loadError.set(null);
        if (first) this.restoreExpanded(card, sorted);
        this.countChange.emit(sorted.length);
        if (!sorted.length) this.findCorrectionPlan(card);
      },
      error: (e) => {
        if (seq !== this.loadSeq || card !== this.currentCard) return;
        this.loading.set(false);
        this.loadError.set(e.message);
      }
    });
  }

  private findCorrectionPlan(card: string): void {
    if (this.correctionPlan()) return;
    this.plans.history(card).subscribe({
      next: (list) => {
        if (card !== this.currentCard) return;
        // Histórico vem do mais recente para o mais antigo: o plano de correção mais novo (não cancelado, se houver).
        const corrections = (list ?? []).filter((p) => p.phase === 'correction');
        this.correctionPlan.set(corrections.find((p) => p.status !== 'cancelled') ?? corrections[0] ?? null);
      },
      error: () => {}
    });
  }

  // ── expansão ─────────────────────────────────────────────────────────────────────────────────

  isExpanded(n: number): boolean {
    return this.expanded().has(n);
  }

  toggle(n: number): void {
    const next = new Set(this.expanded());
    if (next.has(n)) next.delete(n); else next.add(n);
    this.setExpanded(next);
  }

  expandAll(): void {
    this.setExpanded(new Set(this.items().map((x) => x.number)));
  }

  collapseAll(): void {
    this.setExpanded(new Set());
  }

  private setExpanded(set: Set<number>): void {
    this.expanded.set(set);
    const card = this.currentCard;
    if (!card) return;
    try { sessionStorage.setItem(EXPANDED_KEY(card), JSON.stringify([...set])); } catch { /* sem storage: só em memória */ }
  }

  /** Primeira carga do card: o que estava guardado; sem nada guardado, os itens abertos (em andamento, falhos…). */
  private restoreExpanded(card: string, items: WorkItem[]): void {
    let saved: number[] | null = null;
    try {
      const raw = sessionStorage.getItem(EXPANDED_KEY(card));
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) saved = parsed.filter((x) => typeof x === 'number');
    } catch { saved = null; }
    if (saved) { this.expanded.set(new Set(saved)); return; }
    const open = items.filter((x) => isOpenItem(x) && x.status !== 'pending').map((x) => x.number);
    this.expanded.set(new Set(items.length === 1 ? [items[0].number] : open));
  }

  // ── ações ────────────────────────────────────────────────────────────────────────────────────

  openItemDialog(number: number, item?: WorkItem | null, fromQuery = false): void {
    const card = this.currentCard;
    if (!card) return;
    const data: WorkItemDialogData = { card, number, cardType: this.cardType(), item: item ?? null, catalog: this.catalog() };
    const ref = this.dialog.open<WorkItemDialogComponent, WorkItemDialogData, WorkItemDialogResult>(WorkItemDialogComponent, workDialogConfig(data, '860px'));
    ref.afterClosed().subscribe((r) => {
      if (fromQuery) this.clearItemQuery(number);
      if (r?.openNumber) {
        this.load(true);
        this.openItemDialog(r.openNumber);
      }
    });
  }

  /** Fechou o modal aberto pelo `?item=`: tira o parâmetro (recarregar a página não reabre). */
  private clearItemQuery(number: number): void {
    const current = this.router.parseUrl(this.router.url).queryParams['item'];
    if (`${current ?? ''}` !== `${number}`) return;
    this.router.navigate([], { queryParams: { item: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  openTask(item: WorkItem, task: WorkTask): void {
    const card = this.currentCard;
    if (card) this.actions.openTask(card, item, task.number, this.catalog());
  }

  async create(): Promise<void> {
    const card = this.currentCard;
    if (!card) return;
    const saved = await this.actions.create(card, this.cardType());
    if (saved) this.afterSaved(saved);
  }

  async edit(it: WorkItem): Promise<void> {
    const card = this.currentCard;
    if (!card) return;
    const saved = await this.withPending(it.number, () => this.actions.edit(card, this.cardType(), it));
    if (saved) this.afterSaved(saved);
  }

  async duplicate(it: WorkItem): Promise<void> {
    const card = this.currentCard;
    if (!card) return;
    const saved = await this.withPending(it.number, () => this.actions.duplicateAndEdit(card, this.cardType(), it));
    if (saved) this.afterSaved(saved);
  }

  async execute(it: WorkItem): Promise<void> {
    if (await this.withPending(it.number, () => this.actions.execute(it))) {
      // Mostra "na fila" na hora; o tempo real traz o resto.
      this.items.update((l) => l.map((x) => (x.number === it.number && canExecute(x) ? { ...x, status: 'queued' } : x)));
      this.expand(it.number);
      this.load(true);
    }
  }

  async cancel(it: WorkItem): Promise<void> {
    if (await this.withPending(it.number, () => this.actions.cancel(it))) this.load(true);
  }

  async undo(it: WorkItem): Promise<void> {
    if (await this.withPending(it.number, () => this.actions.undo(it))) this.load(true);
  }

  async taskAct(t: WorkTask, a: WorkTaskAction): Promise<void> {
    this.pendingTask.set(t.number);
    const ok = await this.actions.taskAction(t, a);
    this.pendingTask.set(null);
    if (ok) this.load(true);
  }

  async askSpecialist(): Promise<void> {
    const card = this.currentCard;
    if (card) await this.actions.askSpecialist(card, this.cardType());
  }

  async generateFromPlan(plan: ExecutionPlanSummary): Promise<void> {
    const card = this.currentCard;
    if (!card || this.generating()) return;
    this.generating.set(true);
    const it = await this.actions.fromPlan(card, plan.id);
    this.generating.set(false);
    if (it) this.afterSaved(it);
  }

  openPlan(): void {
    this.actions.openPlan();
  }

  private afterSaved(saved: WorkItem): void {
    this.expand(saved.number);
    this.load(true);
  }

  private expand(n: number): void {
    if (!this.isExpanded(n)) this.setExpanded(new Set([...this.expanded(), n]));
  }

  private async withPending<T>(n: number, fn: () => Promise<T>): Promise<T> {
    this.pending.update((s) => new Set([...s, n]));
    try {
      return await fn();
    } finally {
      this.pending.update((s) => { const next = new Set(s); next.delete(n); return next; });
    }
  }
}
