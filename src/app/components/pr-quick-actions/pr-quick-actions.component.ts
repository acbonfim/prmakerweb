import { Component, ChangeDetectorRef, ElementRef, HostListener, ViewChild, computed, inject, input, signal } from '@angular/core';
import { CdkOverlayOrigin, OverlayModule } from '@angular/cdk/overlay';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CcPopoverComponent } from '../popover/cc-popover.component';
import { TargetBranchOption, TargetBranchToggleComponent } from '../target-branch-toggle/target-branch-toggle.component';
import { GithubPrStatusTarget, GithubPullRequest, PullRequestService } from '../../services/pull-request.service';
import { CardPrStateService } from '../../services/card-pr-state.service';
import { CliipboardService } from '../../services/cliipboard.service';
import { TeamsService } from '../../services/teams.service';

interface StatusOption {
  value: GithubPrStatusTarget;
  label: string;
  icon: string;
}

/**
 * Atalhos rápidos de um PR da lista (feature 0007): um único popover (cc-popover — abre mais rápido
 * que o mat-menu), aberto pelo botão ⚡ do item ou pelo clique com o botão direito na linha (na
 * posição do mouse). "Alterar status" abre as opções ali mesmo e "Abrir PR rápido" troca o conteúdo
 * do mesmo painel. Também concentra o pedido de aprovação no Teams e a troca de status (com o
 * skeleton só no status da linha), para a lista continuar só apresentando os itens.
 */
@Component({
  selector: 'app-pr-quick-actions',
  standalone: true,
  imports: [OverlayModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule,
    CcPopoverComponent, TargetBranchToggleComponent],
  template: `
    <!-- Âncora invisível: posicionada no ⚡ ou no ponteiro (botão direito) -->
    <div class="qa-anchor" #anchorEl [style.left.px]="anchorX()" [style.top.px]="anchorY()"
         cdkOverlayOrigin #anchor="cdkOverlayOrigin"></div>

    <!-- Um único popover (mais rápido que mat-menu): atalhos → status inline → "Abrir PR rápido" no mesmo painel -->
    <cc-popover #pop (closed)="onClosed()">
      @if (current(); as pr) {
        @if (mode() === 'menu') {
          <div class="qa-list" role="menu">
            <div class="qa-head">
              <mat-icon>bolt</mat-icon>
              <span>{{ pr.branchPrefix }}{{ pr.branchName }}@if (pr.number) { · #{{ pr.number }} }</span>
            </div>
            <button type="button" class="qa-item" role="menuitem" [disabled]="!pr.url" (click)="openInGithub(pr)">
              <mat-icon>open_in_new</mat-icon><span>Abrir no GitHub</span>
            </button>
            <button type="button" class="qa-item" role="menuitem" [disabled]="!pr.url" (click)="copyLink(pr)">
              <mat-icon>link</mat-icon><span>Copiar link do PR</span>
            </button>
            <button type="button" class="qa-item" role="menuitem" [disabled]="!canQuickOpen()" (click)="openQuickPr(pr)">
              <mat-icon>call_split</mat-icon><span>Abrir PR rápido…</span>
            </button>
            <button type="button" class="qa-item" role="menuitem" [class.qa-item--open]="statusOpen()"
                    [disabled]="statusOptions(pr).length === 0 || isChangingStatus(pr)" (click)="statusOpen.set(!statusOpen())">
              <mat-icon>swap_horiz</mat-icon><span>Alterar status</span>
              <mat-icon class="qa-item__caret">{{ statusOpen() ? 'expand_less' : 'expand_more' }}</mat-icon>
            </button>
            @if (statusOpen()) {
              <div class="qa-sub">
                @for (opt of statusOptions(pr); track opt.value) {
                  <button type="button" class="qa-item qa-item--sub" role="menuitem" (click)="setStatus(pr, opt.value)">
                    <mat-icon>{{ opt.icon }}</mat-icon><span>{{ opt.label }}</span>
                  </button>
                }
              </div>
            }
            <button type="button" class="qa-item" role="menuitem" [disabled]="!!approvalBlockReason(pr) || isSendingApproval(pr)"
                    [title]="approvalBlockReason(pr) ?? ''" (click)="requestApproval(pr); pop.close()">
              <mat-icon>forum</mat-icon><span>Pedir aprovação no Teams</span>
            </button>
          </div>
        } @else {
          <!-- Abrir PR rápido: mesma branch/repositório do PR, só escolhe o destino (componente do modal) -->
          <div class="qa-quick">
            <div class="qa-quick__title">
              <button type="button" class="qa-back" (click)="mode.set('menu')" [disabled]="quickSaving()" aria-label="Voltar">
                <mat-icon>arrow_back</mat-icon>
              </button>
              <mat-icon>call_split</mat-icon> Abrir PR rápido
            </div>
            <div class="qa-quick__meta">
              <span><mat-icon>folder</mat-icon>{{ pr.repositoryId }}</span>
              <span><mat-icon>alt_route</mat-icon>{{ pr.branchPrefix }}{{ pr.branchName }}</span>
            </div>
            <app-target-branch-toggle label="Destino" [options]="targetOptions()"
                                      [value]="quickTarget()" (valueChange)="quickTarget.set($event)"
                                      [disabled]="quickSaving()"></app-target-branch-toggle>
            <div class="qa-quick__hint">Título: {{ quickTitle() }}</div>
            @if (quickError()) { <div class="qa-quick__error"><mat-icon>error_outline</mat-icon>{{ quickError() }}</div> }
            <div class="qa-quick__actions">
              <button mat-button (click)="pop.close()" [disabled]="quickSaving()">Cancelar</button>
              <button mat-flat-button color="primary" (click)="submitQuickPr(pr)" [disabled]="!quickTarget() || quickSaving()">
                @if (quickSaving()) { <mat-spinner diameter="16"></mat-spinner> } @else { <mat-icon>merge</mat-icon> }
                Abrir PR
              </button>
            </div>
          </div>
        }
      }
    </cc-popover>
  `,
  styles: [`
    :host { display: contents; }
    .qa-anchor { position: fixed; width: 0; height: 0; pointer-events: none; }

    .qa-list { display: flex; flex-direction: column; gap: 1px; width: 250px; max-width: calc(100vw - 60px); margin: -6px -8px; }
    .qa-head {
      display: flex; align-items: center; gap: 6px; padding: 2px 8px 8px;
      font-size: 12px; font-weight: 600;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 65%, transparent);
      border-bottom: 1px solid var(--cc-surface-border, rgba(255, 255, 255, 0.08)); margin-bottom: 4px;
    }
    .qa-head mat-icon { font-size: 16px; width: 16px; height: 16px; color: #d29922; }
    /* Linhas no mesmo visual das opções do cc-filter-bar */
    .qa-item {
      display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
      padding: 7px 8px; border: none; border-radius: 8px; background: none; font: inherit; font-size: 13px;
      color: var(--cc-text-1, inherit); cursor: pointer;
    }
    .qa-item:hover:not(:disabled), .qa-item--open { background: var(--cc-surface-2, rgba(255,255,255,.06)); }
    .qa-item:disabled { opacity: .45; cursor: default; }
    .qa-item mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--cc-text-2, inherit); }
    .qa-item__caret { margin-left: auto; }
    .qa-sub { display: flex; flex-direction: column; gap: 1px; margin: 0 0 2px 18px; padding-left: 6px;
      border-left: 2px solid var(--cc-surface-border, rgba(255, 255, 255, 0.08)); }
    .qa-item--sub { padding: 6px 8px; }
    .qa-back { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0;
      border: none; border-radius: 50%; background: none; color: inherit; cursor: pointer; }
    .qa-back:hover:not(:disabled) { background: var(--cc-surface-2, rgba(255,255,255,.06)); }
    .qa-back mat-icon { font-size: 18px; width: 18px; height: 18px; color: inherit !important; }

    .qa-quick { display: flex; flex-direction: column; gap: 10px; width: 300px; max-width: calc(100vw - 60px); }
    .qa-quick__title { display: flex; align-items: center; gap: 6px; font-weight: 600; }
    .qa-quick__title mat-icon { color: var(--mat-sys-primary); }
    .qa-quick__meta { display: flex; flex-direction: column; gap: 2px; font-size: 12px;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 70%, transparent); }
    .qa-quick__meta span { display: flex; align-items: center; gap: 4px; }
    .qa-quick__meta mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .qa-quick__hint { font-size: 12px; color: color-mix(in srgb, var(--mat-sys-on-surface) 60%, transparent); }
    .qa-quick__error { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #f85149; }
    .qa-quick__error mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .qa-quick__actions { display: flex; justify-content: flex-end; gap: 8px; }
    .qa-quick__actions mat-spinner { display: inline-block; margin-right: 6px; }
  `]
})
export class PrQuickActionsComponent {
  private prService = inject(PullRequestService);
  private state = inject(CardPrStateService);
  private teams = inject(TeamsService);
  private clipboard = inject(CliipboardService);
  private snackBar = inject(MatSnackBar);
  private cdr = inject(ChangeDetectorRef);

  /** Destinos possíveis (ActiveBranchs do plugin "PullRequest"), os mesmos do modal. */
  readonly targetOptions = input<TargetBranchOption[]>([]);
  /** ExternalId de quem está logado (autor do PR aberto pelo atalho). */
  readonly userId = input<string | undefined>(undefined);

  @ViewChild('anchor') private anchor?: CdkOverlayOrigin;
  @ViewChild('anchorEl') private anchorEl?: ElementRef<HTMLElement>;
  @ViewChild('pop') private pop?: CcPopoverComponent;

  readonly current = signal<GithubPullRequest | null>(null);
  readonly anchorX = signal(0);
  readonly anchorY = signal(0);
  /** Conteúdo do popover: lista de atalhos ou o formulário "Abrir PR rápido". */
  readonly mode = signal<'menu' | 'quick'>('menu');
  /** Opções de "Alterar status" abertas dentro da lista. */
  readonly statusOpen = signal(false);
  private isOpen = false;

  /** PRs com troca de status em andamento (skeleton só no status da linha). */
  readonly changingStatus = signal<ReadonlySet<number>>(new Set());

  /** PRs com pedido de aprovação em andamento (spinner no botão da linha). */
  readonly sendingApproval = signal<ReadonlySet<number>>(new Set());

  readonly quickTarget = signal('');
  readonly quickSaving = signal(false);
  readonly quickError = signal<string | null>(null);
  readonly quickTitle = computed(() => {
    const target = this.quickTarget();
    const label = this.targetOptions().find(o => o.value === target)?.label ?? target;
    return `AB#${this.state.cardNumber() ?? ''} ${label.toUpperCase()}`.trim();
  });

  readonly canQuickOpen = computed(() => this.targetOptions().length > 0 && !!this.state.cardNumber());

  /** Abre o menu no botão ⚡ (abaixo dele, alinhado à direita). */
  openFromButton(pr: GithubPullRequest, button: HTMLElement): void {
    const rect = button.getBoundingClientRect();
    // Âncora no centro do ⚡: o caret do popover aponta para o botão.
    this.openAt(pr, rect.left + rect.width / 2, rect.bottom);
  }

  /** Abre o menu no ponteiro (clique com o botão direito na linha). */
  openFromContextMenu(pr: GithubPullRequest, event: MouseEvent): void {
    event.preventDefault();
    this.openAt(pr, event.clientX, event.clientY);
  }

  /**
   * Com o popover aberto, o backdrop cobre a tela: um novo clique com o botão direito cairia no menu
   * do navegador. Fecha o popover (o próximo botão direito já abre na linha certa).
   */
  @HostListener('document:contextmenu', ['$event'])
  onDocumentContextMenu(event: MouseEvent): void {
    if (!this.isOpen) return;
    const target = event.target as HTMLElement | null;
    if (target?.classList.contains('cdk-overlay-backdrop')) {
      event.preventDefault();
      this.pop?.close();
    }
  }

  onClosed(): void {
    this.isOpen = false;
  }

  private openAt(pr: GithubPullRequest, x: number, y: number): void {
    this.pop?.close();
    this.current.set(pr);
    this.mode.set('menu');
    this.statusOpen.set(false);
    this.anchorX.set(x);
    this.anchorY.set(y);
    // Zoneless: aplica a posição da âncora antes de o popover medir onde abrir.
    this.cdr.detectChanges();
    // position: fixed pode ficar deslocado se algum ancestral tiver transform: corrige pela medida real.
    const rect = this.anchorEl?.nativeElement.getBoundingClientRect();
    if (rect && (Math.abs(rect.left - x) > 1 || Math.abs(rect.top - y) > 1)) {
      this.anchorX.set(x + (x - rect.left));
      this.anchorY.set(y + (y - rect.top));
      this.cdr.detectChanges();
    }
    if (!this.anchor) return;
    this.pop?.open(this.anchor);
    this.isOpen = true;
  }

  openInGithub(pr: GithubPullRequest): void {
    if (pr.url) window.open(pr.url, '_blank', 'noopener');
  }

  copyLink(pr: GithubPullRequest): void {
    if (!pr.url) return;
    const notify = () => this.snackBar.open('Link do PR copiado', 'Ok', {
      horizontalPosition: 'right', verticalPosition: 'top', duration: 3000,
    });
    if (!navigator.clipboard) {
      this.clipboard.copyFullDescriptionToClipboard(pr.url);
      return;
    }
    navigator.clipboard.writeText(pr.url).then(notify).catch(() => this.clipboard.copyFullDescriptionToClipboard(pr.url));
  }

  /** Status possíveis a partir do atual (MERGED/LEGADO não mudam). */
  statusOptions(pr: GithubPullRequest): StatusOption[] {
    if (pr.status === 'OPEN' && pr.isDraft) {
      return [
        { value: 'OPEN', label: 'Pronto para revisão (OPEN)', icon: 'task_alt' },
        { value: 'CLOSED', label: 'Fechar (CLOSED)', icon: 'block' },
      ];
    }
    if (pr.status === 'OPEN') {
      return [
        { value: 'DRAFT', label: 'Voltar para DRAFT', icon: 'edit_note' },
        { value: 'CLOSED', label: 'Fechar (CLOSED)', icon: 'block' },
      ];
    }
    if (pr.status === 'CLOSED') {
      return [
        { value: 'OPEN', label: 'Reabrir (OPEN)', icon: 'restart_alt' },
        { value: 'DRAFT', label: 'Reabrir como DRAFT', icon: 'edit_note' },
      ];
    }
    return [];
  }

  isChangingStatus(pr: GithubPullRequest): boolean {
    return this.changingStatus().has(pr.id);
  }

  setStatus(pr: GithubPullRequest, status: GithubPrStatusTarget): void {
    const card = this.state.cardNumber();
    if (!card || this.isChangingStatus(pr)) return;

    // Fecha na hora; só o status da linha fica em skeleton até o GitHub responder.
    this.pop?.close();
    this.changingStatus.update(set => new Set(set).add(pr.id));
    const done = () => this.changingStatus.update(set => { const next = new Set(set); next.delete(pr.id); return next; });

    this.prService.setGithubPrStatus(card, pr.id, status).subscribe({
      next: (updated) => {
        done();
        this.state.upsertGithubPr(updated);
        const label = updated.status === 'OPEN' && updated.isDraft ? 'DRAFT' : updated.status;
        this.snackBar.open(`PR #${updated.number}: status alterado para ${label}`, 'Ok', {
          horizontalPosition: 'right', verticalPosition: 'top', duration: 4000,
        });
      },
      error: (err) => {
        done();
        this.showError(err, 'Não foi possível alterar o status do PR.');
      },
    });
  }

  /** Motivo de o pedido de aprovação estar indisponível (null = pode pedir). */
  approvalBlockReason(pr: GithubPullRequest): string | null {
    const status = this.teams.status();
    if (!status?.available) return 'Integração com o Teams indisponível';
    if (!status.configured) return 'Configure o Teams em Minhas integrações para pedir aprovação';
    if (pr.status === 'LEGACY') return 'Registro legado: abra o PR antes de pedir aprovação';
    if (pr.status !== 'OPEN') return `PR ${pr.status}: só é possível pedir aprovação de PR aberto`;
    if (pr.isDraft) return 'PR em DRAFT: marque como pronto (OPEN) antes de pedir aprovação';
    return null;
  }

  isSendingApproval(pr: GithubPullRequest): boolean {
    return this.sendingApproval().has(pr.id);
  }

  requestApproval(pr: GithubPullRequest): void {
    const card = this.state.cardNumber();
    if (!card || this.approvalBlockReason(pr) || this.isSendingApproval(pr)) return;

    this.sendingApproval.update(set => new Set(set).add(pr.id));
    const done = () => this.sendingApproval.update(set => { const next = new Set(set); next.delete(pr.id); return next; });

    this.teams.requestApproval(card, pr.id).subscribe({
      next: (res) => {
        done();
        const group = res.groupName || this.teams.status()?.groupName;
        this.snackBar.open(`Aprovação do PR #${pr.number} pedida${group ? ' em ' + group : ' no Teams'}`, 'Ok', {
          horizontalPosition: 'right', verticalPosition: 'top', duration: 5000,
        });
      },
      error: (err) => {
        done();
        // 403 (sem configuração) já é tratado pelo interceptor da 0002 (aviso + "Configurar").
        if (err?.status !== 403) this.showError(err, 'Não foi possível pedir a aprovação no Teams.');
      },
    });
  }

  openQuickPr(pr: GithubPullRequest): void {
    if (!this.anchor || !this.canQuickOpen()) return;
    // Destino padrão: o primeiro diferente do destino deste PR (o caso comum é "mesma branch → outro ambiente").
    const options = this.targetOptions();
    const suggested = options.find(o => o.value !== pr.targetBranch) ?? options[0];
    this.quickTarget.set(suggested?.value ?? '');
    this.quickError.set(null);
    this.quickSaving.set(false);
    // Mesmo painel: troca a lista de atalhos pelo formulário.
    this.mode.set('quick');
  }

  submitQuickPr(pr: GithubPullRequest): void {
    const card = this.state.cardNumber();
    const target = this.quickTarget();
    const userId = this.userId();
    if (!card || !target || this.quickSaving()) return;
    if (!userId) {
      this.quickError.set('Usuário não identificado — entre novamente no CIME.');
      return;
    }

    this.quickSaving.set(true);
    this.quickError.set(null);
    this.prService.openGithubPr(card, {
      repositoryId: pr.repositoryId,
      branchPrefix: pr.branchPrefix,
      branchName: pr.branchName,
      targetBranch: target,
      title: this.quickTitle(),
      description: this.state.description() ?? '',
      draft: false,
      userId,
    }).subscribe({
      next: (created) => {
        this.quickSaving.set(false);
        this.state.upsertGithubPr(created);
        this.pop?.close();
        const message = created.alreadyExisted
          ? `Já existia PR para ${target} — link copiado`
          : `PR aberto para ${target} — link copiado`;
        this.copyWithAction(created.url, message);
      },
      error: (err) => {
        this.quickSaving.set(false);
        const body = err?.error;
        this.quickError.set((typeof body === 'string' && body) || body?.error || 'Não foi possível abrir o PR.');
      },
    });
  }

  private copyWithAction(url: string, message: string): void {
    const notify = () => {
      const ref = this.snackBar.open(message, 'Abrir', { horizontalPosition: 'right', verticalPosition: 'top', duration: 6000 });
      ref.onAction().subscribe(() => window.open(url, '_blank', 'noopener'));
    };
    if (!url) return;
    if (!navigator.clipboard) {
      this.clipboard.copyFullDescriptionToClipboard(url);
      return;
    }
    navigator.clipboard.writeText(url).then(notify).catch(() => this.clipboard.copyFullDescriptionToClipboard(url));
  }

  private showError(err: any, fallback: string): void {
    const body = err?.error;
    const message = (typeof body === 'string' && body) || body?.error || body?.message || fallback;
    this.snackBar.open(message, 'Fechar', { horizontalPosition: 'right', verticalPosition: 'top', duration: 8000 });
  }
}
