import { Component, Inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { forkJoin } from 'rxjs';
import { AuthServicesService } from '../../../../services/auth-services.service';
import { GlobalService } from '../../../../services/global.service';

interface UserServicesData {
  user: any;
}

@Component({
  selector: 'app-user-services-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon class="title-icon">lan</mat-icon> Permissões de serviços
    </h2>

    <mat-dialog-content>
      <p class="subtitle">Usuário: <strong>{{ data.user?.fullName }}</strong></p>

      <div *ngIf="loading()" class="d-flex justify-content-center p-4">
        <mat-spinner diameter="30"></mat-spinner>
      </div>

      <div *ngIf="!loading()">
        <div *ngIf="services().length === 0" class="empty">
          Nenhum serviço cadastrado.
        </div>

        <div *ngFor="let s of services()" class="svc-row">
          <div class="svc-info">
            <strong class="svc-name">{{ s.name }}</strong>
            <span class="svc-desc">{{ s.description }}</span>
          </div>

          <div class="svc-actions">
            <mat-icon *ngIf="hasService(s)" class="granted-check" matTooltip="Acesso concedido">check_circle</mat-icon>
            <button *ngIf="hasService(s)" mat-stroked-button color="warn"
                    [disabled]="processingId() === s.externalId" (click)="revoke(s)">
              <mat-spinner *ngIf="processingId() === s.externalId" diameter="16"></mat-spinner>
              <span *ngIf="processingId() !== s.externalId">Remover</span>
            </button>
            <button *ngIf="!hasService(s)" mat-flat-button color="primary"
                    [disabled]="processingId() === s.externalId" (click)="grant(s)">
              <mat-spinner *ngIf="processingId() === s.externalId" diameter="16"></mat-spinner>
              <span *ngIf="processingId() !== s.externalId">Conceder</span>
            </button>
          </div>
        </div>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="close()">Fechar</button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host { color: var(--mat-sys-on-surface); }
    h2[mat-dialog-title] { display: flex; align-items: center; gap: 8px; }
    .title-icon { color: var(--mat-sys-primary); }
    mat-dialog-content { min-width: 480px; max-width: 620px; }
    .subtitle { color: var(--mat-sys-on-surface); opacity: 0.85; margin-bottom: 12px; }
    .empty { color: var(--mat-sys-on-surface); opacity: 0.7; padding: 12px 4px; }
    .svc-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      margin-bottom: 8px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--mat-sys-on-surface) 8%, transparent);
      border: 1px solid color-mix(in srgb, var(--mat-sys-on-surface) 12%, transparent);
    }
    .svc-info { display: flex; flex-direction: column; min-width: 0; }
    .svc-name { color: var(--mat-sys-on-surface); font-weight: 600; }
    .svc-desc { color: var(--mat-sys-on-surface); opacity: 0.7; font-size: 12px; }
    .svc-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .granted-check { color: #4caf50; }
  `]
})
export class UserServicesDialogComponent implements OnInit {
  loading = signal(true);
  processingId = signal<string | null>(null);
  services = signal<any[]>([]);
  grantedIds = signal<Set<string>>(new Set());
  changed = false;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: UserServicesData,
    private dialogRef: MatDialogRef<UserServicesDialogComponent>,
    private _authServices: AuthServicesService,
    private _globalService: GlobalService
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    forkJoin({
      all: this._authServices.getAll(),
      granted: this._authServices.getAllByUserId(this.data.user.id)
    }).subscribe({
      next: (res: any) => {
        this.services.set(res.all?.object ?? res.all?.Object ?? []);
        const granted = res.granted?.object ?? res.granted?.Object ?? [];
        this.grantedIds.set(new Set(granted.map((g: any) => g.externalId)));
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this._globalService.sendAlertError('Erro ao carregar serviços', 'OK');
      }
    });
  }

  hasService(s: any): boolean {
    return this.grantedIds().has(s.externalId);
  }

  grant(s: any): void {
    this.processingId.set(s.externalId);
    this._authServices.addUserToService(this.data.user.id, s.externalId).subscribe({
      next: () => {
        const next = new Set(this.grantedIds());
        next.add(s.externalId);
        this.grantedIds.set(next);
        this.processingId.set(null);
        this.changed = true;
        this._globalService.sendAlert(`Acesso ao serviço "${s.name}" concedido`, 'OK');
      },
      error: (err) => {
        this.processingId.set(null);
        const msg = err?.error?.message || err?.error?.Message || 'Erro ao conceder acesso';
        this._globalService.sendAlertError(msg, 'OK');
      }
    });
  }

  revoke(s: any): void {
    this.processingId.set(s.externalId);
    this._authServices.removeUserFromService(this.data.user.id, s.externalId).subscribe({
      next: () => {
        const next = new Set(this.grantedIds());
        next.delete(s.externalId);
        this.grantedIds.set(next);
        this.processingId.set(null);
        this.changed = true;
        this._globalService.sendAlert(`Acesso ao serviço "${s.name}" removido`, 'OK');
      },
      error: (err) => {
        this.processingId.set(null);
        const msg = err?.error?.message || err?.error?.Message || 'Erro ao remover acesso';
        this._globalService.sendAlertError(msg, 'OK');
      }
    });
  }

  close(): void {
    this.dialogRef.close(this.changed);
  }
}
