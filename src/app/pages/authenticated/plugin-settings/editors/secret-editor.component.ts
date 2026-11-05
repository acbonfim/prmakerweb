import { Component, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SettingField } from '../plugin-settings.model';

/**
 * Editor `secret` (0086/FA): nunca mostra o valor gravado. "Alterar" abre um campo mascarado; vazio = não muda
 * (o valor do modelo é só o novo segredo).
 */
@Component({
  selector: 'app-setting-secret-editor',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatTooltipModule],
  styleUrls: ['./simple-editors.css'],
  template: `
    <div class="sx">
      @if (!editing()) {
        <div class="sx__row">
          <span class="sx__secret" [class.sx__secret--empty]="!field().hasValue">
            <mat-icon>{{ field().hasValue ? 'lock' : 'lock_open' }}</mat-icon>
            {{ field().hasValue ? 'Valor gravado (oculto)' : 'Não preenchido' }}
          </span>
          <button mat-stroked-button type="button" (click)="start()" [disabled]="disabled()">
            <mat-icon>edit</mat-icon> {{ field().hasValue ? 'Alterar' : 'Preencher' }}
          </button>
        </div>
      } @else {
        <div class="sx__row">
          <mat-form-field appearance="outline" class="sx__select" subscriptSizing="dynamic">
            <input matInput [type]="show() ? 'text' : 'password'" autocomplete="new-password" spellcheck="false"
                   [ngModel]="value()" (ngModelChange)="value.set($event ?? '')" [disabled]="disabled()"
                   placeholder="Novo valor" [attr.aria-label]="field().label" />
            <button mat-icon-button matSuffix type="button" (click)="show.set(!show())"
                    [matTooltip]="show() ? 'Esconder' : 'Mostrar o que digitou'">
              <mat-icon>{{ show() ? 'visibility_off' : 'visibility' }}</mat-icon>
            </button>
          </mat-form-field>
          <button mat-button type="button" (click)="cancel()">Cancelar</button>
        </div>
        <span class="sx__msg sx__msg--info"><mat-icon>info</mat-icon>Vazio não muda o valor gravado.</span>
      }
    </div>
  `,
})
export class SettingSecretEditorComponent {
  readonly field = input.required<SettingField>();
  readonly value = model.required<string>();
  readonly invalid = output<string | null>();
  readonly disabled = input(false);

  readonly editing = signal(false);
  readonly show = signal(false);

  ngOnInit(): void {
    // Já tem um valor novo pendente (ex.: voltou à seção): abre direto no campo.
    if (this.value()) this.editing.set(true);
  }

  start(): void {
    this.editing.set(true);
  }

  cancel(): void {
    this.value.set('');
    this.show.set(false);
    this.editing.set(false);
  }
}
