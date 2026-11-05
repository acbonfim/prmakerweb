import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { SettingValueDiffComponent } from '../value-diff.component';
import { dialogStyles } from './dialog-styles';

/** Um campo em conflito: o que eu li, o que está no servidor agora e o que eu quero gravar. */
export interface ConflictItem {
  id: string;
  label: string;
  pluginName: string;
  key: string;
  type: string;
  secret: boolean;
  expected: string | null;
  current: string | null;
  mine: string | null;
}

export interface ConflictDialogData {
  sectionTitle: string;
  items: ConflictItem[];
}

/** "reload" = recarregar e manter minhas alterações nos outros campos; "overwrite" = gravar por cima. */
export type ConflictChoice = 'reload' | 'overwrite';

/** Conflito ao salvar (409 — 0086): outro admin gravou antes; nada foi gravado. */
@Component({
  selector: 'app-settings-conflict-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, SettingValueDiffComponent],
  template: `
    <div class="dl">
      <div class="dl__header">
        <mat-icon class="dl__lead dl__lead--warn">sync_problem</mat-icon>
        <div class="dl__titles">
          <span class="dl__kicker">Alguém salvou antes</span>
          <span class="dl__title">{{ data.sectionTitle }} · {{ data.items.length }} campo(s) mudaram no servidor</span>
        </div>
      </div>
      <div class="dl__body">
        <span class="dl__text">Nada foi gravado. Estes campos foram alterados por outra pessoa (ou outra aba) depois que
          você abriu a tela:</span>
        @for (item of data.items; track item.id) {
          <div class="dl__item">
            <div class="dl__item-head">
              <strong>{{ item.label }}</strong>
              <span class="dl__key">{{ item.pluginName }} · {{ item.key }}</span>
            </div>
            <span class="dl__label">Você leu → está no servidor agora</span>
            <app-setting-value-diff [before]="item.expected" [after]="item.current" [type]="item.type" [secret]="item.secret" />
            <span class="dl__label">Está no servidor → você quer gravar</span>
            <app-setting-value-diff [before]="item.current" [after]="item.mine" [type]="item.type" [secret]="item.secret"
                                    [removed]="item.mine === null" />
          </div>
        }
      </div>
      <div class="dl__footer">
        <button mat-button (click)="ref.close(null)">Cancelar</button>
        <span class="dl__spacer"></span>
        <button mat-stroked-button (click)="ref.close('reload')">
          <mat-icon>refresh</mat-icon> Recarregar e manter minhas alterações nos outros campos
        </button>
        <button mat-flat-button color="warn" (click)="ref.close('overwrite')">
          <mat-icon>save_as</mat-icon> Sobrescrever
        </button>
      </div>
    </div>
  `,
  styles: [dialogStyles],
})
export class SettingsConflictDialogComponent {
  readonly data = inject<ConflictDialogData>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<SettingsConflictDialogComponent, ConflictChoice | null>);
}
