import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { ArchitectureIncomingRelation, ArchitectureRelation, ArchitectureSuggestion } from './architecture.service';

/** Engenharia reversa por módulo (feature 0052): documentos com aprovação, índice por item, UI/UX e andamento ao vivo. */

export interface ReverseSource { repository: string; path?: string | null; role: string; notes?: string | null; }

export interface ReverseProgressStep {
  key: string; title: string; status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | string;
  detail?: string | null; parent?: string | null; startedAt?: string | null; finishedAt?: string | null;
}
export interface ReverseProgressLog { at: string; text: string; kind: string; }
export interface ReverseProgress { steps: ReverseProgressStep[]; activity?: string | null; activityAt?: string | null; logs: ReverseProgressLog[]; }

export interface ReverseRevisionHead {
  id: string; moduleKey: string; moduleName?: string | null; docType: string; number: number; mode: string; status: string;
  summary?: string | null; coverageRatio?: number | null; length: number; createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
  submittedAt?: string | null; reviewedBy?: string | null; publishedAt?: string | null; publishedBy?: string | null; reviewNote?: string | null;
  progress?: ReverseProgress | null; progressAt?: string | null;
}

export interface ReverseLint {
  errors: string[]; warnings: string[]; items: number; byKind: Record<string, number>; missingHeadings: string[];
  withoutEvidence: string[]; removedIds: string[]; unknownRefs: string[]; coverage?: number | null; ok: boolean;
}

export interface ReverseCoverage {
  total?: number; covered?: number; ratio?: number | null; missingCount?: number;
  byCategory?: Record<string, { total: number; covered: number }>;
  missing?: { cat: string; name: string; file: string; line: number; detail?: string }[];
  /** 0056: termos que contam como cobertos por estarem numa lacuna "fora do glossário" (GAP-…). */
  outsideGlossary?: { name: string; gap: string }[];
}

export interface ReverseItemDiff { id: string; title: string; change: 'added' | 'removed' | 'changed' | string; before?: string | null; after?: string | null; }
export interface ReverseRevisionDiff { added: number; removed: number; changed: number; unchanged: number; otherTextChanged: boolean; items: ReverseItemDiff[]; }

/** 0053: o que a sessão fez com cada sugestão do pacote (resolvidas ao publicar). */
export interface ReverseSuggestionDecision {
  suggestionId: string; decision: 'applied' | 'dismissed' | string; items: string[]; note?: string | null;
  kind?: string | null; sectionKey?: string | null; content?: string | null; cardNumber?: string | null; status?: string | null;
}

export interface ReverseRevision extends ReverseRevisionHead {
  content: string; lint?: ReverseLint | null; coverage?: ReverseCoverage | null; session?: any; baseVersion?: number | null;
  publishedVersion?: number | null; submittedBy?: string | null; reviewedAt?: string | null; publishedChangedSinceBase: boolean;
  currentPublishedVersion?: number | null; diff?: ReverseRevisionDiff | null; canApprove: boolean;
  suggestionDecisions?: ReverseSuggestionDecision[];
}

export interface ReversePublishedInfo { version: number; updatedAt: string; updatedBy: string; length: number; items: number; }

export interface ReverseDocStatus {
  type: string; title: string; required: boolean; state: string; published?: ReversePublishedInfo | null; open?: ReverseRevisionHead | null;
  pendingSuggestions: number;
  /** 0054 (visão prática): documentos técnicos republicados depois dela. */
  staleBecause?: string[];
  /** 0054: exigidos que faltam publicar antes de começar. */
  blockedBy?: string[];
}

export interface ReverseModuleSummary {
  key: string; name: string; displayName?: string | null; businessArea?: string | null; projectKind: string; world: string;
  docs: ReverseDocStatus[]; publishedRequired: number; requiredCount: number; complete: boolean; inReview: number; items: number; aliases: string[];
}

export interface ReverseAsset {
  id: string; moduleKey: string; kind: string; title: string; url?: string | null; fileName?: string | null; contentType?: string | null;
  size: number; notes?: string | null; screens: string[]; createdAt: string; createdBy: string; download?: string | null;
}

export interface ReverseModule extends ReverseModuleSummary {
  repository?: string | null; summary?: string | null; sources: ReverseSource[]; notes?: string | null; configured: boolean; assets: ReverseAsset[];
  itemsByKind: Record<string, number>; relations: ArchitectureRelation[]; usedBy: ArchitectureIncomingRelation[]; siblings: string[]; canApprove: boolean;
  /** 0053: termos do glossário que ainda não são apelido nem palavra-chave. */
  suggestedTerms?: string[];
  /** 0054 */
  traps?: number; trapsToReview?: number; trapsMigratedAt?: string | null; supersededSections?: Record<string, string>;
}

/** 0054: armadilha — o que já deu errado, ligada aos itens. */
/** 0056: documento da engenharia reversa onde fica um item, pelo prefixo do ID (links de fora da tela: ?m=&d=&i=). */
export function reverseDocOfItem(id: string): string {
  const kind = (/^([A-Z]{2,4})-\d+/.exec((id || '').toUpperCase().split('#').pop() ?? '') ?? [])[1] ?? '';
  if (['INT', 'API', 'DB', 'TEC', 'CMP', 'EVT', 'JOB', 'SQL', 'TRG'].includes(kind)) return 'arquitetura';
  if (['TELA', 'FLX'].includes(kind)) return 'uiux';
  if (kind === 'UI') return 'design';
  if (['TUT', 'FAQ'].includes(kind)) return 'pratica';
  if (['OBJ', 'PER'].includes(kind)) return 'visao';
  if (['ADR', 'NFR', 'SEQ'].includes(kind)) return 'spec-arquitetura';
  return 'funcional';
}

/** 0059: mapa de infra (AWS) do módulo lido pela skill (re.sh infra) — só o ligado ao módulo + resumo da conta. */
export interface ReverseInfraResource {
  service: string; label: string; name: string; arn: string; region: string; why: string; details: Record<string, any>;
  stages?: { name: string; actions: { name: string; provider: string; config: Record<string, string> }[] }[]; buildspec?: string;
}
export interface ReverseInfraAccount {
  account: string; profile: string; regions: string[]; module: string; terms: string[];
  summary: { total: number; byService: { service: string; label: string; count: number }[] };
  resources: ReverseInfraResource[];
  logs: { resource: string; group: string; exists: boolean; retention: any; command: string }[];
  denied: { call: string; message: string }[]; failed: { call: string; message: string }[];
}
export interface ReverseInfra {
  moduleKey: string; account: string; collectedAt: string; collectedBy: string;
  data?: { collectedAt?: string; accounts: ReverseInfraAccount[]; repoPipelines: { repo: string; file: string; detail: string; facts: string[] }[] } | null;
}

export interface ReverseTrap {
  id: string; moduleKey: string; title: string; text: string; items: string[]; cards: string[]; origin: string; needsReview: boolean;
  reviewedBy?: string | null; createdAt: string; createdBy: string;
}

export interface ReverseDocType {
  key: string; title: string; sectionKey: string; order: number; required: boolean; kinds: string[]; headings: string[]; purpose: string; template: string;
}

export interface ReverseItemHead { id: string; kind: string; title: string; level: number; removed: boolean; }

export interface ReverseDoc {
  moduleKey: string; type: ReverseDocType; content?: string | null; published?: ReversePublishedInfo | null; items: ReverseItemHead[];
  revisions: ReverseRevisionHead[]; suggestions: ArchitectureSuggestion[];
}

export interface ReverseIndexHit {
  ref: string; moduleKey: string; moduleName?: string | null; docType: string; itemId: string; kind: string; kindLabel: string; title: string;
  snippet: string; tags: string[]; tables: string[]; modules: string[]; synonyms?: string[]; removed: boolean; score: number;
}
export interface ReverseItem extends ReverseIndexHit { body: string; refs: string[]; evidence: string[]; referencedBy: string[]; sectionVersion: number; }

export interface ReverseKind { prefix: string; label: string; plural: string; }
export interface ReverseReferenceDatabase { environment: string; host: string; global: string; locals: string[]; }
export interface ReverseSettings {
  approverRoles: string[]; requiredDocs: string[]; gateStep?: string | null; minCoverage: number; canApprove: boolean; kinds: ReverseKind[];
  /** 0053: banco de referência (DEMO) e palavras genéricas fora do glossário. */
  referenceDatabase?: ReverseReferenceDatabase | null; glossaryExclusions?: string[];
}

/** Ordem e rótulos curtos dos documentos (a tela usa sem esperar a API). */
export const REVERSE_DOCS: { key: string; short: string; icon: string; human?: boolean }[] = [
  { key: 'funcional', short: 'Funcional', icon: 'rule' },
  { key: 'arquitetura', short: 'Arquitetura', icon: 'lan' },
  { key: 'uiux', short: 'UI/UX', icon: 'design_services' },
  { key: 'visao', short: 'Visão', icon: 'visibility' },
  { key: 'spec-arquitetura', short: 'Spec. arquitetura', icon: 'architecture' },
  { key: 'design', short: 'Spec. design', icon: 'palette' },
  { key: 'pratica', short: 'Visão prática', icon: 'support_agent', human: true },
];

export const REVERSE_STATE: Record<string, { label: string; color: string; icon: string }> = {
  none: { label: 'Não gerado', color: '#6e7681', icon: 'radio_button_unchecked' },
  draft: { label: 'Gerando / rascunho', color: '#58a6ff', icon: 'pending' },
  changes: { label: 'Ajustes pedidos', color: '#d29922', icon: 'edit_note' },
  review: { label: 'Em revisão', color: '#a371f7', icon: 'rate_review' },
  approved: { label: 'Aprovado (publicar)', color: '#39c5cf', icon: 'task_alt' },
  published: { label: 'Publicado', color: '#3fb950', icon: 'check_circle' },
};

export function reverseState(state: string | null | undefined) {
  return REVERSE_STATE[state ?? 'none'] ?? REVERSE_STATE['none'];
}

/** Grupo do tempo real (o back publica "reverseRevision" para "reverse:<módulo>" e "reverse"). */
export const REVERSE_EVENT = 'reverseRevision';
export const reverseGroup = (moduleKey?: string | null) => moduleKey ? `reverse:${moduleKey}` : 'reverse';

@Injectable({ providedIn: 'root' })
export class ReverseEngineeringService {
  private http = inject(HttpClient);
  private api = `${environment.apiUrl}ReverseEngineering`;

  settings(): Observable<ReverseSettings> { return this.http.get<ReverseSettings>(`${this.api}/settings`); }
  docTypes(): Observable<ReverseDocType[]> { return this.http.get<ReverseDocType[]>(`${this.api}/doc-types`); }
  modules(): Observable<ReverseModuleSummary[]> { return this.http.get<ReverseModuleSummary[]>(`${this.api}/modules`); }
  module(key: string): Observable<ReverseModule> { return this.http.get<ReverseModule>(`${this.api}/modules/${encodeURIComponent(key)}`); }
  saveModule(key: string, body: { sources?: ReverseSource[]; aliases?: string[]; notes?: string | null }): Observable<ReverseModule> {
    return this.http.put<ReverseModule>(`${this.api}/modules/${encodeURIComponent(key)}`, body);
  }
  /** 0053: termo sugerido pelo glossário → apelido (alias), palavra-chave (keyword) ou dispensado (dismiss). */
  resolveTerm(key: string, term: string, action: 'alias' | 'keyword' | 'dismiss'): Observable<ReverseModule> {
    return this.http.post<ReverseModule>(`${this.api}/modules/${encodeURIComponent(key)}/terms`, { term, action });
  }
  /** 0054: armadilhas, sugestão → armadilha, divergências com o KC. */
  infra(module: string): Observable<ReverseInfra | null> { return this.http.get<ReverseInfra | null>(`${this.api}/modules/${encodeURIComponent(module)}/infra`); }
  traps(module: string): Observable<ReverseTrap[]> { return this.http.get<ReverseTrap[]>(`${this.api}/traps`, { params: new HttpParams().set('module', module) }); }
  updateTrap(id: string, body: { title?: string; text?: string; items?: string[]; confirm?: boolean }): Observable<ReverseTrap> {
    return this.http.put<ReverseTrap>(`${this.api}/traps/${id}`, body);
  }
  deleteTrap(id: string): Observable<void> { return this.http.delete<void>(`${this.api}/traps/${id}`); }
  suggestionToTrap(id: string, title?: string): Observable<ReverseTrap> { return this.http.post<ReverseTrap>(`${this.api}/suggestions/${id}/to-trap`, { title: title ?? '' , text: '' }); }
  kcDivergences(): Observable<ArchitectureSuggestion[]> { return this.http.get<ArchitectureSuggestion[]>(`${this.api}/kc-divergences`); }
  doc(key: string, doc: string): Observable<ReverseDoc> {
    return this.http.get<ReverseDoc>(`${this.api}/modules/${encodeURIComponent(key)}/docs/${encodeURIComponent(doc)}`);
  }
  revisions(filter: { module?: string; doc?: string; status?: string }): Observable<ReverseRevisionHead[]> {
    let params = new HttpParams();
    Object.entries(filter).forEach(([k, v]) => { if (v) params = params.set(k, v); });
    return this.http.get<ReverseRevisionHead[]>(`${this.api}/revisions`, { params });
  }
  /** Sem o texto do documento (vem vazio): a tela busca em revisionContent só ao abrir ou editar. */
  revision(id: string): Observable<ReverseRevision> { return this.http.get<ReverseRevision>(`${this.api}/revisions/${id}`, { params: { content: 'false' } }); }
  revisionContent(id: string): Observable<string> { return this.http.get(`${this.api}/revisions/${id}/content`, { responseType: 'text' }); }
  saveRevision(id: string, body: { content?: string; summary?: string }): Observable<ReverseRevision> {
    return this.http.put<ReverseRevision>(`${this.api}/revisions/${id}`, body);
  }
  review(id: string, action: 'approve' | 'changes' | 'discard', note?: string | null): Observable<ReverseRevision> {
    return this.http.post<ReverseRevision>(`${this.api}/revisions/${id}/review`, { action, note });
  }
  publish(id: string, approve: boolean): Observable<ReverseRevision> {
    return this.http.post<ReverseRevision>(`${this.api}/revisions/${id}/publish`, { approve });
  }
  addLink(key: string, body: { title: string; url: string; kind?: string; notes?: string; screens?: string[] }): Observable<ReverseAsset> {
    return this.http.post<ReverseAsset>(`${this.api}/modules/${encodeURIComponent(key)}/assets/link`, body);
  }
  addFile(key: string, file: File, title: string, notes?: string, screens?: string): Observable<ReverseAsset> {
    const form = new FormData();
    form.append('file', file);
    form.append('title', title || file.name);
    if (notes) form.append('notes', notes);
    if (screens) form.append('screens', screens);
    return this.http.post<ReverseAsset>(`${this.api}/modules/${encodeURIComponent(key)}/assets/file`, form);
  }
  assetFile(id: string): Observable<Blob> { return this.http.get(`${this.api}/assets/${id}/file`, { responseType: 'blob' }); }
  deleteAsset(id: string): Observable<void> { return this.http.delete<void>(`${this.api}/assets/${id}`); }
  search(q: string, filter: { module?: string; kind?: string; doc?: string; limit?: number }): Observable<ReverseIndexHit[]> {
    let params = new HttpParams().set('q', q ?? '').set('limit', String(filter.limit ?? 40));
    if (filter.module) params = params.set('module', filter.module);
    if (filter.kind) params = params.set('kind', filter.kind);
    if (filter.doc) params = params.set('doc', filter.doc);
    return this.http.get<ReverseIndexHit[]>(`${this.api}/index/search`, { params });
  }
  items(refs: string[]): Observable<ReverseItem[]> {
    return this.http.get<ReverseItem[]>(`${this.api}/items`, { params: new HttpParams().set('refs', refs.join(',')) });
  }
  impact(term: string): Observable<ReverseIndexHit[]> {
    return this.http.get<ReverseIndexHit[]>(`${this.api}/impact`, { params: new HttpParams().set('term', term).set('limit', '300') });
  }
}
