import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { FormsModule } from '@angular/forms';
import { VacationService } from '../../../services/vacation.service';
import { LoadingBarService, LoadingBarModule } from '@ngx-loading-bar/core';
import { VacationRequest, VacationStatus, VacationStatusLabels } from './models/vacation.model';
import { ShowLoadComponent } from '../../../components/showLoad/showLoad.component';

@Component({
  selector: 'app-vacation-approvals',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatChipsModule,
    MatTooltipModule,
    MatFormFieldModule,
    MatSelectModule,
    FormsModule,
    LoadingBarModule,
    ShowLoadComponent
  ],
  template: `
    <div class="approvals-container">
      <app-showLoad *ngIf="isLoading"></app-showLoad>

      <mat-card class="header-card">
        <mat-card-header>
          <mat-card-title>Aprovação de Férias</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <mat-form-field appearance="outline">
            <mat-label>Filtrar por Status</mat-label>
            <mat-select [(ngModel)]="statusFilter" (selectionChange)="applyFilter()">
              <mat-option [value]="0">Todos</mat-option>
              <mat-option [value]="1">Aguardando Aprovação</mat-option>
              <mat-option [value]="2">Aprovado pelo Gestor</mat-option>
              <mat-option [value]="3">Autorizado pelo RH</mat-option>
              <mat-option [value]="4">Concluído</mat-option>
            </mat-select>
          </mat-form-field>
        </mat-card-content>
      </mat-card>

      <div class="requests-grid" *ngIf="!isLoading && filteredRequests.length > 0">
        <mat-card *ngFor="let request of filteredRequests" class="request-card">
          <mat-card-header>
            <mat-card-title>
              <div class="user-info">
                <mat-icon>person</mat-icon>
                <span>{{ request.userFullName || request.userId }}</span>
              </div>
              <mat-chip [style.background-color]="getStatusColor(request.status)">
                {{ getStatusLabel(request.status) }}
              </mat-chip>
            </mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <div class="dates-info">
              <div class="date-item">
                <mat-icon>event</mat-icon>
                <div>
                  <strong>{{ formatDate(request.startDate) }}</strong> até <strong>{{ formatDate(request.endDate) }}</strong>
                  <p class="business-days">{{ request.businessDays }} dias úteis</p>
                </div>
              </div>
            </div>

            <div class="notes-section" *ngIf="request.managerNotes || request.hrNotes">
              <div class="note" *ngIf="request.managerNotes">
                <strong>Obs. Gestor:</strong> {{ request.managerNotes }}
              </div>
              <div class="note" *ngIf="request.hrNotes">
                <strong>Obs. RH:</strong> {{ request.hrNotes }}
              </div>
            </div>
          </mat-card-content>
          <mat-card-actions align="end">
            <button
              mat-raised-button
              color="primary"
              *ngIf="canApprove(request)"
              (click)="approveRequest(request)"
              [disabled]="isLoading || isSaving"
            >
              <mat-icon>check</mat-icon>
              Aprovar
            </button>
            <button
              mat-raised-button
              color="accent"
              *ngIf="canAuthorize(request)"
              (click)="authorizeRequest(request)"
              [disabled]="isLoading || isSaving"
            >
              <mat-icon>verified</mat-icon>
              Autorizar RH
            </button>
            <button
              mat-icon-button
              color="warn"
              *ngIf="canDelete(request)"
              (click)="deleteRequest(request)"
              matTooltip="Excluir"
              [disabled]="isLoading || isSaving"
            >
              <mat-icon>delete</mat-icon>
            </button>
          </mat-card-actions>
        </mat-card>
      </div>

      <div class="empty-state" *ngIf="!isLoading && filteredRequests.length === 0">
        <mat-icon>inbox</mat-icon>
        <p>Nenhuma solicitação encontrada.</p>
      </div>

      <div class="loading-state" *ngIf="isLoading">
        <p>Carregando solicitações...</p>
      </div>
    </div>
  `,
  styles: [`
    .approvals-container {
      padding: 20px;
      max-width: 1400px;
      margin: 0 auto;
    }

    .header-card {
      margin-bottom: 24px;
    }

    mat-form-field {
      min-width: 250px;
    }

    .requests-grid {
      display: grid;
      gap: 20px;
      grid-template-columns: repeat(auto-fill, minmax(450px, 1fr));
    }

    .request-card {
      transition: transform 0.2s;
    }

    .request-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }

    .request-card mat-card-title {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }

    .user-info {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 16px;
    }

    mat-chip {
      color: white !important;
      font-weight: 500;
    }

    .dates-info {
      margin: 16px 0;
    }

    .date-item {
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }

    .date-item mat-icon {
      color: #1976d2;
    }

    .business-days {
      color: #666;
      font-size: 13px;
      margin: 4px 0 0 0;
    }

    .notes-section {
      margin-top: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .note {
      padding: 8px;
      background: #f5f5f5;
      border-radius: 4px;
      font-size: 13px;
    }

    .empty-state, .loading-state {
      text-align: center;
      padding: 60px 20px;
      color: #666;
    }

    .empty-state mat-icon {
      font-size: 64px;
      width: 64px;
      height: 64px;
      color: #bbb;
    }

    @media (max-width: 768px) {
      .approvals-container {
        padding: 12px;
      }

      .requests-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class VacationApprovalsComponent implements OnInit {
  private vacationService = inject(VacationService);
  private snackBar = inject(MatSnackBar);
  private loadingBar = inject(LoadingBarService);
  private cdr = inject(ChangeDetectorRef);

  allRequests: VacationRequest[] = [];
  filteredRequests: VacationRequest[] = [];
  statusFilter: number = 0;
  isLoading = false;
  isSaving = false;

  VacationStatus = VacationStatus;
  VacationStatusLabels = VacationStatusLabels;

  ngOnInit() {
    this.loadRequests();
  }

  loadRequests() {
    this.isLoading = true;
    this.loadingBar.start();

    this.vacationService.getAllRequests().subscribe({
      next: (requests) => {
        this.allRequests = requests;
        this.applyFilter();
        this.isLoading = false;
        this.loadingBar.stop();
        this.cdr.detectChanges();
      },
      error: (error) => {
        this.snackBar.open('Erro ao carregar solicitações', 'OK', {
          horizontalPosition: 'right',
          verticalPosition: 'top'
        });
        this.isLoading = false;
        this.loadingBar.stop();
      }
    });
  }

  applyFilter() {
    if (this.statusFilter === 0) {
      this.filteredRequests = this.allRequests;
    } else {
      this.filteredRequests = this.allRequests.filter(r => r.status === this.statusFilter);
    }
  }

  canApprove(request: VacationRequest): boolean {
    return request.status === VacationStatus.PendingApproval;
  }

  canAuthorize(request: VacationRequest): boolean {
    return request.status === VacationStatus.ApprovedByManager;
  }

  canDelete(request: VacationRequest): boolean {
    return request.status !== VacationStatus.Completed && request.status !== VacationStatus.Cancelled;
  }

  approveRequest(request: VacationRequest) {
    const notes = prompt('Observações (opcional):');
    if (notes === null) return;

    this.isSaving = true;
    this.loadingBar.start();

    this.vacationService.approveVacationRequest(request.id!, { notes }).subscribe({
      next: () => {
        this.snackBar.open('Solicitação aprovada com sucesso!', 'OK', {
          horizontalPosition: 'right',
          verticalPosition: 'top'
        });
        this.loadRequests();
        this.isSaving = false;
        this.loadingBar.stop();
      },
      error: (error) => {
        this.snackBar.open(error.error?.detail || 'Erro ao aprovar solicitação', 'OK', {
          horizontalPosition: 'right',
          verticalPosition: 'top'
        });
        this.isSaving = false;
        this.loadingBar.stop();
      }
    });
  }

  authorizeRequest(request: VacationRequest) {
    const notes = prompt('Observações do RH (opcional):');
    if (notes === null) return;

    this.isSaving = true;
    this.loadingBar.start();

    this.vacationService.authorizeVacationRequest(request.id!, { notes }).subscribe({
      next: () => {
        this.snackBar.open('Férias autorizadas com sucesso!', 'OK', {
          horizontalPosition: 'right',
          verticalPosition: 'top'
        });
        this.loadRequests();
        this.isSaving = false;
        this.loadingBar.stop();
      },
      error: (error) => {
        this.snackBar.open(error.error?.detail || 'Erro ao autorizar férias', 'OK', {
          horizontalPosition: 'right',
          verticalPosition: 'top'
        });
        this.isSaving = false;
        this.loadingBar.stop();
      }
    });
  }

  deleteRequest(request: VacationRequest) {
    if (!confirm('Deseja realmente excluir esta solicitação de férias?')) {
      return;
    }

    this.isSaving = true;
    this.loadingBar.start();

    this.vacationService.deleteVacationRequest(request.id!).subscribe({
      next: () => {
        this.snackBar.open('Solicitação excluída com sucesso!', 'OK', {
          horizontalPosition: 'right',
          verticalPosition: 'top'
        });
        this.loadRequests();
        this.isSaving = false;
        this.loadingBar.stop();
      },
      error: (error) => {
        this.snackBar.open(error.error?.detail || 'Erro ao excluir solicitação', 'OK', {
          horizontalPosition: 'right',
          verticalPosition: 'top'
        });
        this.isSaving = false;
        this.loadingBar.stop();
      }
    });
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR');
  }

  getStatusColor(status: VacationStatus): string {
    return VacationStatusLabels[status]?.color || 'gray';
  }

  getStatusLabel(status: VacationStatus): string {
    return VacationStatusLabels[status]?.label || 'Desconhecido';
  }
}
