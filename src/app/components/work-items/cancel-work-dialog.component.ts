import { Component, ViewEncapsulation, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { formatWorkNumber } from './work-item.model';
import { WORK_DIALOG_STYLES } from './work-dialog.styles';

export interface CancelWorkDialogData {
  /** `item` = um item de trabalho; `plan` = o plano (e os itens dele). */
  kind: 'item' | 'plan';
  title: string;
  planId?: string;
  number?: number;
}

/** `undefined` = desistiu (Voltar/fechar). */
export type CancelWorkDialogResult = { undo: boolean; reason?: string } | undefined;

/**
 * 0085: cancelar um item de trabalho ou um plano, com a opção de desfazer o que já foi feito (fechar PRs, apagar
 * branches criadas, reverter o estado do card) — o desfazer roda pelo executor, em ordem reversa, sempre pelo PRMake.
 * Abrir com `workDialogConfig(data, '520px')`.
 */
@Component({
  selector: 'app-cancel-work-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatIconModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="wi-dlg cwd">
      <header class="wi-dlg__head">
        <mat-icon class="cwd__icon">stop_circle</mat-icon>
        <div class="wi-dlg__head-main">
          <span class="wi-dlg__title">Cancelar {{ data.kind === 'plan' ? 'o plano' : 'o item ' + num }}?</span>
          <span class="wi-dlg__sub">{{ data.title }}</span>
        </div>
        <button mat-icon-button mat-dialog-close aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </header>
      <div class="wi-dlg__body">
        <p class="cwd__lead">
          @if (data.kind === 'plan') {
            O plano para, os pedidos dele na fila saem e os itens de trabalho ligados a ele são cancelados junto.
          } @else {
            O item para: o pedido na fila (se houver) sai e as sub-tarefas que ainda não terminaram são canceladas.
          }
          O que já foi concluído continua como está — a não ser que você marque abaixo.
        </p>
        <label class="cwd__opt" [class.cwd__opt--on]="undo()">
          <input type="checkbox" [checked]="undo()" (change)="undo.set($any($event.target).checked)">
          <span>
            <b>Desfazer o que já foi feito</b>
            <small>Fechar PRs, apagar branches criadas, reverter commits e voltar o estado do card — em ordem reversa, pelo executor.</small>
          </span>
        </label>
        @if (undo()) {
          <p class="wi-note wi-note--warn"><mat-icon>info</mat-icon><span>O desfazer vira um pedido na fila e aparece no {{ data.kind === 'plan' ? 'plano e nos itens' : 'item' }} como "Desfazendo" até terminar.</span></p>
        }
        <label class="wi-field">
          <span>Motivo (opcional)</span>
          <textarea class="wi-textarea" rows="2" [(ngModel)]="reason" maxlength="900" placeholder="Por que cancelar? Ajuda o especialista e a próxima versão"></textarea>
        </label>
      </div>
      <footer class="wi-dlg__foot">
        <span class="wi-dlg__spacer"></span>
        <button mat-button mat-dialog-close>Voltar</button>
        <button mat-flat-button color="warn" (click)="confirm()"><mat-icon>stop_circle</mat-icon>{{ undo() ? 'Cancelar e desfazer' : 'Cancelar' }}</button>
      </footer>
    </div>
  `,
  styles: [WORK_DIALOG_STYLES, `
    .cwd__icon { color: #f47067; }
    .cwd__lead { margin: 0; font-size: 12.5px; color: var(--cc-text-2); line-height: 1.5; }
    .cwd__opt { display: flex; gap: 10px; align-items: flex-start; padding: 9px 11px; border-radius: 10px; border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); cursor: pointer; font-size: 13px; }
    .cwd__opt small { display: block; font-size: 11.5px; color: var(--cc-text-2); margin-top: 2px; }
    .cwd__opt--on { border-color: color-mix(in srgb, #f47067 55%, transparent); background: rgba(244,112,103,.07); }
    .cwd__opt input { margin-top: 3px; accent-color: #f47067; }
  `]
})
export class CancelWorkDialogComponent {
  readonly data = inject<CancelWorkDialogData>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<CancelWorkDialogComponent, CancelWorkDialogResult>);
  readonly undo = signal(false);
  readonly num = formatWorkNumber(this.data.number);
  reason = '';

  confirm(): void {
    const reason = this.reason.trim();
    this.ref.close({ undo: this.undo(), ...(reason ? { reason: reason.slice(0, 900) } : {}) });
  }
}
