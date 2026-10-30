import { CommonModule } from '@angular/common';
import { Component, OnDestroy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MOTION_CSS } from './promotion-motion';
import { PromotionService } from '../../../services/promotion.service';
import { PromotionParse } from './promotion.model';

const PHRASES = [
  'Separando os cards da tabela…',
  'Procurando a versão e o tipo (hotfix ou release)…',
  'Lendo as regras de destino por tipo de ticket…',
  'Conferindo com os tipos de repositório do PRMake…'
];

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

      @if (busy()) {
        <div class="pd__thinking" role="status" aria-live="polite">
          <span class="ai-orb" aria-hidden="true"><mat-icon class="ai-orb__icon">auto_awesome</mat-icon><i></i><i></i><i></i></span>
          <div class="pd__thinking-text">
            <strong>A IA está lendo a mensagem…</strong>
            <span>{{ phrase() }}</span>
          </div>
          <span class="pd__bars" aria-hidden="true"><b></b><b></b><b></b></span>
        </div>
      }

      @if (busy()) {
        <div class="pd__result pd__result--sk" aria-hidden="true">
          <span class="sk sk--text" style="width: 180px"></span>
          <span class="sk sk--text" style="width: 260px"></span>
          <span class="sk sk--line" style="width: 120px; margin-top: 6px"></span>
          <span class="sk sk--pill" style="width: 90%"></span>
          <span class="sk sk--pill" style="width: 84%"></span>
          <span class="sk sk--pill" style="width: 76%"></span>
        </div>
      }

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
              @for (rule of r.rules; track rule.ticketType; let ri = $index) {
                <div class="pd__rule" [style.--i]="ri">
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
      <button mat-stroked-button class="pd__btn" [class.pd__btn--busy]="busy()" (click)="interpret()" [disabled]="busy() || !text().trim()" [attr.aria-busy]="busy()">
        <mat-icon class="pd__ai" [class.pd__ai--busy]="busy()">auto_awesome</mat-icon> {{ busy() ? 'Interpretando…' : 'Interpretar' }}
      </button>
      <button mat-flat-button color="primary" (click)="apply()" [disabled]="!canApply()">Aplicar na tela</button>
    </mat-dialog-actions>
  `,
  styles: [MOTION_CSS, `
    .pd { min-width: min(640px, 86vw); display: flex; flex-direction: column; gap: 10px; }
    .pd__hint { margin: 0; font-size: 13px; color: color-mix(in srgb, var(--mat-sys-on-surface) 65%, transparent); }
    .pd__text { width: 100%; box-sizing: border-box; resize: vertical; font: 13px/1.4 ui-monospace, Menlo, monospace; padding: 10px; border-radius: 8px;
                border: 1px solid color-mix(in srgb, var(--mat-sys-on-surface) 25%, transparent); background: transparent; color: inherit; }
    .pd__text:focus { outline: 2px solid var(--mat-sys-primary); outline-offset: 1px; }
    .pd__error { display: flex; gap: 6px; align-items: center; color: #f0716a; font-size: 13px; }
    .pd__result { animation: mo-rise .32s ease both; border: 1px solid color-mix(in srgb, var(--mat-sys-on-surface) 14%, transparent); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
    .pd__muted { color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent); font-size: 12px; }
    .pd__rules { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
    .pd__rule { animation: mo-rise .3s ease both; animation-delay: calc(var(--i, 0) * 70ms); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .pd__rule mat-icon { font-size: 14px; width: 14px; height: 14px; opacity: .6; }
    .pd__tt { font-weight: 600; }
    code { font-size: 12px; background: color-mix(in srgb, var(--mat-sys-on-surface) 8%, transparent); padding: 1px 6px; border-radius: 4px; }
    .pd__draft { font-size: 11px; color: #d29922; }
    .pd__kind { margin-left: auto; font-size: 11px; padding: 1px 8px; border-radius: 999px; background: color-mix(in srgb, var(--mat-sys-primary) 16%, transparent); color: var(--mat-sys-primary); }
    .pd__kind--none { background: color-mix(in srgb, #d29922 20%, transparent); color: #d29922; }
    .pd__warn { animation: mo-fade .4s ease both; display: flex; gap: 6px; align-items: flex-start; color: #d29922; }
    .pd__result--sk { animation-name: mo-fade; }
    .pd__warn mat-icon { font-size: 16px; width: 16px; height: 16px; flex: 0 0 auto; }
    /* Interpretando: o ícone de IA gira e brilha; o botão ganha um brilho que corre; a faixa abaixo mostra o que a IA está fazendo. */
    .pd__ai--busy { animation: ai-spin 1.8s cubic-bezier(.5, 0, .5, 1) infinite, ai-glow 1.1s ease-in-out infinite alternate; color: var(--mat-sys-primary); }
    .pd__btn--busy { background: linear-gradient(100deg, transparent 20%, color-mix(in srgb, var(--mat-sys-primary) 22%, transparent) 50%, transparent 80%) 0 0 / 220% 100%; animation: ai-sweep 1.5s linear infinite; }
    .pd__thinking { display: flex; align-items: center; gap: 14px; padding: 12px 14px; border-radius: 12px; border: 1px solid color-mix(in srgb, var(--mat-sys-primary) 35%, transparent);
                    background: linear-gradient(100deg, color-mix(in srgb, var(--mat-sys-primary) 6%, transparent), color-mix(in srgb, var(--mat-sys-primary) 16%, transparent), color-mix(in srgb, var(--mat-sys-primary) 6%, transparent)) 0 0 / 220% 100%;
                    animation: ai-sweep 2.2s linear infinite; }
    .pd__thinking-text { display: flex; flex-direction: column; gap: 2px; font-size: 13px; min-width: 0; flex: 1; }
    .pd__thinking-text span { color: color-mix(in srgb, var(--mat-sys-on-surface) 60%, transparent); font-size: 12px; }
    .ai-orb { position: relative; width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
    .ai-orb__icon { color: var(--mat-sys-primary); animation: ai-spin 2.4s cubic-bezier(.5, 0, .5, 1) infinite, ai-glow 1.1s ease-in-out infinite alternate; }
    .ai-orb i { position: absolute; inset: 0; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--mat-sys-primary) 55%, transparent); opacity: 0; animation: ai-ring 1.8s ease-out infinite; }
    .ai-orb i:nth-of-type(2) { animation-delay: .6s; } .ai-orb i:nth-of-type(3) { animation-delay: 1.2s; }
    .pd__bars { display: inline-flex; align-items: flex-end; gap: 3px; height: 22px; }
    .pd__bars b { width: 4px; border-radius: 2px; background: var(--mat-sys-primary); animation: ai-bar 1s ease-in-out infinite; }
    .pd__bars b:nth-child(2) { animation-delay: .15s; } .pd__bars b:nth-child(3) { animation-delay: .3s; }
    @keyframes ai-spin { to { transform: rotate(360deg); } }
    @keyframes ai-glow { from { filter: drop-shadow(0 0 0 transparent); transform-origin: center; } to { filter: drop-shadow(0 0 7px var(--mat-sys-primary)); } }
    @keyframes ai-sweep { to { background-position: -220% 0; } }
    @keyframes ai-ring { 0% { transform: scale(.55); opacity: .7; } 100% { transform: scale(1.5); opacity: 0; } }
    @keyframes ai-bar { 0%, 100% { height: 5px; opacity: .5; } 50% { height: 22px; opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .pd__ai--busy, .pd__btn--busy, .pd__thinking, .ai-orb__icon, .ai-orb i, .pd__bars b { animation: none; } .ai-orb i { display: none; } }
  `]
})
export class PromotionPasteDialogComponent implements OnDestroy {
  private api = inject(PromotionService);
  private ref = inject<MatDialogRef<PromotionPasteDialogComponent, PromotionParse | null>>(MatDialogRef);

  readonly text = signal('');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<PromotionParse | null>(null);
  readonly phrase = signal(PHRASES[0]);
  private ticker?: ReturnType<typeof setInterval>;

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
    this.startTicker();
    this.api.parse(this.text()).subscribe({
      next: r => { this.result.set(r); this.busy.set(false); this.stopTicker(); },
      error: e => {
        this.error.set(e?.error?.error || e?.error?.message || 'Não consegui interpretar a mensagem.');
        this.busy.set(false);
        this.stopTicker();
      }
    });
  }

  ngOnDestroy(): void {
    this.stopTicker();
  }

  /** Troca a frase da faixa "pensando" enquanto a IA responde. */
  private startTicker(): void {
    let i = 0;
    this.phrase.set(PHRASES[0]);
    this.stopTicker();
    this.ticker = setInterval(() => this.phrase.set(PHRASES[++i % PHRASES.length]), 1400);
  }

  private stopTicker(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = undefined;
  }

  apply(): void {
    this.ref.close(this.result());
  }
}
