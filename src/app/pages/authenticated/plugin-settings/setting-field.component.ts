import { Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SETTING_READERS, SettingField } from './plugin-settings.model';
import { sameValue } from './plugin-settings.logic';
import { PluginSettingsStore } from './plugin-settings.store';
import { SettingsHistoryDialogComponent } from './dialogs/history-dialog.component';
import { SettingTextEditorComponent } from './editors/text-editor.component';
import { SettingTextareaEditorComponent } from './editors/textarea-editor.component';
import { SettingSecretEditorComponent } from './editors/secret-editor.component';
import { SettingBoolEditorComponent } from './editors/bool-editor.component';
import { SettingNumberEditorComponent } from './editors/number-editor.component';
import { SettingEnumEditorComponent } from './editors/enum-editor.component';
import { SettingListEditorComponent } from './editors/list-editor.component';
import { SettingStepsEditorComponent } from './editors/steps-editor.component';
import { TableEditorComponent } from './editors/table-editor.component';
import { MapEditorComponent } from './editors/map-editor.component';
import { JsonEditorComponent } from './editors/json-editor.component';
import { PromptEditorComponent } from './editors/prompt-editor.component';

/**
 * Um campo da tela de configurações (0086): cabeçalho (rótulo, plugin + chave, quem lê, selos, ações) e o editor do
 * tipo. Lê e grava no `PluginSettingsStore` da tela.
 */
@Component({
  selector: 'app-setting-field',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule,
    SettingTextEditorComponent, SettingTextareaEditorComponent, SettingSecretEditorComponent, SettingBoolEditorComponent,
    SettingNumberEditorComponent, SettingEnumEditorComponent, SettingListEditorComponent, SettingStepsEditorComponent,
    TableEditorComponent, MapEditorComponent, JsonEditorComponent, PromptEditorComponent],
  templateUrl: './setting-field.component.html',
  styleUrls: ['./setting-field.component.css'],
})
export class SettingFieldComponent {
  readonly field = input.required<SettingField>();
  /** Destaque do deep link (`?field=`). */
  readonly highlight = input(false);

  readonly store = inject(PluginSettingsStore);
  private readonly dialog = inject(MatDialog);

  readonly readers = computed(() => (this.field().readBy ?? []).map(r => ({ key: r, ...SETTING_READERS[r] })).filter(r => !!r.icon));
  readonly value = computed(() => this.store.valueOf(this.field()));
  readonly pending = computed(() => this.store.pending()[this.field().id]);
  readonly dirty = computed(() => !!this.pending());
  readonly removing = computed(() => !!this.pending()?.remove);
  readonly error = computed(() => this.store.errorOf(this.field().id));
  readonly disabled = computed(() => this.field().pluginId == null || this.removing());
  /** Chave que o código lê e não existe no banco: está usando o padrão. */
  readonly missing = computed(() => !this.field().exists && !this.field().uncataloged && this.field().pluginId != null);
  readonly hasDefault = computed(() => this.field().default != null && this.field().type !== 'secret');
  /** Valor (em edição) diferente do padrão do código. */
  readonly changedFromDefault = computed(() =>
    this.hasDefault() && (this.field().exists || this.dirty()) && !sameValue(this.value(), this.field().default));
  readonly stepOptions = computed(() => (this.field().type === 'steps' ? this.store.stepOptionsFor(this.field()) : []));
  readonly personalCaption = computed(() => {
    const p = this.field().personal;
    if (!p) return null;
    if (!p.userFills) return null;
    if (this.field().type === 'secret') return 'Valor global (cada usuário informa o próprio)';
    return p.useGlobalDefault || !p.required ? 'Valor padrão para os usuários' : 'Valor sugerido aos usuários';
  });

  onValue(v: string): void {
    this.store.setValue(this.field(), v ?? '');
  }

  onInvalid(message: string | null): void {
    this.store.setInvalid(this.field().id, message);
  }

  restore(): void {
    this.store.restoreDefault(this.field());
  }

  discard(): void {
    this.store.discard(this.field().id);
  }

  writeDefault(): void {
    this.store.writeDefault(this.field());
  }

  toggleRemove(): void {
    this.store.markRemove(this.field(), !this.removing());
  }

  openHistory(): void {
    this.dialog.open(SettingsHistoryDialogComponent, {
      data: this.field(),
      width: '760px',
      maxWidth: '96vw',
      panelClass: 'custom-dialog-container',
      autoFocus: false,
    });
  }
}
