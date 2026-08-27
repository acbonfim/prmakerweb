import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  TimelineEntry,
  CreateTimelineEntry,
  UpdateTimelineEntry
} from '../components/card-timeline/timeline.model';

@Injectable({
  providedIn: 'root'
})
export class TimelineService {
  // environment.apiUrl já termina com /api/v1/
  private apiUrl = `${environment.apiUrl}Timeline`;

  constructor(private http: HttpClient) {}

  /** Lista todos os registros de um card, do mais recente para o mais antigo. */
  getByCardNumber(cardNumber: string): Observable<TimelineEntry[]> {
    return this.http.get<TimelineEntry[]>(`${this.apiUrl}/card/${encodeURIComponent(cardNumber)}`);
  }

  /** Cria um registro. Para usuário logado o backend preenche o autor automaticamente. */
  create(request: CreateTimelineEntry): Observable<TimelineEntry> {
    return this.http.post<TimelineEntry>(this.apiUrl, request);
  }

  update(id: number, request: UpdateTimelineEntry): Observable<TimelineEntry> {
    return this.http.put<TimelineEntry>(`${this.apiUrl}/${id}`, request);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}
