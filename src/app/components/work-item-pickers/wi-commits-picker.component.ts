import { Component, ViewEncapsulation, computed, effect, inject, input, model, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BranchCommit, WorkItemsService } from '../../services/work-items.service';
import { getCommitAuthor, getCommitSha, getCommitTitle } from '../../helpers/commit';
import { formatCommits, parseCommits } from './param-input';
import { PICKER_STYLES } from './picker.styles';

/**
 * 0085 rodada 3: commits do cherry-pick — "todos os commits do card" (valor `card`, padrão dos modelos) ou a escolha
 * de commits (vários) da branch de origem (`GET GitHub/commits?repository=&branch=`). Os SHAs escolhidos também ficam
 * editáveis como texto (commit fora da lista).
 */
@Component({
  selector: 'app-wi-commits-picker',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatTooltipModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="wip wip-commits">
      <div class="wip-commits__mode" role="radiogroup" [attr.aria-label]="label()">
        <label><input type="radio" [name]="radioName" [checked]="all()" (change)="setAll(true)">Todos os commits do card</label>
        <label><input type="radio" [name]="radioName" [checked]="!all()" (change)="setAll(false)">Escolher commits</label>
      </div>
      @if (!all()) {
        @if (!repository() || !branch()) {
          <span class="wip__hint">Informe o repositório e a branch de origem para listar os commits.</span>
        } @else {
          <div class="wip__line">
            <input class="wi-input" [ngModel]="filter()" (ngModelChange)="filter.set($event)" placeholder="Filtrar por título, autor ou SHA" aria-label="Filtrar commits">
          </div>
          @if (loading()) { <span class="wip__hint">Carregando os commits de {{ branch() }}…</span> }
          @else if (error()) { <span class="wip__hint wip__hint--warn">{{ error() }}</span> }
          @else if (!commits().length) { <span class="wip__hint">Nenhum commit em {{ branch() }}.</span> }
          @else {
            <div class="wip-commits__list">
              @for (c of filtered(); track c.sha) {
                <label class="wip-commit">
                  <input type="checkbox" [checked]="selected().has(c.sha)" (change)="toggle(c.sha)">
                  <span class="wip-commit__main">
                    <span class="wip-commit__title">{{ c.title }}</span>
                    <span class="wip-commit__meta"><span class="wip-commit__sha">{{ c.sha.slice(0, 7) }}</span>@if (c.author) { · {{ c.author }} }</span>
                  </span>
                </label>
              }
            </div>
            <span class="wip__hint">{{ selected().size }} escolhido(s) · últimos commits de {{ branch() }}</span>
          }
        }
        <input class="wi-input" [ngModel]="shasText()" (ngModelChange)="onShas($event)" placeholder="SHAs separados por vírgula" aria-label="SHAs dos commits">
      }
    </div>
  `,
  styles: [PICKER_STYLES]
})
export class WiCommitsPickerComponent {
  private api = inject(WorkItemsService);
  private static seq = 0;
  readonly radioName = `wip-commits-${++WiCommitsPickerComponent.seq}`;

  readonly value = model<string>('');
  readonly repository = input<string | null>(null);
  /** Branch de onde vêm os commits (`from` da sub-tarefa ou a branch do card). */
  readonly branch = input<string | null>(null);
  readonly label = input<string>('Commits');

  readonly parsed = computed(() => parseCommits(this.value()));
  /** "Escolher" ligado sem nada escolhido ainda (o valor vazio voltaria a ser "todos"). */
  private picking = signal(false);
  readonly all = computed(() => this.parsed().all && !this.picking());
  readonly selected = computed(() => new Set(this.parsed().shas));
  readonly shasText = computed(() => this.parsed().shas.join(', '));

  readonly commits = signal<{ sha: string; title: string; author: string }[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly filter = signal('');
  readonly filtered = computed(() => {
    const q = this.filter().trim().toLowerCase();
    const list = this.commits();
    return q ? list.filter((c) => c.title.toLowerCase().includes(q) || c.author.toLowerCase().includes(q) || c.sha.toLowerCase().startsWith(q)) : list;
  });

  private loadedKey: string | null = null;

  constructor() {
    effect(() => {
      const repo = `${this.repository() ?? ''}`.trim();
      const branch = `${this.branch() ?? ''}`.trim();
      const all = this.all();
      untracked(() => { if (!all && repo && branch) this.load(repo, branch); });
    });
  }

  private load(repo: string, branch: string): void {
    const key = `${repo}|${branch}`;
    if (key === this.loadedKey) return;
    this.loadedKey = key;
    this.loading.set(true);
    this.error.set(null);
    this.api.commits(repo, branch).subscribe({
      next: (list) => {
        this.commits.set((list ?? []).map((c: BranchCommit) => ({ sha: getCommitSha(c), title: getCommitTitle(c) || '(sem título)', author: `${getCommitAuthor(c) || ''}` }))
          .filter((c) => !!c.sha));
        this.loading.set(false);
      },
      error: (e) => { this.commits.set([]); this.error.set(e?.message ?? 'Não foi possível carregar os commits.'); this.loading.set(false); this.loadedKey = null; }
    });
  }

  setAll(all: boolean): void {
    this.picking.set(!all);
    this.value.set(all ? formatCommits(true, []) : formatCommits(false, this.parsed().all ? [] : this.parsed().shas));
  }

  toggle(sha: string): void {
    const next = new Set(this.parsed().all ? [] : this.parsed().shas);
    if (next.has(sha)) next.delete(sha); else next.add(sha);
    this.picking.set(true);
    this.value.set(formatCommits(false, [...next]));
  }

  onShas(text: string): void {
    this.picking.set(true);
    this.value.set(formatCommits(false, parseCommits(text).shas));
  }
}
