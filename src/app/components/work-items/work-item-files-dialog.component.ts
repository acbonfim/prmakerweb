import { Component, ViewEncapsulation, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { formatWorkNumber } from './work-item.model';
import { filesCountLabel } from './work-item-files';
import { WorkItemFilesComponent } from './work-item-files.component';
import { WorkItemFilesStore } from './work-item-files.store';
import { WORK_DIALOG_STYLES } from './work-dialog.styles';

export interface WorkItemFilesDialogData {
  card: string;
  number: number;
  title?: string | null;
  /** Só os arquivos desta sub-tarefa. */
  taskNumber?: number | null;
}

/**
 * 0085 rodada 5 (1.2): os arquivos do item num modal próprio — aberto pelo chip "Arquivos (n)" da sessão de execução.
 * Lista ao vivo (store próprio). Abrir com `workDialogConfig(data, '680px')`.
 */
@Component({
  selector: 'app-work-item-files-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, WorkItemFilesComponent],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="wi-dlg">
      <header class="wi-dlg__head">
        <mat-icon class="wifd__ico">folder_open</mat-icon>
        <div class="wi-dlg__head-main">
          <span class="wi-dlg__title">Arquivos · <span class="wi-num">{{ num(data.number) }}</span> {{ data.title || '' }}</span>
          <span class="wi-dlg__sub">{{ countLabel(store.count()) }}@if (data.taskNumber != null) { · sub-tarefa {{ num(data.taskNumber) }} }</span>
        </div>
        <button mat-icon-button mat-dialog-close aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </header>
      <div class="wi-dlg__body">
        <app-work-item-files [store]="store" [card]="data.card" [taskNumber]="data.taskNumber ?? null" />
      </div>
    </div>
  `,
  styles: [WORK_DIALOG_STYLES, `.wifd__ico { color: var(--mat-sys-primary); flex: none; }`]
})
export class WorkItemFilesDialogComponent {
  readonly data = inject<WorkItemFilesDialogData>(MAT_DIALOG_DATA);
  readonly store = new WorkItemFilesStore();
  readonly num = formatWorkNumber;
  readonly countLabel = filesCountLabel;

  constructor() {
    this.store.watch(this.data.number, this.data.card);
  }
}
