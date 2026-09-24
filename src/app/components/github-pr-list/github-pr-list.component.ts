import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { OrderListModule } from 'primeng/orderlist';
import { UserAvatarComponent } from '../user-avatar/user-avatar.component';
import { AuthService } from '../../services/auth.service';
import { GithubPullRequest } from '../../services/pull-request.service';
import { FilterBarComponent } from '../filter-bar/filter-bar.component';
import { PrQuickActionsComponent } from '../pr-quick-actions/pr-quick-actions.component';
import { TargetBranchOption } from '../target-branch-toggle/target-branch-toggle.component';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FilterOption, FilterProvider, FilterValues } from '../filter-bar/filter-bar.models';
import { of } from 'rxjs';

interface Author { name: string; photo: string | null; }

/** Ordem de exibição das opções de status (as demais, se surgirem, vão ao fim em ordem alfabética). */
const STATUS_ORDER = ['OPEN', 'MERGED', 'CLOSED', 'LEGACY'];
const STATUS_LABEL: Record<string, string> = { LEGACY: 'LEGADO' };

/** Valor de cada filtro para um PR — as opções e o filtro usam a mesma chave. */
const FILTER_VALUE: Record<string, (pr: GithubPullRequest) => string> = {
  status: pr => pr.status ?? '',
  branch: pr => `${pr.branchPrefix ?? ''}${pr.branchName ?? ''}`,
  repository: pr => pr.repositoryId ?? '',
};

/** Opções possíveis de um filtro: só os valores que existem nos PRs do card (spec 0005/6). */
export function filterOptions(prs: GithubPullRequest[], key: string, term = ''): FilterOption[] {
  const values = [...new Set(prs.map(FILTER_VALUE[key]).filter(Boolean))];
  if (key === 'status') {
    const rank = (v: string) => { const i = STATUS_ORDER.indexOf(v); return i < 0 ? STATUS_ORDER.length : i; };
    values.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  } else {
    values.sort((a, b) => a.localeCompare(b));
  }
  const needle = term.trim().toLowerCase();
  return values
    .map(v => ({ value: v, label: key === 'status' ? (STATUS_LABEL[v] ?? v) : v }))
    .filter(o => !needle || o.label.toLowerCase().includes(needle));
}

/** Aplica os filtros: OU entre os valores de um mesmo filtro, E entre filtros diferentes. */
export function filterPrs(prs: GithubPullRequest[], values: FilterValues): GithubPullRequest[] {
  const active = Object.entries(values).filter(([key, opts]) => FILTER_VALUE[key] && opts.length > 0);
  if (active.length === 0) return prs;
  return prs.filter(pr => active.every(([key, opts]) => opts.some(o => o.value === FILTER_VALUE[key](pr))));
}

/**
 * Lista interativa dos PRs do GitHub do card (spec 3): branch, repositório, data, avatar + nome
 * de quem abriu (usuário do CIME) e status à direita. Usa o p-orderList só como lista
 * selecionável — sem os controles de reordenação. Acima da lista, filtros por status, branch e
 * repositório (feature 0005) com os valores existentes nos PRs do card.
 */
@Component({
  selector: 'app-github-pr-list',
  standalone: true,
  imports: [DatePipe, FormsModule, MatIconModule, MatTooltipModule, OrderListModule, UserAvatarComponent, FilterBarComponent,
    MatButtonModule, MatProgressSpinnerModule, PrQuickActionsComponent],
  template: `
    <!-- Filtros (0005): recriados a cada card (resetKey) para começar sem seleção -->
    @if (prs().length > 0) {
      @for (key of [resetKey()]; track key) {
        <div class="pr-filters">
          <cc-filter-bar [provider]="filterProvider" (valuesChange)="filters.set($event)" />
        </div>
      }
    }

    <div class="pr-scroll">
    @if (loading()) {
      <!-- Skeleton no formato de cada registro: um por PR já listado (3 na primeira carga) -->
      <div class="pr-skeleton" aria-busy="true" aria-label="Carregando pull requests">
        @for (s of skeletonRows(); track $index) {
          <div class="pr-skeleton__item" aria-hidden="true">
            <div class="cime-skeleton pr-skeleton__avatar"></div>
            <div class="pr-skeleton__main">
              <div class="cime-skeleton pr-skeleton__line pr-skeleton__line--title"></div>
              <div class="cime-skeleton pr-skeleton__line pr-skeleton__line--meta"></div>
              <div class="cime-skeleton pr-skeleton__line pr-skeleton__line--meta-short"></div>
            </div>
            <div class="cime-skeleton pr-skeleton__chip"></div>
          </div>
        }
      </div>
    } @else if (prs().length === 0) {
      <div class="pr-empty">{{ emptyMessage() }}</div>
    } @else if (items().length === 0) {
      <div class="pr-empty">Nenhum PR corresponde aos filtros.</div>
    } @else {
      <p-orderList class="pr-orderlist"
                   [value]="items()"
                   [selection]="selection"
                   (onSelectionChange)="onSelect($event.value)"
                   [dragdrop]="false"
                   [metaKeySelection]="false"
                   dataKey="id">
        <ng-template let-pr #item>
          <!-- 0007: botão direito = atalhos rápidos (mesmo menu do ⚡) -->
          <div class="pr-item" (contextmenu)="actions.openFromContextMenu(pr, $event)"
               matTooltip="Clique para abrir · botão direito para atalhos rápidos"
               [matTooltipShowDelay]="900" matTooltipPosition="above">
            <app-user-avatar [name]="authorOf(pr).name" [imageUrl]="authorOf(pr).photo" [size]="32"></app-user-avatar>
            <div class="pr-item__main">
              <span class="pr-item__branch">{{ pr.branchPrefix }}{{ pr.branchName }}</span>
              <span class="pr-item__meta">
                <mat-icon>folder</mat-icon>{{ pr.repositoryId }}
                @if (pr.number) { → {{ pr.targetBranch }} · #{{ pr.number }} }
              </span>
              <span class="pr-item__meta">
                {{ authorOf(pr).name || '—' }} · {{ pr.createdAt | date:'dd/MM/yyyy HH:mm' }}
              </span>
            </div>
            <div class="pr-item__side">
            <div class="pr-item__tools">
              <!-- Pedir aprovação no Teams (0007): desabilitado até configurar / para PR não aberto -->
              <span [matTooltip]="actions.approvalBlockReason(pr) ?? 'Pedir aprovação no Teams'" matTooltipPosition="above">
                <button mat-icon-button class="pr-tool"
                        [disabled]="!!actions.approvalBlockReason(pr) || actions.isSendingApproval(pr)"
                        (mousedown)="$event.stopPropagation()"
                        (click)="$event.stopPropagation(); actions.requestApproval(pr)"
                        aria-label="Pedir aprovação no Teams">
                  @if (actions.isSendingApproval(pr)) {
                    <mat-spinner diameter="14"></mat-spinner>
                  } @else {
                    <mat-icon>forum</mat-icon>
                  }
                </button>
              </span>
              <button mat-icon-button class="pr-tool pr-tool--bolt"
                      matTooltip="Atalhos rápidos (ou botão direito na linha)" matTooltipPosition="above"
                      (mousedown)="$event.stopPropagation()"
                      (click)="$event.stopPropagation(); actions.openFromButton(pr, $any($event.currentTarget))"
                      aria-label="Atalhos rápidos">
                <mat-icon>bolt</mat-icon>
              </button>
            </div>
            <div class="pr-item__status">
              @if (pr.statusStale) {
                <mat-icon class="pr-item__stale" matTooltip="Não foi possível consultar o GitHub agora — status da última atualização"
                          matTooltipPosition="above">sync_problem</mat-icon>
              }
              @if (pr.isDraft && pr.status === 'OPEN') {
                <span class="pr-chip pr-chip--draft">DRAFT</span>
              }
              @if (pr.status === 'LEGACY') {
                <span class="pr-chip pr-chip--legacy"
                      matTooltip="Registro anterior (branch/repositório salvos), sem PR no GitHub. Clique para abrir o PR."
                      matTooltipPosition="above">LEGADO</span>
              } @else {
                <span [class]="'pr-chip pr-chip--' + pr.status.toLowerCase()">{{ pr.status }}</span>
              }
            </div>
            </div>
          </div>
        </ng-template>
      </p-orderList>
    }
    </div>

    <app-pr-quick-actions #actions [targetOptions]="targetOptions()" [userId]="userId()"></app-pr-quick-actions>
  `,
  styles: [`
    :host {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    /* Filtros fixos no topo; só a lista rola */
    .pr-filters { flex: none; }
    .pr-scroll {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
    }

    .pr-skeleton { display: flex; flex-direction: column; gap: 6px; }

    /* Mesmas medidas do .pr-item para não "pular" quando os registros voltam */
    .pr-skeleton__item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border-radius: 8px;
      background: var(--surface-input, #1f1f1f);
      border: 1px solid rgba(255, 255, 255, 0.06);
    }
    .pr-skeleton__avatar { width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; }
    .pr-skeleton__main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
    .pr-skeleton__line { height: 10px; border-radius: 5px; }
    .pr-skeleton__line--title { width: 45%; height: 12px; }
    .pr-skeleton__line--meta { width: 65%; }
    .pr-skeleton__line--meta-short { width: 38%; }
    .pr-skeleton__chip { width: 58px; height: 20px; border-radius: 999px; flex-shrink: 0; }

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

    /* Coluna da direita: ferramentas (Teams, ⚡) no topo, status embaixo (0007) */
    .pr-item__side { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0; align-self: stretch; justify-content: space-between; }
    .pr-item__tools { display: flex; align-items: center; gap: 2px; margin: -4px -6px 0 0; }
    .pr-tool.mat-mdc-icon-button {
      width: 26px; height: 26px; padding: 0;
      --mdc-icon-button-state-layer-size: 26px;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent);
    }
    .pr-tool.mat-mdc-icon-button:not(:disabled):hover { color: var(--mat-sys-primary); }
    .pr-tool--bolt.mat-mdc-icon-button { color: color-mix(in srgb, #d29922 80%, transparent); }
    .pr-tool--bolt.mat-mdc-icon-button:hover { color: #d29922; }
    .pr-tool .mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .pr-tool mat-spinner { margin: auto; }
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
    .pr-chip--legacy { color: #8b949e; background: transparent; border-color: rgba(139, 148, 158, 0.5); border-style: dashed; }
    .pr-chip--draft { color: #8b949e; background: rgba(139, 148, 158, 0.15); border-color: rgba(139, 148, 158, 0.4); }
  `]
})
export class GithubPrListComponent {
  private authService = inject(AuthService);

  readonly prs = input<GithubPullRequest[]>([]);
  readonly loading = input(false);
  readonly emptyMessage = input('Nenhum PR aberto para este card.');
  /** Destinos para "Abrir PR rápido" (ActiveBranchs), os mesmos do modal. */
  readonly targetOptions = input<TargetBranchOption[]>([]);
  /** ExternalId de quem está logado (autor do PR aberto pelos atalhos). */
  readonly userId = input<string | undefined>(undefined);
  /** Muda a cada card: limpa os filtros (ex.: o número do card). */
  readonly resetKey = input<string | null>(null);
  readonly select = output<GithubPullRequest>();

  /** Seleção atual dos filtros (0005). */
  readonly filters = signal<FilterValues>({});

  /** Valores possíveis vindos dos PRs do card no momento da abertura/busca (specs 0005/3 e 6). */
  readonly filterProvider: FilterProvider = {
    getFilterDefs: () => [
      { key: 'status', label: 'Status', multiple: true, search: term => of(filterOptions(this.prs(), 'status', term)) },
      { key: 'branch', label: 'Branch', multiple: true, search: term => of(filterOptions(this.prs(), 'branch', term)) },
      { key: 'repository', label: 'Repositório', multiple: true, search: term => of(filterOptions(this.prs(), 'repository', term)) },
    ],
  };

  /** p-orderList trabalha com uma cópia (ele reordena o array que recebe). */
  readonly items = computed(() => [...filterPrs(this.prs(), this.filters())]);
  /** Quantidade de linhas de skeleton: os PRs já exibidos (atualização) ou 3 (primeira carga), até 8. */
  readonly skeletonRows = computed(() => {
    const count = this.prs().length > 0 ? Math.min(this.prs().length, 8) : 3;
    return Array.from({ length: count });
  });
  selection: GithubPullRequest[] = [];

  private readonly authors = signal<Record<string, Author>>({});

  constructor() {
    // Troca de card (a barra é recriada) ou lista vazia (a barra some): filtros voltam a zero junto
    // com a barra. Atualizar o status dos PRs mantém os filtros.
    effect(() => {
      this.resetKey();
      untracked(() => this.filters.set({}));
    });
    effect(() => {
      if (this.prs().length === 0) untracked(() => this.filters.set({}));
    });
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
