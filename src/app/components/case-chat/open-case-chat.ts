import { MatDialog, MatDialogRef, MatDialogState } from '@angular/material/dialog';
import { ANIMATION, reducedMotion } from '../../helpers/fullscreen-panel';
import { CaseChatDialogComponent, CaseChatDialogData } from './case-chat-dialog.component';

type Rect = { top: number; left: number; width: number; height: number };

/**
 * 0080: abre o Especialista do caso (o mesmo modal grande da conversa; tela cheia no celular).
 * Com `origin` (o painel compacto da tela do PR), o modal cresce a partir dele e, ao fechar, volta encolhendo para o mesmo
 * lugar — o mesmo efeito da tela cheia do plano e da linha do tempo (FullscreenPanel).
 */
export function openCaseChat(dialog: MatDialog, card: string, origin?: HTMLElement | null): MatDialogRef<CaseChatDialogComponent> {
  const narrow = window.matchMedia('(max-width: 640px)').matches;
  const open = dialog.openDialogs.find((d) => d.componentInstance instanceof CaseChatDialogComponent) as MatDialogRef<CaseChatDialogComponent> | undefined;
  if (open && open.componentInstance.data.card === card) return open;
  const morph = origin && isShown(origin) && !reducedMotion() ? origin : null;
  const data: CaseChatDialogData = { card };
  const ref = dialog.open(CaseChatDialogComponent, {
    data,
    width: narrow ? '100vw' : '1280px',
    maxWidth: narrow ? '100vw' : '96vw',
    height: narrow ? '100dvh' : '90vh',
    panelClass: [
      'plan-chat-panel',
      ...(narrow ? ['case-chat-panel--full'] : []),
      ...(morph ? ['case-chat-panel--morph'] : [])
    ],
    backdropClass: 'plan-chat-backdrop',
    autoFocus: false,
    restoreFocus: true,
    // A animação é a nossa (geometria a partir do painel compacto), não a do Material.
    ...(morph ? { enterAnimationDuration: 0, exitAnimationDuration: 0 } : {})
  });
  if (morph) morphFromOrigin(ref, morph);
  return ref;
}

/**
 * O painel do overlay sai do flex que o centraliza (position: fixed) só enquanto anima top/left/width/height entre o
 * painel compacto e o tamanho final do modal. Enquanto aberto, o painel compacto fica escondido (o lugar continua
 * reservado); ao fechar ele reaparece por baixo e o modal encolhe até ele, sumindo no fim.
 */
function morphFromOrigin(ref: MatDialogRef<CaseChatDialogComponent>, origin: HTMLElement): void {
  const pane = (ref.componentRef?.location.nativeElement as HTMLElement | undefined)?.closest<HTMLElement>('.cdk-overlay-pane');
  if (!pane) return;
  const backdrop = pane.parentElement?.previousElementSibling as HTMLElement | null;
  const fade = backdrop?.classList.contains('cdk-overlay-backdrop') ? backdrop : null;
  const position = pane.style.position;
  let current: Animation | undefined;
  let closing = false;

  const animate = (frames: Keyframe[], options: KeyframeAnimationOptions): Animation => {
    pane.style.position = 'fixed';
    current?.cancel();
    current = pane.animate(frames, options);
    return current;
  };

  // Só dá para medir o tamanho final depois que o overlay posiciona o modal: até lá ele fica invisível.
  pane.style.opacity = '0';
  requestAnimationFrame(() => {
    pane.style.opacity = '';
    if (closing || ref.getState() !== MatDialogState.OPEN || !isShown(origin)) return;
    const anim = animate([frame(rectOf(origin), 0), { offset: 0.35, opacity: 1 }, frame(rectOf(pane), 1)], ANIMATION);
    fade?.animate([{ opacity: 0 }, { opacity: 1 }], ANIMATION);
    anim.finished.then(
      () => {
        pane.style.position = position;
        origin.style.visibility = 'hidden';
      },
      () => {}
    );
  });

  const close = ref.close.bind(ref);
  ref.close = (result?: unknown) => {
    if (closing) return;
    closing = true;
    origin.style.visibility = '';
    if (!origin.isConnected || !isShown(origin)) {
      close(result);
      return;
    }
    const from = rectOf(pane);
    const anim = animate([frame(from, 1), { offset: 0.65, opacity: 1 }, frame(rectOf(origin), 0)], { ...ANIMATION, fill: 'forwards' });
    fade?.animate([{ opacity: 1 }, { opacity: 0 }], { ...ANIMATION, fill: 'forwards' });
    anim.finished.catch(() => {}).then(() => close(result));
  };
  ref.afterClosed().subscribe(() => (origin.style.visibility = ''));
}

function isShown(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return el.isConnected && r.width > 0 && r.height > 0;
}

function rectOf(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/** Geometria (e não scale), como no FullscreenPanel: o texto não distorce enquanto cresce/encolhe. */
function frame(r: Rect, opacity: number): Keyframe {
  return { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px`, opacity };
}
