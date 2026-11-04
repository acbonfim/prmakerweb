import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface CancelPlanDialogData {
  phase: 'analysis' | 'correction';
  versionNumber?: number | null;
  /** PRs abertos do plano (avisa que continuam abertos). */
  openPrs: string[];
}

/** `talk` = "Conversar primeiro" (abre o Especialista do caso); `{ reason }` = cancelar com o motivo. */
export type CancelPlanDialogResult = { reason: string } | 'talk' | undefined;

const REASONS = [
  { key: 'nao-resolve', label: 'A correção não resolve o problema que eu vejo', hint: 'ex.: "a branch de QA não aceita PNG, dá erro"' },
  { key: 'base-errada', label: 'Partiu da branch ou do repositório errado', hint: 'a base real é diferente do que a análise assumiu' },
  { key: 'nao-pedi', label: 'Fez algo que eu não pedi', hint: 'ex.: abriu PR quando eu disse "só deixar o plano pronto"' },
  { key: 'sem-correcao', label: 'O card não precisa mais disso', hint: 'resolvido de outro jeito, duplicado, cancelado' },
  { key: 'outro', label: 'Outro motivo', hint: '' }
];

/**
 * 0080 (M8): cancelar deixa de ser a única saída — diz o que está errado (o motivo estruturado vai para o plano, a
 * Timeline e o contexto do especialista) e oferece conversar com o Especialista do caso antes.
 */
@Component({
  selector: 'app-cancel-plan-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div class="cpd">
      <header class="cpd__head">
        <mat-icon class="cpd__icon">stop_circle</mat-icon>
        <span class="cpd__title">Cancelar {{ data.phase === 'correction' ? 'a correção' : 'a análise' }}{{ data.versionNumber ? ' v' + data.versionNumber : '' }}?</span>
        <button mat-icon-button mat-dialog-close aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </header>
      <div class="cpd__body">
        <p class="cpd__lead">O que está errado? Isso orienta a próxima versão e o especialista.</p>
        @for (r of reasons; track r.key) {
          <label class="cpd__opt" [class.cpd__opt--on]="choice() === r.key">
            <input type="radio" name="reason" [value]="r.key" [checked]="choice() === r.key" (change)="choice.set(r.key)">
            <span>{{ r.label }}@if (r.hint) { <small>{{ r.hint }}</small> }</span>
          </label>
        }
        <textarea class="cpd__text" [(ngModel)]="detail" rows="2" placeholder="Conte em uma frase (opcional, mas ajuda muito)"></textarea>
        @if (data.openPrs.length) {
          <p class="cpd__warn"><mat-icon>info</mat-icon>{{ data.openPrs.length === 1 ? 'O PR ' + data.openPrs[0] + ' continua aberto' : 'Os PRs ' + data.openPrs.join(', ') + ' continuam abertos' }} — feche no GitHub se não for mais usar.</p>
        }
        <div class="cpd__alt">
          <span class="sp-av"><mat-icon>psychology</mat-icon></span>
          <span><b>Antes de cancelar, quer entender com o especialista?</b><br><small>Ele já tem o contexto e responde em segundos, sem mexer no plano.</small></span>
        </div>
      </div>
      <footer class="cpd__foot">
        <button mat-flat-button class="cpd__talk" (click)="ref.close('talk')"><mat-icon>psychology</mat-icon>Conversar primeiro</button>
        <span class="cpd__spacer"></span>
        <button mat-button mat-dialog-close>Voltar</button>
        <button mat-flat-button color="warn" (click)="confirm()" [disabled]="!choice()"><mat-icon>stop_circle</mat-icon>Cancelar</button>
      </footer>
    </div>
  `,
  styles: [`
    .cpd { color: var(--mat-sys-on-surface); background: var(--surface-1, #2a2a2a); }
    .cpd__head { display: flex; align-items: center; gap: 10px; padding: 12px 10px 12px 18px; background: var(--surface-2, #323232); }
    .cpd__icon { color: #f47067; }
    .cpd__title { flex: 1; font-weight: 600; font-size: 15px; }
    .cpd__body { padding: 12px 18px; display: flex; flex-direction: column; gap: 8px; }
    .cpd__lead { margin: 0 0 4px; font-size: 12.5px; opacity: .7; }
    .cpd__opt { display: flex; gap: 10px; align-items: flex-start; padding: 9px 11px; border-radius: 10px; border: 1px solid rgba(255,255,255,.12); cursor: pointer; font-size: 13px; }
    .cpd__opt small { display: block; font-size: 11.5px; opacity: .65; }
    .cpd__opt--on { border-color: color-mix(in srgb, var(--mat-sys-primary) 55%, transparent); background: color-mix(in srgb, var(--mat-sys-primary) 7%, transparent); }
    .cpd__opt input { margin-top: 3px; accent-color: var(--mat-sys-primary); }
    .cpd__text { border: 1px solid rgba(255,255,255,.14); border-radius: 10px; background: transparent; color: inherit; font: inherit; font-size: 13px; padding: 8px 10px; resize: vertical; }
    .cpd__warn { margin: 0; display: flex; gap: 6px; align-items: center; font-size: 12px; opacity: .8; }
    .cpd__warn mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .cpd__alt { display: flex; gap: 10px; align-items: center; padding: 10px 12px; border-radius: 12px; font-size: 12.5px;
      background: rgba(142,108,240,.09); border: 1px solid rgba(196,167,255,.25); }
    .cpd__alt small { opacity: .7; }
    .sp-av { width: 32px; height: 32px; flex: none; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; color: #fff;
      background: radial-gradient(circle at 30% 25%, #d9c6ff, #8e6cf0 55%, #5a3fb8); }
    .cpd__foot { display: flex; align-items: center; gap: 8px; padding: 10px 16px; background: var(--surface-2, #323232); }
    .cpd__spacer { flex: 1; }
    .cpd__talk { background: linear-gradient(135deg, #8e6cf0, #6a4fd0) !important; color: #fff !important; }
  `]
})
export class CancelPlanDialogComponent {
  readonly data = inject<CancelPlanDialogData>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<CancelPlanDialogComponent, CancelPlanDialogResult>);
  readonly reasons = REASONS;
  readonly choice = signal<string | null>(null);
  detail = '';

  confirm(): void {
    const r = REASONS.find((x) => x.key === this.choice());
    if (!r) return;
    const detail = this.detail.trim();
    const reason = r.key === 'outro' ? (detail || 'Outro motivo') : detail ? `${r.label}: ${detail}` : r.label;
    this.ref.close({ reason: reason.slice(0, 900) });
  }
}
