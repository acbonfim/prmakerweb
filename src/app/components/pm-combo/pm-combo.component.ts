import { Component, DestroyRef, computed, effect, inject, input, model, output, signal, untracked, viewChild } from '@angular/core';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { MatIconModule } from '@angular/material/icon';
import { UserAvatarComponent } from '../user-avatar/user-avatar.component';
import {
  PmComboOption, addValue, createCandidate, exactOrOnly, filterComboOptions, findOption, foldText, hasValue, highlightParts,
  labelForValue, removeValue, toggleComboValue
} from './pm-combo.logic';

export type { PmComboOption } from './pm-combo.logic';

/** Opção "(vazio)" e "Criar «x»" dentro do autocomplete (não são opções da lista). */
const EMPTY = { __empty: true } as const;
interface CreateValue { __create: string; }
const isCreate = (v: unknown): v is CreateValue => !!v && typeof v === 'object' && '__create' in v;
const isOption = (v: unknown): v is PmComboOption => !!v && typeof v === 'object' && 'value' in v && 'label' in v;

/**
 * 0099 ajustes 1: combo do PRMake — campo com digitação que filtra a lista (sem acento/caixa, com o trecho digitado
 * em destaque), opções com ícone/cor/avatar/dica, teclado (↑↓, Enter, Esc, Backspace tira o último chip), limpar (×),
 * escolha única (`value`) ou múltipla com chips (`multiple` + `values`), opção vazia (`allowEmpty`), texto livre
 * (`acceptCustom`) ou "Criar «x»" (`createLabel`) e busca no servidor (`remote` + `(queryChange)` com debounce).
 *
 * Substitui os `<select>` nativos e os autocompletes soltos da Mesa. O painel é overlay: o estilo dele é GLOBAL
 * (`.pm-combo-panel` em `styles.scss`); o do campo fica aqui.
 */
@Component({
  selector: 'app-pm-combo',
  standalone: true,
  imports: [MatAutocompleteModule, MatIconModule, UserAvatarComponent],
  host: {
    class: 'pm-combo',
    '[class.pm-combo--sm]': "size() === 'sm'",
  },
  template: `
    @let sel = selected();
    <div class="pmc" matAutocompleteOrigin #origin="matAutocompleteOrigin" (mousedown)="onFieldMouseDown($event, box)"
         [class.pmc--multi]="multiple()" [class.pmc--disabled]="disabled()" [class.pmc--warn]="warn()" [class.pmc--focus]="focused()">
      @if (multiple()) {
        @for (v of values(); track v) {
          @let o = optionOf(v);
          <span class="pmc-chip" [class.pmc-chip--new]="isNew(v)" [attr.title]="isNew(v) ? (newTitle() || v) : (o?.label || v)">
            @if (o?.avatar; as a) { <app-user-avatar [name]="a.name" [imageUrl]="a.imageUrl" [size]="16" /> }
            @else if (o?.icon) { <mat-icon class="pmc-chip__ico" [style.color]="o?.color || null">{{ o?.icon }}</mat-icon> }
            @else if (o?.color) { <span class="pmc-dot" [style.background]="o?.color"></span> }
            <span class="pmc-chip__text">{{ o?.label || v }}</span>
            @if (!disabled()) {
              <button type="button" tabindex="-1" (mousedown)="$event.preventDefault(); $event.stopPropagation()" (click)="removeChip(v)"
                      [attr.aria-label]="'Tirar ' + (o?.label || v)"><mat-icon>close</mat-icon></button>
            }
          </span>
        }
      } @else if (sel && !editing()) {
        @if (sel.avatar; as a) { <app-user-avatar class="pmc__lead" [name]="a.name" [imageUrl]="a.imageUrl" [size]="20" /> }
        @else if (sel.icon) { <mat-icon class="pmc__lead pmc__ico" [style.color]="sel.color || null">{{ sel.icon }}</mat-icon> }
        @else if (sel.color) { <span class="pmc__lead pmc-dot" [style.background]="sel.color"></span> }
      } @else if (icon()) {
        <mat-icon class="pmc__lead pmc__ico">{{ icon() }}</mat-icon>
      }
      <input #box class="pmc__input" type="text" [value]="text()" (input)="onInput(box.value)" (focus)="onFocus()" (blur)="onBlur()"
             (keydown)="onKey($event, box)" [matAutocomplete]="auto" [matAutocompleteConnectedTo]="origin"
             [matAutocompleteDisabled]="disabled()" [disabled]="disabled()" [placeholder]="shownPlaceholder()"
             [attr.aria-label]="ariaLabel() || placeholder() || null" autocomplete="off" spellcheck="false">
      @if (busy()) { <span class="pmc__spin" aria-hidden="true"></span> }
      @if (canClear()) {
        <button type="button" class="pmc__btn" tabindex="-1" (mousedown)="$event.preventDefault(); $event.stopPropagation()" (click)="clear(box)"
                [attr.aria-label]="'Limpar'" title="Limpar"><mat-icon>close</mat-icon></button>
      }
      <button type="button" class="pmc__btn pmc__caret" tabindex="-1" [disabled]="disabled()"
              (mousedown)="$event.preventDefault(); $event.stopPropagation()" (click)="toggle(box)" aria-label="Abrir a lista">
        <mat-icon>{{ panelOpen() ? 'expand_less' : 'expand_more' }}</mat-icon>
      </button>
    </div>

    <mat-autocomplete #auto="matAutocomplete" class="pm-combo-panel" [displayWith]="display" [autoActiveFirstOption]="autoActive()"
                      [panelWidth]="panelWidth() ?? ''" [hideSingleSelectionIndicator]="true" (optionSelected)="onSelected($event, box)"
                      (opened)="panelOpen.set(true)" (closed)="panelOpen.set(false)">
      @if (heading()) { <mat-option class="pmc-opt--head" disabled>{{ heading() }}</mat-option> }
      @if (busy() && remote()) { <mat-option class="pmc-opt--status" disabled><span class="pmc__spin"></span>{{ loadingText() }}</mat-option> }
      @if (showEmptyOption()) {
        <mat-option [value]="emptyValue" class="pmc-opt--empty" [class.pmc-opt--on]="!value()">
          <span class="pmc-opt__label">{{ emptyLabel() }}</span>
          @if (!value()) { <mat-icon class="pmc-opt__check">check</mat-icon> }
        </mat-option>
      }
      @if (create(); as c) {
        <mat-option [value]="{ __create: c }" class="pmc-opt--create">
          <mat-icon class="pmc-opt__ico">add</mat-icon><span class="pmc-opt__label">{{ createLabel() }} «{{ c }}»</span>
        </mat-option>
      }
      @for (o of shown(); track o.value) {
        @let on = isSelected(o);
        <mat-option [value]="o" [disabled]="!!o.disabled" [class.pmc-opt--on]="on">
          @if (multiple()) { <mat-icon class="pmc-opt__box">{{ on ? 'check_box' : 'check_box_outline_blank' }}</mat-icon> }
          @if (o.avatar; as a) { <app-user-avatar [name]="a.name" [imageUrl]="a.imageUrl" [size]="22" /> }
          @else if (o.icon) { <mat-icon class="pmc-opt__ico" [style.color]="o.color || null">{{ o.icon }}</mat-icon> }
          @else if (o.color) { <span class="pmc-dot" [style.background]="o.color"></span> }
          <span class="pmc-opt__label" [style.padding-left.px]="query() ? 0 : (o.depth ?? 0) * 14" [attr.title]="o.label">
            @for (p of parts(o); track $index) {@if (p.match) {<mark>{{ p.text }}</mark>} @else {<span>{{ p.text }}</span>}}
          </span>
          @if (o.hint) { <span class="pmc-opt__hint">{{ o.hint }}</span> }
          @if (on && !multiple()) { <mat-icon class="pmc-opt__check">check</mat-icon> }
        </mat-option>
      }
      @if (busy() && !remote()) {
        <mat-option class="pmc-opt--status" disabled><span class="pmc__spin"></span>{{ loadingText() }}</mat-option>
      } @else if (error()) {
        <mat-option class="pmc-opt--status pmc-opt--err" disabled><mat-icon class="pmc-opt__ico">error_outline</mat-icon>{{ error() }}</mat-option>
      } @else if (!busy() && !shown().length && !create()) {
        <mat-option class="pmc-opt--status" disabled>{{ query() ? emptyText() : (noOptionsText() || emptyText()) }}</mat-option>
      }
      @if (more() > 0) { <mat-option class="pmc-opt--status" disabled>+{{ more() }} — digite para filtrar</mat-option> }
    </mat-autocomplete>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .pmc { display: flex; align-items: center; flex-wrap: nowrap; gap: 4px; min-height: 32px; box-sizing: border-box; padding: 0 2px 0 8px; cursor: text;
      border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); border-radius: 8px; background: var(--surface-input, #1a1f28);
      transition: border-color .12s, box-shadow .12s; min-width: 0; }
    .pmc:hover:not(.pmc--disabled) { border-color: color-mix(in srgb, var(--mat-sys-on-surface) 32%, transparent); }
    .pmc--focus, .pmc--focus:hover:not(.pmc--disabled) { border-color: color-mix(in srgb, var(--mat-sys-primary) 75%, transparent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--mat-sys-primary) 16%, transparent); }
    .pmc--warn { border-color: rgba(210,153,34,.6); }
    .pmc--disabled { opacity: .6; cursor: not-allowed; }
    .pmc--multi { flex-wrap: wrap; padding-top: 3px; padding-bottom: 3px; padding-left: 5px; }
    .pmc__input { flex: 1 1 60px; min-width: 60px; border: 0; outline: none; background: transparent; color: inherit; font: inherit; font-size: 13px;
      padding: 5px 0; text-overflow: ellipsis; }
    .pmc__input::placeholder { color: var(--cc-text-3); }
    .pmc__input:disabled { cursor: not-allowed; }
    .pmc__lead { flex: none; }
    .pmc__ico { font-size: 17px; width: 17px; height: 17px; color: var(--cc-text-3); }
    .pmc-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; display: inline-block; }
    .pmc__btn { flex: none; display: inline-grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 6px;
      background: none; color: var(--cc-text-3); cursor: pointer; }
    .pmc__btn:hover:not(:disabled) { color: var(--cc-text-1); background: color-mix(in srgb, var(--mat-sys-on-surface) 8%, transparent); }
    .pmc__btn:disabled { cursor: not-allowed; }
    .pmc__btn mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .pmc__caret mat-icon { font-size: 19px; width: 19px; height: 19px; }
    .pmc__spin { flex: none; width: 11px; height: 11px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--mat-sys-on-surface) 20%, transparent);
      border-top-color: var(--mat-sys-primary); animation: pmc-spin .8s linear infinite; }
    @keyframes pmc-spin { to { transform: rotate(360deg); } }
    .pmc-chip { display: inline-flex; align-items: center; gap: 4px; max-width: 240px; height: 22px; padding: 0 2px 0 8px; border-radius: 999px; font-size: 12px;
      background: color-mix(in srgb, var(--mat-sys-on-surface) 10%, transparent); color: var(--cc-text-1); }
    .pmc-chip:has(app-user-avatar) { padding-left: 3px; }
    .pmc-chip--new { background: color-mix(in srgb, var(--mat-sys-primary) 22%, transparent); }
    .pmc-chip__text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pmc-chip__ico { font-size: 14px; width: 14px; height: 14px; }
    .pmc-chip button { display: inline-grid; place-items: center; width: 18px; height: 18px; border: 0; border-radius: 50%; padding: 0; background: none;
      color: var(--cc-text-3); cursor: pointer; }
    .pmc-chip button:hover { color: var(--cc-text-1); background: rgba(255,255,255,.12); }
    .pmc-chip button mat-icon { font-size: 13px; width: 13px; height: 13px; }

    :host(.pm-combo--sm) .pmc { min-height: 28px; padding-left: 7px; }
    :host(.pm-combo--sm) .pmc__input { font-size: 12.5px; padding: 4px 0; }
    :host(.pm-combo--sm) .pmc--multi { padding-left: 4px; }
  `]
})
export class PmComboComponent {
  private destroyRef = inject(DestroyRef);

  /** Opções da lista. */
  readonly options = input<readonly PmComboOption[]>([]);
  /** Valor escolhido (modo único). */
  readonly value = model<string | null>(null);
  /** Valores escolhidos (modo `multiple`). */
  readonly values = model<string[]>([]);
  readonly multiple = input(false);
  readonly placeholder = input('');
  readonly ariaLabel = input<string | null>(null);
  readonly disabled = input(false);
  /** Ícone à esquerda quando nada está escolhido. */
  readonly icon = input<string | null>(null);
  /** `sm` para barras (board); `md` nos formulários. */
  readonly size = input<'sm' | 'md'>('md');
  /** Mostra o × para limpar quando há valor. */
  readonly clearable = input(true);
  /** Modo único: primeira opção "(vazio)" que limpa o valor. */
  readonly allowEmpty = input(false);
  readonly emptyLabel = input('(vazio)');
  /** Texto livre aceito ao confirmar (sair do campo/Enter sem opção): devolve o valor ou `null` (recusa). */
  readonly acceptCustom = input<((text: string) => string | null) | null>(null);
  /** Mostra "<createLabel> «x»" quando o texto não existe na lista (ex.: "Criar tag"). */
  readonly createLabel = input<string | null>(null);
  /** Chip com destaque de "novo" (ex.: tag que será criada). */
  readonly markNew = input<((value: string) => boolean) | null>(null);
  readonly newTitle = input<string | null>(null);
  /** Modo múltiplo: caracteres que fecham o texto digitado como um valor (ex.: ",;"). */
  readonly separators = input('');
  /** Texto do campo quando o valor não está na lista (ex.: o nome da pessoa vinda do card). */
  readonly displayText = input<string | null>(null);
  /** Destaque de aviso no campo (ex.: valor fora da lista). */
  readonly warn = input(false);
  readonly loading = input(false);
  readonly loadingText = input('Carregando…');
  readonly error = input<string | null>(null);
  readonly emptyText = input('Nada com esse texto');
  /** Texto quando a lista está vazia e nada foi digitado. */
  readonly noOptionsText = input<string | null>(null);
  readonly heading = input<string | null>(null);
  /** Quantas opções aparecem de uma vez. */
  readonly limit = input(200);
  /** Busca no servidor: a lista não é filtrada aqui; cada texto digitado sai em `queryChange` com debounce. */
  readonly remote = input(false);
  readonly debounceMs = input(250);
  /** Largura do painel (CSS); sem valor, a do campo. */
  readonly panelWidth = input<string | number | null>(null);

  /** Opção escolhida (modo único; `null` quando limpou). */
  readonly picked = output<PmComboOption | null>();
  /** Texto para buscar no servidor (modo `remote`). */
  readonly queryChange = output<string>();
  /** O campo ganhou o foco/abriu a lista (para carregar a lista sob demanda). */
  readonly opened = output<void>();

  private trigger = viewChild(MatAutocompleteTrigger);

  readonly emptyValue = EMPTY;
  /** Texto do campo (o digitado; no modo único, fora da edição, o rótulo do valor). */
  readonly text = signal('');
  /** A pessoa está digitando (modo único): a lista filtra pelo texto. */
  readonly editing = signal(false);
  readonly focused = signal(false);
  readonly panelOpen = signal(false);

  readonly query = computed(() => (this.multiple() || this.editing() ? this.text().trim() : ''));
  readonly busy = computed(() => this.loading());
  readonly selected = computed(() => (this.multiple() ? null : findOption(this.options(), this.value())));
  private readonly selectedLabel = computed(() => labelForValue(this.options(), this.value(), this.displayText()));

  private readonly filtered = computed(() => {
    const opts = this.options();
    return this.remote() ? opts : filterComboOptions(opts, this.query(), Number.MAX_SAFE_INTEGER);
  });
  readonly shown = computed(() => this.filtered().slice(0, this.limit()));
  readonly more = computed(() => Math.max(0, this.filtered().length - this.limit()));
  readonly create = computed(() => {
    if (!this.createLabel()) return null;
    return createCandidate(this.options(), this.multiple() ? this.values() : [this.value() ?? ''], this.query());
  });
  readonly showEmptyOption = computed(() => !this.multiple() && this.allowEmpty() && !this.query());
  readonly autoActive = computed(() => !!this.query());
  readonly canClear = computed(() => this.clearable() && !this.disabled()
    && (this.multiple() ? this.values().length > 0 || !!this.text() : !!this.value() || !!this.text()));
  readonly shownPlaceholder = computed(() => (this.multiple() && this.values().length ? '' : this.placeholder()));

  /** O autocomplete escreve no campo o rótulo da opção (no múltiplo, nada — o texto volta a vazio). */
  readonly display = (v: unknown): string => {
    if (this.multiple()) return '';
    if (isOption(v)) return v.label;
    if (isCreate(v)) return v.__create;
    return typeof v === 'string' ? v : '';
  };

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private blurTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Fora da edição, o campo mostra o rótulo do valor (valor vindo de fora, opções que chegaram depois).
    effect(() => {
      const label = this.selectedLabel();
      if (this.multiple()) return;
      untracked(() => { if (!this.editing() && this.text() !== label) this.text.set(label); });
    });
    this.destroyRef.onDestroy(() => {
      if (this.searchTimer) clearTimeout(this.searchTimer);
      if (this.blurTimer) clearTimeout(this.blurTimer);
    });
  }

  optionOf(v: string): PmComboOption | null {
    return findOption(this.options(), v);
  }

  isSelected(o: PmComboOption): boolean {
    return this.multiple() ? hasValue(this.values(), o.value) : !!this.value() && foldText(this.value()) === foldText(o.value);
  }

  isNew(v: string): boolean {
    return !!this.markNew()?.(v);
  }

  parts(o: PmComboOption) {
    const q = this.query();
    return highlightParts(q ? o.label : (o.short || o.label), q);
  }

  // ── Eventos do campo ──

  onFieldMouseDown(e: MouseEvent, box: HTMLInputElement): void {
    // Clique no espaço do campo (fora do texto) foca o texto sem perder o foco atual.
    if (this.disabled() || e.target === box) return;
    e.preventDefault();
    box.focus();
  }

  onFocus(): void {
    this.focused.set(true);
    if (this.blurTimer) { clearTimeout(this.blurTimer); this.blurTimer = null; }
    this.opened.emit();
    if (this.remote()) this.emitQuery(this.query(), true);
  }

  onBlur(): void {
    this.focused.set(false);
    // Espera o optionSelected (que vem depois do blur) antes de decidir o texto digitado.
    if (this.blurTimer) clearTimeout(this.blurTimer);
    this.blurTimer = setTimeout(() => { this.blurTimer = null; this.commitTyped(false); }, 160);
  }

  onInput(raw: string): void {
    let s = raw ?? '';
    if (this.multiple() && this.separators() && s.split('').some((ch) => this.separators().includes(ch))) {
      const re = new RegExp(`[${this.separators().replace(/[\\\]^-]/g, '\\$&')}]`);
      const parts = s.split(re);
      s = parts.pop() ?? '';
      let list = this.values();
      for (const p of parts) {
        const v = this.resolveTyped(p);
        if (v) list = addValue(list, v);
      }
      if (list.length !== this.values().length) this.values.set(list);
    }
    this.text.set(s);
    if (!this.multiple()) this.editing.set(true);
    if (this.remote()) this.emitQuery(s.trim(), false);
  }

  onKey(e: KeyboardEvent, box: HTMLInputElement): void {
    const t = this.trigger();
    if (e.key === 'Enter') {
      if (t?.panelOpen && t.activeOption) return; // o autocomplete escolhe a opção destacada
      if (this.query() || this.editing()) {
        e.preventDefault();
        this.commitTyped(true, box);
      }
    } else if (e.key === 'Escape') {
      if (!this.multiple() && this.editing() && !t?.panelOpen) this.revert();
    } else if (e.key === 'Backspace' && this.multiple() && !box.value && this.values().length) {
      this.values.set(this.values().slice(0, -1));
    }
  }

  onSelected(e: MatAutocompleteSelectedEvent, box: HTMLInputElement): void {
    const v = e.option.value as unknown;
    e.option.deselect();
    if (this.blurTimer) { clearTimeout(this.blurTimer); this.blurTimer = null; }
    if (v === EMPTY) { this.setSingle(null, null); return; }
    if (isCreate(v)) {
      if (this.multiple()) this.addMulti(v.__create, box);
      else this.setSingle(v.__create, null);
      return;
    }
    if (!isOption(v)) return;
    if (this.multiple()) {
      this.values.set(toggleComboValue(this.values(), v.value));
      this.resetMultiText(box);
    } else {
      this.setSingle(v.value, v);
    }
  }

  toggle(box: HTMLInputElement): void {
    if (this.disabled()) return;
    const t = this.trigger();
    if (t?.panelOpen) { t.closePanel(); return; }
    if (document.activeElement !== box) box.focus();
    setTimeout(() => this.trigger()?.openPanel());
  }

  clear(box: HTMLInputElement): void {
    if (this.multiple()) {
      this.values.set([]);
      this.resetMultiText(box);
    } else {
      this.setSingle(null, null);
    }
    if (this.remote()) this.emitQuery('', true);
  }

  removeChip(v: string): void {
    this.values.set(removeValue(this.values(), v));
  }

  // ── Internos ──

  /** Texto digitado vira valor: opção igual/única, senão texto livre aceito, senão nada. */
  private resolveTyped(raw: string): string | null {
    const t = (raw ?? '').trim();
    if (!t) return null;
    const exact = exactOrOnly(this.options(), t);
    if (exact && foldText(exact.label) === foldText(t)) return exact.value;
    const custom = this.acceptCustom();
    if (custom) return custom(t);
    if (this.createLabel()) return t;
    return exact?.value ?? null;
  }

  /** Confirma o texto digitado (Enter ou ao sair). `explicit` = Enter (no múltiplo inclui; no único escolhe). */
  private commitTyped(explicit: boolean, box?: HTMLInputElement): void {
    const t = this.text().trim();
    if (this.multiple()) {
      if (!t) return;
      if (!explicit) {
        // Ao sair do campo, só o texto livre aceito vira chip (busca parcial é descartada).
        if (this.acceptCustom() || this.createLabel()) {
          const v = this.resolveTyped(t);
          if (v) this.values.set(addValue(this.values(), v));
        }
        this.text.set('');
        return;
      }
      const v = this.resolveTyped(t);
      if (v) this.addMulti(v, box);
      return;
    }
    if (!this.editing()) return;
    if (!t) {
      if (this.allowEmpty() || this.clearable()) this.setSingle(null, null); else this.revert();
      return;
    }
    if (t === this.selectedLabel()) { this.revert(); return; }
    const opts = this.options();
    const exact = opts.find((o) => !o.disabled && (foldText(o.label) === foldText(t) || foldText(o.value) === foldText(t)));
    if (exact) { this.setSingle(exact.value, exact); return; }
    const custom = this.acceptCustom()?.(t) ?? (this.createLabel() ? t : null);
    if (custom != null) { this.setSingle(custom, null); return; }
    const only = exactOrOnly(opts, t);
    if (only) { this.setSingle(only.value, only); return; }
    this.revert();
  }

  private setSingle(value: string | null, option: PmComboOption | null): void {
    this.editing.set(false);
    if (value !== this.value()) this.value.set(value);
    this.text.set(value == null ? '' : option?.label ?? labelForValue(this.options(), value, this.displayText()));
    this.picked.emit(value == null ? null : option ?? findOption(this.options(), value));
  }

  private addMulti(v: string, box?: HTMLInputElement): void {
    this.values.set(addValue(this.values(), v));
    this.resetMultiText(box);
  }

  private resetMultiText(box?: HTMLInputElement): void {
    this.text.set('');
    if (box) box.value = '';
    if (this.remote()) this.emitQuery('', true);
    // Continua no campo para escolher o próximo.
    setTimeout(() => { if (this.focused()) this.trigger()?.openPanel(); });
  }

  private revert(): void {
    this.editing.set(false);
    this.text.set(this.selectedLabel());
  }

  private emitQuery(q: string, now: boolean): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (now) { this.queryChange.emit(q); return; }
    this.searchTimer = setTimeout(() => { this.searchTimer = null; this.queryChange.emit(q); }, this.debounceMs());
  }
}
