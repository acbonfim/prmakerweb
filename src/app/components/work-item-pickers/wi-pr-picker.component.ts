import { Component, ViewEncapsulation, computed, effect, inject, input, model, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { GithubPullRequest, PullRequestService } from '../../services/pull-request.service';
import { PrOption, prOptions } from './param-input';
import { PICKER_STYLES } from './picker.styles';

/** PRs do card mudam pouco enquanto o editor está aberto. */
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; promise: Promise<GithubPullRequest[]> }>();

/**
 * 0085 rodada 4: pull request (kind `pr-review`, input `pull-request`) — autocomplete com os PRs do card
 * (`GET PullRequest/{card}/github`, os do repositório escolhido primeiro, abertos antes dos fechados) e texto livre
 * (URL ou número de um PR de fora do card). O valor gravado é a URL do PR.
 */
@Component({
  selector: 'app-wi-pr-picker',
  standalone: true,
  imports: [FormsModule, MatAutocompleteModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="wip">
      <input class="wi-input" [ngModel]="value()" (ngModelChange)="onType($event)" (focus)="query.set('')"
             [matAutocomplete]="auto" [placeholder]="placeholder() || 'URL ou número do PR'"
             [attr.aria-label]="label()" autocomplete="off" spellcheck="false">
      <mat-autocomplete #auto="matAutocomplete" class="wip-panel" (optionSelected)="pick($event.option.value)">
        @for (o of options(); track o.value) {
          <mat-option [value]="o.value" class="wip-pr-opt">
            <span class="wip-pr">
              <span class="wip-opt__name">{{ o.label }}</span>
              @if (o.hint) { <span class="wip-opt__hint">{{ o.hint }}</span> }
            </span>
            <span class="wip-tag" [class.wip-tag--fluxo]="o.open">{{ o.status }}</span>
          </mat-option>
        }
        @if (loading()) { <mat-option class="wip-opt--status" disabled>Buscando os PRs do card…</mat-option> }
        @else if (!options().length) { <mat-option class="wip-opt--status" disabled>Nenhum PR do card — cole a URL ou o número do PR</mat-option> }
      </mat-autocomplete>
      @if (error()) { <span class="wip__hint">{{ error() }}</span> }
      @else if (picked(); as p) { <span class="wip__hint">{{ p.hint }}</span> }
    </div>
  `,
  styles: [PICKER_STYLES, `
    .wip-panel .mat-mdc-option.wip-pr-opt { min-height: 46px; }
    .wip-pr { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.3; }
    .wip-pr .wip-opt__hint { overflow: hidden; text-overflow: ellipsis; }
  `]
})
export class WiPrPickerComponent {
  private prs = inject(PullRequestService);

  readonly value = model<string>('');
  readonly card = input<string | null>(null);
  readonly repository = input<string | null>(null);
  readonly placeholder = input<string | null>(null);
  readonly label = input<string>('Pull request');

  readonly query = signal('');
  readonly list = signal<GithubPullRequest[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly options = computed<PrOption[]>(() => prOptions(this.list(), this.repository(), this.query()));
  readonly picked = computed(() => {
    const v = `${this.value() ?? ''}`.trim();
    return v ? prOptions(this.list(), this.repository(), null).find((o) => o.value === v) ?? null : null;
  });

  constructor() {
    effect(() => {
      const card = `${this.card() ?? ''}`.trim();
      untracked(() => this.load(card));
    });
  }

  private async load(card: string): Promise<void> {
    if (!card) { this.list.set([]); return; }
    let hit = cache.get(card);
    if (!hit || Date.now() - hit.at > TTL_MS) {
      hit = {
        at: Date.now(),
        promise: new Promise<GithubPullRequest[]>((resolve, reject) =>
          this.prs.listGithubPrs(card, false).subscribe({ next: (l) => resolve(l ?? []), error: reject }))
      };
      cache.set(card, hit);
    }
    this.loading.set(true);
    try {
      this.list.set(await hit.promise);
      this.error.set(null);
    } catch {
      cache.delete(card);
      this.error.set('Não foi possível listar os PRs do card — cole a URL ou o número do PR.');
    } finally {
      this.loading.set(false);
    }
  }

  onType(v: string): void {
    const text = `${v ?? ''}`;
    this.value.set(text);
    this.query.set(text);
  }

  pick(v: string): void {
    this.value.set(v);
    this.query.set('');
  }
}
