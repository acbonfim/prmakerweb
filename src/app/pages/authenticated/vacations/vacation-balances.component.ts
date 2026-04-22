import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { ShowLoadComponent } from '../../../components/showLoad/showLoad.component';
import { VacationService } from '../../../services/vacation.service';
import { StorageService } from '../../../services/storage.service';
import { LoadingBarService, LoadingBarModule } from '@ngx-loading-bar/core';
import { VacationBalance } from './models/vacation.model';
import { BalanceModalComponent } from './components/balance-modal.component';

@Component({
  selector: 'app-vacation-balances',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatTooltipModule,
    MatChipsModule,
    LoadingBarModule,
    ShowLoadComponent
  ],
  template: `
    <div class="balances-container">
      <mat-card class="header-card">
        <mat-card-header>
          <mat-card-title>Meus Períodos Aquisitivos de Férias</mat-card-title>
        </mat-card-header>
        <mat-card-actions>
          <button mat-raised-button color="primary" (click)="openCreateModal()" [disabled]="isLoading || isSaving">
            <mat-icon>add</mat-icon>
            Novo Período
          </button>
        </mat-card-actions>
      </mat-card>

      <app-showLoad *ngIf="isLoading"></app-showLoad>

      <div class="balances-list" *ngIf="!isLoading && balances.length > 0">
        <mat-card *ngFor="let balance of balances" class="balance-card">
          <mat-card-header class="mb-2">
            <mat-card-title>
              Ano {{ balance.year }}
              <mat-chip [style.background-color]="balance.isActive ? '#4caf50' : '#9e9e9e'">
                {{ balance.isActive ? 'Ativo' : 'Expirado' }}
              </mat-chip>
            </mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <div class="period-info">
              <div class="period-section">
                <h4>📅 &nbsp; Período Aquisitivo</h4>
                <p class="text-dark">{{ formatDate(balance.acquisitionPeriodStart) }} até {{ formatDate(balance.acquisitionPeriodEnd) }}</p>
                <small>Período em que trabalhou para adquirir as férias</small>
              </div>

              <div class="period-section">
                <h4>🏖️ &nbsp; Período de Gozo</h4>
                <p class="text-dark">{{ formatDate(balance.usagePeriodStart) }} até {{ formatDate(balance.usagePeriodEnd) }}</p>
                <small>Período em que pode tirar as férias</small>
              </div>

              <div class="days-info">
                <div class="day-item">
                  <span class="day-label">Disponível:</span>
                  <span class="day-value">{{ balance.availableDays }} dias</span>
                </div>
                <div class="day-item">
                  <span class="day-label">Usados:</span>
                  <span class="day-value used">{{ balance.usedDays }} dias</span>
                </div>
                <div class="day-item">
                  <span class="day-label">Restantes:</span>
                  <span class="day-value remaining">{{ balance.remainingDays }} dias</span>
                </div>
              </div>
            </div>
          </mat-card-content>
          <mat-card-actions align="end">
            <button mat-icon-button color="primary" (click)="openEditModal(balance)" matTooltip="Editar" [disabled]="isLoading || isSaving">
              <mat-icon>edit</mat-icon>
            </button>
            <button mat-icon-button color="warn" (click)="deleteBalance(balance)" matTooltip="Excluir"
                    [disabled]="balance.usedDays > 0 || isLoading || isSaving">
              <mat-icon>delete</mat-icon>
            </button>
          </mat-card-actions>
        </mat-card>
      </div>

      <div class="empty-state" *ngIf="!isLoading && balances.length === 0">
        <mat-icon>event_busy</mat-icon>
        <p>Você ainda não possui períodos aquisitivos cadastrados.</p>
        <p class="hint">Clique em "Novo Período" para criar seu primeiro período aquisitivo.</p>
      </div>

      <div class="loading-state" *ngIf="isLoading">
        <p>Carregando períodos aquisitivos...</p>
      </div>
    </div>
  `,
  styles: [`
    .balances-container {
      padding: 20px;
      max-width: 1200px;
      margin: 0 auto;
    }

    .header-card {
      margin-bottom: 24px;
    }

    mat-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
    }

    mat-card-actions {
      margin: 0;
      padding: 16px;
    }

    .balances-list {
      display: grid;
      gap: 20px;
      grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
    }

    .balance-card {
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .balance-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }

    .balance-card mat-card-title {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 18px;
    }

    mat-chip {
      color: white !important;
      font-weight: 500;
      font-size: 11px;
    }

    .period-info {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .period-section {
      padding: 12px;
      background: #f5f5f5;
      border-radius: 8px;
    }

    .period-section h4 {
      margin: 0 0 8px 0;
      font-size: 14px;
      color: #1976d2;
    }

    .period-section p {
      margin: 0 0 4px 0;
      font-weight: 500;
      font-size: 15px;
    }

    .period-section small {
      color: #666;
      font-size: 12px;
    }

    .days-info {
      display: flex;
      justify-content: space-around;
      padding: 16px;
      background: #e3f2fd;
      border-radius: 8px;
    }

    .day-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }

    .day-label {
      font-size: 12px;
      color: #666;
      font-weight: 500;
    }

    .day-value {
      font-size: 20px;
      font-weight: bold;
      color: #1976d2;
    }

    .day-value.used {
      color: #f57c00;
    }

    .day-value.remaining {
      color: #4caf50;
    }

    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #666;
    }

    .empty-state mat-icon {
      font-size: 64px;
      width: 64px;
      height: 64px;
      color: #bbb;
      margin-bottom: 16px;
    }

    .empty-state p {
      margin: 8px 0;
    }

    .empty-state .hint {
      font-size: 14px;
      color: #999;
    }

    .loading-state {
      text-align: center;
      padding: 40px;
      color: #666;
    }

    @media (max-width: 768px) {
      .balances-container {
        padding: 12px;
      }

      .balances-list {
        grid-template-columns: 1fr;
      }

      .days-info {
        flex-direction: column;
        gap: 12px;
      }
    }
  `]
})
export class VacationBalancesComponent implements OnInit {
  readonly dialog = inject(MatDialog);
  private vacationService = inject(VacationService);
  private storageService = inject(StorageService);
  private snackBar = inject(MatSnackBar);
  private loadingBar = inject(LoadingBarService);
  private cdr = inject(ChangeDetectorRef);

  balances: VacationBalance[] = [];
  isLoading = false;
  isSaving = false;
  currentUser: any = null;

  ngOnInit() {
    this.currentUser = this.storageService.getAccess().user;
    this.loadBalances();
  }

  loadBalances() {
    this.isLoading = true;
    this.loadingBar.start();

    this.vacationService.getMyBalances().subscribe({
      next: (balances) => {
        this.balances = balances;
        this.isLoading = false;
        this.loadingBar.stop();
        this.cdr.detectChanges();
      },
      error: (error) => {
        this.snackBar.open('Erro ao carregar períodos aquisitivos', 'OK', {
          horizontalPosition: 'right',
          verticalPosition: 'top'
        });
        this.isLoading = false;
        this.loadingBar.stop();
      }
    });
  }

  openCreateModal() {
    const dialogRef = this.dialog.open(BalanceModalComponent, {
      width: '500px',
      maxWidth: '90vw',
      data: {
        mode: 'create',
        userId: this.currentUser?.externalId
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.createBalance(result);
      }
    });
  }

  openEditModal(balance: VacationBalance) {
    const dialogRef = this.dialog.open(BalanceModalComponent, {
      width: '500px',
      maxWidth: '90vw',
      data: {
        mode: 'edit',
        balance: balance
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.updateBalance(balance.id, result);
      }
    });
  }

  createBalance(data: any) {
    this.isSaving = true;
    this.loadingBar.start();
    this.isLoading = true;

    this.cdr.detectChanges();

    this.vacationService.createBalance(data).subscribe({
      next: () => {
        this.snackBar.open('Período aquisitivo criado com sucesso!', 'OK', {
          horizontalPosition: 'right',
          verticalPosition: 'top'
        });
        this.loadBalances();
        this.isSaving = false;
        this.loadingBar.stop();
        this.isLoading = false;

        this.cdr.detectChanges();
      },
      error: (error) => {
        this.snackBar.open(error.error?.detail || 'Erro ao criar período aquisitivo', 'OK', {
          horizontalPosition: 'right',
          verticalPosition: 'top'
        });
        this.isSaving = false;
        this.loadingBar.stop();
        this.isLoading = false;

        this.cdr.detectChanges();
      }
    });
  }

  updateBalance(id: number, data: any) {

    this.isSaving = true;
    this.loadingBar.start();
    this.isLoading = true;
    this.cdr.detectChanges();

    this.vacationService.updateBalance(id, data).subscribe({
      next: () => {
        this.snackBar.open('Período aquisitivo atualizado com sucesso!', 'OK', {
          horizontalPosition: 'right',
          verticalPosition: 'top'
        });
        this.loadBalances();
        this.isSaving = false;
        this.loadingBar.stop();
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (error) => {
        this.snackBar.open(error.error?.detail || 'Erro ao atualizar período aquisitivo', 'OK', {
          horizontalPosition: 'right',
          verticalPosition: 'top'
        });
        this.isSaving = false;
        this.loadingBar.stop();
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  deleteBalance(balance: VacationBalance) {
    if (balance.usedDays > 0) {
      this.snackBar.open('Não é possível excluir um período com dias já utilizados', 'OK', {
        horizontalPosition: 'right',
        verticalPosition: 'top'
      });
      return;
    }

    if (!confirm(`Deseja realmente excluir o período aquisitivo do ano ${balance.year}?`)) {
      return;
    }

    this.isSaving = true;
    this.loadingBar.start();

    this.vacationService.deleteBalance(balance.id).subscribe({
      next: () => {
        this.snackBar.open('Período aquisitivo excluído com sucesso!', 'OK', {
          horizontalPosition: 'right',
          verticalPosition: 'top'
        });
        this.loadBalances();
        this.isSaving = false;
        this.loadingBar.stop();
      },
      error: (error) => {
        this.snackBar.open(error.error?.detail || 'Erro ao excluir período aquisitivo', 'OK', {
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
}
