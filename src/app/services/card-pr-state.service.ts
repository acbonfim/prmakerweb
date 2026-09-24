import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { RepoOption } from '../interfaces/RepoOption';
import { GithubPullRequest, PullRequestRegister, PullRequestService } from './pull-request.service';

/**
 * Estado do card em tratamento, compartilhado entre a tela de PR, o modal "Abrir PR",
 * os popovers e a geração com IA. Descrição e root cause vivem aqui para que uma edição
 * feita em qualquer lugar reflita em todos os outros.
 */
@Injectable({ providedIn: 'root' })
export class CardPrStateService {
  private prService = inject(PullRequestService);

  readonly cardNumber = signal<string | null>(null);
  readonly register = signal<PullRequestRegister | null>(null);

  /** Markdown. null = nada carregado para o card (sem registro salvo / tela limpa). */
  readonly description = signal<string | null>(null);
  readonly rootCause = signal<string | null>(null);

  readonly githubPrs = signal<GithubPullRequest[]>([]);
  readonly githubPrsLoading = signal(false);

  readonly repositories = signal<RepoOption[]>([]);
  readonly repositoriesLoading = signal(false);

  /** Repositórios que já têm PR aberto para o card (sem repetição, na ordem de abertura). */
  readonly repositoriesWithPr = computed(() =>
    [...new Set(this.githubPrs().map(pr => pr.repositoryId))]
  );

  setDescription(markdown: string | null): void {
    this.description.set(markdown);
  }

  setRootCause(markdown: string | null): void {
    this.rootCause.set(markdown);
  }

  setContent(description: string | null, rootCause: string | null): void {
    this.description.set(description);
    this.rootCause.set(rootCause);
  }

  /** Carrega o registro do card (ou null quando o card ainda não foi salvo). */
  loadRegister(cardNumber: string | null, register: PullRequestRegister | null): void {
    this.cardNumber.set(cardNumber);
    this.register.set(register);
    this.setContent(register?.description ?? null, register?.rootCause ?? null);
    this.githubPrs.set(register?.githubPullRequests ?? []);
  }

  setGithubPrs(prs: GithubPullRequest[]): void {
    this.githubPrs.set(prs);
  }

  /** Insere ou substitui (pelo id) um PR do GitHub recém-aberto/atualizado. */
  upsertGithubPr(pr: GithubPullRequest): void {
    this.githubPrs.update(list => {
      const index = list.findIndex(x => x.id === pr.id);
      if (index < 0) return [pr, ...list];
      const copy = [...list];
      copy[index] = pr;
      return copy;
    });
  }

  reset(): void {
    this.cardNumber.set(null);
    this.register.set(null);
    this.setContent(null, null);
    this.githubPrs.set([]);
  }

  /**
   * Carrega os repositórios do GitHub (uma vez por sessão, salvo `force`). Se a API falhar
   * ou não retornar nada, usa `fallback` (ex.: ActiveRepositories da configuração do plugin).
   */
  async loadRepositories(fallback: RepoOption[] = [], force = false): Promise<RepoOption[]> {
    if (!force && this.repositories().length > 0) return this.repositories();

    this.repositoriesLoading.set(true);
    try {
      const repos = await firstValueFrom(this.prService.getRepositories());
      const options = (repos ?? []).map(r => ({ label: r.label, value: r.id }));
      this.repositories.set(options.length > 0 ? options : fallback);
    } catch (error) {
      console.error('Falha ao carregar repositórios do GitHub', error);
      this.repositories.set(fallback);
    } finally {
      this.repositoriesLoading.set(false);
    }
    return this.repositories();
  }
}
