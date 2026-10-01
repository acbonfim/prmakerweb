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

/** Interdependência de um projeto (0034): evento SNS, fila SQS, tabela de outro módulo, HTTP, pacote, serviço externo. */
export interface ArchitectureRelation {
  target: string;
  kind: string;
  detail?: string | null;
  evidence?: string | null;
}

export interface ArchitectureIncomingRelation {
  source: string;
  kind: string;
  detail?: string | null;
  evidence?: string | null;
}

export interface ArchitectureGraphNode { key: string; name: string; kind: string; mapped: boolean; }
export interface ArchitectureGraphEdge { source: string; target: string; kind: string; count: number; details: string[]; }
export interface ArchitectureGraph { nodes: ArchitectureGraphNode[]; edges: ArchitectureGraphEdge[]; }

/** Tipos de relação: rótulo, ícone e cor (a mesma no mapa e nos painéis). */
export const RELATION_KINDS: { kind: string; label: string; icon: string; color: string }[] = [
  { kind: 'event', label: 'Evento (SNS → fila)', icon: 'bolt', color: '#f0883e' },
  { kind: 'queue', label: 'Fila (SQS)', icon: 'move_to_inbox', color: '#58a6ff' },
  { kind: 'database', label: 'Banco compartilhado', icon: 'storage', color: '#a371f7' },
  { kind: 'http', label: 'HTTP', icon: 'http', color: '#3fb950' },
  { kind: 'external', label: 'Serviço externo', icon: 'public', color: '#d29922' },
  { kind: 'package', label: 'Pacote', icon: 'inventory_2', color: '#8b949e' },
  { kind: 'frontend', label: 'Front-end', icon: 'web', color: '#39c5cf' },
  { kind: 'other', label: 'Outro', icon: 'more_horiz', color: '#6e7681' },
];

export function relationKind(kind: string) {
  return RELATION_KINDS.find(k => k.kind === kind) ?? RELATION_KINDS[RELATION_KINDS.length - 1];
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
  relations?: ArchitectureRelation[];
  usedBy?: ArchitectureIncomingRelation[];
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

/** Trecho que casou com a busca no conteúdo (0037): seção de projeto ou artigo do KC. */
export interface ArchitectureSearchHit {
  type: 'section' | 'article' | string;
  projectKey?: string | null;
  projectName?: string | null;
  sectionKey?: string | null;
  sectionTitle?: string | null;
  articleNumber?: number | null;
  title: string;
  heading?: string | null;
  snippet: string;
  score: number;
  matched: string[];
  reason?: string | null;
}

/** "Pergunte à Base Solvace" (0037). */
export interface ArchitectureAskResponse {
  question: string;
  answer?: string | null;
  results: ArchitectureSearchHit[];
  terms: string[];
  aiUsed: boolean;
  aiUnavailableReason?: string | null;
  provider?: string | null;
  model?: string | null;
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

  /** Mapa do ecossistema (0034): nós = projetos + serviços externos; arestas agrupadas por origem/destino/tipo. */
  graph(): Observable<ArchitectureGraph> {
    return this.http.get<ArchitectureGraph>(`${this.api}/graph`);
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

  /** Busca no conteúdo das seções e artigos (0037). */
  search(q: string, limit = 12): Observable<ArchitectureSearchHit[]> {
    return this.http.get<ArchitectureSearchHit[]>(`${this.api}/search`, { params: new HttpParams().set('q', q).set('limit', limit) });
  }

  /** Pergunta à base com IA: entende o contexto e leva aos trechos que respondem (0037). */
  ask(question: string): Observable<ArchitectureAskResponse> {
    return this.http.post<ArchitectureAskResponse>(`${this.api}/ask`, { question });
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
