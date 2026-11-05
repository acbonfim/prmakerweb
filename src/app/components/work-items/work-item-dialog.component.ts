import { Component, DestroyRef, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PlanMarkdownPipe } from '../execution-plan/plan-markdown.pipe';
import { WorkItemsService } from '../../services/work-items.service';
import { WsService } from '../../services/ws.service';
import { workItemTypeIcon, workItemTypeLabel } from '../../helpers/work-item-type-icons';
import {
  TASK_ACTION_LABELS,
  WorkItem,
  WorkItemCatalog,
  WorkItemType,
  WorkTask,
  WorkTaskAction,
  canCancel,
  canExecute,
  canUndo,
  executorLabel,
  formatWorkNumber,
  isItemBusy,
  itemProgress,
  itemStatusLook,
  kindInfo,
  linkIcon,
  originIcon,
  originLabel,
  taskStatusLook,
  userTaskActions
} from './work-item.model';
import { WorkItemActionsService } from './work-item-actions.service';
import { listenWorkItems } from './work-items-live';
import { WORK_DIALOG_STYLES } from './work-dialog.styles';

export type WorkItemDialogTab = 'overview' | 'tasks' | 'history';

export interface WorkItemDialogData {
  card: string;
  number: number;
  /** Tipo do card (padrão dos itens criados a partir deste). */
  cardType?: WorkItemType;
  /** Item já carregado (mostra na hora; o modal busca o detalhe com o histórico e acompanha ao vivo). */
  item?: WorkItem | null;
  catalog?: WorkItemCatalog | null;
  tab?: WorkItemDialogTab;
}

/**
 * 0085: modal do item de trabalho — cabeçalho (tipo/#/título/status/origem/quem criou), abas Visão geral · Sub-tarefas ·
 * Histórico e as ações (Executar, Editar ou "Criar novo a partir deste", Cancelar, Desfazer). Atualiza ao vivo pelo
 * evento `workItemsUpdated`. Abrir com `workDialogConfig(data, '860px')`.
 */
@Component({
  selector: 'app-work-item-dialog',
  standalone: true,
  imports: [DatePipe, MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule, PlanMarkdownPipe],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="wi-dlg">
      <header class="wi-dlg__head">
        <mat-icon class="wi-type wid__type" [svgIcon]="typeIcon()" [matTooltip]="typeLabel()"></mat-icon>
        <div class="wi-dlg__head-main">
          <span class="wi-dlg__title"><span class="wi-num">{{ num(data.number) }}</span> {{ item()?.title || 'Item de trabalho' }}</span>
          @if (item(); as it) {
            <span class="wi-dlg__sub">
              <span class="wi-status" [style.color]="look().color"><mat-icon [class.wi-spin]="look().spin">{{ look().icon }}</mat-icon>{{ look().label }}</span>
              <span class="wi-chip"><mat-icon>{{ originIco(it.origin) }}</mat-icon>{{ origin(it.origin) }}</span>
              <span>por {{ it.createdByName || 'PRMake' }} em {{ it.createdAt | date:'dd/MM/yy HH:mm' }}</span>
              @if (progress().total) { <span>{{ progress().done }}/{{ progress().total }} sub-tarefas</span> }
            </span>
          }
        </div>
        <button mat-icon-button mat-dialog-close aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </header>
      <nav class="wi-tabs" role="tablist">
        <button class="wi-tab" role="tab" [class.wi-tab--on]="tab() === 'overview'" (click)="tab.set('overview')">Visão geral</button>
        <button class="wi-tab" role="tab" [class.wi-tab--on]="tab() === 'tasks'" (click)="tab.set('tasks')">Sub-tarefas<small>{{ item()?.tasks?.length ?? '' }}</small></button>
        <button class="wi-tab" role="tab" [class.wi-tab--on]="tab() === 'history'" (click)="tab.set('history')">Histórico<small>{{ item()?.logs?.length || '' }}</small></button>
      </nav>
      <div class="wi-dlg__body">
        @if (error()) { <p class="wi-err">{{ error() }}</p> }
        @if (item(); as it) {
          @switch (tab()) {
            @case ('overview') {
              @if (busyItem()) {
                <div class="wi-note"><mat-icon class="wi-spin">autorenew</mat-icon><span>{{ it.activity || (it.status === 'queued' ? 'Na fila do executor…' : it.status === 'reverting' ? 'Desfazendo…' : 'Executando…') }}</span></div>
              }
              @if (it.cancelReason) {
                <div class="wi-note wi-note--warn"><mat-icon>info</mat-icon><span>Cancelado: {{ it.cancelReason }}</span></div>
              }
              <section class="wi-sec">
                <h4 class="wi-sec__title">Descrição</h4>
                @if (it.description) { <div class="wi-md" [innerHTML]="it.description | planMarkdown:'card'"></div> }
                @else { <p class="wi-muted wid__p">Sem descrição.</p> }
              </section>
              @if (it.links.length) {
                <section class="wi-sec">
                  <h4 class="wi-sec__title">Links</h4>
                  <div class="wi-links">
                    @for (l of it.links; track $index) {
                      @if (l.url) { <a class="wi-link" [href]="l.url" target="_blank" rel="noopener"><mat-icon>{{ linkIco(l.kind) }}</mat-icon>{{ l.title || l.url }}</a> }
                      @else { <span class="wi-link wi-muted"><mat-icon>{{ linkIco(l.kind) }}</mat-icon>{{ l.title }}</span> }
                    }
                  </div>
                </section>
              }
              <section class="wi-sec">
                <h4 class="wi-sec__title">Ligações</h4>
                <div class="wid__facts">
                  <span class="wi-chip"><mat-icon>style</mat-icon>Card {{ it.cardNumber }}</span>
                  @if (it.planId) {
                    <button class="wi-chip wid__btnchip" (click)="openPlan()" matTooltip="Abrir a aba Plano da Bancada"><mat-icon>account_tree</mat-icon>Plano {{ it.planPhase === 'analysis' ? 'de análise' : 'de correção' }}</button>
                  }
                  @if (it.templateKey) { <span class="wi-chip"><mat-icon>content_copy</mat-icon>Modelo {{ it.templateKey }}</span> }
                  @if (it.startedAt) { <span class="wi-muted">Início {{ it.startedAt | date:'dd/MM/yy HH:mm' }}</span> }
                  @if (it.completedAt) { <span class="wi-muted">Fim {{ it.completedAt | date:'dd/MM/yy HH:mm' }}</span> }
                </div>
              </section>
              @if (!it.editable && it.status !== 'cancelled' && it.status !== 'reverted') {
                <p class="wi-muted wid__p"><mat-icon class="wid__lock">lock</mat-icon>Já iniciado — para mudar, crie um novo a partir deste.</p>
              }
            }
            @case ('tasks') {
              @if (!it.tasks.length) { <p class="wi-muted wid__p">Sem sub-tarefas.</p> }
              <ol class="wid__tasks">
                @for (t of it.tasks; track t.id) {
                  <li class="wid__task">
                    <mat-icon class="wid__st" [style.color]="taskLook(t).color" [class.wi-spin]="taskLook(t).spin" [matTooltip]="taskLook(t).label">{{ taskLook(t).icon }}</mat-icon>
                    <button class="wid__task-main" (click)="openTask(t)">
                      <span class="wi-num">{{ num(t.number) }}</span>
                      <mat-icon class="wid__kind" [matTooltip]="kind(t).label">{{ kind(t).icon }}</mat-icon>
                      <span class="wid__task-title">{{ t.title }}</span>
                    </button>
                    <span class="wi-chip">{{ executor(t.executor) }}</span>
                    @for (a of quick(t); track a) {
                      <button mat-icon-button class="wid__qa" [disabled]="busyTask() === t.number" (click)="taskAct(t, a)" [matTooltip]="actionLook(a).label" [attr.aria-label]="actionLook(a).label"><mat-icon>{{ actionLook(a).icon }}</mat-icon></button>
                    }
                  </li>
                }
              </ol>
            }
            @case ('history') {
              @if (!(it.logs?.length)) { <p class="wi-muted wid__p">Sem registros ainda.</p> }
              <ul class="wid__logs">
                @for (l of logs(); track l.id) {
                  <li>
                    <span class="wid__log-at">{{ l.at | date:'dd/MM HH:mm' }}</span>
                    <span class="wid__log-body">
                      @if (l.taskNumber) { <span class="wi-num">{{ num(l.taskNumber) }}</span> }
                      <span [innerHTML]="l.text | planMarkdown"></span>
                      <small class="wi-muted">{{ l.actor }}@if (l.kind && l.kind !== 'info') { · {{ l.kind }} }</small>
                    </span>
                  </li>
                }
              </ul>
            }
          }
        } @else if (!error()) {
          <p class="wi-muted">Carregando…</p>
        }
      </div>
      @if (item(); as it) {
        <footer class="wi-dlg__foot">
          @if (canUndoIt()) { <button mat-button (click)="undo()" [disabled]="acting()"><mat-icon>undo</mat-icon>Desfazer</button> }
          @if (canCancelIt()) { <button mat-button (click)="cancel()" [disabled]="acting()"><mat-icon>stop_circle</mat-icon>Cancelar…</button> }
          <span class="wi-dlg__spacer"></span>
          @if (it.editable) {
            <button mat-stroked-button (click)="edit()" [disabled]="acting()"><mat-icon>edit</mat-icon>Editar</button>
          } @else {
            <button mat-stroked-button (click)="duplicate()" [disabled]="acting()" matTooltip="O item já foi iniciado: crie um novo a partir dele"><mat-icon>content_copy</mat-icon>Criar novo a partir deste</button>
          }
          @if (busyItem()) {
            <button mat-flat-button disabled><mat-icon class="wi-spin">autorenew</mat-icon>{{ it.status === 'queued' ? 'Na fila' : 'Executando' }}</button>
          } @else {
            <button mat-flat-button color="primary" (click)="execute()" [disabled]="!canRun() || acting()"><mat-icon>play_arrow</mat-icon>Executar</button>
          }
        </footer>
      }
    </div>
  `,
  styles: [WORK_DIALOG_STYLES, `
    .wid__type { width: 20px; height: 20px; }
    .wid__p { margin: 0; display: flex; align-items: center; gap: 6px; font-size: 12.5px; }
    .wid__lock { font-size: 15px; width: 15px; height: 15px; }
    .wid__facts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: 12px; }
    .wid__btnchip { background: transparent; cursor: pointer; font: inherit; font-size: 11px; }
    .wid__btnchip:hover { border-color: var(--mat-sys-primary); color: var(--mat-sys-on-surface); }
    .wid__tasks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
    .wid__task { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 8px; }
    .wid__task:hover { background: rgba(255,255,255,.04); }
    .wid__st { font-size: 17px; width: 17px; height: 17px; flex: none; }
    .wid__task-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; background: none; border: 0; color: inherit; font: inherit; text-align: left; cursor: pointer; padding: 2px 0; }
    .wid__task-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wid__task-main:hover .wid__task-title { text-decoration: underline; }
    .wid__kind { font-size: 16px; width: 16px; height: 16px; color: var(--cc-text-3); flex: none; }
    .wid__qa.mat-mdc-icon-button { width: 28px; height: 28px; padding: 2px; }
    .wid__qa mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .wid__logs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .wid__logs li { display: flex; gap: 10px; font-size: 12.5px; }
    .wid__log-at { flex: none; width: 76px; color: var(--cc-text-3); font-variant-numeric: tabular-nums; }
    .wid__log-body { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .wid__log-body p { display: inline; margin: 0; }
    .wid__log-body small { display: block; }
  `]
})
export class WorkItemDialogComponent {
  readonly data = inject<WorkItemDialogData>(MAT_DIALOG_DATA);
  private ref = inject(MatDialogRef<WorkItemDialogComponent>);
  private api = inject(WorkItemsService);
  private actions = inject(WorkItemActionsService);

  readonly item = signal<WorkItem | null>(this.data.item ?? null);
  readonly catalog = signal<WorkItemCatalog | null>(this.data.catalog ?? null);
  readonly tab = signal<WorkItemDialogTab>(this.data.tab ?? 'overview');
  readonly error = signal<string | null>(null);
  readonly acting = signal(false);
  readonly busyTask = signal<number | null>(null);

  readonly look = computed(() => itemStatusLook(this.item()?.status));
  readonly progress = computed(() => { const it = this.item(); return it ? itemProgress(it) : { done: 0, total: 0, pct: 0 }; });
  readonly typeIcon = computed(() => workItemTypeIcon(this.item()?.type ?? this.data.cardType));
  readonly typeLabel = computed(() => workItemTypeLabel(this.item()?.type ?? this.data.cardType));
  readonly busyItem = computed(() => { const it = this.item(); return !!it && isItemBusy(it); });
  readonly canRun = computed(() => { const it = this.item(); return !!it && canExecute(it); });
  readonly canCancelIt = computed(() => { const it = this.item(); return !!it && canCancel(it); });
  readonly canUndoIt = computed(() => { const it = this.item(); return !!it && canUndo(it); });
  /** Histórico do mais recente para o mais antigo. */
  readonly logs = computed(() => (this.item()?.logs ?? []).slice().sort((a, b) => (b.at > a.at ? 1 : b.at < a.at ? -1 : b.id - a.id)));

  readonly num = formatWorkNumber;
  readonly origin = originLabel;
  readonly originIco = originIcon;
  readonly executor = executorLabel;
  readonly linkIco = linkIcon;
  readonly taskLook = (t: WorkTask) => taskStatusLook(t.status);
  readonly kind = (t: WorkTask) => kindInfo(t.kind, this.catalog());
  readonly quick = (t: WorkTask) => userTaskActions(t).filter((a) => a === 'complete' || a === 'skip' || a === 'start');
  readonly actionLook = (a: WorkTaskAction) => TASK_ACTION_LABELS[a];

  private get cardType(): WorkItemType {
    return this.data.cardType ?? this.item()?.type ?? 'bug';
  }

  constructor() {
    this.reload();
    if (!this.catalog()) this.actions.catalogOrNull(this.data.card).then((c) => c && this.catalog.set(c));
    const stop = listenWorkItems(inject(WsService), this.data.card, (p) => {
      const it = this.item();
      if (!p || p.number == null || p.number === this.data.number || (p.taskNumber != null && it?.tasks.some((t) => t.number === p.taskNumber))) this.reload();
    });
    inject(DestroyRef).onDestroy(stop);
  }

  reload(): void {
    this.api.get(this.data.number).subscribe({
      next: (it) => { this.item.set(it); this.error.set(null); },
      error: (e) => { if (!this.item()) this.error.set(e.message); }
    });
  }

  openTask(t: WorkTask): void {
    const it = this.item();
    if (it) this.actions.openTask(this.data.card, it, t.number, this.catalog());
  }

  async taskAct(t: WorkTask, a: WorkTaskAction): Promise<void> {
    this.busyTask.set(t.number);
    const ok = await this.actions.taskAction(t, a);
    this.busyTask.set(null);
    if (ok) this.reload();
  }

  async execute(): Promise<void> {
    const it = this.item();
    if (!it) return;
    await this.run(() => this.actions.execute(it));
  }

  async edit(): Promise<void> {
    const it = this.item();
    if (!it) return;
    await this.run(async () => !!(await this.actions.edit(this.data.card, this.cardType, it)));
  }

  /** O item novo (cópia) abre no lugar deste. */
  async duplicate(): Promise<void> {
    const it = this.item();
    if (!it) return;
    this.acting.set(true);
    const copy = await this.actions.duplicateAndEdit(this.data.card, this.cardType, it);
    this.acting.set(false);
    if (copy) this.ref.close({ openNumber: copy.number });
  }

  async cancel(): Promise<void> {
    const it = this.item();
    if (!it) return;
    await this.run(() => this.actions.cancel(it));
  }

  async undo(): Promise<void> {
    const it = this.item();
    if (!it) return;
    await this.run(() => this.actions.undo(it));
  }

  openPlan(): void {
    this.actions.openPlan(this.item()?.number ?? this.data.number);
    this.ref.close();
  }

  private async run(fn: () => Promise<boolean>): Promise<void> {
    this.acting.set(true);
    try {
      if (await fn()) this.reload();
    } finally {
      this.acting.set(false);
    }
  }
}

/** Resultado do modal do item: `{ openNumber }` = abrir outro item (a cópia criada a partir deste). */
export type WorkItemDialogResult = { openNumber: number } | undefined;
