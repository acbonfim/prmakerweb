import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EpicsService } from '../../services/epics.service';
import { EpicSummary, epicColor, epicStatusLook } from './epic.logic';

/**
 * 0099: chips dos épicos em que o card está (`GET Epics/by-card/{card}`), no cabeçalho da Bancada — cada um com a cor
 * do épico e link para a Mesa de gestão já no épico e no card (`auth/desk?epic=<n>&card=<card>`). Acompanha o tempo
 * real `epicsUpdated` (o card pode entrar/sair de um épico com a tela aberta). Sem épico, nada aparece.
 */
@Component({
  selector: 'app-epic-chips',
  standalone: true,
  imports: [RouterLink, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (e of epics(); track e.number) {
      <a class="epc" [routerLink]="['/auth/desk']" [queryParams]="{ epic: e.number, card: card() }" [style.--epc]="color(e)"
         [matTooltip]="tooltip(e)" matTooltipShowDelay="300" [attr.aria-label]="'Épico #' + e.number + ': ' + e.title + ' — abrir na Mesa de gestão'">
        <span class="epc__dot" aria-hidden="true"></span>
        <span class="epc__num">#{{ e.number }}</span>
        <span class="epc__title">{{ e.title }}</span>
      </a>
    }
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: nowrap; overflow: hidden; }
    :host:empty { display: none; }
    .epc { --epc: #7a5cff; display: inline-flex; align-items: center; gap: 5px; min-width: 0; max-width: 220px; height: 24px; padding: 0 9px 0 7px;
      border-radius: 999px; font-size: 12px; text-decoration: none; white-space: nowrap; color: color-mix(in srgb, var(--epc) 70%, white);
      background: color-mix(in srgb, var(--epc) 14%, transparent); border: 1px solid color-mix(in srgb, var(--epc) 40%, transparent); }
    .epc:hover { background: color-mix(in srgb, var(--epc) 24%, transparent); }
    .epc:focus-visible { outline: 2px solid var(--epc); outline-offset: 1px; }
    .epc__dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--epc); }
    .epc__num { flex: none; font-weight: 700; font-variant-numeric: tabular-nums; }
    .epc__title { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--mat-sys-on-surface); }
  `]
})
export class EpicChipsComponent {
  /** Número do card do DevOps. */
  readonly card = input<string | null>(null);

  private api = inject(EpicsService);
  readonly epics = signal<EpicSummary[]>([]);
  private sub?: Subscription;
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    effect(() => {
      const card = this.card();
      untracked(() => this.load(card));
    });
    // Tempo real: qualquer mudança nos épicos (cards entrando/saindo, título, cor) relê — com um debounce curto.
    const stop = this.api.listen(() => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.load(this.card()), 400);
    });
    inject(DestroyRef).onDestroy(() => { stop(); this.sub?.unsubscribe(); clearTimeout(this.timer); });
  }

  private load(card: string | null): void {
    this.sub?.unsubscribe();
    if (!card) {
      this.epics.set([]);
      return;
    }
    this.sub = this.api.byCard(card).subscribe({
      next: (list) => { if (this.card() === card) this.epics.set((list ?? []).filter((e) => e.status !== 'archived')); },
      // Sem épicos (erro/servidor sem a rota): os chips só não aparecem.
      error: () => { if (this.card() === card) this.epics.set([]); }
    });
  }

  color(e: EpicSummary): string {
    return epicColor(e.color);
  }

  tooltip(e: EpicSummary): string {
    return `Épico #${e.number} · ${epicStatusLook(e.status).label} — ${e.title}. Abrir na Mesa de gestão.`;
  }
}
