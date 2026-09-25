import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { marked } from 'marked';
import { MarkdownEditorComponent } from '../markdown-editor/markdown-editor.component';
import { CardFull } from '../card-details-dialog/card-full.model';
import { TimelineEntry } from '../card-timeline/timeline.model';
import { DevOpsActionsService, apiErrorMessage } from '../../services/devops-actions.service';
import { GithubPullRequest } from '../../services/pull-request.service';
import { CliipboardService } from '../../services/cliipboard.service';
import { getCommitSha, getCommitTitle } from '../../helpers/commit';
import {
  SummaryContextInput, buildSummaryContextSections, buildSummaryPrompt, solutionEvidence,
} from '../../helpers/summary-context';

export interface SummaryDialogData {
  cardNumber: string;
  card: CardFull;
  /** Campo de repro steps do plugin do DevOps. */
  reproField: string;
  /** Descrição e root cause atuais da tela (Markdown). */
  description: string;
  rootCause: string;
  summary: string | null;
  summaryUpdatedAt: string | null;
  summaryPublishedAt: string | null;
  /** Já existe comentário na discussion (publicar atualiza o mesmo). */
  published: boolean;
  timeline: TimelineEntry[];
  githubPrs: GithubPullRequest[];
  /** Modelo do admin (AI Configurations → BugSummaryPrompt). */
  prompt: string;
}

/** Commit de uma branch dos PRs do card, que pode entrar no contexto da IA. */
interface CommitRow {
  repository: string;
  branch: string;
  commit: any;
  sha: string;
  title: string;
  /** Título cita o número do card. */
  related: boolean;
  selected: boolean;
  diff: any;
  loading: boolean;
  error: boolean;
}

const SNACK = { direction: 'ltr', horizontalPosition: 'right', verticalPosition: 'top' } as const;
/** Sem commit citando o card no repositório: sugere (desmarcados) os do topo até o primeiro merge. */
const FALLBACK_COMMITS = 5;

/**
 * Resumo não técnico (PT-BR + EN-US) do card (feature 0011).
 * - Aba "Resumo": ver o resumo salvo, editar, gerar (de novo) com IA, **salvar** no PRMake e
 *   **publicar** na discussion (cria ou atualiza o mesmo comentário).
 * - Aba "Contexto enviado à IA": tudo o que vai no prompt (card, discussion, timeline, PRs, descrição,
 *   root cause, diffs dos commits escolhidos) e o prompt final. Sem evidência de solução, o prompt
 *   proíbe dizer que o problema foi corrigido.
 * Fecha devolvendo o último registro salvo (ou nada).
 */
@Component({
  selector: 'app-summary-dialog',
  standalone: true,
  imports: [DatePipe, MatDialogModule, MatButtonModule, MatCheckboxModule, MatIconModule, MatProgressSpinnerModule,
    MatTabsModule, MatTooltipModule, MarkdownEditorComponent],
  template: `
    <div class="sd">
      <div class="sd__header">
        <mat-icon class="sd__lead">translate</mat-icon>
        <div class="sd__titles">
          <span class="sd__title">Resumo não técnico · #{{ data.cardNumber }}</span>
          <span class="sd__sub">{{ cardTitle || 'Resumo PT-BR + EN-US para a discussion do card' }}</span>
        </div>
        <button mat-icon-button class="ms-auto" (click)="close()" [disabled]="busy()" matTooltip="Fechar">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <mat-tab-group class="sd__tabs" [selectedIndex]="tab()" (selectedIndexChange)="tab.set($event)" animationDuration="0ms">
        <!-- ===== Resumo ===== -->
        <mat-tab>
          <ng-template mat-tab-label><mat-icon class="sd__tab-icon">article</mat-icon>Resumo</ng-template>
          <div class="sd__pane">
            @if (generating()) {
              <div class="sd__state">
                <mat-spinner diameter="36"></mat-spinner>
                <span>Gerando o resumo não técnico com IA…</span>
              </div>
            } @else if (!text().trim() && mode() === 'view') {
              <div class="sd__state">
                <mat-icon class="sd__empty-icon">translate</mat-icon>
                <span>Ainda não há resumo para este card.</span>
                <span class="sd__hint">Confira o contexto e gere com IA, ou escreva o seu.</span>
                <div class="sd__row">
                  <button mat-stroked-button (click)="tab.set(1)"><mat-icon>fact_check</mat-icon>Ver contexto</button>
                  <button mat-stroked-button (click)="mode.set('edit')"><mat-icon>edit</mat-icon>Escrever</button>
                  <button mat-flat-button color="primary" (click)="generate()" [disabled]="contextLoading()">
                    <mat-icon>auto_awesome</mat-icon>Gerar com IA
                  </button>
                </div>
              </div>
            } @else if (mode() === 'view') {
              <div class="sd__view markdown-body" [innerHTML]="html()"></div>
            } @else {
              <app-markdown-editor [value]="text()" (valueChange)="text.set($event ?? '')"
                                   placeholder="Resumo não técnico (PT-BR + EN-US)…"></app-markdown-editor>
            }
          </div>
        </mat-tab>

        <!-- ===== Contexto ===== -->
        <mat-tab>
          <ng-template mat-tab-label><mat-icon class="sd__tab-icon">fact_check</mat-icon>Contexto enviado à IA</ng-template>
          <div class="sd__pane sd__pane--scroll">
            @if (evidence().length) {
              <div class="sd__banner sd__banner--ok">
                <mat-icon>check_circle</mat-icon>
                <span>Evidência de solução: {{ evidence().join(', ') }}.</span>
              </div>
            } @else {
              <div class="sd__banner sd__banner--warn">
                <mat-icon>warning</mat-icon>
                <span>Sem evidência de solução (nenhum PR, descrição, root cause ou alteração de código). O resumo vai
                  descrever só o problema, como <strong>em análise</strong> — a IA é instruída a não dizer que foi corrigido.</span>
              </div>
            }

            <details class="sd__section" open>
              <summary>Alterações de código · {{ selectedDiffCount() }} de {{ commits().length }} commit(s) incluído(s)</summary>
              @if (commitsLoading()) {
                <div class="sd__muted"><mat-spinner diameter="16"></mat-spinner> Carregando os commits das branches dos PRs…</div>
              } @else if (commitsError()) {
                <div class="sd__muted sd__error"><mat-icon>error_outline</mat-icon>{{ commitsError() }}</div>
              } @else if (commits().length === 0) {
                <div class="sd__muted">Nenhum PR no card: não há commits para incluir.</div>
              } @else {
                <div class="sd__commits">
                  @for (row of commits(); track row.repository + row.sha) {
                    <div class="sd__commit">
                      <mat-checkbox color="primary" [checked]="row.selected" (change)="toggleCommit(row, $event.checked)"
                                    [disabled]="busy()">
                        <span class="sd__commit-title">{{ row.title }}</span>
                      </mat-checkbox>
                      <span class="sd__commit-meta">
                        {{ row.repository }} · {{ row.branch }} · {{ row.sha.substring(0, 8) }}
                        @if (!row.related) { · <em>não cita o card</em> }
                        @if (row.loading) { · carregando diff… }
                        @if (row.error) { · <span class="sd__error">erro ao carregar o diff</span> }
                      </span>
                    </div>
                  }
                </div>
              }
            </details>

            @for (section of sections(); track section.title; let i = $index) {
              <details class="sd__section" [open]="i < 2">
                <summary>{{ section.title }}</summary>
                <pre class="sd__pre">{{ section.body }}</pre>
              </details>
            }

            <details class="sd__section">
              <summary>Prompt final (exatamente o que vai para a IA · {{ prompt().length }} caracteres)</summary>
              <div class="sd__row sd__row--end">
                <button mat-stroked-button (click)="copyPrompt()"><mat-icon>content_copy</mat-icon>Copiar prompt</button>
              </div>
              <pre class="sd__pre">{{ prompt() }}</pre>
            </details>
          </div>
        </mat-tab>
      </mat-tab-group>

      @if (confirmRegenerate()) {
        <div class="sd__confirm">
          <mat-icon>warning</mat-icon>
          <span>Gerar de novo substitui o texto atual (as alterações não salvas serão perdidas).</span>
          <button mat-button (click)="confirmRegenerate.set(false)">Cancelar</button>
          <button mat-flat-button color="primary" (click)="confirmRegenerate.set(false); generate()">Gerar de novo</button>
        </div>
      }

      <div class="sd__actions">
        <span class="sd__status">
          @if (dirty()) {
            <mat-icon>edit_note</mat-icon> Alterações não salvas
          } @else if (!savedAt()) {
            <mat-icon>cloud_off</mat-icon> Não salvo
          } @else {
            <mat-icon>save</mat-icon> Salvo {{ savedAt() | date: 'dd/MM HH:mm' }}
            @if (publishedUpToDate()) {
              · <mat-icon>cloud_done</mat-icon> Publicado {{ publishedAt() | date: 'dd/MM HH:mm' }}
            } @else if (publishedAt()) {
              · <mat-icon>cloud_sync</mat-icon> Publicado {{ publishedAt() | date: 'dd/MM HH:mm' }} (desatualizado)
            } @else {
              · <mat-icon>cloud_off</mat-icon> Não publicado
            }
          }
        </span>

        @if (tab() === 0 && text().trim()) {
          @if (mode() === 'view') {
            <button mat-stroked-button (click)="mode.set('edit')" [disabled]="busy()"><mat-icon>edit</mat-icon>Editar</button>
          } @else {
            <button mat-stroked-button (click)="mode.set('view')" [disabled]="busy()"><mat-icon>visibility</mat-icon>Visualizar</button>
          }
        }
        <button mat-stroked-button (click)="askRegenerate()" [disabled]="busy() || contextLoading()"
                [matTooltip]="contextLoading() ? 'Aguarde o carregamento dos commits e diffs' : 'Gera com o contexto da aba Contexto enviado à IA'">
          <mat-icon>auto_awesome</mat-icon>{{ text().trim() ? 'Gerar novamente' : 'Gerar com IA' }}
        </button>
        <button mat-stroked-button (click)="save(false)" [disabled]="!canSave()" matTooltip="Grava no PRMake, sem publicar na discussion">
          @if (saving() === 'save') { <mat-spinner diameter="16"></mat-spinner> } @else { <mat-icon>save</mat-icon> }
          Salvar
        </button>
        <button mat-flat-button color="primary" (click)="save(true)" [disabled]="!canPublish()"
                [matTooltip]="publishTooltip()">
          @if (saving() === 'publish') { <mat-spinner diameter="16"></mat-spinner> } @else { <mat-icon>send</mat-icon> }
          {{ data.published || publishedAt() ? 'Atualizar na discussion' : 'Publicar na discussion' }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .sd { display: flex; flex-direction: column; height: 100%; min-height: 0;
      background-color: var(--surface-input, #1f1f1f); color: var(--mat-sys-on-surface); }
    .sd__header { display: flex; align-items: center; gap: 10px; padding: 12px 16px;
      background-color: var(--surface-3, #252525); border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
    .sd__lead { color: var(--mat-sys-primary); }
    .sd__titles { display: flex; flex-direction: column; min-width: 0; }
    .sd__title { font-size: 16px; font-weight: 600; }
    .sd__sub { font-size: 12px; opacity: .7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .sd__tabs { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
    .sd__tabs ::ng-deep .mat-mdc-tab-body-wrapper { flex: 1 1 auto; min-height: 0; }
    .sd__tabs ::ng-deep .mat-mdc-tab-body-content { height: 100%; overflow: hidden; }
    .sd__tab-icon { font-size: 18px; width: 18px; height: 18px; margin-right: 6px; }
    .sd__pane { height: 100%; min-height: 0; display: flex; flex-direction: column; padding: 12px 16px; box-sizing: border-box; }
    .sd__pane--scroll { overflow-y: auto; display: block; }
    .sd__pane app-markdown-editor { flex: 1 1 auto; min-height: 0; }
    .sd__view { flex: 1 1 auto; overflow-y: auto; padding: 4px 6px; line-height: 1.55; }

    .sd__state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 80%, transparent); }
    .sd__empty-icon { font-size: 40px; width: 40px; height: 40px; opacity: .6; }
    .sd__hint { font-size: 12px; opacity: .7; }
    .sd__row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 6px; }
    .sd__row--end { justify-content: flex-end; margin: 4px 0 6px; }

    .sd__banner { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: 8px;
      margin-bottom: 10px; font-size: 13px; }
    .sd__banner mat-icon { flex: none; }
    .sd__banner--ok { background: color-mix(in srgb, #2ea043 14%, transparent); }
    .sd__banner--ok mat-icon { color: #2ea043; }
    .sd__banner--warn { background: color-mix(in srgb, #d29922 16%, transparent); }
    .sd__banner--warn mat-icon { color: #d29922; }

    .sd__section { border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; margin-bottom: 8px; padding: 0 12px; }
    .sd__section > summary { cursor: pointer; padding: 10px 0; font-weight: 600; font-size: 13px; }
    .sd__pre { white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.5; margin: 0 0 12px;
      max-height: 360px; overflow-y: auto; font-family: Consolas, Menlo, monospace; opacity: .9; }
    .sd__muted { display: flex; align-items: center; gap: 8px; font-size: 12px; opacity: .75; padding-bottom: 12px; }
    .sd__error { color: #f85149; }
    .sd__commits { display: flex; flex-direction: column; gap: 2px; padding-bottom: 10px; }
    .sd__commit { display: flex; flex-direction: column; }
    .sd__commit-title { font-size: 13px; }
    .sd__commit-meta { font-size: 11px; opacity: .65; margin-left: 40px; margin-top: -6px; }

    .sd__confirm { display: flex; align-items: center; gap: 8px; padding: 8px 16px; font-size: 13px;
      background: color-mix(in srgb, #d29922 14%, transparent); }
    .sd__confirm mat-icon { color: #d29922; }
    .sd__confirm span { margin-right: auto; }
    .sd__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 12px 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.08); }
    .sd__status { display: inline-flex; align-items: center; gap: 4px; margin-right: auto; font-size: 12px; opacity: .8; }
    .sd__status mat-icon { font-size: 16px; width: 16px; height: 16px; }
  `],
})
export class SummaryDialogComponent implements OnInit {
  readonly data = inject<SummaryDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<SummaryDialogComponent>);
  private readonly service = inject(DevOpsActionsService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly clipboard = inject(CliipboardService);

  readonly cardTitle = (this.data.card?.fields?.['System.Title'] ?? '') as string;

  /** 0 = Resumo, 1 = Contexto. */
  readonly tab = signal(0);
  readonly mode = signal<'view' | 'edit'>('view');
  readonly text = signal('');
  /** Texto salvo no PRMake (base para "alterações não salvas"). */
  private readonly savedText = signal('');
  readonly savedAt = signal<string | null>(null);
  readonly publishedAt = signal<string | null>(null);
  readonly generating = signal(false);
  readonly saving = signal<'save' | 'publish' | null>(null);
  readonly confirmRegenerate = signal(false);
  /** Último registro salvo nesta abertura (devolvido ao fechar). */
  private lastSaved: any = null;

  readonly commits = signal<CommitRow[]>([]);
  readonly commitsLoading = signal(false);
  readonly commitsError = signal<string | null>(null);

  readonly busy = computed(() => this.generating() || this.saving() !== null);
  /** Commits ou diffs ainda carregando: gerar agora mandaria um contexto incompleto. */
  readonly contextLoading = computed(() => this.commitsLoading() || this.commits().some(r => r.loading));
  readonly dirty = computed(() => this.text().trim() !== this.savedText().trim());
  readonly html = computed(() => marked.parse(this.text(), { gfm: true, breaks: true }) as string);
  readonly canSave = computed(() => !this.busy() && this.text().trim().length >= 3 && this.dirty());
  /** Publicação reflete o texto salvo (salvo depois de publicado = desatualizado). */
  readonly publishedUpToDate = computed(() => {
    const pub = this.publishedAt(), saved = this.savedAt();
    return !!pub && (!saved || new Date(pub).getTime() >= new Date(saved).getTime() - 1000);
  });
  readonly canPublish = computed(() =>
    !this.busy() && this.text().trim().length >= 3 && (this.dirty() || !this.publishedUpToDate()));
  readonly publishTooltip = computed(() => {
    if (!this.dirty() && this.publishedUpToDate()) return 'Este texto já está publicado na discussion';
    return this.data.published || this.publishedAt()
      ? 'Salva e atualiza o comentário já publicado na discussion'
      : 'Salva e cria o comentário na discussion do card';
  });

  private readonly contextInput = computed<SummaryContextInput>(() => ({
    cardNumber: this.data.cardNumber,
    card: this.data.card,
    reproField: this.data.reproField,
    description: this.data.description ?? '',
    rootCause: this.data.rootCause ?? '',
    timeline: this.data.timeline ?? [],
    githubPrs: this.data.githubPrs ?? [],
    diffs: this.commits()
      .filter(r => r.selected && r.diff)
      .map(r => ({ repository: r.repository, branch: r.branch, commit: r.commit, diff: r.diff })),
  }));
  readonly sections = computed(() => buildSummaryContextSections(this.contextInput())
    .filter(s => !s.title.startsWith('Alterações de código')));
  readonly evidence = computed(() => solutionEvidence(this.contextInput()));
  readonly prompt = computed(() => buildSummaryPrompt(this.data.prompt, this.contextInput()));
  readonly selectedDiffCount = computed(() => this.commits().filter(r => r.selected && r.diff).length);

  ngOnInit(): void {
    const saved = this.data.summary?.trim() ?? '';
    this.text.set(saved);
    this.savedText.set(saved);
    this.savedAt.set(saved ? (this.data.summaryUpdatedAt ?? this.data.summaryPublishedAt) : null);
    this.publishedAt.set(this.data.summaryPublishedAt ?? (this.data.published && saved ? this.data.summaryUpdatedAt : null));
    // Sem resumo: abre no contexto, para conferir o que vai para a IA antes de gerar.
    if (!saved) this.tab.set(1);
    void this.loadCommits();
  }

  askRegenerate(): void {
    if (this.text().trim() && this.dirty()) this.confirmRegenerate.set(true);
    else void this.generate();
  }

  async generate(): Promise<void> {
    this.tab.set(0);
    this.generating.set(true);
    try {
      const content = await this.service.generate(this.prompt());
      this.text.set(content);
      this.mode.set('view');
    } catch (e) {
      this.snackBar.open(apiErrorMessage(e, 'Não foi possível gerar o resumo com IA'), 'Ok', { ...SNACK, duration: 8000 });
    } finally {
      this.generating.set(false);
    }
  }

  /** Salva no PRMake; com `publish`, publica também na discussion (cria ou atualiza o comentário). */
  async save(publish: boolean): Promise<void> {
    if (publish ? !this.canPublish() : !this.canSave()) return;
    const summary = this.text().trim();
    const html = publish ? (marked.parse(summary, { gfm: true, breaks: true }) as string) : undefined;

    this.saving.set(publish ? 'publish' : 'save');
    try {
      const saved = await this.service.saveSummary(this.data.cardNumber, summary, publish, html);
      this.lastSaved = saved;
      this.savedText.set(saved?.summary ?? summary);
      this.text.set(saved?.summary ?? summary);
      this.savedAt.set(saved?.summaryUpdatedAt ?? new Date().toISOString());
      this.publishedAt.set(saved?.summaryPublishedAt ?? this.publishedAt());
      this.mode.set('view');
      this.snackBar.open(publish ? 'Resumo salvo e publicado na discussion' : 'Resumo salvo no PRMake',
        'Ok', { ...SNACK, duration: 5000 });
    } catch (e) {
      this.snackBar.open(apiErrorMessage(e, publish ? 'Não foi possível publicar o resumo' : 'Não foi possível salvar o resumo'),
        'Ok', { ...SNACK, duration: 8000 });
    } finally {
      this.saving.set(null);
    }
  }

  toggleCommit(row: CommitRow, selected: boolean): void {
    this.updateRow(row, { selected });
    if (selected && !row.diff && !row.loading) void this.loadDiff(row);
  }

  copyPrompt(): void {
    this.clipboard.copyFullDescriptionToClipboard(this.prompt());
  }

  close(): void {
    this.dialogRef.close(this.lastSaved);
  }

  /**
   * Commits das branches dos PRs do card (um repositório = a branch do PR mais recente). Entram
   * marcados os que citam o card no título; sem nenhum, sugere os do topo até o primeiro merge.
   */
  private async loadCommits(): Promise<void> {
    const repos = new Map<string, string>();
    for (const pr of this.data.githubPrs ?? []) {
      if (!repos.has(pr.repositoryId)) repos.set(pr.repositoryId, `${pr.branchPrefix}${pr.branchName}`);
    }
    if (repos.size === 0) return;

    this.commitsLoading.set(true);
    const card = this.data.cardNumber.trim();
    const rows: CommitRow[] = [];
    const failed: string[] = [];

    await Promise.all([...repos].map(async ([repository, branch]) => {
      try {
        const commits = (await this.service.getCommits(repository, branch)) ?? [];
        const toRow = (c: any, related: boolean): CommitRow => ({
          repository, branch, commit: c, sha: getCommitSha(c), title: getCommitTitle(c),
          related, selected: related, diff: null, loading: false, error: false,
        });
        const related = commits.filter(c => getCommitTitle(c).includes(card));
        if (related.length) {
          rows.push(...related.map(c => toRow(c, true)));
        } else {
          const top: any[] = [];
          for (const c of commits) {
            if (/^Merge/i.test(getCommitTitle(c)) || top.length >= FALLBACK_COMMITS) break;
            top.push(c);
          }
          rows.push(...top.map(c => toRow(c, false)));
        }
      } catch {
        failed.push(repository);
      }
    }));

    this.commits.set(rows);
    this.commitsLoading.set(false);
    if (failed.length) this.commitsError.set(`Não foi possível carregar os commits de: ${failed.join(', ')}`);
    await Promise.all(rows.filter(r => r.selected).map(r => this.loadDiff(r)));
  }

  private async loadDiff(row: CommitRow): Promise<void> {
    this.updateRow(row, { loading: true, error: false });
    try {
      const diff = await this.service.getCommitDiff(row.repository, row.sha);
      this.updateRow(row, { diff, loading: false });
    } catch {
      this.updateRow(row, { loading: false, error: true, selected: false });
    }
  }

  private updateRow(row: CommitRow, patch: Partial<CommitRow>): void {
    this.commits.update(list => list.map(r =>
      r.repository === row.repository && r.sha === row.sha ? { ...r, ...patch } : r));
  }
}
