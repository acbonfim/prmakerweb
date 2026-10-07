import { Component, ElementRef, Injector, OnDestroy, afterNextRender, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { PlanMarkdownPipe } from '../execution-plan/plan-markdown.pipe';
import { renderMermaidIn } from '../../helpers/mermaid-loader';
import { splitMarkdown } from './split-markdown';

/** 0070: documento que vem em pedaços do servidor — o sumário (IDs e altura estimada de cada pedaço) e quem busca o texto. */
export interface MarkdownPartsSource {
  /** Muda quando o conteúdo muda (a marca do servidor): recomeça do primeiro pedaço. */
  key: string;
  chunks: { index: number; ids: string[]; estimate: number }[];
  load(from: number, to: number): Observable<{ index: number; text: string }[]>;
}

interface ChunkView { ids: string[]; estimate: number; text: string | null; }

/** Pedaços buscados por pedido (o servidor aceita até 8). */
const BATCH = 4;
/** Textos de pedaços remotos guardados (os demais são buscados de novo — o navegador tem em cache). */
const KEEP_TEXTS = 24;

/**
 * Markdown grande desenhado sob demanda: o documento vira pedaços e só os que estão perto da área visível são convertidos
 * para HTML. 0070: os que se afastam são desmontados (ficam como espaço reservado com a altura medida — a memória não
 * cresce ao rolar) e o texto pode vir do servidor pedaço a pedaço (`source`) em vez do documento inteiro (`content`).
 * Põe as âncoras <c>item-RN-012</c> nos cabeçalhos e desenha os diagramas mermaid de cada pedaço quando ele aparece.
 */
@Component({
  selector: 'app-lazy-markdown',
  standalone: true,
  imports: [PlanMarkdownPipe],
  template: `
    @for (c of chunks(); track $index) {
      <div class="lm-chunk" [attr.data-chunk]="$index" [style.min-height.px]="rendered($index) ? null : heightOf($index, c.estimate)">
        @if (shown().has($index)) {
          @if (textOf($index); as t) { <div [innerHTML]="t | planMarkdown"></div> }
          @else if (failed().has($index)) { <button type="button" class="lm-retry" (click)="retry($index)">Não foi possível carregar este trecho — tentar de novo</button> }
          @else { <div class="lm-loading">Carregando…</div> }
        }
      </div>
    }
  `,
  styles: [`:host { display: block; } .lm-chunk { overflow-anchor: auto; }
    .lm-loading { color: var(--mat-sys-on-surface-variant, #888); font-size: 13px; padding: 12px 0; }
    .lm-retry { background: none; border: 0; color: var(--mat-sys-primary, #3b82f6); cursor: pointer; padding: 12px 0; font: inherit; }`]
})
export class LazyMarkdownComponent implements OnDestroy {
  private host = inject(ElementRef<HTMLElement>);
  private injector = inject(Injector);

  content = input<string | null | undefined>('');
  /** 0070: pedaços do servidor (tem preferência sobre `content`). */
  source = input<MarkdownPartsSource | null | undefined>(null);
  /** Tamanho alvo de cada pedaço (caracteres) quando o texto vem inteiro. */
  chunkSize = input(30_000);

  chunks = computed<ChunkView[]>(() => {
    const source = this.source();
    if (source) return source.chunks.map(c => ({ ids: c.ids, estimate: c.estimate, text: null }));
    return splitMarkdown(this.content() ?? '', this.chunkSize()).map(c => ({ ids: c.ids, estimate: c.estimate, text: c.text }));
  });
  /** Pedaços montados agora (perto da área visível). */
  shown = signal<Set<number>>(new Set([0]));
  /** Texto dos pedaços remotos já buscados. */
  private texts = signal<Map<number, string>>(new Map());
  failed = signal<Set<number>>(new Set());

  private observer?: IntersectionObserver;
  private decorated = new Set<number>();
  private heights = new Map<number, number>();
  private loading = new Set<number>();
  private subs: Subscription[] = [];
  /** Pedido de rolagem: qual pedaço montar e como achar o elemento depois de desenhado. */
  private pending: { chunk: () => number; locate: (root: HTMLElement) => HTMLElement | null; flash: string | null; until: number } | null = null;

  constructor() {
    // Conteúdo novo: volta ao primeiro pedaço e observa os pedaços depois de desenhar.
    effect(() => {
      this.chunks();
      untracked(() => {
        this.subs.forEach(s => s.unsubscribe());
        this.subs = [];
        this.loading.clear();
        this.heights.clear();
        this.decorated.clear();
        this.texts.set(new Map());
        this.failed.set(new Set());
        this.shown.set(new Set([0]));
        this.request([0]);
        afterNextRender(() => { this.observe(); this.afterRender(); }, { injector: this.injector });
      });
    });
  }

  ngOnDestroy() {
    this.observer?.disconnect();
    this.subs.forEach(s => s.unsubscribe());
  }

  textOf(index: number): string | null {
    const chunk = this.chunks()[index];
    return chunk?.text ?? this.texts().get(index) ?? null;
  }

  rendered(index: number) { return this.shown().has(index) && this.textOf(index) !== null; }

  heightOf(index: number, estimate: number) { return this.heights.get(index) ?? estimate; }

  /** Rola até o item (montando o pedaço dele antes). Devolve false se o item não está no documento. */
  reveal(id: string, flash = true): boolean {
    return this.revealBy(() => this.chunks().findIndex(c => c.ids.includes(id)), root => root.querySelector<HTMLElement>(`[id="item-${id}"]`),
      flash ? 'flash' : null);
  }

  /**
   * 0070: rola até um elemento que só existe depois que o pedaço dele é desenhado (ex.: um cabeçalho pelo texto).
   * <paramref name="contains"/> diz se o texto do pedaço tem o alvo (só com o texto local); <paramref name="locate"/> acha o elemento.
   */
  revealText(contains: (text: string) => boolean, locate: (root: HTMLElement) => HTMLElement | null, flashClass: string | null = 'flash'): boolean {
    return this.revealBy(() => this.chunks().findIndex(c => c.text !== null && contains(c.text)), locate, flashClass);
  }

  private revealBy(chunk: () => number, locate: (root: HTMLElement) => HTMLElement | null, flash: string | null): boolean {
    this.pending = { chunk, locate, flash, until: Date.now() + 10_000 };
    const index = chunk();
    if (index < 0) return false;  // conteúdo ainda não chegou: o próximo afterRender tenta de novo
    this.show([index]);
    return true;
  }

  retry(index: number) {
    this.failed.update(s => { const n = new Set(s); n.delete(index); return n; });
    this.request([index]);
  }

  private show(indexes: number[]) {
    const add = indexes.filter(i => !this.shown().has(i));
    if (add.length) this.shown.update(s => { const n = new Set(s); add.forEach(i => n.add(i)); return n; });
    this.request(indexes);
    afterNextRender(() => this.afterRender(), { injector: this.injector });
  }

  /** Desmonta os pedaços que se afastaram, guardando a altura medida (o espaço reservado não deixa a página pular). */
  private hide(indexes: number[]) {
    const el = this.host.nativeElement as HTMLElement;
    const remove = indexes.filter(i => this.shown().has(i));
    if (!remove.length) return;
    for (const i of remove) {
      const chunk = el.querySelector<HTMLElement>(`.lm-chunk[data-chunk="${i}"]`);
      if (chunk && this.rendered(i)) this.heights.set(i, chunk.offsetHeight);
      this.decorated.delete(i);
    }
    this.shown.update(s => { const n = new Set(s); remove.forEach(i => n.delete(i)); return n; });
    this.forgetFarTexts();
  }

  /** Busca no servidor os pedaços remotos que faltam (em lotes de pedaços seguidos). */
  private request(indexes: number[]) {
    const source = this.source();
    if (!source) return;
    const missing = [...new Set(indexes)].filter(i => i >= 0 && i < source.chunks.length && !this.texts().has(i) && !this.loading.has(i))
      .sort((a, b) => a - b);
    while (missing.length) {
      const from = missing.shift()!;
      let to = from;
      while (missing.length && missing[0] === to + 1 && to - from + 1 < BATCH) to = missing.shift()!;
      for (let i = from; i <= to; i++) this.loading.add(i);
      const key = source.key;
      this.subs.push(source.load(from, to).subscribe({
        next: parts => {
          if (this.source()?.key !== key) return;
          this.texts.update(m => { const n = new Map(m); parts.forEach(p => n.set(p.index, p.text)); return n; });
          for (let i = from; i <= to; i++) this.loading.delete(i);
          afterNextRender(() => this.afterRender(), { injector: this.injector });
        },
        error: () => {
          for (let i = from; i <= to; i++) this.loading.delete(i);
          this.failed.update(s => { const n = new Set(s); for (let i = from; i <= to; i++) n.add(i); return n; });
        }
      }));
    }
  }

  /** Guarda só o texto dos pedaços remotos montados e os mais próximos deles. */
  private forgetFarTexts() {
    const texts = this.texts();
    if (!this.source() || texts.size <= KEEP_TEXTS) return;
    const shown = [...this.shown()];
    const distance = (i: number) => shown.length ? Math.min(...shown.map(s => Math.abs(s - i))) : i;
    const keep = new Set([...texts.keys()].sort((a, b) => distance(a) - distance(b)).slice(0, KEEP_TEXTS));
    this.texts.set(new Map([...texts].filter(([i]) => keep.has(i))));
  }

  private observe() {
    this.observer?.disconnect();
    const el = this.host.nativeElement as HTMLElement;
    this.observer = new IntersectionObserver(entries => {
      const near = entries.filter(e => e.isIntersecting).map(e => Number((e.target as HTMLElement).dataset['chunk']));
      const far = entries.filter(e => !e.isIntersecting).map(e => Number((e.target as HTMLElement).dataset['chunk']));
      if (near.length) this.show(near);
      if (far.length) this.hide(far);
    }, { root: scrollParent(el), rootMargin: '1600px 0px' });
    el.querySelectorAll<HTMLElement>('.lm-chunk').forEach(c => this.observer!.observe(c));
  }

  /** Âncoras e mermaid nos pedaços recém-desenhados; depois o item pedido (reveal). */
  private afterRender() {
    const el = this.host.nativeElement as HTMLElement;
    const diagrams: Promise<void>[] = [];
    for (const i of this.shown()) {
      if (this.decorated.has(i)) continue;
      const chunk = el.querySelector<HTMLElement>(`.lm-chunk[data-chunk="${i}"]`);
      if (!chunk?.firstElementChild || !this.rendered(i)) continue;
      this.decorated.add(i);
      chunk.querySelectorAll('h2, h3, h4').forEach(h => {
        const m = /^\s*([A-Z]{2,4}-\d{1,4})\b/.exec(h.textContent ?? '');
        if (m && !h.id) h.id = `item-${m[1]}`;
      });
      diagrams.push(renderMermaidIn(chunk));
    }
    const p = this.pending;
    if (!p || Date.now() > p.until) return;
    const target = p.locate(el);
    if (!target) {
      // conteúdo trocou depois do reveal (ou o pedaço ainda está chegando): procura o pedaço de novo
      const index = p.chunk();
      if (index >= 0 && !this.rendered(index)) this.show([index]);
      return;
    }
    this.pending = null;
    target.scrollIntoView({ behavior: p.flash ? 'smooth' : 'auto', block: 'start' });
    if (p.flash) {
      const flash = p.flash;
      target.classList.add(flash);
      setTimeout(() => target.classList.remove(flash), flash === 'flash' ? 1800 : 2400);
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
