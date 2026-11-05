import { Component, computed, effect, input, model, output, signal } from '@angular/core';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SettingField } from '../plugin-settings.model';
import {
  collapseDiff, comparableJson, diffLines, DiffLine, indentOf, normalizeJsLiteral, parseJson, stringifyJson,
} from './structured-editors.logic';

/**
 * Editor `json` (0086/FB): texto monoespaçado com validação ao vivo (linha/coluna do erro), "Formatar" (2 espaços),
 * diferença por linhas contra o padrão do código e, quando o texto é literal JS (aspas simples, chaves sem aspas,
 * vírgula final), a oferta de converter para JSON. Vazio é aceito (a chave fica vazia → o código usa o padrão).
 * Também é o modo "editar como JSON" das tabelas e mapas.
 */
@Component({
  selector: 'app-setting-json-editor',
  standalone: true,
  imports: [TextFieldModule, MatButtonModule, MatIconModule, MatTooltipModule],
  styleUrls: ['./structured-editors.css'],
  template: `
    <div class="se">
      <textarea class="se__textarea se__mono" [class.se__textarea--error]="!!parseError()"
                cdkTextareaAutosize [cdkAutosizeMinRows]="minRows()" cdkAutosizeMaxRows="28"
                spellcheck="false" autocapitalize="off" autocomplete="off" [attr.aria-label]="field().label"
                [attr.aria-invalid]="!!parseError()" [disabled]="isDisabled()"
                [value]="text()" (input)="onInput($any($event.target).value)"></textarea>

      @if (parseError(); as err) {
        <div class="se__msg se__msg--error" role="alert">
          <mat-icon>error_outline</mat-icon>
          <span>{{ err }}
            @if (convertible()) {
              <br>Parece um literal JavaScript (aspas simples, chaves sem aspas ou vírgula no fim).
              <button mat-stroked-button type="button" (click)="convert()" [disabled]="isDisabled()">
                <mat-icon>auto_fix_high</mat-icon> Converter para JSON
              </button>
            }
          </span>
        </div>
      } @else if (rootError(); as err) {
        <div class="se__msg se__msg--error" role="alert"><mat-icon>error_outline</mat-icon><span>{{ err }}</span></div>
      } @else if (rootWarning(); as warn) {
        <div class="se__msg se__msg--warn"><mat-icon>warning_amber</mat-icon><span>{{ warn }}</span></div>
      }

      <div class="se__bar">
        <button mat-button type="button" (click)="format()" [disabled]="isDisabled() || !canFormat()"
                matTooltip="Reorganiza o JSON com 2 espaços de recuo">
          <mat-icon>format_align_left</mat-icon> Formatar
        </button>
        @if (hasDefault()) {
          <button mat-button type="button" (click)="showDiff.set(!showDiff())" [attr.aria-expanded]="showDiff()"
                  matTooltip="Compara o valor atual com o padrão do código, linha a linha">
            <mat-icon>{{ showDiff() ? 'expand_less' : 'difference' }}</mat-icon>
            {{ showDiff() ? 'Esconder diferença' : 'Ver diferença do padrão' }}
          </button>
        }
        <span class="se__spacer"></span>
        @if (!text().trim()) {
          <span class="se__count">vazio — o código usa o padrão</span>
        } @else {
          <span class="se__count">{{ lineCount() }} linha{{ lineCount() === 1 ? '' : 's' }}</span>
        }
      </div>

      @if (showDiff() && hasDefault()) {
        @if (diffStats(); as s) {
          <div class="se__msg se__msg--info">
            <mat-icon>difference</mat-icon>
            @if (!s.add && !s.del) { <span>Igual ao padrão (só espaçamento difere, se tanto).</span> }
            @else { <span>Em relação ao padrão: {{ s.add }} linha(s) a mais, {{ s.del }} a menos.</span> }
          </div>
        }
        <pre class="se__diff se__mono" aria-label="Diferença entre o padrão e o valor atual">@for (l of diff(); track $index) {<div [class]="'se__diff-line se__diff-line--' + l.type">@if (l.type === 'skip') {⋯ {{ l.text }} ⋯} @else {<span class="se__diff-num">{{ l.type === 'add' ? l.newLine : l.oldLine }}</span><span class="se__diff-sign">{{ l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' ' }}</span><span>{{ l.text }}</span>}</div>}</pre>
      }
    </div>
  `,
})
export class JsonEditorComponent {
  readonly field = input.required<SettingField>();
  /** String gravada. */
  readonly value = model.required<string>();
  readonly disabled = input(false);
  /** Desabilitado também quando o plugin não está cadastrado. */
  readonly isDisabled = computed(() => this.disabled() || this.field().pluginId === null);
  /** Mensagem de erro (JSON inválido / raiz errada) ou null. */
  readonly invalid = output<string | null>();

  readonly showDiff = signal(false);
  /** Valor como texto (null — chave inexistente — vira vazio). */
  readonly text = computed(() => this.value() ?? '');

  private readonly parsed = computed(() => {
    const t = this.text();
    return t.trim() ? parseJson(t) : null;
  });

  readonly parseError = computed(() => this.parsed()?.error ?? null);

  /** Texto não-JSON que vira JSON pela normalização de literal JS. */
  readonly convertible = computed(() => !!this.parseError() && normalizeJsLiteral(this.text()) !== null);

  /** Estruturas guardam objeto ou lista na raiz. */
  readonly rootError = computed(() => {
    const p = this.parsed();
    if (!p?.ok) return null;
    return typeof p.value === 'object' && p.value !== null ? null : 'O valor deve ser um objeto ({ … }) ou uma lista ([ … ]).';
  });

  /** Raiz diferente da do padrão (objeto × lista): provável engano, mas não bloqueia. */
  readonly rootWarning = computed(() => {
    const p = this.parsed();
    const d = this.field().default;
    if (!p?.ok || !d) return null;
    const def = parseJson(d);
    if (!def.ok || typeof def.value !== 'object' || def.value === null) return null;
    const isArr = Array.isArray(p.value);
    if (isArr === Array.isArray(def.value)) return null;
    return isArr ? 'O padrão é um objeto ({ … }) e o valor está como lista.' : 'O padrão é uma lista ([ … ]) e o valor está como objeto.';
  });

  readonly error = computed(() => this.parseError() ?? this.rootError());

  readonly hasDefault = computed(() => !!this.field().default?.trim());
  readonly canFormat = computed(() => !!this.parsed()?.ok);
  readonly lineCount = computed(() => this.text().split('\n').length);
  readonly minRows = computed(() => Math.min(10, Math.max(4, this.lineCount())));

  readonly diff = computed<DiffLine[]>(() =>
    this.showDiff() ? collapseDiff(diffLines(comparableJson(this.field().default), comparableJson(this.text()))) : []);

  readonly diffStats = computed(() => {
    const lines = this.diff();
    return { add: lines.filter(l => l.type === 'add').length, del: lines.filter(l => l.type === 'del').length };
  });

  private lastEmitted: string | null | undefined = undefined;

  constructor() {
    effect(() => {
      const err = this.error();
      if (err !== this.lastEmitted) {
        this.lastEmitted = err;
        this.invalid.emit(err);
      }
    });
  }

  onInput(text: string): void {
    this.value.set(text);
  }

  format(): void {
    const p = this.parsed();
    if (p?.ok) this.value.set(stringifyJson(p.value, 2));
  }

  /** Literal JS → JSON (mantém a disposição em linhas; compacto continua compacto). */
  convert(): void {
    const normalized = normalizeJsLiteral(this.text());
    if (normalized === null) return;
    this.value.set(stringifyJson(JSON.parse(normalized), indentOf(this.text())));
  }
}
