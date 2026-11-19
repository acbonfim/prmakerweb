import { Component, ViewEncapsulation, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { WORK_DIALOG_STYLES } from './work-dialog.styles';
import { WorkTask, formatWorkNumber } from './work-item.model';

export interface CancelTaskDialogData {
  task: Pick<WorkTask, 'number' | 'title'>;
  /** Ainda não feitas que dependem dela. */
  dependents: Pick<WorkTask, 'number' | 'title'>[];
}

export interface CancelTaskDialogResult {
  reason: string | null;
  dependents: 'cancel' | 'keep' | null;
}

/**
 * Card 78680: cancelar só uma sub-tarefa (o item segue). Com outras dependendo dela, a pessoa escolhe: cancelar junto ou
 * deixar que sigam sem ela.
 */
@Component({
  selector: 'app-cancel-task-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatIconModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="wi-dlg">
      <header class="wi-dlg__head">
        <mat-icon class="ctd__danger">cancel</mat-icon>
        <div class="wi-dlg__head-main"><span class="wi-dlg__title">Cancelar a sub-tarefa {{ num(data.task.number) }}?</span></div>
        <button mat-icon-button mat-dialog-close aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </header>
      <div class="wi-dlg__body">
        <p class="ctd__text">Só esta sub-tarefa é cancelada — <strong>{{ data.task.title }}</strong>. O item continua com as outras.</p>
        @if (data.dependents.length) {
          <fieldset class="ctd__choice">
            <legend>Dependem dela:</legend>
            <ul class="ctd__deps">
              @for (d of data.dependents; track d.number) { <li><span class="wi-num">{{ num(d.number) }}</span> {{ d.title }}</li> }
            </ul>
            <label><input type="radio" name="dep" value="cancel" [(ngModel)]="mode" /> Cancelar junto</label>
            <label><input type="radio" name="dep" value="keep" [(ngModel)]="mode" /> Manter — seguem sem ela</label>
          </fieldset>
        }
        <label class="wi-field">
          <span>Motivo (opcional)</span>
          <textarea class="wi-textarea" rows="2" [(ngModel)]="reason" maxlength="1000" placeholder="Por que não precisa mais"></textarea>
        </label>
      </div>
      <footer class="wi-dlg__foot">
        <span class="wi-dlg__spacer"></span>
        <button mat-button mat-dialog-close>Voltar</button>
        <button mat-flat-button color="warn" (click)="confirm()" [disabled]="data.dependents.length > 0 && !mode">
          <mat-icon>cancel</mat-icon>Cancelar sub-tarefa
        </button>
      </footer>
    </div>
  `,
  styles: [WORK_DIALOG_STYLES, `
    .ctd__text { margin: 0 0 10px; line-height: 1.5; color: var(--cc-text-2); }
    .ctd__danger { color: #f47067; }
    .ctd__choice { border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); border-radius: 10px; padding: 8px 12px 10px; margin: 0 0 12px;
      display: flex; flex-direction: column; gap: 6px; }
    .ctd__choice legend { padding: 0 4px; font-size: 12px; color: var(--cc-text-2); }
    .ctd__choice label { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 13px; }
    .ctd__deps { margin: 0 0 4px; padding-left: 18px; font-size: 12.5px; color: var(--cc-text-2); }
  `]
})
export class CancelTaskDialogComponent {
  readonly data = inject<CancelTaskDialogData>(MAT_DIALOG_DATA);
  private ref = inject(MatDialogRef<CancelTaskDialogComponent, CancelTaskDialogResult>);
  reason = '';
  mode: 'cancel' | 'keep' | '' = '';
  readonly num = formatWorkNumber;

  confirm(): void {
    if (this.data.dependents.length && !this.mode) return;
    this.ref.close({ reason: this.reason.trim() || null, dependents: this.data.dependents.length ? (this.mode || null) : null });
  }
}
