import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  ExecutionLink,
  ExecutionLog,
  ExecutionPlan,
  ExecutionQuestion,
  ExecutionPlanSummary,
  ExecutionStep,
  PlanStatus
} from '../components/execution-plan/execution-plan.model';

/** API do plano de execução das skills (feature 0023). */
@Injectable({ providedIn: 'root' })
export class ExecutionPlanService {
  private http = inject(HttpClient);
  // environment.apiUrl já termina com /api/v1/
  private apiUrl = `${environment.apiUrl}ExecutionPlan`;

  /** Plano mais recente do card, ou null quando o card não tem plano (204). */
  getCurrent(cardNumber: string): Observable<ExecutionPlan | null> {
    return this.http.get<ExecutionPlan | null>(`${this.apiUrl}/card/${encodeURIComponent(cardNumber)}/current`);
  }

  get(planId: string): Observable<ExecutionPlan> {
    return this.http.get<ExecutionPlan>(`${this.apiUrl}/${planId}`);
  }

  /** Planos do card (histórico), do mais recente para o mais antigo. */
  history(cardNumber: string): Observable<ExecutionPlanSummary[]> {
    return this.http.get<ExecutionPlanSummary[]>(`${this.apiUrl}/card/${encodeURIComponent(cardNumber)}`);
  }

  /** Registros de andamento depois de `afterId` (cursor incremental). */
  logs(planId: string, afterId: number, limit = 1000): Observable<ExecutionLog[]> {
    const params = new HttpParams().set('afterId', afterId).set('limit', limit);
    return this.http.get<ExecutionLog[]>(`${this.apiUrl}/${planId}/logs`, { params });
  }

  changeStatus(planId: string, status: PlanStatus, reason?: string | null): Observable<ExecutionPlan> {
    return this.http.post<ExecutionPlan>(`${this.apiUrl}/${planId}/status`, { status, reason: reason || null });
  }

  cancelStep(planId: string, stepKey: string, reason: string): Observable<ExecutionStep> {
    return this.http.post<ExecutionStep>(`${this.apiUrl}/${planId}/steps/${encodeURIComponent(stepKey)}/cancel`, { reason });
  }

  // ── 0024 ──────────────────────────────────────────────────────────────────────────────────────

  startStep(planId: string, stepKey: string): Observable<ExecutionStep> {
    return this.http.post<ExecutionStep>(`${this.apiUrl}/${planId}/steps/${encodeURIComponent(stepKey)}/start`, {});
  }

  completeStep(planId: string, stepKey: string, reason?: string | null): Observable<ExecutionStep> {
    return this.http.post<ExecutionStep>(`${this.apiUrl}/${planId}/steps/${encodeURIComponent(stepKey)}/complete`, { reason: reason || null });
  }

  answer(planId: string, questionId: string, answer: string): Observable<ExecutionQuestion> {
    return this.http.post<ExecutionQuestion>(`${this.apiUrl}/${planId}/questions/${questionId}/answer`, { answer });
  }

  addLink(planId: string, stepKey: string, link: { url: string; title?: string | null; kind?: string | null; blocksStep: boolean }): Observable<ExecutionLink> {
    return this.http.post<ExecutionLink>(`${this.apiUrl}/${planId}/steps/${encodeURIComponent(stepKey)}/links`, link);
  }

  updateLink(planId: string, linkId: string, changes: { status?: string; title?: string }): Observable<ExecutionLink> {
    return this.http.patch<ExecutionLink>(`${this.apiUrl}/${planId}/links/${linkId}`, changes);
  }

  deleteLink(planId: string, linkId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${planId}/links/${linkId}`);
  }

  /** Conteúdo de um arquivo (a api-key vai pelo interceptor; por isso blob, não <img src>). */
  content(planId: string, artifactId: string): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/${planId}/artifacts/${artifactId}/content`, { responseType: 'blob' });
  }

  zip(planId: string): Observable<HttpResponse<Blob>> {
    return this.http.get(`${this.apiUrl}/${planId}/artifacts/zip`, { responseType: 'blob', observe: 'response' });
  }

  deleteArtifact(planId: string, artifactId: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${planId}/artifacts/${artifactId}`);
  }
}

/** Salva um blob como arquivo (download pelo navegador). */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Nome do arquivo do header Content-Disposition (filename*=UTF-8'' ou filename=). */
export function fileNameFromResponse(res: HttpResponse<Blob>, fallback: string): string {
  const header = res.headers.get('content-disposition') ?? '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) return decodeURIComponent(star[1]);
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1] : fallback;
}

/** Mensagem de erro da API ({ error }) ou uma genérica. */
export function planApiError(err: any, fallback: string): string {
  const body = err?.error;
  return (typeof body === 'string' && body) || body?.error || body?.message || fallback;
}
