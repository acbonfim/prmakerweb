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
}
