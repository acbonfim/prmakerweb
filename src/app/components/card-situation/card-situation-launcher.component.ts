import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CardSituationComponent } from './card-situation.component';
import { CardSituationService, SITUATION_TITLES, situationAgo, situationMeta } from './card-situation.service';

/** A mesma abertura do botão das sugestões: sai do botão e cresce até o tamanho final. */
const OPEN_ANIMATION: KeyframeAnimationOptions = { duration: 320, easing: 'cubic-bezier(0.2, 0, 0, 1)' };
const RADIUS = 14;
/** Esperas que dependem da pessoa: o botão pisca (as outras — chamado, aprovação de PR — só ficam coloridas). */
const ON_YOU: ReadonlySet<string> = new Set(['user', 'answer', 'ticket-open', 'qa-validation']);

/**
 * Botão da "Situação atual" (0075/F4) na barra de horas da Bancada, ao lado do das sugestões (card 78655: o banner fixo
 * tomava o espaço da lista e da sessão de execução). Mesmo comportamento do botão das sugestões, em laranja: colorido
 * quando o card aguarda algo, piscando quando a espera é sua; o clique abre o cartão da situação num popover que sai
 * do botão.
 */
@Component({
  selector: 'app-card-situation-launcher',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule, CdkOverlayOrigin, CdkConnectedOverlay, CardSituationComponent],
  template: `
    @if (card()) {
      <button type="button" class="sl" [class.sl--on]="waiting()" [class.sl--you]="onYou()" [class.sl--open]="open()"
              cdkOverlayOrigin #origin="cdkOverlayOrigin" #button
              [attr.aria-expanded]="open()" aria-haspopup="dialog" [attr.aria-label]="tooltip()"
              [matTooltip]="open() ? '' : tooltip()" (click)="toggle()">
        <span class="sl__glow" aria-hidden="true"></span>
        <mat-icon class="sl__icon">{{ icon() }}</mat-icon>
      </button>
      <ng-template cdkConnectedOverlay [cdkConnectedOverlayOrigin]="origin" [cdkConnectedOverlayOpen]="open()"
                   [cdkConnectedOverlayPositions]="positions" [cdkConnectedOverlayHasBackdrop]="true"
                   cdkConnectedOverlayBackdropClass="cdk-overlay-transparent-backdrop" [cdkConnectedOverlayPush]="true"
                   (attach)="onAttach()" (backdropClick)="close()" (detach)="onDetach()" (overlayKeydown)="onKey($event)">
        <div class="sl-pop" #panel role="dialog" aria-label="Situação atual do card">
          @if (waiting()) {
            <app-card-situation variant="popover" [cardNumber]="card()"></app-card-situation>
          } @else {
            <p class="sl-pop__none"><mat-icon>check_circle</mat-icon>Nada aguardando agora — o tratamento segue normalmente.</p>
          }
        </div>
      </ng-template>
    }
  `,
  styles: [`
    :host { display: inline-flex; flex: none; }
    .sl { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0;
      border: 1px solid transparent; border-radius: 50%; background: none; cursor: pointer;
      color: color-mix(in srgb, #f0883e 62%, var(--mat-sys-on-surface)); opacity: .75; transition: background-color .15s ease, opacity .15s ease; }
    .sl:hover, .sl--open { opacity: 1; background: color-mix(in srgb, #f0883e 16%, transparent); }
    .sl:focus-visible { outline: 2px solid #58a6ff; outline-offset: 2px; }
    .sl__icon { position: relative; font-size: 17px; width: 17px; height: 17px; }
    .sl__glow { position: absolute; inset: 0; border-radius: 50%; pointer-events: none; }

    /* Aguardando algo: laranja; a espera é sua → pisca e se mexe como o botão das sugestões. */
    .sl--on { opacity: 1; color: #fff;
      background: linear-gradient(135deg, color-mix(in srgb, #f0883e 75%, transparent), color-mix(in srgb, #d29922 75%, transparent)); }
    .sl--on:hover, .sl--on.sl--open { background: linear-gradient(135deg, #f0883e, #d29922); }
    .sl--you .sl__glow { animation: sl-glow 1.4s ease-in-out infinite; }
    .sl--you .sl__glow::after { content: ''; position: absolute; inset: 0; border-radius: 50%; border: 2px solid #ffa657;
      animation: sl-ping 1.4s cubic-bezier(0, 0, .2, 1) infinite; }
    .sl--you .sl__icon { animation: sl-bob 1.4s ease-in-out infinite; }
    .sl--open .sl__glow, .sl--open .sl__glow::after, .sl--open .sl__icon { animation: none; }
    @keyframes sl-glow {
      0%, 100% { box-shadow: 0 0 0 0 transparent; }
      50% { box-shadow: 0 0 12px 3px color-mix(in srgb, #ffa657 55%, transparent); }
    }
    @keyframes sl-ping {
      0% { transform: scale(.6); opacity: .9; }
      80%, 100% { transform: scale(1.8); opacity: 0; }
    }
    @keyframes sl-bob { 0%, 100% { transform: translateY(0) rotate(0); } 25% { transform: translateY(-2px) rotate(-6deg); } 75% { transform: translateY(1px) rotate(6deg); } }
    @media (prefers-reduced-motion: reduce) { .sl__glow, .sl__glow::after, .sl__icon { animation: none !important; } }

    .sl-pop { width: min(560px, calc(100vw - 24px)); max-height: min(72vh, 640px); overflow-y: auto; scrollbar-width: thin; padding: 4px 2px;
      border-radius: ${RADIUS}px; background: var(--surface-2, #323232); color: var(--mat-sys-on-surface);
      border: 1px solid color-mix(in srgb, #f0883e 30%, rgba(255,255,255,.08));
      box-shadow: 0 12px 32px rgba(0,0,0,.45), 0 0 0 3px color-mix(in srgb, #ffa657 10%, transparent); }
    .sl-pop__none { display: flex; align-items: center; gap: 8px; margin: 0; padding: 14px 16px; font-size: 13px; }
    .sl-pop__none mat-icon { color: #3fb950; font-size: 18px; width: 18px; height: 18px; }
  `],
})
export class CardSituationLauncherComponent {
  readonly cardNumber = input<string | number | null | undefined>(null);

  private svc = inject(CardSituationService);
  private readonly button = viewChild<ElementRef<HTMLElement>>('button');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  readonly card = computed(() => {
    const c = this.cardNumber();
    return c === null || c === undefined ? '' : `${c}`.trim();
  });
  readonly situation = computed(() => (this.card() ? this.svc.situationOf(this.card())() : null));
  readonly waiting = computed(() => !!situationMeta(this.situation()?.kind));
  readonly onYou = computed(() => this.waiting() && ON_YOU.has(this.situation()!.kind));
  readonly icon = computed(() => situationMeta(this.situation()?.kind)?.icon ?? 'flag');
  /** Relógio do "há X" do tooltip (1 min). */
  private readonly now = signal(Date.now());
  readonly tooltip = computed(() => {
    const s = this.situation();
    if (!s || !this.waiting()) return 'Situação do card (nada aguardando)';
    const ago = situationAgo(s.since, this.now());
    return `Situação atual: ${s.title || SITUATION_TITLES[s.kind] || 'aguardando'}${ago ? ' · ' + ago : ''} — clique para ver`;
  });
  readonly open = signal(false);

  readonly positions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 8 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -8 },
  ];

  private watched: string | null = null;
  private closing = false;

  constructor() {
    effect(() => {
      const card = this.card();
      untracked(() => this.switchCard(card));
    });
    const timer = setInterval(() => this.now.set(Date.now()), 60_000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      if (this.watched) this.svc.unwatch(this.watched);
    });
  }

  private switchCard(card: string): void {
    if (card === this.watched) return;
    if (this.watched) this.svc.unwatch(this.watched);
    this.watched = card || null;
    this.open.set(false);
    if (!card) return;
    this.svc.watch(card);
    this.svc.load(card, { devops: true }).catch(() => undefined);
  }

  toggle(): void {
    if (this.open()) this.close(); else this.open.set(true);
  }

  onAttach(): void {
    requestAnimationFrame(() => this.animate('open'));
  }

  onDetach(): void {
    this.open.set(false);
    this.closing = false;
  }

  onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.preventDefault(); this.close(); }
  }

  /** Fecha voltando para dentro do botão. */
  async close(): Promise<void> {
    if (!this.open() || this.closing) return;
    this.closing = true;
    await this.animate('close');
    this.closing = false;
    this.open.set(false);
    this.button()?.nativeElement.focus({ preventScroll: true });
  }

  /** Recorte que cresce do botão até o popover (sem deformar o texto), como o das sugestões. */
  private async animate(direction: 'open' | 'close'): Promise<void> {
    const panel = this.panel()?.nativeElement;
    const button = this.button()?.nativeElement;
    if (!panel || !button || typeof panel.animate !== 'function' || reducedMotion()) return;
    const p = panel.getBoundingClientRect();
    const b = button.getBoundingClientRect();
    if (!p.width || !b.width) return;
    const top = clamp(b.top - p.top, p.height);
    const left = clamp(b.left - p.left, p.width);
    const right = clamp(p.right - b.right, p.width);
    const bottom = clamp(p.bottom - b.bottom, p.height);
    const small = { clipPath: `inset(${top}px ${right}px ${bottom}px ${left}px round ${b.height / 2}px)`, opacity: 0.4 };
    const full = { clipPath: `inset(0px 0px 0px 0px round ${RADIUS}px)`, opacity: 1 };
    const anim = panel.animate(direction === 'open' ? [small, full] : [full, small],
      direction === 'open' ? OPEN_ANIMATION : { ...OPEN_ANIMATION, duration: 220, fill: 'forwards' });
    await anim.finished.catch(() => undefined);
  }
}

function clamp(v: number, max: number): number {
  return Math.max(0, Math.min(v, max));
}

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
