import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  EPICS_EVENT, EPICS_GROUP, Epic, EpicCard, EpicCardRole, EpicStatus, EpicSummary, EpicsUpdatedPayload, SaveEpicRequest
} from '../components/epics/epic.logic';
import { WsService } from './ws.service';

export type {
  Epic, EpicCard, EpicCardRole, EpicStatus, EpicSummary, EpicsUpdatedPayload, SaveEpicRequest
} from '../components/epics/epic.logic';

/** Filtros do `GET Epics`. */
export interface EpicListQuery {
  status?: EpicStatus | null;
  q?: string | null;
  /** Só os épicos criados por quem está logado. */
  mine?: boolean;
}

/** Time/board do DevOps (`GET DevOps/teams`, `GET DevOps/boards?team=`). */
export interface DevOpsOption {
  id: string;
  name: string;
}

/**
 * 0099: API dos épicos da Mesa de gestão (`api/v1/Epics`) e o tempo real `epicsUpdated` (grupo `epics`). Também lê os
 * times e boards do DevOps para o diálogo do épico (direto, sem depender do serviço de DevOps do board).
 */
@Injectable({ providedIn: 'root' })
export class EpicsService {
  private http = inject(HttpClient);
  private ws = inject(WsService);
  // environment.apiUrl já termina com /api/v1/
  private apiUrl = `${environment.apiUrl}Epics`;
  private devOpsUrl = `${environment.apiUrl}DevOps`;

  list(query: EpicListQuery = {}): Observable<EpicSummary[]> {
    let params = new HttpParams();
    if (query.status) params = params.set('status', query.status);
    if (query.q?.trim()) params = params.set('q', query.q.trim());
    if (query.mine) params = params.set('mine', 'true');
    return this.http.get<EpicSummary[]>(this.apiUrl, { params });
  }

  get(number: number): Observable<Epic> {
    return this.http.get<Epic>(`${this.apiUrl}/${number}`);
  }

  create(body: SaveEpicRequest): Observable<Epic> {
    return this.http.post<Epic>(this.apiUrl, body);
  }

  update(number: number, body: SaveEpicRequest): Observable<Epic> {
    return this.http.put<Epic>(`${this.apiUrl}/${number}`, body);
  }

  setStatus(number: number, status: EpicStatus): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/${number}/status`, { status });
  }

  addCard(number: number, card: string, role: EpicCardRole = 'linked'): Observable<EpicCard> {
    return this.http.post<EpicCard>(`${this.apiUrl}/${number}/cards`, { card, role });
  }

  removeCard(number: number, card: string): Observable<unknown> {
    return this.http.delete(`${this.apiUrl}/${number}/cards/${encodeURIComponent(card)}`);
  }

  /** Épicos em que o card está (chips da Bancada). */
  byCard(card: string): Observable<EpicSummary[]> {
    return this.http.get<EpicSummary[]>(`${this.apiUrl}/by-card/${encodeURIComponent(card)}`);
  }

  /** Times do projeto no DevOps (diálogo do épico). */
  teams(): Observable<DevOpsOption[]> {
    return this.http.get<DevOpsOption[]>(`${this.devOpsUrl}/teams`);
  }

  /** Boards de um time (diálogo do épico). */
  boards(team: string): Observable<DevOpsOption[]> {
    return this.http.get<DevOpsOption[]>(`${this.devOpsUrl}/boards`, { params: new HttpParams().set('team', team) });
  }

  /**
   * Tempo real dos épicos: entra no grupo `epics` e chama `handler` a cada `epicsUpdated` (o payload é só sinal — refaça
   * o GET) e na volta da conexão (`payload` nulo: os eventos da queda se perderam). Devolve a função que desliga.
   */
  listen(handler: (payload: EpicsUpdatedPayload | null) => void): () => void {
    let stopped = false;
    const on = (payload: EpicsUpdatedPayload) => { if (!stopped) handler(payload ?? null); };
    this.ws.startConnection();
    this.ws.on(EPICS_EVENT, on);
    this.ws.addToGroup(EPICS_GROUP);
    const resynced = this.ws._resynced.subscribe(() => { if (!stopped) handler(null); });
    return () => {
      if (stopped) return;
      stopped = true;
      this.ws.off(EPICS_EVENT, on);
      this.ws.removeFromGroup(EPICS_GROUP);
      resynced.unsubscribe();
    };
  }
}

/** Mensagem de erro da API dos épicos/DevOps (`{code, message}`, `{error}` ou texto). */
export function epicApiError(err: any, fallback: string): string {
  const body = err?.error;
  if (typeof body === 'string' && body.trim()) return body;
  return body?.message || body?.error || body?.title || fallback;
}
