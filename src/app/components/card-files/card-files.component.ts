import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonModule } from '@angular/material/button';
import { CardFilesStore } from '../work-items/card-files.store';
import { WorkItem, formatWorkNumber, itemStatusLook } from '../work-items/work-item.model';
import { WorkItemFilesComponent } from '../work-items/work-item-files.component';
import { countFilesByItem } from '../work-items/work-item-files';

interface ItemChip {
  /** Número do item (0 = arquivos de planos sem item). */
  number: number;
  label: string;
  title: string;
  count: number;
  icon: string;
  color: string;
}

/**
 * 0087: **Arquivos do card** — tudo o que foi gerado ou anexado no card (análises, chamados, scripts, dados, anexos),
 * fora de qualquer execução. "Todos" mostra o card inteiro; escolher um item mostra só os arquivos dele. É a mesma lista
 * de cada item de trabalho (cada item continua mostrando só os seus), vista de cima.
 */
@Component({
  selector: 'app-card-files',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, WorkItemFilesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="cf" aria-label="Arquivos do card">
      <p class="cf__intro">
        <mat-icon>folder_open</mat-icon>
        <span>Todos os arquivos do card — análises, chamados, scripts, dados e anexos —, de qualquer item de trabalho.
          Escolha um item para ver só os dele; cada item também mostra os seus na própria tela.</span>
      </p>

      <div class="cf__chips" role="tablist" aria-label="Filtrar por item de trabalho">
        <button type="button" role="tab" class="cf__chip" [class.cf__chip--on]="selected() === undefined"
                [attr.aria-selected]="selected() === undefined" (click)="selected.set(undefined)">
          <mat-icon>folder_copy</mat-icon>Todos <span class="cf__n">{{ store().count() }}</span>
        </button>
        @for (c of chips(); track c.number) {
          <button type="button" role="tab" class="cf__chip" [class.cf__chip--on]="selected() === c.number"
                  [attr.aria-selected]="selected() === c.number" (click)="selected.set(c.number)"
                  [matTooltip]="c.title" matTooltipShowDelay="500">
            <mat-icon [style.color]="c.color">{{ c.icon }}</mat-icon>
            <span class="cf__label">{{ c.label }}</span><span class="cf__n">{{ c.count }}</span>
          </button>
        }
      </div>

      @if (selected() !== undefined && selectedChip(); as sc) {
        <p class="cf__scope" role="status">
          <mat-icon>filter_alt</mat-icon>
          <span>Mostrando só os arquivos de <b>{{ sc.number ? sc.label : 'versões antigas do plano (sem item)' }}</b>.</span>
          <button mat-button type="button" (click)="selected.set(undefined)">Ver todos</button>
        </p>
      }

      <app-work-item-files [store]="store()" [card]="card()" [filterItem]="selected()" [showItem]="selected() === undefined"
                           [allowUpload]="false"></app-work-item-files>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .cf { display: flex; flex-direction: column; gap: 12px; padding: 4px 2px 12px; animation: cf-in .22s ease both; }
    @keyframes cf-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    .cf__intro { display: flex; gap: 8px; align-items: flex-start; margin: 0; font-size: 12.5px; line-height: 1.45; color: var(--cc-text-3); }
    .cf__intro mat-icon { font-size: 18px; width: 18px; height: 18px; flex: none; margin-top: 1px; }
    .cf__chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .cf__chip { display: inline-flex; align-items: center; gap: 5px; max-width: 280px; padding: 3px 10px 3px 8px; border-radius: 999px;
      border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); background: transparent; color: var(--cc-text-2);
      font: inherit; font-size: 12px; cursor: pointer; transition: background-color .15s, border-color .15s, color .15s; }
    .cf__chip:hover { background: rgba(255,255,255,.05); }
    .cf__chip--on { color: var(--mat-sys-on-surface); border-color: var(--mat-sys-primary);
      background: color-mix(in srgb, var(--mat-sys-primary) 14%, transparent); }
    .cf__chip mat-icon { font-size: 15px; width: 15px; height: 15px; flex: none; }
    .cf__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cf__n { font-size: 11px; opacity: .75; font-variant-numeric: tabular-nums; }
    .cf__scope { display: flex; align-items: center; gap: 6px; margin: 0; padding: 4px 6px 4px 10px; border-radius: 8px; font-size: 12px;
      background: color-mix(in srgb, var(--mat-sys-primary) 8%, transparent); color: var(--cc-text-2); }
    .cf__scope mat-icon { font-size: 16px; width: 16px; height: 16px; flex: none; }
    .cf__scope span { flex: 1; min-width: 0; }
    @media (prefers-reduced-motion: reduce) { .cf { animation: none; } .cf__chip { transition: none; } }
  `]
})
export class CardFilesComponent {
  readonly store = input.required<CardFilesStore>();
  readonly card = input<string | null>(null);
  /** Itens do card (os que têm arquivos viram filtro). */
  readonly items = input<WorkItem[]>([]);
  /** Filtro: `undefined` = todos; número = só os arquivos desse item (0 = sem item). */
  readonly selected = model<number | undefined>(undefined);

  readonly chips = computed<ItemChip[]>(() => {
    const counts = countFilesByItem(this.store().files());
    const selected = this.selected();
    const out: ItemChip[] = [];
    for (const item of [...this.items()].sort((a, b) => b.number - a.number)) {
      const count = counts.get(item.number) ?? 0;
      if (!count && selected !== item.number) continue;
      const look = itemStatusLook(item.status);
      out.push({
        number: item.number, label: `${formatWorkNumber(item.number)} ${item.title}`, title: `${formatWorkNumber(item.number)} ${item.title} · ${look.label}`,
        count, icon: look.icon, color: look.color
      });
    }
    const orphans = counts.get(0) ?? 0;
    if (orphans || selected === 0) {
      out.push({ number: 0, label: 'Sem item', title: 'Arquivos de versões antigas do plano, anteriores aos itens de trabalho', count: orphans, icon: 'history', color: '#8b949e' });
    }
    return out;
  });
  readonly selectedChip = computed(() => this.chips().find((c) => c.number === this.selected()) ?? null);
}
