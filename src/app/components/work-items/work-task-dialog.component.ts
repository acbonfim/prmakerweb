import { Component, DestroyRef, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PlanMarkdownPipe } from '../execution-plan/plan-markdown.pipe';
import { WorkItemsService } from '../../services/work-items.service';
import { WsService } from '../../services/ws.service';
import {
  TASK_ACTION_LABELS,
  WorkItem,
  WorkItemCatalog,
  WorkTaskAction,
  executorLabel,
  formatWorkNumber,
  kindInfo,
  kindParams,
  outputEntries,
  taskStatusLook,
  userTaskActions
} from './work-item.model';
import { listenWorkItems } from './work-items-live';
import { WORK_DIALOG_STYLES } from './work-dialog.styles';
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
 * falhar/pular). Abrir com `workDialogConfig(data, '640px')`.
 */
@Component({
  selector: 'app-work-task-dialog',
  standalone: true,
  imports: [DatePipe, FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule, PlanMarkdownPipe],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="wi-dlg">
      <header class="wi-dlg__head">
        <mat-icon class="wtd__kind">{{ kind().icon }}</mat-icon>
        <div class="wi-dlg__head-main">
          <span class="wi-dlg__title"><span class="wi-num">{{ num(data.taskNumber) }}</span> {{ task()?.title || 'Sub-tarefa' }}</span>
          <span class="wi-dlg__sub">
            <span>de <b>{{ num(data.itemNumber) }}</b> {{ item()?.title }}</span>
            @if (task(); as t) {
              <span class="wi-status" [style.color]="look().color"><mat-icon [class.wi-spin]="look().spin">{{ look().icon }}</mat-icon>{{ look().label }}</span>
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

          @if (t.result) {
            <section class="wi-sec"><h4 class="wi-sec__title">Resultado</h4><div class="wi-md" [innerHTML]="t.result | planMarkdown:'card'"></div></section>
          }

          @if (outputs().length) {
            <section class="wi-sec">
              <h4 class="wi-sec__title">Saídas</h4>
              <table class="wi-table"><tbody>
                @for (o of outputs(); track o.key) {
                  <tr><td>{{ o.key }}</td><td>
                    @if (o.url) { <a class="wi-link" [href]="o.value" target="_blank" rel="noopener"><mat-icon>open_in_new</mat-icon>{{ o.value }}</a> }
                    @else { {{ o.value }} }
                  </td></tr>
                }
              </tbody></table>
            </section>
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

          @if (actions().length) {
            <section class="wi-sec wtd__user">
              <h4 class="wi-sec__title">Sua parte</h4>
              <textarea class="wi-textarea" rows="2" [(ngModel)]="resultText" placeholder="Resultado / observação (opcional, markdown)"></textarea>
            </section>
          }
        } @else if (!error()) {
          <p class="wi-muted">Carregando…</p>
        }
      </div>
      @if (actions().length) {
        <footer class="wi-dlg__foot">
          <span class="wi-dlg__spacer"></span>
          @for (a of actions(); track a) {
            <button mat-stroked-button [disabled]="busy()" (click)="act(a)"><mat-icon>{{ actionLook(a).icon }}</mat-icon>{{ actionLook(a).label }}</button>
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

  readonly task = computed(() => this.item()?.tasks?.find((t) => t.number === this.data.taskNumber) ?? null);
  readonly look = computed(() => taskStatusLook(this.task()?.status));
  readonly kind = computed(() => kindInfo(this.task()?.kind, this.data.catalog));
  readonly actions = computed(() => { const t = this.task(); return t ? userTaskActions(t) : []; });
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
  readonly outputs = computed(() => outputEntries(this.task()?.output));
  readonly undoParams = computed(() => Object.entries(this.task()?.undo?.params ?? {}));

  readonly num = formatWorkNumber;
  readonly executor = executorLabel;
  readonly actionLook = (a: WorkTaskAction) => TASK_ACTION_LABELS[a];

  constructor() {
    this.pickers.ensureGithubUrl(this.data.catalog);
    this.reload();
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
}
