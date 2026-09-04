import { Component, Inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthServicesService } from '../../../../services/auth-services.service';
import { GlobalService } from '../../../../services/global.service';

interface ServiceFormData {
  mode: 'create' | 'edit';
  service?: any;
}

@Component({
  selector: 'app-service-form-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatIconModule,
    MatTooltipModule,
    MatProgressSpinnerModule
  ],
  template: `
    <h2 mat-dialog-title>{{ isEdit ? 'Editar serviço' : 'Novo serviço' }}</h2>

    <mat-dialog-content>
      <div class="form-grid">
        <mat-form-field appearance="outline" *ngIf="isEdit">
          <mat-label>External ID</mat-label>
          <input matInput readonly [value]="model.externalId">
          <button matSuffix mat-icon-button matTooltip="Copiar" (click)="copyId()">
            <mat-icon>content_copy</mat-icon>
          </button>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Nome</mat-label>
          <input matInput [(ngModel)]="model.name" name="name" required>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Descrição</mat-label>
          <textarea matInput [(ngModel)]="model.description" name="description" rows="3"></textarea>
        </mat-form-field>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button [disabled]="loading()" (click)="close()">Cancelar</button>
      <button mat-raised-button color="primary" [disabled]="loading() || !model.name" (click)="save()">
        <mat-spinner *ngIf="loading()" diameter="18"></mat-spinner>
        <span *ngIf="!loading()">{{ isEdit ? 'Salvar' : 'Criar' }}</span>
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content { min-width: 440px; max-width: 560px; padding-top: 12px; overflow: visible; }
    .form-grid { display: flex; flex-direction: column; row-gap: 6px; }
    .form-grid mat-form-field { width: 100%; }
  `]
})
export class ServiceFormDialogComponent implements OnInit {
  loading = signal(false);
  isEdit = false;
  model: any = { externalId: '', name: '', description: '' };

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: ServiceFormData,
    private dialogRef: MatDialogRef<ServiceFormDialogComponent>,
    private _authServices: AuthServicesService,
    private _globalService: GlobalService
  ) {}

  ngOnInit(): void {
    this.isEdit = this.data.mode === 'edit';
    if (this.isEdit && this.data.service) {
      this.model.externalId = this.data.service.externalId;
      this.model.name = this.data.service.name || '';
      this.model.description = this.data.service.description || '';
    }
  }

  copyId(): void {
    this._globalService.copyToClipBoard(this.model.externalId);
  }

  save(): void {
    if (!this.model.name) return;
    this.loading.set(true);

    const payload = { name: this.model.name, description: this.model.description || '' } as any;
    const request$ = this.isEdit
      ? this._authServices.update({ externalId: this.model.externalId, ...payload })
      : this._authServices.create(payload);

    request$.subscribe({
      next: () => {
        this.loading.set(false);
        this._globalService.sendAlert(this.isEdit ? 'Serviço atualizado' : 'Serviço criado', 'OK');
        this.dialogRef.close(true);
      },
      error: (err) => {
        this.loading.set(false);
        const msg = err?.error?.message || err?.error?.Message || 'Erro ao salvar serviço';
        this._globalService.sendAlertError(msg, 'OK');
      }
    });
  }

  close(): void {
    this.dialogRef.close(false);
  }
}
