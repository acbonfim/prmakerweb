import { Component, OnInit, computed, inject, input, model, output, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { environment } from '../../../environments/environment';
import { GitDiffViewerComponent } from '../git-diff-viewer/git-diff-viewer';
import { CommitDetailsComponent } from '../commit-details/commit-details.component';
import { RepoCommitSelection } from '../../services/card-pr-state.service';
import { displayCommit, getCommitDescription, getCommitSha, getCommitTitle } from '../../helpers/commit';

/**
 * Seleção de commit + diff de UM repositório (um step do stepper vertical da geração com IA).
 * Ao escolher um commit, o diff é buscado na hora e a seleção completa é emitida.
 */
@Component({
  selector: 'app-repo-commit-picker',
  standalone: true,
  imports: [FormsModule, MatAutocompleteModule, MatButtonModule, MatFormFieldModule, MatIconModule,
    MatInputModule, MatProgressSpinnerModule, MatTooltipModule, GitDiffViewerComponent, CommitDetailsComponent],
  templateUrl: './repo-commit-picker.component.html',
  styleUrls: ['./repo-commit-picker.component.css'],
})
export class RepoCommitPickerComponent implements OnInit {
  private http = inject(HttpClient);
  private urlBase = environment.apiUrl;

  readonly repository = input.required<string>();
  readonly branch = model('');
  /** Seleção já feita antes (ex.: dialog reaberto) — restaura sem buscar de novo. */
  readonly initialSelection = input<RepoCommitSelection | null>(null);
  readonly selectionChange = output<RepoCommitSelection | null>();

  readonly commits = signal<any[]>([]);
  readonly isCommitsLoading = signal(false);
  readonly isDiffLoading = signal(false);
  readonly error = signal<string | null>(null);
  readonly selectedCommit = signal<any>(null);
  readonly diff = signal<any>(null);
  readonly search = signal<any>('');

  readonly filteredCommits = computed(() => {
    const value = this.search();
    const text = (typeof value === 'string' ? value : '').toLowerCase();
    return this.commits().filter(c =>
      getCommitTitle(c).toLowerCase().includes(text) ||
      getCommitDescription(c).toLowerCase().includes(text));
  });

  readonly displayCommit = displayCommit;
  readonly getCommitSha = getCommitSha;
  readonly getCommitTitle = getCommitTitle;
  readonly getCommitDescription = getCommitDescription;

  ngOnInit(): void {
    const initial = this.initialSelection();
    if (initial) {
      this.selectedCommit.set(initial.commit);
      this.diff.set(initial.diff);
      this.search.set(initial.commit);
    }
    this.loadCommits(false);
  }

  /** Recarrega os commits da branch; `clearSelection` descarta o commit escolhido (troca de branch). */
  loadCommits(clearSelection = true): void {
    const branch = this.branch().trim();
    if (!branch) {
      this.error.set('Informe a branch.');
      return;
    }
    if (clearSelection) this.clearSelection();

    this.error.set(null);
    this.isCommitsLoading.set(true);
    const repo = encodeURIComponent(this.repository());
    this.http.get<any[]>(`${this.urlBase}GitHub/commits?repository=${repo}&branch=${encodeURIComponent(branch)}`).subscribe({
      next: (response) => {
        this.commits.set(response ?? []);
        this.isCommitsLoading.set(false);
        if ((response ?? []).length === 0) this.error.set('Nenhum commit encontrado nesta branch.');
      },
      error: () => {
        this.commits.set([]);
        this.isCommitsLoading.set(false);
        this.error.set(`Não foi possível carregar os commits de "${branch}" em ${this.repository()}. Confira a branch.`);
      },
    });
  }

  selectCommit(commit: any): void {
    this.selectedCommit.set(commit);
    this.diff.set(null);
    this.selectionChange.emit(null);

    const sha = getCommitSha(commit);
    if (!sha) return;

    this.isDiffLoading.set(true);
    const repo = encodeURIComponent(this.repository());
    this.http.get(`${this.urlBase}GitHub/commit/${sha}/diff?repository=${repo}`).subscribe({
      next: (diff) => {
        this.isDiffLoading.set(false);
        // Ignora respostas atrasadas de um commit que já não está selecionado.
        if (getCommitSha(this.selectedCommit()) !== sha) return;
        this.diff.set(diff);
        this.selectionChange.emit({
          repository: this.repository(),
          branch: this.branch().trim(),
          commit,
          diff,
        });
      },
      error: () => {
        this.isDiffLoading.set(false);
        this.error.set('Não foi possível carregar o diff do commit.');
      },
    });
  }

  private clearSelection(): void {
    this.selectedCommit.set(null);
    this.diff.set(null);
    this.search.set('');
    this.selectionChange.emit(null);
  }
}
