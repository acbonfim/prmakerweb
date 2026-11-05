import { Component, DestroyRef, Injector, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogConfig, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { GithubActionsMenuComponent } from '../github-actions-menu/github-actions-menu.component';
import { GithubPrListComponent } from '../github-pr-list/github-pr-list.component';
import { OpenPrDialogComponent, OpenPrDialogData } from '../open-pr-dialog/open-pr-dialog.component';
import { GithubPullRequest } from '../../services/pull-request.service';
import { TeamsService } from '../../services/teams.service';
import { BranchSuggestion, buildBranchSuggestions, defaultTarget, prCountsLabel, splitBranch } from './workbench-prs.logic';
import { WorkbenchPrsStore } from './workbench-prs.store';

/** Vigia dos PRs abertos enquanto o modal está aberto (mesmo intervalo da tela de PR — 0025). */
const PR_WATCH_INTERVAL_MS = 45_000;
const SNACK = { horizontalPosition: 'right', verticalPosition: 'top' } as const;

/** Tamanho dos modais: largos no desktop (até 96vw) e em tela cheia abaixo de 640px. */
export function workbenchDialogSize(width: string, extra: Partial<MatDialogConfig> = {}): MatDialogConfig {
  const phone = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 639.98px)').matches;
  return phone
    ? { width: '100vw', maxWidth: '100vw', height: '100dvh', maxHeight: '100dvh', panelClass: ['custom-dialog-container', 'cime-dialog--full'], ...extra }
    : { width, maxWidth: '96vw', maxHeight: '92vh', panelClass: 'custom-dialog-container', ...extra };
}

/**
 * Modal "Pull requests" da Bancada (feature 0085): os PRs do card (a mesma `app-github-pr-list` da tela de PR,
 * com filtros e atalhos rápidos), **Abrir PR** (o mesmo `OpenPrDialogComponent`, com a branch sugerida pelas
 * regras do card), e **Ações GitHub** (`app-github-actions-menu`). As **Ações DevOps** ficam na barra do card (`app-workbench-prs`), não aqui.
 *
 * Estado próprio: o `WorkbenchPrsStore` e uma instância local do `CardPrStateService`, providos no
 * `WorkbenchPrsComponent` e herdados aqui (e no modal "Abrir PR") pelo injector do diálogo.
 */
@Component({
  selector: 'app-workbench-prs-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule,
    GithubPrListComponent, GithubActionsMenuComponent],
  template: `
    @let card = store.card();
    <div class="wpd">
      <header class="wpd__head">
        <mat-icon class="wpd__head-icon">merge</mat-icon>
        <span class="wpd__title">Pull requests · #{{ card }}</span>
        <span class="wpd__counts">{{ countsLabel() }}</span>
        <span class="wpd__spacer"></span>
        <button mat-icon-button type="button" (click)="refresh()" [disabled]="!card || store.prsLoading()"
                [matTooltip]="store.prsLoading() ? 'Consultando o GitHub…' : 'Atualizar o status no GitHub'" aria-label="Atualizar o status no GitHub">
          <mat-icon [class.wpd__spin]="store.prsLoading()">refresh</mat-icon>
        </button>
        <button mat-icon-button type="button" mat-dialog-close aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </header>

      <div class="wpd__bar">
        <button mat-flat-button color="primary" type="button" [disabled]="!canOpenPr()" (click)="openPr()"
                matTooltip="Abre o modal para criar um PR deste card no GitHub">
          <mat-icon>add</mat-icon>Abrir PR
        </button>
        <app-github-actions-menu
                [cardNumber]="card"
                [canOpenPr]="canOpenPr()"
                [prs]="store.prs()"
                [targetOptions]="store.targetOptions()"
                (openPr)="openPr()"></app-github-actions-menu>
        @if (store.dirty()) {
          <button mat-stroked-button type="button" class="wpd__save" [disabled]="saving()" (click)="saveContent()"
                  matTooltip="A descrição/Root Cause foram editados no Abrir PR: grava no registro do card no PRMake">
            @if (saving()) { <mat-spinner diameter="16"></mat-spinner> } @else { <mat-icon>save</mat-icon> }
            Salvar descrição/RC no card
          </button>
        }
      </div>

      @if (suggestions().length) {
        <div class="wpd__rules" aria-label="Branches pelas regras do card">
          <span class="wpd__rules-label" matTooltip="Calculadas pelas regras do PRMake para este card (BranchNamePattern — na User Story, BranchNamePatternUserStory — e BranchSuffixByTarget; só os destinos do fluxo do repositório)">
            <mat-icon>rule</mat-icon>Branch pelas regras
          </span>
          @for (s of suggestions(); track s.key) {
            <button type="button" class="wpd__chip" [disabled]="!canOpenPr()" [matTooltip]="s.hint" (click)="openPrWith(s)">
              @if (s.target) { <span class="wpd__chip-target">{{ s.label }}</span> }
              <code>{{ s.branch }}</code>
            </button>
          }
        </div>
      }

      @if (store.loadError(); as err) {
        <div class="wpd__warn" role="status"><mat-icon>warning</mat-icon><span>{{ err }}</span></div>
      }

      <div class="wpd__list">
        <app-github-pr-list [prs]="store.prs()"
                            [resetKey]="card"
                            [targetOptions]="store.targetOptions()"
                            [userId]="store.userId"
                            [loading]="store.prsLoading() || store.registerLoading()"
                            emptyMessage="Nenhum PR para este card ainda. Use Abrir PR."
                            (select)="openPr($event)"></app-github-pr-list>
      </div>

      <footer class="wpd__foot">
        <mat-icon>touch_app</mat-icon>
        <span>Clique num PR para editar título/descrição · botão direito (ou ⚡) para os atalhos: status, aprovação no Teams, abrir para outro destino.</span>
      </footer>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .wpd { display: flex; flex-direction: column; height: 100%; max-height: inherit; min-height: 0;
      color: var(--cc-text-1, var(--mat-sys-on-surface)); background: var(--surface-1, #262b33); }
    .wpd__head { display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 16px; background: var(--surface-2, #2e343f); }
    .wpd__head-icon { color: var(--cc-text-2); }
    .wpd__title { font-weight: 600; font-size: 15px; white-space: nowrap; }
    .wpd__counts { font-size: 12px; color: var(--cc-text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .wpd__spacer { flex: 1 1 auto; }
    .wpd__spin { animation: wpd-spin .9s linear infinite; }
    @keyframes wpd-spin { to { transform: rotate(360deg); } }

    .wpd__bar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 10px 16px 6px; }
    .wpd__save mat-spinner { display: inline-block; margin-right: 6px; }

    .wpd__rules { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 2px 16px 8px; font-size: 12px; }
    .wpd__rules-label { display: inline-flex; align-items: center; gap: 4px; color: var(--cc-text-3); cursor: help; }
    .wpd__rules-label .mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .wpd__chip { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 9px; border-radius: 999px;
      border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); background: transparent; color: var(--cc-text-1);
      font: inherit; font-size: 12px; cursor: pointer; }
    .wpd__chip:hover:not(:disabled) { background: color-mix(in srgb, var(--mat-sys-primary) 10%, transparent);
      border-color: color-mix(in srgb, var(--mat-sys-primary) 45%, transparent); }
    .wpd__chip:disabled { opacity: .5; cursor: default; }
    .wpd__chip code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
    .wpd__chip-target { font-size: 10.5px; font-weight: 700; letter-spacing: .04em; color: var(--cc-text-2); }

    .wpd__warn { display: flex; align-items: center; gap: 6px; margin: 0 16px 6px; padding: 6px 10px; border-radius: 8px; font-size: 12.5px;
      color: color-mix(in srgb, #d29922 80%, white); background: color-mix(in srgb, #d29922 10%, transparent); }
    .wpd__warn .mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .wpd__list { flex: 1 1 auto; min-height: 220px; max-height: 62vh; display: flex; flex-direction: column; padding: 0 16px; overflow: hidden; }
    .wpd__list app-github-pr-list { flex: 1 1 auto; min-height: 0; }

    .wpd__foot { display: flex; align-items: center; gap: 6px; padding: 8px 16px 10px; font-size: 11.5px; color: var(--cc-text-3);
      border-top: 1px solid var(--cc-surface-border, rgba(255,255,255,.08)); }
    .wpd__foot .mat-icon { flex: none; font-size: 15px; width: 15px; height: 15px; }

    @media (max-width: 639.98px) {
      .wpd__list { max-height: none; }
      .wpd__foot { display: none; }
    }
    @media (prefers-reduced-motion: reduce) { .wpd__spin { animation: none; } }
  `],
})
export class WorkbenchPrsDialogComponent {
  readonly store = inject(WorkbenchPrsStore);
  private dialog = inject(MatDialog);
  private injector = inject(Injector);
  private ref = inject(MatDialogRef<WorkbenchPrsDialogComponent>);
  private snackBar = inject(MatSnackBar);
  private teams = inject(TeamsService);

  readonly saving = signal(false);

  readonly countsLabel = computed(() => prCountsLabel(this.store.prs()));
  readonly canOpenPr = computed(() => !!this.store.card() && this.store.registerLoaded() && !this.store.registerLoading());
  private readonly isUs = computed(() => this.store.cardType() === 'user-story');

  /** Branch principal e branches por destino **do repositório em tratamento** (revamp-backend não tem QA). */
  readonly suggestions = computed<BranchSuggestion[]>(() => buildBranchSuggestions(this.store.rules(), this.store.targetOptions()));

  constructor() {
    void this.init();
    const timer = setInterval(() => this.watchOpenPrs(), PR_WATCH_INTERVAL_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  private async init(): Promise<void> {
    void this.store.loadConfig();
    void this.store.loadRules();
    if (!this.teams.status()) void this.teams.loadStatus();
    // Status no GitHub depois do registro (senão o persistido sobrescreveria o atual).
    await this.store.ready();
    if (this.store.prs().length) void this.store.refreshPrs(true);
  }

  refresh(): void {
    void this.store.refreshPrs(true, true);
  }

  /** Abre o modal "Abrir PR" (com `pr`, em modo edição — igual à tela de PR, inclusive o caso LEGACY). */
  async openPr(pr?: GithubPullRequest, suggestion?: BranchSuggestion): Promise<void> {
    const card = this.store.card();
    if (!card || !this.canOpenPr()) return;
    await this.store.loadConfig();

    const legacy = pr?.status === 'LEGACY' ? pr : null;
    if (legacy) pr = undefined;

    const latest = this.store.prs().find(p => p.status !== 'LEGACY') ?? null;
    const fallbackPrefix = this.isUs() ? 'feature/' : 'hotfix/';
    const fromRules = this.store.rules()?.mainBranch ? splitBranch(this.store.rules()!.mainBranch, fallbackPrefix) : null;
    const fromSuggestion = suggestion ? splitBranch(suggestion.branch, fallbackPrefix) : null;
    const branch = fromSuggestion
      ?? (legacy ? { prefix: legacy.branchPrefix, name: legacy.branchName } : null)
      ?? (latest ? { prefix: latest.branchPrefix, name: latest.branchName } : null)
      ?? fromRules
      ?? { prefix: fallbackPrefix, name: card };

    const repos = this.store.repositoryOptions();
    const defaultRepository = legacy?.repositoryId ?? this.store.lastRepository() ?? latest?.repositoryId
      ?? this.store.register()?.repositoryId ?? this.store.rules()?.repository ?? repos[0]?.value ?? null;
    // Destinos do fluxo do repositório (revamp-backend não tem QA); sem regra para ele, todos os destinos do plugin.
    const allowed = suggestion?.target ? null : defaultRepository ? await this.store.targetsForRepository(defaultRepository) : null;
    const all = this.store.targetOptions();
    const targets = allowed ? allowed.map(v => all.find(o => o.value === v) ?? { label: v, value: v }) : all;
    const data: OpenPrDialogData = {
      cardNumber: card,
      cardType: this.isUs() ? 'us' : 'bug',
      userId: this.store.userId,
      targetOptions: all,
      defaultTarget: suggestion?.target ?? defaultTarget(targets, this.store.lastTarget() ?? latest?.targetBranch),
      defaultPrefix: branch.prefix,
      defaultBranchName: branch.name,
      defaultRepository,
      repositoryFallback: repos,
      targetsForRepository: (repository) => this.store.targetsForRepository(repository),
      pr: pr ?? null,
    };

    // injector: o modal "Abrir PR" usa o CardPrStateService local da Bancada (não o da tela de PR).
    this.dialog.open(OpenPrDialogComponent, workbenchDialogSize('980px', { data, injector: this.injector }))
      .afterClosed().subscribe((result?: GithubPullRequest) => {
        if (result) this.store.remember(result);
        // Recarrega do banco: o PR aberto (ou editado) já está lá; o tempo real cobre as outras telas.
        void this.store.refreshPrs(false, false, true);
      });
  }

  openPrWith(s: BranchSuggestion): void {
    void this.openPr(undefined, s);
  }

  async saveContent(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    try {
      await this.store.saveContent();
      this.snackBar.open('Descrição/Root Cause salvos no card', 'Ok', { ...SNACK, duration: 4000 });
    } catch (e: any) {
      this.snackBar.open(e?.error?.error ?? 'Não foi possível salvar o card', 'Ok', { ...SNACK, duration: 8000 });
    } finally {
      this.saving.set(false);
    }
  }

  close(): void {
    this.ref.close();
  }

  /** Com o modal aberto e algum PR aberto, confere o status no GitHub sem skeleton (só troca a lista se mudou). */
  private watchOpenPrs(): void {
    if (document.hidden || this.store.prsLoading() || !this.store.prs().some(p => p.status === 'OPEN')) return;
    void this.store.refreshPrs(true, false, true);
  }
}
