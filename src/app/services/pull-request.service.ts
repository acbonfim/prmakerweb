import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { environment } from '../../environments/environment';

/** Item enxuto dos últimos PRs registrados por um usuário (atalho da home). */
export interface RecentPullRequest {
  id: number;
  cardNumber: string;
  description: string;
  repositoryId: string | null;
  branchPrefix: string;
  branchName: string;
  createdAt: string;
  updatedAt: string | null;
}

/** Registro do card (um por card): descrição e root cause únicos para todos os repositórios. */
export interface PullRequestRegister {
  id: number;
  cardNumber: string;
  description: string;
  rootCause: string;
  /** Legado — branch/repositório agora são de cada PR do GitHub. */
  branchPrefix?: string;
  branchName?: string;
  repositoryId?: string | null;
  userId: string;
  createdAt: string;
  updatedAt: string | null;
  createdBy?: string | null;
  githubPullRequests?: GithubPullRequest[];
}

/** LEGACY = registro migrado do modelo antigo (card x repositório), sem PR no GitHub. */
export type GithubPullRequestStatus = 'OPEN' | 'MERGED' | 'CLOSED' | 'LEGACY';

/** PR aberto no GitHub pelo CIME para um card. */
export interface GithubPullRequest {
  id: number;
  pullRequestRegisterId: number;
  cardNumber: string;
  repositoryId: string;
  branchPrefix: string;
  branchName: string;
  targetBranch: string;
  /** null nos registros LEGACY. */
  number: number | null;
  url: string;
  title: string;
  description: string;
  status: GithubPullRequestStatus;
  isDraft: boolean;
  statusSyncedAt: string | null;
  /** true quando o GitHub não respondeu e o status é o último persistido. */
  statusStale: boolean;
  /** true quando já existia PR aberto para head→base e ele só foi registrado. */
  alreadyExisted: boolean;
  /** Usuário do CIME (externalId) que abriu — no GitHub o autor é sempre a conta do token. */
  userId: string;
  createdAt: string;
  updatedAt: string | null;
}

export interface GithubRepository {
  id: string;
  label: string;
  private: boolean;
  defaultBranch: string;
}

export interface SaveCardRequest {
  cardNumber: string;
  userId: string;
  formId: number;
  description?: string | null;
  rootCause?: string | null;
}

export interface OpenGithubPullRequestRequest {
  repositoryId: string;
  branchPrefix: string;
  branchName: string;
  targetBranch: string;
  title: string;
  description?: string | null;
  draft: boolean;
  userId: string;
}

export interface UpdateGithubPullRequestRequest {
  title: string;
  description?: string | null;
}

@Injectable({ providedIn: 'root' })
export class PullRequestService {
  private http = inject(HttpClient);
  private baseUrl = environment.apiUrl;

  /** Últimos PRs registrados pelo usuário (externalId), do mais recente para o mais antigo. */
  getRecentByUser(userId: string, take = 5) {
    return this.http.get<RecentPullRequest[]>(
      `${this.baseUrl}PullRequest/GetRecentByUser?userId=${encodeURIComponent(userId)}&take=${take}`
    );
  }

  /** Registro do card (null quando ainda não foi salvo). */
  getByCardNumber(cardNumber: string) {
    return this.http.get<PullRequestRegister | null>(
      `${this.baseUrl}PullRequest/GetByCardNumber?cardNumber=${encodeURIComponent(cardNumber)}`
    );
  }

  /** Salva os dados do card (descrição/root cause opcionais) e devolve o registro salvo. */
  saveCard(request: SaveCardRequest) {
    return this.http.post<PullRequestRegister>(`${this.baseUrl}PullRequest`, request);
  }

  /** Repositórios do owner configurado no plugin do GitHub. */
  getRepositories() {
    return this.http.get<GithubRepository[]>(`${this.baseUrl}GitHub/repositories`);
  }

  /** Abre o PR no GitHub e registra no card. */
  openGithubPr(cardNumber: string, request: OpenGithubPullRequestRequest) {
    return this.http.post<GithubPullRequest>(
      `${this.baseUrl}PullRequest/${encodeURIComponent(cardNumber)}/github`, request
    );
  }

  /** Atualiza título/descrição de um PR já aberto (GitHub + registro). */
  updateGithubPr(cardNumber: string, id: number, request: UpdateGithubPullRequestRequest) {
    return this.http.put<GithubPullRequest>(
      `${this.baseUrl}PullRequest/${encodeURIComponent(cardNumber)}/github/${id}`, request
    );
  }

  /**
   * PRs do GitHub abertos para o card; refreshStatus consulta o status atual no GitHub
   * (cache de 60 s no backend) e forceRefresh ignora esse cache.
   */
  listGithubPrs(cardNumber: string, refreshStatus = true, forceRefresh = false) {
    return this.http.get<GithubPullRequest[]>(
      `${this.baseUrl}PullRequest/${encodeURIComponent(cardNumber)}/github?refreshStatus=${refreshStatus}&forceRefresh=${forceRefresh}`
    );
  }
}
