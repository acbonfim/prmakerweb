import { Component, computed, effect, ElementRef, input, model, output, signal, viewChild } from '@angular/core';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SettingField, SettingVariable } from '../plugin-settings.model';
import { insertAt, renderPreview, unknownVariables } from './structured-editors.logic';

/**
 * Editor `pattern` (uma linha, ex.: `hotfix/{card}`) e `prompt` (texto longo) — 0086/FB. As variáveis aceitas
 * aparecem em chips: clicar insere `{nome}` onde está o cursor. Variável `{x}` que o código não conhece gera aviso
 * (não bloqueia; `{suffix:x}` conta como `suffix`). Prévia com o `example` de cada variável no lugar: sempre visível
 * no padrão, recolhível no prompt.
 */
@Component({
  selector: 'app-setting-prompt-editor',
  standalone: true,
  imports: [TextFieldModule, MatButtonModule, MatIconModule, MatTooltipModule],
  styleUrls: ['./structured-editors.css'],
  template: `
    <div class="se">
      @if (variables().length) {
        <div class="se__vars">
          <span class="se__vars-title">Variáveis:</span>
          @for (v of variables(); track v.name) {
            <button type="button" class="se__var" [disabled]="isDisabled()" (mousedown)="$event.preventDefault()"
                    (click)="insert(v)" [matTooltip]="tooltip(v)" [attr.aria-label]="'Inserir {' + v.name + '}'">{{ '{' + v.name + '}' }}</button>
          }
        </div>
      }

      @if (isPattern()) {
        <input #box class="se__input se__mono" [value]="text()" [disabled]="isDisabled()" spellcheck="false"
               autocomplete="off" [attr.aria-label]="field().label" (input)="value.set($any($event.target).value)">
      } @else {
        <textarea #box class="se__textarea se__textarea--wrap" style="font-size: 13px; line-height: 1.5"
                  cdkTextareaAutosize cdkAutosizeMinRows="5" cdkAutosizeMaxRows="24" [value]="text()"
                  [disabled]="isDisabled()" [attr.aria-label]="field().label"
                  (input)="value.set($any($event.target).value)"></textarea>
      }

      @if (unknown().length) {
        <div class="se__msg se__msg--warn">
          <mat-icon>warning_amber</mat-icon>
          <span>{{ unknown().length === 1 ? 'Variável desconhecida' : 'Variáveis desconhecidas' }}: {{ unknown().join(', ') }}
            — o código não substitui; o texto vai como está.</span>
        </div>
      }

      <div class="se__bar">
        @if (!isPattern()) {
          <button type="button" class="se__link" (click)="showPreview.set(!showPreview())" [attr.aria-expanded]="showPreview()">
            <mat-icon>{{ showPreview() ? 'expand_less' : 'visibility' }}</mat-icon>
            {{ showPreview() ? 'Esconder a prévia' : 'Prévia com exemplo' }}
          </button>
        }
        <span class="se__spacer"></span>
        <span class="se__count">{{ text().length }} caractere{{ text().length === 1 ? '' : 's' }}</span>
      </div>

      @if (isPattern() || showPreview()) {
        <div>
          <div class="se__preview-title"><mat-icon>visibility</mat-icon> Prévia{{ hasExamples() ? ' com exemplo' : '' }}</div>
          <div class="se__preview" [class.se__preview--line]="isPattern()" aria-live="polite">@for (p of preview(); track $index) {@if (p.variable) {<mark [matTooltip]="'{' + p.variable + '}'">{{ p.text }}</mark>} @else {<span>{{ p.text }}</span>}} @empty {<span class="se__count">(vazio)</span>}</div>
        </div>
      }
    </div>
  `,
})
export class PromptEditorComponent {
  readonly field = input.required<SettingField>();
  /** String gravada. */
  readonly value = model.required<string>();
  readonly disabled = input(false);
  /** Sempre null: variável desconhecida é aviso, não erro. */
  readonly invalid = output<string | null>();

  readonly isDisabled = computed(() => this.disabled() || this.field().pluginId === null);
  readonly isPattern = computed(() => this.field().type === 'pattern');
  readonly variables = computed<SettingVariable[]>(() => this.field().variables ?? []);
  readonly hasExamples = computed(() => this.variables().some(v => v.example != null));
  readonly unknown = computed(() => unknownVariables(this.text(), this.variables()));
  readonly preview = computed(() => renderPreview(this.text(), this.variables()));
  readonly showPreview = signal(false);
  /** Valor como texto (null — chave inexistente — vira vazio). */
  readonly text = computed(() => this.value() ?? '');

  private readonly box = viewChild<ElementRef<HTMLInputElement | HTMLTextAreaElement>>('box');

  constructor() {
    // O contrato pede o aviso de validade; aqui nunca há erro (o pai só precisa saber que está tudo certo).
    effect(() => {
      this.field();
      this.invalid.emit(null);
    });
  }

  tooltip(v: SettingVariable): string {
    const parts = [v.description, v.example != null ? `Exemplo: ${v.example}` : null].filter(Boolean);
    return parts.length ? parts.join(' — ') : `Insere {${v.name}}`;
  }

  /** Insere `{nome}` na posição do cursor (ou no fim, se o campo nunca recebeu foco) e devolve o foco. */
  insert(v: SettingVariable): void {
    const el = this.box()?.nativeElement;
    const text = this.text();
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? start;
    const result = insertAt(text, start, end, `{${v.name}}`);
    this.value.set(result.text);
    if (el) {
      el.value = result.text;
      el.focus();
      el.setSelectionRange(result.caret, result.caret);
    }
  }
}
