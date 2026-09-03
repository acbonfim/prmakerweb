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

  /**
   * Ingesta uma mensagem do Teams (lida pelo frontend via MSAL) na linha do tempo do card.
   * O backend não duplica: retorna imported=false quando a mensagem já existe.
   */
  ingestTeamsMessage(payload: {
    cardNumber: string;
    messageId: string;
    text: string;
    userName: string;
    occurredAt?: string;
  }): Observable<{ imported: boolean }> {
    return this.http.post<{ imported: boolean }>(`${this.apiUrl}/ingest-teams`, payload);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}
