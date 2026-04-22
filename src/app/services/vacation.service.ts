import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  VacationRequest,
  CreateVacationRequest,
  UpdateVacationRequest,
  ApproveVacationRequest,
  AuthorizeVacationRequest,
  VacationBalance,
  CreateVacationBalance,
  UpdateVacationBalance,
  CalendarDay
} from '../pages/authenticated/vacations/models/vacation.model';

@Injectable({
  providedIn: 'root'
})
export class VacationService {
  private apiUrl = `${environment.apiUrl}Vacations`;

  constructor(private http: HttpClient) {}

  // Solicitações de Férias
  createVacationRequest(request: CreateVacationRequest): Observable<VacationRequest> {
    return this.http.post<VacationRequest>(`${this.apiUrl}/request`, request);
  }

  updateVacationRequest(id: number, request: UpdateVacationRequest): Observable<VacationRequest> {
    return this.http.put<VacationRequest>(`${this.apiUrl}/request/${id}`, request);
  }

  getVacationRequest(id: number): Observable<VacationRequest> {
    return this.http.get<VacationRequest>(`${this.apiUrl}/request/${id}`);
  }

  getMyRequests(): Observable<VacationRequest[]> {
    return this.http.get<VacationRequest[]>(`${this.apiUrl}/my-requests`);
  }

  getAllRequests(): Observable<VacationRequest[]> {
    return this.http.get<VacationRequest[]>(`${this.apiUrl}/all-requests`);
  }

  approveVacationRequest(id: number, request: ApproveVacationRequest): Observable<VacationRequest> {
    return this.http.post<VacationRequest>(`${this.apiUrl}/request/${id}/approve`, request);
  }

  authorizeVacationRequest(id: number, request: AuthorizeVacationRequest): Observable<VacationRequest> {
    return this.http.post<VacationRequest>(`${this.apiUrl}/request/${id}/authorize`, request);
  }

  deleteVacationRequest(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/request/${id}`);
  }

  // Calendário
  getCalendar(month: number, year: number): Observable<CalendarDay[]> {
    const params = new HttpParams()
      .set('month', month.toString())
      .set('year', year.toString());
    return this.http.get<CalendarDay[]>(`${this.apiUrl}/calendar`, { params });
  }

  // Saldo de Férias - NOVOS ENDPOINTS (Recomendados)
  getMyBalances(): Observable<VacationBalance[]> {
    return this.http.get<VacationBalance[]>(`${this.apiUrl}/balances`);
  }

  getUserBalances(userId: string): Observable<VacationBalance[]> {
    return this.http.get<VacationBalance[]>(`${this.apiUrl}/balances/${userId}`);
  }

  createBalance(request: CreateVacationBalance): Observable<VacationBalance> {
    return this.http.post<VacationBalance>(`${this.apiUrl}/balance`, request);
  }

  updateBalance(id: number, request: UpdateVacationBalance): Observable<VacationBalance> {
    return this.http.put<VacationBalance>(`${this.apiUrl}/balance/${id}`, request);
  }

  deleteBalance(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/balance/${id}`);
  }

  // Saldo de Férias - DEPRECATED (Mantido para compatibilidade)
  getMyBalance(year: number): Observable<VacationBalance> {
    const params = new HttpParams().set('year', year.toString());
    return this.http.get<VacationBalance>(`${this.apiUrl}/balance`, { params });
  }

  getUserBalance(userId: string, year: number): Observable<VacationBalance> {
    const params = new HttpParams().set('year', year.toString());
    return this.http.get<VacationBalance>(`${this.apiUrl}/balance/${userId}`, { params });
  }
}
