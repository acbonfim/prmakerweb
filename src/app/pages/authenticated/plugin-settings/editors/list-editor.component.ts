import { Component, Directive, computed, effect, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { COMMA, ENTER } from '@angular/cdk/keycodes';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatChipInputEvent, MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SettingField } from '../plugin-settings.model';
import { formatList, parseList } from '../plugin-settings.logic';

/**
 * Base dos editores de chips (`list` e `steps`): lê/grava no formato do leitor (`listFormat`: csv ou json). Valor
 * gravado que não dá para ler como lista (JSON quebrado) vira texto cru com o erro, sem perder nada.
 */
@Directive()
export abstract class ChipsEditorBase {
  readonly field = input.required<SettingField>();
  readonly value = model.required<string>();
  readonly invalid = output<string | null>();
  readonly disabled = input(false);

  readonly separators = [ENTER, COMMA];
  readonly draft = signal('');

  readonly parsed = computed(() => parseList(this.value(), this.field().listFormat));
  readonly items = computed(() => this.parsed().items);
  readonly error = computed(() => this.parsed().error);

  private lastEmitted: string | null | undefined = undefined;

  constructor() {
    effect(() => {
      const err = this.error();
      if (err !== this.lastEmitted) {
        this.lastEmitted = err;
        this.invalid.emit(err);
      }
    });
  }

  add(raw: string): void {
    const parts = (raw ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const list = [...this.items()];
    for (const p of parts) if (!list.includes(p)) list.push(p);
    this.value.set(formatList(list, this.field().listFormat));
    this.draft.set('');
  }

  onTokenEnd(e: MatChipInputEvent): void {
    this.add(e.value);
    e.chipInput?.clear();
  }

  remove(item: string): void {
    this.value.set(formatList(this.items().filter(x => x !== item), this.field().listFormat));
  }

  /** Move o item uma posição (a ordem importa em algumas listas). */
  move(item: string, delta: number): void {
    const list = [...this.items()];
    const i = list.indexOf(item);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.value.set(formatList(list, this.field().listFormat));
  }

  formatHint(): string {
    return this.field().listFormat === 'json' ? 'gravado como lista JSON' : 'gravado separado por vírgula';
  }
}

/** Editor `list` (0086/FA): chips; Enter ou vírgula inclui; grava em CSV ou lista JSON conforme `listFormat`. */
@Component({
  selector: 'app-setting-list-editor',
  standalone: true,
  imports: [FormsModule, TextFieldModule, MatChipsModule, MatFormFieldModule, MatIconModule, MatInputModule, MatTooltipModule],
  styleUrls: ['./simple-editors.css'],
  template: `
    <div class="sx">
      @if (error(); as err) {
        <mat-form-field appearance="outline" class="sx__full" subscriptSizing="dynamic">
          <textarea matInput class="sx__mono" cdkTextareaAutosize cdkAutosizeMinRows="2" cdkAutosizeMaxRows="12"
                    [ngModel]="value()" (ngModelChange)="value.set($event ?? '')" [disabled]="disabled()"
                    [attr.aria-label]="field().label"></textarea>
        </mat-form-field>
        <span class="sx__msg sx__msg--error" role="alert"><mat-icon>error_outline</mat-icon>{{ err }} Corrija o texto acima.</span>
      } @else {
        <mat-form-field appearance="outline" class="sx__chips" subscriptSizing="dynamic">
          <mat-chip-grid #grid [disabled]="disabled()" [attr.aria-label]="field().label">
            @for (item of items(); track item) {
              <mat-chip-row (removed)="remove(item)" [editable]="false">
                {{ item }}
                <button matChipRemove [attr.aria-label]="'Remover ' + item"><mat-icon>cancel</mat-icon></button>
              </mat-chip-row>
            }
            <input [matChipInputFor]="grid" [matChipInputSeparatorKeyCodes]="separators" [matChipInputAddOnBlur]="true"
                   (matChipInputTokenEnd)="onTokenEnd($event)" placeholder="Incluir…" autocomplete="off" />
          </mat-chip-grid>
        </mat-form-field>
        <span class="sx__msg sx__msg--info">{{ items().length }} item(ns) · {{ formatHint() }}</span>
      }
    </div>
  `,
})
export class SettingListEditorComponent extends ChipsEditorBase {}
