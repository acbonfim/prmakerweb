import { Component, computed, input, model } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { validateGlob, validateRegex } from '../../../../services/governance/governance.logic';

let seq = 0;

/**
 * Lista editável de textos (0098): uma linha por item, com validação por tipo (glob, caminho, regex) e sugestões.
 * Usada nos casamentos e no escopo das regras.
 */
@Component({
  selector: 'app-gov-list-input',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule],
  template: `
    <div class="li">
      @for (v of items(); track $index; let i = $index) {
        <div class="li__row">
          <input type="text" [class.mono]="kind() !== 'none'" [value]="v" [attr.list]="listId" [attr.aria-label]="label() + ' ' + (i + 1)"
                 [class.invalid]="!!errors()[i]" (change)="set(i, $any($event.target).value)" data-usage-ignore>
          <button type="button" class="li__x" (click)="remove(i)" [attr.aria-label]="'Tirar ' + v" matTooltip="Tirar"><mat-icon>close</mat-icon></button>
          @if (errors()[i]) { <span class="li__err">{{ errors()[i] }}</span> }
        </div>
      }
      <div class="li__row li__row--add">
        <input #add type="text" [class.mono]="kind() !== 'none'" [placeholder]="placeholder()" [attr.list]="listId"
               [attr.aria-label]="'Adicionar em ' + label()" (keydown.enter)="$event.preventDefault(); push(add)" data-usage-ignore>
        <button type="button" class="li__add" (click)="push(add)" matTooltip="Adicionar"><mat-icon>add</mat-icon></button>
      </div>
      @if (suggestions().length) {
        <datalist [id]="listId">
          @for (s of suggestions(); track s.value) { <option [value]="s.value">{{ s.label }}</option> }
        </datalist>
      }
      @if (display().length) {
        <div class="li__names">{{ display() }}</div>
      }
    </div>
  `,
  styles: [`
    .li { display: flex; flex-direction: column; gap: 4px; }
    .li__row { display: grid; grid-template-columns: minmax(0, 1fr) 28px; gap: 4px; align-items: center; }
    .li__row input {
      background: var(--surface-1); color: var(--cc-text-1); border: 1px solid var(--cc-surface-border-strong); border-radius: 7px;
      padding: 5px 8px; font: inherit; font-size: 12.5px; min-width: 0; color-scheme: dark;
    }
    .li__row input.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
    .li__row input.invalid { border-color: #f85149; }
    .li__row--add input { border-style: dashed; }
    .li__x, .li__add { border: none; background: transparent; color: var(--cc-text-2); cursor: pointer; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
    .li__x mat-icon, .li__add mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .li__x:hover { color: #f85149; }
    .li__add:hover { color: var(--cc-text-1); }
    .li__err { grid-column: 1 / -1; color: #f85149; font-size: 11.5px; }
    .li__names { color: var(--cc-text-3); font-size: 11.5px; }
  `],
})
export class GovListInputComponent {
  readonly items = model.required<string[]>();
  readonly kind = input<'glob' | 'path' | 'regex' | 'none'>('none');
  readonly label = input('lista');
  readonly placeholder = input('Adicionar (Enter)');
  readonly suggestions = input<{ value: string; label: string }[]>([]);
  /** Mostra os nomes das sugestões escolhidas (ex.: ids de pessoa → nomes). */
  readonly showNames = input(false);

  readonly listId = `gov-li-${++seq}`;

  readonly errors = computed(() => this.items().map((v) => this.validate(v)));
  readonly display = computed(() => {
    if (!this.showNames()) return '';
    const m = new Map(this.suggestions().map((s) => [s.value, s.label]));
    return this.items().map((v) => m.get(v) ?? v).join(', ');
  });

  private validate(v: string): string | null {
    const k = this.kind();
    if (k === 'regex') return validateRegex(v);
    if (k === 'glob' || k === 'path') return validateGlob(v);
    return v.trim() ? null : 'Vazio.';
  }

  set(i: number, v: string): void {
    const next = [...this.items()];
    next[i] = v;
    this.items.set(next);
  }

  remove(i: number): void {
    this.items.set(this.items().filter((_, k) => k !== i));
  }

  push(el: HTMLInputElement): void {
    const v = el.value;
    if (!v.trim()) return;
    if (!this.items().includes(v)) this.items.set([...this.items(), this.kind() === 'regex' ? v : v.trim()]);
    el.value = '';
  }
}
