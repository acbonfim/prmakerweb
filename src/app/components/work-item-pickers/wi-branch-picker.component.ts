import { Component, ViewEncapsulation, computed, effect, inject, input, model, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { Subject, catchError, debounceTime, of, switchMap, tap } from 'rxjs';
import { GitHubBranch, WorkItemsService } from '../../services/work-items.service';
import { BranchOption, BranchSuggestContext, BranchTag, branchSuggestions, mergeBranchOptions, pickerErrorHint, targetSuggestions } from './param-input';
import { PICKER_STYLES } from './picker.styles';

const TAG_LABEL: Record<BranchTag, string> = { fluxo: 'fluxo', regra: 'regra', card: 'card', base: 'base', github: 'GitHub' };

/**
 * 0085 rodada 3: branch com autocomplete pesquisável — sugestões das regras do card no topo (destino: fluxo, destinos
 * com regra e bases; branch: a do card e a por destino, ex. `hotfix/77434-rv`) e as branches do GitHub do repositório
 * (`GET GitHub/branches`, debounce 250 ms). Aceita texto livre (branch nova).
 */
@Component({
  selector: 'app-wi-branch-picker',
  standalone: true,
  imports: [FormsModule, MatAutocompleteModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="wip">
      <input class="wi-input" [ngModel]="value()" (ngModelChange)="onType($event)" (focus)="onFocus()"
             [matAutocomplete]="auto" [placeholder]="placeholder() || (mode() === 'target-branch' ? 'Branch de destino' : 'Nome da branch')"
             [attr.aria-label]="label()" autocomplete="off" spellcheck="false">
      <mat-autocomplete #auto="matAutocomplete" class="wip-panel" (optionSelected)="pick($event.option.value)">
        @for (o of options(); track o.name) {
          <mat-option [value]="o.name">
            <span class="wip-opt__name">{{ o.name }}</span>
            @if (o.hint) { <span class="wip-opt__hint">{{ o.hint }}</span> }
            <span class="wip-tag wip-tag--{{ o.tag }}">{{ tagLabel(o.tag) }}</span>
          </mat-option>
        }
        @if (loading()) { <mat-option class="wip-opt--status" disabled>Buscando branches no GitHub…</mat-option> }
        @else if (!options().length) { <mat-option class="wip-opt--status" disabled>Nenhuma branch — o texto digitado vale como branch nova</mat-option> }
      </mat-autocomplete>
      @if (!repository()) {
        <span class="wip__hint">Escolha o repositório para buscar as branches no GitHub.</span>
      } @else if (error(); as e) {
        <span class="wip__hint" [class.wip__hint--warn]="e.warn">{{ e.text }}</span>
      } @else if (isNew()) {
        <span class="wip__hint">Ainda não existe em {{ repository() }} (branch nova).</span>
      }
    </div>
  `,
  styles: [PICKER_STYLES]
})
export class WiBranchPickerComponent {
  private api = inject(WorkItemsService);

  readonly value = model<string>('');
  /** `branch` (de trabalho/origem) ou `target-branch` (destino do PR). */
  readonly mode = input<'branch' | 'target-branch'>('branch');
  readonly repository = input<string | null>(null);
  readonly card = input<string | null>(null);
  readonly suggest = input<BranchSuggestContext | null>(null);
  readonly placeholder = input<string | null>(null);
  readonly label = input<string>('Branch');

  readonly query = signal('');
  readonly remote = signal<GitHubBranch[]>([]);
  /** Busca da última resposta (para dizer "branch nova" só quando a busca foi pelo próprio texto). */
  readonly remoteQuery = signal<string | null>(null);
  readonly loading = signal(false);
  readonly error = signal<{ text: string; warn: boolean } | null>(null);

  private search$ = new Subject<string>();
  private lastKey: string | null = null;

  readonly suggestions = computed<BranchOption[]>(() =>
    this.mode() === 'target-branch' ? targetSuggestions(this.suggest()) : branchSuggestions(this.suggest()));
  readonly options = computed(() => mergeBranchOptions(this.suggestions(), this.remote(), this.query()));
  readonly isNew = computed(() => {
    const v = `${this.value() ?? ''}`.trim().toLowerCase();
    if (this.mode() !== 'branch' || !v || this.loading() || this.remoteQuery()?.toLowerCase() !== v) return false;
    return !this.remote().some((b) => b.name.toLowerCase() === v);
  });

  readonly tagLabel = (t: BranchTag) => TAG_LABEL[t] ?? t;

  constructor() {
    this.search$.pipe(
      debounceTime(250),
      switchMap((q) => {
        const repo = `${this.repository() ?? ''}`.trim();
        const key = `${repo}|${q}`;
        if (!repo || key === this.lastKey) return of(null);
        this.lastKey = key;
        this.loading.set(true);
        return this.api.branches(repo, q, this.card()).pipe(
          tap(() => this.error.set(null)),
          catchError((e) => {
            this.error.set(pickerErrorHint(e?.status, 'branches', e?.message ?? 'Não foi possível listar as branches.'));
            // Sem integração não adianta repetir a cada tecla; outro erro tenta de novo na próxima busca.
            if (e?.status !== 409 && e?.status !== 403) this.lastKey = null;
            return of([] as GitHubBranch[]);
          }),
          tap((list) => { this.remote.set(list ?? []); this.remoteQuery.set(q); })
        );
      }),
      takeUntilDestroyed()
    ).subscribe(() => this.loading.set(false));

    // Trocou o repositório: as branches de antes não valem mais; busca de novo pelo valor atual (diz se é nova).
    effect(() => {
      this.repository();
      untracked(() => {
        this.remote.set([]);
        this.remoteQuery.set(null);
        this.lastKey = null;
        this.error.set(null);
        const v = `${this.value() ?? ''}`.trim();
        if (v) this.search$.next(v);
      });
    });
  }

  onFocus(): void {
    // Ao focar mostra tudo (sugestões + primeiras branches); o texto atual continua no campo.
    this.query.set('');
    this.search$.next('');
  }

  onType(v: string): void {
    const text = `${v ?? ''}`;
    this.value.set(text);
    this.query.set(text);
    this.search$.next(text.trim());
  }

  pick(name: string): void {
    this.value.set(name);
    this.query.set('');
    this.search$.next(name);
  }
}
