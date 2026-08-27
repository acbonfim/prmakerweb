export interface VacationRequest {
  id?: number;
  userId: string;
  userFullName?: string;
  startDate: string;
  endDate: string;
  businessDays: number;
  status: VacationStatus;
  statusDescription?: string;
  managerNotes?: string | null;
  hrNotes?: string | null;
  approvedByManagerId?: string | null;
  approvedByManagerAt?: string | null;
  authorizedByHRId?: string | null;
  authorizedByHRAt?: string | null;
  createdAt?: string;
  updatedAt?: string | null;
}

export interface CreateVacationRequest {
  startDate: string;
  endDate: string;
  businessDays: number;
}

export interface UpdateVacationRequest {
  startDate: string;
  endDate: string;
  businessDays: number;
}

export interface ApproveVacationRequest {
  notes?: string;
}

export interface AuthorizeVacationRequest {
  notes?: string;
}

export interface VacationBalance {
  id: number;
  userId: string;
  availableDays: number;
  usedDays: number;
  remainingDays: number;
  acquisitionPeriodStart: string;
  acquisitionPeriodEnd: string;
  usagePeriodStart: string;
  usagePeriodEnd: string;
  year: number;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string | null;
}

export interface CreateVacationBalance {
  userId: string;
  availableDays: number;
  acquisitionPeriodStart: string;
  acquisitionPeriodEnd: string;
}

export interface UpdateVacationBalance {
  availableDays: number;
  acquisitionPeriodStart: string;
  acquisitionPeriodEnd: string;
}

export interface CalendarDay {
  date: string;
  isOccupied: boolean;
  occupancies: CalendarOccupancy[];
}

export interface CalendarOccupancy {
  userId: string;
  userName: string;
  vacationRequestId: number;
  statusId: number;
  statusName: string;
  createdAt?: string | null;
  approvedByManagerId?: string | null;
  approvedByManagerAt?: string | null;
  approvedByManagerName?: string | null;
  authorizedByHRId?: string | null;
  authorizedByHRAt?: string | null;
  authorizedByHRName?: string | null;
}

export enum VacationStatus {
  PendingApproval = 1,
  ApprovedByManager = 2,
  AuthorizedByHR = 3,
  Completed = 4,
  Cancelled = 5
}

export const VacationStatusLabels: Record<VacationStatus, { label: string; color: string }> = {
  [VacationStatus.PendingApproval]: { label: 'Aguardando Aprovação', color: 'orange' },
  [VacationStatus.ApprovedByManager]: { label: 'Aprovado pelo Gestor', color: 'blue' },
  [VacationStatus.AuthorizedByHR]: { label: 'Autorizado pelo RH', color: 'green' },
  [VacationStatus.Completed]: { label: 'Concluído', color: 'gray' },
  [VacationStatus.Cancelled]: { label: 'Cancelado', color: 'red' }
};
