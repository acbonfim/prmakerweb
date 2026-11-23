import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CardAssistantService, formatHours, serverMessage } from '../../services/card-assistant.service';

/**
 * Compactação da linha de horas quando não cabe (Bancada em telas menores): cada passo é uma classe no host, aplicada
 * em ordem até o conteúdo caber — medido de verdade, não por largura fixa (o texto muda com os valores: "12,5h").
 */
const FIT_STEPS = ['hr--no-label', 'hr--no-avg', 'hr--short', 'hr--no-bar', 'hr--pill', 'hr--pill-only'] as const;
/** A partir deste passo as horas viram a pastilha "2h/6h · 0h rest." com o popover completo. */
const PILL_LEVEL = FIT_STEPS.indexOf('hr--pill') + 1;
const OPEN_ANIMATION: KeyframeAnimationOptions = { duration: 320, easing: 'cubic-bezier(0.2, 0, 0, 1)' };
const RADIUS = 14;

/**
 * Horas do card no DevOps (0078), numa linha: "Original 6h · Completed 2h · Remaining 4h · média do time 3h",
 * barra Completed/Original (com a marca da média) e **+1h** (confirmação curta → `log-hours`). Sem estimativa:
 * "Registrar estimativa inicial". Sem integração/DevOps fora: "Horas indisponíveis" — nunca trava a tela.
 *
 * `adaptive` (barra da Bancada): sem espaço, a linha vai encolhendo — some o rótulo, a média, os rótulos ficam curtos
 * ("Orig 6h · Comp 2h · Rem 0h"), some a barra e, por fim, vira uma pastilha que abre as horas completas num popover
 * (mesma abertura dos botões da Situação e das sugestões). Nada passa por cima do vizinho: o que sobra é cortado.
 */
@Component({
  selector: 'app-card-hours',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule, NgTemplateOutlet, CdkOverlayOrigin, CdkConnectedOverlay],
  host: { '[class.hr--fit]': 'adaptive()' },
  template: `
    @let st = state();
    <div class="hr" #row role="group" aria-label="Horas do card no DevOps">
      <mat-icon class="hr__icon" aria-hidden="true">schedule</mat-icon>
      @if (!st || (st.status === 'loading' && !st.effort)) {
        <span class="hr__muted">Horas no DevOps…</span>
      } @else if (st.status === 'error') {
        <span class="hr__muted hr__muted--warn" [matTooltip]="st.error || ''">Horas indisponíveis — {{ unavailableReason() }}</span>
        <button type="button" class="hr__link" (click)="reload()" aria-label="Tentar buscar as horas de novo">Tentar de novo</button>
      } @else if (noEstimate()) {
        <span class="hr__muted">Sem estimativa no DevOps</span>
        <button type="button" class="hr__btn" (click)="estimate()" [disabled]="busy()">
          {{ busy() === 'estimate' ? 'Registrando…' : 'Registrar estimativa inicial' }}
        </button>
      } @else if (st?.effort; as e) {
        @if (adaptive()) {
          <button type="button" class="hr__pill" [class.hr__pill--open]="open()" cdkOverlayOrigin #origin="cdkOverlayOrigin" #pill
                  [attr.aria-expanded]="open()" aria-haspopup="dialog" [attr.aria-label]="pillTip()"
                  [matTooltip]="open() ? '' : pillTip()" (click)="toggle()">
            <mat-icon aria-hidden="true">schedule</mat-icon>
            <span class="hr__pill-text"><strong>{{ h(e.completedWork ?? 0) }}</strong>/{{ h(total()) }} · {{ h(e.remainingWork ?? 0) }} rest.</span>
          </button>
          <ng-template cdkConnectedOverlay [cdkConnectedOverlayOrigin]="origin" [cdkConnectedOverlayOpen]="open()"
                       [cdkConnectedOverlayPositions]="positions" [cdkConnectedOverlayHasBackdrop]="true"
                       cdkConnectedOverlayBackdropClass="cdk-overlay-transparent-backdrop" [cdkConnectedOverlayPush]="true"
                       (attach)="onAttach()" (backdropClick)="close()" (detach)="onDetach()" (overlayKeydown)="onKey($event)">
            <div class="hr-pop" #panel role="dialog" aria-label="Horas do card no DevOps">
              <div class="hr-pop__title"><mat-icon aria-hidden="true">schedule</mat-icon>Horas no DevOps</div>
              <ng-container *ngTemplateOutlet="facts; context: { $implicit: e }"></ng-container>
              <div class="hr-pop__row">
                <ng-container *ngTemplateOutlet="bar"></ng-container>
                @if (!confirming()) { <ng-container *ngTemplateOutlet="logBtn"></ng-container> }
              </div>
              <ng-container *ngTemplateOutlet="extras"></ng-container>
            </div>
          </ng-template>
        }
        <ng-container *ngTemplateOutlet="facts; context: { $implicit: e }"></ng-container>
        <ng-container *ngTemplateOutlet="bar"></ng-container>
        @if (!confirming()) { <ng-container *ngTemplateOutlet="logBtn"></ng-container> }
      }
      @if (st?.status === 'loading' && st?.effort) { <span class="hr__sync" role="status" aria-label="Atualizando as horas"></span> }
    </div>
    @if (!open()) { <ng-container *ngTemplateOutlet="extras"></ng-container> }

    <ng-template #facts let-e>
      <span class="hr__facts">
        <span class="hr__label">Horas</span>
        <span class="hr__fact hr__fact--orig" matTooltip="Original Estimate"><span class="hr__k" data-short="Orig">Original</span>&ngsp;<strong>{{ h(e.originalEstimate) }}</strong></span>
        <span class="hr__fact hr__fact--done" matTooltip="Completed Work"><span class="hr__k" data-short="Comp">Completed</span>&ngsp;<strong>{{ h(e.completedWork) }}</strong></span>
        <span class="hr__fact hr__fact--rem" matTooltip="Remaining Work"><span class="hr__k" data-short="Rem">Remaining</span>&ngsp;<strong>{{ h(e.remainingWork) }}</strong></span>
        @if (average(); as avg) { <span class="hr__fact hr__avg" matTooltip="Média de horas por card do time (Skills Configurations)">média do time {{ h(avg) }}</span> }
      </span>
    </ng-template>
    <ng-template #bar>
      <span class="hr__bar" [class.hr__bar--over]="over()" role="progressbar" aria-label="Completed sobre Original"
            [attr.aria-valuenow]="pct()" aria-valuemin="0" aria-valuemax="100"
            [matTooltip]="barTip()">
        <span class="hr__bar-fill" [style.width.%]="pct()"></span>
        @if (avgPct() !== null) { <span class="hr__bar-avg" [style.left.%]="avgPct()"></span> }
      </span>
    </ng-template>
    <ng-template #logBtn>
      <button type="button" class="hr__btn hr__log" (click)="askLog()" [disabled]="!!busy()"
              [matTooltip]="'Lançar ' + h(step()) + ' em Completed e tirar ' + h(step()) + ' do Remaining'">+{{ h(step()) }}</button>
    </ng-template>
    <ng-template #extras>
      @if (confirming() && state()?.effort; as e) {
        <div class="hr__confirm" role="alertdialog" aria-label="Confirmar o lançamento de horas">
          <span>Lançar <strong>+{{ h(step()) }}</strong> em Completed ({{ h(e.completedWork ?? 0) }} → {{ h((e.completedWork ?? 0) + step()) }})
            e −{{ h(step()) }} no Remaining ({{ h(e.remainingWork ?? 0) }} → {{ h(remainingAfter()) }})?</span>
          <span class="hr__confirm-actions">
            <button type="button" class="hr__link" (click)="confirming.set(false)" [disabled]="!!busy()">Cancelar</button>
            <button type="button" class="hr__btn hr__btn--primary" (click)="log()" [disabled]="!!busy()">{{ busy() === 'log' ? 'Lançando…' : 'Lançar' }}</button>
          </span>
        </div>
      }
      @if (message(); as m) {
        <div class="hr__msg" [class.hr__msg--error]="!m.ok" role="status">
          <mat-icon>{{ m.ok ? 'check_circle' : 'error_outline' }}</mat-icon><span>{{ m.text }}</span>
          <button type="button" class="hr__x" (click)="message.set(null)" aria-label="Fechar o aviso"><mat-icon>close</mat-icon></button>
        </div>
      }
    </ng-template>
  `,
  styles: [`
    :host { display: block; min-width: 0; font-size: 12.5px; }
    .hr { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; min-width: 0; }
    .hr__icon { flex: none; font-size: 16px; width: 16px; height: 16px; color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent); }
    .hr__muted { color: color-mix(in srgb, var(--mat-sys-on-surface) 58%, transparent); }
    .hr__muted--warn { color: color-mix(in srgb, #d29922 75%, white); }
    .hr__facts { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 0 8px; min-width: 0; color: color-mix(in srgb, var(--mat-sys-on-surface) 72%, transparent); }
    .hr__label { font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent); }
    .hr__fact strong { color: var(--mat-sys-on-surface); font-weight: 600; font-variant-numeric: tabular-nums; }
    .hr__fact + .hr__fact::before { content: '·'; margin-right: 8px; opacity: .6; }
    .hr__avg { color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent); }
    .hr__bar { position: relative; flex: 0 0 90px; height: 6px; border-radius: 999px; background: rgba(255,255,255,.1); overflow: visible; }
    .hr__bar-fill { position: absolute; inset: 0 auto 0 0; border-radius: 999px; background: #3fb950; transition: width .3s ease; }
    .hr__bar--over .hr__bar-fill { background: #d29922; }
    .hr__bar-avg { position: absolute; top: -3px; width: 2px; height: 12px; margin-left: -1px; border-radius: 1px; background: #79c0ff; }
    .hr__btn { flex: none; height: 24px; padding: 0 9px; border: 1px solid rgba(255,255,255,.16); border-radius: 6px; background: transparent;
      color: #79c0ff; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
    .hr__btn:hover:not(:disabled) { background: color-mix(in srgb, #58a6ff 14%, transparent); border-color: color-mix(in srgb, #58a6ff 45%, transparent); }
    .hr__btn:disabled { opacity: .55; cursor: default; }
    .hr__btn--primary { background: var(--mat-sys-primary); border-color: transparent; color: var(--mat-sys-on-primary); }
    .hr__btn--primary:hover:not(:disabled) { background: var(--mat-sys-primary); filter: brightness(1.08); }
    .hr__link { padding: 0 2px; border: 0; background: none; color: var(--mat-sys-primary); font: inherit; font-size: 12px; cursor: pointer; }
    .hr__link:hover { text-decoration: underline; }
    .hr__sync { width: 10px; height: 10px; border-radius: 50%; border: 2px solid color-mix(in srgb, #58a6ff 70%, transparent); border-right-color: transparent; animation: hr-spin .8s linear infinite; }
    @keyframes hr-spin { to { transform: rotate(360deg); } }
    .hr__confirm { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 12px; margin-top: 6px; padding: 6px 8px 6px 10px; border-radius: 8px;
      background: color-mix(in srgb, #58a6ff 9%, transparent); border: 1px solid color-mix(in srgb, #58a6ff 28%, transparent); }
    .hr__confirm > span:first-child { flex: 1 1 260px; }
    .hr__confirm-actions { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; }
    .hr__msg { display: flex; align-items: flex-start; gap: 6px; margin-top: 6px; padding: 5px 6px 5px 9px; border-radius: 8px;
      color: color-mix(in srgb, #3fb950 75%, white); background: color-mix(in srgb, #3fb950 9%, transparent); }
    .hr__msg--error { color: #f2b8b5; background: color-mix(in srgb, #f85149 10%, transparent); }
    .hr__msg .mat-icon { flex: none; font-size: 16px; width: 16px; height: 16px; margin-top: 1px; }
    .hr__msg > span { flex: 1 1 auto; min-width: 0; }
    .hr__x { flex: none; display: inline-flex; padding: 0; border: 0; background: none; color: inherit; cursor: pointer; opacity: .7; }
    .hr__x .mat-icon { font-size: 15px; width: 15px; height: 15px; }
    @media (prefers-reduced-motion: reduce) { .hr__sync { animation: none; } .hr__bar-fill { transition: none; } }

    /* Compactação medida (adaptive): nada encolhe por cima do vizinho — o passo seguinte entra até caber. */
    .hr__pill { display: none; }
    :host(.hr--fit) .hr { flex-wrap: nowrap; overflow: hidden; }
    :host(.hr--fit) .hr > * { flex-shrink: 0; }
    :host(.hr--fit) .hr > .hr__muted { flex-shrink: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    :host(.hr--fit) .hr__facts { flex-wrap: nowrap; white-space: nowrap; }
    :host(.hr--no-label) .hr__icon, :host(.hr--no-label) .hr__label { display: none; }
    :host(.hr--no-avg) .hr__avg { display: none; }
    :host(.hr--short) .hr__k { font-size: 0; }
    :host(.hr--short) .hr__k::after { content: attr(data-short); font-size: 12.5px; }
    :host(.hr--no-bar) .hr__bar { display: none; }
    :host(.hr--pill) .hr__facts { display: none; }
    :host(.hr--pill) .hr__pill { display: inline-flex; }
    :host(.hr--pill-only) .hr__log { display: none; }
    :host(.hr--pill-only) .hr > .hr__pill { flex-shrink: 1; min-width: 0; }

    .hr__pill { align-items: center; gap: 5px; height: 24px; max-width: 100%; padding: 0 9px 0 6px; border: 1px solid rgba(255,255,255,.14);
      border-radius: 999px; background: rgba(255,255,255,.04); color: color-mix(in srgb, var(--mat-sys-on-surface) 72%, transparent);
      font: inherit; font-size: 12px; cursor: pointer; transition: background-color .15s ease, border-color .15s ease; }
    .hr__pill:hover, .hr__pill--open { background: color-mix(in srgb, #58a6ff 12%, transparent); border-color: color-mix(in srgb, #58a6ff 40%, transparent); }
    .hr__pill:focus-visible { outline: 2px solid #58a6ff; outline-offset: 2px; }
    .hr__pill .mat-icon { flex: none; font-size: 15px; width: 15px; height: 15px; }
    .hr__pill-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .hr__pill-text strong { color: var(--mat-sys-on-surface); font-weight: 600; }

    .hr-pop { display: flex; flex-direction: column; gap: 10px; width: min(380px, calc(100vw - 24px)); padding: 12px 14px; box-sizing: border-box;
      border-radius: ${RADIUS}px; background: var(--surface-2, #323232); color: var(--mat-sys-on-surface); font-size: 12.5px;
      border: 1px solid color-mix(in srgb, #58a6ff 26%, rgba(255,255,255,.08)); box-shadow: 0 12px 32px rgba(0,0,0,.45); }
    .hr-pop__title { display: flex; align-items: center; gap: 6px; font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent); }
    .hr-pop__title .mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .hr-pop .hr__facts { gap: 4px 8px; }
    .hr-pop .hr__label { display: none; }
    .hr-pop__row { display: flex; align-items: center; gap: 10px; }
    .hr-pop__row .hr__bar { flex: 1 1 auto; }
    .hr-pop .hr__confirm, .hr-pop .hr__msg { margin-top: 0; }
  `],
})
export class CardHoursComponent {
  readonly cardNumber = input<string | number | null | undefined>(null);
  /** Compacta por medição quando a linha não cabe (barra da Bancada). */
  readonly adaptive = input(false);

  private svc = inject(CardAssistantService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly row = viewChild<ElementRef<HTMLElement>>('row');
  private readonly pill = viewChild<ElementRef<HTMLElement>>('pill');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  readonly card = computed(() => {
    const c = this.cardNumber();
    return c === null || c === undefined ? '' : `${c}`.trim();
  });
  readonly state = computed(() => (this.card() ? this.svc.effortOf(this.card())() : null));
  readonly average = this.svc.averageHours;
  /** Horas do "+1h" (AssistantHoursPerStep; padrão 1). */
  readonly step = this.svc.hoursPerStep;

  readonly busy = signal<'log' | 'estimate' | null>(null);
  readonly confirming = signal(false);
  readonly message = signal<{ ok: boolean; text: string } | null>(null);

  readonly noEstimate = computed(() => {
    const e = this.state()?.effort;
    return !!e && !e.originalEstimate && !e.completedWork && !e.remainingWork;
  });
  /** Base da barra: o Original (ou Completed + Remaining quando não há Original). */
  readonly total = computed(() => {
    const e = this.state()?.effort;
    if (!e) return 0;
    return e.originalEstimate || ((e.completedWork ?? 0) + (e.remainingWork ?? 0));
  });
  readonly pct = computed(() => {
    const total = this.total();
    const done = this.state()?.effort?.completedWork ?? 0;
    return total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  });
  readonly over = computed(() => {
    const e = this.state()?.effort;
    const avg = this.average();
    return !!e && ((!!this.total() && (e.completedWork ?? 0) > this.total()) || (!!avg && (e.completedWork ?? 0) > avg));
  });
  readonly avgPct = computed(() => {
    const avg = this.average();
    const total = this.total();
    return avg && total > 0 && avg <= total ? Math.round((avg / total) * 100) : null;
  });
  readonly barTip = computed(() => {
    const e = this.state()?.effort;
    const avg = this.average();
    if (!e) return '';
    return `Completed ${formatHours(e.completedWork ?? 0)} de ${formatHours(this.total())}` + (avg ? ` · média do time ${formatHours(avg)} (marca azul)` : '');
  });
  readonly remainingAfter = computed(() => Math.max(0, (this.state()?.effort?.remainingWork ?? 0) - this.step()));
  readonly unavailableReason = computed(() => {
    const st = this.state();
    const msg = (st?.error ?? '').trim();
    if (!msg || /integra|configur|token|\bpat\b|credencia|não respondeu|unauthor|401|403/i.test(msg) || (st?.httpStatus ?? 0) === 0) {
      return 'sem integração do DevOps';
    }
    return msg.length > 80 ? msg.slice(0, 77) + '…' : msg;
  });

  readonly pillTip = computed(() => {
    const e = this.state()?.effort;
    if (!e) return '';
    return `Completed ${formatHours(e.completedWork ?? 0)} de ${formatHours(this.total())} · Remaining ${formatHours(e.remainingWork ?? 0)} — clique para ver as horas`;
  });

  /** Passos de compactação aplicados (0 = linha completa). */
  readonly level = signal(0);
  readonly open = signal(false);
  readonly positions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 8 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -8 },
  ];
  private closing = false;
  private fitFrame = 0;

  private loaded = '';

  constructor() {
    // Remede quando o espaço muda (janela, painel, abas) e quando o conteúdo muda (horas, média, confirmação).
    afterNextRender(() => {
      if (!this.adaptive() || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => this.scheduleFit());
      observer.observe(this.host.nativeElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
      this.fit();
    });
    effect(() => {
      this.state(); this.average(); this.step(); this.confirming(); this.busy();
      untracked(() => this.scheduleFit());
    });
    this.destroyRef.onDestroy(() => cancelAnimationFrame(this.fitFrame));

    effect(() => {
      const card = this.card();
      untracked(() => {
        if (!card || card === this.loaded) return;
        this.loaded = card;
        this.confirming.set(false);
        this.message.set(null);
        this.svc.loadSettings();
        this.svc.loadEffort(card);
      });
    });
  }

  private scheduleFit(): void {
    if (!this.adaptive()) return;
    cancelAnimationFrame(this.fitFrame);
    this.fitFrame = requestAnimationFrame(() => this.fit());
  }

  /** Aplica os passos de compactação, um a um, até a linha caber (sem largura, ex.: aba escondida, mantém o que estava). */
  fit(): void {
    const host = this.host.nativeElement;
    const row = this.row()?.nativeElement;
    if (!this.adaptive() || !row || !row.clientWidth) return;
    FIT_STEPS.forEach(c => host.classList.remove(c));
    let level = 0;
    while (level < FIT_STEPS.length && row.scrollWidth > row.clientWidth + 1) host.classList.add(FIT_STEPS[level++]);
    this.level.set(level);
    if (level < PILL_LEVEL && this.open()) this.open.set(false);
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

  /** Fecha voltando para dentro da pastilha. */
  async close(): Promise<void> {
    if (!this.open() || this.closing) return;
    this.closing = true;
    await this.animate('close');
    this.closing = false;
    this.open.set(false);
    this.pill()?.nativeElement.focus({ preventScroll: true });
  }

  /** Recorte que cresce da pastilha até o popover (sem deformar o texto), como os botões da Situação e das sugestões. */
  private async animate(direction: 'open' | 'close'): Promise<void> {
    const panel = this.panel()?.nativeElement;
    const pill = this.pill()?.nativeElement;
    if (!panel || !pill || typeof panel.animate !== 'function' || reducedMotion()) return;
    const p = panel.getBoundingClientRect();
    const b = pill.getBoundingClientRect();
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

  h(v: number | null | undefined): string {
    return formatHours(v);
  }

  reload(): void {
    if (this.card()) this.svc.loadEffort(this.card());
  }

  askLog(): void {
    this.message.set(null);
    this.confirming.set(true);
  }

  async log(): Promise<void> {
    const card = this.card();
    if (!card || this.busy()) return;
    this.busy.set('log');
    try {
      const res = await this.svc.logHours(card, this.step());
      this.message.set({ ok: true, text: res?.message || `+${formatHours(this.step())} lançada(s) em Completed.` });
      this.confirming.set(false);
    } catch (err) {
      this.message.set({ ok: false, text: serverMessage(err, 'O DevOps não aceitou o lançamento de horas.') });
    } finally {
      this.busy.set(null);
    }
  }

  async estimate(): Promise<void> {
    const card = this.card();
    if (!card || this.busy()) return;
    this.busy.set('estimate');
    this.message.set(null);
    try {
      const res = await this.svc.initialEstimate(card);
      this.message.set({ ok: true, text: res?.message || 'Estimativa inicial registrada no DevOps.' });
    } catch (err) {
      this.message.set({ ok: false, text: serverMessage(err, 'Não foi possível registrar a estimativa no DevOps.') });
    } finally {
      this.busy.set(null);
    }
  }
}

function clamp(v: number, max: number): number {
  return Math.max(0, Math.min(v, max));
}

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
