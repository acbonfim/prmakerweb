import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  PromotionBatch, PromotionCreateItem, PromotionParse, PromotionPreview, PromotionPreviewRequest, PromotionPreviewTarget, PromotionTargetDto
} from '../pages/authenticated/promotion/promotion.model';

/** Promoção de PRs em lote para release/hotfix (0074). */
@Injectable({ providedIn: 'root' })
export class PromotionService {
  private http = inject(HttpClient);
  private url = `${environment.apiUrl}Promotion`;

  preview(request: PromotionPreviewRequest): Observable<PromotionPreview> {
    return this.http.post<PromotionPreview>(`${this.url}/preview`, request);
  }

  /** Resolve destinos digitados numa linha (nome real no remoto, PR já aberto) sem refazer a prévia. */
  resolve(request: {
    version: string; card: string; repository: string; sourceBranch?: string | null; sourceBase?: string | null; targets: PromotionTargetDto[];
  }): Observable<PromotionPreviewTarget[]> {
    return this.http.post<PromotionPreviewTarget[]>(`${this.url}/resolve`, request);
  }

  create(version: string, kind: string | null, items: PromotionCreateItem[]): Observable<PromotionBatch> {
    return this.http.post<PromotionBatch>(this.url, { version, kind, items });
  }

  /** Interpreta a mensagem do Release Manager (gasta a chave de IA do usuário). Não dispara nada. */
  parse(text: string): Observable<PromotionParse> {
    return this.http.post<PromotionParse>(`${this.url}/parse`, { text });
  }

  mine(take = 20): Observable<PromotionBatch[]> {
    return this.http.get<PromotionBatch[]>(`${this.url}?take=${take}`);
  }

  get(id: string): Observable<PromotionBatch> {
    return this.http.get<PromotionBatch>(`${this.url}/${id}`);
  }

  retry(id: string, itemIds?: string[]): Observable<PromotionBatch> {
    return this.http.post<PromotionBatch>(`${this.url}/${id}/retry`, { itemIds: itemIds ?? null });
  }

  cancel(id: string): Observable<PromotionBatch> {
    return this.http.post<PromotionBatch>(`${this.url}/${id}/cancel`, {});
  }
}
