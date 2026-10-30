import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { PromotionService } from '../../../services/promotion.service';
import { PromotionParse } from './promotion.model';

/**
 * "Colar mensagem do Release Manager" (0074): interpreta o texto (cards por regex; versão e regras de destino pela IA do
 * usuário) e mostra o que entendeu. Nada é disparado — "Aplicar na tela" só preenche o lote, que o usuário revisa.
 */
@Component({
  selector: 'app-promotion-paste-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatDialogModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>Colar mensagem do Release Manager</h2>
    <mat-dialog-content class="pd">
      <p class="pd__hint">
        Cole a mensagem inteira (com a tabela de cards). Os cards são lidos por regras; a versão e as regras de destino
        são interpretadas pela IA configurada na <strong>sua</strong> conta (usa a sua chave — uma chamada curta).
        Nada é aberto agora: você revisa na tela antes de disparar.
      </p>
      <textarea class="pd__text" rows="10" [ngModel]="text()" (ngModelChange)="text.set($event); result.set(null)"
                placeholder="Boa tarde pessoal… hotfix V3.274.10 … Branch para ticket Netcore: hotfix-version …"
                aria-label="Mensagem do Release Manager"></textarea>

      @if (error()) { <div class="pd__error" role="alert"><mat-icon>error_outline</mat-icon> {{ error() }}</div> }

      @if (result(); as r) {
        <div class="pd__result">
          <div class="pd__line"><strong>Versão:</strong> {{ r.version || '—' }}
            @if (r.kind) { · <strong>Tipo:</strong> {{ r.kind === 'hotfix' ? 'Hotfix' : 'Release' }} }
          </div>
          <div class="pd__line"><strong>Cards:</strong> {{ r.cards.length }}
            @if (r.cards.length) { <span class="pd__muted"> — {{ cardList(r) }}</span> }
          </div>
          @if (r.rules.length) {
            <div class="pd__rules">
              <strong>Regras de destino</strong>
              @for (rule of r.rules; track rule.ticketType) {
                <div class="pd__rule">
                  <span class="pd__tt">{{ rule.ticketType }}</span>
                  <mat-icon>arrow_forward</mat-icon>
                  @for (t of rule.targets; track t.branch) {
                    <code>{{ t.branch }}</code>@if (t.draft) { <span class="pd__draft">rascunho</span> }
                  }
                  <span class="pd__kind" [class.pd__kind--none]="!rule.kind">{{ rule.kind || 'tipo não identificado' }}</span>
                </div>
              }
            </div>
          }
          @for (w of r.warnings; track w) { <div class="pd__warn"><mat-icon>warning_amber</mat-icon> {{ w }}</div> }
          @if (r.aiUsed) { <div class="pd__muted">IA: {{ r.provider }}{{ r.model ? ' · ' + r.model : '' }}</div> }
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancelar</button>
      <button mat-stroked-button (click)="interpret()" [disabled]="busy() || !text().trim()">
        <mat-icon>auto_awesome</mat-icon> {{ busy() ? 'Interpretando…' : 'Interpretar' }}
      </button>
      <button mat-flat-button color="primary" (click)="apply()" [disabled]="!canApply()">Aplicar na tela</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .pd { min-width: min(640px, 86vw); display: flex; flex-direction: column; gap: 10px; }
    .pd__hint { margin: 0; font-size: 13px; color: color-mix(in srgb, var(--mat-sys-on-surface) 65%, transparent); }
    .pd__text { width: 100%; box-sizing: border-box; resize: vertical; font: 13px/1.4 ui-monospace, Menlo, monospace; padding: 10px; border-radius: 8px;
                border: 1px solid color-mix(in srgb, var(--mat-sys-on-surface) 25%, transparent); background: transparent; color: inherit; }
    .pd__text:focus { outline: 2px solid var(--mat-sys-primary); outline-offset: 1px; }
    .pd__error { display: flex; gap: 6px; align-items: center; color: #f0716a; font-size: 13px; }
    .pd__result { border: 1px solid color-mix(in srgb, var(--mat-sys-on-surface) 14%, transparent); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
    .pd__muted { color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent); font-size: 12px; }
    .pd__rules { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
    .pd__rule { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .pd__rule mat-icon { font-size: 14px; width: 14px; height: 14px; opacity: .6; }
    .pd__tt { font-weight: 600; }
    code { font-size: 12px; background: color-mix(in srgb, var(--mat-sys-on-surface) 8%, transparent); padding: 1px 6px; border-radius: 4px; }
    .pd__draft { font-size: 11px; color: #d29922; }
    .pd__kind { margin-left: auto; font-size: 11px; padding: 1px 8px; border-radius: 999px; background: color-mix(in srgb, var(--mat-sys-primary) 16%, transparent); color: var(--mat-sys-primary); }
    .pd__kind--none { background: color-mix(in srgb, #d29922 20%, transparent); color: #d29922; }
    .pd__warn { display: flex; gap: 6px; align-items: flex-start; color: #d29922; }
    .pd__warn mat-icon { font-size: 16px; width: 16px; height: 16px; flex: 0 0 auto; }
  `]
})
export class PromotionPasteDialogComponent {
  private api = inject(PromotionService);
  private ref = inject<MatDialogRef<PromotionPasteDialogComponent, PromotionParse | null>>(MatDialogRef);

  readonly text = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<PromotionParse | null>(null);

  canApply = () => !!this.result() && (this.result()!.cards.length > 0 || !!this.result()!.version);

  cardList(r: PromotionParse): string {
    const ids = r.cards.map(c => c.card);
    return ids.length <= 8 ? ids.join(', ') : `${ids.slice(0, 8).join(', ')} … +${ids.length - 8}`;
  }

  interpret(): void {
    if (this.busy() || !this.text().trim()) return;
    this.busy.set(true);
    this.error.set(null);
    this.result.set(null);
    this.api.parse(this.text()).subscribe({
      next: r => { this.result.set(r); this.busy.set(false); },
      error: e => {
        this.error.set(e?.error?.error || e?.error?.message || 'Não consegui interpretar a mensagem.');
        this.busy.set(false);
      }
    });
  }

  apply(): void {
    this.ref.close(this.result());
  }
}
