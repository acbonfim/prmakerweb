import { Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

/**
 * 0105: SLA do card calculado no servidor (regras em Configurações → SLA dos cards) — prazo em dias úteis por quem abriu
 * (cliente × time interno) e severidade. `remainingDays` negativo = vencido; `stopped` = card entregue (prazo parado).
 */
export interface CardSla {
  origin: 'client' | 'internal' | string;
  originValue?: string | null;
  severity: string;
  limitDays: number;
  start: string;
  deadline: string;
  elapsedDays: number;
  remainingDays: number;
  level: 'grave' | 'attention' | 'ok' | string;
  stopped: boolean;
  stoppedAt?: string | null;
  met?: boolean | null;
  text: string;
}

const LEVEL_LABEL: Record<string, string> = { grave: 'Grave', attention: 'Atenção', ok: 'Ok' };

function day(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  // data pura (prazo) vale como está; data com hora (abertura) vai para o fuso de quem vê
  if (iso.length === 10) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('pt-BR');
}

/** Detalhe do SLA em texto (tooltip do selo). */
export function slaTooltip(s: CardSla): string {
  const who = s.origin === 'internal' ? 'Time interno' : 'Cliente';
  const lines = [
    `SLA ${LEVEL_LABEL[s.level] ?? s.level}: ${s.text}`,
    `${who}${s.originValue ? ` (${s.originValue})` : ''} · ${s.severity} · prazo de ${s.limitDays} d.u.`,
    `Aberto em ${day(s.start)} · vence em ${day(s.deadline)}`,
    s.stopped
      ? `Prazo parado em ${day(s.stoppedAt)} (${s.met ? 'cumprido' : 'estourado'})`
      : `Usados ${s.elapsedDays} de ${s.limitDays} d.u.`
  ];
  return lines.join('\n');
}

@Component({
  selector: 'app-sla-badge',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule],
  template: `
    @if (sla(); as s) {
      <span class="sla" [class.sla--grave]="s.level === 'grave'" [class.sla--attention]="s.level === 'attention'"
            [class.sla--sm]="compact()" [class.sla--stopped]="s.stopped"
            [matTooltip]="tip()" matTooltipClass="plan-tooltip" [attr.aria-label]="tip()">
        <mat-icon>{{ s.stopped ? (s.met ? 'task_alt' : 'running_with_errors') : 'timer' }}</mat-icon>
        @if (!compact()) { <span class="sla__label">SLA</span> }
        <span class="sla__text">{{ s.text }}</span>
      </span>
    }
  `,
  styles: [`
    :host { display: inline-flex; min-width: 0; }
    /* Cores sólidas: legíveis no tema escuro, no claro e no card pintado por regra do board. */
    .sla { --sla: #3fb950; --sla-on: #0d1117; display: inline-flex; align-items: center; gap: 3px; min-width: 0; max-width: 100%;
      padding: 1px 8px 1px 5px; border-radius: 999px; background: var(--sla); color: var(--sla-on);
      font-size: 12px; font-weight: 600; line-height: 18px; white-space: nowrap; cursor: default; }
    .sla--attention { --sla: #d29922; --sla-on: #1b1f24; }
    .sla--grave { --sla: #f85149; --sla-on: #fff; }
    .sla--stopped { background: transparent; color: var(--sla); box-shadow: inset 0 0 0 1px var(--sla); }
    .sla mat-icon { font-size: 14px; width: 14px; height: 14px; flex: none; }
    .sla__label { opacity: .8; font-weight: 500; }
    .sla__text { overflow: hidden; text-overflow: ellipsis; }
    .sla--sm { font-size: 10.5px; line-height: 16px; padding: 0 6px 0 4px; }
    .sla--sm mat-icon { font-size: 12px; width: 12px; height: 12px; }
  `]
})
export class SlaBadgeComponent {
  readonly sla = input<CardSla | null | undefined>(null);
  /** Board: sem o rótulo "SLA", fonte menor. */
  readonly compact = input(false);
  readonly tip = computed(() => {
    const s = this.sla();
    return s ? slaTooltip(s) : '';
  });
}
