import { Component, input, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { SettingField } from '../plugin-settings.model';

/** Editor `textarea` (0086/FA): texto de várias linhas que cresce com o conteúdo. */
@Component({
  selector: 'app-setting-textarea-editor',
  standalone: true,
  imports: [FormsModule, TextFieldModule, MatFormFieldModule, MatInputModule],
  styleUrls: ['./simple-editors.css'],
  template: `
    <mat-form-field appearance="outline" class="sx__full" subscriptSizing="dynamic">
      <textarea matInput cdkTextareaAutosize cdkAutosizeMinRows="3" cdkAutosizeMaxRows="24"
                [ngModel]="value()" (ngModelChange)="value.set($event ?? '')" [disabled]="disabled()"
                [attr.aria-label]="field().label"></textarea>
    </mat-form-field>
  `,
})
export class SettingTextareaEditorComponent {
  readonly field = input.required<SettingField>();
  readonly value = model.required<string>();
  readonly invalid = output<string | null>();
  readonly disabled = input(false);
}
