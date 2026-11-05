import { Component, ViewEncapsulation, computed, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TaskKindParam } from '../work-items/work-item.model';
import { BranchSuggestContext, paramInput, paramLink, paramOptions } from './param-input';
import { WiBranchPickerComponent } from './wi-branch-picker.component';
import { WiCommitsPickerComponent } from './wi-commits-picker.component';
import { WiRepoPickerComponent } from './wi-repo-picker.component';
import { WiStatePickerComponent } from './wi-state-picker.component';
import { WiPrPickerComponent } from './wi-pr-picker.component';
import { PICKER_STYLES } from './picker.styles';

/**
 * 0085 rodada 3: o controle de um parâmetro da sub-tarefa, escolhido pelo `input` do catálogo (ou pelo nome do
 * parâmetro): repositório, branch, branch de destino, estado do card, commits, select, textarea ou texto. Repositório
 * e branch ganham o atalho para abrir no GitHub quando a URL base é conhecida.
 */
@Component({
  selector: 'app-wi-param-field',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatTooltipModule, WiBranchPickerComponent, WiCommitsPickerComponent, WiRepoPickerComponent, WiStatePickerComponent, WiPrPickerComponent],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="wip__line">
      @switch (kindOfInput()) {
        @case ('repository') { <app-wi-repo-picker [value]="text()" (valueChange)="value.set($event)" [label]="label()" [placeholder]="param().placeholder ?? null" /> }
        @case ('branch') {
          <app-wi-branch-picker mode="branch" [value]="text()" (valueChange)="value.set($event)" [repository]="repository()" [card]="card()"
                                [suggest]="suggest()" [label]="label()" [placeholder]="param().placeholder ?? null" />
        }
        @case ('target-branch') {
          <app-wi-branch-picker mode="target-branch" [value]="text()" (valueChange)="value.set($event)" [repository]="repository()" [card]="card()"
                                [suggest]="suggest()" [label]="label()" [placeholder]="param().placeholder ?? null" />
        }
        @case ('state') { <app-wi-state-picker [value]="text()" (valueChange)="value.set($event)" [card]="card()" [label]="label()" [placeholder]="param().placeholder ?? null" /> }
        @case ('commits') { <app-wi-commits-picker [value]="text()" (valueChange)="value.set($event)" [repository]="repository()" [branch]="sourceBranch()" [label]="label()" /> }
        @case ('pull-request') {
          <app-wi-pr-picker [value]="text()" (valueChange)="value.set($event)" [card]="card()" [repository]="repository()"
                            [label]="label()" [placeholder]="param().placeholder ?? null" />
        }
        @case ('select') {
          <select class="wi-select" [ngModel]="text()" (ngModelChange)="value.set($event)" [attr.aria-label]="label()">
            <option value="">—</option>
            @for (o of options(); track o.value) { <option [value]="o.value">{{ o.label }}</option> }
            @if (text() && !hasOption()) { <option [value]="text()">{{ text() }}</option> }
          </select>
        }
        @case ('textarea') {
          <textarea class="wi-textarea" rows="2" [ngModel]="text()" (ngModelChange)="value.set($event)" [placeholder]="param().placeholder || ''" [attr.aria-label]="label()"></textarea>
        }
        @default {
          <input class="wi-input" [ngModel]="text()" (ngModelChange)="value.set($event)" [placeholder]="param().placeholder || ''" [attr.aria-label]="label()">
        }
      }
      @if (link(); as url) {
        <a class="wip__link" [href]="url" target="_blank" rel="noopener" matTooltip="Abrir no GitHub" aria-label="Abrir no GitHub"><mat-icon>open_in_new</mat-icon></a>
      }
    </div>
  `,
  styles: [PICKER_STYLES, `app-wi-param-field, app-wi-repo-picker, app-wi-branch-picker, app-wi-state-picker, app-wi-commits-picker, app-wi-pr-picker { display: block; flex: 1; min-width: 0; }`]
})
export class WiParamFieldComponent {
  readonly param = input.required<TaskKindParam>();
  readonly kind = input<string | null>(null);
  readonly value = model<string | null | undefined>('');
  readonly card = input<string | null>(null);
  /** Repositório da sub-tarefa (ou do item / da primeira sub-tarefa). */
  readonly repository = input<string | null>(null);
  /** Branch de onde vêm os commits (cherry-pick). */
  readonly sourceBranch = input<string | null>(null);
  readonly suggest = input<BranchSuggestContext | null>(null);
  readonly githubUrl = input<string | null>(null);

  readonly kindOfInput = computed(() => paramInput(this.param(), this.kind()));
  readonly label = computed(() => this.param().label || this.param().key);
  readonly text = computed(() => `${this.value() ?? ''}`);
  readonly options = computed(() => paramOptions(this.param()));
  readonly hasOption = computed(() => this.options().some((o) => o.value === this.text()));
  readonly link = computed(() => {
    const input = this.kindOfInput();
    if (input !== 'repository' && input !== 'branch' && input !== 'target-branch' && input !== 'pull-request') return null;
    return paramLink(input, this.text(), this.githubUrl(), this.repository());
  });
}
