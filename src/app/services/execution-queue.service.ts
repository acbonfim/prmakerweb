import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  ExecutionCardQueue,
  ExecutionRequest,
  ExecutionRequestKind,
  ExecutionUsageReport,
  ExecutionUserSettings,
  ExecutionWorker
} from '../components/execution-plan/execution-queue.model';

/** Fila de execução e executores (feature 0039): "Analisar com Claude" sem abrir o terminal. */
@Injectable({ providedIn: 'root' })
export class ExecutionQueueService {
  private http = inject(HttpClient);
  private queueUrl = `${environment.apiUrl}ExecutionQueue`;
  private workerUrl = `${environment.apiUrl}ExecutionWorker`;

  /** Pede para rodar a skill no card (kind vazio: continua se há plano aberto, senão analisa). */
  create(cardNumber: string, options: { kind?: ExecutionRequestKind | null; targetWorkerId?: string | null; note?: string | null; force?: boolean } = {}): Observable<ExecutionRequest> {
    return this.http.post<ExecutionRequest>(this.queueUrl, {
      cardNumber,
      kind: options.kind ?? null,
      targetWorkerId: options.targetWorkerId ?? null,
      note: options.note?.trim() || null,
      force: !!options.force
    });
  }

  card(cardNumber: string): Observable<ExecutionCardQueue> {
    return this.http.get<ExecutionCardQueue>(`${this.queueUrl}/card/${encodeURIComponent(cardNumber)}`);
  }

  cancel(id: string, reason?: string | null): Observable<ExecutionRequest> {
    return this.http.post<ExecutionRequest>(`${this.queueUrl}/${id}/cancel`, { reason: reason || null });
  }

  retry(id: string): Observable<ExecutionRequest> {
    return this.http.post<ExecutionRequest>(`${this.queueUrl}/${id}/retry`, {});
  }

  /** "Rodar mesmo assim" com o orçamento do dia estourado. */
  force(id: string): Observable<ExecutionRequest> {
    return this.http.post<ExecutionRequest>(`${this.queueUrl}/${id}/force`, {});
  }

  myRequests(): Observable<ExecutionRequest[]> {
    return this.http.get<ExecutionRequest[]>(`${this.queueUrl}/mine`);
  }

  myWorkers(): Observable<ExecutionWorker[]> {
    return this.http.get<ExecutionWorker[]>(`${this.workerUrl}/mine`);
  }

  configureWorker(id: string, changes: { name?: string | null; maxConcurrency?: number | null }): Observable<ExecutionWorker> {
    return this.http.patch<ExecutionWorker>(`${this.workerUrl}/${id}`, changes);
  }

  /** "Rodar diagnóstico agora": a máquina roda no próximo sinal de vida (até 1 min). */
  requestDoctor(id: string): Observable<ExecutionWorker> {
    return this.http.post<ExecutionWorker>(`${this.workerUrl}/${id}/doctor-request`, {});
  }

  pauseWorker(id: string): Observable<ExecutionWorker> {
    return this.http.post<ExecutionWorker>(`${this.workerUrl}/${id}/pause`, {});
  }

  resumeWorker(id: string): Observable<ExecutionWorker> {
    return this.http.post<ExecutionWorker>(`${this.workerUrl}/${id}/resume`, {});
  }

  revokeWorker(id: string): Observable<ExecutionWorker> {
    return this.http.post<ExecutionWorker>(`${this.workerUrl}/${id}/revoke`, {});
  }

  settings(): Observable<ExecutionUserSettings> {
    return this.http.get<ExecutionUserSettings>(`${this.workerUrl}/settings`);
  }

  saveSettings(settings: Partial<ExecutionUserSettings>): Observable<ExecutionUserSettings> {
    return this.http.put<ExecutionUserSettings>(`${this.workerUrl}/settings`, settings);
  }

  /** Consumo médio por plano com MCP × sem MCP (0041); all = de todos (só admin). */
  usageReport(days = 30, all = false): Observable<ExecutionUsageReport> {
    return this.http.get<ExecutionUsageReport>(`${environment.apiUrl}ExecutionPlan/usage-report`, { params: { days, all } });
  }

  agent(): Observable<{ version?: string | null; rids: string[] }> {
    return this.http.get<{ version?: string | null; rids: string[] }>(`${this.workerUrl}/agent`);
  }
}
