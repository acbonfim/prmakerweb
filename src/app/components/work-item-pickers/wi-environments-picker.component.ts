import { Component, ViewEncapsulation, computed, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ParamOption } from './param-input';
import { addEnvironments, customEnvironments, hasEnvironment, toggleEnvironment } from './environments-input';
import { PICKER_STYLES } from './picker.styles';

/**
 * 0092: ambientes da validação — um chip por ambiente conhecido (as opções do catálogo, várias de uma vez) e "Outro
 * ambiente" para um nome ou URL fora da lista. O valor é a lista separada por vírgula.
 */
@Component({
  selector: 'app-wi-environments-picker',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatTooltipModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="wip wip-envs" role="group" [attr.aria-label]="label()">
      <div class="wip-envs__chips">
        @for (o of options(); track o.value) {
          <button type="button" class="wip-env" [class.wip-env--on]="isOn(o.value)" [attr.aria-pressed]="isOn(o.value)"
                  [matTooltip]="o.label !== o.value ? o.value : ''" (click)="toggle(o.value)">
            <mat-icon>{{ isOn(o.value) ? 'check_circle' : 'radio_button_unchecked' }}</mat-icon>{{ o.label }}
          </button>
        }
        @for (c of custom(); track c) {
          <span class="wip-env wip-env--on wip-env--custom">
            <mat-icon>public</mat-icon><span class="wip-env__text">{{ c }}</span>
            <button type="button" class="wip-env__x" (click)="toggle(c)" [attr.aria-label]="'Tirar ' + c"><mat-icon>close</mat-icon></button>
          </span>
        }
      </div>
      <div class="wip__line">
        <input class="wi-input" [ngModel]="other()" (ngModelChange)="other.set($event)" (keydown.enter)="addOther($event)"
               placeholder="Outro ambiente (nome ou URL)" aria-label="Outro ambiente (nome ou URL)" autocomplete="off">
        <button type="button" class="wip-env wip-env--add" (click)="addOther()" [disabled]="!other().trim()"><mat-icon>add</mat-icon>Adicionar</button>
      </div>
      @if (!options().length && !custom().length) { <span class="wip__hint">Nenhum ambiente conhecido na configuração — informe o nome ou a URL.</span> }
    </div>
  `,
  styles: [PICKER_STYLES, `
.wip-envs__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.wip-env { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; padding: 3px 10px 3px 6px; border-radius: 999px;
  font: inherit; font-size: 12.5px; cursor: pointer; background: transparent; color: var(--cc-text-2);
  border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); }
.wip-env mat-icon { font-size: 16px; width: 16px; height: 16px; flex: none; }
.wip-env:hover { border-color: color-mix(in srgb, var(--mat-sys-primary) 55%, transparent); }
.wip-env--on { color: var(--mat-sys-primary); border-color: color-mix(in srgb, var(--mat-sys-primary) 60%, transparent);
  background: color-mix(in srgb, var(--mat-sys-primary) 10%, transparent); }
.wip-env--custom { cursor: default; padding-right: 4px; }
.wip-env__text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wip-env__x { display: inline-flex; border: 0; background: transparent; color: inherit; cursor: pointer; padding: 0; }
.wip-env--add { flex: none; padding-right: 10px; }
.wip-env--add:disabled { opacity: .5; cursor: default; }
`]
})
export class WiEnvironmentsPickerComponent {
  readonly value = model<string>('');
  readonly options = input<ParamOption[]>([]);
  readonly label = input<string>('Ambientes');

  readonly other = signal('');
  readonly custom = computed(() => customEnvironments(this.value(), this.options()));

  isOn(env: string): boolean {
    return hasEnvironment(this.value(), env);
  }

  toggle(env: string): void {
    this.value.set(toggleEnvironment(this.value(), env));
  }

  addOther(event?: Event): void {
    event?.preventDefault();
    const extra = this.other().trim();
    if (!extra) return;
    this.value.set(addEnvironments(this.value(), extra));
    this.other.set('');
  }
}
