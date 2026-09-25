import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { marked } from 'marked';
import { MarkdownEditorComponent } from '../markdown-editor/markdown-editor.component';
import { DevOpsActionsService, apiErrorMessage } from '../../services/devops-actions.service';

export interface SummaryDialogData {
  cardNumber: string;
  title: string;
  /** Problema reportado (repro steps/descrição do card, sem HTML). */
  reproSteps: string;
  /** Descrição do PR (Markdown). */
  description: string;
  rootCause: string;
  /** Resumo já salvo (null = gerar ao abrir). */
  summary: string | null;
  /** Já publicado na discussion (salvar atualiza o mesmo comentário). */
  published: boolean;
  /** Prompt do admin (AI Configurations → BugSummaryPrompt). */
  prompt: string;
}

const SNACK = { direction: 'ltr', horizontalPosition: 'right', verticalPosition: 'top' } as const;

/**
 * Resumo não técnico (PT-BR + EN-US) do card para a discussion do DevOps (feature 0011). Sem resumo
 * salvo, gera com a IA ao abrir; com resumo salvo, mostra para ver/editar, gerar de novo ou salvar.
 * Salvar publica na discussion (cria ou atualiza o mesmo comentário) e grava no registro do card;
 * fecha devolvendo o registro salvo.
 */
@Component({
  selector: 'app-summary-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, MarkdownEditorComponent],
  template: `
    <div class="sd">
      <div class="sd__header">
        <mat-icon class="sd__lead">translate</mat-icon>
        <div class="sd__titles">
          <span class="sd__title">Resumo não técnico · #{{ data.cardNumber }}</span>
          <span class="sd__sub">{{ data.title || 'Resumo PT-BR + EN-US para a discussion do card' }}</span>
        </div>
        <button mat-icon-button class="ms-auto" (click)="close()" [disabled]="saving()" matTooltip="Fechar">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <div class="sd__body">
        @if (generating()) {
          <div class="sd__state">
            <mat-spinner diameter="36"></mat-spinner>
            <span>Gerando o resumo não técnico com IA…</span>
          </div>
        } @else {
          <app-markdown-editor [value]="text()" (valueChange)="text.set($event ?? '')"
                               placeholder="Resumo não técnico (PT-BR + EN-US)…"></app-markdown-editor>
        }
      </div>

      @if (confirmRegenerate()) {
        <div class="sd__confirm">
          <mat-icon>warning</mat-icon>
          <span>Gerar de novo substitui o texto atual (as edições não salvas serão perdidas).</span>
          <button mat-button (click)="confirmRegenerate.set(false)">Cancelar</button>
          <button mat-flat-button color="primary" (click)="confirmRegenerate.set(false); generate()">Gerar de novo</button>
        </div>
      }

      <div class="sd__actions">
        <span class="sd__status">
          @if (data.published) { <mat-icon>cloud_done</mat-icon> Publicado na discussion }
          @else { <mat-icon>cloud_off</mat-icon> Ainda não publicado }
          @if (dirty()) { · <em>alterações não salvas</em> }
        </span>
        <button mat-stroked-button (click)="askRegenerate()" [disabled]="generating() || saving()">
          <mat-icon>auto_awesome</mat-icon>{{ text().trim() ? 'Gerar novamente com IA' : 'Gerar com IA' }}
        </button>
        <button mat-flat-button color="primary" (click)="save()" [disabled]="!canSave()"
                [matTooltip]="data.published ? 'Atualiza o comentário já publicado na discussion' : 'Cria o comentário na discussion do card'">
          @if (saving()) { <mat-spinner diameter="16"></mat-spinner> } @else { <mat-icon>send</mat-icon> }
          {{ data.published ? 'Salvar e atualizar na discussion' : 'Salvar na discussion' }}
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
    .sd__body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding: 12px 16px; }
    .sd__body app-markdown-editor { flex: 1 1 auto; min-height: 0; }
    .sd__state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 80%, transparent); }
    .sd__confirm { display: flex; align-items: center; gap: 8px; padding: 8px 16px; font-size: 13px;
      background: color-mix(in srgb, #d29922 14%, transparent); }
    .sd__confirm mat-icon { color: #d29922; }
    .sd__confirm span { margin-right: auto; }
    .sd__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 12px 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.08); }
    .sd__status { display: inline-flex; align-items: center; gap: 4px; margin-right: auto; font-size: 12px; opacity: .75; }
    .sd__status mat-icon { font-size: 16px; width: 16px; height: 16px; }
  `],
})
export class SummaryDialogComponent implements OnInit {
  readonly data = inject<SummaryDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<SummaryDialogComponent>);
  private readonly service = inject(DevOpsActionsService);
  private readonly snackBar = inject(MatSnackBar);

  readonly text = signal('');
  /** Último texto salvo ou gerado (para saber se há edição pendente). */
  private readonly baseline = signal('');
  readonly generating = signal(false);
  readonly saving = signal(false);
  readonly confirmRegenerate = signal(false);

  readonly dirty = computed(() => this.text().trim() !== this.baseline().trim());
  readonly canSave = computed(() => !this.generating() && !this.saving() && this.text().trim().length >= 3);

  ngOnInit(): void {
    const saved = this.data.summary?.trim() ?? '';
    if (saved) {
      this.text.set(saved);
      this.baseline.set(saved);
    } else {
      void this.generate();
    }
  }

  askRegenerate(): void {
    // Sem edição pendente (texto recém-gerado/salvo ou vazio): gera direto.
    if (this.text().trim() && this.dirty()) this.confirmRegenerate.set(true);
    else void this.generate();
  }

  async generate(): Promise<void> {
    this.generating.set(true);
    try {
      const content = await this.service.generate(this.buildPrompt());
      this.text.set(content);
      // Texto recém-gerado ainda não foi salvo: diferente do salvo = pendente.
      this.baseline.set(this.data.summary?.trim() ?? '');
    } catch (e) {
      this.snackBar.open(apiErrorMessage(e, 'Não foi possível gerar o resumo com IA'), 'Ok', { ...SNACK, duration: 8000 });
    } finally {
      this.generating.set(false);
    }
  }

  async save(): Promise<void> {
    if (!this.canSave()) return;
    const summary = this.text().trim();
    marked.setOptions({ gfm: true, breaks: true });
    const html = marked.parse(summary) as string;

    this.saving.set(true);
    try {
      const saved = await this.service.saveSummary(this.data.cardNumber, summary, html);
      this.snackBar.open(this.data.published ? 'Resumo atualizado na discussion' : 'Resumo publicado na discussion',
        'Ok', { ...SNACK, duration: 5000 });
      this.dialogRef.close(saved);
    } catch (e) {
      this.saving.set(false);
      this.snackBar.open(apiErrorMessage(e, 'Não foi possível salvar o resumo'), 'Ok', { ...SNACK, duration: 8000 });
    }
  }

  close(): void {
    this.dialogRef.close();
  }

  private buildPrompt(): string {
    const values: Record<string, string> = {
      cardNumber: this.data.cardNumber,
      title: this.data.title || '—',
      reproSteps: this.data.reproSteps || '—',
      description: this.data.description || '—',
      rootCause: this.data.rootCause || '—',
    };
    return this.data.prompt.replace(/\{(cardNumber|title|reproSteps|description|rootCause)\}/g, (_, k: string) => values[k]);
  }
}
