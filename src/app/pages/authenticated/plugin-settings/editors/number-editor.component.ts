import { Component, computed, effect, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { SettingField } from '../plugin-settings.model';
import { normalizeNumber } from '../plugin-settings.logic';

/**
 * Editor `number` (0086/FA): mínimo/máximo e unidade; aceita vírgula e grava invariante (`0,9` → `"0.9"`). Vazio é
 * aceito (o código usa o padrão).
 */
@Component({
  selector: 'app-setting-number-editor',
  standalone: true,
  imports: [FormsModule, MatFormFieldModule, MatIconModule, MatInputModule],
  styleUrls: ['./simple-editors.css'],
  template: `
    <div class="sx">
      <div class="sx__row">
        <mat-form-field appearance="outline" class="sx__number" subscriptSizing="dynamic">
          <input matInput inputmode="decimal" autocomplete="off" [ngModel]="text()" (ngModelChange)="onInput($event)"
                 [disabled]="disabled()" [attr.aria-label]="field().label" [attr.aria-invalid]="!!error()"
                 [placeholder]="field().default ? 'Padrão: ' + field().default : ''" />
          @if (field().unit) { <span matTextSuffix class="sx__unit">&nbsp;{{ field().unit }}</span> }
        </mat-form-field>
        @if (range()) { <span class="sx__unit">{{ range() }}</span> }
      </div>
      @if (error(); as err) {
        <span class="sx__msg sx__msg--error" role="alert"><mat-icon>error_outline</mat-icon>{{ err }}</span>
      } @else if (!value().trim()) {
        <span class="sx__msg sx__msg--info"><mat-icon>info</mat-icon>Vazio — o código usa o padrão.</span>
      }
    </div>
  `,
})
export class SettingNumberEditorComponent {
  readonly field = input.required<SettingField>();
  readonly value = model.required<string>();
  readonly invalid = output<string | null>();
  readonly disabled = input(false);

  /** O que está digitado (pode ser "0," no meio da digitação). */
  readonly text = signal('');

  readonly error = computed(() => {
    const v = this.value();
    if (!v.trim()) return null;
    const f = this.field();
    return normalizeNumber(v, f.min, f.max).error;
  });

  readonly range = computed(() => {
    const { min, max } = this.field();
    if (min != null && max != null) return `de ${min} a ${max}`;
    if (min != null) return `mínimo ${min}`;
    if (max != null) return `máximo ${max}`;
    return '';
  });

  private lastEmitted: string | null | undefined = undefined;

  constructor() {
    // Valor trocado de fora (restaurar padrão, descartar): o texto acompanha.
    effect(() => {
      const v = this.value();
      if (normalizeNumber(this.text(), null, null).value !== v && this.text() !== v) this.text.set(v);
    });
    effect(() => {
      const err = this.error();
      if (err !== this.lastEmitted) {
        this.lastEmitted = err;
        this.invalid.emit(err);
      }
    });
  }

  onInput(raw: string): void {
    const t = raw ?? '';
    this.text.set(t);
    if (!t.trim()) { this.value.set(''); return; }
    const r = normalizeNumber(t, null, null);
    this.value.set(r.error ? t.trim() : r.value);
  }
}
