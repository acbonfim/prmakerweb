import { inject, signal } from '@angular/core';
import { BackNavigationService } from '../services/back-navigation.service';

/** Mesma animação da tela cheia da linha do tempo (feature 0020). */
const ANIMATION: KeyframeAnimationOptions = { duration: 320, easing: 'cubic-bezier(0.2, 0, 0, 1)' };
type Rect = { top: number; left: number; width: number; height: number };
/** Celular (0043): a tela cheia ocupa a tela toda, sem margem. */
const PHONE_MAX_WIDTH = 768;

export interface FullscreenPanelOptions {
  /** Elemento que fica no lugar (o host do componente). */
  host: () => HTMLElement;
  /** O painel que vai para a tela cheia (o MESMO elemento: estado, rolagem e tempo real continuam). */
  panel: () => HTMLElement | undefined;
  /** Classe aplicada ao painel enquanto aberto (position: fixed etc. no CSS do componente). */
  expandedClass: string;
  /** Largura máxima do modal. */
  maxWidth?: number;
}

/**
 * Tela cheia de um painel, no mesmo comportamento da linha do tempo (0020): o painel sai do lugar
 * (vai para o <body>, antes do overlay do CDK — tooltips, menus e dialogs continuam por cima), cresce
 * animado até o modal e volta encolhendo. Esc ou clique no fundo fecham; cliques durante a animação
 * entram em fila. Elementos com `data-keep-scroll` têm a rolagem preservada ao mover o nó.
 */
export class FullscreenPanel {
  readonly expanded = signal(false);

  private animating = false;
  private transition: Promise<void> = Promise.resolve();
  private destroyed = false;
  private backdrop?: HTMLDivElement;
  private previousHtmlOverflow = '';
  /** Quem rola a página é a .content-area (não o <html>): trava as duas enquanto aberto (0043). */
  private lockedScrollers: { el: HTMLElement; overflow: string }[] = [];
  /** Voltar do app/sistema fecha a tela cheia (0043). Criado no construtor do componente (contexto de injeção). */
  private readonly back = inject(BackNavigationService);
  private releaseBack?: () => void;

  constructor(private readonly options: FullscreenPanelOptions) {}

  toggle(): void {
    this.enqueue(() => (this.expanded() ? this.collapse() : this.expand()));
  }

  close(): void {
    this.enqueue(() => this.collapse());
  }

  /** Chamar no ngOnDestroy: destruído aberto (troca de rota), tira o modal e o fundo do <body>. */
  destroy(): void {
    this.destroyed = true;
    if (!this.expanded()) return;
    document.removeEventListener('keydown', this.onKeydown);
    window.removeEventListener('resize', this.onResize);
    this.options.panel()?.remove();
    this.backdrop?.remove();
    this.unlockScroll();
    this.releaseBack?.();
  }

  private enqueue(step: () => Promise<void>): void {
    const run = () => (this.destroyed ? undefined : step());
    this.transition = this.transition.then(run, run);
  }

  private async expand(): Promise<void> {
    const el = this.options.panel();
    if (!el || this.expanded()) return;

    const host = this.options.host();
    const from = rectOf(el);
    const scroll = saveScroll(el);
    const focused = focusedInside(el);

    // Reserva o lugar na página (nada "pula" atrás do modal).
    host.style.height = `${from.height}px`;

    this.backdrop = document.createElement('div');
    Object.assign(this.backdrop.style, {
      position: 'fixed', inset: '0', zIndex: '1000',
      background: 'rgba(0, 0, 0, 0.55)', backdropFilter: 'blur(2px)'
    });
    this.backdrop.addEventListener('click', () => this.close());
    const overlay = document.body.querySelector(':scope > .cdk-overlay-container');
    document.body.insertBefore(this.backdrop, overlay);
    document.body.insertBefore(el, overlay);

    this.lockScroll();

    el.classList.add(this.options.expandedClass);
    const to = this.expandedRect();
    applyRect(el, to);
    this.expanded.set(true);
    restoreScroll(scroll);
    focused?.focus({ preventScroll: true });

    document.addEventListener('keydown', this.onKeydown);
    window.addEventListener('resize', this.onResize);
    this.releaseBack = this.back.push(() => this.close());

    if (reducedMotion()) return;
    this.animating = true;
    this.backdrop.animate([{ opacity: 0 }, { opacity: 1 }], ANIMATION);
    const anim = el.animate([keyframe(from, 10), keyframe(to, 14)], ANIMATION);
    await anim.finished.catch(() => {});
    this.animating = false;
  }

  private async collapse(): Promise<void> {
    const el = this.options.panel();
    if (!el || !this.expanded()) return;

    const host = this.options.host();
    const scroll = saveScroll(el);
    const focused = focusedInside(el);

    document.removeEventListener('keydown', this.onKeydown);
    window.removeEventListener('resize', this.onResize);
    this.releaseBack?.();
    this.releaseBack = undefined;

    if (!reducedMotion()) {
      this.animating = true;
      const anim = el.animate([keyframe(rectOf(el), 14), keyframe(rectOf(host), 10)], { ...ANIMATION, fill: 'forwards' });
      this.backdrop?.animate([{ opacity: 1 }, { opacity: 0 }], { ...ANIMATION, fill: 'forwards' });
      await anim.finished.catch(() => {});
      this.animating = false;
      this.restoreInPlace(el, host);
      anim.cancel();
    } else {
      this.restoreInPlace(el, host);
    }

    restoreScroll(scroll);
    focused?.focus({ preventScroll: true });
  }

  private restoreInPlace(el: HTMLElement, host: HTMLElement): void {
    host.insertBefore(el, host.firstChild);
    el.classList.remove(this.options.expandedClass);
    for (const prop of ['top', 'left', 'width', 'height'] as const) el.style[prop] = '';
    host.style.height = '';
    this.backdrop?.remove();
    this.backdrop = undefined;
    this.unlockScroll();
    this.expanded.set(false);
  }

  private lockScroll(): void {
    this.previousHtmlOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    this.lockedScrollers = Array.from(document.querySelectorAll<HTMLElement>('.content-area')).map((el) => {
      const saved = { el, overflow: el.style.overflow };
      el.style.overflow = 'hidden';
      return saved;
    });
  }

  private unlockScroll(): void {
    document.documentElement.style.overflow = this.previousHtmlOverflow;
    for (const s of this.lockedScrollers) s.el.style.overflow = s.overflow;
    this.lockedScrollers = [];
  }

  private onKeydown = (event: KeyboardEvent): void => {
    // Um dialog aberto por cima (ex.: arquivos) trata o Esc antes e marca defaultPrevented.
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      this.close();
    }
  };

  private onResize = (): void => {
    const el = this.options.panel();
    if (el && !this.animating) applyRect(el, this.expandedRect());
  };

  /** Centralizado, ~92% da tela, no máximo `maxWidth` px de largura; no celular, a tela toda. */
  private expandedRect(): Rect {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (vw <= PHONE_MAX_WIDTH) return { top: 0, left: 0, width: vw, height: vh };
    const width = Math.min(this.options.maxWidth ?? 1200, vw - 2 * Math.max(16, vw * 0.04));
    const height = vh - 2 * Math.max(16, vh * 0.04);
    return { top: (vh - height) / 2, left: (vw - width) / 2, width, height };
  }
}

function rectOf(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function applyRect(el: HTMLElement, r: Rect): void {
  el.style.top = `${r.top}px`;
  el.style.left = `${r.left}px`;
  el.style.width = `${r.width}px`;
  el.style.height = `${r.height}px`;
}

/** Anima a geometria (e não scale): o texto não distorce enquanto o painel cresce/encolhe. */
function keyframe(r: Rect, radius: number): Keyframe {
  return { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: `${radius}px` };
}

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function focusedInside(el: HTMLElement): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  return active && active !== document.body && el.contains(active) ? active : null;
}

/** Mover o nó no DOM zera a rolagem: guarda e restaura (quem lia o fim continua no fim). */
function saveScroll(el: HTMLElement): { el: HTMLElement; top: number; atBottom: boolean }[] {
  return Array.from(el.querySelectorAll<HTMLElement>('[data-keep-scroll]')).map((b) => ({
    el: b,
    top: b.scrollTop,
    atBottom: b.scrollHeight - b.scrollTop - b.clientHeight < 8
  }));
}

function restoreScroll(saved: { el: HTMLElement; top: number; atBottom: boolean }[]): void {
  for (const s of saved) s.el.scrollTop = s.atBottom ? s.el.scrollHeight : s.top;
}
