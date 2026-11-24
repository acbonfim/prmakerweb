import { Component, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Observable } from 'rxjs';
import { DevOpsService } from '../../services/devops.service';
import { canAccept } from './board.logic';
import { buildCreate, createFields, inputKind, missingRequired } from './card-edit.logic';
import { DevOpsFieldInputComponent } from './devops-field-input.component';
import { DevOpsTagsInputComponent } from './devops-tags-input.component';
import { BoardConfig, CardDetail, DevOpsFieldDef, DevOpsWorkItemType, devOpsErrorMessage, typeColorCss, typeIcon } from './devops.model';
import { DV_FORM_STYLES } from './devops.styles';

/** Opções do diálogo de criar card. */
export interface DevOpsCardCreateOptions {
  /** Épico da Mesa: o card novo entra nele como `created`. */
  epic?: number | null;
  team?: string | null;
  board?: string | null;
  /** Coluna inicial (o "+" da coluna do board): os tipos ficam restritos aos que a coluna aceita. */
  column?: string;
  lane?: string;
  /** Card pai (Parent). */
  parentId?: number;
}

const LAST_TYPE_KEY = 'dv-create-last-type';

/**
 * Abre o diálogo de criar card no DevOps (0099). Resolve com o card criado, ou `undefined` se a pessoa cancelar.
 */
export function openDevOpsCardCreate(dialog: MatDialog, opts: DevOpsCardCreateOptions = {}): Observable<CardDetail | undefined> {
  const phone = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 639.98px)').matches;
  return dialog.open<DevOpsCardCreateComponent, DevOpsCardCreateOptions, CardDetail>(DevOpsCardCreateComponent, {
    data: opts ?? {},
    autoFocus: false,
    ...(phone
      ? { width: '100vw', maxWidth: '100vw', height: '100dvh', maxHeight: '100dvh', panelClass: ['custom-dialog-container', 'cime-dialog--full'] }
      : { width: '680px', maxWidth: '96vw', maxHeight: '92vh', panelClass: 'custom-dialog-container' }),
  }).afterClosed();
}

/**
 * 0099 (Mesa de gestão): criar card no DevOps — tipo (dos tipos do projeto, com cor/ícone), título, campos
 * obrigatórios do tipo + comuns (responsável, área, iteração, prioridade, descrição), tags, pai opcional e o aviso de
 * que entra no épico atual. Gravação pela integração pessoal de quem cria.
 */
@Component({
  selector: 'app-devops-card-create',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule,
    DevOpsFieldInputComponent, DevOpsTagsInputComponent],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="dvc" (keydown.control.enter)="save()" (keydown.meta.enter)="save()">
      <header class="dvc__head">
        <mat-icon>add_task</mat-icon>
        <span class="dvc__title">Novo card no DevOps</span>
        <span class="dvc__spacer"></span>
        <button mat-icon-button type="button" mat-dialog-close aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </header>
      @if (loading()) { <mat-progress-bar mode="indeterminate" class="dvc__progress" /> } @else { <div class="dvc__progress"></div> }

      <div class="dvc__body">
        @if (data.epic) {
          <div class="dvc__note"><mat-icon>space_dashboard</mat-icon><span>Será adicionado ao épico <b>#{{ data.epic }}</b>.</span></div>
        }
        @if (data.column) {
          <div class="dvc__note dvc__note--soft">
            <mat-icon>view_column</mat-icon>
            <span>Entra na coluna <b>{{ data.column }}</b>@if (data.lane) { · lane <b>{{ data.lane }}</b> }@if (data.board) { do board {{ data.board }} }.</span>
          </div>
        }

        <div class="dv-field">
          <span class="dv-field__label">Tipo <b>*</b></span>
          <div class="dvc__types" role="radiogroup" aria-label="Tipo do card">
            @for (t of typeOptions(); track t.name) {
              <button type="button" class="dvc__type" role="radio" [attr.aria-checked]="t.name === type()" [class.dvc__type--on]="t.name === type()"
                      (click)="pickType(t.name)" [matTooltip]="t.description || ''" [matTooltipDisabled]="!t.description" matTooltipShowDelay="600">
                <mat-icon [style.color]="color(t)">{{ icon(t) }}</mat-icon>{{ t.name }}
              </button>
            } @empty {
              @if (!loading()) { <span class="dv-hint">{{ typesError() || 'Nenhum tipo disponível.' }}</span> }
            }
          </div>
        </div>

        <label class="dv-field">
          <span class="dv-field__label">Título <b>*</b></span>
          <input class="dv-input" [ngModel]="title()" (ngModelChange)="title.set($event)" maxlength="255" placeholder="Título do card"
                 aria-label="Título" autocomplete="off">
        </label>

        @if (type()) {
          @if (fieldsError(); as fe) { <span class="dv-hint dv-hint--warn">{{ fe }}</span> }
          <div class="dvc__grid">
            @for (f of fields(); track f.referenceName) {
              <div class="dv-field" [class.dvc__wide]="wide(f)">
                <span class="dv-field__label">{{ f.name }}@if (f.required) { <b>*</b> }</span>
                <app-devops-field-input [field]="f" [value]="values()[f.referenceName]" (valueChange)="setValue(f.referenceName, $event)" />
                @if (f.helpText) { <span class="dv-field__help">{{ f.helpText }}</span> }
              </div>
            }
            <div class="dv-field dvc__wide">
              <span class="dv-field__label">Tags</span>
              <app-devops-tags-input [(tags)]="tags" />
            </div>
            <label class="dv-field">
              <span class="dv-field__label">Card pai (opcional)</span>
              <input class="dv-input" type="number" min="1" [ngModel]="parentId()" (ngModelChange)="parentId.set($event ? +$event : null)"
                     placeholder="Id do card pai" aria-label="Card pai">
            </label>
          </div>
        }

        @if (error(); as e) { <div class="dv-err">{{ e }}</div> }
      </div>

      <footer class="dvc__foot">
        @if (missing().length) {
          <span class="dv-hint dv-hint--warn">Falta preencher: {{ missing().join(', ') }}</span>
        } @else {
          <span class="dv-hint">Ctrl+Enter cria</span>
        }
        <span class="dvc__spacer"></span>
        <button mat-button type="button" mat-dialog-close>Cancelar</button>
        <button mat-flat-button color="primary" type="button" (click)="save()" [disabled]="!canSave()">
          {{ saving() ? 'Criando…' : 'Criar card' }}
        </button>
      </footer>
    </div>
  `,
  styles: [DV_FORM_STYLES, `
    .dvc { display: flex; flex-direction: column; max-height: 92vh; min-height: 0; }
    .dvc__head { display: flex; align-items: center; gap: 8px; padding: 10px 12px 8px 16px; background: var(--surface-2, #2e343f); }
    .dvc__title { font-size: 15px; font-weight: 600; }
    .dvc__spacer { flex: 1; }
    .dvc__progress { height: 2px; flex: none; }
    .dvc__body { padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; overflow: auto; min-height: 0; }
    .dvc__note { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 10px; font-size: 12.5px;
      background: color-mix(in srgb, var(--mat-sys-primary) 8%, transparent); border: 1px solid color-mix(in srgb, var(--mat-sys-primary) 25%, transparent); }
    .dvc__note mat-icon { font-size: 17px; width: 17px; height: 17px; flex: none; }
    .dvc__note--soft { background: transparent; }
    .dvc__types { display: flex; flex-wrap: wrap; gap: 6px; }
    .dvc__type { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px 4px 6px; border-radius: 8px; cursor: pointer; font: inherit; font-size: 12.5px;
      background: none; color: var(--cc-text-2); border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); }
    .dvc__type mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .dvc__type--on { color: var(--cc-text-1); border-color: var(--mat-sys-primary); background: color-mix(in srgb, var(--mat-sys-primary) 14%, transparent); }
    .dvc__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; }
    .dvc__wide { grid-column: 1 / -1; }
    @media (max-width: 560px) { .dvc__grid { grid-template-columns: minmax(0, 1fr); } }
    .dvc__foot { display: flex; align-items: center; gap: 8px; padding: 8px 16px 12px; border-top: 1px solid var(--cc-surface-border, rgba(255,255,255,.08)); flex-wrap: wrap; }
  `]
})
export class DevOpsCardCreateComponent {
  private api = inject(DevOpsService);
  private ref = inject(MatDialogRef<DevOpsCardCreateComponent, CardDetail>);
  readonly data = inject<DevOpsCardCreateOptions>(MAT_DIALOG_DATA) ?? {};

  readonly types = signal<DevOpsWorkItemType[]>([]);
  readonly typesError = signal<string | null>(null);
  private boardConfig = signal<BoardConfig | null>(null);
  readonly type = signal<string | null>(null);
  readonly title = signal('');
  readonly fields = signal<DevOpsFieldDef[]>([]);
  private allDefs = signal<DevOpsFieldDef[]>([]);
  readonly fieldsError = signal<string | null>(null);
  readonly values = signal<Record<string, unknown>>({});
  readonly tags = signal<string[]>([]);
  readonly parentId = signal<number | null>(this.data.parentId ?? null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  /** Tipos habilitados; com coluna inicial, só os que a coluna aceita. */
  readonly typeOptions = computed(() => {
    const list = this.types().filter((t) => !t.isDisabled);
    const cfg = this.boardConfig();
    const col = this.data.column && cfg ? cfg.columns.find((c) => c.name === this.data.column) : null;
    return col ? list.filter((t) => canAccept(col, t.name)) : list;
  });

  readonly missing = computed(() => {
    const out: string[] = [];
    if (!this.type()) out.push('Tipo');
    if (!this.title().trim()) out.push('Título');
    return [...out, ...missingRequired(this.allDefs(), this.values())];
  });

  readonly canSave = computed(() => !this.saving() && !this.loading() && !this.missing().length);

  constructor() {
    this.loading.set(true);
    this.api.types().subscribe({
      next: (t) => {
        this.types.set(t ?? []);
        this.loading.set(false);
        this.chooseDefaultType();
      },
      error: (e) => { this.typesError.set(devOpsErrorMessage(e, 'Não foi possível listar os tipos do projeto.')); this.loading.set(false); }
    });
    if (this.data.column && this.data.team && this.data.board) {
      this.api.board(this.data.team, this.data.board).subscribe({
        next: (cfg) => { this.boardConfig.set(cfg); this.chooseDefaultType(); },
        error: () => {}
      });
    }
  }

  private chooseDefaultType(): void {
    const opts = this.typeOptions();
    if (!opts.length) return;
    const cur = this.type();
    if (cur && opts.some((t) => t.name === cur)) return;
    let last: string | null = null;
    try { last = localStorage.getItem(LAST_TYPE_KEY); } catch { /* sem armazenamento */ }
    const pick = opts.find((t) => t.name === last) ?? opts.find((t) => t.name === 'User Story') ?? opts[0];
    this.pickType(pick.name);
  }

  color(t: DevOpsWorkItemType): string { return typeColorCss(t.color); }
  icon(t: DevOpsWorkItemType): string { return typeIcon(t.icon, t.name); }

  wide(f: DevOpsFieldDef): boolean {
    const k = inputKind(f);
    return k === 'html' || k === 'multiline';
  }

  pickType(name: string): void {
    if (this.type() === name && this.allDefs().length) return;
    this.type.set(name);
    try { localStorage.setItem(LAST_TYPE_KEY, name); } catch { /* sem armazenamento */ }
    this.fieldsError.set(null);
    this.loading.set(true);
    this.api.fields(name).subscribe({
      next: (defs) => {
        if (this.type() !== name) return;
        const list = defs ?? [];
        const shown = createFields(list);
        // Mantém o que já foi preenchido nos campos que o tipo novo também tem; aplica os padrões do tipo.
        const prev = this.values();
        const next: Record<string, unknown> = {};
        for (const f of shown) {
          if (prev[f.referenceName] != null && prev[f.referenceName] !== '') next[f.referenceName] = prev[f.referenceName];
          else if (f.defaultValue != null && f.defaultValue !== '') next[f.referenceName] = f.defaultValue;
        }
        this.allDefs.set(shown);
        this.fields.set(shown);
        this.values.set(next);
        this.loading.set(false);
      },
      error: (e) => {
        this.fieldsError.set(devOpsErrorMessage(e, 'Não foi possível carregar os campos do tipo — o card sai só com título e tags.'));
        this.allDefs.set([]);
        this.fields.set([]);
        this.loading.set(false);
      }
    });
  }

  setValue(ref: string, v: unknown): void {
    this.values.update((m) => ({ ...m, [ref]: v }));
  }

  save(): void {
    const type = this.type();
    if (!this.canSave() || !type) return;
    this.saving.set(true);
    this.error.set(null);
    const body = buildCreate(type, this.title(), this.allDefs(), this.values(), this.tags(), {
      parentId: this.parentId() || null,
      epic: this.data.epic ?? null,
      team: this.data.team ?? null,
      board: this.data.board ?? null,
      column: this.data.column ?? null,
      lane: this.data.lane ?? null,
    });
    this.api.create(body).subscribe({
      next: (card) => { this.saving.set(false); this.ref.close(card); },
      error: (e) => { this.saving.set(false); this.error.set(devOpsErrorMessage(e, 'O DevOps não criou o card.')); }
    });
  }
}
