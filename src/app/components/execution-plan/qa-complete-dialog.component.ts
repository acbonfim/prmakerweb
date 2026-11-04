import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';
import { ExecutionPlanService, planApiError } from '../../services/execution-plan.service';
import { DevOpsActionsService, apiErrorMessage } from '../../services/devops-actions.service';

export interface QaCompleteDialogData {
  planId: string;
  stepKey: string;
  stepTitle: string;
  cardNumber: string;
}

export interface QaCompleteDialogResult {
  completed: boolean;
  /** Pediu para mover para Ready for QA. */
  moveRequested: boolean;
  moved: boolean;
  error: string | null;
}

/** Etapa "Validar em QA" do plano de correção (0075/F5): `validar-qa` ou `validar-qa-<repo>`. */
export function isQaValidationStep(key: string | null | undefined): boolean {
  const k = (key ?? '').toLowerCase();
  return k === 'validar-qa' || k.startsWith('validar-qa-');
}

/**
 * Concluir "Validar em QA" pela tela (0075/F5): conclui a etapa e, com "Mover o card para Ready for QA
 * agora" marcado (padrão), chama a ação `ready-for-qa` do DevOps na hora — sem depender da sessão do
 * Claude. Mostra o resultado no próprio diálogo (movido / erro do back; 409 = regra não atendida).
 */
@Component({
  selector: 'app-qa-complete-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatCheckboxModule, MatIconModule],
  template: `
    <h2 mat-dialog-title class="qa-dlg__title"><mat-icon>science</mat-icon>Concluir “{{ data.stepTitle }}”</h2>
    <mat-dialog-content class="qa-dlg">
      @if (phase() === 'ask') {
        <p class="qa-dlg__text">A validação em QA terminou e a correção está ok?</p>
        <mat-checkbox [(ngModel)]="move" class="qa-dlg__check">
          <span class="qa-dlg__check-label">Mover o card para Ready for QA agora</span>
          <span class="qa-dlg__hint">o card sai de Dev Test in QA e vai para Ready for QA no DevOps</span>
        </mat-checkbox>
      } @else if (phase() === 'running') {
        <p class="qa-dlg__text qa-dlg__running" role="status">
          <span class="qa-dlg__spin" aria-hidden="true"></span>{{ status() }}
        </p>
      } @else {
        @if (result(); as r) {
          @if (r.completed) {
            <p class="qa-dlg__line qa-dlg__line--ok" role="status"><mat-icon>check_circle</mat-icon>Etapa concluída.</p>
          }
          @if (r.moved) {
            <p class="qa-dlg__line qa-dlg__line--ok" role="status"><mat-icon>check_circle</mat-icon>{{ moveMessage() || 'Card movido para Ready for QA.' }}</p>
          }
          @if (r.error) {
            <p class="qa-dlg__line qa-dlg__line--error" role="alert"><mat-icon>error_outline</mat-icon><span>{{ r.error }}</span></p>
          }
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (phase() === 'ask') {
        <button mat-button (click)="close()">Cancelar</button>
        <button mat-flat-button color="primary" (click)="confirm()"><mat-icon>check</mat-icon>Concluir</button>
      } @else if (phase() === 'done') {
        @if (result()?.completed && result()?.moveRequested && !result()?.moved) {
          <button mat-button (click)="retryMove()">Tentar mover de novo</button>
        }
        <button mat-flat-button color="primary" (click)="close()">Fechar</button>
      }
    </mat-dialog-actions>
  `,
  styles: [`
    .qa-dlg__title { display: flex; align-items: center; gap: 8px; }
    .qa-dlg__title .mat-icon { color: #3fb950; }
    .qa-dlg { min-width: min(440px, 80vw); }
    .qa-dlg__text { margin: 0 0 12px; }
    .qa-dlg__check-label { display: block; font-weight: 600; }
    .qa-dlg__hint { display: block; font-size: 12.5px; opacity: 0.7; }
    .qa-dlg__running { display: flex; align-items: center; gap: 8px; }
    .qa-dlg__spin {
      width: 14px; height: 14px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent;
      animation: qa-spin 0.8s linear infinite;
    }
    @keyframes qa-spin { to { transform: rotate(360deg); } }
    .qa-dlg__line { display: flex; align-items: flex-start; gap: 6px; margin: 0 0 8px; }
    .qa-dlg__line .mat-icon { flex: none; font-size: 20px; width: 20px; height: 20px; }
    .qa-dlg__line--ok { color: #7ee2a8; }
    .qa-dlg__line--error { color: #ff9d97; }
  `],
})
export class QaCompleteDialogComponent {
  readonly data = inject<QaCompleteDialogData>(MAT_DIALOG_DATA);
  private ref = inject(MatDialogRef<QaCompleteDialogComponent, QaCompleteDialogResult | undefined>);
  private plans = inject(ExecutionPlanService);
  private devops = inject(DevOpsActionsService);

  move = true;
  readonly phase = signal<'ask' | 'running' | 'done'>('ask');
  readonly status = signal('');
  readonly result = signal<QaCompleteDialogResult | null>(null);
  readonly moveMessage = signal<string | null>(null);

  async confirm(): Promise<void> {
    if (this.phase() !== 'ask') return;
    const moveRequested = this.move;
    this.ref.disableClose = true;
    this.phase.set('running');
    this.status.set('Concluindo a etapa…');
    const r: QaCompleteDialogResult = { completed: false, moveRequested, moved: false, error: null };
    try {
      await firstValueFrom(this.plans.completeStep(this.data.planId, this.data.stepKey));
      r.completed = true;
    } catch (err) {
      r.error = planApiError(err, 'Não foi possível concluir a etapa.');
    }
    if (r.completed && moveRequested) await this.runMove(r);
    this.finish(r);
  }

  async retryMove(): Promise<void> {
    const prev = this.result();
    if (!prev?.completed) return;
    this.phase.set('running');
    const r: QaCompleteDialogResult = { ...prev, moved: false, error: null };
    await this.runMove(r);
    this.finish(r);
  }

  private async runMove(r: QaCompleteDialogResult): Promise<void> {
    this.status.set('Movendo o card para Ready for QA…');
    try {
      const res = await this.devops.run(this.data.cardNumber, 'ready-for-qa');
      r.moved = true;
      this.moveMessage.set(res?.message || null);
    } catch (err: any) {
      const msg = apiErrorMessage(err, 'O DevOps não aceitou a mudança.');
      r.error = err?.status === 409
        ? `O card não foi movido para Ready for QA (regra não atendida): ${msg}`
        : `Não foi possível mover o card para Ready for QA: ${msg}`;
    }
  }

  private finish(r: QaCompleteDialogResult): void {
    this.result.set(r);
    this.phase.set('done');
    this.ref.disableClose = false;
  }

  close(): void {
    this.ref.close(this.result() ?? undefined);
  }
}
