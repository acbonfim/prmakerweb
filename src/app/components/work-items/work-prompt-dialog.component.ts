import { Component, ViewEncapsulation, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { WORK_DIALOG_STYLES } from './work-dialog.styles';

export interface WorkPromptDialogData {
  title: string;
  icon?: string;
  /** Texto explicativo (pode ter quebras de linha). */
  text?: string;
  /** Com `input`, mostra uma caixa de texto e devolve o texto digitado. */
  input?: { label?: string; placeholder?: string; required?: boolean; rows?: number; value?: string };
  confirm: string;
  confirmIcon?: string;
  /** Botão de confirmar em vermelho. */
  danger?: boolean;
}

/** Texto digitado (com `input`), `true` (sem `input`) ou `undefined` (desistiu). */
export type WorkPromptDialogResult = string | true | undefined;

/** 0085: pergunta curta dos itens de trabalho (confirmar desfazer, motivo do duplicado, pedido ao especialista). */
@Component({
  selector: 'app-work-prompt-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatIconModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="wi-dlg">
      <header class="wi-dlg__head">
        @if (data.icon) { <mat-icon [class.wpd__danger]="data.danger">{{ data.icon }}</mat-icon> }
        <div class="wi-dlg__head-main"><span class="wi-dlg__title">{{ data.title }}</span></div>
        <button mat-icon-button mat-dialog-close aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </header>
      <div class="wi-dlg__body">
        @if (data.text) { <p class="wpd__text">{{ data.text }}</p> }
        @if (data.input; as inp) {
          <label class="wi-field">
            @if (inp.label) { <span>{{ inp.label }}</span> }
            <textarea class="wi-textarea" [rows]="inp.rows || 4" [(ngModel)]="value" [placeholder]="inp.placeholder || ''" maxlength="4000"
                      (keydown.control.enter)="confirm()" (keydown.meta.enter)="confirm()"></textarea>
          </label>
        }
      </div>
      <footer class="wi-dlg__foot">
        <span class="wi-dlg__spacer"></span>
        <button mat-button mat-dialog-close>Voltar</button>
        <button mat-flat-button [color]="data.danger ? 'warn' : 'primary'" (click)="confirm()" [disabled]="!!data.input?.required && !value.trim()">
          @if (data.confirmIcon) { <mat-icon>{{ data.confirmIcon }}</mat-icon> }{{ data.confirm }}
        </button>
      </footer>
    </div>
  `,
  styles: [WORK_DIALOG_STYLES, `
    .wpd__text { margin: 0; white-space: pre-line; line-height: 1.5; color: var(--cc-text-2); }
    .wpd__danger { color: #f47067; }
  `]
})
export class WorkPromptDialogComponent {
  readonly data = inject<WorkPromptDialogData>(MAT_DIALOG_DATA);
  private ref = inject(MatDialogRef<WorkPromptDialogComponent, WorkPromptDialogResult>);
  value = this.data.input?.value ?? '';

  confirm(): void {
    if (!this.data.input) { this.ref.close(true); return; }
    const v = this.value.trim();
    if (this.data.input.required && !v) return;
    this.ref.close(v);
  }
}
