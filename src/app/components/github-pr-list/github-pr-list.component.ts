import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { OrderListModule } from 'primeng/orderlist';
import { UserAvatarComponent } from '../user-avatar/user-avatar.component';
import { AuthService } from '../../services/auth.service';
import { GithubPullRequest } from '../../services/pull-request.service';

interface Author { name: string; photo: string | null; }

/**
 * Lista interativa dos PRs do GitHub do card (spec 3): branch, repositório, data, avatar + nome
 * de quem abriu (usuário do CIME) e status à direita. Usa o p-orderList só como lista
 * selecionável — sem os controles de reordenação.
 */
@Component({
  selector: 'app-github-pr-list',
  standalone: true,
  imports: [DatePipe, FormsModule, MatIconModule, MatTooltipModule, OrderListModule, UserAvatarComponent],
  template: `
    @if (loading() && prs().length === 0) {
      <div class="pr-skeleton" aria-hidden="true">
        @for (s of [1, 2, 3]; track s) {
          <div class="cime-skeleton pr-skeleton__item"></div>
        }
      </div>
    } @else if (prs().length === 0) {
      <div class="pr-empty">{{ emptyMessage() }}</div>
    } @else {
      <p-orderList class="pr-orderlist"
                   [value]="items()"
                   [selection]="selection"
                   (onSelectionChange)="onSelect($event.value)"
                   [dragdrop]="false"
                   [metaKeySelection]="false"
                   dataKey="id">
        <ng-template let-pr #item>
          <div class="pr-item">
            <app-user-avatar [name]="authorOf(pr).name" [imageUrl]="authorOf(pr).photo" [size]="32"></app-user-avatar>
            <div class="pr-item__main">
              <span class="pr-item__branch">{{ pr.branchPrefix }}{{ pr.branchName }}</span>
              <span class="pr-item__meta">
                <mat-icon>folder</mat-icon>{{ pr.repositoryId }} → {{ pr.targetBranch }}
                · #{{ pr.number }}
              </span>
              <span class="pr-item__meta">
                {{ authorOf(pr).name || '—' }} · {{ pr.createdAt | date:'dd/MM/yyyy HH:mm' }}
              </span>
            </div>
            <div class="pr-item__status">
              @if (pr.statusStale) {
                <mat-icon class="pr-item__stale" matTooltip="Não foi possível consultar o GitHub agora — status da última atualização"
                          matTooltipPosition="above">sync_problem</mat-icon>
              }
              @if (pr.isDraft && pr.status === 'OPEN') {
                <span class="pr-chip pr-chip--draft">DRAFT</span>
              }
              <span [class]="'pr-chip pr-chip--' + pr.status.toLowerCase()">{{ pr.status }}</span>
            </div>
          </div>
        </ng-template>
      </p-orderList>
    }
  `,
  styles: [`
    :host {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
    }

    .pr-skeleton { display: flex; flex-direction: column; gap: 8px; }
    .pr-skeleton__item { height: 62px; border-radius: 8px; }

    .pr-empty {
      margin: auto;
      font-size: 13px;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent);
    }

    /* p-orderList como lista simples: sem controles de ordenação, sem bordas/fundo próprios */
    :host ::ng-deep .pr-orderlist .p-orderlist-controls { display: none; }
    :host ::ng-deep .pr-orderlist .p-orderlist,
    :host ::ng-deep .pr-orderlist .p-listbox,
    :host ::ng-deep .pr-orderlist .p-listbox-list-container {
      background: transparent;
      border: none;
      box-shadow: none;
      max-height: none !important;
      width: 100%;
    }
    :host ::ng-deep .pr-orderlist .p-listbox-list { padding: 0; gap: 6px; display: flex; flex-direction: column; }
    :host ::ng-deep .pr-orderlist .p-listbox-option {
      padding: 0;
      border-radius: 8px;
      background: var(--surface-input, #1f1f1f);
      border: 1px solid rgba(255, 255, 255, 0.06);
      color: var(--mat-sys-on-surface);
    }
    :host ::ng-deep .pr-orderlist .p-listbox-option:hover,
    :host ::ng-deep .pr-orderlist .p-listbox-option.p-focus {
      background: var(--surface-input, #1f1f1f);
      border-color: color-mix(in srgb, var(--mat-sys-primary) 55%, transparent);
    }
    :host ::ng-deep .pr-orderlist .p-listbox-option-selected {
      background: color-mix(in srgb, var(--mat-sys-primary) 14%, transparent);
    }

    .pr-item {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 8px 10px;
      cursor: pointer;
    }

    .pr-item__main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .pr-item__branch { font-weight: 600; color: var(--mat-sys-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .pr-item__meta {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 65%, transparent);
    }
    .pr-item__meta mat-icon { font-size: 14px; width: 14px; height: 14px; }

    .pr-item__status { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .pr-item__stale { color: #d29922; font-size: 18px; width: 18px; height: 18px; }

    .pr-chip {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.4px;
      padding: 3px 9px;
      border-radius: 999px;
      border: 1px solid transparent;
    }
    /* Cores do GitHub: aberto (verde), mergeado (lilás), fechado (vermelho) */
    .pr-chip--open { color: #3fb950; background: rgba(63, 185, 80, 0.15); border-color: rgba(63, 185, 80, 0.4); }
    .pr-chip--merged { color: #a371f7; background: rgba(163, 113, 247, 0.15); border-color: rgba(163, 113, 247, 0.4); }
    .pr-chip--closed { color: #f85149; background: rgba(248, 81, 73, 0.15); border-color: rgba(248, 81, 73, 0.4); }
    .pr-chip--draft { color: #8b949e; background: rgba(139, 148, 158, 0.15); border-color: rgba(139, 148, 158, 0.4); }
  `]
})
export class GithubPrListComponent {
  private authService = inject(AuthService);

  readonly prs = input<GithubPullRequest[]>([]);
  readonly loading = input(false);
  readonly emptyMessage = input('Nenhum PR aberto para este card.');
  readonly select = output<GithubPullRequest>();

  /** p-orderList trabalha com uma cópia (ele reordena o array que recebe). */
  readonly items = computed(() => [...this.prs()]);
  selection: GithubPullRequest[] = [];

  private readonly authors = signal<Record<string, Author>>({});

  constructor() {
    // Resolve nome/foto de todos os autores numa única chamada (userId = externalId do CIME).
    effect(() => {
      const missing = [...new Set(this.prs().map(pr => pr.userId).filter(Boolean))]
        .filter(id => !untracked(this.authors)[id.toLowerCase()]);
      if (missing.length > 0) untracked(() => this.loadAuthors(missing));
    });
  }

  authorOf(pr: GithubPullRequest): Author {
    return this.authors()[pr.userId?.toLowerCase()] ?? { name: '', photo: null };
  }

  onSelect(selected: GithubPullRequest[] | null): void {
    const pr = selected?.[0];
    // A lista não mantém seleção: o clique só abre o PR no modal.
    this.selection = [];
    if (pr) this.select.emit(pr);
  }

  private loadAuthors(userIds: string[]): void {
    this.authService.getPhotosByExternalIds(userIds).subscribe({
      next: (res: any) => {
        const list = res?.object ?? res?.Object ?? [];
        const found: Record<string, Author> = {};
        for (const u of list) {
          const id = (u.externalId || u.ExternalId || '').toLowerCase();
          if (id) found[id] = { name: u.fullName || u.FullName || '', photo: u.imageUrl || u.ImageUrl || null };
        }
        this.authors.update(current => ({ ...current, ...found }));
      },
      error: (e) => console.error('Falha ao carregar autores dos PRs', e),
    });
  }
}
