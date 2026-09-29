import {
  AfterViewInit, Component, DestroyRef, Directive, ElementRef, computed, contentChildren, effect, inject, input,
  output, signal, viewChild,
} from '@angular/core';
import { CdkOverlayOrigin, OverlayModule } from '@angular/cdk/overlay';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CcPopoverComponent } from '../popover/cc-popover.component';

/**
 * Item da `app-action-toolbar` (feature 0021). Vai no elemento que envolve o botão (não no
 * componente com `display: contents`, que não tem largura). Escondido, o elemento continua vivo
 * (`display: none`) — popovers dos componentes internos seguem funcionando a partir do "⋯".
 *
 *   <span appToolbarItem="save" toolbarLabel="Salvar" toolbarIcon="save"
 *         [toolbarDisabled]="!canSave" (toolbarActivate)="save()">
 *     <button mat-raised-button ...>Salvar</button>
 *   </span>
 *
 * `toolbarActivate` recebe a âncora do "⋯": itens com popover próprio (`toolbarSubmenu`) abrem ali.
 */
@Directive({
  selector: '[appToolbarItem]',
  standalone: true,
  host: {
    '[style.display]': "hidden() ? 'none' : 'inline-flex'",
    '[style.flex]': "'none'",
    '[style.align-items]': "'center'",
  },
})
export class ToolbarItemDirective {
  readonly id = input.required<string>({ alias: 'appToolbarItem' });
  readonly label = input.required<string>({ alias: 'toolbarLabel' });
  readonly icon = input('', { alias: 'toolbarIcon' });
  readonly disabled = input(false, { alias: 'toolbarDisabled' });
  /** Abre um popover próprio (mostra › no menu do "⋯"). */
  readonly submenu = input(false, { alias: 'toolbarSubmenu' });
  readonly activate = output<CdkOverlayOrigin>({ alias: 'toolbarActivate' });

  readonly element: HTMLElement = inject(ElementRef<HTMLElement>).nativeElement;
  readonly hidden = signal(false);
  /** Última largura medida visível (escondido, a largura real é 0). */
  private lastWidth = 0;

  width(): number {
    if (!this.hidden()) {
      const w = this.element.getBoundingClientRect().width;
      if (w > 0) this.lastWidth = w;
    }
    return this.lastWidth;
  }
}

/** Espaço entre os itens (igual ao `gap` da `.tb-row`). */
const GAP = 10;
/** Largura do botão "⋯" (igual ao CSS da `.tb-more`). */
const MORE_WIDTH = 40;

/**
 * Barra de ações que se adapta à largura (feature 0021): mostra os itens que cabem, na ordem, e
 * move os que não cabem (da direita para a esquerda) para o menu do botão "⋯". Recalcula com
 * `ResizeObserver` (janela, painel lateral, rótulo/ícone que muda de tamanho).
 */
@Component({
  selector: 'app-action-toolbar',
  standalone: true,
  imports: [OverlayModule, MatButtonModule, MatIconModule, MatTooltipModule, CcPopoverComponent],
  template: `
    <div class="tb-row" #row>
      <ng-content></ng-content>
      <button mat-icon-button type="button" class="tb-more" [class.tb-more--hidden]="overflow().length === 0"
              cdkOverlayOrigin #moreOrigin="cdkOverlayOrigin"
              matTooltip="Mais ações" matTooltipPosition="above" aria-label="Mais ações"
              (click)="pop.toggle(moreOrigin)">
        <mat-icon>more_horiz</mat-icon>
      </button>
    </div>

    <cc-popover #pop>
      <div class="tb-list" role="menu">
        @for (item of overflow(); track item.id()) {
          <button type="button" class="tb-item" role="menuitem" [disabled]="item.disabled()" (click)="run(item)">
            @if (item.icon()) { <mat-icon>{{ item.icon() }}</mat-icon> }
            <span>{{ item.label() }}</span>
            @if (item.submenu()) { <mat-icon class="tb-item__caret">chevron_right</mat-icon> }
          </button>
        }
      </div>
    </cc-popover>
  `,
  styles: [`
    :host { display: block; flex: 1 1 auto; min-width: 0; }
    .tb-row { display: flex; flex-wrap: nowrap; align-items: center; gap: 10px; min-width: 0; }
    .tb-more.mat-mdc-icon-button {
      flex: none; width: 40px; height: 40px; padding: 0;
      --mdc-icon-button-state-layer-size: 40px;
      color: var(--mat-sys-primary);
    }
    .tb-more--hidden { display: none; }

    /* Mesmo visual das opções do "Ações DevOps" */
    .tb-list { display: flex; flex-direction: column; gap: 1px; width: 230px; max-width: calc(100vw - 60px); margin: -6px -8px; }
    .tb-item {
      display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
      padding: 9px 8px; border: none; border-radius: 8px; background: none; font: inherit; font-size: 13px;
      color: var(--cc-text-1, inherit); cursor: pointer;
    }
    .tb-item:hover:not(:disabled) { background: var(--cc-surface-2, rgba(255,255,255,.06)); }
    .tb-item:disabled { opacity: .45; cursor: default; }
    .tb-item mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--cc-text-2, inherit); }
    .tb-item__caret { margin-left: auto; }
  `],
})
export class ActionToolbarComponent implements AfterViewInit {
  private readonly host: HTMLElement = inject(ElementRef<HTMLElement>).nativeElement;
  private readonly items = contentChildren(ToolbarItemDirective);
  private readonly pop = viewChild.required(CcPopoverComponent);
  private readonly moreOrigin = viewChild.required<CdkOverlayOrigin>('moreOrigin');

  /** Itens que não couberam (na ordem da barra). */
  readonly overflow = computed(() => this.items().filter(i => i.hidden()));

  private observer?: ResizeObserver;
  private frame = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.observer?.disconnect();
      cancelAnimationFrame(this.frame);
    });
    // Itens que entram/saem (ex.: @if) → observa e recalcula.
    effect(() => {
      const items = this.items();
      if (!this.observer) return;
      for (const item of items) this.observer.observe(item.element);
      this.schedule();
    });
  }

  ngAfterViewInit(): void {
    this.observer = new ResizeObserver(() => this.schedule());
    this.observer.observe(this.host);
    for (const item of this.items()) this.observer.observe(item.element);
    this.schedule();
  }

  run(item: ToolbarItemDirective): void {
    if (item.disabled()) return;
    this.pop().close();
    item.activate.emit(this.moreOrigin());
  }

  private schedule(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.layout());
  }

  private layout(): void {
    const items = this.items();
    const available = this.host.clientWidth;
    if (!items.length || available <= 0) return;

    const widths = items.map(i => i.width());
    const total = widths.reduce((sum, w) => sum + w, 0) + GAP * (items.length - 1);

    if (total <= available) {
      for (const item of items) item.hidden.set(false);
    } else {
      // Não cabe tudo: reserva o "⋯" e mantém os primeiros itens que couberem.
      const room = available - MORE_WIDTH - GAP;
      let used = 0;
      let fits = true;
      items.forEach((item, index) => {
        const w = widths[index] + (index > 0 ? GAP : 0);
        fits = fits && used + w <= room;
        if (fits) used += w;
        item.hidden.set(!fits);
      });
    }
    if (this.overflow().length === 0) this.pop().close();
  }
}
