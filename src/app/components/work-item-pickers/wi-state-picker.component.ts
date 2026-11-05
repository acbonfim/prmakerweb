import { Component, ViewEncapsulation, computed, effect, inject, input, model, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { CardStates } from '../../services/work-items.service';
import { WorkItemPickerSource } from './work-item-picker-source.service';
import { orderStates, pickerErrorHint } from './param-input';
import { PICKER_STYLES } from './picker.styles';

/**
 * 0085 rodada 3: novo estado do card no DevOps — os estados válidos do tipo do card (`GET Azure/card/{id}/states`),
 * sugeridos no topo com o selo "sugerido" e o atual marcado (desabilitado). Sem a lista, aceita o nome digitado.
 */
@Component({
  selector: 'app-wi-state-picker',
  standalone: true,
  imports: [FormsModule, MatAutocompleteModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="wip">
      <input class="wi-input" [ngModel]="value()" (ngModelChange)="onType($event)" (focus)="query.set('')"
             [matAutocomplete]="auto" [placeholder]="placeholder() || 'Novo estado'" [attr.aria-label]="label()"
             autocomplete="off">
      <mat-autocomplete #auto="matAutocomplete" class="wip-panel" (optionSelected)="pick($event.option.value)">
        @for (s of options(); track s.name) {
          <mat-option [value]="s.name" [disabled]="s.current">
            <span class="wip-opt__name">{{ s.name }}</span>
            @if (s.category) { <span class="wip-opt__hint">{{ s.category }}</span> }
            @if (s.current) { <span class="wip-tag wip-tag--atual">atual</span> }
            @else if (s.suggested) { <span class="wip-tag wip-tag--sugerido">sugerido</span> }
          </mat-option>
        }
        @if (loading()) { <mat-option class="wip-opt--status" disabled>Carregando os estados do card…</mat-option> }
        @else if (!options().length && states()) { <mat-option class="wip-opt--status" disabled>Nenhum estado com esse nome</mat-option> }
      </mat-autocomplete>
      @if (error(); as e) {
        <span class="wip__hint" [class.wip__hint--warn]="e.warn">{{ e.text }}</span>
      } @else if (states(); as st) {
        <span class="wip__hint">@if (st.current) { Atual: <b>{{ st.current }}</b> · }{{ st.type || 'Card' }} — {{ st.states.length }} estados</span>
      }
    </div>
  `,
  styles: [PICKER_STYLES]
})
export class WiStatePickerComponent {
  private src = inject(WorkItemPickerSource);

  readonly value = model<string>('');
  readonly card = input<string | null>(null);
  readonly placeholder = input<string | null>(null);
  readonly label = input<string>('Novo estado');

  readonly query = signal('');
  readonly states = signal<CardStates | null>(null);
  readonly loading = signal(false);
  readonly error = signal<{ text: string; warn: boolean } | null>(null);
  readonly options = computed(() => orderStates(this.states(), this.query()));

  constructor() {
    effect(() => {
      const card = this.card();
      untracked(() => this.load(card));
    });
  }

  private load(card: string | null): void {
    this.states.set(null);
    this.error.set(null);
    if (!card) return;
    this.loading.set(true);
    this.src.states(card).subscribe({
      next: (s) => { this.states.set(s ?? { states: [] }); this.loading.set(false); },
      error: (e) => {
        this.error.set(pickerErrorHint(e?.status, 'estados', `${e?.message ?? 'Não foi possível carregar os estados.'} Digite o nome do estado.`));
        this.loading.set(false);
      }
    });
  }

  onType(v: string): void {
    this.value.set(`${v ?? ''}`);
    this.query.set(`${v ?? ''}`);
  }

  pick(name: string): void {
    this.value.set(name);
    this.query.set('');
  }
}
