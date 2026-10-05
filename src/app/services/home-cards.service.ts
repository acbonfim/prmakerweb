import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of } from 'rxjs';
import { environment } from '../../environments/environment';

/** Listas da home (0051) — espelho de solvace.prform.Home.HomeCardsResponses no backend. */
export type HomeCardsScope = 'mine' | 'participated';

/** Como o usuário participou (HomeCardRole no backend). */
export type HomeCardRole = 'register' | 'pr' | 'timeline' | 'plan' | 'handover';

export interface HomeCardParticipant {
  userId: string | null;
  name: string;
  isOwner: boolean;
}

export interface HomeCardActivity {
  kind: 'register' | 'pr' | 'timeline' | 'note' | 'plan' | 'handover';
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
}

export interface HomeCardEntry {
  userId: string | null;
  userName: string;
  excerpt: string;
  createdAt: string;
  number: number | null;
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
