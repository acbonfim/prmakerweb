import { Component, computed, effect, input, model, output, signal, untracked } from '@angular/core';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SettingField } from '../plugin-settings.model';
import { JsonEditorComponent } from './json-editor.component';
import { MapEntry, moveItem, newMapEntry, parseMap, serializeMap, validateMap } from './structured-editors.logic';

/**
 * Editor `map` (0086/FB): objeto JSON chave → valor, em linhas (ex.: BranchSuffixByTarget destino → sufixo,
 * ReverseEngineeringTemplates documento → modelo markdown, ReverseEngineeringSupersedes seção → documentos).
 * `mapValueType`: `text` (uma linha), `textarea` (texto longo, linha expansível) ou `list` (lista de textos, digitada
 * separada por vírgula, gravada como array). Chave vazia ou repetida = erro. Também tem o modo "editar como JSON".
 */
@Component({
  selector: 'app-setting-map-editor',
  standalone: true,
  imports: [DragDropModule, TextFieldModule, MatButtonModule, MatIconModule, MatTooltipModule, JsonEditorComponent],
  styleUrls: ['./structured-editors.css'],
  template: `
    <div class="se">
      @if (mode() === 'json') {
        @if (loadError(); as err) {
          <div class="se__hint"><mat-icon>data_object</mat-icon>
            <span>O valor não pôde ser lido como pares chave → valor — edite como JSON. {{ err }}</span></div>
        }
        <app-setting-json-editor [field]="field()" [value]="value()" (valueChange)="value.set($event)"
                                 [disabled]="isDisabled()" (invalid)="jsonError.set($event)" />
        <div class="se__bar">
          <button mat-stroked-button type="button" (click)="toPairs()" [disabled]="!!loadError() || !!jsonError()"
                  [matTooltip]="loadError() || jsonError() ? 'Corrija o JSON para voltar aos pares' : ''">
            <mat-icon>table_rows</mat-icon> Editar como pares
          </button>
        </div>
      } @else {
        <div class="se__grid" cdkDropList [cdkDropListDisabled]="isDisabled()" (cdkDropListDropped)="drop($event)"
             role="table" [attr.aria-label]="field().label">
          @if (entries().length) {
            <div class="se__head" role="row">
              <span class="se__lead"></span>
              <span class="se__cell se__cell--md" role="columnheader">{{ keyLabel() }}<span class="se__req" aria-label="obrigatório">*</span></span>
              <span [class]="valueType() === 'textarea' ? 'se__expand se__expand--head' : 'se__cell se__cell--lg'" role="columnheader">{{ valueLabel() }}</span>
              <span class="se__actions se__actions--head" style="width: 90px"></span>
            </div>
          }

          @for (e of entries(); track e.uid; let i = $index; let first = $first; let last = $last) {
            <div class="se__row" [class.se__row--error]="errorIndex() === i" cdkDrag cdkDragLockAxis="y" role="row">
              <div class="se__row-main">
                <span class="se__lead"><mat-icon class="se__handle" cdkDragHandle matTooltip="Arrastar para reordenar"
                                                  aria-hidden="true">drag_indicator</mat-icon></span>
                <span class="se__cell se__cell--md" role="cell">
                  <input class="se__input" [class.se__input--error]="errorIndex() === i" [value]="e.key" [disabled]="isDisabled()"
                         [attr.aria-label]="keyLabel()" (input)="editKey(e, $any($event.target).value)">
                </span>
                @if (valueType() === 'textarea') {
                  <button type="button" class="se__expand" (click)="toggle(e)" [attr.aria-expanded]="e.open"
                          [matTooltip]="e.open ? 'Recolher' : 'Abrir o texto'">
                    <mat-icon>{{ e.open ? 'expand_less' : 'expand_more' }}</mat-icon>
                    <span>{{ preview(e) }}</span>
                  </button>
                } @else {
                  <span class="se__cell se__cell--lg" role="cell">
                    <input class="se__input" [value]="e.text" [disabled]="isDisabled()" [attr.aria-label]="valueLabel()"
                           [placeholder]="valueType() === 'list' ? 'a, b, c' : ''"
                           (input)="editValue(e, $any($event.target).value)">
                  </span>
                }
                <span class="se__actions">
                  <button mat-icon-button type="button" (click)="move(i, i - 1)" [disabled]="isDisabled() || first"
                          matTooltip="Subir" aria-label="Subir"><mat-icon>arrow_upward</mat-icon></button>
                  <button mat-icon-button type="button" (click)="move(i, i + 1)" [disabled]="isDisabled() || last"
                          matTooltip="Descer" aria-label="Descer"><mat-icon>arrow_downward</mat-icon></button>
                  <button mat-icon-button type="button" (click)="remove(i)" [disabled]="isDisabled()"
                          matTooltip="Excluir" aria-label="Excluir"><mat-icon>delete_outline</mat-icon></button>
                </span>
              </div>
              @if (valueType() === 'textarea' && e.open) {
                <div class="se__row-extra">
                  <textarea class="se__input se__mono" cdkTextareaAutosize cdkAutosizeMinRows="4" cdkAutosizeMaxRows="24"
                            [value]="e.text" [disabled]="isDisabled()" [attr.aria-label]="valueLabel() + ' de ' + e.key"
                            (input)="editValue(e, $any($event.target).value)"></textarea>
                </div>
              }
            </div>
          } @empty {
            <div class="se__empty">Nenhum item.@if (field().default) { O código usa o padrão enquanto estiver vazio.}</div>
          }
        </div>

        @if (error(); as err) {
          <div class="se__msg se__msg--error" role="alert"><mat-icon>error_outline</mat-icon><span>{{ err }}</span></div>
        }

        <div class="se__bar">
          <button mat-stroked-button type="button" (click)="add()" [disabled]="isDisabled()">
            <mat-icon>add</mat-icon> Incluir
          </button>
          <span class="se__spacer"></span>
          <span class="se__count">{{ entries().length }} ite{{ entries().length === 1 ? 'm' : 'ns' }}</span>
          <button mat-button type="button" (click)="mode.set('json')" matTooltip="Ver e editar o valor gravado como JSON">
            <mat-icon>data_object</mat-icon> Editar como JSON
          </button>
        </div>
      }
    </div>
  `,
})
export class MapEditorComponent {
  readonly field = input.required<SettingField>();
  /** String gravada. */
  readonly value = model.required<string>();
  readonly disabled = input(false);
  readonly invalid = output<string | null>();

  readonly isDisabled = computed(() => this.disabled() || this.field().pluginId === null);

  readonly entries = signal<MapEntry[]>([]);
  readonly mode = signal<'pairs' | 'json'>('pairs');
  readonly loadError = signal<string | null>(null);
  readonly jsonError = signal<string | null>(null);

  readonly keyLabel = computed(() => this.field().mapKeyLabel || 'Chave');
  readonly valueLabel = computed(() => this.field().mapValueLabel || 'Valor');
  readonly valueType = computed(() => this.field().mapValueType || 'text');

  readonly pairsError = computed(() => validateMap(this.entries(), this.field()));
  /** Linha com erro (para destacar). */
  readonly errorIndex = computed(() => {
    const m = /^Linha (\d+):/.exec(this.pairsError() ?? '');
    return m ? +m[1] - 1 : -1;
  });

  readonly error = computed(() => this.mode() === 'json'
    ? this.jsonError() ?? this.loadError()
    : this.loadError() ?? this.pairsError());

  private baseline = '';
  private lastWritten: string | null = null;
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

  preview(e: MapEntry): string {
    const t = e.text.trim();
    return t ? t.replace(/\s+/g, ' ') : '(vazio)';
  }

  toggle(e: MapEntry): void {
    e.open = !e.open;
    this.entries.update(list => [...list]);
  }

  editKey(e: MapEntry, key: string): void {
    e.key = key;
    this.commit();
  }

  editValue(e: MapEntry, text: string): void {
    e.text = text;
    this.commit();
  }

  add(): void {
    const entry = newMapEntry();
    entry.open = this.valueType() === 'textarea';
    this.entries.update(list => [...list, entry]);
    this.commit();
  }

  remove(index: number): void {
    this.entries.update(list => list.filter((_, i) => i !== index));
    this.commit();
  }

  move(from: number, to: number): void {
    this.entries.set(moveItem(this.entries(), from, to));
    this.commit();
  }

  drop(event: CdkDragDrop<unknown>): void {
    if (event.previousIndex !== event.currentIndex) this.move(event.previousIndex, event.currentIndex);
  }

  toPairs(): void {
    if (!this.loadError() && !this.jsonError()) this.mode.set('pairs');
  }

  private load(v: string): void {
    this.baseline = v;
    const result = parseMap(v, this.field());
    if (result.ok) {
      this.entries.set(result.entries);
      this.loadError.set(null);
    } else {
      this.entries.set([]);
      this.loadError.set(result.error ?? 'Valor inválido.');
      this.mode.set('json');
    }
  }

  /**
   * Grava o objeto. Com chave vazia/repetida o texto gravado não representaria as linhas (o objeto perde uma delas),
   * então o valor só é atualizado quando os pares são válidos — o erro segura o salvar enquanto isso.
   */
  private commit(): void {
    this.entries.update(list => [...list]);
    if (validateMap(this.entries(), this.field())) return;
    const text = serializeMap(this.entries(), this.field(), this.baseline);
    this.lastWritten = text;
    this.value.set(text);
  }
}
