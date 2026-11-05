import { Component, computed, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { GuidedTourService } from './guided-tour.service';
import { TourDefinition, TourHost, TourStep } from './tour.model';

export interface TourHelpData {
  tour: TourDefinition;
  hasCard: boolean;
  /** 0084: para esconder os passos que a pessoa não pode usar (`requires`). */
  host?: TourHost;
}

/** Resultado: `{ tour: true }` = fazer o tour; `{ from: id }` = mostrar aquele passo na tela. */
export type TourHelpResult = { tour: true } | { from: string } | undefined;

/**
 * 0081: "Como usar esta tela" — o guia completo, gerado do mesmo cadastro de passos do tour (não fica desatualizado em
 * relação ao tour). Cada item mostra o texto completo e "Mostrar na tela" começa o tour naquele ponto.
 */
@Component({
  selector: 'app-tour-help-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div class="th">
      <header class="th__head">
        <mat-icon class="th__icon">help_outline</mat-icon>
        <div class="th__titles">
          <span class="th__title">{{ data.tour.title }}</span>
          @if (data.tour.help?.subtitle; as sub) { <span class="th__sub">{{ sub }}</span> }
        </div>
        <button mat-icon-button mat-dialog-close aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </header>
      <div class="th__body">
        @if (data.tour.help?.tips?.length) {
          <div class="th__tips">
            <b>Para usar do jeito certo</b>
            <ul>
              @for (t of data.tour.help!.tips!; track $index) { <li [innerHTML]="t"></li> }
            </ul>
          </div>
        }
        @for (g of groups(); track g.name) {
          <section class="th__group">
            <h3>{{ g.name }}</h3>
            @for (s of g.steps; track s.id) {
              <article class="th__item">
                <div class="th__item-text">
                  <b>{{ s.title }}</b>
                  <p [innerHTML]="s.detail || s.body"></p>
                </div>
                @if (s.anchor) {
                  @if (tours.available(s)) {
                    <button mat-button class="th__show" (click)="show(s)"><mat-icon>my_location</mat-icon>Mostrar na tela</button>
                  } @else {
                    <span class="th__na">{{ s.phase !== 'entry' && !data.hasCard ? 'abra um card para ver' : 'aparece quando houver' }}</span>
                  }
                }
              </article>
            }
          </section>
        }
      </div>
      <footer class="th__foot">
        <span class="th__hint">O tour usa a própria tela: o que você vê nele é o que está aqui.</span>
        <span class="th__spacer"></span>
        <button mat-flat-button color="primary" (click)="ref.close({ tour: true })"><mat-icon>tour</mat-icon>Fazer o tour</button>
      </footer>
    </div>
  `,
  styles: [`
    .th { display: flex; flex-direction: column; max-height: 88vh; color: var(--mat-sys-on-surface); background: var(--surface-1, #2a2a2a); }
    .th__head { display: flex; align-items: center; gap: 10px; padding: 12px 10px 12px 18px; background: var(--surface-2, #323232); }
    .th__icon { color: var(--mat-sys-primary); }
    .th__titles { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .th__title { font-weight: 600; font-size: 15px; }
    .th__sub { font-size: 12px; opacity: .65; }
    .th__body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 18px; display: flex; flex-direction: column; gap: 14px; }
    .th__tips { padding: 10px 14px; border-radius: 12px; font-size: 13px; background: rgba(142,108,240,.1); border: 1px solid rgba(196,167,255,.25); }
    .th__tips ul { margin: 6px 0 0; padding-left: 18px; line-height: 1.55; }
    .th__group h3 { margin: 0 0 6px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; opacity: .6; }
    .th__item { display: flex; gap: 12px; align-items: flex-start; padding: 9px 0; border-bottom: 1px solid rgba(255,255,255,.06); }
    .th__item-text { flex: 1; min-width: 0; font-size: 13px; }
    .th__item-text p { margin: 3px 0 0; line-height: 1.5; opacity: .8; }
    .th__show { flex: none; }
    .th__na { flex: none; font-size: 11.5px; opacity: .5; padding-top: 4px; }
    .th__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 16px; background: var(--surface-2, #323232); }
    .th__hint { font-size: 12px; opacity: .6; }
    .th__spacer { flex: 1; }
    @media (max-width: 600px) { .th__item { flex-direction: column; gap: 4px; } }
  `]
})
export class TourHelpDialogComponent {
  readonly data = inject<TourHelpData>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<TourHelpDialogComponent, TourHelpResult>);
  readonly tours = inject(GuidedTourService);

  readonly groups = computed(() => {
    const map = new Map<string, TourStep[]>();
    for (const s of this.data.tour.steps.filter((x) => x.guide !== false && this.tours.allowed(x, this.data.host))) map.set(s.group, [...(map.get(s.group) ?? []), s]);
    return Array.from(map, ([name, steps]) => ({ name, steps }));
  });

  show(s: TourStep): void {
    this.ref.close({ from: s.id });
  }
}
