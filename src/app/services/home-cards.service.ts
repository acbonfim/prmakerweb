import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * Listas da home (0051) — espelho de solvace.prform.Home.HomeCardsResponses no backend. `workbench` (0088): todos os
 * cards em que o usuário atuou, pela última atualização no card (abrem na Bancada).
 */
export type HomeCardsScope = 'mine' | 'participated' | 'workbench';

/** Como o usuário participou (HomeCardRole no backend). */
export type HomeCardRole = 'register' | 'pr' | 'timeline' | 'plan' | 'handover' | 'workitem';

export interface HomeCardParticipant {
  userId: string | null;
  name: string;
  isOwner: boolean;
}

export interface HomeCardActivity {
  kind: 'register' | 'pr' | 'timeline' | 'note' | 'plan' | 'handover' | 'workitem';
  text: string;
  userId: string | null;
  userName: string | null;
  at: string;
}

export interface HomeCardPullRequest {
  repositoryId: string;
  number: number | null;
  url: string;
  title: string;
  status: 'OPEN' | 'MERGED' | 'CLOSED' | string;
  isDraft: boolean;
  userId: string;
  createdAt: string;
}

export interface HomeCardPlan {
  id: string;
  phase: 'analysis' | 'correction' | string;
  title: string;
  status: string;
  stepsDone: number;
  stepsTotal: number;
  currentStep: string | null;
  currentStepStatus: string | null;
  waitingOn: string | null;
  waitingReason: string | null;
  openQuestions: number;
  phases: string[];
  updatedAt: string;
  /** 0075: o que está sendo aguardado agora (ticket | pr-review | qa-validation | answer | user | none) e desde quando. */
  situationKind?: string | null;
  situationAt?: string | null;
}

export interface HomeCardEntry {
  userId: string | null;
  userName: string;
  excerpt: string;
  createdAt: string;
  number: number | null;
}

/** Itens de trabalho da Bancada no card (0088). */
export interface HomeCardWorkItems {
  count: number;
  /** Não concluídos, cancelados nem desfeitos. */
  open: number;
  /** O em andamento mais recente; sem nenhum, o último mexido. */
  current: { number: number; title: string; type: string; status: string; updatedAt: string } | null;
}

export interface HomeCard {
  cardNumber: string;
  repositoryId: string | null;
  ownerUserId: string | null;
  isMine: boolean;
  registered: boolean;
  hasDescription: boolean;
  hasRootCause: boolean;
  summaryPublished: boolean;
  myRoles: HomeCardRole[];
  myLastActivityAt: string | null;
  lastActivity: HomeCardActivity | null;
  participants: HomeCardParticipant[];
  participantsCount: number;
  pullRequests: HomeCardPullRequest[];
  plan: HomeCardPlan | null;
  timeline: { count: number; last: HomeCardEntry | null };
  notes: { count: number; last: HomeCardEntry | null };
  handover: { userId: string | null; at: string } | null;
  /** 0088: última atualização no card, de qualquer pessoa (atividades + andamento do plano e dos itens). */
  updatedAt: string | null;
  workItems: HomeCardWorkItems;
}

/** Resumo do card no DevOps (AzureCardSummaryResponse). */
export interface DevOpsCardSummary {
  id: number;
  title: string | null;
  state: string | null;
  boardColumn: string | null;
  workItemType: string | null;
  assignedTo: string | null;
  assignedToImageUrl: string | null;
  changedDate: string | null;
  url: string;
}

@Injectable({ providedIn: 'root' })
export class HomeCardsService {
  private http = inject(HttpClient);
  private baseUrl = environment.apiUrl;

  getCards(scope: HomeCardsScope, take = 10): Observable<HomeCard[]> {
    return this.http.get<HomeCard[]>(`${this.baseUrl}Home/cards?scope=${scope}&take=${take}`);
  }

  /** Resumo de cards específicos (abas internas, 0065) — qualquer card, na ordem pedida (máx. 10). */
  getByNumbers(cards: string[]): Observable<HomeCard[]> {
    if (!cards.length) return of([]);
    return this.http
      .get<HomeCard[]>(`${this.baseUrl}Home/cards/by-numbers?cards=${encodeURIComponent(cards.join(','))}`)
      .pipe(catchError(() => of([])));
  }

  /** Título/estado no DevOps de vários cards numa chamada; é enfeite — falha vira lista vazia. */
  getDevOpsSummary(cards: string[]): Observable<DevOpsCardSummary[]> {
    if (!cards.length) return of([]);
    return this.http
      .post<DevOpsCardSummary[]>(`${this.baseUrl}Azure/cards/summary`, cards)
      .pipe(catchError(() => of([])));
  }
}
