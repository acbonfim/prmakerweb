import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { CaseChatDialogComponent, CaseChatDialogData } from './case-chat-dialog.component';

/** 0080: abre o Especialista do caso (o mesmo modal grande da conversa; tela cheia no celular). */
export function openCaseChat(dialog: MatDialog, card: string): MatDialogRef<CaseChatDialogComponent> {
  const narrow = window.matchMedia('(max-width: 640px)').matches;
  const open = dialog.openDialogs.find((d) => d.componentInstance instanceof CaseChatDialogComponent) as MatDialogRef<CaseChatDialogComponent> | undefined;
  if (open && open.componentInstance.data.card === card) return open;
  const data: CaseChatDialogData = { card };
  return dialog.open(CaseChatDialogComponent, {
    data,
    width: narrow ? '100vw' : '1280px',
    maxWidth: narrow ? '100vw' : '96vw',
    height: narrow ? '100dvh' : '90vh',
    panelClass: narrow ? ['plan-chat-panel', 'case-chat-panel--full'] : 'plan-chat-panel',
    backdropClass: 'plan-chat-backdrop',
    autoFocus: false,
    restoreFocus: true
  });
}
