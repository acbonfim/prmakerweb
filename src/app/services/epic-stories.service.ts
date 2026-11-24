import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { ConvertEpicStoryRequest, EpicStory, SaveEpicStoryRequest } from '../components/epics/epic-stories.logic';
import { EpicsService, EpicsUpdatedPayload } from './epics.service';

export type { ConvertEpicStoryRequest, EpicStory, EpicStoryStatus, EpicStoryType, SaveEpicStoryRequest } from '../components/epics/epic-stories.logic';

/**
 * 0099 (ajustes 2): histórias e bugs do épico escritos no PRMake (`Epics/{n}/stories`, `EpicStories/{number}`) e a
 * conversão em card do DevOps. Tempo real pelo `epicsUpdated` do épico (action `stories`).
 */
@Injectable({ providedIn: 'root' })
export class EpicStoriesService {
  private http = inject(HttpClient);
  private epics = inject(EpicsService);
  // environment.apiUrl já termina com /api/v1/
  private epicsUrl = `${environment.apiUrl}Epics`;
  private apiUrl = `${environment.apiUrl}EpicStories`;

  list(epic: number): Observable<EpicStory[]> {
    // Todas, inclusive as descartadas (a tela filtra; o padrão do servidor esconde as descartadas).
    return this.http.get<EpicStory[]>(`${this.epicsUrl}/${epic}/stories`, { params: { status: 'all' } });
  }

  create(epic: number, body: SaveEpicStoryRequest): Observable<EpicStory> {
    return this.http.post<EpicStory>(`${this.epicsUrl}/${epic}/stories`, body);
  }

  get(number: number): Observable<EpicStory> {
    return this.http.get<EpicStory>(`${this.apiUrl}/${number}`);
  }

  /** Editar (também restaura uma descartada: `status: 'draft'`). Convertida → 409 `notEditable`. */
  update(number: number, body: SaveEpicStoryRequest): Observable<EpicStory> {
    return this.http.put<EpicStory>(`${this.apiUrl}/${number}`, body);
  }

  /** Descartar (o DELETE não apaga: a história fica como `discarded`). */
  discard(number: number): Observable<unknown> {
    return this.http.delete(`${this.apiUrl}/${number}`);
  }

  /** Cria o card no DevOps (entra no épico). Já convertida → 409 `{code:"alreadyConverted", cardId}`. */
  convert(number: number, body: ConvertEpicStoryRequest = {}): Observable<EpicStory> {
    // O servidor responde `{story, card, summary}`; a tela só precisa da história (com `cardId`).
    return this.http.post<{ story: EpicStory }>(`${this.apiUrl}/${number}/convert`, body).pipe(map((r) => r.story));
  }

  /**
   * Tempo real das histórias de um épico: chama `handler` no `epicsUpdated` do épico (qualquer action — a conversão
   * também mexe nos cards) e na volta da conexão. Devolve a função que desliga.
   */
  listen(epic: number, handler: (payload: EpicsUpdatedPayload | null) => void): () => void {
    return this.epics.listen((payload) => {
      if (!payload) { handler(null); return; }
      if (payload.number === epic && (payload.action === 'stories' || payload.action === 'cards')) handler(payload);
    });
  }
}
