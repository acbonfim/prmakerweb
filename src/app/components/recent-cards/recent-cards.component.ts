import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { StorageService } from '../../services/storage.service';
import { PullRequestService, RecentPullRequest } from '../../services/pull-request.service';

/**
 * Atalho da home: lista os últimos cards (PRs) que o usuário registrou.
 * Ao clicar, leva para a tela de registro já buscando aquele card
 * (número + repositório vão via querystring).
 */
@Component({
  selector: 'app-recent-cards',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatProgressSpinnerModule],
  templateUrl: './recent-cards.component.html',
  styleUrls: ['./recent-cards.component.css'],
})
export class RecentCardsComponent implements OnInit {
  private router = inject(Router);
  private storageService = inject(StorageService);
  private pullRequestService = inject(PullRequestService);
  private cdr = inject(ChangeDetectorRef);

  cards: RecentPullRequest[] = [];
  isLoading = false;
  readonly skeletons = Array.from({ length: 6 });

  ngOnInit() {
    const access = this.storageService.getAccess();
    const userId = access && access.user ? access.user.externalId : null;
    if (!userId) return;

    this.isLoading = true;
    this.pullRequestService.getRecentByUser(userId, 10).subscribe({
      next: (cards) => {
        this.cards = cards ?? [];
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.isLoading = false;
        this.cdr.detectChanges();
      },
    });
  }

  open(card: RecentPullRequest) {
    this.router.navigate(['/auth/register'], {
      queryParams: {
        card: card.cardNumber,
        repositoryId: card.repositoryId ?? undefined,
      },
    });
  }

  /** Primeira linha da descrição (markdown), sem símbolos, para o preview. */
  preview(description: string): string {
    if (!description) return 'Sem descrição';
    const firstLine = description
      .split('\n')
      .map((l) => l.replace(/[#*`>_-]/g, '').trim())
      .find((l) => l.length > 0);
    return firstLine || 'Sem descrição';
  }
}