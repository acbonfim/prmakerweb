import { Component, Signal, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DomSanitizer } from '@angular/platform-browser';

import { CardFull } from '../card-details-dialog/card-full.model';
import { MORPH_PANEL_CLASS, canMorphFrom, morphDialogFromOrigin } from '../../helpers/dialog-morph';
import { registerWorkItemTypeIcons, workItemTypeIcon, workItemTypeLabel } from '../../helpers/work-item-type-icons';
import { WorkbenchCardComponent } from './workbench-card.component';

/** Dados do modal do card — signals: o modal acompanha a Bancada (card recarregado, horas lançadas). */
export interface WorkbenchCardDialogData {
  card: string;
  cardType: Signal<string | null>;
  cardFull: Signal<CardFull | null>;
  /** Título do card (cabeçalho do modal). */
  title?: Signal<string>;
  /** Link do card no DevOps (botão do cabeçalho). */
  devOpsUrl?: Signal<string | null>;
  /** "Ver tudo" (campos, histórico, comentários) — a página abre o diálogo de detalhes por cima. */
  openDetails?: () => void;
}

/**
 * 0085 (rodada 5): o conteúdo da aba Card (`app-workbench-card`: horas, dados, contadores, texto do card) num modal
 * que cresce a partir do botão clicado e volta encolhendo para ele — a mesma animação da linha do tempo
 * (`helpers/dialog-morph.ts`, sobre o `ANIMATION` do `FullscreenPanel`). No celular ocupa a tela toda.
 */
@Component({
  selector: 'app-workbench-card-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule, WorkbenchCardComponent],
  template: `
    @let type = data.cardType();
    <div class="wcd" role="document">
      <header class="wcd__head">
        <mat-icon class="wcd__type" [svgIcon]="typeIcon(type)" [matTooltip]="typeLabel(type)" [attr.aria-label]="typeLabel(type)"></mat-icon>
        <span class="wcd__num">#{{ data.card }}</span>
        <h2 class="wcd__title" [matTooltip]="data.title?.() || ''" matTooltipShowDelay="600">{{ data.title?.() || 'Card' }}</h2>
        <span class="wcd__spacer"></span>
        @if (data.devOpsUrl?.(); as url) {
          <a mat-icon-button [href]="url" target="_blank" rel="noopener" matTooltip="Abrir no DevOps" aria-label="Abrir no DevOps">
            <mat-icon>open_in_new</mat-icon>
          </a>
        }
        <button mat-icon-button type="button" (click)="ref.close()" matTooltip="Fechar (Esc)" aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </header>
      <div class="wcd__body">
        <app-workbench-card [card]="data.card" [cardType]="type" [cardFull]="data.cardFull()"
                            (openDetails)="data.openDetails?.()"></app-workbench-card>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .wcd { display: flex; flex-direction: column; height: 100%; max-height: 90vh; min-height: 0;
      background: var(--surface-2, #1f242c); color: var(--cc-text-1); }
    .wcd__head { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 16px;
      border-bottom: 1px solid var(--cc-surface-border, rgba(255,255,255,.08)); }
    .wcd__type { flex: none; width: 18px; height: 18px; }
    .wcd__num { flex: none; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--cc-text-2); }
    .wcd__title { margin: 0; min-width: 0; font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wcd__spacer { flex: 1 1 auto; }
    .wcd__body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 12px 14px 16px; }
    @media (max-width: 640px) { .wcd { height: 100dvh; max-height: 100dvh; } .wcd__body { padding: 10px; } }
  `]
})
export class WorkbenchCardDialogComponent {
  readonly data = inject<WorkbenchCardDialogData>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<WorkbenchCardDialogComponent>);

  constructor() {
    registerWorkItemTypeIcons(inject(MatIconRegistry), inject(DomSanitizer));
  }

  typeIcon(type: string | null): string {
    return workItemTypeIcon(type);
  }

  typeLabel(type: string | null): string {
    return workItemTypeLabel(type);
  }
}

/**
 * Abre o card num modal a partir de `origin` (o botão "Card" da barra): cresce a partir dele e volta para ele ao
 * fechar (Esc, fundo ou o X). Um modal do mesmo card já aberto é reaproveitado.
 */
export function openWorkbenchCard(
  dialog: MatDialog, data: WorkbenchCardDialogData, origin?: HTMLElement | null
): MatDialogRef<WorkbenchCardDialogComponent> {
  const open = dialog.openDialogs.find((d) => d.componentInstance instanceof WorkbenchCardDialogComponent) as
    MatDialogRef<WorkbenchCardDialogComponent> | undefined;
  if (open && open.componentInstance.data.card === data.card) return open;
  const narrow = window.matchMedia('(max-width: 640px)').matches;
  const morph = canMorphFrom(origin) ? origin : null;
  const ref = dialog.open(WorkbenchCardDialogComponent, {
    data,
    width: narrow ? '100vw' : '1180px',
    maxWidth: narrow ? '100vw' : '94vw',
    height: narrow ? '100dvh' : undefined,
    maxHeight: narrow ? '100dvh' : '90vh',
    panelClass: ['plan-chat-panel', 'workbench-card-panel', ...(morph ? [MORPH_PANEL_CLASS] : [])],
    backdropClass: 'plan-chat-backdrop',
    autoFocus: false,
    restoreFocus: true,
    ...(morph ? { enterAnimationDuration: 0, exitAnimationDuration: 0 } : {})
  });
  if (morph) morphDialogFromOrigin(ref, morph);
  return ref;
}
