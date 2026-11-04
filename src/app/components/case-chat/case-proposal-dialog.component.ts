import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ExecutionPlanService, planApiError } from '../../services/execution-plan.service';
import { CaseChatService } from '../../services/case-chat.service';
import { PlanMarkdownPipe } from '../execution-plan/plan-markdown.pipe';
import { ExecutionPlan } from '../execution-plan/execution-plan.model';
import { CaseProposal, CaseProposalChange } from './case-chat.model';

export interface CaseProposalDialogData {
  card: string;
  proposal: CaseProposal;
  canDecide: boolean;
  hasPlan: boolean;
}

/**
 * 0080: "Ver o que muda" — a versão atual do plano (da fase da proposta) ao lado das mudanças propostas pelo
 * especialista, cada uma com a mensagem de origem. Aceitar vira uma instrução no plano (o Claude do tratamento monta a
 * nova versão); nada muda antes disso. Fecha com `true` quando decidiu.
 */
@Component({
  selector: 'app-case-proposal-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatIconModule, PlanMarkdownPipe],
  template: `
    <div class="pd">
      <header class="pd__head">
        <mat-icon class="pd__icon">difference</mat-icon>
        <div class="pd__titles">
          <span class="pd__title">{{ phaseLabel() }} — o que muda</span>
          <span class="pd__sub">Proposta #{{ p.number }} do Especialista do caso · {{ p.title }}</span>
        </div>
        <span class="pd__badge pd__badge--{{ p.status }}">{{ statusLabel() }}</span>
        <button mat-icon-button mat-dialog-close aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </header>

      <div class="pd__body">
        <div class="pd__cols">
          <section>
            <h4><mat-icon>history</mat-icon>{{ current() ? 'v' + (current()!.versionNumber ?? '?') + ' · ' + planStatus() : 'Versão atual' }}</h4>
            @if (loading()) {
              <p class="pd__hint">Carregando a versão atual…</p>
            } @else if (!current()) {
              <p class="pd__hint">Ainda não há {{ p.phase === 'correction' ? 'plano de correção' : 'plano de análise' }} — a proposta cria a primeira versão.</p>
            } @else {
              @for (s of currentSteps(); track s.key) {
                <div class="pd__s" [class.pd__s--removed]="removed(s.title)">
                  <mat-icon>{{ s.status === 'completed' ? 'check' : s.status === 'cancelled' ? 'block' : 'radio_button_unchecked' }}</mat-icon>
                  <span>{{ s.title }}</span>
                </div>
              }
            }
          </section>
          <section>
            <h4><mat-icon>fiber_new</mat-icon>Nova versão · proposta</h4>
            @for (c of p.changes; track $index) {
              <div class="pd__s pd__s--{{ c.kind }}">
                <mat-icon>{{ icon(c) }}</mat-icon>
                <span><b>{{ label(c) }}:</b> {{ c.title }}
                  @if (c.detail) { <small>{{ c.detail }}</small> }
                  @if (c.fromMessage) { <small class="pd__from">mensagem {{ c.fromMessage }} da conversa</small> }
                </span>
              </div>
            }
          </section>
        </div>
        @if (p.summary) {
          <div class="pd__summary plan-md" [innerHTML]="p.summary | planMarkdown:'card'"></div>
        }
        @if (rejecting()) {
          <input class="pd__reason" [(ngModel)]="reason" placeholder="Por que não? (vai para a conversa — opcional)" (keydown.enter)="decide(false)" />
        }
      </div>

      <footer class="pd__foot">
        @if (p.status === 'pending' && data.canDecide) {
          <button mat-flat-button color="primary" (click)="decide(true, false)" [disabled]="busy() || !data.hasPlan"><mat-icon>check</mat-icon>Aceitar e criar a nova versão</button>
          <button mat-stroked-button (click)="decide(true, true)" [disabled]="busy() || !data.hasPlan"><mat-icon>play_arrow</mat-icon>Aceitar e já executar</button>
          <button mat-button (click)="rejecting() ? decide(false) : rejecting.set(true)" [disabled]="busy()">{{ rejecting() ? 'Recusar' : 'Ainda não' }}</button>
        } @else if (p.status === 'pending') {
          <span class="pd__hint">Quem aceita: o dono do plano, um admin ou um gestor. Comente na conversa o que achou.</span>
        }
        <span class="pd__spacer"></span>
        <span class="pd__hint">o Claude do tratamento monta a nova versão · o histórico guarda a anterior</span>
      </footer>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .pd { display: flex; flex-direction: column; max-height: 90vh; color: var(--mat-sys-on-surface); background: var(--surface-1, #2a2a2a); }
    .pd__head { display: flex; align-items: center; gap: 10px; padding: 12px 10px 12px 18px; background: var(--surface-2, #323232); }
    .pd__icon { color: var(--mat-sys-primary); }
    .pd__titles { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .pd__title { font-weight: 600; font-size: 15px; }
    .pd__sub { font-size: 12px; opacity: .65; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pd__badge { font-size: 11.5px; padding: 3px 10px; border-radius: 12px; background: color-mix(in srgb, #c4a7ff 15%, transparent); color: #c4a7ff; }
    .pd__badge--accepted { color: #3fb950; background: color-mix(in srgb, #3fb950 12%, transparent); }
    .pd__badge--rejected, .pd__badge--superseded { color: #9a9ca3; background: rgba(255,255,255,.06); }
    .pd__body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 18px; display: flex; flex-direction: column; gap: 12px; }
    .pd__cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .pd__cols h4 { margin: 0 0 8px; display: flex; align-items: center; gap: 6px; font-size: 12.5px; opacity: .7; font-weight: 600; }
    .pd__cols h4 mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .pd__s { display: flex; gap: 8px; align-items: flex-start; padding: 7px 9px; border-radius: 9px; font-size: 12.5px; margin-bottom: 5px;
      background: rgba(255,255,255,.03); }
    .pd__s mat-icon { font-size: 16px; width: 16px; height: 16px; flex: none; margin-top: 1px; opacity: .7; }
    .pd__s small { display: block; opacity: .65; font-size: 11.5px; }
    .pd__from { color: #c4a7ff; opacity: 1 !important; }
    .pd__s--add { background: color-mix(in srgb, #3fb950 9%, transparent); box-shadow: inset 3px 0 0 #3fb950; } .pd__s--add mat-icon { color: #3fb950; opacity: 1; }
    .pd__s--remove { background: color-mix(in srgb, #f47067 8%, transparent); box-shadow: inset 3px 0 0 #f47067; } .pd__s--remove mat-icon { color: #f47067; opacity: 1; }
    .pd__s--change, .pd__s--decision { background: color-mix(in srgb, #e3b341 8%, transparent); box-shadow: inset 3px 0 0 #e3b341; }
    .pd__s--change mat-icon, .pd__s--decision mat-icon { color: #e3b341; opacity: 1; }
    .pd__s--removed { text-decoration: line-through; opacity: .6; }
    .pd__summary { font-size: 12.5px; border-radius: 10px; padding: 10px 12px; background: rgba(255,255,255,.03); }
    .pd__reason { border: 1px solid rgba(255,255,255,.14); border-radius: 8px; background: transparent; color: inherit; padding: 8px 10px; font: inherit; }
    .pd__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 16px; background: var(--surface-2, #323232); }
    .pd__spacer { flex: 1; }
    .pd__hint { font-size: 12px; opacity: .65; }
    @media (max-width: 720px) { .pd__cols { grid-template-columns: 1fr; } }
  `]
})
export class CaseProposalDialogComponent {
  readonly data = inject<CaseProposalDialogData>(MAT_DIALOG_DATA);
  private ref = inject(MatDialogRef<CaseProposalDialogComponent>);
  private plans = inject(ExecutionPlanService);
  private chat = inject(CaseChatService);
  private snack = inject(MatSnackBar);

  readonly p = this.data.proposal;
  readonly current = signal<ExecutionPlan | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly rejecting = signal(false);
  reason = '';

  readonly currentSteps = computed(() => (this.current()?.steps ?? []).slice().sort((a, b) => a.order - b.order));
  readonly phaseLabel = computed(() => this.p.phase === 'correction' ? 'Correção — nova versão' : 'Análise — nova versão');
  readonly statusLabel = computed(() => ({ pending: 'proposta · ainda não vale', accepted: 'aceita', rejected: 'recusada', superseded: 'substituída' })[this.p.status]);
  readonly planStatus = computed(() => ({ completed: 'concluída', cancelled: 'cancelada', failed: 'falhou', paused: 'pausada', running: 'em andamento', pending: 'pendente' } as Record<string, string>)[this.current()?.status ?? ''] ?? '');

  constructor() {
    this.plans.history(this.data.card).subscribe({
      next: (list) => {
        const latest = (list ?? []).find((s) => (s.phase ?? 'analysis') === this.p.phase);
        if (!latest) { this.loading.set(false); return; }
        this.plans.get(latest.id).subscribe({
          next: (plan) => { this.current.set(plan); this.loading.set(false); },
          error: () => this.loading.set(false)
        });
      },
      error: () => this.loading.set(false)
    });
  }

  removed(title: string): boolean {
    const t = title.toLowerCase();
    return this.p.changes.some((c) => c.kind === 'remove' && (t.includes(c.title.toLowerCase()) || c.title.toLowerCase().includes(t)));
  }

  icon(c: CaseProposalChange): string {
    return ({ add: 'add', remove: 'remove', decision: 'how_to_reg', keep: 'check' } as Record<string, string>)[c.kind] ?? 'edit';
  }

  label(c: CaseProposalChange): string {
    return ({ add: 'Adicionar', remove: 'Remover', decision: 'Decisão', keep: 'Manter' } as Record<string, string>)[c.kind] ?? 'Alterar';
  }

  decide(accept: boolean, execute = false): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.chat.decideProposal(this.data.card, this.p.id, accept, execute, accept ? undefined : this.reason).subscribe({
      next: () => {
        this.snack.open(accept ? 'Proposta aceita — o Claude do tratamento monta a nova versão do plano.' : 'Proposta recusada.', 'Ok', { duration: 6000 });
        this.ref.close(true);
      },
      error: (err) => {
        this.busy.set(false);
        this.snack.open(planApiError(err, 'Não foi possível decidir a proposta.'), 'Fechar', { duration: 8000 });
      }
    });
  }
}
