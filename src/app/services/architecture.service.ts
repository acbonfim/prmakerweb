import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/** Base Solvace (feature 0033): engenharia reversa + regras de negócio do Knowledge Center. */
export interface ArchitectureSectionSummary {
  id: string;
  key: string;
  title: string;
  order: number;
  version: number;
  source: 'skill' | 'admin' | 'ai' | string;
  length: number;
  updatedAt: string;
  updatedBy: string;
}

export interface ArchitectureSection extends ArchitectureSectionSummary {
  content: string;
}

export interface ArchitectureProject {
  id: string;
  key: string;
  name: string;
  kind: string;
  repository?: string | null;
  summary?: string | null;
  keywords: string[];
  sourceCommit?: string | null;
  sourceBranch?: string | null;
  sourceMappedAt?: string | null;
  order: number;
  updatedAt: string;
  updatedBy: string;
  sections: ArchitectureSectionSummary[];
}

export interface KnowledgeArticle {
  articleNumber: number;
  reference: string;
  environment: string;
  title: string;
  category?: string | null;
  subcategory?: string | null;
  tags: string[];
  content: string;
  sourceUpdatedAt?: string | null;
  syncedAt: string;
}

export interface KnowledgeState {
  activeEnvironment: string;
  environment: string;
  watermark?: string | null;
  lastSyncAt?: string | null;
  lastFullSyncAt?: string | null;
  lastSyncBy?: string | null;
  articleCount: number;
  filterChanged: boolean;
}

export interface ArchitectureSectionVersion {
  version: number;
  title: string;
  source: string;
  note?: string | null;
  createdBy: string;
  createdAt: string;
  content?: string | null;
}

export interface ArchitectureSuggestion {
  id: string;
  projectKey: string;
  sectionKey?: string | null;
  kind: 'learning' | 'divergence' | 'other' | string;
  content: string;
  cardNumber?: string | null;
  status: 'pending' | 'applied' | 'dismissed' | string;
  createdBy: string;
  createdAt: string;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  resolutionNote?: string | null;
}

export interface ChatMessage { role: 'user' | 'assistant'; content: string; }
export interface ChatReply { reply: string; suggestion?: string | null; provider?: string | null; model?: string | null; tokensUsed?: number | null; }
export interface ChatStatus { available: boolean; provider?: string | null; reason?: string | null; }

/** Seções padrão da engenharia reversa (mesmas do template da skill base-solvace). */
export const SECTION_TEMPLATE: { key: string; title: string; order: number }[] = [
  { key: 'visao-geral', title: 'Visão geral', order: 10 },
  { key: 'modulos', title: 'Módulos e fluxos', order: 20 },
  { key: 'dados', title: 'Dados', order: 30 },
  { key: 'integracoes', title: 'Integrações', order: 40 },
  { key: 'infra', title: 'Infra e AWS', order: 50 },
  { key: 'autenticacao', title: 'Login e permissões', order: 60 },
  { key: 'jobs', title: 'Jobs e rotinas', order: 70 },
  { key: 'regras-de-negocio', title: 'Regras de negócio', order: 80 },
  { key: 'armadilhas', title: 'Armadilhas e bugs conhecidos', order: 90 },
];

/** Rótulos e ordem dos tipos de projeto (iguais ao índice do backend). */
export const ARCHITECTURE_KINDS: { kind: string; label: string; icon: string }[] = [
  { kind: 'ecosystem', label: 'Ecossistema', icon: 'hub' },
  { kind: 'legacy', label: 'Legado (edv-solvace)', icon: 'account_tree' },
  { kind: 'frontend', label: 'Front-end', icon: 'web' },
  { kind: 'integration', label: 'Integrações', icon: 'swap_horiz' },
  { kind: 'revamp', label: 'Revamp (módulos)', icon: 'view_module' },
  { kind: 'infra', label: 'Infraestrutura / AWS', icon: 'cloud' },
  { kind: 'auth', label: 'Login e autenticação', icon: 'lock' },
  { kind: 'third-party', label: 'Serviços de terceiros', icon: 'extension' },
  { kind: 'business-rules', label: 'Regras de negócio', icon: 'gavel' },
  { kind: 'other', label: 'Outros', icon: 'folder' },
];

@Injectable({ providedIn: 'root' })
export class ArchitectureService {
  private http = inject(HttpClient);
  private api = `${environment.apiUrl}Architecture`;
  private kc = `${environment.apiUrl}Knowledge`;

  projects(): Observable<ArchitectureProject[]> {
    return this.http.get<ArchitectureProject[]>(`${this.api}/projects`);
  }

  section(projectKey: string, sectionKey: string): Observable<ArchitectureSection> {
    return this.http.get<ArchitectureSection>(`${this.api}/projects/${encodeURIComponent(projectKey)}/sections/${encodeURIComponent(sectionKey)}`);
  }

  versions(projectKey: string, sectionKey: string): Observable<ArchitectureSectionVersion[]> {
    return this.http.get<ArchitectureSectionVersion[]>(`${this.api}/projects/${encodeURIComponent(projectKey)}/sections/${encodeURIComponent(sectionKey)}/versions`);
  }

  version(projectKey: string, sectionKey: string, version: number): Observable<ArchitectureSectionVersion> {
    return this.http.get<ArchitectureSectionVersion>(`${this.api}/projects/${encodeURIComponent(projectKey)}/sections/${encodeURIComponent(sectionKey)}/versions/${version}`);
  }

  // ── Admin (0033 F2) ──
  upsertProject(key: string, body: { name: string; kind: string; repository?: string | null; summary?: string | null; keywords?: string[]; order?: number | null }): Observable<ArchitectureProject> {
    return this.http.put<ArchitectureProject>(`${this.api}/projects/${encodeURIComponent(key)}`, body);
  }

  writeSection(projectKey: string, sectionKey: string, body: { title?: string | null; content: string; order?: number | null; source: 'admin' | 'ai'; note?: string | null }): Observable<ArchitectureSection> {
    return this.http.put<ArchitectureSection>(`${this.api}/projects/${encodeURIComponent(projectKey)}/sections/${encodeURIComponent(sectionKey)}`, body);
  }

  chatStatus(): Observable<ChatStatus> {
    return this.http.get<ChatStatus>(`${this.api}/chat/status`);
  }

  chat(projectKey: string, sectionKey: string, messages: ChatMessage[]): Observable<ChatReply> {
    return this.http.post<ChatReply>(`${this.api}/projects/${encodeURIComponent(projectKey)}/sections/${encodeURIComponent(sectionKey)}/chat`, { messages });
  }

  suggestions(status: 'pending' | 'all' = 'pending'): Observable<ArchitectureSuggestion[]> {
    return this.http.get<ArchitectureSuggestion[]>(`${this.api}/suggestions`, { params: new HttpParams().set('status', status) });
  }

  resolveSuggestion(id: string, status: 'applied' | 'dismissed', note?: string | null): Observable<ArchitectureSuggestion> {
    return this.http.post<ArchitectureSuggestion>(`${this.api}/suggestions/${id}/resolve`, { status, note: note || null });
  }

  knowledgeState(): Observable<KnowledgeState> {
    return this.http.get<KnowledgeState>(`${this.kc}/state`);
  }

  articles(term?: string, limit = 50): Observable<KnowledgeArticle[]> {
    let params = new HttpParams().set('limit', limit);
    if (term?.trim()) params = params.set('q', term.trim());
    return this.http.get<KnowledgeArticle[]>(`${this.kc}/articles`, { params });
  }

  article(number: number): Observable<KnowledgeArticle> {
    return this.http.get<KnowledgeArticle>(`${this.kc}/articles/${number}`);
  }
}
