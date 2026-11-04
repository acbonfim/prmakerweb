import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { CaseAction, CaseChat, CaseFile, CaseMessage, CasePoint, CaseProposal } from '../components/case-chat/case-chat.model';
import { ExecutionRequest } from '../components/execution-plan/execution-queue.model';

export interface PostCaseMessage {
  text?: string;
  transcript?: string;
  voice?: boolean;
  peopleOnly?: boolean;
  deep?: boolean;
  replyTo?: number | null;
  files?: File[];
}

/** 0080: API do Especialista do caso (`api/v1/CaseChat`). */
@Injectable({ providedIn: 'root' })
export class CaseChatService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}CaseChat`;

  private url(card: string, path = ''): string {
    return `${this.apiUrl}/${encodeURIComponent(card)}${path}`;
  }

  get(card: string, limit = 200): Observable<CaseChat> {
    return this.http.get<CaseChat>(this.url(card), { params: new HttpParams().set('limit', limit) });
  }

  post(card: string, m: PostCaseMessage): Observable<CaseMessage> {
    const form = new FormData();
    if (m.text) form.append('text', m.text);
    if (m.transcript) form.append('transcript', m.transcript);
    if (m.voice) form.append('voice', 'true');
    if (m.peopleOnly) form.append('peopleOnly', 'true');
    if (m.deep) form.append('deep', 'true');
    if (m.replyTo) form.append('replyTo', `${m.replyTo}`);
    for (const f of m.files ?? []) form.append('files', f, f.name);
    return this.http.post<CaseMessage>(this.url(card, '/messages'), form);
  }

  edit(card: string, id: string, text: string): Observable<CaseMessage> {
    return this.http.patch<CaseMessage>(this.url(card, `/messages/${id}`), { text });
  }

  remove(card: string, id: string): Observable<void> {
    return this.http.delete<void>(this.url(card, `/messages/${id}`));
  }

  toPlan(card: string, id: string, text?: string): Observable<unknown> {
    return this.http.post(this.url(card, `/messages/${id}/to-plan`), { text: text ?? null });
  }

  typing(card: string): Observable<void> {
    return this.http.post<void>(this.url(card, '/typing'), {});
  }

  ask(card: string, deep = false): Observable<ExecutionRequest | null> {
    return this.http.post<ExecutionRequest | null>(this.url(card, '/ask'), {}, { params: new HttpParams().set('deep', deep) });
  }

  cancelRun(card: string): Observable<ExecutionRequest | null> {
    return this.http.post<ExecutionRequest | null>(this.url(card, '/run/cancel'), {});
  }

  content(card: string, file: CaseFile): Observable<Blob> {
    return this.http.get(this.url(card, `/files/${file.id}/content`), { responseType: 'blob' });
  }

  point(card: string, id: string, status: CasePoint['status']): Observable<CasePoint> {
    return this.http.patch<CasePoint>(this.url(card, `/points/${id}`), { status });
  }

  addPoint(card: string, text: string, messageNumber?: number | null): Observable<CasePoint> {
    return this.http.post<CasePoint>(this.url(card, '/points'), { text, status: 'agreed', messageNumber: messageNumber ?? null });
  }

  decideProposal(card: string, id: string, accept: boolean, execute = false, reason?: string): Observable<CaseProposal> {
    return this.http.post<CaseProposal>(this.url(card, `/proposals/${id}/decision`), { accept, execute, reason: reason ?? null });
  }

  decideAction(card: string, id: string, confirm: boolean): Observable<CaseAction> {
    return this.http.post<CaseAction>(this.url(card, `/actions/${id}/decision`), { confirm });
  }
}
