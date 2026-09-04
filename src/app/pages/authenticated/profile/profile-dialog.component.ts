import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RoundImageCropperComponent } from '../../../components/round-image-cropper/round-image-cropper.component';
import { UserAvatarComponent } from '../../../components/user-avatar/user-avatar.component';
import { AuthService } from '../../../services/auth.service';
import { GdsService } from '../../../services/gds.service';
import { GlobalService } from '../../../services/global.service';
import { StorageService } from '../../../services/storage.service';

export const PROFILE_PHOTO_KEY = 'prform_profile_photo';

@Component({
  selector: 'app-profile-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatIconModule,
    MatTabsModule,
    MatProgressSpinnerModule,
    RoundImageCropperComponent,
    UserAvatarComponent
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon class="title-icon">person</mat-icon> Meu perfil
    </h2>

    <mat-dialog-content>
      <div class="user-head">
        <app-user-avatar [name]="user?.fullName" [imageUrl]="photo()" [size]="56"></app-user-avatar>
        <div class="user-info">
          <strong>{{ user?.fullName }}</strong>
          <span>{{ user?.userName }}</span>
        </div>
      </div>

      <mat-tab-group>
        <mat-tab label="Foto">
          <div class="tab-body">
            <p class="hint">Selecione uma imagem, ajuste o zoom e a posição para deixá-la redonda.</p>
            <app-round-image-cropper (cropped)="onPhotoCropped($event)"></app-round-image-cropper>
            @if (uploading()) {
              <div class="uploading"><mat-spinner diameter="20"></mat-spinner> <span>Enviando imagem...</span></div>
            }
            @if (photo() && !uploading()) {
              <button mat-button color="warn" class="mt-2" (click)="removePhoto()">
                <mat-icon>delete</mat-icon> Remover foto
              </button>
            }
          </div>
        </mat-tab>

        <mat-tab label="Senha">
          <div class="tab-body">
            <mat-form-field appearance="outline" class="full">
              <mat-label>Senha atual</mat-label>
              <input matInput [type]="hide() ? 'password' : 'text'" [ngModel]="current()" (ngModelChange)="current.set($event)" autocomplete="current-password">
              <button matSuffix mat-icon-button type="button" (click)="hide.set(!hide())" [attr.aria-label]="hide() ? 'Mostrar senha' : 'Ocultar senha'">
                <mat-icon>{{ hide() ? 'visibility' : 'visibility_off' }}</mat-icon>
              </button>
            </mat-form-field>

            <mat-form-field appearance="outline" class="full">
              <mat-label>Nova senha</mat-label>
              <input matInput [type]="hide() ? 'password' : 'text'" [ngModel]="newPass()" (ngModelChange)="newPass.set($event)" autocomplete="new-password">
            </mat-form-field>

            <mat-form-field appearance="outline" class="full">
              <mat-label>Confirmar nova senha</mat-label>
              <input matInput [type]="hide() ? 'password' : 'text'" [ngModel]="confirm()" (ngModelChange)="confirm.set($event)" autocomplete="new-password">
              @if (confirm() && newPass() !== confirm()) {
                <mat-error>As senhas não conferem</mat-error>
              }
            </mat-form-field>

            <ul class="rules">
              <li [class.ok]="rules().length"><mat-icon>{{ rules().length ? 'check_circle' : 'radio_button_unchecked' }}</mat-icon> Mínimo de 8 caracteres</li>
              <li [class.ok]="rules().lower"><mat-icon>{{ rules().lower ? 'check_circle' : 'radio_button_unchecked' }}</mat-icon> Uma letra minúscula</li>
              <li [class.ok]="rules().upper"><mat-icon>{{ rules().upper ? 'check_circle' : 'radio_button_unchecked' }}</mat-icon> Uma letra maiúscula</li>
              <li [class.ok]="rules().special"><mat-icon>{{ rules().special ? 'check_circle' : 'radio_button_unchecked' }}</mat-icon> Um caractere especial</li>
            </ul>

            <button mat-raised-button color="primary" class="full"
                    [disabled]="loading() || !canChange()" (click)="changePassword()">
              @if (loading()) {
                <mat-spinner diameter="20"></mat-spinner>
              } @else {
                <span>Alterar senha</span>
              }
            </button>
          </div>
        </mat-tab>
      </mat-tab-group>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="close()">Fechar</button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host { color: var(--mat-sys-on-surface); }
    h2[mat-dialog-title] { display: flex; align-items: center; gap: 8px; }
    .title-icon { color: var(--mat-sys-primary); }
    mat-dialog-content { min-width: 460px; max-width: 520px; }
    .user-head { display: flex; align-items: center; gap: 14px; margin: 4px 0 16px; }
    .avatar {
      width: 56px; height: 56px; border-radius: 50%; overflow: hidden;
      display: flex; align-items: center; justify-content: center;
      background: var(--mat-sys-primary); color: var(--mat-sys-on-primary); flex-shrink: 0;
    }
    .avatar img { width: 100%; height: 100%; object-fit: cover; }
    .user-info { display: flex; flex-direction: column; }
    .user-info span { font-size: 12px; opacity: 0.7; }
    .tab-body { display: flex; flex-direction: column; align-items: stretch; gap: 8px; padding: 18px 4px 4px; }
    .tab-body .hint { font-size: 13px; opacity: 0.7; text-align: center; margin: 0 0 8px; }
    .uploading { display: flex; align-items: center; gap: 8px; justify-content: center; font-size: 13px; opacity: 0.85; margin-top: 8px; }
    .full { width: 100%; }
    .mt-2 { margin-top: 8px; align-self: center; }
    .rules { list-style: none; padding: 0; margin: 0 0 12px; }
    .rules li { display: flex; align-items: center; gap: 8px; font-size: 13px; opacity: 0.8; margin-bottom: 5px; }
    .rules li mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .rules li.ok { color: #34c76a; }
  `]
})
export class ProfileDialogComponent {
  user: any;
  photo = signal<string | null>(null);
  uploading = signal(false);

  current = signal('');
  newPass = signal('');
  confirm = signal('');
  hide = signal(true);
  loading = signal(false);

  rules = computed(() => {
    const p = this.newPass();
    return {
      length: p.length >= 8,
      lower: /[a-z]/.test(p),
      upper: /[A-Z]/.test(p),
      special: /[^a-zA-Z0-9]/.test(p)
    };
  });

  canChange = computed(() => {
    const r = this.rules();
    return !!this.current() && r.length && r.lower && r.upper && r.special
      && !!this.confirm() && this.newPass() === this.confirm();
  });

  constructor(
    private dialogRef: MatDialogRef<ProfileDialogComponent>,
    private _authService: AuthService,
    private _globalService: GlobalService,
    private _storage: StorageService,
    private _gds: GdsService
  ) {
    const access = this._storage.getAccess();
    this.user = access?.user;
    this.photo.set(this.user?.imagemUrlUser || null);
  }

  // Upload real: crop -> upload assinado (prform/Cloudinary) -> salva URL no usuário.
  onPhotoCropped(dataUrl: string): void {
    this.uploading.set(true);
    this._gds.uploadImage(dataUrl).subscribe({
      next: (res: any) => {
        const url = res?.url || res?.Url;
        if (!url) {
          this.uploading.set(false);
          this._globalService.sendAlertError('Falha no upload da imagem.', 'OK');
          return;
        }
        this._authService.updatePhoto(url).subscribe({
          next: () => {
            this.photo.set(url);
            this.persistToAccess(url);
            this.uploading.set(false);
            this._globalService.sendAlert('Foto de perfil atualizada', 'OK');
          },
          error: (err) => {
            this.uploading.set(false);
            this._globalService.sendAlertError(this.errMsg(err, 'Erro ao salvar a foto'), 'OK');
          }
        });
      },
      error: (err) => {
        this.uploading.set(false);
        this._globalService.sendAlertError(this.errMsg(err, 'Erro ao enviar a imagem'), 'OK');
      }
    });
  }

  removePhoto(): void {
    this._authService.updatePhoto('').subscribe({
      next: () => {
        this.photo.set(null);
        this.persistToAccess('');
        this._globalService.sendAlert('Foto removida', 'OK');
      },
      error: (err) => this._globalService.sendAlertError(this.errMsg(err, 'Erro ao remover a foto'), 'OK')
    });
  }

  private persistToAccess(url: string): void {
    const access = this._storage.getAccess();
    if (access && access.user) {
      access.user.imagemUrlUser = url || null;
      this._storage.setAccess(access);
    }
  }

  private errMsg(err: any, def: string): string {
    return err?.error?.message || err?.error?.Message || def;
  }

  changePassword(): void {
    if (!this.canChange()) return;
    this.loading.set(true);
    this._authService.changePassword(this.current(), this.newPass()).subscribe({
      next: () => {
        this.loading.set(false);
        this._globalService.sendAlert('Senha alterada com sucesso', 'OK');
        this.current.set('');
        this.newPass.set('');
        this.confirm.set('');
      },
      error: (err) => {
        this.loading.set(false);
        const msg = err?.error?.message || err?.error?.Message || 'Não foi possível alterar a senha';
        this._globalService.sendAlertError(msg, 'OK');
      }
    });
  }

  close(): void {
    this.dialogRef.close();
  }
}
