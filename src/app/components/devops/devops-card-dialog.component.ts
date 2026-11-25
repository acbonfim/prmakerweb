import { Component, DestroyRef, inject, viewChild } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { CardPanelContext, CardTab, DevOpsCardPanelComponent } from './devops-card-panel.component';
import { CardDetail } from './devops.model';

/** Tamanho do modal do card (Mesa e Bancada): largo como o formulário do DevOps; tela cheia até 900 px (`styles.scss`). */
export const DEVOPS_CARD_DIALOG = {
  width: 'min(1560px, 96vw)',
  maxWidth: '96vw',
  height: 'min(1000px, 94vh)',
  panelClass: 'dk-card-dialog',
  autoFocus: false,
  restoreFocus: true,
  // Fechar passa pelo painel (pergunta se há alteração não salva).
  disableClose: true,
} as const;

export interface DevOpsCardDialogData {
  cardId: string | number;
  context?: CardPanelContext;
  epic?: number | null;
  team?: string | null;
  board?: string | null;
  initialTab?: CardTab | null;
  /** Card gravado (salvar, mover, comentar) — a página relê o que mostra. */
  onSaved?: (card: CardDetail) => void;
}

/**
 * Esc do modal do card: um combo/menu que já tratou a tecla ganha; com o foco num campo, só sai do campo; senão fecha
 * (o painel pergunta se há alteração não salva).
 */
export function cardDialogEscape(event: KeyboardEvent, panel: DevOpsCardPanelComponent | undefined | null): void {
  if (!panel || event.defaultPrevented) return;
  const t = event.target as HTMLElement | null;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) { t.blur(); return; }
  panel.close();
}

/**
 * Modal único do card do DevOps fora da Mesa (Bancada → aba Card → "Ver tudo"): o mesmo `app-devops-card-panel` da Mesa, em
 * `context="workbench"` (sem "Abrir na Bancada" e "Adicionar ao épico"; o board vem do próprio card).
 */
@Component({
  selector: 'app-devops-card-dialog',
  standalone: true,
  imports: [DevOpsCardPanelComponent],
  template: `
    <div class="dvcd" role="dialog" aria-modal="true" [attr.aria-label]="'Card ' + data.cardId">
      <app-devops-card-panel [cardId]="data.cardId" [context]="data.context ?? 'workbench'" [epic]="data.epic ?? null"
                             [team]="data.team ?? null" [board]="data.board ?? null" [initialTab]="data.initialTab ?? null"
                             (saved)="data.onSaved?.($event)" (closed)="ref.close()" />
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .dvcd { height: 100%; width: 100%; display: flex; flex-direction: column; min-height: 0; }
  `]
})
export class DevOpsCardDialogComponent {
  readonly data = inject<DevOpsCardDialogData>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<DevOpsCardDialogComponent>);
  private readonly panel = viewChild(DevOpsCardPanelComponent);

  constructor() {
    const subs = [
      this.ref.backdropClick().subscribe(() => this.panel()?.close()),
      this.ref.keydownEvents().subscribe((e) => { if (e.key === 'Escape') cardDialogEscape(e, this.panel()); }),
    ];
    inject(DestroyRef).onDestroy(() => subs.forEach((s) => s.unsubscribe()));
  }
}

/** Abre o modal do card (um por vez: o que já está aberto fecha antes). */
export function openDevOpsCardDialog(dialog: MatDialog, data: DevOpsCardDialogData): MatDialogRef<DevOpsCardDialogComponent> {
  dialog.openDialogs.filter((d) => d.componentInstance instanceof DevOpsCardDialogComponent).forEach((d) => d.close());
  return dialog.open(DevOpsCardDialogComponent, { ...DEVOPS_CARD_DIALOG, data });
}
