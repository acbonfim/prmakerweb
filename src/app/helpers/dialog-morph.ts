import { MatDialogRef, MatDialogState } from '@angular/material/dialog';
import { ANIMATION, reducedMotion } from './fullscreen-panel';

type Rect = { top: number; left: number; width: number; height: number };

/** Classe do painel do MatDialog que desliga a entrada padrão (o "in" do `.plan-chat-panel`): a animação é a nossa. */
export const MORPH_PANEL_CLASS = 'case-chat-panel--morph';

/** O elemento de origem está na tela (dá para crescer a partir dele)? Com movimento reduzido, não anima. */
export function canMorphFrom(origin: HTMLElement | null | undefined): origin is HTMLElement {
  return !!origin && isShown(origin) && !reducedMotion();
}

/**
 * Mesma animação da tela cheia da linha do tempo e do plano (`FullscreenPanel`, 0020), num MatDialog: o modal cresce a
 * partir do elemento clicado (geometria, sem distorcer o texto) e, ao fechar, encolhe de volta para ele.
 *
 * O painel do overlay sai do flex que o centraliza (position: fixed) só enquanto anima top/left/width/height entre a
 * origem e o tamanho final do modal. Abra o dialog com `enterAnimationDuration: 0, exitAnimationDuration: 0` e a classe
 * `MORPH_PANEL_CLASS` no `panelClass`. `hideOrigin`: a origem some enquanto o modal está aberto (o painel compacto do
 * Especialista "vira" o modal); para um botão, deixe visível.
 */
export function morphDialogFromOrigin<T>(ref: MatDialogRef<T>, origin: HTMLElement, opts: { hideOrigin?: boolean } = {}): void {
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
        if (opts.hideOrigin) origin.style.visibility = 'hidden';
      },
      () => {}
    );
  });

  const close = ref.close.bind(ref);
  ref.close = (result?: unknown) => {
    if (closing) return;
    closing = true;
    if (opts.hideOrigin) origin.style.visibility = '';
    if (!origin.isConnected || !isShown(origin)) {
      close(result as never);
      return;
    }
    const from = rectOf(pane);
    const anim = animate([frame(from, 1), { offset: 0.65, opacity: 1 }, frame(rectOf(origin), 0)], { ...ANIMATION, fill: 'forwards' });
    fade?.animate([{ opacity: 1 }, { opacity: 0 }], { ...ANIMATION, fill: 'forwards' });
    anim.finished.catch(() => {}).then(() => close(result as never));
  };
  if (opts.hideOrigin) ref.afterClosed().subscribe(() => (origin.style.visibility = ''));
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
