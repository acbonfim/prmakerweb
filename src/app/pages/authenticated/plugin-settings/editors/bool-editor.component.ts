import { Component, computed, input, model, output } from '@angular/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { SettingField } from '../plugin-settings.model';
import { formatBool, parseBool } from '../plugin-settings.logic';

/** Editor `bool` (0086/FA): interruptor; grava `"true"`/`"false"`. */
@Component({
  selector: 'app-setting-bool-editor',
  standalone: true,
  imports: [MatSlideToggleModule],
  styleUrls: ['./simple-editors.css'],
  template: `
    <mat-slide-toggle color="primary" [checked]="on()" (change)="value.set(format($event.checked))" [disabled]="disabled()"
                      [attr.aria-label]="field().label">
      {{ on() ? 'Ligado' : 'Desligado' }}
    </mat-slide-toggle>
  `,
})
export class SettingBoolEditorComponent {
  readonly field = input.required<SettingField>();
  readonly value = model.required<string>();
  readonly invalid = output<string | null>();
  readonly disabled = input(false);

  readonly on = computed(() => parseBool(this.value()));

  format(on: boolean): string {
    return formatBool(on);
  }
}
