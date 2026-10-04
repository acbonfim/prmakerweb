import { Component, OnDestroy, computed, input, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ReverseRevisionHead } from '../../../services/reverse-engineering.service';

/**
 * Andamento ao vivo da sessão do Claude que escreve o documento (0052): etapas (com as áreas da leitura), a linha
 * "agora" com o que ele está fazendo, há quanto tempo, e o registro curto. Atualiza pelo tempo real (a página repassa
 * a revisão nova); o relógio só recalcula o "há X".
 */
@Component({
  selector: 'app-re-progress',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule],
  template: `
    @if (revision().progress; as p) {
      <section class="prog" [class.prog--idle]="idle()">
        <header>
          <span class="live" [class.live--on]="live()"></span>
          <b>{{ live() ? 'Gerando agora' : statusLabel() }}</b>
          <span class="muted">revisão #{{ revision().number }} · {{ modeLabel() }} · por {{ revision().createdBy }}</span>
          <span class="spacer"></span>
          @if (revision().progressAt) { <span class="muted" [matTooltip]="date(revision().progressAt)">última novidade {{ ago(revision().progressAt) }}</span> }
        </header>
        @if (p.activity && live()) {
          <div class="now"><mat-icon>bolt</mat-icon><span>Agora: {{ p.activity }}</span><span class="muted">{{ ago(p.activityAt) }}</span></div>
        }
        @if (idle()) {
          <div class="idle"><mat-icon>schedule</mat-icon>Sem novidade há {{ ago(revision().progressAt) }} — a sessão do Claude pode ter parado. Quem abriu
            ({{ revision().createdBy }}) retoma com o mesmo comando; o rascunho já gravado não se perde.</div>
        }
        <ol class="steps">
          @for (s of p.steps; track s.key) {
            <li [class]="'step step--' + s.status" [class.step--child]="!!s.parent">
              <mat-icon>{{ icon(s.status) }}</mat-icon>
              <span class="step__title">{{ s.title }}</span>
              @if (s.detail) { <span class="step__detail">{{ s.detail }}</span> }
              @if (s.status === 'running' && s.startedAt) { <span class="muted">há {{ since(s.startedAt) }}</span> }
            </li>
          }
        </ol>
        @if (p.logs.length) {
          <details class="logs" [open]="logsOpen()" (toggle)="logsOpen.set($any($event.target).open)">
            <summary>Registro ({{ p.logs.length }})</summary>
            <ul>
              @for (l of recentLogs(); track $index) {
                <li [class]="'log log--' + l.kind"><span class="muted">{{ time(l.at) }}</span> {{ l.text }}</li>
              }
            </ul>
          </details>
        }
      </section>
    }
  `,
  styles: [`
    .prog { padding: 12px 16px; border-radius: 10px; background: rgba(88,166,255,.06); border: 1px solid rgba(88,166,255,.3); margin: 10px 0; }
    .prog--idle { border-color: rgba(210,153,34,.5); }
    header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13.5px; }
    .spacer { flex: 1; }
    .muted { font-size: 12px; opacity: .65; }
    .live { width: 10px; height: 10px; border-radius: 50%; background: #6e7681; flex: none; }
    .live--on { background: #3fb950; box-shadow: 0 0 0 0 rgba(63,185,80,.6); animation: pulse 1.6s infinite; }
    @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(63,185,80,.6); } 70% { box-shadow: 0 0 0 8px rgba(63,185,80,0); } 100% { box-shadow: 0 0 0 0 rgba(63,185,80,0); } }
    .now { display: flex; align-items: center; gap: 6px; margin: 8px 0 2px; font-size: 13px; color: #58a6ff; }
    .now mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .idle { display: flex; gap: 6px; align-items: flex-start; margin: 8px 0; font-size: 12.5px; color: #d29922; }
    .idle mat-icon { font-size: 17px; width: 17px; height: 17px; flex: none; }
    .steps { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .step { display: flex; align-items: center; gap: 8px; font-size: 13px; }
    .step mat-icon { font-size: 18px; width: 18px; height: 18px; flex: none; }
    .step--child { padding-left: 26px; font-size: 12.5px; }
    .step--pending { opacity: .55; }
    .step--running mat-icon { color: #58a6ff; animation: spin 1.4s linear infinite; }
    .step--completed mat-icon { color: #3fb950; }
    .step--failed mat-icon { color: #f85149; }
    .step--skipped { opacity: .5; text-decoration: line-through; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .step__detail { font-size: 12px; opacity: .75; padding: 0 8px; border-radius: 8px; background: rgba(255,255,255,.06); }
    .logs { margin-top: 8px; font-size: 12.5px; }
    .logs summary { cursor: pointer; opacity: .8; }
    .logs ul { list-style: none; margin: 6px 0 0; padding: 0; max-height: 220px; overflow-y: auto; }
    .log { padding: 2px 0; }
    .log--warning { color: #d29922; } .log--error { color: #f85149; } .log--progress { color: #3fb950; }
  `]
})
export class ReProgressComponent implements OnDestroy {
  revision = input.required<ReverseRevisionHead>();
  logsOpen = signal(false);
  private now = signal(Date.now());
  private timer = setInterval(() => this.now.set(Date.now()), 15000);

  /** Rascunho com novidade nos últimos 3 min = sessão do Claude rodando. */
  live = computed(() => ['draft', 'changes'].includes(this.revision().status) && this.minutes(this.revision().progressAt) < 3);
  idle = computed(() => ['draft', 'changes'].includes(this.revision().status) && this.minutes(this.revision().progressAt) >= 10
    && (this.revision().progress?.steps ?? []).some(s => s.status === 'running'));
  recentLogs = computed(() => [...(this.revision().progress?.logs ?? [])].reverse().slice(0, 40));
  statusLabel = computed(() => ({ draft: 'Rascunho', changes: 'Ajustes pedidos', review: 'Enviado para revisão', approved: 'Aprovado' } as any)[this.revision().status] ?? this.revision().status);
  modeLabel = computed(() => ({ new: 'novo', improve: 'melhorar', redo: 'refazer', manual: 'manual' } as any)[this.revision().mode] ?? this.revision().mode);

  ngOnDestroy() { clearInterval(this.timer); }

  icon(status: string) {
    return ({ pending: 'radio_button_unchecked', running: 'autorenew', completed: 'check_circle', failed: 'error', skipped: 'remove_circle_outline' } as any)[status] ?? 'help';
  }

  private minutes(at?: string | null) { return at ? (this.now() - new Date(at).getTime()) / 60000 : 9999; }

  ago(at?: string | null) {
    if (!at) return '';
    const m = this.minutes(at);
    if (m < 1) return 'agora há pouco';
    if (m < 60) return `há ${Math.floor(m)} min`;
    if (m < 1440) return `há ${Math.floor(m / 60)} h`;
    return `há ${Math.floor(m / 1440)} d`;
  }
  since(at: string) { const m = this.minutes(at); return m < 1 ? '< 1 min' : m < 60 ? `${Math.floor(m)} min` : `${Math.floor(m / 60)} h ${Math.floor(m % 60)} min`; }
  time(at: string) { return new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  date(at?: string | null) { return at ? new Date(at).toLocaleString('pt-BR') : ''; }
}
