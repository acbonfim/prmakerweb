import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, input, model } from '@angular/core';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DomSanitizer } from '@angular/platform-browser';
import { registerWorkItemTypeIcons } from '../../helpers/work-item-type-icons';
import { WorkItemTypeInfo, itemTypeLook, offeredItemTypes } from './work-item-types';

type TypesSource = { itemTypes?: WorkItemTypeInfo[] | null } | null | undefined;

/**
 * 0085 rodada 4: ícone do **tipo do item** (cor e ícone do tipo; joaninha/livrinho só para itens legados bug/user-story).
 * `[type]`, `[catalog]` (de onde vêm os `itemTypes`), `[size]` (px, padrão 16), `[tip]` (tooltip com o nome do tipo).
 */
@Component({
  selector: 'app-wi-type-icon',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    @let l = look();
    @if (l.svg) {
      <mat-icon class="wi-ti" [svgIcon]="l.svg" [style.width.px]="size()" [style.height.px]="size()"
                [matTooltip]="tip() ? l.label : ''" [attr.aria-label]="l.label"></mat-icon>
    } @else {
      <mat-icon class="wi-ti" [style.color]="l.color" [style.width.px]="size()" [style.height.px]="size()" [style.font-size.px]="size()"
                [matTooltip]="tip() ? l.label : ''" [attr.aria-label]="l.label">{{ l.icon }}</mat-icon>
    }
  `,
  styles: [`app-wi-type-icon { display: inline-flex; align-items: center; justify-content: center; flex: none; line-height: 1; }
            app-wi-type-icon .wi-ti { line-height: 1; }`]
})
export class WiTypeIconComponent {
  readonly type = input<string | null | undefined>(null);
  readonly catalog = input<TypesSource>(null);
  readonly size = input(16);
  readonly tip = input(true);
  readonly look = computed(() => itemTypeLook(this.type(), this.catalog()));

  constructor() {
    registerWorkItemTypeIcons(inject(MatIconRegistry), inject(DomSanitizer));
  }
}

/**
 * 0085 rodada 4: escolha do tipo do item novo (chips com ícone e cor) — só os tipos oferecidos (sem bug/user-story).
 * `[(value)]`, `[catalog]`.
 */
@Component({
  selector: 'app-wi-type-chips',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="wi-tc" role="radiogroup" aria-label="Tipo do item">
      @for (t of types(); track t.key) {
        <button type="button" role="radio" class="wi-tc__chip" [class.on]="t.key === value()" [attr.aria-checked]="t.key === value()"
                [attr.data-type]="t.key" [style.--wi-tc]="t.color || null" (click)="value.set(t.key)"
                [matTooltip]="t.description || ''" matTooltipShowDelay="500">
          <mat-icon>{{ t.icon || 'task_alt' }}</mat-icon>{{ t.label }}
        </button>
      }
    </div>
  `,
  styles: [`
    .wi-tc { display: flex; flex-wrap: wrap; gap: 6px; }
    .wi-tc__chip { --wi-tc: var(--mat-sys-primary); display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px 3px 7px; border-radius: 999px;
      border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); background: none; color: var(--cc-text-2); font: inherit; font-size: 12px;
      cursor: pointer; line-height: 20px; }
    .wi-tc__chip mat-icon { font-size: 15px; width: 15px; height: 15px; color: var(--wi-tc); }
    .wi-tc__chip:hover { border-color: color-mix(in srgb, var(--wi-tc) 60%, transparent); }
    .wi-tc__chip.on { color: var(--mat-sys-on-surface); border-color: var(--wi-tc); background: color-mix(in srgb, var(--wi-tc) 16%, transparent); }
  `]
})
export class WiTypeChipsComponent {
  readonly value = model<string>('task');
  readonly catalog = input<TypesSource>(null);
  readonly types = computed(() => offeredItemTypes(this.catalog()));
}
