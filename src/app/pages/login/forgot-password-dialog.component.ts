import { Component, Inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-forgot-password-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatIconModule,
    MatProgressSpinnerModule
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon class="title-icon">lock_reset</mat-icon> Esqueci minha senha
    </h2>

    <mat-dialog-content>
      @if (!done()) {
        <p class="hint">Informe seu usuário para receber um e-mail com o link de redefinição de senha.</p>
        <mat-form-field appearance="outline" class="full">
          <mat-label>Usuário</mat-label>
          <input matInput [ngModel]="userName()" (ngModelChange)="userName.set($event)" (keydown.enter)="send()">
        </mat-form-field>
        @if (error()) {
          <p class="err">{{ error() }}</p>
        }
      } @else {
        <div class="sent">
          <mat-icon>mark_email_read</mat-icon>
          <p>Se o usuário existir, enviamos um e-mail com o link para redefinir a senha. Verifique sua caixa de entrada.</p>
        </div>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      @if (!done()) {
        <button mat-button (click)="close()">Cancelar</button>
        <button mat-raised-button color="primary" [disabled]="loading() || !userName()" (click)="send()">
          @if (loading()) { <mat-spinner diameter="18"></mat-spinner> } @else { <span>Enviar</span> }
        </button>
      } @else {
        <button mat-raised-button color="primary" (click)="close()">Fechar</button>
      }
    </mat-dialog-actions>
  `,
  styles: [`
    :host { color: var(--mat-sys-on-surface); }
    h2[mat-dialog-title] { display: flex; align-items: center; gap: 8px; }
    .title-icon { color: var(--mat-sys-primary); }
    mat-dialog-content { min-width: 380px; max-width: 440px; }
    .hint { font-size: 14px; opacity: 0.8; margin: 0 0 12px; }
    .full { width: 100%; }
    .err { color: #ef5350; font-size: 13px; margin: 4px 0 0; }
    .sent { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; padding: 8px 0; }
    .sent mat-icon { font-size: 44px; width: 44px; height: 44px; color: #34c76a; }
  `]
})
export class ForgotPasswordDialogComponent {
  userName = signal('');
  loading = signal(false);
  done = signal(false);
  error = signal('');

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { userName?: string },
    private dialogRef: MatDialogRef<ForgotPasswordDialogComponent>,
    private _authService: AuthService
  ) {
    if (data?.userName) this.userName.set(data.userName);
  }

  send(): void {
    const user = this.userName().trim();
    if (!user || this.loading()) return;
    this.loading.set(true);
    this.error.set('');

    this._authService.forgotPassword(user).subscribe({
      next: () => {
        this.loading.set(false);
        this.done.set(true);
      },
      error: (err) => {
        this.loading.set(false);
        const msg = err?.error?.message || err?.error?.Message;
        // Não vaza existência de usuário: mensagens de "não encontrado" viram genéricas.
        if (err?.status === 404 || msg === 'Usuario não encontrado') {
          this.done.set(true);
          return;
        }
        this.error.set(msg || 'Não foi possível enviar o e-mail. Tente novamente.');
      }
    });
  }

  close(): void {
    this.dialogRef.close();
  }
}
