import { Component, ViewEncapsulation, computed, inject, input, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { CodeRefPopoverComponent, CodeRefTab } from './code-ref-popover.component';
import { CodeRefTarget } from './code-ref.model';
import { parseRefHref } from '../../helpers/markdown-ext';

/** Quantas fotografias aparecem abertas antes do "Mostrar mais". */
const VISIBLE = 3;

/** Ids das fotografias citadas num markdown (`[texto](ref:<id>)`), na ordem e sem repetir. */
export function codeRefIds(text: string | null | undefined): string[] {
  const ids: string[] = [];
  for (const m of (text ?? '').matchAll(/\]\(\s*(ref:[^)\s]+)/gi)) {
    const id = parseRefHref(m[1]);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Card 78505: o código citado no resultado de uma sub-tarefa, já aberto (a fotografia de cada `ref:`), sem precisar
 * clicar no link. As primeiras {@link VISIBLE} ficam à mostra; "Expandir" abre a fotografia em tela grande.
 */
@Component({
  selector: 'app-code-snapshots',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, CodeRefPopoverComponent],
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (targets().length) {
      <div class="csn">
        <h5 class="csn__title"><span class="material-icons">code</span>Código citado ({{ targets().length }})</h5>
        @for (t of shown(); track t.id) {
          <app-code-ref-popover [card]="card()" [target]="t" mode="inline" (expand)="open(t, $event)" />
        }
        @if (targets().length > shown().length) {
          <button mat-stroked-button type="button" class="csn__more" (click)="all.set(true)">
            <mat-icon>expand_more</mat-icon>Mostrar mais {{ targets().length - shown().length }}
          </button>
        }
      </div>
    }
  `,
  styles: [`
    .csn { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
    .csn__title { display: flex; align-items: center; gap: 6px; margin: 0; font: var(--mat-sys-title-small); opacity: .8; }
    .csn__title .material-icons { font-size: 18px; }
    .csn__more { align-self: flex-start; }
  `],
})
export class CodeSnapshotsComponent {
  private dialog = inject(MatDialog);

  readonly card = input<string | null>(null);
  readonly text = input<string | null | undefined>(null);

  readonly all = signal(false);
  readonly targets = computed<Array<CodeRefTarget & { kind: 'ref' }>>(() =>
    codeRefIds(this.text()).map(id => ({ kind: 'ref' as const, id })));
  readonly shown = computed(() => (this.all() ? this.targets() : this.targets().slice(0, VISIBLE)));

  open(target: CodeRefTarget, tab: CodeRefTab): void {
    const card = this.card();
    if (!card) return;
    this.dialog.open(CodeRefPopoverComponent, {
      data: { card, target, tab },
      width: 'min(1200px, 96vw)',
      maxWidth: '96vw',
      height: 'min(880px, 92vh)',
      panelClass: 'code-ref-dialog',
      autoFocus: false,
    });
  }
}
