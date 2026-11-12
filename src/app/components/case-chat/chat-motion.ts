import { signal } from '@angular/core';

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Rolagem "presa ao fim" da conversa: abre na mensagem mais nova e continua lá enquanto o conteúdo cresce (markdown,
 * imagens que terminam de carregar, painel que estava escondido e apareceu) — até a pessoa rolar para cima. Antes a
 * conversa grande abria no topo porque a rolagem ia para o fim antes de o texto/imagens terem altura.
 */
export class StickyScroll {
  /** No fim (segue as mensagens novas). Falso = a pessoa está lendo mais acima. */
  readonly atEnd = signal(true);
  private el: HTMLElement | null = null;
  private resize?: ResizeObserver;
  private mutations?: MutationObserver;
  private readonly onLoad = () => this.follow();
  /** Rolagem suave em andamento: os eventos de scroll no meio do caminho não contam como "a pessoa subiu". */
  private gliding?: ReturnType<typeof setTimeout>;

  constructor(private readonly threshold: number, private readonly reachedEnd?: () => void) {}

  /** Liga no elemento que rola. `startAt` = posição salva (null = no fim). */
  attach(el: HTMLElement, startAt: number | null = null): void {
    if (this.el === el) return;
    this.detach();
    this.el = el;
    if (typeof ResizeObserver === 'function') {
      this.resize = new ResizeObserver(() => this.follow());
      this.resize.observe(el);
    }
    if (typeof MutationObserver === 'function') {
      this.mutations = new MutationObserver(() => this.follow());
      this.mutations.observe(el, { childList: true, subtree: true, characterData: true });
    }
    // `load` não sobe: na captura pega imagem/áudio que terminou de carregar e mudou a altura.
    el.addEventListener('load', this.onLoad, true);
    if (startAt === null) this.toEnd();
    else {
      el.scrollTop = startAt;
      this.atEnd.set(this.isAtEnd());
    }
  }

  detach(): void {
    clearTimeout(this.gliding);
    this.gliding = undefined;
    this.resize?.disconnect();
    this.mutations?.disconnect();
    this.el?.removeEventListener('load', this.onLoad, true);
    this.el = null;
  }

  /** Chamar no (scroll) do elemento. */
  onScroll(): void {
    if (this.gliding) return;
    const end = this.isAtEnd();
    this.atEnd.set(end);
    if (end) this.reachedEnd?.();
  }

  /** Vai para o fim e volta a seguir as mensagens novas. */
  toEnd(smooth = false): void {
    const el = this.el;
    this.atEnd.set(true);
    if (!el) return;
    clearTimeout(this.gliding);
    this.gliding = undefined;
    if (smooth && !reducedMotion()) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      // Terminou de deslizar (ou a conversa cresceu no caminho): garante o fim.
      this.gliding = setTimeout(() => {
        this.gliding = undefined;
        if (this.el && this.atEnd()) this.el.scrollTop = this.el.scrollHeight;
        this.reachedEnd?.();
      }, 700);
      return;
    }
    el.scrollTop = el.scrollHeight;
    this.reachedEnd?.();
  }

  isAtEnd(): boolean {
    const el = this.el;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < this.threshold;
  }

  get scrollTop(): number | null {
    return this.el ? this.el.scrollTop : null;
  }

  private follow(): void {
    const el = this.el;
    // Escondido (aba do celular, painel recolhido): segue quando aparecer (o ResizeObserver avisa).
    if (!el || !this.atEnd() || !el.clientHeight || this.gliding) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 1) el.scrollTop = el.scrollHeight;
  }
}

/**
 * O texto "sai" do campo e voa até a bolha nova na conversa (a bolha fica invisível até ele chegar). Sem animação quando
 * a pessoa pediu menos movimento ou se algum dos dois não está na tela.
 */
export function flyToChat(source: HTMLElement | null | undefined, bubble: HTMLElement | null | undefined, text: string): void {
  if (!source || !bubble || reducedMotion() || typeof bubble.animate !== 'function') return;
  const from = source.getBoundingClientRect();
  const to = bubble.getBoundingClientRect();
  if (!from.width || !to.width || to.top > window.innerHeight || to.bottom < 0) return;

  const look = getComputedStyle(bubble);
  const ghost = document.createElement('div');
  ghost.textContent = text.length > 400 ? text.slice(0, 400) + '…' : text;
  Object.assign(ghost.style, {
    position: 'fixed', left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`,
    margin: '0', boxSizing: 'border-box', overflow: 'hidden', pointerEvents: 'none', zIndex: '10000', whiteSpace: 'pre-wrap',
    padding: look.padding, borderRadius: look.borderRadius, background: look.backgroundColor, color: look.color,
    font: look.font, lineHeight: look.lineHeight, boxShadow: '0 8px 24px rgba(0,0,0,.28)'
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(ghost);
  bubble.style.visibility = 'hidden';

  // Sai do canto direito do campo (onde estava o texto) e sobe até a bolha.
  const startLeft = Math.max(from.left, from.right - to.width);
  const dx = startLeft - to.left;
  const dy = from.top + Math.min(from.height, to.height) / 2 - (to.top + to.height / 2);
  const anim = ghost.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(.92)`, opacity: 0.35, offset: 0 },
    { transform: `translate(${dx * 0.25}px, ${dy * 0.25 - 6}px) scale(1.02)`, opacity: 1, offset: 0.7 },
    { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 1 }
  ], { duration: 420, easing: 'cubic-bezier(.2,.75,.25,1)' });
  const done = () => {
    ghost.remove();
    bubble.style.visibility = '';
  };
  anim.onfinish = done;
  anim.oncancel = done;
}
