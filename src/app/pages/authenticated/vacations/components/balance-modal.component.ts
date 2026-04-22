import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule, NativeDateAdapter, DateAdapter, MAT_DATE_FORMATS, MAT_DATE_LOCALE, MAT_NATIVE_DATE_FORMATS } from '@angular/material/core';
import { VacationBalance } from '../models/vacation.model';

interface DialogData {
  mode: 'create' | 'edit';
  balance?: VacationBalance;
  userId?: string;
}

@Component({
  selector: 'app-balance-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatDatepickerModule,
    MatNativeDateModule
  ],
  providers: [
    { provide: MAT_DATE_LOCALE, useValue: 'pt-BR' },
    { provide: DateAdapter, useClass: NativeDateAdapter },
    { provide: MAT_DATE_FORMATS, useValue: MAT_NATIVE_DATE_FORMATS }
  ],
  template: `
    <h2 mat-dialog-title>
      {{ data.mode === 'create' ? 'Novo Período Aquisitivo' : 'Editar Período Aquisitivo' }}
    </h2>

    <mat-dialog-content>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Dias Disponíveis</mat-label>
        <input
          matInput
          type="number"
          [(ngModel)]="availableDays"
          [min]="0"
          [max]="30"
          required
        />
        <mat-hint>Geralmente 30 dias por período</mat-hint>
        <mat-error *ngIf="availableDays < 0">Não pode ser negativo</mat-error>
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Início do Período Aquisitivo</mat-label>
        <input
          matInput
          [matDatepicker]="startPicker"
          [(ngModel)]="acquisitionStart"
          (dateChange)="onDateChange()"
          required
        />
        <mat-datepicker-toggle matSuffix [for]="startPicker"></mat-datepicker-toggle>
        <mat-datepicker #startPicker></mat-datepicker>
        <mat-hint>Data em que começa a trabalhar para adquirir férias</mat-hint>
        <mat-error *ngIf="!acquisitionStart">Campo obrigatório</mat-error>
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Fim do Período Aquisitivo</mat-label>
        <input
          matInput
          [matDatepicker]="endPicker"
          [(ngModel)]="acquisitionEnd"
          [min]="acquisitionStart"
          (dateChange)="onDateChange()"
          required
        />
        <mat-datepicker-toggle matSuffix [for]="endPicker"></mat-datepicker-toggle>
        <mat-datepicker #endPicker></mat-datepicker>
        <mat-hint>Aproximadamente 12 meses após o início</mat-hint>
        <mat-error *ngIf="!acquisitionEnd">Campo obrigatório</mat-error>
      </mat-form-field>

      <div class="info-box" *ngIf="acquisitionStart && acquisitionEnd && isValid()">
        <p><strong>Período de Gozo Calculado:</strong></p>
        <p>De {{ formatDate(usagePeriodStart) }} até {{ formatDate(usagePeriodEnd) }}</p>
        <p class="hint-text">O funcionário poderá tirar férias neste período</p>
      </div>

      <div class="validation-messages" *ngIf="validationError">
        <p class="error-message">{{ validationError }}</p>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Cancelar</button>
      <button
        mat-raised-button
        color="primary"
        (click)="onSave()"
        [disabled]="!isValid()"
      >
        {{ data.mode === 'create' ? 'Criar' : 'Salvar' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content {
      display: flex;
      flex-direction: column;
      gap: 16px;
      min-width: 450px;
      padding: 20px 24px;
      max-height: 70vh;
      overflow-y: auto;
    }

    .full-width {
      width: 100%;
    }

    .info-box {
      background: #e8f5e9;
      padding: 16px;
      border-radius: 4px;
      border-left: 4px solid #4caf50;
    }

    .info-box p {
      margin: 4px 0;
    }

    .info-box strong {
      color: #2e7d32;
    }

    .hint-text {
      font-size: 12px;
      color: #666;
      font-style: italic;
    }

    .validation-messages {
      background: #ffebee;
      padding: 12px;
      border-radius: 4px;
      border-left: 4px solid #f44336;
    }

    .error-message {
      margin: 0;
      color: #c62828;
      font-size: 14px;
    }

    mat-dialog-actions {
      padding: 16px 24px;
    }

    @media (max-width: 600px) {
      mat-dialog-content {
        min-width: 280px;
      }
    }
  `]
})
export class BalanceModalComponent implements OnInit {
  availableDays: number = 30;
  acquisitionStart: Date | null = null;
  acquisitionEnd: Date | null = null;
  usagePeriodStart: Date | null = null;
  usagePeriodEnd: Date | null = null;
  validationError: string = '';

  constructor(
    public dialogRef: MatDialogRef<BalanceModalComponent>,
    @Inject(MAT_DIALOG_DATA) public data: DialogData
  ) {}

  ngOnInit() {
    if (this.data.mode === 'edit' && this.data.balance) {
      this.availableDays = this.data.balance.availableDays;
      this.acquisitionStart = new Date(this.data.balance.acquisitionPeriodStart);
      this.acquisitionEnd = new Date(this.data.balance.acquisitionPeriodEnd);
      this.calculateUsagePeriod();
    }
  }

  onDateChange() {
    this.validationError = '';

    if (this.acquisitionStart && this.acquisitionEnd) {
      if (this.acquisitionEnd <= this.acquisitionStart) {
        this.validationError = 'A data de fim deve ser posterior à data de início';
        return;
      }

      // Validar período de aproximadamente 12 meses (365-366 dias)
      const diffTime = Math.abs(this.acquisitionEnd.getTime() - this.acquisitionStart.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays < 360 || diffDays > 370) {
        this.validationError = `O período aquisitivo deve ter aproximadamente 12 meses (atual: ${diffDays} dias)`;
      }

      this.calculateUsagePeriod();
    }
  }

  calculateUsagePeriod() {
    if (this.acquisitionEnd) {
      // Período de gozo começa no dia seguinte ao fim do período aquisitivo
      this.usagePeriodStart = new Date(this.acquisitionEnd);
      this.usagePeriodStart.setDate(this.usagePeriodStart.getDate() + 1);

      // E dura 12 meses
      this.usagePeriodEnd = new Date(this.usagePeriodStart);
      this.usagePeriodEnd.setFullYear(this.usagePeriodEnd.getFullYear() + 1);
      this.usagePeriodEnd.setDate(this.usagePeriodEnd.getDate() - 1);
    }
  }

  isValid(): boolean {
    if (!this.acquisitionStart || !this.acquisitionEnd || !this.availableDays) {
      return false;
    }

    if (this.availableDays < 0 || this.availableDays > 30) {
      return false;
    }

    if (this.acquisitionEnd <= this.acquisitionStart) {
      return false;
    }

    const diffTime = Math.abs(this.acquisitionEnd.getTime() - this.acquisitionStart.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 360 || diffDays > 370) {
      return false;
    }

    return true;
  }

  onSave() {
    if (!this.isValid()) {
      return;
    }

    const result: any = {
      availableDays: this.availableDays,
      acquisitionPeriodStart: this.acquisitionStart!.toISOString(),
      acquisitionPeriodEnd: this.acquisitionEnd!.toISOString()
    };

    if (this.data.mode === 'create' && this.data.userId) {
      result.userId = this.data.userId;
    }

    this.dialogRef.close(result);
  }

  onCancel() {
    this.dialogRef.close();
  }

  formatDate(date: Date | null): string {
    if (!date) return '';
    return date.toLocaleDateString('pt-BR');
  }
}
