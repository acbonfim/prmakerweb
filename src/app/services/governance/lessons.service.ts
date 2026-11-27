import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Lesson, LessonData, LessonSignal } from './lessons.logic';

/** 0106: lições aprendidas e sinais de erro (`Governance/lessons`). Ler: todos; editar/aposentar/reativar: admin. */
@Injectable({ providedIn: 'root' })
export class LessonsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}Governance/lessons`;

  list(status: string | null): Observable<Lesson[]> {
    let p = new HttpParams();
    if (status) p = p.set('status', status);
    return this.http.get<Lesson[]>(this.base, { params: p });
  }

  edit(id: number, data: LessonData): Observable<Lesson> {
    return this.http.put<Lesson>(`${this.base}/${id}`, data);
  }

  retire(id: number, reason: string): Observable<Lesson> {
    return this.http.post<Lesson>(`${this.base}/${id}/retire`, { reason });
  }

  reactivate(id: number): Observable<Lesson> {
    return this.http.post<Lesson>(`${this.base}/${id}/reactivate`, {});
  }

  signals(status: string | null = 'open'): Observable<LessonSignal[]> {
    let p = new HttpParams().set('take', 200);
    if (status) p = p.set('status', status);
    return this.http.get<LessonSignal[]>(`${this.base}/signals`, { params: p });
  }

  dismiss(id: number, reason: string): Observable<LessonSignal> {
    return this.http.post<LessonSignal>(`${this.base}/signals/${id}/dismiss`, { reason });
  }
}
