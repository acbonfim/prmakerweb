import { Component, computed, inject, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { formatTokens, formatUsd } from '../../services/ai-usage.service';
import { TokenPricingService, TokenUsage } from '../../services/token-pricing.service';
import { TokenUsagePanelComponent } from './token-usage-panel.component';

/**
 * Consumo em tokens com detalhe num popover (0044) — clique (ou toque) abre as partes: entrada nova, cache lido com
 * desconto, cache escrito, saída, total e o custo de cada uma. `detail="full"` mostra entrada · saída · total no chip.
 */
@Component({
  selector: 'app-token-usage',
  standalone: true,
  imports: [MatIconModule, MatMenuModule, TokenUsagePanelComponent],
  template: `
    <button type="button" class="tu" [class.tu--plain]="plain()" [matMenuTriggerFor]="menu" (click)="$event.stopPropagation()"
            [attr.aria-label]="'Ver detalhes do consumo: ' + text()">
      @if (!plain()) { <mat-icon class="tu__icon" aria-hidden="true">toll</mat-icon> }
      <span class="tu__text">{{ text() }}</span>
      <mat-icon class="tu__caret" aria-hidden="true">expand_more</mat-icon>
    </button>
    <mat-menu #menu="matMenu" class="token-usage-menu" [xPosition]="xPosition()">
      <div (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
        <app-token-usage-panel [usage]="usage()" />
      </div>
    </mat-menu>
  `,
  styles: [`
    :host { display: inline-flex; vertical-align: middle; max-width: 100%; }
    .tu { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 2px 4px 2px 8px; border-radius: 999px; cursor: pointer;
      border: 1px solid rgba(255, 255, 255, .1); background: color-mix(in srgb, var(--mat-sys-on-surface) 5%, transparent);
      color: inherit; font: inherit; font-size: 12px; line-height: 18px; }
    .tu:hover, .tu:focus-visible { background: color-mix(in srgb, var(--mat-sys-on-surface) 11%, transparent); outline: none; }
    .tu--plain { border-color: transparent; background: transparent; padding: 0 2px; text-decoration: underline dotted; text-underline-offset: 3px; }
    .tu__icon { font-size: 15px; width: 15px; height: 15px; opacity: .8; }
    .tu__caret { font-size: 16px; width: 16px; height: 16px; opacity: .6; }
    .tu__text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
  `],
})
export class TokenUsageComponent {
  private pricing = inject(TokenPricingService);
  readonly usage = input.required<TokenUsage>();
  /** short: "2 M tokens · ≈ US$ 1,80"; full: "entrada 1,98 M · saída 22 mil · total 2 M · ≈ US$ 1,80"; tokens: "2 M". */
  readonly detail = input<'short' | 'full' | 'tokens'>('short');
  readonly plain = input(false);
  readonly xPosition = input<'before' | 'after'>('after');

  constructor() {
    this.pricing.ensureLoaded();
  }

  readonly text = computed(() => {
    const u = this.usage();
    const b = this.pricing.breakdown(u);
    const cost = u.reportedCostUsd ?? b.estimatedCost;
    const price = cost == null ? '' : ` · ≈ ${formatUsd(cost)}`;
    switch (this.detail()) {
      case 'full':
        return `entrada ${formatTokens(b.totalInput)} · saída ${formatTokens(u.output ?? 0)} · total ${formatTokens(b.totalTokens)}${price}`;
      case 'tokens':
        return formatTokens(b.totalTokens);
      default:
        return `${formatTokens(b.totalTokens)} tokens${price}`;
    }
  });
}
