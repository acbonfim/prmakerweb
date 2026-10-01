import { Component, Signal, ViewChild, computed, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PlanNotesComponent } from './plan-notes.component';
import { ExecutionArtifact, ExecutionPlan, NoteTargetPlan, isPlanActive } from './execution-plan.model';

/** Sem sinal da skill por mais que isso = sessão do Claude provavelmente parada (mesmo critério do painel). */
const ONLINE_WITHIN_MS = 5 * 60 * 1000;

export interface PlanChatDialogData {
  card: string;
  /** Plano em tela (signal do painel: a conversa acompanha o tempo real sem recarregar nada aqui). */
  plan: Signal<ExecutionPlan | null>;
  targets: Signal<NoteTargetPlan[]>;
  selectedStepKey: Signal<string | null>;
  currentUserId: string | null;
  /** Hora do servidor menos a local (para o "sem sinal"). */
  serverOffsetMs: () => number;
  refresh: () => void;
  openArtifact: (artifact: ExecutionArtifact) => void;
}

/**
 * Conversa com o Claude (0037): os comentários do plano funcionam como prompts para a skill — aqui eles aparecem como
 * chat, no popup do mesmo tamanho da tela cheia do plano/linha do tempo: bolhas, envio instantâneo, destino (plano e
 * etapa), status de leitura ("o Claude leu e está analisando") e anexos arrastando ou colando.
 */
@Component({
  selector: 'app-plan-chat-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule, PlanNotesComponent],
  template: `
    <div class="pc" (paste)="onPaste($event)">
      <header class="pc__head">
        <span class="pc__icon"><mat-icon>forum</mat-icon></span>
        <div class="pc__titles">
          <span class="pc__title">Conversa com o Claude</span>
          <span class="pc__sub">Card {{ data.card }} · {{ phaseLabel() }} · o Claude considera tudo na análise</span>
        </div>
        <span class="pc__status" [class.pc__status--on]="online()" [matTooltip]="statusTooltip()">
          <span class="pc__dot"></span>{{ online() ? 'Claude conectado' : active() ? 'Claude sem sinal' : 'Plano ' + statusLabel() }}
        </span>
        <button mat-icon-button (click)="close()" matTooltip="Fechar (Esc)" aria-label="Fechar"><mat-icon>close_fullscreen</mat-icon></button>
      </header>
      <div class="pc__body">
        @if (data.plan(); as p) {
          <app-plan-notes #notes variant="chat"
            [planId]="p.id" [planPhase]="p.phase" [notes]="p.notes ?? []" [targets]="data.targets()"
            [selectedStepKey]="data.selectedStepKey()" [currentUserId]="data.currentUserId"
            [notesReadNumber]="p.notesReadNumber" [notesReadAt]="p.notesReadAt"
            [planActive]="active()" [claudeOnline]="online()"
            (changed)="data.refresh()" (openArtifact)="data.openArtifact($event)"></app-plan-notes>
        } @else {
          <div class="pc__empty"><mat-icon>smart_toy</mat-icon>Este card ainda não tem plano de execução.</div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .pc { display: flex; flex-direction: column; height: 100%; color: var(--mat-sys-on-surface); background: var(--surface-1, #2a2a2a); }
    .pc__head { flex: none; display: flex; align-items: center; gap: 12px; padding: 12px 10px 12px 18px; background: var(--surface-2, #323232);
      border-bottom: 1px solid rgba(255,255,255,.06); }
    .pc__icon { width: 38px; height: 38px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; color: var(--mat-sys-primary);
      background: linear-gradient(135deg, color-mix(in srgb, var(--mat-sys-primary) 38%, transparent), color-mix(in srgb, var(--mat-sys-primary) 10%, transparent)); }
    .pc__titles { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .pc__title { font-size: 15px; font-weight: 600; }
    .pc__sub { font-size: 12px; color: color-mix(in srgb, var(--mat-sys-on-surface) 60%, transparent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pc__status { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 13px; font-size: 11.5px;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 65%, transparent); background: rgba(255,255,255,.05); white-space: nowrap; }
    .pc__dot { width: 8px; height: 8px; border-radius: 50%; background: color-mix(in srgb, var(--mat-sys-on-surface) 40%, transparent); }
    .pc__status--on { color: #3fb950; background: color-mix(in srgb, #3fb950 10%, transparent); }
    .pc__status--on .pc__dot { background: #3fb950; box-shadow: 0 0 0 0 color-mix(in srgb, #3fb950 60%, transparent); animation: pc-pulse 2s infinite; }
    .pc__body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .pc__body app-plan-notes { flex: 1; min-height: 0; }
    .pc__empty { margin: auto; display: flex; flex-direction: column; align-items: center; gap: 8px; color: var(--plan-muted, #888); }
    @keyframes pc-pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, #3fb950 55%, transparent); } 70% { box-shadow: 0 0 0 7px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
    @media (prefers-reduced-motion: reduce) { .pc__status--on .pc__dot { animation: none; } }
    @media (max-width: 640px) { .pc__status { display: none; } }
  `]
})
export class PlanChatDialogComponent {
  readonly data = inject<PlanChatDialogData>(MAT_DIALOG_DATA);
  private ref = inject(MatDialogRef<PlanChatDialogComponent>);

  @ViewChild('notes') private notes?: PlanNotesComponent;

  readonly active = computed(() => isPlanActive(this.data.plan()?.status));
  readonly online = computed(() => {
    const p = this.data.plan();
    if (!p?.lastActivityAt || !isPlanActive(p.status)) return false;
    return Date.now() + this.data.serverOffsetMs() - Date.parse(p.lastActivityAt) < ONLINE_WITHIN_MS;
  });
  readonly phaseLabel = computed(() => (this.data.plan()?.phase === 'correction' ? 'plano de correção' : 'plano de análise'));
  readonly statusLabel = computed(() => ({ completed: 'concluído', cancelled: 'cancelado', failed: 'falhou', paused: 'pausado' } as Record<string, string>)[this.data.plan()?.status ?? ''] ?? '');
  readonly statusTooltip = computed(() => this.online()
    ? 'A sessão do Claude está ativa: ele lê o comentário novo em até 1 minuto.'
    : this.active()
      ? 'Sem sinal da sessão do Claude há mais de 5 min — o comentário fica guardado e ele lê quando voltar ao card.'
      : 'O plano terminou — o comentário fica no card para a próxima rodada.');

  /** Colar imagem em qualquer lugar do popup vai para o comentário. */
  onPaste(event: ClipboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.matches('textarea, input, [contenteditable="true"]')) return;
    const files = PlanNotesComponent.clipboardFiles(event);
    if (!files.length) return;
    event.preventDefault();
    this.notes?.addFiles(files, true);
  }

  close(): void {
    this.ref.close();
  }
}
