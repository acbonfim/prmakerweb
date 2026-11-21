import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CardAssistantService, isPending } from '../../services/card-assistant.service';
import { CardAssistantComponent } from './card-assistant.component';

/** A mesma abertura da linha do tempo em tela cheia (card-timeline): sai do botão e cresce até o tamanho final. */
const OPEN_ANIMATION: KeyframeAnimationOptions = { duration: 320, easing: 'cubic-bezier(0.2, 0, 0, 1)' };
const RADIUS = 14;

/**
 * Botão das sugestões do PRMake (0078) na barra de horas da Bancada, alinhado à direita. Com sugestão aberta ele pisca e
 * se mexe como o robô do "Claude está trabalhando", nas cores do assistente; o clique abre um popover que sai do botão
 * (a animação da linha do tempo) com tudo o que o bloco do assistente mostra — abertas, ações, Dispensar e as
 * respondidas. Sugestão nova pelo tempo real → aviso discreto "O PRMake tem uma sugestão: X · Ver" (o "Ver" abre aqui).
 */
@Component({
  selector: 'app-card-assistant-launcher',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule, CdkOverlayOrigin, CdkConnectedOverlay, CardAssistantComponent],
  template: `
    @if (card()) {
      @let n = pendingCount();
      <button type="button" class="al" [class.al--on]="n > 0" [class.al--open]="open()"
              cdkOverlayOrigin #origin="cdkOverlayOrigin" #button
              [attr.aria-expanded]="open()" aria-haspopup="dialog" [attr.aria-label]="tooltip()"
              [matTooltip]="open() ? '' : tooltip()" (click)="toggle()">
        <span class="al__glow" aria-hidden="true"></span>
        <mat-icon class="al__icon">assistant</mat-icon>
        @if (n > 0) { <span class="al__badge" aria-hidden="true">{{ n > 9 ? '9+' : n }}</span> }
      </button>
      <ng-template cdkConnectedOverlay [cdkConnectedOverlayOrigin]="origin" [cdkConnectedOverlayOpen]="open()"
                   [cdkConnectedOverlayPositions]="positions" [cdkConnectedOverlayHasBackdrop]="true"
                   cdkConnectedOverlayBackdropClass="cdk-overlay-transparent-backdrop" [cdkConnectedOverlayPush]="true"
                   (attach)="onAttach()" (backdropClick)="close()" (detach)="onDetach()" (overlayKeydown)="onKey($event)">
        <div class="al-pop" #panel role="dialog" aria-label="Sugestões do PRMake neste card">
          <app-card-assistant variant="popover" [cardNumber]="card()" (closed)="close()"></app-card-assistant>
        </div>
      </ng-template>
    }
  `,
  styles: [`
    :host { display: inline-flex; flex: none; }
    .al { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0;
      border: 1px solid transparent; border-radius: 50%; background: none; cursor: pointer;
      color: color-mix(in srgb, #d2a8ff 62%, var(--mat-sys-on-surface)); opacity: .75; transition: background-color .15s ease, opacity .15s ease; }
    .al:hover, .al--open { opacity: 1; background: color-mix(in srgb, #bc8cff 16%, transparent); }
    .al:focus-visible { outline: 2px solid #58a6ff; outline-offset: 2px; }
    .al__icon { position: relative; font-size: 17px; width: 17px; height: 17px; }
    .al__glow { position: absolute; inset: 0; border-radius: 50%; pointer-events: none; }

    /* Com sugestão: as cores e a sombra do avatar do assistente, piscando e se mexendo como o robô do Claude trabalhando. */
    .al--on { opacity: 1; color: #fff;
      background: linear-gradient(135deg, color-mix(in srgb, #bc8cff 70%, transparent), color-mix(in srgb, #58a6ff 70%, transparent)); }
    .al--on:hover, .al--on.al--open { background: linear-gradient(135deg, #bc8cff, #58a6ff); }
    .al--on .al__glow { animation: al-glow 1.4s ease-in-out infinite; }
    .al--on .al__glow::after { content: ''; position: absolute; inset: 0; border-radius: 50%; border: 2px solid #d2a8ff;
      animation: al-ping 1.4s cubic-bezier(0, 0, .2, 1) infinite; }
    .al--on .al__icon { animation: al-bob 1.4s ease-in-out infinite; }
    .al--open .al__glow, .al--open .al__glow::after, .al--open .al__icon { animation: none; }
    .al__badge { position: absolute; top: -5px; right: -7px; min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box; border-radius: 999px;
      font-size: 10px; font-weight: 700; line-height: 16px; text-align: center; color: #1b1f24; background: #d2a8ff;
      box-shadow: 0 0 0 2px var(--surface-1, #262b33); }
    @keyframes al-glow {
      0%, 100% { box-shadow: 0 0 0 0 transparent; }
      50% { box-shadow: 0 0 12px 3px color-mix(in srgb, #d2a8ff 55%, transparent); }
    }
    @keyframes al-ping {
      0% { transform: scale(.6); opacity: .9; }
      80%, 100% { transform: scale(1.8); opacity: 0; }
    }
    @keyframes al-bob { 0%, 100% { transform: translateY(0) rotate(0); } 25% { transform: translateY(-2px) rotate(-6deg); } 75% { transform: translateY(1px) rotate(6deg); } }
    @media (prefers-reduced-motion: reduce) { .al__glow, .al__glow::after, .al__icon { animation: none !important; } }

    .al-pop { width: min(460px, calc(100vw - 24px)); max-height: min(72vh, 620px); overflow-y: auto; overflow-x: hidden;
      border-radius: ${RADIUS}px; background: var(--surface-2, #323232); color: var(--mat-sys-on-surface);
      border: 1px solid color-mix(in srgb, #bc8cff 28%, rgba(255,255,255,.08));
      box-shadow: 0 12px 32px rgba(0,0,0,.45), 0 0 0 3px color-mix(in srgb, #d2a8ff 10%, transparent); }
  `],
})
export class CardAssistantLauncherComponent {
  readonly cardNumber = input<string | number | null | undefined>(null);

  private svc = inject(CardAssistantService);
  private snackBar = inject(MatSnackBar);

  private readonly button = viewChild<ElementRef<HTMLElement>>('button');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly content = viewChild(CardAssistantComponent);

  readonly card = computed(() => {
    const c = this.cardNumber();
    return c === null || c === undefined ? '' : `${c}`.trim();
  });
  readonly pendingCount = computed(() => (this.card() ? (this.svc.suggestionsOf(this.card())() ?? []).filter(isPending).length : 0));
  readonly tooltip = computed(() => {
    const n = this.pendingCount();
    return n ? `O PRMake tem ${n === 1 ? '1 sugestão' : n + ' sugestões'} — clique para ver` : 'Sugestões do PRMake (nada pendente)';
  });
  readonly open = signal(false);

  readonly positions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 8 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -8 },
  ];

  private watched: string | null = null;
  private release: () => void = () => undefined;
  private revealId: string | null = null;
  private closing = false;

  constructor() {
    effect(() => {
      const card = this.card();
      untracked(() => this.switchCard(card));
    });
    const sub = this.svc.fresh$.subscribe(e => {
      if (e.card !== this.card() || this.open()) return;
      const ref = this.snackBar.open(`O PRMake tem uma sugestão: ${e.suggestion.title}`, 'Ver', { duration: 8000 });
      ref.onAction().subscribe(() => this.show(e.suggestion.id));
    });
    inject(DestroyRef).onDestroy(() => {
      sub.unsubscribe();
      this.release();
      if (this.watched) this.svc.unwatch(this.watched);
    });
  }

  private switchCard(card: string): void {
    if (card === this.watched) return;
    this.release();
    if (this.watched) this.svc.unwatch(this.watched);
    this.watched = card || null;
    this.open.set(false);
    if (!card) { this.release = () => undefined; return; }
    this.release = this.svc.claimLauncher(card);
    this.svc.watch(card);
    this.svc.loadSuggestions(card).catch(() => undefined);
  }

  toggle(): void {
    if (this.open()) this.close(); else this.show();
  }

  /** Abre o popover (e destaca a sugestão, quando veio do "Ver" do aviso). */
  show(id?: string | null): void {
    this.revealId = id ?? null;
    if (this.open()) { this.reveal(); return; }
    this.open.set(true);
  }

  onAttach(): void {
    requestAnimationFrame(() => {
      this.animate('open');
      this.reveal();
    });
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

  private reveal(): void {
    const id = this.revealId;
    this.revealId = null;
    if (id) this.content()?.reveal(id);
  }

  /** Recorte que cresce do botão até o popover (sem deformar o texto), como a timeline saindo do botão. */
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
