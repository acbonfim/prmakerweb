import { Component, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { WORK_DIALOG_STYLES } from './work-dialog.styles';
import { SCHEDULE_COLOR, SCHEDULE_ICON, formatSchedule, isoToLocalInput, localInputToIso } from './work-item.model';

export interface WorkScheduleDialogData {
  /** "#123 Validar em QA". */
  title: string;
  /** Item (pode ficar em espera sem data) ou sub-tarefa (pausada até o horário). */
  subject: 'item' | 'task';
  /** Agendamento atual (ISO), se houver. */
  current?: string | null;
  /** Item já em espera sem data. */
  parked?: boolean;
  /** Sub-tarefas que esperam junto (dependem dela). */
  dependents?: number[];
}

/** `set` (+ `at` ISO), `park` (item sem data), `clear` (tira), `run-now` (tira e executa) ou `undefined` (desistiu). */
export type WorkScheduleDialogResult =
  | { action: 'set'; at: string }
  | { action: 'park' }
  | { action: 'clear' }
  | { action: 'run-now' }
  | undefined;

interface Quick { label: string; at: () => Date }

/** Minutos para frente, arredondando para o próximo múltiplo de 5. */
function ahead(minutes: number, now = new Date()): Date {
  const d = new Date(now.getTime() + minutes * 60_000);
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5);
  return d;
}

function tomorrowAt(hour: number, minute = 0, now = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, hour, minute, 0, 0);
  return d;
}

/**
 * 0103: agendar item ou sub-tarefa — data/hora no fuso do navegador, atalhos (+30 min, +1 h, +2h30 — a esteira de deploy —,
 * amanhã cedo), "sem data" (item opcional em espera), remover o agendamento e executar agora.
 */
@Component({
  selector: 'app-work-schedule-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatIconModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="wi-dlg">
      <header class="wi-dlg__head">
        <mat-icon class="wsd__clock">{{ icon }}</mat-icon>
        <div class="wi-dlg__head-main">
          <span class="wi-dlg__title">{{ data.current || data.parked ? 'Alterar agendamento' : 'Agendar' }}</span>
          <span class="wi-dlg__sub">{{ data.title }}</span>
        </div>
        <button mat-icon-button mat-dialog-close aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </header>
      <div class="wi-dlg__body">
        @if (data.current) {
          <div class="wi-note wsd__now"><mat-icon>{{ icon }}</mat-icon><span>Agendado para <b>{{ fmt(data.current) }}</b>.</span></div>
        } @else if (data.parked) {
          <div class="wi-note wsd__now"><mat-icon>{{ icon }}</mat-icon><span>Em espera, sem data — só roda quando alguém executar.</span></div>
        }
        <p class="wsd__text">
          @if (data.subject === 'item') {
            O item fica parado e começa sozinho no horário, no seu executor.
          } @else {
            A sub-tarefa fica pausada e continua sozinha no horário.
            @if (data.dependents?.length) { As que dependem dela ({{ deps() }}) esperam junto; } as outras seguem normalmente.
          }
        </p>
        <div class="wsd__quick">
          @for (q of quick; track q.label) {
            <button type="button" class="wsd__chip" (click)="pick(q)">{{ q.label }}</button>
          }
        </div>
        <label class="wi-field">
          <span>Data e hora ({{ zone }})</span>
          <input class="wi-input" type="datetime-local" [min]="min" [ngModel]="value()" (ngModelChange)="value.set($event)"
                 (keydown.enter)="save()" />
        </label>
        @if (preview(); as p) { <span class="wsd__preview">Começa {{ p }}.</span> }
        @if (error()) { <span class="wi-err">{{ error() }}</span> }
      </div>
      <footer class="wi-dlg__foot">
        @if (data.current || data.parked) {
          <button mat-button (click)="close({ action: 'clear' })" title="Tira o agendamento"><mat-icon>alarm_off</mat-icon>Remover</button>
        }
        @if (data.subject === 'item' && !data.parked) {
          <button mat-button (click)="close({ action: 'park' })" title="Item opcional: só roda quando alguém decidir">
            <mat-icon>pending_actions</mat-icon>Sem data
          </button>
        }
        <span class="wi-dlg__spacer"></span>
        <button mat-button (click)="close({ action: 'run-now' })"><mat-icon>play_arrow</mat-icon>Executar agora</button>
        <button mat-flat-button color="primary" (click)="save()" [disabled]="!value()"><mat-icon>{{ icon }}</mat-icon>Agendar</button>
      </footer>
    </div>
  `,
  styles: [WORK_DIALOG_STYLES, `
    .wsd__clock { color: ${SCHEDULE_COLOR}; }
    .wsd__now { background: color-mix(in srgb, ${SCHEDULE_COLOR} 10%, transparent); border-color: color-mix(in srgb, ${SCHEDULE_COLOR} 35%, transparent); }
    .wsd__now mat-icon { color: ${SCHEDULE_COLOR}; }
    .wsd__text { margin: 0; line-height: 1.5; color: var(--cc-text-2); }
    .wsd__quick { display: flex; flex-wrap: wrap; gap: 6px; }
    .wsd__chip { background: none; cursor: pointer; font: inherit; font-size: 12px; padding: 3px 10px; border-radius: 999px; color: var(--cc-text-1, inherit);
      border: 1px solid color-mix(in srgb, ${SCHEDULE_COLOR} 45%, transparent); }
    .wsd__chip:hover { background: color-mix(in srgb, ${SCHEDULE_COLOR} 14%, transparent); }
    .wsd__preview { font-size: 12px; color: ${SCHEDULE_COLOR}; }
    .wi-input[type=datetime-local] { color-scheme: dark; }
  `]
})
export class WorkScheduleDialogComponent {
  readonly data = inject<WorkScheduleDialogData>(MAT_DIALOG_DATA);
  private ref = inject(MatDialogRef<WorkScheduleDialogComponent, WorkScheduleDialogResult>);

  readonly icon = SCHEDULE_ICON;
  readonly zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'horário local';
  readonly min = isoToLocalInput(new Date());
  readonly quick: Quick[] = [
    { label: '+30 min', at: () => ahead(30) },
    { label: '+1 h', at: () => ahead(60) },
    { label: '+2h30 (esteira)', at: () => ahead(150) },
    { label: 'Amanhã 04:30', at: () => tomorrowAt(4, 30) },
    { label: 'Amanhã 08:00', at: () => tomorrowAt(8) },
  ];
  readonly value = signal(isoToLocalInput(this.data.current ?? ahead(150)));
  readonly error = signal<string | null>(null);
  readonly preview = computed(() => {
    const iso = localInputToIso(this.value());
    return iso ? formatSchedule(iso) : null;
  });

  fmt = formatSchedule;

  deps(): string {
    return (this.data.dependents ?? []).map((n) => `#${n}`).join(', ');
  }

  pick(q: Quick): void {
    this.value.set(isoToLocalInput(q.at()));
    this.error.set(null);
  }

  save(): void {
    const iso = localInputToIso(this.value());
    if (!iso) { this.error.set('Escolha a data e a hora.'); return; }
    if (new Date(iso).getTime() < Date.now() - 60_000) { this.error.set('Esse horário já passou — escolha um horário futuro (ou execute agora).'); return; }
    this.close({ action: 'set', at: iso });
  }

  close(result: WorkScheduleDialogResult): void {
    this.ref.close(result);
  }
}
