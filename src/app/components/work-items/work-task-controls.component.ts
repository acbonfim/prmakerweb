import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  SCHEDULE_COLOR, SCHEDULE_ICON, WorkItem, WorkTask, WorkTaskControls, WorkTaskMove, canControlTask, formatSchedule, formatWorkNumber,
  isTaskScheduled, openDependencies
} from './work-item.model';
import { WorkItemActionsService } from './work-item-actions.service';

interface MoveOption {
  position: WorkTaskMove;
  key: keyof Pick<WorkTaskControls, 'first' | 'up' | 'down' | 'last'>;
  label: string;
  icon: string;
}

const MOVES: MoveOption[] = [
  { position: 'first', key: 'first', label: 'Mover para o início', icon: 'vertical_align_top' },
  { position: 'up', key: 'up', label: 'Subir uma posição', icon: 'arrow_upward' },
  { position: 'down', key: 'down', label: 'Descer uma posição', icon: 'arrow_downward' },
  { position: 'last', key: 'last', label: 'Mover para o fim', icon: 'vertical_align_bottom' }
];

/**
 * Card 78680: o que a pessoa faz com UMA sub-tarefa sem cancelar o item — mover (início, acima, abaixo, fim), pausar,
 * continuar e cancelar só ela. Mostra de quem ela depende e se está pausada; a opção que quebraria uma dependência fica
 * desabilitada com o motivo (as regras vêm do servidor em `task.controls`). Vale para item avulso e do plano.
 */
@Component({
  selector: 'app-work-task-controls',
  standalone: true,
  imports: [MatButtonModule, MatDividerModule, MatIconModule, MatMenuModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (scheduled()) {
      <span class="wtc__badge wtc__badge--sched" [matTooltip]="'Agendada por ' + (task().heldBy || 'uma pessoa') + ' — continua sozinha ' + when() + (task().controls?.dependents?.length ? '; as que dependem dela esperam junto' : '')">
        <mat-icon>{{ clock }}</mat-icon>{{ when() }}
      </span>
    } @else if (task().held) {
      <span class="wtc__badge wtc__badge--held" [matTooltip]="'Pausada por ' + (task().heldBy || 'uma pessoa') + ' — o Claude não a faz (nem as que dependem dela) até alguém continuar'">
        <mat-icon>pause_circle</mat-icon>Pausada
      </span>
    } @else if (task().controls?.waitsForHeld; as w) {
      @if (blockerScheduled(w); as at) {
        <span class="wtc__badge wtc__badge--sched" [matTooltip]="'Depende da ' + num(w) + ', agendada para ' + at"><mat-icon>{{ clock }}</mat-icon>Espera {{ num(w) }}</span>
      } @else {
        <span class="wtc__badge wtc__badge--held" [matTooltip]="'Depende da ' + num(w) + ', que está pausada'"><mat-icon>hourglass_empty</mat-icon>Espera {{ num(w) }}</span>
      }
    }
    @if (deps(); as d) {
      <span class="wtc__badge" [matTooltip]="d.tip"><mat-icon>account_tree</mat-icon>depende de {{ d.label }}</span>
    }
    @if (show()) {
      <button mat-icon-button class="wtc__btn" [matMenuTriggerFor]="menu" [disabled]="busy()"
              matTooltip="Mover, pausar, agendar ou cancelar esta sub-tarefa" [attr.aria-label]="'Mover, pausar, agendar ou cancelar ' + num(task().number)">
        <mat-icon>{{ busy() ? 'hourglass_top' : 'more_vert' }}</mat-icon>
      </button>
      <mat-menu #menu="matMenu" class="wtc__menu" xPosition="before">
        @for (m of moves; track m.position) {
          <button mat-menu-item [disabled]="!!why(m.key)" (click)="move(m.position)">
            <mat-icon>{{ m.icon }}</mat-icon>
            <span class="wtc__opt"><span>{{ m.label }}</span>@if (why(m.key); as w) { <small>{{ w }}</small> }</span>
          </button>
        }
        <mat-divider />
        @if (scheduled()) {
          <button mat-menu-item (click)="schedule()">
            <mat-icon class="wtc__sched">{{ clock }}</mat-icon>
            <span class="wtc__opt"><span>Alterar agendamento…</span><small>Agendada para {{ when() }}</small></span>
          </button>
          <button mat-menu-item (click)="runNow()">
            <mat-icon>play_circle</mat-icon>
            <span class="wtc__opt"><span>Executar agora</span><small>Tira o agendamento e segue o item</small></span>
          </button>
          <button mat-menu-item (click)="hold(true)">
            <mat-icon>alarm_off</mat-icon>
            <span class="wtc__opt"><span>Deixar sem data</span><small>Fica pausada até alguém continuar</small></span>
          </button>
        } @else if (task().held) {
          <button mat-menu-item (click)="hold(false)">
            <mat-icon>play_circle</mat-icon>
            <span class="wtc__opt"><span>Continuar</span><small>{{ resumeHint() }}</small></span>
          </button>
        } @else {
          <button mat-menu-item [disabled]="!!task().controls?.pause" (click)="hold(true)">
            <mat-icon>pause_circle</mat-icon>
            <span class="wtc__opt"><span>Pausar</span><small>{{ task().controls?.pause || pauseHint() }}</small></span>
          </button>
        }
        @if (!scheduled()) {
          <button mat-menu-item [disabled]="!!task().controls?.schedule" (click)="schedule()">
            <mat-icon class="wtc__sched">{{ clock }}</mat-icon>
            <span class="wtc__opt"><span>Agendar…</span><small>{{ task().controls?.schedule || scheduleHint() }}</small></span>
          </button>
        }
        <button mat-menu-item [disabled]="!!task().controls?.cancel" (click)="cancel()">
          <mat-icon class="wtc__danger">cancel</mat-icon>
          <span class="wtc__opt"><span>Cancelar só esta…</span><small>{{ task().controls?.cancel || 'O item segue com as outras' }}</small></span>
        </button>
      </mat-menu>
    }
  `,
  styles: [`
    app-work-task-controls { display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; }
    .wtc__badge { display: inline-flex; align-items: center; gap: 3px; padding: 0 7px; border-radius: 999px; font-size: 10.5px; line-height: 18px;
      white-space: nowrap; border: 1px dashed var(--cc-surface-border-strong, rgba(255,255,255,.22)); color: var(--cc-text-2); }
    .wtc__badge mat-icon { font-size: 13px; width: 13px; height: 13px; }
    .wtc__badge--held { border-style: solid; border-color: color-mix(in srgb, #d29922 60%, transparent); color: #d29922; }
    .wtc__badge--sched { border-style: solid; border-color: color-mix(in srgb, ${SCHEDULE_COLOR} 60%, transparent); color: ${SCHEDULE_COLOR}; }
    .wtc__sched { color: ${SCHEDULE_COLOR}; }
    .wtc__btn.mat-mdc-icon-button { width: 28px; height: 28px; padding: 2px; }
    .wtc__btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .wtc__menu .mat-mdc-menu-item { min-height: 44px; }
    .wtc__menu .mat-mdc-menu-item-text { white-space: normal; }
    .wtc__opt { display: flex; flex-direction: column; line-height: 1.25; max-width: 300px; }
    .wtc__opt small { font-size: 11px; color: var(--cc-text-3, rgba(255,255,255,.55)); }
    .wtc__danger { color: #f47067; }
    @media (max-width: 640px) { .wtc__badge { display: none; } }
  `]
})
export class WorkTaskControlsComponent {
  private actions = inject(WorkItemActionsService);

  readonly item = input.required<WorkItem>();
  readonly task = input.required<WorkTask>();
  readonly readOnly = input(false);
  /** O item atualizado depois da ação. */
  readonly changed = output<WorkItem>();

  readonly busy = signal(false);
  readonly moves = MOVES;
  readonly num = formatWorkNumber;

  readonly clock = SCHEDULE_ICON;

  readonly show = computed(() => !this.readOnly() && canControlTask(this.item(), this.task()));

  /** 0103: agendada (pausada até o horário). */
  readonly scheduled = computed(() => isTaskScheduled(this.task()));
  readonly when = computed(() => formatSchedule(this.task().scheduledAt));

  readonly scheduleHint = computed(() => {
    const n = this.task().controls?.dependents?.length ?? 0;
    return n ? `Começa no horário; as ${n} que dependem dela esperam junto` : 'Começa sozinha no horário; as outras seguem';
  });

  /** Dependências ainda não feitas (as feitas não seguram mais nada). */
  readonly deps = computed(() => {
    const open = openDependencies(this.item(), this.task());
    if (!open.length) return null;
    const label = open.length > 2 ? `${this.num(open[0].number)} +${open.length - 1}` : open.map((t) => this.num(t.number)).join(', ');
    const implicit = this.task().controls?.implicit ? ' (pelo tipo da sub-tarefa)' : '';
    return {
      label,
      tip: `Só roda depois de${implicit}: ${open.map((t) => `${this.num(t.number)} ${t.title}`).join(' · ')} — não pode passar na frente delas.`
    };
  });

  readonly pauseHint = computed(() => {
    const n = this.task().controls?.dependents?.length ?? 0;
    return n ? `O Claude pula esta e as ${n} que dependem dela` : 'O Claude pula esta até você continuar';
  });

  readonly resumeHint = computed(() => {
    const it = this.item();
    return it.startedAt ? 'Volta para a fila na ordem atual' : 'Fica pronta para executar';
  });

  why(key: MoveOption['key']): string | null {
    return this.task().controls?.[key] ?? null;
  }

  async move(position: WorkTaskMove): Promise<void> {
    await this.run(() => this.actions.controlTask(this.task(), { action: 'move', position }));
  }

  async hold(pause: boolean): Promise<void> {
    await this.run(() => this.actions.controlTask(this.task(), { action: pause ? 'pause' : 'resume' }));
  }

  async cancel(): Promise<void> {
    await this.run(() => this.actions.cancelTask(this.item(), this.task()));
  }

  async schedule(): Promise<void> {
    await this.run(() => this.actions.scheduleTask(this.item(), this.task()));
  }

  async runNow(): Promise<void> {
    await this.run(() => this.actions.runTaskNow(this.task()));
  }

  /** A pausada que segura esta está agendada? Devolve o horário ("hoje 04:30") ou null. */
  blockerScheduled(number: number): string | null {
    const t = this.item().tasks.find((x) => x.number === number);
    return t && isTaskScheduled(t) ? formatSchedule(t.scheduledAt) : null;
  }

  private async run(fn: () => Promise<WorkItem | undefined>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const it = await fn();
      if (it) this.changed.emit(it);
    } finally {
      this.busy.set(false);
    }
  }
}
