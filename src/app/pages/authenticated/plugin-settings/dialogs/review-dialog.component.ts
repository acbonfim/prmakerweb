import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { SettingValueDiffComponent } from '../value-diff.component';
import { dialogStyles } from './dialog-styles';

/** Um campo na revisão antes de gravar. */
export interface ReviewItem {
  id: string;
  label: string;
  pluginName: string;
  key: string;
  type: string;
  secret: boolean;
  /** Valor gravado (null = a chave não existia). */
  before: string | null;
  after: string | null;
  remove: boolean;
}

export interface ReviewDialogData {
  sectionTitle: string;
  items: ReviewItem[];
}

/** Revisão antes de salvar uma seção (0086): antes → depois por campo; confirmar grava. */
@Component({
  selector: 'app-settings-review-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, SettingValueDiffComponent],
  template: `
    <div class="dl">
      <div class="dl__header">
        <mat-icon class="dl__lead">fact_check</mat-icon>
        <div class="dl__titles">
          <span class="dl__kicker">Revisar antes de salvar</span>
          <span class="dl__title">{{ data.sectionTitle }} · {{ data.items.length }} alteração(ões)</span>
        </div>
      </div>
      <div class="dl__body">
        @for (item of data.items; track item.id) {
          <div class="dl__item">
            <div class="dl__item-head">
              <strong>{{ item.label }}</strong>
              <span class="dl__key">{{ item.pluginName }} · {{ item.key }}</span>
            </div>
            <app-setting-value-diff [before]="item.before" [after]="item.after" [type]="item.type"
                                    [secret]="item.secret" [removed]="item.remove" />
          </div>
        }
      </div>
      <div class="dl__footer">
        <span class="dl__note">Só estas chaves são gravadas; as demais (e as de outros admins) não mudam.</span>
        <span class="dl__spacer"></span>
        <button mat-button (click)="ref.close(false)">Voltar</button>
        <button mat-flat-button color="primary" (click)="ref.close(true)">
          <mat-icon>save</mat-icon> Salvar {{ data.items.length }}
        </button>
      </div>
    </div>
  `,
  styles: [dialogStyles],
})
export class SettingsReviewDialogComponent {
  readonly data = inject<ReviewDialogData>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<SettingsReviewDialogComponent, boolean>);
}
