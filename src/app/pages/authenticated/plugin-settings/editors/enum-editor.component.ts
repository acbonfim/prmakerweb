import { Component, computed, effect, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { SettingField } from '../plugin-settings.model';

/** Valor da opção "Outro valor…" no select (nunca gravado). */
const CUSTOM = '\u0000outro';

/**
 * Editor `enum` (0086/FA): lista de escolha. Com `allowCustom`, "Outro valor…" abre um campo livre. Valor gravado fora
 * da lista sem `allowCustom` aparece como opção própria, com aviso (o servidor recusaria gravá-lo de novo).
 */
@Component({
  selector: 'app-setting-enum-editor',
  standalone: true,
  imports: [FormsModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  styleUrls: ['./simple-editors.css'],
  template: `
    <div class="sx">
      <div class="sx__row">
        <mat-form-field appearance="outline" class="sx__select" subscriptSizing="dynamic">
          <mat-select [value]="selected()" (selectionChange)="onSelect($event.value)" [disabled]="disabled()"
                      [attr.aria-label]="field().label" placeholder="Escolha">
            @for (o of options(); track o.value) {
              <mat-option [value]="o.value">{{ o.label || o.value || '(vazio)' }}</mat-option>
            }
            @if (outOfList()) {
              <mat-option [value]="value()">{{ value() }} (fora da lista)</mat-option>
            }
            @if (field().allowCustom) {
              <mat-option [value]="custom">Outro valor…</mat-option>
            }
          </mat-select>
        </mat-form-field>
        @if (customMode()) {
          <mat-form-field appearance="outline" class="sx__select" subscriptSizing="dynamic">
            <input matInput [ngModel]="value()" (ngModelChange)="value.set($event ?? '')" [disabled]="disabled()"
                   placeholder="Valor" autocomplete="off" aria-label="Outro valor" />
          </mat-form-field>
        }
      </div>
      @if (outOfList()) {
        <span class="sx__msg sx__msg--warn"><mat-icon>warning_amber</mat-icon>
          O valor gravado não está na lista de opções.</span>
      }
    </div>
  `,
})
export class SettingEnumEditorComponent {
  readonly field = input.required<SettingField>();
  readonly value = model.required<string>();
  readonly invalid = output<string | null>();
  readonly disabled = input(false);

  readonly custom = CUSTOM;
  readonly options = computed(() => this.field().options ?? []);
  private readonly inList = computed(() => this.options().some(o => o.value === this.value()));

  /** Escolheu "Outro valor…" (ou o valor gravado é livre e a chave aceita). */
  readonly customChosen = signal(false);
  readonly customMode = computed(() =>
    !!this.field().allowCustom && (this.customChosen() || (!!this.value() && !this.inList())));
  readonly outOfList = computed(() => !this.field().allowCustom && !!this.value() && !this.inList());
  readonly selected = computed(() => (this.customMode() ? CUSTOM : this.value()));

  constructor() {
    // Voltou a um valor da lista (ex.: restaurar padrão) → sai do modo livre.
    effect(() => {
      if (this.inList() && this.customChosen() && !this.value()) return;
      if (this.inList()) this.customChosen.set(false);
    });
  }

  onSelect(v: string): void {
    if (v === CUSTOM) {
      this.customChosen.set(true);
      if (this.inList()) this.value.set('');
      return;
    }
    this.customChosen.set(false);
    this.value.set(v);
  }
}
