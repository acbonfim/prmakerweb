import { ChangeDetectorRef, Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BranchInputComponent } from '../branch-input/branch-input.component';
import { RepoAutocompleteComponent } from '../repo-autocomplete/repo-autocomplete.component';
import { TargetBranchOption, TargetBranchToggleComponent } from '../target-branch-toggle/target-branch-toggle.component';
import { PrInfoCardComponent } from '../pr-info-card/pr-info-card.component';
import { PanelPopoverButtonComponent } from '../panel-popover-button/panel-popover-button.component';
import { PrDescriptionPanelComponent } from '../pr-description-panel/pr-description-panel.component';
import { CardPrStateService } from '../../services/card-pr-state.service';
import { GithubPullRequest, PullRequestService } from '../../services/pull-request.service';
import { AuthService } from '../../services/auth.service';
import { CliipboardService } from '../../services/cliipboard.service';
import { RepoOption } from '../../interfaces/RepoOption';

export interface OpenPrDialogData {
  cardNumber: string;
  cardType?: string;
  /** externalId do usuário logado (quem abre o PR no CIME). */
  userId: string;
  targetOptions: TargetBranchOption[];
  defaultTarget: string;
  defaultPrefix: string;
  defaultBranchName: string;
  defaultRepository: string | null;
  /** Usado quando a lista de repositórios do GitHub não puder ser carregada. */
  repositoryFallback: RepoOption[];
  /** Quando informado, o modal abre em modo edição (3.1): repo/branch somente leitura. */
  pr?: GithubPullRequest | null;
}

/**
 * Modal "Abrir PR" (spec 1.1/1.2/2.1/2.2/3.1): escolhe branch, repositório e branch de destino,
 * abre o PR no GitHub pelo backend e copia o link. Descrição e root cause são os do card
 * (estado compartilhado), acessíveis pelos popovers.
 */
@Component({
  selector: 'app-open-pr-dialog',
  standalone: true,
  imports: [
    FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule,
    MatProgressSpinnerModule, MatSlideToggleModule, MatTooltipModule,
    BranchInputComponent, RepoAutocompleteComponent, TargetBranchToggleComponent,
    PrInfoCardComponent, PanelPopoverButtonComponent, PrDescriptionPanelComponent,
  ],
  templateUrl: './open-pr-dialog.component.html',
  styleUrls: ['./open-pr-dialog.component.css'],
})
export class OpenPrDialogComponent implements OnInit {
  readonly data = inject<OpenPrDialogData>(MAT_DIALOG_DATA);
  private dialogRef = inject(MatDialogRef<OpenPrDialogComponent, GithubPullRequest | undefined>);
  readonly state = inject(CardPrStateService);
  private prService = inject(PullRequestService);
  private authService = inject(AuthService);
  private clipboard = inject(CliipboardService);
  private snackBar = inject(MatSnackBar);
  private cdr = inject(ChangeDetectorRef);

  readonly isEdit = !!this.data.pr;
  readonly editingPr = this.data.pr ?? null;

  readonly branchPrefix = signal(this.data.pr?.branchPrefix ?? this.data.defaultPrefix ?? 'hotfix/');
  readonly branchName = signal(this.data.pr?.branchName ?? this.data.defaultBranchName ?? '');
  readonly repository = signal<RepoOption | string | null>(null);
  readonly target = signal(this.data.pr?.targetBranch ?? this.data.defaultTarget ?? '');
  readonly title = signal(this.data.pr?.title ?? '');
  readonly draft = signal(false);

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  /** Enquanto o usuário não editar o título, ele acompanha a branch de destino. */
  private titleTouched = this.isEdit;

  readonly repositoryValue = computed(() => this.resolveRepositoryValue(this.repository()));

  /** PR já registrado para o repositório + branch selecionados (2.2.1). */
  readonly matchingPr = computed<GithubPullRequest | null>(() => {
    if (this.editingPr) return this.editingPr;
    const repo = this.repositoryValue();
    const prefix = this.branchPrefix();
    const name = this.branchName().trim();
    if (!repo || !name) return null;
    // Registros LEGACY não têm PR no GitHub: abrir o PR para eles é justamente o caso de uso.
    return this.state.githubPrs().find(pr => pr.number != null &&
      pr.repositoryId === repo && pr.branchPrefix === prefix && pr.branchName === name) ?? null;
  });

  readonly author = signal<{ name: string; photo: string | null }>({ name: '', photo: null });
  private authorCache = new Map<string, { name: string; photo: string | null }>();

  readonly showRootCause = (this.data.cardType ?? '').toLowerCase() !== 'us';

  readonly canSubmit = computed(() =>
    !this.saving() && !!this.repositoryValue() && !!this.branchName().trim()
    && !!this.target() && !!this.title().trim());

  constructor() {
    // Título padrão no formato já usado pelo time: "AB#<card> <BRANCH DE DESTINO>".
    effect(() => {
      const target = this.target();
      if (this.titleTouched) return;
      untracked(() => this.title.set(this.defaultTitle(target)));
    });

    // Autor do PR correspondente (usuário do CIME — no GitHub o autor é a conta do token).
    effect(() => {
      const userId = this.matchingPr()?.userId;
      untracked(() => this.loadAuthor(userId));
    });
  }

  async ngOnInit(): Promise<void> {
    const repos = await this.state.loadRepositories(this.data.repositoryFallback);
    const wanted = this.data.pr?.repositoryId ?? this.data.defaultRepository;
    if (wanted) {
      this.repository.set(repos.find(r => r.value === wanted) ?? { label: wanted, value: wanted });
    } else if (repos.length > 0) {
      this.repository.set(repos[0]);
    }
    this.cdr.markForCheck();
  }

  onTitleInput(value: string): void {
    this.titleTouched = true;
    this.title.set(value);
  }

  submit(): void {
    if (!this.canSubmit()) return;
    this.error.set(null);
    this.saving.set(true);

    const description = this.state.description() ?? '';
    const request$ = this.editingPr
      ? this.prService.updateGithubPr(this.data.cardNumber, this.editingPr.id, {
          title: this.title().trim(),
          description,
        })
      : this.prService.openGithubPr(this.data.cardNumber, {
          repositoryId: this.repositoryValue()!,
          branchPrefix: this.branchPrefix(),
          branchName: this.branchName().trim(),
          targetBranch: this.target(),
          title: this.title().trim(),
          description,
          draft: this.draft(),
          userId: this.data.userId,
        });

    request$.subscribe({
      next: (pr) => {
        this.saving.set(false);
        this.state.upsertGithubPr(pr);
        const message = this.editingPr
          ? 'PR atualizado'
          : pr.alreadyExisted ? 'PR já existia para esta branch — link copiado' : 'PR aberto — link copiado';
        if (!this.editingPr) this.copyLink(pr.url, message);
        else this.snackBar.open(message, 'Ok', { horizontalPosition: 'right', verticalPosition: 'top', duration: 4000 });
        this.dialogRef.close(pr);
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(err?.error?.error ?? 'Não foi possível abrir o PR. Tente novamente.');
      },
    });
  }

  copyCurrentLink(): void {
    const url = this.matchingPr()?.url;
    if (url) this.copyLink(url, 'Link do PR copiado');
  }

  openInGithub(): void {
    const url = this.matchingPr()?.url;
    if (url) window.open(url, '_blank');
  }

  close(): void {
    this.dialogRef.close();
  }

  private copyLink(url: string, message: string): void {
    const notify = () => {
      const ref = this.snackBar.open(message, 'Abrir', {
        horizontalPosition: 'right', verticalPosition: 'top', duration: 6000,
      });
      ref.onAction().subscribe(() => window.open(url, '_blank'));
    };
    // A escrita pode falhar por falta de gesto do usuário (vem depois do HTTP): cai no fallback do serviço.
    if (!navigator.clipboard) {
      this.clipboard.copyFullDescriptionToClipboard(url);
      return;
    }
    navigator.clipboard.writeText(url)
      .then(notify)
      .catch(() => this.clipboard.copyFullDescriptionToClipboard(url));
  }

  private defaultTitle(target: string): string {
    const label = this.data.targetOptions.find(o => o.value === target)?.label ?? target;
    return `AB#${this.data.cardNumber} ${label.toUpperCase()}`.trim();
  }

  private resolveRepositoryValue(value: RepoOption | string | null): string | null {
    if (!value) return null;
    if (typeof value !== 'string') return value.value;
    const text = value.trim().toLowerCase();
    if (!text) return null;
    const match = this.state.repositories().find(r =>
      r.value.toLowerCase() === text || r.label.toLowerCase() === text);
    return match?.value ?? null;
  }

  private loadAuthor(userId: string | undefined): void {
    if (!userId) {
      this.author.set({ name: '', photo: null });
      return;
    }
    const cached = this.authorCache.get(userId);
    if (cached) {
      this.author.set(cached);
      return;
    }
    this.authService.getPhotosByExternalIds([userId]).subscribe({
      next: (res: any) => {
        const list = res?.object ?? res?.Object ?? [];
        const u = list.find((x: any) =>
          (x.externalId || x.ExternalId || '').toLowerCase() === userId.toLowerCase()) ?? list[0];
        const author = { name: u?.fullName || u?.FullName || '', photo: u?.imageUrl || u?.ImageUrl || null };
        this.authorCache.set(userId, author);
        if (this.matchingPr()?.userId === userId) this.author.set(author);
      },
      error: () => this.author.set({ name: '', photo: null }),
    });
  }
}
