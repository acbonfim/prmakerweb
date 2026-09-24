import { Component, computed, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { RepoOption } from '../../interfaces/RepoOption';

/**
 * Autocomplete de repositório. O `value` é o objeto selecionado, ou o texto digitado
 * enquanto o usuário ainda não escolheu uma opção (mesmo comportamento do mat-autocomplete).
 * `exclude` esconde repositórios (por value) que já estão em uso.
 */
@Component({
  selector: 'app-repo-autocomplete',
  standalone: true,
  imports: [FormsModule, MatAutocompleteModule, MatFormFieldModule, MatIconModule, MatInputModule],
  template: `
    @if (loading()) {
      <div class="repo-skeleton" aria-hidden="true">
        <div class="cime-skeleton repo-skeleton__label"></div>
        <div class="cime-skeleton repo-skeleton__control"></div>
      </div>
    } @else {
      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <mat-label>{{ label() }}</mat-label>
        <input matInput type="text" [placeholder]="label()"
               [readonly]="readonly()"
               [matAutocomplete]="repoAuto"
               [matAutocompleteDisabled]="readonly()"
               [ngModel]="value()"
               (ngModelChange)="onInput($event)"
               (focus)="query.set(textOf(value()))"/>
        <mat-icon matSuffix>expand_more</mat-icon>
        <mat-autocomplete #repoAuto="matAutocomplete"
                          [displayWith]="display"
                          (optionSelected)="onSelected($event.option.value)">
          @for (repo of filtered(); track repo.value) {
            <mat-option [value]="repo">{{ repo.label }}</mat-option>
          }
        </mat-autocomplete>
      </mat-form-field>
    }
  `,
  styles: [`
    :host { display: block; }
    mat-form-field { width: 100%; }

    .repo-skeleton {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 8px;
    }
    .repo-skeleton__label { width: 90px; height: 10px; }
    .repo-skeleton__control { width: 100%; height: 40px; border-radius: 8px; }
  `]
})
export class RepoAutocompleteComponent {
  readonly options = input<RepoOption[]>([]);
  readonly exclude = input<string[]>([]);
  readonly label = input('Repositório');
  readonly loading = input(false);
  readonly readonly = input(false);

  readonly value = model<RepoOption | string | null>(null);
  readonly selected = output<RepoOption>();

  readonly query = signal('');

  readonly filtered = computed(() => {
    const q = this.query().toLowerCase();
    const excluded = new Set(this.exclude());
    return this.options().filter(r =>
      !excluded.has(r.value) && r.label.toLowerCase().includes(q)
    );
  });

  /** Exibe o label do repositório no input (o valor é o objeto). */
  display = (repo: RepoOption | string | null): string =>
    repo && typeof repo === 'object' ? repo.label : (repo ?? '');

  textOf(value: RepoOption | string | null): string {
    return typeof value === 'string' ? value : value?.label ?? '';
  }

  onInput(value: RepoOption | string | null): void {
    this.value.set(value);
    this.query.set(this.textOf(value));
  }

  onSelected(repo: RepoOption): void {
    this.value.set(repo);
    this.selected.emit(repo);
  }
}
