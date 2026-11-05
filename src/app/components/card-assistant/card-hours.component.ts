import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CardAssistantService, formatHours, serverMessage } from '../../services/card-assistant.service';

/**
 * Horas do card no DevOps (0078), numa linha: "Original 6h · Completed 2h · Remaining 4h · média do time 3h",
 * barra Completed/Original (com a marca da média) e **+1h** (confirmação curta → `log-hours`). Sem estimativa:
 * "Registrar estimativa inicial". Sem integração/DevOps fora: "Horas indisponíveis" — nunca trava a tela.
 */
@Component({
  selector: 'app-card-hours',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule],
  template: `
    @let st = state();
    <div class="hr" role="group" aria-label="Horas do card no DevOps">
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
        <span class="hr__facts">
          <span class="hr__label">Horas</span>
          <span class="hr__fact hr__fact--orig" matTooltip="Original Estimate">Original <strong>{{ h(e.originalEstimate) }}</strong></span>
          <span class="hr__fact hr__fact--done" matTooltip="Completed Work">Completed <strong>{{ h(e.completedWork) }}</strong></span>
          <span class="hr__fact hr__fact--rem" matTooltip="Remaining Work">Remaining <strong>{{ h(e.remainingWork) }}</strong></span>
          @if (average(); as avg) { <span class="hr__fact hr__avg" matTooltip="Média de horas por card do time (Skills Configurations)">média do time {{ h(avg) }}</span> }
        </span>
        <span class="hr__bar" [class.hr__bar--over]="over()" role="progressbar" aria-label="Completed sobre Original"
              [attr.aria-valuenow]="pct()" aria-valuemin="0" aria-valuemax="100"
              [matTooltip]="barTip()">
          <span class="hr__bar-fill" [style.width.%]="pct()"></span>
          @if (avgPct() !== null) { <span class="hr__bar-avg" [style.left.%]="avgPct()"></span> }
        </span>
        @if (!confirming()) {
          <button type="button" class="hr__btn" (click)="askLog()" [disabled]="!!busy()"
                  [matTooltip]="'Lançar ' + h(step()) + ' em Completed e tirar ' + h(step()) + ' do Remaining'">+{{ h(step()) }}</button>
        }
      }
      @if (st?.status === 'loading' && st?.effort) { <span class="hr__sync" role="status" aria-label="Atualizando as horas"></span> }
    </div>
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
  `],
})
export class CardHoursComponent {
  readonly cardNumber = input<string | number | null | undefined>(null);

  private svc = inject(CardAssistantService);

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
  private readonly total = computed(() => {
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

  private loaded = '';

  constructor() {
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
