import { Component, ElementRef, Injector, OnDestroy, afterNextRender, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { PlanMarkdownPipe } from '../execution-plan/plan-markdown.pipe';
import { renderMermaidIn } from '../../helpers/mermaid-loader';
import { splitMarkdown } from './split-markdown';

/**
 * Markdown grande desenhado sob demanda: o documento vira pedaços e só os que chegam perto da área visível são
 * convertidos para HTML (os outros ficam como espaço reservado com a altura estimada). Documentos da engenharia
 * reversa passam de milhões de caracteres — desenhar tudo de uma vez travava o navegador. Põe as âncoras
 * <c>item-RN-012</c> nos cabeçalhos e desenha os diagramas mermaid de cada pedaço quando ele aparece.
 */
@Component({
  selector: 'app-lazy-markdown',
  standalone: true,
  imports: [PlanMarkdownPipe],
  template: `
    @for (c of chunks(); track $index) {
      <div class="lm-chunk" [attr.data-chunk]="$index" [style.min-height.px]="shown().has($index) ? null : c.estimate">
        @if (shown().has($index)) { <div [innerHTML]="c.text | planMarkdown"></div> }
      </div>
    }
  `,
  styles: [`:host { display: block; } .lm-chunk { overflow-anchor: auto; }`]
})
export class LazyMarkdownComponent implements OnDestroy {
  private host = inject(ElementRef<HTMLElement>);
  private injector = inject(Injector);

  content = input<string | null | undefined>('');
  /** Tamanho alvo de cada pedaço (caracteres). */
  chunkSize = input(30_000);

  chunks = computed(() => splitMarkdown(this.content() ?? '', this.chunkSize()));
  /** Pedaços já desenhados (ficam desenhados — rolar de volta não redesenha). */
  shown = signal<Set<number>>(new Set([0]));

  private observer?: IntersectionObserver;
  private decorated = new Set<number>();
  private pending: { id: string; flash: boolean; until: number } | null = null;

  constructor() {
    // Conteúdo novo: volta ao primeiro pedaço e observa os espaços reservados depois de desenhar.
    effect(() => {
      this.chunks();
      untracked(() => {
        this.shown.set(new Set([0]));
        this.decorated.clear();
        afterNextRender(() => { this.observe(); this.afterRender(); }, { injector: this.injector });
      });
    });
  }

  ngOnDestroy() { this.observer?.disconnect(); }

  /** Rola até o item (desenhando o pedaço dele antes). Devolve false se o item não está no documento. */
  reveal(id: string, flash = true): boolean {
    this.pending = { id, flash, until: Date.now() + 4000 };
    const index = this.chunks().findIndex(c => c.ids.includes(id));
    if (index < 0) return false;  // conteúdo ainda não chegou: o próximo afterRender tenta de novo
    this.show(index);
    return true;
  }

  private show(index: number) {
    if (!this.shown().has(index)) this.shown.update(s => new Set(s).add(index));
    afterNextRender(() => this.afterRender(), { injector: this.injector });
  }

  private observe() {
    this.observer?.disconnect();
    const el = this.host.nativeElement as HTMLElement;
    this.observer = new IntersectionObserver(entries => {
      const add = entries.filter(e => e.isIntersecting).map(e => Number((e.target as HTMLElement).dataset['chunk']));
      if (!add.length) return;
      this.shown.update(s => { const n = new Set(s); add.forEach(i => n.add(i)); return n; });
      for (const e of entries) if (e.isIntersecting) this.observer?.unobserve(e.target);
      afterNextRender(() => this.afterRender(), { injector: this.injector });
    }, { root: scrollParent(el), rootMargin: '1200px 0px' });
    el.querySelectorAll<HTMLElement>('.lm-chunk').forEach(c => { if (!this.shown().has(Number(c.dataset['chunk']))) this.observer!.observe(c); });
  }

  /** Âncoras e mermaid nos pedaços recém-desenhados; depois o item pedido (reveal). */
  private afterRender() {
    const el = this.host.nativeElement as HTMLElement;
    const diagrams: Promise<void>[] = [];
    for (const i of this.shown()) {
      if (this.decorated.has(i)) continue;
      const chunk = el.querySelector<HTMLElement>(`.lm-chunk[data-chunk="${i}"]`);
      if (!chunk?.firstElementChild) continue;
      this.decorated.add(i);
      chunk.querySelectorAll('h2, h3, h4').forEach(h => {
        const m = /^\s*([A-Z]{2,4}-\d{1,4})\b/.exec(h.textContent ?? '');
        if (m && !h.id) h.id = `item-${m[1]}`;
      });
      diagrams.push(renderMermaidIn(chunk));
    }
    const p = this.pending;
    if (!p || Date.now() > p.until) return;
    const target = el.querySelector<HTMLElement>(`[id="item-${p.id}"]`);
    if (!target) {
      // conteúdo trocou depois do reveal: procura o pedaço de novo
      const index = this.chunks().findIndex(c => c.ids.includes(p.id));
      if (index >= 0 && !this.shown().has(index)) this.show(index);
      return;
    }
    this.pending = null;
    target.scrollIntoView({ behavior: p.flash ? 'smooth' : 'auto', block: 'start' });
    if (p.flash) {
      target.classList.add('flash');
      setTimeout(() => target.classList.remove('flash'), 1800);
    }
    // o diagrama muda a altura: depois de desenhar, rola de novo até o item
    if (diagrams.length) Promise.all(diagrams).then(() => target.isConnected && target.scrollIntoView({ block: 'start' }));
  }
}

/** Ancestral com rolagem (a revisão rola dentro de um bloco; o documento publicado, na área da página). */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}
