import { Component, ViewEncapsulation, computed, inject, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { WorkItemPickerSource } from './work-item-picker-source.service';
import { PICKER_STYLES } from './picker.styles';

/**
 * 0085 rodada 3: repositório com autocomplete pesquisável — os repositórios do GitHub configurado
 * (`GitHub/repositories`; reserva nos ativos do plugin de PR, a mesma fonte da tela de PR). Aceita texto livre.
 */
@Component({
  selector: 'app-wi-repo-picker',
  standalone: true,
  imports: [FormsModule, MatAutocompleteModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="wip">
      <input class="wi-input" [ngModel]="value()" (ngModelChange)="onType($event)" (focus)="query.set('')"
             [matAutocomplete]="auto" [placeholder]="placeholder() || 'Repositório'" [attr.aria-label]="label()"
             autocomplete="off" spellcheck="false">
      <mat-autocomplete #auto="matAutocomplete" class="wip-panel" (optionSelected)="pick($event.option.value)">
        @for (r of options(); track r.value) {
          <mat-option [value]="r.value">
            <span class="wip-opt__name">{{ r.label }}</span>
            @if (r.label !== r.value) { <span class="wip-opt__hint">{{ r.value }}</span> }
            @if (r.defaultBranch) { <span class="wip-opt__hint">{{ r.defaultBranch }}</span> }
          </mat-option>
        }
        @if (src.repositoriesLoading()) { <mat-option class="wip-opt--status" disabled>Carregando repositórios…</mat-option> }
        @else if (!options().length) { <mat-option class="wip-opt--status" disabled>Nenhum repositório com esse nome</mat-option> }
      </mat-autocomplete>
      @if (unknown()) { <span class="wip__hint wip__hint--warn">Fora dos repositórios configurados — confira o nome.</span> }
    </div>
  `,
  styles: [PICKER_STYLES]
})
export class WiRepoPickerComponent {
  readonly src = inject(WorkItemPickerSource);

  readonly value = model<string>('');
  readonly placeholder = input<string | null>(null);
  readonly label = input<string>('Repositório');

  readonly query = signal('');
  readonly options = computed(() => {
    const q = this.query().trim().toLowerCase();
    const list = this.src.repositories();
    return q ? list.filter((r) => r.label.toLowerCase().includes(q) || r.value.toLowerCase().includes(q)) : list;
  });
  readonly unknown = computed(() => {
    const v = `${this.value() ?? ''}`.trim().toLowerCase();
    const list = this.src.repositories();
    return !!v && list.length > 0 && !list.some((r) => r.value.toLowerCase() === v || r.label.toLowerCase() === v);
  });

  constructor() {
    this.src.loadRepositories();
  }

  onType(v: string): void {
    this.value.set(`${v ?? ''}`);
    this.query.set(`${v ?? ''}`);
  }

  pick(repo: string): void {
    this.value.set(repo);
    this.query.set('');
  }
}
