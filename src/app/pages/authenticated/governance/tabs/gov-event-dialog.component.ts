import { Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import {
  EVENT_CATEGORY_LABEL, GovernanceEvent, GovernanceRule, OUTCOME_LABEL, SOURCE_LABEL, labelOf,
} from '../../../../services/governance/governance.model';
import { fmtMs } from '../../../../services/governance/governance.logic';
import { formatDateTime } from '../../../../services/usage/usage.model';

export interface GovEventDialogData {
  event: GovernanceEvent;
  rules?: GovernanceRule[];
}

/** Resultado: navegar para o card/usuário do evento (quem abriu decide). */
export type GovEventDialogResult = { go: 'card'; card: number } | { go: 'user'; userId: string } | undefined;

/** Detalhe de um evento da trilha (0098): todos os campos e as regras que dispararam. */
@Component({
  selector: 'app-gov-event-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title class="title">
      <span class="badge badge--{{ e.outcome }}">{{ outcome(e.outcome) }}</span>
      <span class="mono">{{ e.action }}</span>
    </h2>
    <mat-dialog-content>
      @if (e.outcome === 'monitored') {
        <p class="note">Casou regra, mas o modo/efeito só registra: <b>teria</b> sido barrado ou avisado no modo "aplicando".</p>
      }
      <dl class="kv">
        <dt>Início</dt><dd>{{ dt(e.startedAt) }}</dd>
        <dt>Fim</dt><dd>{{ e.finishedAt ? dt(e.finishedAt) : '—' }}</dd>
        <dt>Duração</dt><dd>{{ dur(e.durationMs) }}</dd>
        <dt>Quem</dt><dd>{{ e.userName || '—' }}{{ e.role ? ' (' + e.role + ')' : '' }}</dd>
        <dt>Origem</dt><dd>{{ label(sources, e.source) }}</dd>
        <dt>Categoria</dt><dd>{{ label(categories, e.category) }}</dd>
        <dt>Card</dt><dd>{{ e.cardNumber ?? '—' }}</dd>
        <dt>Plano / fase</dt><dd>{{ e.planId ?? '—' }}{{ e.phase ? ' · ' + e.phase : '' }}</dd>
        <dt>Etapa</dt><dd>{{ e.stepKey ?? '—' }}</dd>
        <dt>Item / sub-tarefa</dt><dd>{{ e.workItemNumber != null ? '#' + e.workItemNumber : '—' }}{{ e.taskNumber != null ? ' · ' + e.taskNumber : '' }}</dd>
        <dt>Status HTTP</dt><dd>{{ e.statusCode ?? '—' }}</dd>
        <dt>Sessão</dt><dd class="mono">{{ e.sessionId ?? '—' }}</dd>
        <dt>Máquina</dt><dd class="mono">{{ e.machine ?? '—' }}</dd>
        <dt>Id</dt><dd class="mono">{{ e.id }}</dd>
      </dl>
      @if (e.detail) {
        <h3>Detalhe</h3>
        <pre class="pre">{{ e.detail }}</pre>
      }
      <h3>Regras que dispararam</h3>
      @if (e.rules.length) {
        <ul class="rules">
          @for (k of e.rules; track k) {
            @let r = ruleOf(k);
            <li>
              <b>{{ r?.name ?? k }}</b> <span class="mono muted">{{ k }}</span>
              @if (r) { <span class="badge badge--{{ r.effect }}">{{ r.effect }}</span> }
              @if (r?.message) { <div class="muted">{{ r!.message }}</div> }
            </li>
          }
        </ul>
      } @else {
        <p class="muted">Nenhuma.</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions>
      <button mat-button type="button" (click)="copy()"><mat-icon>content_copy</mat-icon> Copiar JSON</button>
      @if (e.userId) { <button mat-button type="button" (click)="ref.close({ go: 'user', userId: e.userId })">Ver pessoa</button> }
      @if (e.cardNumber) { <button mat-button type="button" (click)="ref.close({ go: 'card', card: e.cardNumber })">Ver card</button> }
      <button mat-flat-button type="button" mat-dialog-close>Fechar</button>
    </mat-dialog-actions>
  `,
  styleUrls: ['../governance-shared.css'],
  styles: [`
    :host { display: block; gap: 0; }
    .title { display: flex; align-items: center; gap: 8px; font-size: 15px; overflow-wrap: anywhere; }
    h3 { font-size: 13px; font-weight: 600; margin: 14px 0 6px; }
    .pre { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--surface-1); border-radius: 8px; padding: 8px 10px; font-size: 12px; margin: 0; }
    .rules { margin: 0; padding-left: 18px; font-size: 13px; display: flex; flex-direction: column; gap: 6px; }
    .note { font-size: 12.5px; padding: 8px 10px; border-radius: 8px; border: 1px dashed color-mix(in srgb, #d29922 70%, transparent); }
    mat-dialog-actions { flex-wrap: wrap; }
  `],
})
export class GovEventDialogComponent {
  readonly ref = inject(MatDialogRef<GovEventDialogComponent, GovEventDialogResult>);
  private readonly data = inject<GovEventDialogData>(MAT_DIALOG_DATA);
  readonly e = this.data.event;
  readonly sources = SOURCE_LABEL;
  readonly categories = EVENT_CATEGORY_LABEL;

  ruleOf(key: string): GovernanceRule | undefined {
    return this.data.rules?.find((r) => r.key === key);
  }

  outcome(o: string): string {
    return labelOf(OUTCOME_LABEL, o);
  }

  label(map: Record<string, string>, k: string | null): string {
    return labelOf(map, k);
  }

  copy(): void {
    void navigator.clipboard?.writeText(JSON.stringify(this.e, null, 2));
  }

  dt = formatDateTime;
  dur = fmtMs;
}
