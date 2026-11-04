import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  UsageEventItem, UsageLastSeen, UsageLoginItem, UsagePage, UsageSessionItem, UsageSummary, UsageUserDetail,
} from './usage.model';

export interface UsageFilter {
  from?: string | null;
  to?: string | null;
  user?: string | null;
  screen?: string | null;
  kind?: string | null;
  session?: string | null;
  search?: string | null;
  success?: boolean | null;
  page?: number;
  size?: number;
}

/** Leituras de análise de uso (0079, admin) — sob demanda, só quando a tela abre. */
@Injectable({ providedIn: 'root' })
export class UsageApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}Usage`;

  summary(f: UsageFilter): Observable<UsageSummary> {
    return this.http.get<UsageSummary>(`${this.base}/summary`, { params: this.params(f, true) });
  }

  logins(f: UsageFilter): Observable<UsagePage<UsageLoginItem>> {
    return this.http.get<UsagePage<UsageLoginItem>>(`${this.base}/logins`, { params: this.params(f) });
  }

  sessions(f: UsageFilter): Observable<UsagePage<UsageSessionItem>> {
    return this.http.get<UsagePage<UsageSessionItem>>(`${this.base}/sessions`, { params: this.params(f) });
  }

  events(f: UsageFilter): Observable<UsagePage<UsageEventItem>> {
    return this.http.get<UsagePage<UsageEventItem>>(`${this.base}/events`, { params: this.params(f) });
  }

  lastSeen(): Observable<UsageLastSeen[]> {
    return this.http.get<UsageLastSeen[]>(`${this.base}/last-seen`);
  }

  user(externalId: string): Observable<UsageUserDetail> {
    return this.http.get<UsageUserDetail>(`${this.base}/users/${encodeURIComponent(externalId)}`);
  }

  private params(f: UsageFilter, withTz = false): HttpParams {
    let p = new HttpParams();
    const set = (k: string, v: unknown) => {
      if (v !== null && v !== undefined && `${v}` !== '') p = p.set(k, `${v}`);
    };
    set('from', f.from);
    set('to', f.to);
    set('user', f.user);
    set('screen', f.screen);
    set('kind', f.kind);
    set('session', f.session);
    set('search', f.search);
    set('success', f.success);
    set('page', f.page);
    set('size', f.size);
    if (withTz) set('tzOffsetMinutes', -new Date().getTimezoneOffset());
    return p;
  }
}
