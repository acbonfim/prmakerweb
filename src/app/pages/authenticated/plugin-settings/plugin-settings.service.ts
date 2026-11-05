import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, throwError } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  SettingChange, SettingHistoryEntry, SettingsConflictResponse, SettingsErrorResponse, SettingsPatchResponse,
  SettingsResponse, SettingsSaveResult,
} from './plugin-settings.model';

/** Configurações por seção (0086): catálogo resolvido, gravação por chave (com `expected`) e histórico. */
@Injectable({ providedIn: 'root' })
export class PluginSettingsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}PluginConfiguration/settings`;

  getSettings(): Observable<SettingsResponse> {
    return this.http.get<SettingsResponse>(this.baseUrl);
  }

  /** Grava só as chaves enviadas. 409 (alguém salvou antes) e 400 (valor inválido) viram resultado, não erro. */
  patch(changes: SettingChange[]): Observable<SettingsSaveResult> {
    return this.http.patch<SettingsPatchResponse>(this.baseUrl, { changes }).pipe(
      map(response => ({ kind: 'ok' as const, response })),
      catchError((e: HttpErrorResponse) => {
        if (e.status === 409 && Array.isArray((e.error as SettingsConflictResponse)?.conflicts)) {
          return of({ kind: 'conflict' as const, conflicts: (e.error as SettingsConflictResponse).conflicts });
        }
        if (e.status === 400 && Array.isArray((e.error as SettingsErrorResponse)?.errors)) {
          return of({ kind: 'invalid' as const, errors: (e.error as SettingsErrorResponse).errors });
        }
        return throwError(() => e);
      }),
    );
  }

  history(pluginId: number, key: string, take = 50): Observable<SettingHistoryEntry[]> {
    const params = { pluginId: String(pluginId), key, take: String(take) };
    return this.http.get<SettingHistoryEntry[]>(`${this.baseUrl}/history`, { params });
  }
}
