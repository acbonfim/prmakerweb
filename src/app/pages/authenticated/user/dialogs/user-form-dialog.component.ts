import { Component, Inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { forkJoin } from 'rxjs';
import { AuthService } from '../../../../services/auth.service';
import { GlobalService } from '../../../../services/global.service';

interface UserFormData {
  mode: 'create' | 'edit';
  user?: any;
  roles: string[];
}

@Component({
  selector: 'app-user-form-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule,
    MatCheckboxModule,
    MatIconModule,
    MatProgressSpinnerModule
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon class="title-icon">{{ isEdit ? 'edit' : 'person_add' }}</mat-icon>
      {{ isEdit ? 'Editar usuário' : 'Novo usuário' }}
    </h2>

    <mat-dialog-content>
      <div class="form-grid">
        <mat-form-field appearance="outline">
          <mat-label>Nome completo</mat-label>
          <input matInput [ngModel]="fullName()" (ngModelChange)="fullName.set($event)" name="fullName" required>
        </mat-form-field>

        <mat-form-field appearance="outline" *ngIf="isEdit">
          <mat-label>Usuário</mat-label>
          <input matInput [ngModel]="userName()" (ngModelChange)="userName.set($event)"
                 name="userName" readonly>
          <mat-hint>O nome de usuário não pode ser alterado</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>E-mail</mat-label>
          <input matInput type="email" [ngModel]="email()" (ngModelChange)="email.set($event)" name="email" required>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Departamento</mat-label>
          <input matInput [ngModel]="departamento()" (ngModelChange)="departamento.set($event)" name="departamento">
        </mat-form-field>

        <mat-form-field appearance="outline" *ngIf="!isEdit">
          <mat-label>Cargo</mat-label>
          <mat-select [ngModel]="role()" (ngModelChange)="role.set($event)" name="role" required>
            <mat-option *ngFor="let r of data.roles" [value]="r">{{ r }}</mat-option>
          </mat-select>
        </mat-form-field>

        <div *ngIf="isEdit" class="roles-block">
          <label class="roles-title">Cargos (perfil)</label>
          <div class="roles-list">
            <mat-checkbox *ngFor="let r of data.roles"
                          [checked]="isRoleSelected(r)"
                          (change)="toggleRole(r, $event.checked)">
              {{ r }}
            </mat-checkbox>
          </div>
        </div>

        <div *ngIf="!isEdit" class="create-note">
          <mat-icon>mail</mat-icon>
          <span>O usuário definirá a própria senha no primeiro acesso, pelo link enviado ao e-mail informado.</span>
        </div>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button [disabled]="loading()" (click)="close()">Cancelar</button>
      <button mat-raised-button color="primary" [disabled]="loading() || !canSave()" (click)="save()">
        <mat-spinner *ngIf="loading()" diameter="18"></mat-spinner>
        <span *ngIf="!loading()">{{ isEdit ? 'Salvar' : 'Criar' }}</span>
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host { color: var(--mat-sys-on-surface); }
    h2[mat-dialog-title] { display: flex; align-items: center; gap: 8px; }
    .title-icon { color: var(--mat-sys-primary); }
    mat-dialog-content { min-width: 460px; max-width: 560px; padding-top: 12px; overflow: visible; }
    .form-grid { display: flex; flex-direction: column; row-gap: 6px; }
    .form-grid mat-form-field { width: 100%; }
    .roles-block { display: flex; flex-direction: column; gap: 8px; margin: 4px 0 16px; }
    .roles-title { font-size: 12px; opacity: 0.75; }
    .roles-list { display: flex; flex-wrap: wrap; gap: 8px 20px; }
    .create-note {
      display: flex; gap: 8px; align-items: flex-start; font-size: 13px;
      color: var(--mat-sys-on-surface); opacity: 0.9;
      background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent);
      border-radius: 8px; padding: 10px 12px; margin-top: 4px;
    }
    .create-note mat-icon { color: var(--mat-sys-primary); font-size: 20px; width: 20px; height: 20px; }
    button mat-spinner { display: inline-block; }
  `]
})
export class UserFormDialogComponent implements OnInit {
  loading = signal(false);
  isEdit = false;

  fullName = signal('');
  userName = signal('');
  email = signal('');
  departamento = signal('');
  role = signal('');
  selectedRoles = signal<string[]>([]);

  private id = 0;
  private originalRoles: string[] = [];

  canSave = computed(() => {
    if (this.isEdit) {
      return !!this.fullName() && !!this.email();
    }
    // Na criação não há usuário/senha: o usuário define a senha no primeiro acesso.
    return !!this.fullName() && !!this.email() && !!this.role();
  });

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: UserFormData,
    private dialogRef: MatDialogRef<UserFormDialogComponent>,
    private _authService: AuthService,
    private _globalService: GlobalService
  ) {}

  ngOnInit(): void {
    this.isEdit = this.data.mode === 'edit';
    if (this.isEdit && this.data.user) {
      this.id = this.data.user.id;
      this.fullName.set(this.data.user.fullName || '');
      this.userName.set(this.data.user.userName || '');
      this.email.set(this.data.user.email || '');
      this.departamento.set(this.data.user.departamento || '');

      const current = (this.data.user.userRoles || [])
        .map((ur: any) => ur?.role?.name)
        .filter((x: any) => !!x);
      this.selectedRoles.set([...current]);
      this.originalRoles = [...current];
    }
  }

  isRoleSelected(role: string): boolean {
    return this.selectedRoles().includes(role);
  }

  toggleRole(role: string, checked: boolean): void {
    const set = new Set(this.selectedRoles());
    if (checked) set.add(role); else set.delete(role);
    this.selectedRoles.set([...set]);
  }

  private rolesChanged(): boolean {
    const a = [...this.selectedRoles()].sort();
    const b = [...this.originalRoles].sort();
    return a.length !== b.length || a.some((r, i) => r !== b[i]);
  }

  save(): void {
    if (!this.canSave()) return;
    this.loading.set(true);

    if (!this.isEdit) {
      const email = this.email().trim();
      const payload = {
        fullName: this.fullName(),
        // Sem campo de usuário/senha: username = e-mail; senha temporária forte.
        // O usuário definirá a própria senha no primeiro acesso (link por e-mail).
        userName: email,
        email: email,
        departamento: this.departamento(),
        role: this.role(),
        password: this.generateTempPassword(),
        companyId: 1,
        imagemUrlUser: '',
        channelOrigin: 'WEB'
      };
      this._authService.register(payload as any).subscribe({
        next: () => this.done('Usuário criado. Um e-mail de primeiro acesso foi enviado.'),
        error: (err) => this.fail(err)
      });
      return;
    }

    const profile$ = this._authService.updateUser({
      id: this.id,
      fullName: this.fullName(),
      email: this.email(),
      departamento: this.departamento()
    });

    if (this.rolesChanged()) {
      forkJoin([
        profile$,
        this._authService.updateUserRoles(this.id, this.selectedRoles())
      ]).subscribe({
        next: () => this.done('Usuário atualizado'),
        error: (err) => this.fail(err)
      });
    } else {
      profile$.subscribe({
        next: () => this.done('Usuário atualizado'),
        error: (err) => this.fail(err)
      });
    }
  }

  private done(message: string): void {
    this.loading.set(false);
    this._globalService.sendAlert(message, 'OK');
    this.dialogRef.close(true);
  }

  private fail(err: any): void {
    this.loading.set(false);
    const msg = err?.error?.message || err?.error?.Message || 'Erro ao salvar usuário';
    this._globalService.sendAlertError(msg, 'OK');
  }

  // Senha temporária forte (atende às regras do Identity). Nunca é exibida:
  // serve só para criar o usuário; a senha real é definida no primeiro acesso.
  private generateTempPassword(): string {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnpqrstuvwxyz';
    const digit = '23456789';
    const special = '!@#$%&*?';
    const all = upper + lower + digit + special;
    const pick = (set: string) => set[Math.floor(Math.random() * set.length)];
    let pass = pick(upper) + pick(lower) + pick(digit) + pick(special);
    for (let i = 0; i < 12; i++) pass += pick(all);
    return pass;
  }

  close(): void {
    this.dialogRef.close(false);
  }
}
