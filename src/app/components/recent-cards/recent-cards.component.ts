import { ChangeDetectorRef, Component, EventEmitter, OnDestroy, OnInit, Output, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { StorageService } from '../../services/storage.service';
import { PullRequestService, RecentPullRequest } from '../../services/pull-request.service';
import { WsService } from '../../services/ws.service';

/** Tempo real das listas de recentes da home (PullRequestRealTimeEvents no backend, 0021). */
const RECENT_GROUP = 'pullrequest-recent';
const RECENT_EVENT = 'pullRequestRecentUpdated';


/**
 * Atalho da home: lista os últimos cards (PRs) que o usuário registrou.
 * Ao clicar, leva para a tela de registro já buscando aquele card
 * (número + repositório vão via querystring). Atualiza em tempo real quando um card é salvo ou
 * um PR é aberto (tela, outro usuário ou skill gerar-prmake).
 */
@Component({
  selector: 'app-recent-cards',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatProgressSpinnerModule],
  templateUrl: './recent-cards.component.html',
  styleUrls: ['./recent-cards.component.css'],
})
export class RecentCardsComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private storageService = inject(StorageService);
  private pullRequestService = inject(PullRequestService);
  private cdr = inject(ChangeDetectorRef);
  private ws = inject(WsService);

  /** Emite se a seção tem conteúdo (carregando ou com itens). O pai usa para
   *  colapsar o layout e dar 100% da largura ao outro bloco quando este fica vazio. */
  @Output() visibilityChange = new EventEmitter<boolean>();

  cards: RecentPullRequest[] = [];
  isLoading = false;
  readonly skeletons = Array.from({ length: 6 });
  private userId: string | null = null;
  private reloadTimer?: ReturnType<typeof setTimeout>;
  private resyncSub?: Subscription;

  private get isVisible(): boolean {
    return this.isLoading || this.cards.length > 0;
  }

  ngOnInit() {
    const access = this.storageService.getAccess();
    this.userId = access && access.user ? access.user.externalId : null;
    if (!this.userId) {
      this.visibilityChange.emit(false);
      return;
    }

    this.load();
    this.ws.startConnection();
    this.ws.addToGroup(RECENT_GROUP);
    this.ws.on(RECENT_EVENT, this.onRecentUpdated);
    this.resyncSub = this.ws._resynced.subscribe(() => this.onRecentUpdated());
  }

  ngOnDestroy() {
    if (!this.userId) return;
    clearTimeout(this.reloadTimer);
    this.ws.off(RECENT_EVENT, this.onRecentUpdated);
    this.ws.removeFromGroup(RECENT_GROUP);
    this.resyncSub?.unsubscribe();
  }

  /** Vários eventos seguidos (salvar + abrir PR) viram uma recarga só, sem skeleton. Handover não muda esta lista. */
  private onRecentUpdated = (payload?: any): void => {
    if (payload?.action === 'handover-saved') return;
    clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => this.load(true), 600);
  };

  private load(silent = false) {
    if (!this.userId) return;
    if (!silent) this.isLoading = true;
    this.pullRequestService.getRecentByUser(this.userId, 10).subscribe({
      next: (cards) => {
        this.cards = cards ?? [];
        this.isLoading = false;
        this.visibilityChange.emit(this.isVisible);
        this.cdr.detectChanges();
      },
      error: () => {
        this.isLoading = false;
        this.visibilityChange.emit(this.isVisible);
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