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
  /** Público (0038): llm = técnica (vai para as skills) · human = Guia (linguagem simples, só na tela). */
  audience?: 'llm' | 'human' | string | null;
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
/** 0066: item INT da engenharia reversa por trás de uma ligação do mapa. */
export interface ArchitectureGraphEdgeItem { ref: string; title: string; mechanism?: string | null; contract?: string | null; toConfirm?: boolean; }
export interface ArchitectureGraphEdge {
  source: string; target: string; kind: string; count: number; details: string[];
  /** 0066: base (extrator/curadoria) · engenharia (itens INT publicados) · ambos. */
  origin?: 'base' | 'engenharia' | 'ambos';
  items?: ArchitectureGraphEdgeItem[];
}
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
  // 0066: mecanismos que a engenharia reversa descreve
  { kind: 'cache', label: 'Cache (Redis)', icon: 'memory', color: '#ff7b72' },
  { kind: 'storage', label: 'Arquivo / S3', icon: 'folder_zip', color: '#e3b341' },
  { kind: 'job', label: 'Job / agendamento', icon: 'schedule', color: '#d2a8ff' },
  { kind: 'trigger', label: 'Trigger do banco', icon: 'bolt', color: '#db61a2' },
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
  /** Dados amigáveis (0038 — fora do export/hash): nome para leigos, uma frase e a área de negócio. */
  displayName?: string | null;
  tagline?: string | null;
  businessArea?: string | null;
  order: number;
  updatedAt: string;
  updatedBy: string;
  sections: ArchitectureSectionSummary[];
  relations?: ArchitectureRelation[];
  usedBy?: ArchitectureIncomingRelation[];
  /** 0054: seções antigas substituídas pela engenharia reversa (chave → por quais documentos) — histórico. */
  supersededSections?: Record<string, string>;
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

/** Pergunta feita no "Pergunte" (0040) — as sem resposta formam a fila do admin/skill. */
export interface ArchitectureQuestion {
  id: string;
  text: string;
  kind: string;
  coverage: ArchitectureCoverage;
  suggestedProject?: string | null;
  suggestedSection?: string | null;
  times: number;
  firstAskedAt: string;
  firstAskedBy: string;
  lastAskedAt: string;
  lastAskedBy: string;
  status: 'open' | 'answered' | 'dismissed' | string;
  answeredProject?: string | null;
  answeredSection?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  note?: string | null;
}

export interface ArchitectureSuggestion {
  id: string;
  projectKey: string;
  sectionKey?: string | null;
  kind: 'learning' | 'divergence' | 'gap' | 'other' | string;
  content: string;
  cardNumber?: string | null;
  status: 'pending' | 'applied' | 'dismissed' | string;
  createdBy: string;
  createdAt: string;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  resolutionNote?: string | null;
  /** 0054: item da engenharia reversa (RN-012). */
  itemId?: string | null;
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
  /** 0038: human = trecho do Guia (linguagem simples). */
  audience?: 'llm' | 'human' | string | null;
}

/** Seção principal para ler sobre a pergunta (0038 F5). */
export interface ArchitectureSuggestedSection {
  projectKey: string;
  sectionKey: string;
  heading?: string | null;
  title: string;
  reason?: string | null;
}

export type ArchitectureCoverage = 'answered' | 'partial' | 'not-found' | 'unknown' | string;

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
  /** 0038 F5: quanto a base cobre a pergunta (unknown = sem IA) e a seção principal para ler. */
  coverage?: ArchitectureCoverage | null;
  /** 0040: operacao | regra | tecnica | outra (null sem IA). */
  kind?: string | null;
  suggestedSection?: ArchitectureSuggestedSection | null;
}

/** Proposta de seção nova/atualizada (0038: guia, aprender com card, pergunte a fundo). */
export interface ArchitectureSectionProposal {
  projectKey: string;
  sectionKey: string;
  title: string;
  audience: 'llm' | 'human' | string;
  content: string;
  reason?: string | null;
}

/** "Analisar a fundo e propor uma seção" (0038 F5) — não grava nada. */
export interface ArchitectureDeepAnswerResponse {
  question: string;
  answer?: string | null;
  coverage: ArchitectureCoverage;
  proposal?: ArchitectureSectionProposal | null;
  needsCodeAnalysis: boolean;
  codeHints?: string | null;
  sourcesRead: string[];
  provider?: string | null;
  model?: string | null;
  aiUnavailableReason?: string | null;
}

/** Guia proposto pela IA (0038 F3) — o admin revisa e aplica; nada é gravado sem aceite. */
export interface ArchitectureGuideResponse {
  provider?: string | null;
  model?: string | null;
  displayName?: string | null;
  tagline?: string | null;
  businessArea?: string | null;
  sections: { key: string; title: string; order: number; content: string }[];
  notes?: string | null;
}

/** "Aprender com um card" (0038 F4) — não grava; a tela envia as propostas aceitas para a fila de sugestões. */
export interface LearnFromCardSource {
  kind: 'devops' | 'pr' | 'timeline' | 'plan' | 'suggestions' | string;
  label: string;
  ok: boolean;
  detail?: string | null;
}

export interface LearnFromCardProposal {
  projectKey: string;
  sectionKey?: string | null;
  audience: 'llm' | 'human' | string;
  title: string;
  content: string;
  reason?: string | null;
}

export interface LearnFromCardResponse {
  cardNumber: string;
  cardTitle?: string | null;
  summary?: string | null;
  sources: LearnFromCardSource[];
  existing: ArchitectureSuggestion[];
  proposals: LearnFromCardProposal[];
  provider?: string | null;
  model?: string | null;
  aiUnavailableReason?: string | null;
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
  { key: 'operacao', title: 'Configuração e operação', order: 85 },
  { key: 'armadilhas', title: 'Armadilhas e bugs conhecidos', order: 90 },
];

/** Seções do Guia (0038): linguagem simples para QA, gestores e suporte — só na tela, não vão para as skills. */
export const GUIDE_TEMPLATE: { key: string; title: string; order: number }[] = [
  { key: 'guia-o-que-e', title: 'O que é e para que serve', order: 510 },
  { key: 'guia-como-funciona', title: 'Como funciona, passo a passo', order: 520 },
  { key: 'guia-regras', title: 'Regras de negócio', order: 530 },
  { key: 'guia-conexoes', title: 'Com quem conversa', order: 540 },
  { key: 'guia-como-configurar', title: 'Como configurar e dar acesso', order: 545 },
  { key: 'guia-como-testar', title: 'Como testar', order: 550 },
  { key: 'guia-perguntas', title: 'Perguntas frequentes', order: 560 },
];

/** Só no projeto "ecossistema". */
export const ECOSYSTEM_GUIDE_EXTRA: { key: string; title: string; order: number }[] = [
  { key: 'guia-glossario', title: 'Glossário', order: 570 },
];

/** A seção é do Guia (público human; seção antiga sem público e chave guia-* também conta). */
export function isGuideSection(s: { key: string; audience?: string | null }): boolean {
  return s.audience ? s.audience === 'human' : s.key.startsWith('guia-');
}

export interface ArchitectureProjectBody {
  name: string;
  kind: string;
  repository?: string | null;
  summary?: string | null;
  keywords?: string[];
  order?: number | null;
  relations?: ArchitectureRelation[] | null;
  /** 0038: null mantém, "" limpa. */
  displayName?: string | null;
  tagline?: string | null;
  businessArea?: string | null;
}

export interface ArchitectureSectionBody {
  title?: string | null;
  content: string;
  order?: number | null;
  source: 'admin' | 'ai';
  note?: string | null;
  /** 0038: null mantém; seção nova sem público → human se a chave começa com guia-, senão llm. */
  audience?: 'llm' | 'human' | null;
}

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
  upsertProject(key: string, body: ArchitectureProjectBody): Observable<ArchitectureProject> {
    return this.http.put<ArchitectureProject>(`${this.api}/projects/${encodeURIComponent(key)}`, body);
  }

  writeSection(projectKey: string, sectionKey: string, body: ArchitectureSectionBody): Observable<ArchitectureSection> {
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

  /** Envia uma sugestão para a fila do admin (qualquer logado). */
  /** 0040: perguntas do "Pergunte" (admin) — padrão: as sem resposta em aberto. */
  questions(status: 'open' | 'answered' | 'dismissed' | 'all' = 'open', gaps = true): Observable<ArchitectureQuestion[]> {
    return this.http.get<ArchitectureQuestion[]>(`${this.api}/questions`, { params: new HttpParams().set('status', status).set('gaps', String(gaps)) });
  }

  resolveQuestion(id: string, body: { status: 'answered' | 'dismissed' | 'open'; projectKey?: string | null; sectionKey?: string | null; note?: string | null }): Observable<ArchitectureQuestion> {
    return this.http.post<ArchitectureQuestion>(`${this.api}/questions/${id}/resolve`, body);
  }

  suggest(body: { projectKey: string; sectionKey?: string | null; kind: 'learning' | 'divergence' | 'gap' | 'other'; content: string; cardNumber?: string | null }): Observable<ArchitectureSuggestion> {
    return this.http.post<ArchitectureSuggestion>(`${this.api}/suggestions`, body);
  }

  /** 0038 F3: a IA propõe o Guia do projeto (admin) — não grava. */
  generateGuide(projectKey: string, instructions?: string | null): Observable<ArchitectureGuideResponse> {
    return this.http.post<ArchitectureGuideResponse>(`${this.api}/projects/${encodeURIComponent(projectKey)}/guide`, { instructions: instructions || null });
  }

  /** 0038 F4: junta o que se sabe do card e propõe aprendizados — não grava. */
  learnFromCard(cardNumber: string, instructions?: string | null): Observable<LearnFromCardResponse> {
    return this.http.post<LearnFromCardResponse>(`${this.api}/learn-from-card`, { cardNumber, instructions: instructions || null });
  }

  /** 0038 F5: analisa a fundo uma pergunta que a base não cobre bem e propõe uma seção — não grava. */
  askDeep(question: string): Observable<ArchitectureDeepAnswerResponse> {
    return this.http.post<ArchitectureDeepAnswerResponse>(`${this.api}/ask/deep`, { question });
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
