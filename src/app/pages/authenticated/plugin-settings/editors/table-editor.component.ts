import { Component, computed, effect, input, model, output, signal, untracked } from '@angular/core';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SettingColumn, SettingField, SettingOption } from '../plugin-settings.model';
import { JsonEditorComponent } from './json-editor.component';
import {
  duplicateRow, extraProps, moveItem, newRow, parseTable, serializeTable, setCell, tableErrors, TableRow,
} from './structured-editors.logic';

let tableSeq = 0;

/**
 * Editor `table` (0086/FB): linhas com as colunas do catálogo (texto, texto longo, número, sim/não, lista de escolha,
 * lista). Valor gravado = array JSON de objetos ou, com `rowKey`, objeto `{chave: {…}}`. Incluir, excluir, duplicar e
 * reordenar (setas ou arrastar). Propriedades que não são colunas (ex.: um `kind` novo) ficam intactas em cada linha,
 * e o texto gravado só muda quando a estrutura muda. Valor ilegível (ou o pedido do admin) → modo "editar como JSON".
 */
@Component({
  selector: 'app-setting-table-editor',
  standalone: true,
  imports: [DragDropModule, TextFieldModule, MatButtonModule, MatCheckboxModule, MatIconModule, MatTooltipModule,
    JsonEditorComponent],
  styleUrls: ['./structured-editors.css'],
  template: `
    <div class="se">
      @if (mode() === 'json') {
        @if (loadError(); as err) {
          <div class="se__hint"><mat-icon>data_object</mat-icon>
            <span>O valor não pôde ser lido como tabela — edite como JSON. {{ err }}</span></div>
        }
        <app-setting-json-editor [field]="field()" [value]="value()" (valueChange)="onJsonChange($event)"
                                 [disabled]="isDisabled()" (invalid)="jsonError.set($event)" />
        <div class="se__bar">
          <button mat-stroked-button type="button" (click)="toTable()" [disabled]="!!loadError() || !!jsonError()"
                  [matTooltip]="loadError() || jsonError() ? 'Corrija o JSON para voltar à tabela' : ''">
            <mat-icon>table_rows</mat-icon> Editar como tabela
          </button>
        </div>
      } @else {
        @if (normalized()) {
          <div class="se__hint"><mat-icon>info</mat-icon>
            <span>O valor gravado está em literal JavaScript (aspas simples/chaves sem aspas). Ao salvar uma alteração
              ele passa a ser gravado como JSON — quem lê aceita os dois.</span></div>
        }

        <div class="se__grid" cdkDropList [cdkDropListDisabled]="isDisabled()" (cdkDropListDropped)="drop($event)"
             role="table" [attr.aria-label]="field().label">
          @if (rows().length) {
            <div class="se__head" role="row">
              <span class="se__lead"></span>
              @for (col of inlineColumns(); track col.key) {
                <span [class]="cellClass(col)" role="columnheader">{{ col.label }}@if (isRequired(col)) {<span class="se__req" aria-label="obrigatório">*</span>}</span>
              }
              @if (longColumns().length) { <span class="se__expand se__expand--head" role="columnheader">{{ longHeader() }}</span> }
              @if (anyExtras()) { <span class="se__extra-slot"></span> }
              <span class="se__actions se__actions--head"></span>
            </div>
          }

          @for (row of rows(); track row.uid; let i = $index; let first = $first; let last = $last) {
            <div class="se__row" [class.se__row--error]="errorByRow().has(i)" cdkDrag cdkDragLockAxis="y" role="row">
              <div class="se__row-main">
                <span class="se__lead"><mat-icon class="se__handle" cdkDragHandle matTooltip="Arrastar para reordenar"
                                                  aria-hidden="true">drag_indicator</mat-icon></span>

                @for (col of inlineColumns(); track col.key) {
                  <span [class]="cellClass(col)" role="cell">
                    @switch (col.type) {
                      @case ('bool') {
                        <mat-checkbox [checked]="row.text[col.key] === 'true'" [disabled]="isDisabled()"
                                      [attr.aria-label]="col.label"
                                      (change)="edit(row, col, $event.checked ? 'true' : 'false')" />
                      }
                      @case ('enum') {
                        @if (col.allowCustom) {
                          <input class="se__input" [class.se__input--error]="cellError(i, col)" [value]="row.text[col.key]"
                                 [attr.list]="listId(col)" [disabled]="isDisabled()" [attr.aria-label]="col.label"
                                 (input)="edit(row, col, $any($event.target).value)">
                        } @else {
                          <select class="se__input" [class.se__input--error]="cellError(i, col)" [disabled]="isDisabled()"
                                  [attr.aria-label]="col.label" (change)="edit(row, col, $any($event.target).value)">
                            @for (o of enumOptions(col, row.text[col.key]); track o.value) {
                              <option [value]="o.value" [selected]="o.value === row.text[col.key]">{{ o.label }}</option>
                            }
                          </select>
                        }
                      }
                      @default {
                        <input class="se__input" [class.se__input--error]="cellError(i, col)" [value]="row.text[col.key]"
                               [attr.inputmode]="col.type === 'number' ? 'decimal' : null"
                               [placeholder]="col.type === 'list' ? 'a, b, c' : ''" [disabled]="isDisabled()"
                               [attr.aria-label]="col.label" (input)="edit(row, col, $any($event.target).value)">
                      }
                    }
                  </span>
                }

                @if (longColumns().length) {
                  <button type="button" class="se__expand" (click)="toggle(row)" [attr.aria-expanded]="row.open"
                          [matTooltip]="row.open ? 'Recolher' : 'Abrir o texto'">
                    <mat-icon>{{ row.open ? 'expand_less' : 'expand_more' }}</mat-icon>
                    <span>{{ longPreview(row) }}</span>
                  </button>
                }

                @if (anyExtras()) {
                  <span class="se__extra-slot">
                    @if (extras(row); as ex) {
                      @if (ex.length) {
                        <span class="se__extra-props" tabindex="0"
                              [matTooltip]="'Propriedades sem coluna, mantidas como estão: ' + ex.join(', ')">+{{ ex.length }}</span>
                      }
                    }
                  </span>
                }

                <span class="se__actions">
                  <button mat-icon-button type="button" (click)="move(i, i - 1)" [disabled]="isDisabled() || first"
                          matTooltip="Subir" aria-label="Subir a linha"><mat-icon>arrow_upward</mat-icon></button>
                  <button mat-icon-button type="button" (click)="move(i, i + 1)" [disabled]="isDisabled() || last"
                          matTooltip="Descer" aria-label="Descer a linha"><mat-icon>arrow_downward</mat-icon></button>
                  <button mat-icon-button type="button" (click)="duplicate(i)" [disabled]="isDisabled()"
                          matTooltip="Duplicar" aria-label="Duplicar a linha"><mat-icon>content_copy</mat-icon></button>
                  <button mat-icon-button type="button" (click)="remove(i)" [disabled]="isDisabled()"
                          matTooltip="Excluir" aria-label="Excluir a linha"><mat-icon>delete_outline</mat-icon></button>
                </span>
              </div>

              @if (row.open) {
                <div class="se__row-extra">
                  @for (col of longColumns(); track col.key) {
                    <label [attr.for]="'ta-' + row.uid + '-' + col.key">{{ col.label }}@if (isRequired(col)) {<span class="se__req">*</span>}</label>
                    <textarea class="se__input" [class.se__input--error]="cellError(i, col)" [id]="'ta-' + row.uid + '-' + col.key"
                              cdkTextareaAutosize cdkAutosizeMinRows="3" cdkAutosizeMaxRows="16" [value]="row.text[col.key]"
                              [disabled]="isDisabled()" (input)="edit(row, col, $any($event.target).value)"></textarea>
                  }
                </div>
              }
            </div>
          } @empty {
            <div class="se__empty">Nenhuma linha.@if (field().default) { O código usa o padrão enquanto a lista estiver vazia.}</div>
          }
        </div>

        @for (col of datalistColumns(); track col.key) {
          <datalist [id]="listId(col)">
            @for (o of col.options ?? []; track o.value) { <option [value]="o.value">{{ o.label }}</option> }
          </datalist>
        }

        @if (errors()[0]; as err) {
          <div class="se__msg se__msg--error" role="alert"><mat-icon>error_outline</mat-icon>
            <span>{{ err.message }}@if (errors().length > 1) { (e mais {{ errors().length - 1 }})}</span></div>
        }

        <div class="se__bar">
          <button mat-stroked-button type="button" (click)="add()" [disabled]="isDisabled()">
            <mat-icon>add</mat-icon> Incluir linha
          </button>
          <span class="se__spacer"></span>
          <span class="se__count">{{ rows().length }} linha{{ rows().length === 1 ? '' : 's' }}</span>
          <button mat-button type="button" (click)="mode.set('json')" matTooltip="Ver e editar o valor gravado como JSON">
            <mat-icon>data_object</mat-icon> Editar como JSON
          </button>
        </div>
      }
    </div>
  `,
})
export class TableEditorComponent {
  readonly field = input.required<SettingField>();
  /** String gravada. */
  readonly value = model.required<string>();
  readonly disabled = input(false);
  readonly invalid = output<string | null>();

  readonly isDisabled = computed(() => this.disabled() || this.field().pluginId === null);

  readonly rows = signal<TableRow[]>([]);
  readonly mode = signal<'table' | 'json'>('table');
  /** O valor gravado era literal JS (convertido para leitura). */
  readonly normalized = signal(false);
  /** O valor não vira tabela (JSON inválido ou raiz errada). */
  readonly loadError = signal<string | null>(null);
  /** Erro do editor JSON (modo JSON). */
  readonly jsonError = signal<string | null>(null);

  private readonly uid = ++tableSeq;
  /** Valor lido por último de fora — referência para não reformatar o que não mudou. */
  private baseline = '';
  /** Último texto que este editor gravou (o eco no `value` não relê as linhas). */
  private lastWritten: string | null = null;

  readonly columns = computed(() => this.field().columns ?? []);
  readonly inlineColumns = computed(() => this.columns().filter(c => c.type !== 'textarea'));
  readonly longColumns = computed(() => this.columns().filter(c => c.type === 'textarea'));
  readonly datalistColumns = computed(() => this.columns().filter(c => c.type === 'enum' && c.allowCustom));
  readonly anyExtras = computed(() => this.rows().some(r => extraProps(r, this.field()).length > 0));
  readonly longHeader = computed(() => this.longColumns().map(c => c.label).join(' · '));

  readonly errors = computed(() => tableErrors(this.rows(), this.field()));
  readonly errorByRow = computed(() => new Map(this.errors().map(e => [e.row, e.column])));

  readonly error = computed(() => this.mode() === 'json'
    ? this.jsonError() ?? this.loadError()
    : this.loadError() ?? this.errors()[0]?.message ?? null);

  private lastEmitted: string | null | undefined = undefined;

  constructor() {
    effect(() => {
      const v = this.value() ?? '';
      untracked(() => {
        if (v !== this.lastWritten) this.load(v);
      });
    });
    effect(() => {
      const err = this.error();
      if (err !== this.lastEmitted) {
        this.lastEmitted = err;
        this.invalid.emit(err);
      }
    });
  }

  // ── Tela ────────────────────────────────────────────────────────────────────────────────────

  cellClass(col: SettingColumn): string {
    if (col.type === 'bool') return 'se__cell se__cell--bool';
    const w = col.width === 'sm' || col.width === 'md' || col.width === 'lg' ? col.width : col.type === 'number' ? 'sm' : 'md';
    return `se__cell se__cell--${w}`;
  }

  isRequired(col: SettingColumn): boolean {
    return !!col.required || col.key === this.field().rowKey;
  }

  cellError(rowIndex: number, col: SettingColumn): boolean {
    return this.errorByRow().get(rowIndex) === col.key;
  }

  listId(col: SettingColumn): string {
    return `se-table-${this.uid}-${col.key}`;
  }

  /** Opções do enum + vazio (coluna opcional) + o valor atual se estiver fora da lista (nunca some na tela). */
  enumOptions(col: SettingColumn, current: string): SettingOption[] {
    const opts = [...(col.options ?? [])];
    if (!col.required && !opts.some(o => o.value === '')) opts.unshift({ value: '', label: '—' });
    if (current && !opts.some(o => o.value === current)) opts.push({ value: current, label: `${current} (atual)` });
    return opts.map(o => ({ value: o.value, label: o.label || o.value || '—' }));
  }

  longPreview(row: TableRow): string {
    const first = this.longColumns().map(c => row.text[c.key]?.trim()).find(Boolean);
    return first ? first.replace(/\s+/g, ' ') : '(vazio)';
  }

  extras(row: TableRow): string[] {
    return extraProps(row, this.field());
  }

  toggle(row: TableRow): void {
    row.open = !row.open;
    this.rows.update(list => [...list]);
  }

  // ── Edição ──────────────────────────────────────────────────────────────────────────────────

  edit(row: TableRow, col: SettingColumn, text: string): void {
    setCell(row, col, text);
    this.commit();
  }

  add(): void {
    const row = newRow(this.field());
    row.open = this.longColumns().length > 0;
    this.rows.update(list => [...list, row]);
    this.commit();
  }

  remove(index: number): void {
    this.rows.update(list => list.filter((_, i) => i !== index));
    this.commit();
  }

  duplicate(index: number): void {
    const list = this.rows();
    const copy = duplicateRow(list[index], list, this.field());
    this.rows.set([...list.slice(0, index + 1), copy, ...list.slice(index + 1)]);
    this.commit();
  }

  move(from: number, to: number): void {
    this.rows.set(moveItem(this.rows(), from, to));
    this.commit();
  }

  drop(event: CdkDragDrop<unknown>): void {
    if (event.previousIndex !== event.currentIndex) this.move(event.previousIndex, event.currentIndex);
  }

  onJsonChange(text: string): void {
    this.value.set(text);
  }

  toTable(): void {
    if (!this.loadError() && !this.jsonError()) this.mode.set('table');
  }

  // ── Leitura/gravação ────────────────────────────────────────────────────────────────────────

  private load(v: string): void {
    this.baseline = v;
    const result = parseTable(v, this.field());
    if (result.ok) {
      this.rows.set(result.rows);
      this.normalized.set(result.normalized);
      this.loadError.set(null);
    } else {
      this.rows.set([]);
      this.normalized.set(false);
      this.loadError.set(result.error ?? 'Valor inválido.');
      this.mode.set('json');
    }
  }

  private commit(): void {
    this.rows.update(list => [...list]);
    const text = serializeTable(this.rows(), this.field(), this.baseline);
    this.lastWritten = text;
    this.value.set(text);
  }
}
