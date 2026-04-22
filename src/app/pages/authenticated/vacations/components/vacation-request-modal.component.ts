import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule, NativeDateAdapter, DateAdapter, MAT_DATE_FORMATS, MAT_DATE_LOCALE, MAT_NATIVE_DATE_FORMATS } from '@angular/material/core';
import { VacationRequest, VacationBalance } from '../models/vacation.model';

interface DialogData {
  mode: 'create' | 'edit';
  request?: VacationRequest;
  balance: VacationBalance | null;
}

@Component({
  selector: 'app-vacation-request-modal',
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
      {{ data.mode === 'create' ? 'Nova Solicitação de Férias' : 'Editar Solicitação' }}
    </h2>

    <mat-dialog-content>
      <div class="balance-info" *ngIf="data.balance">
        <p>
          <strong>Saldo disponível:</strong> {{ data.balance.remainingDays }} dias
        </p>
      </div>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Data de Início</mat-label>
        <input
          matInput
          [matDatepicker]="startPicker"
          [(ngModel)]="startDate"
          [min]="minDate"
          (dateChange)="onDateChange()"
          required
        />
        <mat-datepicker-toggle matSuffix [for]="startPicker"></mat-datepicker-toggle>
        <mat-datepicker #startPicker></mat-datepicker>
        <mat-error *ngIf="!startDate">Campo obrigatório</mat-error>
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Data de Fim</mat-label>
        <input
          matInput
          [matDatepicker]="endPicker"
          [(ngModel)]="endDate"
          [min]="startDate || minDate"
          (dateChange)="onDateChange()"
          required
        />
        <mat-datepicker-toggle matSuffix [for]="endPicker"></mat-datepicker-toggle>
        <mat-datepicker #endPicker></mat-datepicker>
        <mat-error *ngIf="!endDate">Campo obrigatório</mat-error>
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Dias Úteis</mat-label>
        <input
          matInput
          type="number"
          [(ngModel)]="businessDays"
          [min]="1"
          required
        />
        <mat-error *ngIf="!businessDays || businessDays <= 0">
          Deve ser maior que zero
        </mat-error>
      </mat-form-field>

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
      min-width: 400px;
      padding: 20px 24px;
    }

    .full-width {
      width: 100%;
    }

    .balance-info {
      background: #e3f2fd;
      padding: 12px;
      border-radius: 4px;
      margin-bottom: 8px;
    }

    .balance-info p {
      margin: 0;
      color: #1976d2;
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
export class VacationRequestModalComponent implements OnInit {
  startDate: Date | null = null;
  endDate: Date | null = null;
  businessDays: number = 1;
  minDate: Date = new Date();
  validationError: string = '';

  constructor(
    public dialogRef: MatDialogRef<VacationRequestModalComponent>,
    @Inject(MAT_DIALOG_DATA) public data: DialogData
  ) {
    this.minDate.setHours(0, 0, 0, 0);
  }

  ngOnInit() {
    if (this.data.mode === 'edit' && this.data.request) {
      this.startDate = new Date(this.data.request.startDate);
      this.endDate = new Date(this.data.request.endDate);
      this.businessDays = this.data.request.businessDays;
    }
  }

  onDateChange() {
    this.validationError = '';

    if (this.startDate && this.endDate) {
      if (this.endDate <= this.startDate) {
        this.validationError = 'A data de fim deve ser posterior à data de início';
      }
    }
  }

  isValid(): boolean {
    if (!this.startDate || !this.endDate || !this.businessDays) {
      return false;
    }

    if (this.businessDays <= 0) {
      return false;
    }

    if (this.endDate <= this.startDate) {
      return false;
    }

    if (this.startDate < this.minDate) {
      return false;
    }

    if (this.data.balance && this.businessDays > this.data.balance.remainingDays) {
      this.validationError = `Saldo insuficiente. Disponível: ${this.data.balance.remainingDays} dias`;
      return false;
    }

    return true;
  }

  onSave() {
    if (!this.isValid()) {
      return;
    }

    const result = {
      startDate: this.startDate!.toISOString(),
      endDate: this.endDate!.toISOString(),
      businessDays: this.businessDays
    };

    this.dialogRef.close(result);
  }

  onCancel() {
    this.dialogRef.close();
  }
}
