import { Component, computed, input, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { SettingField } from '../plugin-settings.model';
import { foldText } from '../plugin-settings.logic';

/** Editor `text` (0086/FA): uma linha; com `options`, sugestões num autocompletar (aceita qualquer texto). */
@Component({
  selector: 'app-setting-text-editor',
  standalone: true,
  imports: [FormsModule, MatAutocompleteModule, MatFormFieldModule, MatInputModule],
  styleUrls: ['./simple-editors.css'],
  template: `
    <mat-form-field appearance="outline" class="sx__full" subscriptSizing="dynamic">
      <input matInput [ngModel]="value()" (ngModelChange)="value.set($event ?? '')" [disabled]="disabled()"
             [placeholder]="field().default ? 'Padrão: ' + field().default : ''" [attr.aria-label]="field().label"
             [matAutocomplete]="auto" [matAutocompleteDisabled]="!suggestions().length" autocomplete="off" />
      <mat-autocomplete #auto="matAutocomplete">
        @for (o of suggestions(); track o.value) {
          <mat-option [value]="o.value">{{ o.label || o.value }}</mat-option>
        }
      </mat-autocomplete>
    </mat-form-field>
  `,
})
export class SettingTextEditorComponent {
  readonly field = input.required<SettingField>();
  readonly value = model.required<string>();
  readonly invalid = output<string | null>();
  readonly disabled = input(false);

  /** Sugestões que casam com o texto (todas quando o texto é uma delas). */
  readonly suggestions = computed(() => {
    const opts = this.field().options ?? [];
    const q = foldText(this.value());
    if (!q || opts.some(o => o.value === this.value())) return opts;
    return opts.filter(o => foldText(o.value).includes(q) || foldText(o.label).includes(q));
  });
}
