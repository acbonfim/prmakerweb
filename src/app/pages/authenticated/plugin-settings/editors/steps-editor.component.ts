import { Component, ElementRef, computed, input, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { MatChipInputEvent } from '@angular/material/chips';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { StepOption, foldText, stepKnown } from '../plugin-settings.logic';
import { ChipsEditorBase } from './list-editor.component';

/**
 * Editor `steps` (0086/FA): chips de etapas com autocompletar a partir das etapas cadastradas (`stepSources`, com o
 * valor EDITADO atual dessas listas — `steps`, vindo da tela). Aceita "prefixo-*" (ex.: `corrigir-*`). Etapa que
 * não existe nas listas é marcada com aviso (não impede gravar).
 */
@Component({
  selector: 'app-setting-steps-editor',
  standalone: true,
  imports: [FormsModule, MatAutocompleteModule, MatChipsModule, MatFormFieldModule, MatIconModule, MatInputModule, MatTooltipModule],
  styleUrls: ['./simple-editors.css'],
  template: `
    <div class="sx">
      <mat-form-field appearance="outline" class="sx__chips" subscriptSizing="dynamic">
        <mat-chip-grid #grid [disabled]="disabled()" [attr.aria-label]="field().label">
          @for (item of items(); track item) {
            <mat-chip-row (removed)="remove(item)" [class.sx__chip-unknown]="!known(item)"
                          [matTooltip]="titleOf(item)">
              @if (!known(item)) { <mat-icon matChipAvatar>warning_amber</mat-icon> }
              {{ item }}
              <button matChipRemove [attr.aria-label]="'Remover ' + item"><mat-icon>cancel</mat-icon></button>
            </mat-chip-row>
          }
          <input #draftInput [matChipInputFor]="grid" [matChipInputSeparatorKeyCodes]="separators"
                 [matAutocomplete]="auto" [ngModel]="draft()" (ngModelChange)="draft.set($event ?? '')"
                 (matChipInputTokenEnd)="onTokenEnd($event)" placeholder="Incluir etapa…" autocomplete="off" />
        </mat-chip-grid>
        <mat-autocomplete #auto="matAutocomplete" (optionSelected)="pick($event)">
          @for (o of suggestions(); track o.key) {
            <mat-option [value]="o.key"><span class="sx__opt-key">{{ o.key }}</span><span class="sx__opt-title">{{ o.title }}</span></mat-option>
          }
        </mat-autocomplete>
      </mat-form-field>
      @if (unknown().length) {
        <span class="sx__msg sx__msg--warn"><mat-icon>warning_amber</mat-icon>
          Etapa(s) que não estão nas listas de etapas: {{ unknown().join(', ') }}.</span>
      } @else {
        <span class="sx__msg sx__msg--info">{{ items().length }} etapa(s) · "prefixo-*" vale para todas que começam assim · {{ formatHint() }}</span>
      }
    </div>
  `,
})
export class SettingStepsEditorComponent extends ChipsEditorBase {
  /** Etapas conhecidas (das listas em `stepSources`, já com o valor em edição). */
  readonly steps = input<StepOption[]>([]);

  private readonly draftInput = viewChild<ElementRef<HTMLInputElement>>('draftInput');
  private readonly trigger = viewChild(MatAutocompleteTrigger);

  readonly suggestions = computed(() => {
    const used = new Set(this.items());
    const q = foldText(this.draft().trim());
    const all = this.prefixOptions();
    return all.filter(o => !used.has(o.key) && (!q || foldText(o.key).includes(q) || foldText(o.title).includes(q)));
  });

  readonly unknown = computed(() => (this.steps().length ? this.items().filter(i => !this.known(i)) : []));

  /** Etapas + os prefixos "xxx-*" que agrupam mais de uma (ex.: corrigir-back/corrigir-front → corrigir-*). */
  private readonly prefixOptions = computed<StepOption[]>(() => {
    const steps = this.steps();
    const prefixes = new Map<string, number>();
    for (const s of steps) {
      const i = s.key.indexOf('-');
      if (i > 0) prefixes.set(s.key.slice(0, i + 1), (prefixes.get(s.key.slice(0, i + 1)) ?? 0) + 1);
    }
    const extra = [...prefixes.entries()].filter(([, n]) => n > 1)
      .map(([p, n]) => ({ key: `${p}*`, title: `todas as ${n} etapas "${p}…"` }));
    return [...steps, ...extra];
  });

  known(item: string): boolean {
    return !this.steps().length || stepKnown(item, this.steps());
  }

  titleOf(item: string): string {
    if (item.endsWith('*')) return `Todas as etapas que começam com "${item.slice(0, -1)}"`;
    return this.steps().find(s => s.key === item)?.title ?? (this.known(item) ? '' : 'Etapa não encontrada nas listas de etapas');
  }

  /** Enter com uma sugestão destacada: quem inclui é o autocompletar (não o texto digitado pela metade). */
  override onTokenEnd(e: MatChipInputEvent): void {
    if (this.trigger()?.activeOption) return;
    super.onTokenEnd(e);
  }

  pick(e: MatAutocompleteSelectedEvent): void {
    this.add(e.option.value);
    const el = this.draftInput()?.nativeElement;
    if (el) el.value = '';
    this.draft.set('');
  }
}
