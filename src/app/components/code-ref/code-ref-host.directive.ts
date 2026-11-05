import {
  ComponentRef, DestroyRef, Directive, ElementRef, Injector, afterNextRender, effect, inject, input, untracked,
} from '@angular/core';
import { ConnectedPosition, Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { CodeRefService } from './code-ref.service';
import {
  CODE_CHANGES, CodeRefHead, CodeRefTarget, changeMeta, citationText, linesLabel, matchCitation, parseCodeHref,
} from './code-ref.model';
import type { CodeRefPopoverComponent, CodeRefTab } from './code-ref-popover.component';
import { parseReHref, parseWorkHref } from '../../helpers/markdown-ext';

const LINK_SELECTOR = 'a.code-ref, a.code-cite';
const RE_SELECTOR = 'a.re-ref';
const WI_SELECTOR = 'a.wi-ref';
const IMG_SELECTOR = 'img.md-attachment';
const CHANGE_CLASSES = [...CODE_CHANGES.map(c => `code-ref--${c}`), 'code-ref--missing', 'code-cite--missing'];
const SHEET_MAX_WIDTH = 600;

const POSITIONS: ConnectedPosition[] = [
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
  { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -6 },
  { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
  { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -6 },
];

/** Um popover de código aberto por vez, na tela inteira (entre diretivas). */
let openPopover: { close: () => void } | null = null;

/**
 * Contêiner com markdown renderizado (0075/F2+F3): `<div [appCodeRefHost]="cardNumber">`.
 *
 * - **Clique** (e Enter) em `a.code-ref` / `a.code-cite` → abre o popover da fotografia de código
 *   ancorado no próprio link (overlay CDK; folha inferior em tela estreita). Esc/fora fecha e o foco
 *   volta ao link; um popover por vez.
 * - **Clique** em `a.re-ref` (`UC-121`, `modulo#RN-012` — 0076) → popover do item da engenharia
 *   reversa, no mesmo overlay/folha inferior.
 * - **Clique** em `a.wi-ref` (`#123` na conversa do especialista — 0090) → popover do item de trabalho.
 * - **Decora** os links depois de cada render (MutationObserver): classe `code-ref--<mudança>` e title
 *   "Alterar · caminho:linhas" a partir das cabeças do card (carregadas só quando há link na tela);
 *   citação sem ref ganha `code-cite--missing`.
 * - **Imagens** `img.md-attachment` (`anexo:<nome>` no title): carrega o arquivo do card pelo nome
 *   (blob autenticado → object URL, revogado ao destruir), legenda pelo `alt`, placeholder quando não
 *   acha, e o clique abre a imagem com zoom.
 */
@Directive({
  selector: '[appCodeRefHost]',
  standalone: true,
  host: { '(click)': 'onClick($event)' },
})
export class CodeRefHostDirective {
  /** Número do card dos textos do contêiner. */
  readonly card = input<string | number | null | undefined>(null, { alias: 'appCodeRefHost' });

  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private svc = inject(CodeRefService);
  private overlay = inject(Overlay);
  private injector = inject(Injector);
  private dialog = inject(MatDialog);

  private observer?: MutationObserver;
  private scheduled = 0;
  private destroyed = false;
  private watched: string | null = null;
  private heads: CodeRefHead[] | null = null;
  private headsCard: string | null = null;
  private headsLoading = false;

  /** Imagens: nome → object URL (deste contêiner; revogadas ao destruir). */
  private urls = new Map<string, Promise<string>>();
  private imgCard: string | null = null;
  private seenImgs = new WeakSet<HTMLImageElement>();

  private overlayRef: OverlayRef | null = null;
  private popoverRef: ComponentRef<unknown> | null = null;
  private popoverSubs: { unsubscribe(): void }[] = [];
  private anchor: HTMLElement | null = null;

  constructor() {
    afterNextRender(() => {
      if (this.destroyed) return;
      this.observer = new MutationObserver(() => this.schedule());
      this.observer.observe(this.host.nativeElement, { childList: true, subtree: true });
      this.schedule();
    });

    // Card mudou: tempo real do card novo, cabeças/imagens do card novo.
    effect(() => {
      const card = this.cardKey();
      untracked(() => {
        if (card === this.watched) return;
        if (this.watched) this.svc.unwatch(this.watched);
        this.watched = card || null;
        if (card) this.svc.watch(card);
        this.heads = null;
        this.headsCard = null;
        this.resetImages();
        this.schedule();
      });
    });

    // Tempo real: refs/arquivos do card mudaram → redecora/recarrega.
    effect(() => {
      const ch = this.svc.changes();
      untracked(() => {
        const card = this.cardKey();
        if (!ch || !card || (ch.card !== card)) return;
        if (ch.kind !== 'artifact') { this.heads = null; this.headsCard = null; }
        // Arquivo novo no card: tenta de novo só as imagens que faltavam (ex.: o texto chegou antes do upload).
        if (ch.kind !== 'codeRef') this.retryMissingImages();
        this.schedule();
      });
    });

    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.observer?.disconnect();
      if (this.scheduled) cancelAnimationFrame(this.scheduled);
      if (this.watched) this.svc.unwatch(this.watched);
      this.closePopover(false);
      this.resetImages();
    });
  }

  private cardKey(): string {
    const c = this.card();
    return c === null || c === undefined ? '' : `${c}`.trim();
  }

  // ── Clique ────────────────────────────────────────────────────────────────────────────────────

  onClick(event: MouseEvent): void {
    if ((event as MouseEvent & { __codeRef?: boolean }).__codeRef) return; // diretiva aninhada já tratou
    const el = event.target as HTMLElement | null;
    const wiLink = el?.closest<HTMLAnchorElement>(WI_SELECTOR);
    if (wiLink && this.host.nativeElement.contains(wiLink)) {
      const n = parseWorkHref(wiLink.getAttribute('href'));
      if (!n) return;
      (event as MouseEvent & { __codeRef?: boolean }).__codeRef = true;
      event.preventDefault();
      if (this.anchor === wiLink && this.overlayRef) { this.closePopover(true); return; }
      void this.openWorkItem(wiLink, n);
      return;
    }
    const reLink = el?.closest<HTMLAnchorElement>(RE_SELECTOR);
    if (reLink && this.host.nativeElement.contains(reLink)) {
      const ref = parseReHref(reLink.getAttribute('href'));
      if (!ref) return;
      (event as MouseEvent & { __codeRef?: boolean }).__codeRef = true;
      event.preventDefault();
      if (this.anchor === reLink && this.overlayRef) { this.closePopover(true); return; }
      void this.openReItem(reLink, ref);
      return;
    }
    const link = el?.closest<HTMLAnchorElement>(LINK_SELECTOR);
    if (link && this.host.nativeElement.contains(link)) {
      const target = parseCodeHref(link.getAttribute('href'));
      if (!target) return;
      (event as MouseEvent & { __codeRef?: boolean }).__codeRef = true;
      event.preventDefault();
      if (this.anchor === link && this.overlayRef) { this.closePopover(true); return; }
      void this.openPopover(link, target);
      return;
    }
    const img = el?.closest<HTMLImageElement>(IMG_SELECTOR);
    if (img && this.host.nativeElement.contains(img) && img.src && img.classList.contains('md-attachment--ok')) {
      (event as MouseEvent & { __codeRef?: boolean }).__codeRef = true;
      event.preventDefault();
      void this.openImage(img);
    }
  }

  // ── Popover ───────────────────────────────────────────────────────────────────────────────────

  private async openPopover(link: HTMLElement, target: CodeRefTarget): Promise<void> {
    openPopover?.close();
    const card = this.cardKey();
    const { CodeRefPopoverComponent } = await import('./code-ref-popover.component');
    if (this.destroyed || !link.isConnected) return;

    const { ref, sheet } = this.createOverlay(link, 'code-ref-pane');
    // Sem o MatDialogRef/MAT_DIALOG_DATA de um diálogo em volta (prévia dos arquivos, conversa): o
    // componente usa esses tokens para saber que está no modo "expandido".
    const injector = Injector.create({
      parent: this.injector,
      providers: [{ provide: MatDialogRef, useValue: null }, { provide: MAT_DIALOG_DATA, useValue: null }],
    });
    const comp = ref.attach(new ComponentPortal(CodeRefPopoverComponent, null, injector));
    comp.setInput('card', card);
    comp.setInput('target', target);
    comp.setInput('mode', sheet ? 'sheet' : 'popover');
    this.track(link, ref, comp, [
      comp.instance.closed.subscribe(() => this.closePopover(true)),
      comp.instance.expand.subscribe(tab => this.expand(card, target, tab)),
    ]);
  }

  /** 0076: popover do item da engenharia reversa (`UC-121`). */
  private async openReItem(link: HTMLElement, reRef: string): Promise<void> {
    openPopover?.close();
    const card = this.cardKey();
    const { ReItemPopoverComponent } = await import('./re-item-popover.component');
    if (this.destroyed || !link.isConnected) return;
    const { ref, sheet } = this.createOverlay(link, 're-item-pane');
    const comp = ref.attach(new ComponentPortal(ReItemPopoverComponent, null, this.injector));
    comp.setInput('card', card);
    comp.setInput('ref', reRef);
    comp.setInput('mode', sheet ? 'sheet' : 'popover');
    this.track(link, ref, comp, [comp.instance.closed.subscribe(() => this.closePopover(true))]);
  }

  /** 0090: popover do item de trabalho (`#123` na conversa do especialista). */
  private async openWorkItem(link: HTMLElement, number: number): Promise<void> {
    openPopover?.close();
    const card = this.cardKey();
    const { WorkItemPopoverComponent } = await import('../work-items/work-item-popover.component');
    if (this.destroyed || !link.isConnected) return;
    const { ref, sheet } = this.createOverlay(link, 'wi-item-pane');
    const comp = ref.attach(new ComponentPortal(WorkItemPopoverComponent, null, this.injector));
    comp.setInput('card', card);
    comp.setInput('number', number);
    comp.setInput('mode', sheet ? 'sheet' : 'popover');
    this.track(link, ref, comp, [comp.instance.closed.subscribe(() => this.closePopover(true))]);
  }

  /** Overlay ancorado no link (folha inferior em tela estreita). */
  private createOverlay(link: HTMLElement, pane: string): { ref: OverlayRef; sheet: boolean } {
    const sheet = window.innerWidth < SHEET_MAX_WIDTH;
    const positionStrategy = sheet
      ? this.overlay.position().global().centerHorizontally().bottom('0')
      : this.overlay.position()
          .flexibleConnectedTo(link)
          .withPositions(POSITIONS)
          .withPush(true)
          .withViewportMargin(8)
          .withFlexibleDimensions(false);
    const ref = this.overlay.create({
      positionStrategy,
      scrollStrategy: sheet ? this.overlay.scrollStrategies.block() : this.overlay.scrollStrategies.reposition(),
      hasBackdrop: true,
      backdropClass: sheet ? 'cdk-overlay-dark-backdrop' : 'cdk-overlay-transparent-backdrop',
      panelClass: [pane, sheet ? 'code-ref-pane--sheet' : 'code-ref-pane--popover'],
    });
    return { ref, sheet };
  }

  /** Guarda o popover aberto (um por vez), reposiciona ao mudar de tamanho e fecha com Esc/fora. */
  private track(link: HTMLElement, ref: OverlayRef, comp: ComponentRef<unknown>,
                subs: { unsubscribe(): void }[]): void {
    this.overlayRef = ref;
    this.popoverRef = comp;
    this.anchor = link;
    const handle = { close: () => this.closePopover(false) };
    openPopover = handle;

    // Conteúdo muda de tamanho ao carregar → reposiciona dentro da tela.
    const ro = new ResizeObserver(() => ref.updatePosition());
    ro.observe(ref.overlayElement);

    this.popoverSubs = [
      ref.backdropClick().subscribe(() => this.closePopover(true)),
      ref.keydownEvents().subscribe(ev => {
        if (ev.key === 'Escape' && !ev.defaultPrevented) { ev.preventDefault(); this.closePopover(true); }
      }),
      ref.detachments().subscribe(() => { ro.disconnect(); if (openPopover === handle) openPopover = null; }),
      ...subs,
    ];
  }

  private closePopover(restoreFocus: boolean): void {
    const ref = this.overlayRef;
    const anchor = this.anchor;
    this.popoverSubs.forEach(s => s.unsubscribe());
    this.popoverSubs = [];
    this.overlayRef = null;
    this.popoverRef = null;
    this.anchor = null;
    if (!ref) return;
    ref.dispose();
    if (restoreFocus && anchor?.isConnected) anchor.focus({ preventScroll: true });
  }

  private async expand(card: string, target: CodeRefTarget, tab: CodeRefTab): Promise<void> {
    const anchor = this.anchor;
    this.closePopover(false);
    const { CodeRefPopoverComponent } = await import('./code-ref-popover.component');
    const ref = this.dialog.open(CodeRefPopoverComponent, {
      data: { card, target, tab },
      width: 'min(1200px, 96vw)',
      maxWidth: '96vw',
      height: 'min(880px, 92vh)',
      panelClass: 'code-ref-dialog',
      autoFocus: false,
      restoreFocus: false,
    });
    ref.afterClosed().subscribe(() => { if (anchor?.isConnected) anchor.focus({ preventScroll: true }); });
  }

  // ── Decoração (depois de cada render) ─────────────────────────────────────────────────────────

  private schedule(): void {
    if (this.destroyed || this.scheduled) return;
    this.scheduled = requestAnimationFrame(() => {
      this.scheduled = 0;
      this.decorate();
    });
  }

  private decorate(): void {
    if (this.destroyed) return;
    const root = this.host.nativeElement;
    const card = this.cardKey();
    const links = root.querySelectorAll<HTMLAnchorElement>(LINK_SELECTOR);
    if (links.length && card) {
      if (this.heads && this.headsCard === card) this.decorateLinks(links, this.heads);
      else this.loadHeads(card);
    }
    const imgs = root.querySelectorAll<HTMLImageElement>(IMG_SELECTOR);
    if (imgs.length) this.decorateImages(imgs, card);
  }

  private loadHeads(card: string): void {
    if (this.headsLoading) return;
    this.headsLoading = true;
    this.svc.loadHeads(card).then(heads => {
      this.headsLoading = false;
      if (this.destroyed) return;
      if (card !== this.cardKey()) { this.schedule(); return; }
      this.heads = heads;
      this.headsCard = card;
      this.decorateLinks(this.host.nativeElement.querySelectorAll<HTMLAnchorElement>(LINK_SELECTOR), heads);
    });
  }

  private decorateLinks(links: NodeListOf<HTMLAnchorElement>, heads: CodeRefHead[]): void {
    links.forEach(a => {
      const target = parseCodeHref(a.getAttribute('href'));
      if (!target) return;
      const head = target.kind === 'ref'
        ? heads.find(h => h.ref === target.id) ?? null
        : matchCitation(heads, target.path, target.start, target.end);
      let cls: string;
      let title: string;
      if (head) {
        const m = changeMeta(head.change);
        cls = `code-ref--${CODE_CHANGES.includes(head.change as never) ? head.change : 'read'}`;
        title = `${m.label} · ${citationText(head.path, head.startLine, head.endLine)}${head.title ? ` — ${head.title}` : ''}`;
      } else if (target.kind === 'ref') {
        cls = 'code-ref--missing';
        title = `Referência "${target.id}" sem fotografia neste card`;
      } else {
        cls = 'code-cite--missing';
        title = `Sem fotografia · ${target.path}:${linesLabel(target.start, target.end).replace('–', '-')}`;
      }
      if (!a.classList.contains(cls) || a.title !== title) {
        a.classList.remove(...CHANGE_CLASSES);
        a.classList.add(cls);
        a.title = title;
      }
      if (!a.hasAttribute('aria-haspopup')) a.setAttribute('aria-haspopup', 'dialog');
    });
  }

  // ── Imagens anexo: (F3) ───────────────────────────────────────────────────────────────────────

  private decorateImages(imgs: NodeListOf<HTMLImageElement>, card: string): void {
    if (card !== this.imgCard) { this.resetImages(); this.imgCard = card; }
    imgs.forEach(img => {
      if (this.seenImgs.has(img)) return;
      const name = attachmentName(img);
      if (!name) return;
      this.seenImgs.add(img);
      const figure = wrapFigure(img, name);
      if (!card) { markMissing(img, figure); return; }
      img.classList.add('md-attachment--loading');
      img.removeAttribute('src');
      this.urlFor(card, name).then(
        url => {
          if (this.destroyed || !img.isConnected) return;
          img.classList.remove('md-attachment--loading');
          img.classList.add('md-attachment--ok');
          img.onerror = () => markMissing(img, figure);
          img.src = url;
        },
        () => { if (!this.destroyed) markMissing(img, figure); },
      );
    });
  }

  private urlFor(card: string, name: string): Promise<string> {
    let p = this.urls.get(name);
    if (!p) {
      p = this.svc.attachment(card, name).then(blob => URL.createObjectURL(blob));
      p.catch(() => { if (this.urls.get(name) === p) this.urls.delete(name); });
      this.urls.set(name, p);
    }
    return p;
  }

  private retryMissingImages(): void {
    this.host.nativeElement.querySelectorAll<HTMLElement>('.md-figure--missing').forEach(figure => {
      const img = figure.querySelector<HTMLImageElement>(IMG_SELECTOR);
      figure.classList.remove('md-figure--missing');
      if (img) this.seenImgs.delete(img);
    });
  }

  private resetImages(): void {
    for (const p of this.urls.values()) p.then(url => URL.revokeObjectURL(url), () => undefined);
    this.urls.clear();
    this.seenImgs = new WeakSet();
  }

  private async openImage(img: HTMLImageElement): Promise<void> {
    const { MdImageViewerComponent } = await import('./md-image-viewer.component');
    const name = attachmentName(img) ?? '';
    this.dialog.open(MdImageViewerComponent, {
      data: { url: img.src, name, alt: img.alt },
      width: '96vw',
      maxWidth: '96vw',
      height: '92vh',
      panelClass: 'md-image-dialog',
      autoFocus: false,
    });
  }
}

/** Nome do anexo: o title `anexo:<nome>` (guardado no elemento ao processar). */
function attachmentName(img: HTMLImageElement): string | null {
  const stored = (img as HTMLImageElement & { __anexo?: string }).__anexo;
  if (stored) return stored;
  const m = /^anexo:(.+)$/i.exec(img.getAttribute('title') ?? '');
  const name = m ? m[1].trim() : null;
  if (name) {
    (img as HTMLImageElement & { __anexo?: string }).__anexo = name;
    img.title = img.alt || name;
  }
  return name;
}

/** `<span class="md-figure">` em volta da imagem, com a legenda (alt) e o aviso de não encontrada. */
function wrapFigure(img: HTMLImageElement, name: string): HTMLElement {
  const parent = img.parentElement;
  if (parent?.classList.contains('md-figure')) return parent;
  const figure = document.createElement('span');
  figure.className = 'md-figure';
  img.replaceWith(figure);
  figure.appendChild(img);
  const missing = document.createElement('span');
  missing.className = 'md-figure__missing';
  missing.setAttribute('role', 'img');
  missing.setAttribute('aria-label', `Imagem não encontrada: ${name}`);
  missing.textContent = `Imagem não encontrada · ${name}`;
  figure.appendChild(missing);
  if (img.alt) {
    const caption = document.createElement('span');
    caption.className = 'md-figure__caption';
    caption.textContent = img.alt;
    figure.appendChild(caption);
  }
  return figure;
}

function markMissing(img: HTMLImageElement, figure: HTMLElement): void {
  img.classList.remove('md-attachment--loading', 'md-attachment--ok');
  img.removeAttribute('src');
  figure.classList.add('md-figure--missing');
}
