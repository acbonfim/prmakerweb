import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, Injector, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { marked } from 'marked';
import { environment } from '../../../environments/environment';
import { CardDetailsDialogComponent } from '../card-details-dialog/card-details-dialog.component';
import { CardFull } from '../card-details-dialog/card-full.model';
import { DevOpsActionsMenuComponent } from '../devops-actions-menu/devops-actions-menu.component';
import { SummaryDialogComponent, SummaryDialogData } from '../summary-dialog/summary-dialog.component';
import { CardAssistantService } from '../../services/card-assistant.service';
import { CardPrStateService } from '../../services/card-pr-state.service';
import { TimelineService } from '../../services/timeline.service';
import { WorkbenchPrsDialogComponent, workbenchDialogSize } from './workbench-prs-dialog.component';
import { prCounts, prCountsLabel } from './workbench-prs.logic';
import { WorkbenchPrsStore } from './workbench-prs.store';

const SNACK = { horizontalPosition: 'right', verticalPosition: 'top' } as const;
const REPRO_FIELD = 'Microsoft.VSTS.TCM.ReproSteps';

/**
 * Botões "PRs (n)" e "Ações DevOps" da barra de ações do card na Bancada (feature 0085): o primeiro mostra quantos PRs o
 * card tem (bolinha verde quando há PR aberto) e abre o modal com a lista, **Abrir PR** e **Ações GitHub**; o segundo
 * (rodada 6) é o menu de automações do DevOps do **card** (mover estado, publicar o Root Cause, resumo, detalhes) — não
 * faz parte do modal de PRs. Os dois compartilham o estado do card (registro, RC, resumo).
 *
 * `providers`: o `WorkbenchPrsStore` e uma instância **local** do `CardPrStateService` (os componentes da tela de
 * PR reaproveitados aqui — `OpenPrDialogComponent`, `app-github-pr-list`/`app-pr-quick-actions` — injetam esse
 * serviço e passam a ver o estado da Bancada; o singleton da tela de PR não é tocado).
 */
@Component({
  selector: 'app-workbench-prs',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, DevOpsActionsMenuComponent],
  providers: [CardPrStateService, WorkbenchPrsStore],
  template: `
    @let c = counts();
    <button type="button" class="wbp" [disabled]="!card()" (click)="open()"
            [matTooltip]="tooltip()" aria-haspopup="dialog"
            [attr.aria-label]="'Pull requests do card: ' + countsText()">
      <mat-icon class="wbp__icon">merge</mat-icon>
      <span class="wbp__label">PRs</span>
      @if (loading()) {
        <span class="wbp__count wbp__count--busy" aria-hidden="true">…</span>
      } @else {
        <span class="wbp__count" [class.wbp__count--zero]="!c.total">{{ c.total }}</span>
      }
      @if (c.open) { <span class="wbp__dot" aria-hidden="true"></span> }
    </button>
    @if (card()) {
      <app-devops-actions-menu
              appearance="bar"
              [cardNumber]="card()"
              [cardFull]="store.cardFull()"
              [cardLoading]="store.cardLoading()"
              [hasRootCause]="hasRootCause()"
              [registerSaved]="!!store.register()?.id"
              [hasSummary]="!!store.register()?.summary"
              [rootCauseSaving]="rootCauseSaving()"
              (openDetails)="openCardDetails()"
              (saveRootCause)="saveRootCauseToDevOps()"
              (openSummary)="openSummary($event)"
              (changed)="onDevOpsChanged()"></app-devops-actions-menu>
    }
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; gap: 6px; }
    .wbp { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px 0 10px; border-radius: 8px;
      border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); background: transparent;
      color: var(--cc-text-1, var(--mat-sys-on-surface)); font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; position: relative; }
    .wbp:hover:not(:disabled) { background: var(--cc-surface-2, rgba(255,255,255,.06)); }
    .wbp:focus-visible { outline: 2px solid var(--mat-sys-primary); outline-offset: 2px; }
    .wbp:disabled { opacity: .5; cursor: default; }
    .wbp__icon { font-size: 17px; width: 17px; height: 17px; color: var(--cc-text-2); }
    .wbp__count { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums;
      background: color-mix(in srgb, var(--mat-sys-primary) 20%, transparent); color: var(--cc-text-1); }
    .wbp__count--zero { background: rgba(255,255,255,.08); color: var(--cc-text-3); }
    .wbp__count--busy { background: transparent; color: var(--cc-text-3); }
    .wbp__dot { width: 7px; height: 7px; border-radius: 50%; background: #3fb950; box-shadow: 0 0 0 2px color-mix(in srgb, #3fb950 25%, transparent); }
  `],
})
export class WorkbenchPrsComponent {
  /** Número do card da Bancada (null = nenhum). */
  readonly card = input<string | null>(null);
  /** Tipo do card (prefixo padrão da branch e Root Cause no "Abrir PR"). */
  readonly cardType = input<'bug' | 'user-story' | string | null>('bug');
  /** Card do DevOps já carregado pela Bancada (opcional — evita buscar de novo para as Ações DevOps). */
  readonly cardFull = input<CardFull | null | undefined>(undefined);

  /** Quantidade de PRs do card (todos os status). */
  readonly countChange = output<number>();
  /** Uma ação do DevOps (ou o RC salvo no DevOps) alterou o card — a Bancada pode recarregar o card. */
  readonly devopsChanged = output<void>();

  readonly store = inject(WorkbenchPrsStore);
  private dialog = inject(MatDialog);
  private http = inject(HttpClient);
  private snackBar = inject(MatSnackBar);
  private timeline = inject(TimelineService);
  private assistant = inject(CardAssistantService);
  private injector = inject(Injector);
  private ref: MatDialogRef<WorkbenchPrsDialogComponent> | null = null;

  readonly counts = computed(() => prCounts(this.store.prs()));
  readonly rootCauseSaving = signal(false);
  readonly hasRootCause = computed(() => !!this.store.pr.rootCause()?.trim());
  readonly countsText = computed(() => prCountsLabel(this.store.prs()));
  readonly loading = computed(() => !this.store.registerLoaded() && !!this.store.card());
  readonly tooltip = computed(() => this.card()
    ? `Pull requests do card (${this.countsText()}) — ver, abrir PR e ações do GitHub`
    : 'Busque um card para ver os PRs');

  constructor() {
    effect(() => {
      const card = this.card();
      untracked(() => this.store.setCard(card));
    });
    effect(() => {
      const type = this.cardType();
      untracked(() => this.store.cardType.set(type === 'user-story' ? 'user-story' : 'bug'));
    });
    effect(() => {
      const full = this.cardFull();
      const card = this.store.card();
      untracked(() => { if (full && card) this.store.useCardFull(full); });
    });
    let last = -1;
    effect(() => {
      const total = this.store.registerLoaded() ? this.counts().total : 0;
      untracked(() => { if (total !== last) { last = total; this.countChange.emit(total); } });
    });

    const sub = this.store.devopsChanged$.subscribe(() => this.devopsChanged.emit());
    inject(DestroyRef).onDestroy(() => {
      sub.unsubscribe();
      this.ref?.close();
    });
  }

  openCardDetails(): void {
    const card = this.store.cardFull();
    if (!card) return;
    this.dialog.open(CardDetailsDialogComponent, workbenchDialogSize('1000px', {
      data: { card, cardNumber: this.store.card() }, height: '80vh',
    }));
  }

  /** "Salvar RC no DevOps": o Root Cause (Markdown) vira HTML — o mesmo da tela de PR. */
  async saveRootCauseToDevOps(): Promise<void> {
    const card = this.store.card();
    const markdown = this.store.pr.rootCause() ?? '';
    if (!card || !markdown.trim() || this.rootCauseSaving()) return;
    this.rootCauseSaving.set(true);
    try {
      marked.setOptions({ gfm: true, breaks: true });
      const html = marked.parse(markdown) as string;
      await firstValueFrom(this.http.post(`${environment.apiUrl}Azure/card/${encodeURIComponent(card)}/rootcause`, { rootCause: html }));
      this.snackBar.open('RCA salvo no DevOps', 'Ok', { ...SNACK, duration: 4000 });
      this.onDevOpsChanged();
    } catch {
      this.snackBar.open('Erro ao tentar salvar o RCA no DevOps', 'Ok', { ...SNACK, duration: 8000 });
    } finally {
      this.rootCauseSaving.set(false);
    }
  }

  /** Resumo não técnico (0011): o mesmo modal da tela de PR, com a timeline do card no contexto. */
  async openSummary(prompt: string): Promise<void> {
    const card = this.store.card();
    const full = this.store.cardFull();
    if (!card || !full) return;
    const timeline = await firstValueFrom(this.timeline.getByCardNumber(card)).catch(() => []);
    const reg = this.store.register();
    const data: SummaryDialogData = {
      cardNumber: card,
      card: full,
      reproField: REPRO_FIELD,
      description: this.store.pr.description() ?? reg?.description ?? '',
      rootCause: this.store.pr.rootCause() ?? reg?.rootCause ?? '',
      summary: reg?.summary ?? null,
      summaryUpdatedAt: reg?.summaryUpdatedAt ?? null,
      summaryPublishedAt: reg?.summaryPublishedAt ?? null,
      published: !!reg?.summaryCommentId,
      timeline: timeline ?? [],
      githubPrs: this.store.prs(),
      prompt,
    };
    this.dialog.open(SummaryDialogComponent, workbenchDialogSize('1000px', { data, height: '86vh' }))
      .afterClosed().subscribe(saved => { if (saved) void this.store.reloadRegisterQuiet(); });
  }

  /** Uma ação do DevOps mudou o card: recarrega o card (pendências), as horas e avisa a Bancada. */
  onDevOpsChanged(): void {
    void this.store.loadCardFull(true);
    const card = this.store.card();
    if (card) void this.assistant.loadEffort(card).catch(() => undefined);
    this.store.devopsChanged$.next();
  }

  /** Abre o modal dos PRs (o injector leva o estado local para o modal e para o "Abrir PR"). */
  open(): void {
    if (!this.card() || this.ref) return;
    this.ref = this.dialog.open(WorkbenchPrsDialogComponent, workbenchDialogSize('1040px', {
      injector: this.injector,
      autoFocus: false,
      ariaLabel: 'Pull requests do card',
    }));
    this.ref.afterClosed().subscribe(() => { this.ref = null; });
  }
}
