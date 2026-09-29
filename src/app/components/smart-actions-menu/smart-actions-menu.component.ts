import { Component, computed, input, output, viewChild } from '@angular/core';
import { CdkOverlayOrigin, OverlayModule } from '@angular/cdk/overlay';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CcPopoverComponent } from '../popover/cc-popover.component';

type SmartOptionId = 'generate-ai' | 'handover';

interface SmartOption {
  id: SmartOptionId;
  icon: string;
  label: string;
  details: string;
  /** Motivo do bloqueio (null = habilitada). */
  blockReason: string | null;
}

/**
 * Botão "Ações inteligentes" da tela do card (feature 0021): reúne as ações com IA — gerar a
 * descrição/root cause e a passagem de conhecimento (handover) — num popover no mesmo padrão do
 * "Ações DevOps". Pode abrir a partir do botão "⋯" do rodapé (`openAt`) quando não cabe na tela.
 */
@Component({
  selector: 'app-smart-actions-menu',
  standalone: true,
  imports: [OverlayModule, MatButtonModule, MatIconModule, MatTooltipModule, CcPopoverComponent],
  template: `
    <button mat-raised-button cdkOverlayOrigin #origin="cdkOverlayOrigin"
            [disabled]="!cardNumber()" (click)="pop.toggle(origin)">
      Ações inteligentes<mat-icon>auto_awesome</mat-icon>
    </button>

    <cc-popover #pop>
      <div class="sa-list" role="menu">
        <div class="sa-head">
          <mat-icon>auto_awesome</mat-icon>
          <span>Ações inteligentes · #{{ cardNumber() }}</span>
        </div>
        @for (opt of options(); track opt.id) {
          <span class="sa-wrap" [matTooltip]="opt.blockReason ? '🔒 ' + opt.blockReason : opt.details"
                matTooltipClass="devops-tooltip" matTooltipPosition="above">
            <button type="button" class="sa-item" role="menuitem" [disabled]="!!opt.blockReason"
                    (click)="select(opt)">
              <mat-icon>{{ opt.icon }}</mat-icon>
              <span class="sa-item__text">
                <span>{{ opt.label }}</span>
                <small>{{ opt.blockReason ?? opt.details }}</small>
              </span>
              @if (opt.blockReason) { <mat-icon class="sa-item__lock">lock</mat-icon> }
            </button>
          </span>
        }
      </div>
    </cc-popover>
  `,
  styles: [`
    :host { display: contents; }
    .sa-list { display: flex; flex-direction: column; gap: 1px; width: 290px; max-width: calc(100vw - 60px); margin: -6px -8px; }
    .sa-head {
      display: flex; align-items: center; gap: 6px; padding: 2px 8px 8px;
      font-size: 12px; font-weight: 600;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 65%, transparent);
      border-bottom: 1px solid var(--cc-surface-border, rgba(255, 255, 255, 0.08)); margin-bottom: 4px;
    }
    .sa-head mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--mat-sys-primary); }
    .sa-wrap { display: block; }
    /* Mesmo visual das opções do "Ações DevOps", com uma linha de explicação */
    .sa-item {
      display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
      padding: 7px 8px; border: none; border-radius: 8px; background: none; font: inherit; font-size: 13px;
      color: var(--cc-text-1, inherit); cursor: pointer;
    }
    .sa-item:hover:not(:disabled) { background: var(--cc-surface-2, rgba(255,255,255,.06)); }
    .sa-item:disabled { opacity: .45; cursor: default; }
    .sa-item mat-icon { flex: none; font-size: 18px; width: 18px; height: 18px; color: var(--cc-text-2, inherit); }
    .sa-item__text { display: flex; flex-direction: column; min-width: 0; }
    .sa-item__text small { font-size: 11px; color: color-mix(in srgb, var(--mat-sys-on-surface) 60%, transparent); }
    .sa-item__lock { margin-left: auto; font-size: 16px !important; width: 16px !important; height: 16px !important; }
  `],
})
export class SmartActionsMenuComponent {
  readonly cardNumber = input<string | null>(null);
  /** Card do DevOps carregado (o handover usa os campos, discussion e histórico). */
  readonly cardFound = input(false);
  readonly cardLoading = input(false);

  readonly generateAi = output<void>();
  readonly handover = output<void>();

  private readonly pop = viewChild.required(CcPopoverComponent);
  private readonly trigger = viewChild.required<CdkOverlayOrigin>('origin');

  readonly options = computed<SmartOption[]>(() => [
    {
      id: 'generate-ai', icon: 'model_training', label: 'Gerar com IA',
      details: 'Descrição e root cause a partir do card e dos commits',
      blockReason: null,
    },
    {
      id: 'handover', icon: 'swap_horiz', label: 'Handover',
      details: 'Passagem de conhecimento para o próximo turno',
      blockReason: this.cardLoading() ? 'Carregando o card do DevOps…'
        : !this.cardFound() ? 'Card não encontrado no DevOps' : null,
    },
  ]);

  /** Abre o menu ancorado em outro elemento (ex.: botão "⋯" do rodapé quando este não cabe). */
  openAt(origin?: CdkOverlayOrigin): void {
    if (!this.cardNumber()) return;
    this.pop().open(origin ?? this.trigger());
  }

  select(opt: SmartOption): void {
    if (opt.blockReason) return;
    this.pop().close();
    if (opt.id === 'generate-ai') this.generateAi.emit();
    else this.handover.emit();
  }
}
