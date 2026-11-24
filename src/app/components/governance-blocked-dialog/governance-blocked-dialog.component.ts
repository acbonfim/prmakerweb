import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { BlockedNotice } from '../../services/governance/governance.logic';

/** Ação barrada pela governança (0098): o motivo e a regra que barrou, mostrados em qualquer tela. */
@Component({
  selector: 'app-governance-blocked-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title class="title"><mat-icon>block</mat-icon> Ação barrada pela governança</h2>
    <mat-dialog-content>
      <p class="msg">{{ data.message }}</p>
      @if (data.rules.length) {
        <p class="label">{{ data.rules.length > 1 ? 'Regras' : 'Regra' }}</p>
        <ul class="rules">
          @for (r of data.rules; track r.key) {
            <li><b>{{ r.name }}</b>@if (r.name !== r.key) { <span class="key">{{ r.key }}</span> }</li>
          }
        </ul>
      }
      <p class="hint">Nada foi gravado. Se essa ação for mesmo necessária, fale com um administrador do PRMake.</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button type="button" mat-dialog-close cdkFocusInitial>Entendi</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .title { display: flex; align-items: center; gap: 8px; }
    .title mat-icon { color: #f85149; }
    .msg { font-size: 14px; line-height: 1.5; margin: 0 0 12px; white-space: pre-wrap; }
    .label { font-size: 12px; color: var(--cc-text-3); margin: 0 0 4px; }
    .rules { margin: 0 0 12px; padding-left: 18px; font-size: 13px; }
    .key { margin-left: 6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--cc-text-3); }
    .hint { font-size: 12.5px; color: var(--cc-text-3); margin: 0; }
  `],
})
export class GovernanceBlockedDialogComponent {
  readonly data = inject<BlockedNotice>(MAT_DIALOG_DATA);
}
