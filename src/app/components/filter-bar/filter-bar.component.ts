import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { asyncScheduler, debounceTime, distinctUntilChanged, observeOn, switchMap } from 'rxjs';
import { OverlayModule } from '@angular/cdk/overlay';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CcPopoverComponent } from '../popover/cc-popover.component';
import { FilterDef, FilterOption, FilterProvider, FilterValues } from './filter-bar.models';

/**
 * Copiado do ComandaCerta (`ComandaCerta.App/src/app/shared/filter-bar`) — feature 0005 do CIME.
 * Única diferença: ao abrir um filtro, as opções são recarregadas com o termo atual (a fonte dos
 * valores aqui muda com o tempo — troca de card, PR novo, status atualizado).
 *
 * Barra de filtros genérica e reutilizável (ajuste 8.1-8.7): recebe uma entidade (via título) e
 * uma service que implementa FilterProvider — a mesma barra funciona para qualquer tela sem
 * precisar conhecer a entidade. Em telas largas: um botão por filtro (filter_list + nome), cada
 * um com seu próprio menu (busca no topo; selecionados destacados como chip de linha inteira com
 * check+remover, evitando duplicidade — 8.5). Em telas de smartphone (ajuste 2.2): um único botão
 * de filtro consolida TODOS os filtros num só menu, empilhados, para facilitar o toque.
 */
@Component({
  selector: 'cc-filter-bar',
  imports: [
    ReactiveFormsModule, OverlayModule, MatButtonModule, MatIconModule,
    MatTooltipModule, NgTemplateOutlet, CcPopoverComponent,
  ],
  template: `
    <!-- Telas largas: uma "caixa de select" por filtro que mostra os selecionados como CHIPS dentro
         dela (UI Kit §11.8), não só um contador. Acima de N chips colapsa em "+K". Clicar abre o
         popover (mesmo layout dos chips de período/código — §11.5, preferido a mat-menu p/ interação). -->
    <div class="cc-filter-bar cc-filter-bar-desktop">
      @for (def of defs(); track def.key) {
        <div
          class="cc-ms-box"
          [class.active]="isActive(def)"
          cdkOverlayOrigin
          #origin="cdkOverlayOrigin"
          (click)="pop.toggle(origin)"
        >
          @if (!isActive(def)) {
            <span class="cc-ms-placeholder"><mat-icon>filter_list</mat-icon> {{ def.label }}</span>
          } @else {
            <span class="cc-ms-label">{{ def.label }}:</span>
            <div class="cc-ms-chips">
              @for (opt of visibleChips(def); track opt.value) {
                <span class="cc-ms-chip">
                  <span class="cc-ms-chip-label">{{ opt.label }}</span>
                  <button type="button" class="cc-ms-chip-x" (click)="removeChip(def, opt, $event)" aria-label="Remover"><mat-icon>close</mat-icon></button>
                </span>
              }
              @if (overflowCount(def) > 0) { <span class="cc-ms-chip cc-ms-overflow">+{{ overflowCount(def) }}</span> }
            </div>
          }
          <mat-icon class="cc-ms-caret">arrow_drop_down</mat-icon>
        </div>
        <cc-popover #pop (opened)="onOpen(def)">
          <div class="cc-filter-menu-body">
            <ng-container [ngTemplateOutlet]="filterGroup" [ngTemplateOutletContext]="{ $implicit: def }" />
          </div>
        </cc-popover>
      }
    </div>

    <!-- Smartphone: um único botão consolida todos os filtros num popover (ajuste 2.2). -->
    <button
      mat-icon-button
      type="button"
      class="cc-filter-mobile-btn"
      [class.active]="totalActive() > 0"
      cdkOverlayOrigin
      #mobileOrigin="cdkOverlayOrigin"
      (click)="mobilePop.toggle(mobileOrigin)"
      matTooltip="Filtros"
    >
      <mat-icon>filter_list</mat-icon>
      @if (totalActive() > 0) { <span class="cc-filter-badge cc-filter-badge-abs">{{ totalActive() }}</span> }
    </button>
    <cc-popover #mobilePop (opened)="onOpenAll()">
      <div class="cc-filter-menu-mobile-body">
        @for (def of defs(); track def.key) {
          <div class="cc-filter-group">
            <div class="cc-filter-group-title">
              {{ def.label }}
              @if (isActive(def)) { <span class="cc-filter-badge">{{ (values()[def.key] ?? []).length }}</span> }
            </div>
            <ng-container [ngTemplateOutlet]="filterGroup" [ngTemplateOutletContext]="{ $implicit: def }" />
          </div>
        }
      </div>
    </cc-popover>

    <!-- Corpo de um filtro (busca + opções) — compartilhado entre o menu individual (desktop)
         e o menu consolidado (mobile), para não duplicar a lógica de seleção/scroll/quebra de linha. -->
    <ng-template #filterGroup let-def>
      <div class="cc-filter-search">
        <mat-icon>search</mat-icon>
        <input type="text" [placeholder]="'Buscar ' + def.label.toLowerCase() + '…'" [formControl]="searchControl(def)" />
      </div>
      @if (def.multiple && (results()[def.key] ?? []).length > 0) {
        <button type="button" class="cc-filter-option cc-filter-selectall" (click)="toggleAll(def)">
          <span class="cc-filter-cbx" [class.on]="allSelected(def)">
            @if (allSelected(def)) { <mat-icon>check</mat-icon> }
          </span>
          <span class="cc-filter-option-label">Selecionar todos</span>
        </button>
      }
      <div class="cc-filter-options">
        @for (opt of results()[def.key] ?? []; track opt.value) {
          <button
            type="button"
            class="cc-filter-option"
            [class.selected]="isSelected(def, opt)"
            (click)="toggle(def, opt)"
          >
            <span class="cc-filter-cbx" [class.on]="isSelected(def, opt)">
              @if (isSelected(def, opt)) { <mat-icon>check</mat-icon> }
            </span>
            <span class="cc-filter-option-label">{{ opt.label }}</span>
          </button>
        }
        @if ((results()[def.key] ?? []).length === 0) {
          <p class="cc-filter-empty">Nenhum resultado.</p>
        }
      </div>
    </ng-template>
  `,
  styles: [`
    .cc-filter-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; }
    /* Caixa de select do multiselect (UI Kit §11.8) — mostra os chips selecionados dentro dela. */
    .cc-ms-box {
      display: inline-flex; align-items: center; gap: 6px; min-height: 40px; max-width: 100%;
      padding: 4px 6px 4px 12px; border-radius: 10px; cursor: pointer;
      border: 1.5px solid var(--cc-surface-border-strong); background: var(--cc-surface-input);
      transition: border-color .15s ease, box-shadow .15s ease;
    }
    .cc-ms-box:hover { border-color: var(--cc-special); }
    .cc-ms-box.active { border-color: var(--cc-special); }
    .cc-ms-placeholder { display: inline-flex; align-items: center; gap: 6px; color: var(--cc-text-2); font-weight: 500; }
    .cc-ms-placeholder mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .cc-ms-label { font-size: 12px; font-weight: 600; color: var(--cc-text-2); }
    .cc-ms-chips { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
    /* System design img11: chips DENTRO da caixa são neutros (surface-2), não tingidos. */
    .cc-ms-chip {
      display: inline-flex; align-items: center; gap: 2px; max-width: 160px;
      padding: 2px 4px 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 600;
      background: var(--cc-surface-2); color: var(--cc-text-1);
    }
    .cc-ms-chip-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cc-ms-chip-x {
      display: inline-flex; align-items: center; justify-content: center; flex: none;
      width: 16px; height: 16px; padding: 0; border: none; border-radius: 50%; cursor: pointer;
      background: transparent; color: var(--cc-text-2);
    }
    .cc-ms-chip-x:hover { background: color-mix(in srgb, var(--cc-text-2) 22%, transparent); color: var(--cc-text-1); }
    .cc-ms-chip-x mat-icon { font-size: 13px; width: 13px; height: 13px; line-height: 13px; }
    .cc-ms-overflow { padding: 2px 9px; background: var(--cc-surface-2); color: var(--cc-text-2); }
    .cc-ms-caret { color: var(--cc-text-2); flex: none; }
    .cc-filter-selectall { border-bottom: 1px solid var(--cc-surface-border, rgba(0,0,0,.08)); border-radius: 0; margin-bottom: 2px; font-weight: 600; }
    .cc-filter-badge {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
      background: var(--mat-sys-tertiary); color: var(--mat-sys-on-tertiary);
      font-size: 11px; font-weight: 600;
    }

    /* Botão único de filtros no smartphone (ajuste 2.2) — escondido em telas largas. */
    .cc-filter-mobile-btn { display: none; position: relative; }
    .cc-filter-mobile-btn.active { color: var(--mat-sys-tertiary); }
    .cc-filter-badge-abs { position: absolute; top: 2px; right: 2px; }

    @media (max-width: 599px) {
      .cc-filter-bar-desktop { display: none; }
      .cc-filter-mobile-btn { display: inline-flex; align-items: center; justify-content: center; }
    }

    /* padding: 0 — o cc-popover já provê o respiro do painel (evita padding duplo). */
    .cc-filter-menu-mobile-body {
      display: flex; flex-direction: column; gap: 4px; padding: 0;
      width: 272px; max-width: calc(100vw - 60px); box-sizing: border-box;
      max-height: 70vh; overflow-y: auto;
    }
    .cc-filter-group { display: flex; flex-direction: column; gap: 6px; padding: 8px 4px; }
    .cc-filter-group + .cc-filter-group { border-top: 1px solid var(--cc-surface-border, rgba(0,0,0,.08)); }
    .cc-filter-group-title { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: .85rem; }

    .cc-filter-menu-body {
      display: flex; flex-direction: column; padding: 0; gap: 6px;
      width: 256px; max-width: min(256px, calc(100vw - 60px)); box-sizing: border-box;
    }
    /* Busca do painel = caixa SIMPLES (UI Kit img_1), não mat-form-field (o notch/subscript do
       Material desalinhava o input — "não fica centralizado"). Ícone à esquerda, input centrado. */
    .cc-filter-search {
      display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box;
      background: var(--cc-surface-input); border: 1.5px solid var(--cc-surface-border-strong);
      border-radius: 10px; padding: 10px 12px; margin-bottom: 6px;
      transition: border-color .15s ease, box-shadow .15s ease;
    }
    .cc-filter-search:focus-within { border-color: var(--cc-brand); box-shadow: 0 0 0 3px color-mix(in srgb, var(--cc-brand) 18%, transparent); }
    .cc-filter-search mat-icon { flex: none; color: var(--cc-text-2); font-size: 19px; width: 19px; height: 19px; }
    .cc-filter-search input { flex: 1 1 auto; min-width: 0; border: none; background: transparent; outline: none; font: inherit; font-size: 14px; color: var(--cc-text-1); }
    .cc-filter-search input::placeholder { color: var(--cc-text-3); }
    .cc-filter-options { display: flex; flex-direction: column; gap: 2px; max-height: 280px; overflow-y: auto; overflow-x: hidden; }
    .cc-filter-empty { font-size: 13px; color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent); padding: 8px 4px; margin: 0; }

    /* Opção = linha com checkbox à esquerda + rótulo (visual multiselect, UI Kit §11.8 / Sakai).
       Rótulos longos quebram linha, nunca forçam rolagem horizontal do menu. */
    .cc-filter-option {
      display: flex; align-items: center; gap: 11px; width: 100%; text-align: left;
      padding: 8px 10px; border-radius: 8px; border: none; background: none; font: inherit;
      color: var(--cc-text-1); cursor: pointer; line-height: 1.3;
    }
    .cc-filter-option:hover { background: var(--cc-surface-2); }
    .cc-filter-option.selected { background: color-mix(in srgb, var(--cc-special) 12%, transparent); }
    .cc-filter-option-label { flex: 1 1 auto; min-width: 0; font-weight: 500; overflow-wrap: anywhere; line-height: 1.3; }
    /* Checkbox: caixa vazia (não selecionado) / preenchida na cor especial (selecionado). */
    .cc-filter-cbx {
      flex: none; width: 19px; height: 19px; border-radius: 5px; display: grid; place-items: center;
      border: 2px solid var(--cc-surface-border-strong); transition: background-color .12s ease, border-color .12s ease;
    }
    .cc-filter-cbx.on { background: var(--cc-special); border-color: var(--cc-special); }
    .cc-filter-cbx mat-icon { color: #fff; font-size: 14px; width: 14px; height: 14px; line-height: 14px; }
  `],
})
export class FilterBarComponent {
  readonly provider = input.required<FilterProvider>();
  readonly valuesChange = output<FilterValues>();

  readonly defs = computed(() => this.provider().getFilterDefs());
  readonly values = signal<FilterValues>({});
  readonly results = signal<Record<string, FilterOption[]>>({});
  readonly totalActive = computed(() => Object.values(this.values()).reduce((sum, opts) => sum + opts.length, 0));

  private readonly searchControls: Record<string, FormControl<string>> = {};

  /** Quantos chips mostrar na caixa antes de colapsar o resto em "+K" (UI Kit §11.8). */
  private readonly MAX_CHIPS = 2;

  isActive(def: FilterDef): boolean {
    return (this.values()[def.key]?.length ?? 0) > 0;
  }

  private selectedOf(def: FilterDef): FilterOption[] {
    return this.values()[def.key] ?? [];
  }

  visibleChips(def: FilterDef): FilterOption[] {
    return this.selectedOf(def).slice(0, this.MAX_CHIPS);
  }

  overflowCount(def: FilterDef): number {
    return Math.max(0, this.selectedOf(def).length - this.MAX_CHIPS);
  }

  removeChip(def: FilterDef, opt: FilterOption, event: Event): void {
    event.stopPropagation();
    this.toggle(def, opt);
  }

  /** Todas as opções atualmente carregadas do filtro já estão selecionadas? */
  allSelected(def: FilterDef): boolean {
    const opts = this.results()[def.key] ?? [];
    if (opts.length === 0) return false;
    const selected = this.selectedOf(def);
    return opts.every((o) => selected.some((s) => s.value === o.value));
  }

  /** "Selecionar todos"/"limpar" sobre as opções carregadas (só faz sentido em filtro multiple). */
  toggleAll(def: FilterDef): void {
    if (!def.multiple) return;
    const opts = this.results()[def.key] ?? [];
    const next: FilterOption[] = this.allSelected(def) ? [] : [...opts];
    const updated: FilterValues = { ...this.values(), [def.key]: next };
    this.values.set(updated);
    this.valuesChange.emit(updated);
  }

  isSelected(def: FilterDef, opt: FilterOption): boolean {
    return (this.values()[def.key] ?? []).some((o) => o.value === opt.value);
  }

  toggle(def: FilterDef, opt: FilterOption): void {
    const current = this.values()[def.key] ?? [];
    const exists = current.some((o) => o.value === opt.value);
    let next: FilterOption[];
    if (exists) next = current.filter((o) => o.value !== opt.value);
    else if (def.multiple) next = [...current, opt];
    else next = [opt];

    const updated: FilterValues = { ...this.values(), [def.key]: next };
    this.values.set(updated);
    this.valuesChange.emit(updated);
  }

  onOpen(def: FilterDef): void {
    // Garante a busca inicial (lista default) mesmo sem o usuário digitar nada.
    this.openFilter(def);
  }

  /** Menu consolidado do smartphone (2.2): garante a busca inicial de todos os filtros de uma vez. */
  onOpenAll(): void {
    for (const def of this.defs()) this.openFilter(def);
  }

  /** CIME: na 1ª abertura cria o controle (que já faz a busca inicial); nas seguintes, recarrega as
   *  opções com o termo atual — os valores possíveis mudam junto com os registros da tela. */
  private openFilter(def: FilterDef): void {
    const existing = this.searchControls[def.key];
    if (!existing) { this.searchControl(def); return; }
    def.search(existing.value).pipe(observeOn(asyncScheduler))
      .subscribe((opts) => this.results.update((map) => ({ ...map, [def.key]: opts })));
  }

  searchControl(def: FilterDef): FormControl<string> {
    let control = this.searchControls[def.key];
    if (!control) {
      control = new FormControl('', { nonNullable: true });
      this.searchControls[def.key] = control;
      control.valueChanges.pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term) => def.search(term)),
      ).subscribe((opts) => this.results.update((map) => ({ ...map, [def.key]: opts })));
      // observeOn(asyncScheduler): a carga inicial roda ao ABRIR o popover (evento `opened`). Se o
      // provider devolve dados SÍNCRONOS (`of(...)`, ex. filtro de perfil/status), o update cairia no
      // MESMO CD do attach do overlay e o painel renderizaria vazio ("changed after checked"). Forçar
      // a emissão pra um macrotask faz o update cair num CD posterior — igual ao caminho HTTP (async).
      def.search('').pipe(observeOn(asyncScheduler)).subscribe((opts) => this.results.update((map) => ({ ...map, [def.key]: opts })));
    }
    return control;
  }
}
