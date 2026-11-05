import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { map } from 'rxjs';
import { ConfirmDialogComponent } from '../../../components/confirmDialog/confirmDialog.component';
import { TabsService } from '../../../services/tabs.service';
import type { PluginSettingsPageComponent } from './plugin-settings-page.component';

/**
 * Sair da tela de configurações com alterações não salvas pede confirmação (0086). Troca de aba (0065) não pergunta:
 * a tela fica guardada com as edições; fechar a aba já pergunta pela marca "suja".
 */
export const pluginSettingsLeaveGuard: CanDeactivateFn<PluginSettingsPageComponent> = (component) => {
  if (inject(TabsService).switching) return true;
  if (!component?.hasPendingChanges()) return true;
  const n = component.store.pendingCount();
  return inject(MatDialog)
    .open(ConfirmDialogComponent, {
      width: '420px',
      data: {
        title: 'Sair sem salvar?',
        description: `Há ${n} alteração(ões) não salva(s) nas configurações. Se sair, elas serão perdidas.`,
        labelCancel: 'Continuar editando',
        labelConfirm: 'Sair sem salvar',
      },
    })
    .afterClosed()
    .pipe(map(ok => !!ok));
};
