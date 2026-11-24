import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { normalizeUserDetail } from './governance.logic';
import {
  EvaluateRequest, EvaluateResponse, GovPage, GovernanceCardDetail, GovernanceCardRow, GovernanceEvent, GovernanceHook,
  GovernanceOverview, GovernanceRule, GovernanceSettings, GovernanceTaskRow, GovernanceUserDetail, GovernanceUserRow,
  Standard, StandardCheckRequest, StandardCheckResponse, StandardDraft, StandardFilter, StandardImportResult, StandardModuleOption,
} from './governance.model';
import { normalizeStandard } from './standards.logic';
import { ReverseEngineeringService } from '../reverse-engineering.service';

export interface GovRange {
  from: string;
  to: string;
}

export interface GovEventFilter extends Partial<GovRange> {
  user?: string | null;
  card?: number | string | null;
  source?: string | null;
  category?: string | null;
  outcome?: string | null;
  action?: string | null;
  search?: string | null;
  page?: number;
  size?: number;
}

export interface GovCardFilter extends Partial<GovRange> {
  search?: string | null;
  user?: string | null;
  page?: number;
  size?: number;
}

/** Corpo do `rules/test`: `EvaluateRequest` + regra em rascunho (opcional). */
export type RuleTestRequest = EvaluateRequest & { rule?: GovernanceRule | null };

/**
 * O que as telas da governança usam (0098). A implementação real é HTTP; a de demonstração (`?exemplo=1`) fica em
 * `governance.demo.ts` e responde igual, sem backend.
 */
export interface GovernanceApi {
  overview(r: GovRange): Observable<GovernanceOverview>;
  users(r: GovRange): Observable<GovernanceUserRow[]>;
  user(userId: string, r: GovRange): Observable<GovernanceUserDetail>;
  cards(f: GovCardFilter): Observable<GovPage<GovernanceCardRow>>;
  card(card: number): Observable<GovernanceCardDetail>;
  tasks(r: GovRange): Observable<GovernanceTaskRow[]>;
  events(f: GovEventFilter): Observable<GovPage<GovernanceEvent>>;
  rules(): Observable<GovernanceRule[]>;
  createRule(rule: GovernanceRule): Observable<GovernanceRule>;
  updateRule(rule: GovernanceRule): Observable<GovernanceRule>;
  deleteRule(id: string): Observable<unknown>;
  testRule(req: RuleTestRequest): Observable<EvaluateResponse>;
  hooks(): Observable<GovernanceHook[]>;
  createHook(hook: GovernanceHook): Observable<GovernanceHook>;
  updateHook(hook: GovernanceHook): Observable<GovernanceHook>;
  deleteHook(id: string): Observable<unknown>;
  settings(): Observable<GovernanceSettings>;
  saveSettings(s: GovernanceSettings): Observable<GovernanceSettings>;
  changes(take?: number): Observable<GovernanceEvent[]>;
  // 0101: padrões de banco e de aplicação
  standards(f?: StandardFilter): Observable<Standard[]>;
  createStandard(s: Standard): Observable<Standard>;
  updateStandard(s: Standard): Observable<Standard>;
  deleteStandard(id: string): Observable<unknown>;
  checkStandards(req: StandardCheckRequest): Observable<StandardCheckResponse>;
  importStandardsWiki(url: string): Observable<StandardDraft>;
  importStandardsReverse(modules: string[] | null): Observable<StandardDraft>;
  applyStandardsImport(draftId: string, accept: string[]): Observable<StandardImportResult | null>;
  /** Módulos da engenharia reversa (para importar a estrutura de aplicação). */
  standardModules(): Observable<StandardModuleOption[]>;
}

/** Governança do PRMake (0098, admin): leituras sob demanda e CRUD de regras, hooks e configurações. */
@Injectable({ providedIn: 'root' })
export class GovernanceApiService implements GovernanceApi {
  private readonly http = inject(HttpClient);
  private readonly reverse = inject(ReverseEngineeringService);
  private readonly base = `${environment.apiUrl}Governance`;

  overview(r: GovRange): Observable<GovernanceOverview> {
    return this.http.get<GovernanceOverview>(`${this.base}/overview`, { params: params({ ...r, tzOffsetMinutes: -new Date().getTimezoneOffset() }) });
  }

  users(r: GovRange): Observable<GovernanceUserRow[]> {
    return this.http.get<GovernanceUserRow[]>(`${this.base}/users`, { params: params(r) });
  }

  user(userId: string, r: GovRange): Observable<GovernanceUserDetail> {
    return this.http.get<unknown>(`${this.base}/users/${encodeURIComponent(userId)}`, { params: params(r) })
      .pipe(map((raw) => normalizeUserDetail(raw, userId)));
  }

  cards(f: GovCardFilter): Observable<GovPage<GovernanceCardRow>> {
    return this.http.get<GovPage<GovernanceCardRow>>(`${this.base}/cards`, { params: params(f) });
  }

  card(card: number): Observable<GovernanceCardDetail> {
    return this.http.get<GovernanceCardDetail>(`${this.base}/cards/${card}`);
  }

  tasks(r: GovRange): Observable<GovernanceTaskRow[]> {
    return this.http.get<GovernanceTaskRow[]>(`${this.base}/tasks`, { params: params(r) });
  }

  events(f: GovEventFilter): Observable<GovPage<GovernanceEvent>> {
    return this.http.get<GovPage<GovernanceEvent>>(`${this.base}/events`, { params: params(f) });
  }

  rules(): Observable<GovernanceRule[]> {
    return this.http.get<GovernanceRule[]>(`${this.base}/rules`);
  }

  createRule(rule: GovernanceRule): Observable<GovernanceRule> {
    return this.http.post<GovernanceRule>(`${this.base}/rules`, rule);
  }

  updateRule(rule: GovernanceRule): Observable<GovernanceRule> {
    return this.http.put<GovernanceRule>(`${this.base}/rules/${encodeURIComponent(rule.id)}`, rule);
  }

  deleteRule(id: string): Observable<unknown> {
    return this.http.delete(`${this.base}/rules/${encodeURIComponent(id)}`);
  }

  testRule(req: RuleTestRequest): Observable<EvaluateResponse> {
    return this.http.post<EvaluateResponse>(`${this.base}/rules/test`, req);
  }

  hooks(): Observable<GovernanceHook[]> {
    return this.http.get<GovernanceHook[]>(`${this.base}/hooks`);
  }

  createHook(hook: GovernanceHook): Observable<GovernanceHook> {
    return this.http.post<GovernanceHook>(`${this.base}/hooks`, hook);
  }

  updateHook(hook: GovernanceHook): Observable<GovernanceHook> {
    return this.http.put<GovernanceHook>(`${this.base}/hooks/${encodeURIComponent(hook.id)}`, hook);
  }

  deleteHook(id: string): Observable<unknown> {
    return this.http.delete(`${this.base}/hooks/${encodeURIComponent(id)}`);
  }

  settings(): Observable<GovernanceSettings> {
    return this.http.get<GovernanceSettings>(`${this.base}/settings`);
  }

  saveSettings(s: GovernanceSettings): Observable<GovernanceSettings> {
    return this.http.put<GovernanceSettings>(`${this.base}/settings`, s);
  }

  changes(take = 100): Observable<GovernanceEvent[]> {
    return this.http.get<GovernanceEvent[]>(`${this.base}/changes`, { params: params({ take }) });
  }

  // ---- 0101: padrões ----

  standards(f: StandardFilter = {}): Observable<Standard[]> {
    return this.http.get<Standard[]>(`${this.base}/standards`, { params: params(f) }).pipe(map((l) => (l ?? []).map(normalizeStandard)));
  }

  createStandard(s: Standard): Observable<Standard> {
    return this.http.post<Standard>(`${this.base}/standards`, s).pipe(map(normalizeStandard));
  }

  updateStandard(s: Standard): Observable<Standard> {
    return this.http.put<Standard>(`${this.base}/standards/${encodeURIComponent(s.id)}`, s).pipe(map(normalizeStandard));
  }

  deleteStandard(id: string): Observable<unknown> {
    return this.http.delete(`${this.base}/standards/${encodeURIComponent(id)}`);
  }

  checkStandards(req: StandardCheckRequest): Observable<StandardCheckResponse> {
    return this.http.post<StandardCheckResponse>(`${this.base}/standards/check`, req);
  }

  importStandardsWiki(url: string): Observable<StandardDraft> {
    return this.http.post<StandardDraft>(`${this.base}/standards/import/wiki`, { url });
  }

  importStandardsReverse(modules: string[] | null): Observable<StandardDraft> {
    return this.http.post<StandardDraft>(`${this.base}/standards/import/reverse-engineering`, modules?.length ? { modules } : {});
  }

  applyStandardsImport(draftId: string, accept: string[]): Observable<StandardImportResult | null> {
    return this.http.post<StandardImportResult | null>(`${this.base}/standards/import/${encodeURIComponent(draftId)}/apply`, { accept });
  }

  standardModules(): Observable<StandardModuleOption[]> {
    return this.reverse.modules().pipe(map((list) => (list ?? []).map((m) => ({
      key: m.key, name: m.displayName || m.name || m.key, published: (m.publishedRequired ?? 0) > 0 || !!m.complete,
    }))));
  }
}

function params(f: object): HttpParams {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(f)) {
    if (v !== null && v !== undefined && `${v}` !== '') p = p.set(k, `${v}`);
  }
  return p;
}
