import { Component, DestroyRef, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PlanMarkdownPipe } from '../execution-plan/plan-markdown.pipe';
import { CodeRefHostDirective } from '../code-ref/code-ref-host.directive';
import { WorkItemsService } from '../../services/work-items.service';
import { WsService } from '../../services/ws.service';
import {
  TASK_ACTION_LABELS,
  TICKET_ACTION_LABELS,
  TICKET_STATUS_DONE,
  TicketAction,
  TicketStatus,
  WorkItem,
  WorkItemCatalog,
  WorkTaskAction,
  currentTicket,
  deliverableUrls,
  deliverablesOf,
  executorLabel,
  isTicketTask,
  linkKey,
  formatWorkNumber,
  kindInfo,
  kindParams,
  outputEntries,
  taskLinkCiLook,
  taskLinkIcon,
  taskLinkStatusLook,
  taskLinks,
  taskStatusLook,
  ticketTaskActions,
  userTaskActions,
  canResolveWait
} from './work-item.model';
import { listenWorkItems } from './work-items-live';
import { WORK_DIALOG_STYLES } from './work-dialog.styles';
import { WorkItemFilesComponent } from './work-item-files.component';
import { WorkItemFilesStore } from './work-item-files.store';
import { WorkDeliverablesComponent } from './work-deliverables.component';
import { WorkEvidenceGalleryComponent } from './work-evidence-gallery.component';
import { filesOfTask } from './work-item-files';
import { WorkItemPickerSource } from '../work-item-pickers/work-item-picker-source.service';
import { paramDisplay, paramInput, paramLink, paramOptions } from '../work-item-pickers/param-input';

export interface WorkTaskDialogData {
  card: string;
  itemNumber: number;
  taskNumber: number;
  /** Item já carregado (mostra na hora; o modal recarrega e acompanha ao vivo). */
  item?: WorkItem | null;
  catalog?: WorkItemCatalog | null;
}

/**
 * 0085: modal da sub-tarefa (aberto de dentro do item ou da lista): tipo, executor, status, datas, descrição,
 * parâmetros, resultado, saídas e a informação de desfazer. Sub-tarefa do usuário ganha as ações (iniciar/concluir/
 * falhar/pular). Chamado na Bancada: chamados e PRs ligados à sub-tarefa com o status; a de chamado da pessoa ganha
 * "Anexar chamado" e o status do chamado (resolvido conclui a sub-tarefa sozinha) — "Concluir" fica como ação
 * secundária. Abrir com `workDialogConfig(data, '640px')`.
 */
@Component({
  selector: 'app-work-task-dialog',
  standalone: true,
  imports: [DatePipe, FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule, PlanMarkdownPipe, CodeRefHostDirective, WorkItemFilesComponent, WorkDeliverablesComponent, WorkEvidenceGalleryComponent],
  encapsulation: ViewEncapsulation.None,
  template: `
    <!-- 0087: links de código (ref:) e de itens da engenharia reversa/Base Solvace abrem o popover aqui também -->
    <div class="wi-dlg" [appCodeRefHost]="data.card">
      <header class="wi-dlg__head">
        <mat-icon class="wtd__kind">{{ kind().icon }}</mat-icon>
        <div class="wi-dlg__head-main">
          <span class="wi-dlg__title"><span class="wi-num">{{ num(data.taskNumber) }}</span> {{ task()?.title || 'Sub-tarefa' }}</span>
          <span class="wi-dlg__sub">
            <span>de <b>{{ num(data.itemNumber) }}</b> {{ item()?.title }}</span>
            @if (task(); as t) {
              <span class="wi-status" [style.color]="look().color"><mat-icon [class.wi-spin]="look().spin" [class.cime-bob]="look().bob">{{ look().icon }}</mat-icon>{{ look().label }}</span>
            }
          </span>
        </div>
        <button mat-icon-button mat-dialog-close aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </header>
      <div class="wi-dlg__body">
        @if (error()) { <p class="wi-err">{{ error() }}</p> }
        @if (task(); as t) {
          <div class="wtd__facts">
            <span class="wi-chip"><mat-icon>{{ kind().icon }}</mat-icon>{{ kind().label }}</span>
            <span class="wi-chip"><mat-icon>{{ t.executor === 'user' ? 'person' : 'smart_toy' }}</mat-icon>{{ executor(t.executor) }}</span>
            <span class="wi-chip">Ordem {{ t.order }}</span>
            @if (t.stepKey) { <span class="wi-chip" matTooltip="Etapa do plano ligada a esta sub-tarefa"><mat-icon>account_tree</mat-icon>{{ t.stepKey }}</span> }
            @if (t.startedAt) { <span class="wi-muted">Início {{ t.startedAt | date:'dd/MM/yy HH:mm' }}</span> }
            @if (t.completedAt) { <span class="wi-muted">Fim {{ t.completedAt | date:'dd/MM/yy HH:mm' }}</span> }
          </div>

          @if (t.description) {
            <section class="wi-sec"><h4 class="wi-sec__title">Descrição</h4><div class="wi-md" [innerHTML]="t.description | planMarkdown:'card'"></div></section>
          }

          @if (showGenerated()) {
            <!-- 0091: o que a sub-tarefa gerou de fato (PR, branch, código, chamado, card…) + os arquivos dela -->
            <section class="wi-sec wtd__gen">
              <h4 class="wi-sec__title">O que foi gerado @if (generatedCount()) { <small class="wi-muted">{{ generatedCount() }}</small> }</h4>
              <app-work-deliverables [deliverables]="taskDeliverables()" [card]="data.card" [itemNumber]="data.itemNumber" [compact]="true" />
              <app-work-evidence-gallery [store]="files" [taskNumber]="data.taskNumber" [card]="data.card" />
              @if (taskFiles()) {
                <h5 class="wtd__subtitle">Arquivos <small class="wi-muted">{{ taskFiles() }}</small></h5>
                <app-work-item-files [store]="files" [card]="data.card" [taskNumber]="data.taskNumber" [compact]="true" />
              }
              @if (!generatedCount()) { <p class="wi-muted wtd__small">Nada registrado nesta sub-tarefa.</p> }
            </section>
          }

          @if (params().length) {
            <section class="wi-sec">
              <h4 class="wi-sec__title">Parâmetros</h4>
              <table class="wi-table"><tbody>
                @for (p of params(); track p.key) {
                  <tr><td>{{ p.label }}</td><td>
                    @if (p.url) { <a class="wi-link" [href]="p.url" target="_blank" rel="noopener" matTooltip="Abrir no GitHub"><mat-icon>open_in_new</mat-icon><code>{{ p.display }}</code></a> }
                    @else if (p.long) { <span class="wtd__long">{{ p.display || '—' }}</span> }
                    @else { <code>{{ p.display || '—' }}</code> }
                  </td></tr>
                }
              </tbody></table>
            </section>
          }

          @if (links().length) {
            <section class="wi-sec">
              <h4 class="wi-sec__title">Chamados e PRs</h4>
              <div class="wtd__links">
                @for (l of links(); track l.url) {
                  <div class="wtd__link">
                    <mat-icon class="wtd__link-ico">{{ linkIco(l.kind) }}</mat-icon>
                    <a class="wi-link wtd__link-title" [href]="l.url" target="_blank" rel="noopener" [matTooltip]="l.url">{{ l.title || l.url }}</a>
                    @if (ciLook(l); as ci) { <span class="wi-chip" [style.color]="ci.color" [style.border-color]="ci.color"><mat-icon>{{ ci.icon }}</mat-icon>{{ ci.label }}</span> }
                    @if (linkLook(l); as st) { <span class="wi-chip" [style.color]="st.color" [style.border-color]="st.color"><mat-icon>{{ st.icon }}</mat-icon>{{ st.label }}</span> }
                  </div>
                }
              </div>
            </section>
          }

          @if (ticketActs().length) {
            <section class="wi-sec wtd__ticket">
              <h4 class="wi-sec__title">Chamado</h4>
              @if (ticket(); as tk) {
                @if ((tk.status || 'open') === 'open') {
                  <div class="wi-note wi-note--warn"><mat-icon>hourglass_top</mat-icon>
                    <span>Aguardando o chamado <b>{{ tk.title || tk.url }}</b>.</span></div>
                }
              }
              @if (ticketActs().includes('attach')) {
                <div class="wtd__ticket-form">
                  <label class="wi-field"><span>Link do chamado *</span>
                    <input class="wi-input" type="url" required [(ngModel)]="ticketUrl" (keydown.enter)="attachTicket()" placeholder="https://… (Freshservice, Jira, DevOps…)" /></label>
                  <label class="wi-field"><span>Título ou número (opcional)</span>
                    <input class="wi-input" [(ngModel)]="ticketTitle" (keydown.enter)="attachTicket()" placeholder="Ex.: #1234 — script de correção" /></label>
                </div>
              }
              <div class="wtd__ticket-acts">
                @for (a of ticketActs(); track a) {
                  @if (a === 'attach') {
                    <button mat-flat-button color="primary" [disabled]="busy() || !ticketUrl.trim()" (click)="attachTicket()"><mat-icon>{{ ticketLook(a).icon }}</mat-icon>{{ ticket() ? 'Anexar outro chamado' : ticketLook(a).label }}</button>
                  } @else if (a === 'resolved') {
                    <button mat-flat-button color="primary" [disabled]="busy()" (click)="setTicket(a)"><mat-icon>{{ ticketLook(a).icon }}</mat-icon>{{ ticketLook(a).label }}</button>
                  } @else {
                    <button mat-stroked-button [disabled]="busy()" (click)="setTicket(a)"><mat-icon>{{ ticketLook(a).icon }}</mat-icon>{{ ticketLook(a).label }}</button>
                  }
                }
              </div>
              <p class="wi-muted wtd__small">A sub-tarefa conclui sozinha quando o chamado for marcado como resolvido.</p>
            </section>
          }

          @if (t.result) {
            <section class="wi-sec"><h4 class="wi-sec__title">Resultado</h4><div class="wi-md" [innerHTML]="t.result | planMarkdown:'card'"></div></section>
          }

          @if (t.undo) {
            <section class="wi-sec">
              <h4 class="wi-sec__title">Como desfazer</h4>
              <div class="wi-note"><mat-icon>undo</mat-icon>
                <span><b>{{ t.undo.action }}</b>
                  @for (p of undoParams(); track p[0]) { <br><span class="wi-muted">{{ p[0] }}:</span> <code>{{ p[1] }}</code> }
                </span>
              </div>
            </section>
          } @else if (t.status === 'completed') {
            <p class="wi-muted wtd__small">Sem informação de desfazer — ao cancelar com desfazer, esta sub-tarefa fica como está.</p>
          }

          @if (outputs().length) {
            <!-- 0091: a saída crua (JSON da sub-tarefa) fica recolhida; o que importa está em "O que foi gerado" -->
            <details class="wtd__raw">
              <summary>Dados brutos</summary>
              <table class="wi-table"><tbody>
                @for (o of outputs(); track o.key) {
                  <tr><td>{{ o.key }}</td><td>
                    @if (o.url) { <a class="wi-link" [href]="o.value" target="_blank" rel="noopener"><mat-icon>open_in_new</mat-icon>{{ o.value }}</a> }
                    @else { {{ o.value }} }
                  </td></tr>
                }
              </tbody></table>
            </details>
          }

          @if (resolvable()) {
            <section class="wi-sec wtd__user">
              <h4 class="wi-sec__title">O Claude está esperando você</h4>
              <textarea class="wi-textarea" rows="2" [(ngModel)]="resultText"
                        placeholder="O que você fez para destravar (opcional — o Claude lê ao retomar)"></textarea>
            </section>
          }
          @if (actions().length) {
            <section class="wi-sec wtd__user">
              <h4 class="wi-sec__title">Sua parte</h4>
              <textarea class="wi-textarea" rows="2" [(ngModel)]="resultText" placeholder="Resultado / observação (opcional, markdown)"></textarea>
              @if (!taskFiles() && !files.unavailable()) {
                <!-- sem arquivos ainda: o anexar continua à mão (com arquivos, ele fica em "O que foi gerado") -->
                <app-work-item-files [store]="files" [card]="data.card" [taskNumber]="data.taskNumber" [compact]="true" />
              }
            </section>
          }
        } @else if (!error()) {
          <p class="wi-muted">Carregando…</p>
        }
      </div>
      @if (resolvable()) {
        <footer class="wi-dlg__foot">
          <span class="wi-dlg__spacer"></span>
          <button mat-flat-button color="primary" [disabled]="busy()" (click)="resolve()"
                  matTooltip="A sub-tarefa volta a andar e o Claude retoma o item de onde parou"><mat-icon>lock_open</mat-icon>Já resolvi — continuar</button>
        </footer>
      }
      @if (actions().length) {
        <footer class="wi-dlg__foot">
          <span class="wi-dlg__spacer"></span>
          @for (a of actions(); track a) {
            @if (ticketTask()) {
              <!-- chamado na Bancada: concluir sem chamado continua possível, como ação secundária -->
              <button mat-button [disabled]="busy()" (click)="act(a)"><mat-icon>{{ actionLook(a).icon }}</mat-icon>{{ actionLook(a).label }}</button>
            } @else {
              <button mat-stroked-button [disabled]="busy()" (click)="act(a)"><mat-icon>{{ actionLook(a).icon }}</mat-icon>{{ actionLook(a).label }}</button>
            }
          }
        </footer>
      }
    </div>
  `,
  styles: [WORK_DIALOG_STYLES, `
    .wtd__kind { color: var(--cc-text-2); }
    .wtd__facts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: 12px; }
    .wtd__small { font-size: 12px; margin: 0; }
    .wi-table code, .wi-note code { font-size: 12px; }
    .wtd__long { white-space: pre-wrap; }
    .wtd__links { display: flex; flex-direction: column; gap: 4px; }
    .wtd__link { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
    .wtd__link-ico { font-size: 17px; width: 17px; height: 17px; color: var(--cc-text-2); flex: none; }
    .wtd__link-title { flex: 1 1 200px; min-width: 0; }
    .wtd__ticket-form { display: grid; grid-template-columns: 2fr 1fr; gap: 8px; }
    @media (max-width: 560px) { .wtd__ticket-form { grid-template-columns: 1fr; } }
    .wtd__ticket-acts { display: flex; flex-wrap: wrap; gap: 8px; }
    .wtd__ticket-acts .mat-mdc-button-base mat-icon { margin-right: 4px; }
    .wtd__subtitle { margin: 4px 0 0; font-size: 12px; font-weight: 600; color: var(--cc-text-2); }
    .wtd__raw { font-size: 12.5px; }
    .wtd__raw summary { cursor: pointer; width: fit-content; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--cc-text-3); }
    .wtd__raw[open] summary { margin-bottom: 6px; }
  `]
})
export class WorkTaskDialogComponent {
  readonly data = inject<WorkTaskDialogData>(MAT_DIALOG_DATA);
  private api = inject(WorkItemsService);
  private snack = inject(MatSnackBar);
  private pickers = inject(WorkItemPickerSource);

  readonly item = signal<WorkItem | null>(this.data.item ?? null);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  resultText = '';
  /** Chamado na Bancada: formulário "Anexar chamado". */
  ticketUrl = '';
  ticketTitle = '';
  /** Rodada 5: arquivos do item (o componente filtra os desta sub-tarefa). */
  readonly files = new WorkItemFilesStore();
  readonly taskFiles = computed(() => filesOfTask(this.files.files(), this.data.taskNumber).length);

  readonly task = computed(() => this.item()?.tasks?.find((t) => t.number === this.data.taskNumber) ?? null);
  readonly look = computed(() => taskStatusLook(this.task()?.status));
  readonly kind = computed(() => kindInfo(this.task()?.kind, this.data.catalog));
  readonly actions = computed(() => { const t = this.task(); return t ? userTaskActions(t) : []; });
  /** "Já resolvi": sub-tarefa do Claude parada esperando a pessoa. */
  readonly resolvable = computed(() => { const t = this.task(); return !!t && canResolveWait(t); });
  /**
   * Parâmetros com o rótulo do catálogo (na ordem do catálogo; os de fora no fim), o valor legível (commits "card" =
   * todos os do card) e o link do GitHub para repositório/branch quando a URL base é conhecida.
   */
  readonly params = computed(() => {
    const t = this.task();
    if (!t) return [];
    const known = kindParams(t.kind, this.data.catalog);
    const values = t.params ?? {};
    const repo = `${values['repository'] ?? ''}`.trim()
      || (this.item()?.tasks ?? []).map((x) => `${x.params?.['repository'] ?? ''}`.trim()).find(Boolean) || null;
    const base = this.pickers.githubUrl();
    const keys = [...known.map((p) => p.key).filter((k) => k in values), ...Object.keys(values).filter((k) => !known.some((p) => p.key === k))];
    return keys.map((key) => {
      const def = known.find((p) => p.key === key) ?? { key, label: key };
      const input = paramInput(def, t.kind);
      const value = `${values[key] ?? ''}`;
      return {
        key,
        label: def.label || key,
        display: paramDisplay(input, value, paramOptions(def)),
        url: paramLink(input, value, base, repo),
        long: input === 'textarea' || value.length > 80
      };
    });
  });
  /** Saídas da sub-tarefa (sem repetir as URLs dos chamados e PRs dela). */
  readonly outputs = computed(() => {
    const known = new Set(taskLinks(this.task()).map((l) => linkKey(l.url)));
    return outputEntries(this.task()?.output).filter((o) => !o.url || !known.has(linkKey(o.value)));
  });
  /**
   * Chamado na Bancada: links da sub-tarefa que "O que foi gerado" (0091) não mostra, o chamado em foco e as ações de
   * chamado (item aberto, na vez dela).
   */
  readonly links = computed(() => {
    const shown = new Set([...deliverableUrls(this.taskDeliverables())].map(linkKey));
    return taskLinks(this.task()).filter((l) => !shown.has(linkKey(l.url)));
  });
  readonly ticket = computed(() => currentTicket(this.task()));
  readonly ticketTask = computed(() => isTicketTask(this.task()));
  readonly ticketActs = computed(() => ticketTaskActions(this.item(), this.task()));
  /** 0091: entregas desta sub-tarefa (vêm no GET do item). */
  readonly taskDeliverables = computed(() => deliverablesOf(this.item(), this.data.taskNumber));
  readonly generatedCount = computed(() => this.taskDeliverables().length + this.taskFiles());
  /** Com entrega ou arquivo, sempre; sem nada, só na concluída ("Nada registrado") — pendente/rodando esconde. */
  readonly showGenerated = computed(() => this.generatedCount() > 0 || this.task()?.status === 'completed');
  readonly undoParams = computed(() => Object.entries(this.task()?.undo?.params ?? {}));

  readonly num = formatWorkNumber;
  readonly executor = executorLabel;
  readonly actionLook = (a: WorkTaskAction) => TASK_ACTION_LABELS[a];
  readonly ticketLook = (a: TicketAction) => TICKET_ACTION_LABELS[a];
  readonly linkIco = taskLinkIcon;
  readonly linkLook = taskLinkStatusLook;
  readonly ciLook = taskLinkCiLook;

  constructor() {
    this.pickers.ensureGithubUrl(this.data.catalog);
    this.reload();
    this.files.watch(this.data.itemNumber, this.data.card);
    // 0091: `action: 'deliverable'` chega com o `number` do item — recarrega como os demais eventos do item.
    const stop = listenWorkItems(inject(WsService), this.data.card, (p) => {
      if (!p || p.number == null || p.number === this.data.itemNumber || p.taskNumber === this.data.taskNumber) this.reload();
    });
    inject(DestroyRef).onDestroy(stop);
  }

  reload(): void {
    this.api.get(this.data.itemNumber).subscribe({
      next: (it) => { this.item.set(it); this.error.set(null); },
      error: (e) => { if (!this.item()) this.error.set(e.message); }
    });
  }

  act(action: WorkTaskAction): void {
    const t = this.task();
    if (!t || this.busy()) return;
    this.busy.set(true);
    const result = this.resultText.trim() || null;
    this.api.taskAction(t.number, action, { result }).subscribe({
      next: () => {
        this.busy.set(false);
        this.resultText = '';
        this.snack.open(`${formatWorkNumber(t.number)}: ${TASK_ACTION_LABELS[action].label.toLowerCase()} — ok.`, 'Ok', { duration: 3000 });
        this.reload();
      },
      error: (e) => { this.busy.set(false); this.snack.open(e.message, 'Fechar', { duration: 8000 }); }
    });
  }

  /** "Já resolvi": devolve a sub-tarefa ao Claude (com a nota do que a pessoa fez) e o item é retomado. */
  resolve(): void {
    const t = this.task();
    if (!t || this.busy()) return;
    this.busy.set(true);
    this.api.resolveTask(t.number, this.resultText).subscribe({
      next: (it) => {
        this.busy.set(false);
        this.resultText = '';
        this.snack.open(`${formatWorkNumber(t.number)}: avisado — o Claude retoma o item.`, 'Ok', { duration: 3000 });
        if (it?.tasks) this.item.set(it); else this.reload();
      },
      error: (e) => { this.busy.set(false); this.snack.open(e.message, 'Fechar', { duration: 8000 }); }
    });
  }

  /** Chamado na Bancada: anexa o chamado (a sub-tarefa passa a aguardar o chamado). */
  attachTicket(): void {
    const t = this.task();
    const url = this.ticketUrl.trim();
    if (!t || !url || this.busy() || !this.ticketActs().includes('attach')) return;
    this.busy.set(true);
    this.api.attachTicket(t.number, { url, title: this.ticketTitle.trim() || null }).subscribe({
      next: (it) => {
        this.busy.set(false);
        this.ticketUrl = '';
        this.ticketTitle = '';
        this.snack.open(`${formatWorkNumber(t.number)}: chamado anexado — a sub-tarefa aguarda o chamado ser resolvido.`, 'Ok', { duration: 3500 });
        this.applyOrReload(it);
      },
      error: (e) => { this.busy.set(false); this.snack.open(e.message, 'Fechar', { duration: 8000 }); }
    });
  }

  /** Chamado na Bancada: status do chamado em foco (resolvido conclui a sub-tarefa). */
  setTicket(action: TicketAction): void {
    const t = this.task();
    if (!t || this.busy() || action === 'attach') return;
    const status: TicketStatus = action;
    this.busy.set(true);
    this.api.setTicketStatus(t.number, { status, linkId: this.ticket()?.id ?? null }).subscribe({
      next: (it) => {
        this.busy.set(false);
        this.snack.open(`${formatWorkNumber(t.number)}: ${TICKET_STATUS_DONE[status]}.`, 'Ok', { duration: 3500 });
        this.applyOrReload(it);
      },
      error: (e) => { this.busy.set(false); this.snack.open(e.message, 'Fechar', { duration: 8000 }); }
    });
  }

  /** O endpoint devolve o item atualizado: mostra na hora (sem item na resposta, recarrega). */
  private applyOrReload(it: WorkItem | null | undefined): void {
    if (it && it.number === this.data.itemNumber && Array.isArray(it.tasks)) { this.item.set(it); this.error.set(null); }
    else this.reload();
  }
}
