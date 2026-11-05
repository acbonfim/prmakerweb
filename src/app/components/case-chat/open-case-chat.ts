import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MORPH_PANEL_CLASS, canMorphFrom, morphDialogFromOrigin } from '../../helpers/dialog-morph';
import { CaseChatDialogComponent, CaseChatDialogData, CaseChatDialogResult } from './case-chat-dialog.component';

/**
 * 0080: abre o Especialista do caso (o mesmo modal grande da conversa; tela cheia no celular).
 * Com `origin` (o painel compacto da tela do PR), o modal cresce a partir dele e, ao fechar, volta encolhendo para o mesmo
 * lugar — o mesmo efeito da tela cheia do plano e da linha do tempo (FullscreenPanel). A animação mora em
 * `helpers/dialog-morph.ts` (0085: o modal do card usa a mesma).
 */
export function openCaseChat(dialog: MatDialog, card: string, origin?: HTMLElement | null, cardType: 'bug' | 'user-story' = 'bug'): MatDialogRef<CaseChatDialogComponent, CaseChatDialogResult> {
  const narrow = window.matchMedia('(max-width: 640px)').matches;
  const open = dialog.openDialogs.find((d) => d.componentInstance instanceof CaseChatDialogComponent) as MatDialogRef<CaseChatDialogComponent, CaseChatDialogResult> | undefined;
  if (open && open.componentInstance.data.card === card) return open;
  const morph = canMorphFrom(origin) ? origin : null;
  const data: CaseChatDialogData = { card, cardType };
  const ref = dialog.open(CaseChatDialogComponent, {
    data,
    width: narrow ? '100vw' : '1280px',
    maxWidth: narrow ? '100vw' : '96vw',
    height: narrow ? '100dvh' : '90vh',
    panelClass: [
      'plan-chat-panel',
      ...(narrow ? ['case-chat-panel--full'] : []),
      ...(morph ? [MORPH_PANEL_CLASS] : [])
    ],
    backdropClass: 'plan-chat-backdrop',
    autoFocus: false,
    restoreFocus: true,
    // A animação é a nossa (geometria a partir do painel compacto), não a do Material.
    ...(morph ? { enterAnimationDuration: 0, exitAnimationDuration: 0 } : {})
  });
  if (morph) morphDialogFromOrigin(ref, morph, { hideOrigin: true });
  return ref;
}
