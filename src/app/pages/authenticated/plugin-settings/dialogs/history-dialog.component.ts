import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { SettingField, SettingHistoryEntry } from '../plugin-settings.model';
import { PluginSettingsService } from '../plugin-settings.service';
import { SettingValueDiffComponent } from '../value-diff.component';
import { dialogStyles } from './dialog-styles';

/** Histórico de alterações de uma chave (0086): quem, quando, antes → depois (mais recente primeiro). */
@Component({
  selector: 'app-settings-history-dialog',
  standalone: true,
  imports: [DatePipe, MatDialogModule, MatButtonModule, MatIconModule, MatProgressBarModule, SettingValueDiffComponent],
  template: `
    <div class="dl">
      <div class="dl__header">
        <mat-icon class="dl__lead">history</mat-icon>
        <div class="dl__titles">
          <span class="dl__kicker">Histórico</span>
          <span class="dl__title">{{ field.label }} · <span class="dl__key">{{ field.pluginName }} · {{ field.key }}</span></span>
        </div>
      </div>
      @if (loading()) { <mat-progress-bar mode="indeterminate" /> }
      <div class="dl__body">
        @if (error()) {
          <div class="dl__empty"><mat-icon>cloud_off</mat-icon>{{ error() }}</div>
        } @else if (!loading() && !entries().length) {
          <div class="dl__empty"><mat-icon>history_toggle_off</mat-icon>Nenhuma alteração registrada para esta chave.</div>
        }
        @for (e of entries(); track $index) {
          <div class="dl__item">
            <div class="dl__item-head">
              <strong>{{ e.changedByName || e.changedBy || 'Sistema' }}</strong>
              <span class="dl__key">{{ e.changedAt | date: 'dd/MM/yyyy HH:mm' }}</span>
            </div>
            <app-setting-value-diff [before]="e.oldValue" [after]="e.newValue" [type]="field.type"
                                    [secret]="field.type === 'secret'" [removed]="e.newValue === null" />
          </div>
        }
      </div>
      <div class="dl__footer">
        <span class="dl__note">Últimas {{ take }} alterações.</span>
        <span class="dl__spacer"></span>
        <button mat-button (click)="ref.close()">Fechar</button>
      </div>
    </div>
  `,
  styles: [dialogStyles],
})
export class SettingsHistoryDialogComponent {
  readonly field = inject<SettingField>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<SettingsHistoryDialogComponent>);
  private readonly api = inject(PluginSettingsService);

  readonly take = 50;
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly entries = signal<SettingHistoryEntry[]>([]);

  constructor() {
    if (this.field.pluginId == null) {
      this.loading.set(false);
      return;
    }
    this.api.history(this.field.pluginId, this.field.key, this.take).subscribe({
      next: list => { this.entries.set(list ?? []); this.loading.set(false); },
      error: () => { this.error.set('Não foi possível carregar o histórico.'); this.loading.set(false); },
    });
  }
}
