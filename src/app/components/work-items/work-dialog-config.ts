import { MatDialogConfig } from '@angular/material/dialog';

/** Classe do painel dos modais dos itens de trabalho (estilo global em `work-dialog.styles.ts`). */
export const WORK_DIALOG_PANEL = 'wi-dialog-panel';

/**
 * 0085: configuração comum dos modais dos itens de trabalho — discreto, `maxWidth: 96vw`, sem foco automático;
 * abaixo de 640px vira tela cheia.
 */
export function workDialogConfig<D>(data: D, width = '760px', extra: Partial<MatDialogConfig<D>> = {}): MatDialogConfig<D> {
  const narrow = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 640px)').matches;
  return {
    data,
    width: narrow ? '100vw' : width,
    maxWidth: narrow ? '100vw' : '96vw',
    maxHeight: narrow ? '100dvh' : '92vh',
    ...(narrow ? { height: '100dvh' } : {}),
    panelClass: [WORK_DIALOG_PANEL, ...(narrow ? [`${WORK_DIALOG_PANEL}--full`] : [])],
    autoFocus: false,
    restoreFocus: true,
    ...extra
  };
}
