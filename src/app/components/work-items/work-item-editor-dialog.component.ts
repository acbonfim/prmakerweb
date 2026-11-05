import { Component, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { WorkItemsService } from '../../services/work-items.service';
import {
  CreateWorkItemRequest,
  TaskKindParam,
  WorkItem,
  WorkItemCatalog,
  WorkItemError,
  WorkItemTemplate,
  WorkItemType,
  WorkTaskExecutor,
  WorkTaskInput,
  formatWorkNumber,
  itemStatusLook,
  kindInfo,
  kindParams
} from './work-item.model';
import { WORK_DIALOG_STYLES } from './work-dialog.styles';
import { WI_BUG_ICON, WI_US_ICON } from '../../helpers/work-item-type-icons';

export interface WorkItemEditorDialogData {
  card: string;
  /** Tipo do card (padrão do item novo). */
  cardType: WorkItemType;
  /** Editar este item (só `pending`). Sem ele = criar. */
  item?: WorkItem | null;
  catalog?: WorkItemCatalog | null;
  /** Abre já com este modelo escolhido (criar). */
  templateKey?: string | null;
}

/** Item salvo (criado ou editado) ou `undefined` (desistiu). */
export type WorkItemEditorDialogResult = WorkItem | undefined;

interface TaskDraft {
  uid: number;
  /** Sub-tarefa existente (editar mantém o número — o servidor não recria). */
  number: number | null;
  stepKey: string | null;
  title: string;
  description: string;
  kind: string;
  executor: WorkTaskExecutor;
  params: Record<string, string>;
  /** Descrição aberta. */
  open: boolean;
}

let uidSeq = 0;

/** Rascunho a partir de uma sub-tarefa (do item ou do modelo). */
export function toTaskDraft(t: {
  number?: number | null; stepKey?: string | null; title: string; description?: string | null; kind: string;
  executor?: WorkTaskExecutor | null; params?: Record<string, string> | null;
}): TaskDraft {
  return {
    uid: ++uidSeq,
    number: t.number ?? null,
    stepKey: t.stepKey ?? null,
    title: t.title ?? '',
    description: t.description ?? '',
    kind: t.kind,
    executor: t.executor === 'user' ? 'user' : 'claude',
    params: { ...(t.params ?? {}) },
    open: !!t.description
  };
}

/** Rascunho → corpo da API (parâmetros vazios saem). */
export function toTaskInput(d: TaskDraft): WorkTaskInput {
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.params)) if (`${v ?? ''}`.trim()) params[k] = `${v}`.trim();
  return {
    ...(d.number ? { number: d.number } : {}),
    ...(d.stepKey ? { stepKey: d.stepKey } : {}),
    title: d.title.trim(), description: d.description.trim() || null, kind: d.kind, executor: d.executor, params
  };
}

/**
 * 0085: editor de item de trabalho — criar (modelo pronto do catálogo ou do zero) ou editar (só `pending`). Sub-tarefas
 * reordenáveis (setas), com kind/executor/título/descrição/parâmetros do kind. 409 `duplicate` mostra o item existente e
 * deixa "Criar mesmo assim" com o motivo. Abrir com `workDialogConfig(data, '820px')`.
 */
@Component({
  selector: 'app-work-item-editor-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="wi-dlg wie">
      <header class="wi-dlg__head">
        <mat-icon>{{ editing ? 'edit' : 'add_task' }}</mat-icon>
        <div class="wi-dlg__head-main">
          <span class="wi-dlg__title">{{ editing ? 'Editar item ' + num(data.item!.number) : 'Novo item de trabalho' }}</span>
          <span class="wi-dlg__sub">Card {{ data.card }}</span>
        </div>
        <button mat-icon-button mat-dialog-close aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </header>
      <div class="wi-dlg__body">
        @if (!editing) {
          <label class="wi-field">
            <span>Modelo</span>
            <select class="wi-select" [ngModel]="templateKey()" (ngModelChange)="applyTemplate($event)" [disabled]="!catalog()">
              <option [ngValue]="null">Começar do zero</option>
              @for (t of catalog()?.templates ?? []; track t.key) { <option [ngValue]="t.key">{{ t.title }}</option> }
            </select>
            @if (template()?.description; as d) { <small class="wi-muted">{{ d }}</small> }
            @if (!catalog() && !catalogError()) { <small class="wi-muted">Carregando modelos…</small> }
            @if (catalogError()) { <small class="wi-err">{{ catalogError() }}</small> }
          </label>
        }

        <div class="wie__row">
          <label class="wi-field wie__grow">
            <span>Título</span>
            <input class="wi-input" [(ngModel)]="title" maxlength="300" placeholder="Ex.: PR master → release-version">
          </label>
          @if (!editing) {
            <div class="wi-field">
              <span>Tipo</span>
              <div class="wie__seg" role="radiogroup">
                <button type="button" [class.on]="type() === 'bug'" (click)="type.set('bug')"><mat-icon [svgIcon]="bugIcon" class="wi-type"></mat-icon>Bug</button>
                <button type="button" [class.on]="type() === 'user-story'" (click)="type.set('user-story')"><mat-icon [svgIcon]="usIcon" class="wi-type"></mat-icon>User Story</button>
              </div>
            </div>
          }
        </div>

        <label class="wi-field">
          <span>Descrição (markdown)</span>
          <textarea class="wi-textarea" rows="3" [(ngModel)]="description" placeholder="O que este item entrega e por quê"></textarea>
        </label>

        <section class="wi-sec">
          <div class="wie__tasks-head">
            <h4 class="wi-sec__title">Sub-tarefas ({{ tasks().length }})</h4>
            <span class="wi-dlg__spacer"></span>
            <button mat-button type="button" (click)="addTask()"><mat-icon>add</mat-icon>Sub-tarefa</button>
          </div>
          @if (!tasks().length) { <p class="wi-muted wie__small">Nenhuma sub-tarefa — adicione os passos na ordem em que devem rodar.</p> }
          @for (t of tasks(); track t.uid; let i = $index; let first = $first; let last = $last) {
            <div class="wie__task">
              <div class="wie__task-head">
                <span class="wie__order">{{ i + 1 }}</span>
                @if (t.number) { <span class="wi-num wie__tnum">{{ num(t.number) }}</span> }
                <mat-icon class="wie__kind-ico">{{ kindOf(t.kind).icon }}</mat-icon>
                <select class="wi-select wie__kind" [(ngModel)]="t.kind" (ngModelChange)="touch()" aria-label="Tipo da sub-tarefa">
                  @for (k of kinds(); track k.kind) { <option [ngValue]="k.kind">{{ k.label }}</option> }
                </select>
                <select class="wi-select wie__exec" [(ngModel)]="t.executor" aria-label="Quem executa">
                  <option ngValue="claude">Claude</option>
                  <option ngValue="user">Você</option>
                </select>
                <span class="wi-dlg__spacer"></span>
                <button mat-icon-button type="button" [disabled]="first" (click)="move(i, -1)" matTooltip="Subir" aria-label="Subir"><mat-icon>arrow_upward</mat-icon></button>
                <button mat-icon-button type="button" [disabled]="last" (click)="move(i, 1)" matTooltip="Descer" aria-label="Descer"><mat-icon>arrow_downward</mat-icon></button>
                <button mat-icon-button type="button" (click)="remove(i)" matTooltip="Remover" aria-label="Remover"><mat-icon>delete_outline</mat-icon></button>
              </div>
              <input class="wi-input" [(ngModel)]="t.title" maxlength="300" placeholder="Título da sub-tarefa">
              @for (p of paramsOf(t); track p.key) {
                <label class="wi-field wie__param">
                  <span>{{ p.label }}@if (p.required) { * }</span>
                  <input class="wi-input" [ngModel]="t.params[p.key]" (ngModelChange)="t.params[p.key] = $event" [placeholder]="p.placeholder || ''">
                </label>
              }
              @if (t.open) {
                <textarea class="wi-textarea" rows="2" [(ngModel)]="t.description" placeholder="Descrição (opcional, markdown)"></textarea>
              } @else {
                <button type="button" class="wie__more" (click)="t.open = true; touch()">+ descrição</button>
              }
            </div>
          }
        </section>

        @if (duplicate(); as d) {
          <div class="wi-note wi-note--warn wie__dup">
            <mat-icon>content_copy</mat-icon>
            <div>
              <b>Já existe um item igual: {{ num(d.number) }} "{{ d.title }}"</b> ({{ statusLabel(d.status) }}).
              <br>Se for mesmo outro trabalho, diga o motivo e crie assim mesmo.
              <textarea class="wi-textarea" rows="2" [(ngModel)]="duplicateReason" placeholder="Motivo (obrigatório)"></textarea>
            </div>
          </div>
        }
        @if (error()) { <p class="wi-err">{{ error() }}</p> }
      </div>
      <footer class="wi-dlg__foot">
        <span class="wi-dlg__spacer"></span>
        <button mat-button mat-dialog-close>Voltar</button>
        @if (duplicate()) {
          <button mat-flat-button color="warn" [disabled]="saving() || !duplicateReason.trim()" (click)="save(true)"><mat-icon>content_copy</mat-icon>Criar mesmo assim</button>
        } @else {
          <button mat-flat-button color="primary" [disabled]="saving()" (click)="save(false)"><mat-icon>save</mat-icon>{{ editing ? 'Salvar' : 'Criar item' }}</button>
        }
      </footer>
    </div>
  `,
  styles: [WORK_DIALOG_STYLES, `
    .wie__row { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; }
    .wie__grow { flex: 1 1 260px; }
    .wie__seg { display: inline-flex; border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); border-radius: 8px; overflow: hidden; }
    .wie__seg button { display: inline-flex; align-items: center; gap: 6px; background: transparent; border: 0; color: var(--cc-text-2); font: inherit; font-size: 12.5px; padding: 6px 10px; cursor: pointer; }
    .wie__seg button.on { background: color-mix(in srgb, var(--mat-sys-primary) 16%, transparent); color: var(--mat-sys-on-surface); }
    .wie__tasks-head { display: flex; align-items: center; }
    .wie__task { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--cc-surface-border, rgba(255,255,255,.08)); background: color-mix(in srgb, var(--surface-2, #2e343f) 55%, transparent); }
    .wie__task-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .wie__tnum { font-size: 11.5px; }
    .wie__order { min-width: 18px; font-weight: 600; color: var(--cc-text-3); text-align: center; }
    .wie__kind-ico { font-size: 18px; width: 18px; height: 18px; color: var(--cc-text-2); }
    .wie__kind { width: auto; min-width: 140px; flex: 0 1 200px; padding: 4px 8px; }
    .wie__exec { width: auto; flex: 0 0 auto; padding: 4px 8px; }
    .wie__task-head .mat-mdc-icon-button { width: 32px; height: 32px; padding: 4px; }
    .wie__task-head .mat-mdc-icon-button mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .wie__param { flex-direction: row; align-items: center; gap: 8px; }
    .wie__param > span { flex: 0 0 120px; overflow: hidden; text-overflow: ellipsis; }
    .wie__more { align-self: flex-start; background: none; border: 0; color: var(--mat-sys-primary); font: inherit; font-size: 12px; cursor: pointer; padding: 0; }
    .wie__small { margin: 0; font-size: 12px; }
    .wie__dup > div { display: flex; flex-direction: column; gap: 6px; flex: 1; }
    @media (max-width: 640px) { .wie__param { flex-direction: column; align-items: stretch; } .wie__param > span { flex: none; } }
  `]
})
export class WorkItemEditorDialogComponent {
  readonly data = inject<WorkItemEditorDialogData>(MAT_DIALOG_DATA);
  private ref = inject(MatDialogRef<WorkItemEditorDialogComponent, WorkItemEditorDialogResult>);
  private api = inject(WorkItemsService);

  readonly editing = !!this.data.item;
  readonly bugIcon = WI_BUG_ICON;
  readonly usIcon = WI_US_ICON;
  readonly num = formatWorkNumber;

  readonly catalog = signal<WorkItemCatalog | null>(this.data.catalog ?? null);
  readonly catalogError = signal<string | null>(null);
  readonly templateKey = signal<string | null>(null);
  readonly template = computed<WorkItemTemplate | null>(() => this.catalog()?.templates?.find((t) => t.key === this.templateKey()) ?? null);
  readonly type = signal<WorkItemType>(this.data.item?.type ?? this.data.cardType ?? 'bug');
  readonly tasks = signal<TaskDraft[]>((this.data.item?.tasks ?? []).slice().sort((a, b) => a.order - b.order).map(toTaskDraft));
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly duplicate = signal<WorkItemError['existing'] | null>(null);
  /** Kinds do catálogo, mais os que as sub-tarefas já usam (catálogo mudou ou ainda não chegou). */
  readonly kinds = computed(() => {
    const list = (this.catalog()?.taskKinds ?? []).map((k) => ({ kind: `${k.kind}`, label: k.label || `${k.kind}` }));
    for (const t of this.tasks()) if (!list.some((k) => k.kind === t.kind)) list.push({ kind: t.kind, label: kindInfo(t.kind, this.catalog()).label });
    if (!list.length) list.push({ kind: 'manual', label: 'Manual' });
    return list;
  });

  title = this.data.item?.title ?? '';
  description = this.data.item?.description ?? '';
  duplicateReason = '';

  constructor() {
    if (!this.catalog()) {
      this.api.catalog(this.data.card).subscribe({
        next: (c) => { this.catalog.set(c); if (this.data.templateKey) this.applyTemplate(this.data.templateKey); },
        error: (e) => this.catalogError.set(e.message)
      });
    } else if (this.data.templateKey) {
      this.applyTemplate(this.data.templateKey);
    }
  }

  kindOf(kind: string) {
    return kindInfo(kind, this.catalog());
  }

  /** Campos do kind + os parâmetros que a sub-tarefa já tem fora do catálogo. */
  paramsOf(t: TaskDraft): TaskKindParam[] {
    const known = kindParams(t.kind, this.catalog());
    const extra = Object.keys(t.params).filter((k) => !known.some((p) => p.key === k)).map((k) => ({ key: k, label: k }));
    return [...known, ...extra];
  }

  statusLabel(status: string): string {
    return itemStatusLook(status).label.toLowerCase();
  }

  applyTemplate(key: string | null): void {
    this.templateKey.set(key);
    this.duplicate.set(null);
    const t = this.template();
    if (!t) return;
    this.title = t.title;
    this.description = t.description ?? '';
    if (t.type) this.type.set(t.type);
    this.tasks.set(t.tasks.map((x) => toTaskDraft({ ...x, number: null, stepKey: null, kind: `${x.kind}` })));
  }

  /** Sinaliza mudança num rascunho mutado no lugar (zoneless: o array novo redesenha). */
  touch(): void {
    this.tasks.update((l) => [...l]);
  }

  addTask(): void {
    const kind = this.kinds()[0]?.kind ?? 'manual';
    const def = this.catalog()?.taskKinds?.find((k) => k.kind === kind)?.executor;
    this.tasks.update((l) => [...l, toTaskDraft({ title: '', kind, executor: def ?? 'claude' })]);
  }

  remove(i: number): void {
    this.tasks.update((l) => l.filter((_, j) => j !== i));
  }

  move(i: number, delta: number): void {
    this.tasks.update((l) => {
      const j = i + delta;
      if (j < 0 || j >= l.length) return l;
      const next = [...l];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  private validate(): string | null {
    if (!this.title.trim()) return 'Dê um título ao item.';
    const tasks = this.tasks();
    const noTitle = tasks.findIndex((t) => !t.title.trim());
    if (noTitle >= 0) return `A sub-tarefa ${noTitle + 1} está sem título.`;
    for (const [i, t] of tasks.entries()) {
      const missing = kindParams(t.kind, this.catalog()).find((p) => p.required && !`${t.params[p.key] ?? ''}`.trim());
      if (missing) return `A sub-tarefa ${i + 1} precisa de "${missing.label}".`;
    }
    return null;
  }

  save(allowDuplicate: boolean): void {
    const invalid = this.validate();
    if (invalid) { this.error.set(invalid); return; }
    this.error.set(null);
    this.saving.set(true);
    const tasks = this.tasks().map(toTaskInput);
    const done = (it: WorkItem) => { this.saving.set(false); this.ref.close(it); };
    const fail = (e: WorkItemError) => {
      this.saving.set(false);
      if (e.code === 'duplicate' && !this.editing) {
        this.duplicate.set(e.existing ?? { number: 0, title: '—', status: 'pending' });
        this.error.set(null);
        return;
      }
      this.error.set(e.message);
    };

    if (this.editing) {
      this.api.update(this.data.item!.number, { title: this.title.trim(), description: this.description.trim() || null, tasks }).subscribe({ next: done, error: fail });
      return;
    }
    const req: CreateWorkItemRequest = {
      title: this.title.trim(),
      description: this.description.trim() || null,
      type: this.type(),
      templateKey: this.templateKey(),
      tasks,
      ...(allowDuplicate ? { allowDuplicate: true, duplicateReason: this.duplicateReason.trim() } : {})
    };
    this.api.create(this.data.card, req).subscribe({ next: done, error: fail });
  }
}
