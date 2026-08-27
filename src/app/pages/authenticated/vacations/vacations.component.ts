import { Component, inject, OnInit, ChangeDetectorRef, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { FormsModule } from '@angular/forms';
import { MatNativeDateModule, NativeDateAdapter, DateAdapter, MAT_DATE_LOCALE, MAT_DATE_FORMATS, MAT_NATIVE_DATE_FORMATS } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { VacationService } from '../../../services/vacation.service';
import { StorageService } from '../../../services/storage.service';
import { LoadingBarService, LoadingBarModule } from '@ngx-loading-bar/core';
import {
  VacationRequest,
  VacationBalance,
  CalendarDay,
  VacationStatus,
  VacationStatusLabels
} from './models/vacation.model';
import { VacationRequestModalComponent } from './components/vacation-request-modal.component';
import { ShowLoadComponent } from '../../../components/showLoad/showLoad.component';

interface CalendarDayView {
  date: Date;
  dayNumber: number;
  isCurrentMonth: boolean;
  isOccupied: boolean;
  occupancies: Array<{
    userName: string;
    userId: string;
    statusId: number;
    statusName: string;
    createdAt?: string | null;
    approvedByManagerId?: string | null;
    approvedByManagerAt?: string | null;
    approvedByManagerName?: string | null;
    authorizedByHRId?: string | null;
    authorizedByHRAt?: string | null;
    authorizedByHRName?: string | null;
  }>;
  isToday: boolean;
}

interface CalendarStatusConfig {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: string;
}

const CALENDAR_STATUS_CONFIG: Record<number, CalendarStatusConfig> = {
  1: { label: 'Aguardando Aprovação', color: '#b45309', bgColor: '#fef3c7', borderColor: '#f59e0b', icon: 'schedule' },
  2: { label: 'Aprovado pelo Gestor', color: '#1d4ed8', bgColor: '#dbeafe', borderColor: '#3b82f6', icon: 'thumb_up' },
  3: { label: 'Autorizado pelo RH',   color: '#065f46', bgColor: '#d1fae5', borderColor: '#10b981', icon: 'verified' },
  4: { label: 'Concluído',            color: '#374151', bgColor: '#f3f4f6', borderColor: '#6b7280', icon: 'check_circle' },
  5: { label: 'Cancelado',            color: '#991b1b', bgColor: '#fee2e2', borderColor: '#ef4444', icon: 'cancel' },
};

@Component({
  selector: 'app-vacations',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatTabsModule,
    MatTooltipModule,
    MatChipsModule,
    MatFormFieldModule,
    MatSelectModule,
    FormsModule,
    LoadingBarModule,
    MatNativeDateModule,
    MatDatepickerModule,
    ShowLoadComponent
  ],
  providers: [
    { provide: MAT_DATE_LOCALE, useValue: 'pt-BR' },
    { provide: DateAdapter, useClass: NativeDateAdapter },
    { provide: MAT_DATE_FORMATS, useValue: MAT_NATIVE_DATE_FORMATS }
  ],
  templateUrl: './vacations.component.html',
  styleUrls: ['./vacations.component.css']
})
export class VacationsComponent implements OnInit {
  readonly dialog = inject(MatDialog);
  private vacationService = inject(VacationService);
  private storageService = inject(StorageService);
  private snackBar = inject(MatSnackBar);
  private loadingBar = inject(LoadingBarService);
  private cdr = inject(ChangeDetectorRef);

  currentUser: any = null;
  currentYear = new Date().getFullYear();
  currentMonth = new Date().getMonth();
  monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  weekDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  departments: string[] = [];
  selectedDepartment: string | null = null;
  isLoadingDepartments = false;

  calendarDays: CalendarDayView[] = [];
  myRequests: VacationRequest[] = [];
  allRequests: VacationRequest[] = [];
  myBalances: VacationBalance[] = [];
  activeBalances: VacationBalance[] = [];

  isLoadingCalendar = false;
  isLoadingRequests = false;
  isLoadingBalance = false;
  isManager = false;
  isSaving = false;

  @ViewChild('tooltipEl') tooltipEl?: ElementRef<HTMLElement>;

  tooltipDay: CalendarDayView | null = null;
  tooltipX = 0;
  tooltipY = 0;

  VacationStatus = VacationStatus;
  VacationStatusLabels = VacationStatusLabels;

  ngOnInit() {
    this.currentUser = this.storageService.getAccess().user;
    this.checkUserRole();
    this.loadDepartments();
    this.loadMyRequests();
    this.loadBalance();
  }

  loadDepartments() {
    this.isLoadingDepartments = true;
    this.vacationService.getDepartments().subscribe({
      next: (deps) => {
        this.departments = deps;
        this.isLoadingDepartments = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.snackBar.open('Erro ao carregar time', 'OK', {
          horizontalPosition: 'right',
          verticalPosition: 'top'
        });
        this.isLoadingDepartments = false;
      }
    });
  }

  onDepartmentChange() {
    if (this.selectedDepartment) {
      this.loadCalendar();
      if (this.isManager) {
        this.loadAllRequests();
      }
    }
  }

  reloadAfterAction() {
    this.loadCalendar();
    this.loadMyRequests();
    this.loadBalance();
    if (this.isManager) {
      this.loadAllRequests();
    }
  }

  checkUserRole() {
    const token = this.storageService.getItem('apiKey');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const roles = Array.isArray(payload.role) ? payload.role : [payload.role];
        this.isManager = roles.includes('gestor') || roles.includes('admin');
      } catch (error) {
        console.error('Erro ao decodificar token:', error);
      }
    }
  }

  loadCalendar() {
    if (!this.selectedDepartment) return;

    this.isLoadingCalendar = true;
    this.loadingBar.start();

    this.vacationService.getCalendar(this.currentMonth + 1, this.currentYear, this.selectedDepartment).subscribe({
      next: (calendarData) => {
        this.buildCalendarView(calendarData);
        this.isLoadingCalendar = false;
        this.loadingBar.stop();
        this.cdr.detectChanges();
      },
      error: (error) => {
        this.snackBar.open('Erro ao carregar calendário', 'OK', {
          horizontalPosition: 'right',
          verticalPosition: 'top'
        });
        this.isLoadingCalendar = false;
        this.loadingBar.stop();
        this.cdr.detectChanges();
      }
    });
  }

  buildCalendarView(calendarData: CalendarDay[]) {
    const firstDay = new Date(this.currentYear, this.currentMonth, 1);
    const lastDay = new Date(this.currentYear, this.currentMonth + 1, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const calendarMap = new Map<string, CalendarDay>();
    calendarData.forEach(day => {
      const dateKey = new Date(day.date).toISOString().split('T')[0];
      calendarMap.set(dateKey, day);
    });

    this.calendarDays = [];

    // Adicionar dias vazios do início
    const startDayOfWeek = firstDay.getDay();
    for (let i = 0; i < startDayOfWeek; i++) {
      const prevDate = new Date(this.currentYear, this.currentMonth, -(startDayOfWeek - i - 1));
      this.calendarDays.push({
        date: prevDate,
        dayNumber: prevDate.getDate(),
        isCurrentMonth: false,
        isOccupied: false,
        occupancies: [],
        isToday: false
      });
    }

    // Adicionar dias do mês atual
    for (let day = 1; day <= lastDay.getDate(); day++) {
      const date = new Date(this.currentYear, this.currentMonth, day);
      const dateKey = date.toISOString().split('T')[0];
      const calendarDay = calendarMap.get(dateKey);

      this.calendarDays.push({
        date: date,
        dayNumber: day,
        isCurrentMonth: true,
        isOccupied: calendarDay?.isOccupied || false,
        occupancies: calendarDay?.occupancies.map(occ => ({
          userName: occ.userName,
          userId: occ.userId,
          statusId: occ.statusId,
          statusName: occ.statusName,
          createdAt: occ.createdAt,
          approvedByManagerId: occ.approvedByManagerId,
          approvedByManagerAt: occ.approvedByManagerAt,
          approvedByManagerName: occ.approvedByManagerName,
          authorizedByHRId: occ.authorizedByHRId,
          authorizedByHRAt: occ.authorizedByHRAt,
          authorizedByHRName: occ.authorizedByHRName,
        })) || [],
        isToday: date.getTime() === today.getTime()
      });
    }

    // Adicionar dias vazios do final
    const remainingDays = 42 - this.calendarDays.length;
    for (let i = 1; i <= remainingDays; i++) {
      const nextDate = new Date(this.currentYear, this.currentMonth + 1, i);
      this.calendarDays.push({
        date: nextDate,
        dayNumber: nextDate.getDate(),
        isCurrentMonth: false,
        isOccupied: false,
        occupancies: [],
        isToday: false
      });
    }
  }

  loadMyRequests() {
    this.isLoadingRequests = true;
    this.loadingBar.start();

    this.vacationService.getMyRequests().subscribe({
      next: (requests) => {
        this.myRequests = requests;
        this.isLoadingRequests = false;
        this.loadingBar.stop();
        this.cdr.detectChanges();
      },
      error: (error) => {
        this.snackBar.open('Erro ao carregar minhas solicitações', 'OK', {
          horizontalPosition: 'right',
          verticalPosition: 'top'
        });
        this.isLoadingRequests = false;
        this.loadingBar.stop();
      }
    });
  }

  loadAllRequests() {
    if (!this.selectedDepartment) return;

    this.vacationService.getAllRequests(this.selectedDepartment).subscribe({
      next: (requests) => {
        this.allRequests = requests;
        this.cdr.detectChanges();
      },
      error: () => {
        this.snackBar.open('Erro ao carregar todas as solicitações', 'OK', {
          horizontalPosition: 'right',
          verticalPosition: 'top'
        });
      }
    });
  }

  loadBalance() {
    this.isLoadingBalance = true;

    this.vacationService.getMyBalances().subscribe({
      next: (balances) => {
        this.myBalances = balances;
        this.activeBalances = balances.filter(b => b.isActive);
        this.isLoadingBalance = false;
        this.cdr.detectChanges();
      },
      error: (error) => {
        this.snackBar.open('Erro ao carregar saldo de férias', 'OK', {
          horizontalPosition: 'right',
          verticalPosition: 'top'
        });
        this.isLoadingBalance = false;
      }
    });
  }

  getTotalRemainingDays(): number {
    return this.activeBalances.reduce((sum, balance) => sum + balance.remainingDays, 0);
  }

  getTotalAvailableDays(): number {
    return this.activeBalances.reduce((sum, balance) => sum + balance.availableDays, 0);
  }

  getTotalUsedDays(): number {
    return this.activeBalances.reduce((sum, balance) => sum + balance.usedDays, 0);
  }

  previousMonth() {
    if (this.currentMonth === 0) {
      this.currentMonth = 11;
      this.currentYear--;
    } else {
      this.currentMonth--;
    }
    this.loadCalendar();
  }

  nextMonth() {
    if (this.currentMonth === 11) {
      this.currentMonth = 0;
      this.currentYear++;
    } else {
      this.currentMonth++;
    }
    this.loadCalendar();
  }

  openCreateRequestModal() {
    // Usar o primeiro período ativo como referência (pode ser melhorado para selecionar o período)
    const balance = this.activeBalances.length > 0 ? this.activeBalances[0] : null;

    const dialogRef = this.dialog.open(VacationRequestModalComponent, {
      width: '600px',
      maxWidth: '90vw',
      data: {
        mode: 'create',
        balance: balance
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.createVacationRequest(result);
      }
    });
  }

  openEditRequestModal(request: VacationRequest) {
    if (request.status !== VacationStatus.PendingApproval) {
      this.snackBar.open('Apenas solicitações pendentes podem ser editadas', 'OK', {
        horizontalPosition: 'right',
        verticalPosition: 'top'
      });
      return;
    }

    const balance = this.activeBalances.length > 0 ? this.activeBalances[0] : null;

    const dialogRef = this.dialog.open(VacationRequestModalComponent, {
      width: '600px',
      maxWidth: '90vw',
      data: {
        mode: 'edit',
        request: request,
        balance: balance
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.updateVacationRequest(request.id!, result);
      }
    });
  }

  createVacationRequest(data: any) {
    this.isSaving = true;
    this.loadingBar.start();

    this.vacationService.createVacationRequest(data).subscribe({
      next: () => {
        this.snackBar.open('Solicitação de férias criada com sucesso!', 'OK', {
          horizontalPosition: 'right',
          verticalPosition: 'top'
        });
        this.reloadAfterAction();
        this.isSaving = false;
        this.loadingBar.stop();
      },
      error: (error) => {
        this.snackBar.open(error.error?.detail || 'Erro ao criar solicitação', 'OK', {
          horizontalPosition: 'right',
          verticalPosition: 'top'
        });
        this.isSaving = false;
        this.loadingBar.stop();
      }
    });
  }

  updateVacationRequest(id: number, data: any) {
    this.isSaving = true;
    this.loadingBar.start();

    this.vacationService.updateVacationRequest(id, data).subscribe({
      next: () => {
        this.snackBar.open('Solicitação atualizada com sucesso!', 'OK', {
          horizontalPosition: 'right',
          verticalPosition: 'top'
        });
        this.reloadAfterAction();
        this.isSaving = false;
        this.loadingBar.stop();
      },
      error: (error) => {
        this.snackBar.open(error.error?.detail || 'Erro ao atualizar solicitação', 'OK', {
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
        this.reloadAfterAction();
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
        this.reloadAfterAction();
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
        this.reloadAfterAction();
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

  canEdit(request: VacationRequest): boolean {
    return request.status === VacationStatus.PendingApproval &&
      request.userId === this.currentUser?.externalId;
  }

  canDelete(request: VacationRequest): boolean {
    if (this.isManager) {
      return request.status !== VacationStatus.Completed &&
        request.status !== VacationStatus.Cancelled;
    }
    return request.status === VacationStatus.PendingApproval &&
      request.userId === this.currentUser?.externalId;
  }

  canApprove(request: VacationRequest): boolean {
    return this.isManager && request.status === VacationStatus.PendingApproval;
  }

  canAuthorize(request: VacationRequest): boolean {
    return this.isManager && request.status === VacationStatus.ApprovedByManager;
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR');
  }

  formatDateTime(dateString: string | null | undefined): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR') + ' às ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  getStatusColor(status: VacationStatus): string {
    return VacationStatusLabels[status]?.color || 'gray';
  }

  getStatusLabel(status: VacationStatus): string {
    return VacationStatusLabels[status]?.label || 'Desconhecido';
  }

  getOccupancyTooltip(occupancies: Array<{ userName: string }>): string {
    return occupancies.map(o => o.userName).join(', ');
  }

  getCalendarStatusConfig(statusId: number): CalendarStatusConfig {
    return CALENDAR_STATUS_CONFIG[statusId] ?? { label: 'Desconhecido', color: '#6b7280', bgColor: '#f3f4f6', borderColor: '#9ca3af', icon: 'help' };
  }

  getDominantStatusId(day: CalendarDayView): number {
    if (!day.isOccupied || day.occupancies.length === 0) return 0;
    const priority: Record<number, number> = { 3: 5, 2: 4, 1: 3, 4: 2, 5: 1 };
    return day.occupancies.reduce((best, occ) =>
      (priority[occ.statusId] ?? 0) > (priority[best] ?? 0) ? occ.statusId : best,
      day.occupancies[0].statusId
    );
  }

  getDayStyle(day: CalendarDayView): Record<string, string> {
    if (!day.isOccupied) return {};
    const config = this.getCalendarStatusConfig(this.getDominantStatusId(day));
    return { background: config.bgColor, 'border-color': config.borderColor };
  }

  showTooltip(event: MouseEvent, day: CalendarDayView) {
    if (!day.isOccupied || day.occupancies.length === 0) return;
    this.tooltipDay = day;
    // Posição inicial fora da tela para o elemento renderizar sem flicker
    this.tooltipX = -9999;
    this.tooltipY = -9999;
    this.cdr.detectChanges();
    this.positionTooltip(event.clientX, event.clientY);
  }

  moveTooltip(event: MouseEvent) {
    if (!this.tooltipDay) return;
    this.positionTooltip(event.clientX, event.clientY);
  }

  hideTooltip() {
    this.tooltipDay = null;
  }

  private positionTooltip(cursorX: number, cursorY: number) {
    const offset = 14;
    const el = this.tooltipEl?.nativeElement;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const tipW = el ? el.offsetWidth  : 360;
    const tipH = el ? el.offsetHeight : 200;

    // Horizontal: prefere à direita, empurra para a esquerda se não couber
    this.tooltipX = cursorX + offset + tipW > vw
      ? cursorX - tipW - offset
      : cursorX + offset;

    // Vertical: prefere abaixo, sobe se não couber
    this.tooltipY = cursorY + offset + tipH > vh
      ? cursorY - tipH - offset
      : cursorY + offset;
  }
}
