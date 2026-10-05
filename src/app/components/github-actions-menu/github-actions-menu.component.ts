import { Component, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { CdkOverlayOrigin, OverlayModule } from '@angular/cdk/overlay';
import { DomSanitizer } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CcPopoverComponent } from '../popover/cc-popover.component';
import { TargetBranchOption } from '../target-branch-toggle/target-branch-toggle.component';
import { GithubPullRequest } from '../../services/pull-request.service';
import { CliipboardService } from '../../services/cliipboard.service';
import {
  PrCopyFormat, PrCopyRow, formatPrHtmlTable, formatPrMarkdownTable, formatPrText,
} from './pr-copy-format';

/** Marca do GitHub (Octicon mark-github), cor do texto — o Material Icons não tem. */
const GITHUB_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor">' +
  '<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';

/** Nome do ícone SVG registrado (`<mat-icon svgIcon="github">`). */
export const GITHUB_SVG_ICON = 'github';

/** Registra o ícone do GitHub no `MatIconRegistry` (idempotente). */
export function registerGithubIcon(registry: MatIconRegistry, sanitizer: DomSanitizer): void {
  registry.addSvgIconLiteral(GITHUB_SVG_ICON, sanitizer.bypassSecurityTrustHtml(GITHUB_ICON));
}

type View = 'menu' | 'copy';

/** Só PRs abertos ou mesclados entram na cópia (fechados sem merge e legados ficam de fora). */
const COPYABLE_STATUS = ['OPEN', 'MERGED'];

/**
 * Botão "Ações GitHub" da tela do card (feature 0062): substitui o "Abrir PR" por um popover (mesmo
 * padrão do "Ações DevOps") com "Abrir PR" e "Copiar PR". "Copiar PR" troca o conteúdo do popover
 * por um checklist dos PRs abertos/mesclados do card (verde = aberto, roxo = mesclado) e, no rodapé,
 * a escolha do formato (texto ou tabela) e o botão Copiar. Pode abrir a partir do "⋯" (`openAt`).
 */
@Component({
  selector: 'app-github-actions-menu',
  standalone: true,
  imports: [OverlayModule, MatButtonModule, MatButtonToggleModule, MatCheckboxModule, MatIconModule,
    MatTooltipModule, CcPopoverComponent],
  template: `
    <button mat-raised-button cdkOverlayOrigin #origin="cdkOverlayOrigin"
            [disabled]="!canOpenPr() && copyable().length === 0" (click)="pop.toggle(origin)">
      Ações GitHub<mat-icon svgIcon="github"></mat-icon>
    </button>

    <cc-popover #pop (opened)="view.set('menu')">
      @if (view() === 'menu') {
        <div class="ga-list" role="menu">
          <div class="ga-head">
            <mat-icon svgIcon="github"></mat-icon>
            <span>Ações GitHub · #{{ cardNumber() }}</span>
          </div>
          <span class="ga-wrap" [matTooltip]="canOpenPr() ? '' : '🔒 Busque o card para abrir um PR'" matTooltipPosition="above">
            <button type="button" class="ga-item" role="menuitem" [disabled]="!canOpenPr()" (click)="openPrClicked()">
              <mat-icon>merge</mat-icon>
              <span class="ga-item__text"><span>Abrir PR</span><small>Abre o modal para criar um PR deste card</small></span>
              @if (!canOpenPr()) { <mat-icon class="ga-item__lock">lock</mat-icon> }
            </button>
          </span>
          <span class="ga-wrap" [matTooltip]="copyable().length ? '' : '🔒 Nenhum PR aberto ou mesclado para este card'"
                matTooltipPosition="above">
            <button type="button" class="ga-item" role="menuitem" [disabled]="copyable().length === 0" (click)="showCopy()">
              <mat-icon>content_copy</mat-icon>
              <span class="ga-item__text"><span>Copiar PR</span><small>Copia os PRs abertos/mesclados (texto ou tabela)</small></span>
              @if (copyable().length === 0) { <mat-icon class="ga-item__lock">lock</mat-icon> }
              @else { <mat-icon class="ga-item__caret">chevron_right</mat-icon> }
            </button>
          </span>
        </div>
      } @else {
        <div class="ga-copy">
          <div class="ga-copy__title">
            <button type="button" class="ga-back" (click)="view.set('menu')" aria-label="Voltar">
              <mat-icon>arrow_back</mat-icon>
            </button>
            <mat-icon>content_copy</mat-icon> Copiar PR · #{{ cardNumber() }}
          </div>

          <div class="ga-copy__all">
            <mat-checkbox [checked]="allSelected()" [indeterminate]="someSelected()" (change)="toggleAll($event.checked)">
              Selecionar todos
            </mat-checkbox>
            <span class="ga-copy__count">{{ selectedRows().length }}/{{ copyable().length }}</span>
          </div>

          <div class="ga-copy__list">
            @for (pr of copyable(); track pr.id) {
              <label class="ga-pr" [class.ga-pr--on]="isSelected(pr)">
                <mat-checkbox [checked]="isSelected(pr)" (change)="toggle(pr, $event.checked)"></mat-checkbox>
                <span class="ga-pr__main">
                  <span class="ga-pr__top">
                    <span class="ga-env">{{ envLabel(pr) }}</span>
                    <span class="ga-pr__repo">{{ pr.repositoryId }}@if (pr.number) { · #{{ pr.number }} }</span>
                  </span>
                  <span class="ga-pr__branch">{{ pr.branchPrefix }}{{ pr.branchName }}</span>
                </span>
                <span [class]="'ga-chip ga-chip--' + pr.status.toLowerCase()">{{ statusLabel(pr) }}</span>
              </label>
            }
          </div>

          <div class="ga-copy__footer">
            <mat-button-toggle-group class="ga-format" [value]="format()" (change)="format.set($event.value)"
                                     hideSingleSelectionIndicator aria-label="Formato da cópia">
              <mat-button-toggle value="text" matTooltip="CARD [AMBIENTE] - link, uma linha por PR" matTooltipPosition="above">
                Texto
              </mat-button-toggle>
              <mat-button-toggle value="table" matTooltip="Tabela CARD · AMBIENTE · PR" matTooltipPosition="above">
                Tabela
              </mat-button-toggle>
            </mat-button-toggle-group>
            <button mat-flat-button color="primary" [disabled]="selectedRows().length === 0" (click)="copy(pop)">
              <mat-icon>content_copy</mat-icon>Copiar
            </button>
          </div>
        </div>
      }
    </cc-popover>
  `,
  styles: [`
    :host { display: contents; }
    .ga-list { display: flex; flex-direction: column; gap: 1px; width: 290px; max-width: calc(100vw - 60px); margin: -6px -8px; }
    .ga-head {
      display: flex; align-items: center; gap: 6px; padding: 2px 8px 8px;
      font-size: 12px; font-weight: 600;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 65%, transparent);
      border-bottom: 1px solid var(--cc-surface-border, rgba(255, 255, 255, 0.08)); margin-bottom: 4px;
    }
    .ga-head mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--mat-sys-primary); }
    .ga-wrap { display: block; }
    /* Mesmo visual das opções do "Ações DevOps" / "Ações inteligentes" */
    .ga-item {
      display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
      padding: 7px 8px; border: none; border-radius: 8px; background: none; font: inherit; font-size: 13px;
      color: var(--cc-text-1, inherit); cursor: pointer;
    }
    .ga-item:hover:not(:disabled) { background: var(--cc-surface-2, rgba(255,255,255,.06)); }
    .ga-item:disabled { opacity: .45; cursor: default; }
    .ga-item mat-icon { flex: none; font-size: 18px; width: 18px; height: 18px; color: var(--cc-text-2, inherit); }
    .ga-item__text { display: flex; flex-direction: column; min-width: 0; }
    .ga-item__text small { font-size: 11px; color: color-mix(in srgb, var(--mat-sys-on-surface) 60%, transparent); }
    .ga-item__lock, .ga-item__caret { margin-left: auto; }
    .ga-item__lock { font-size: 16px !important; width: 16px !important; height: 16px !important; }

    /* ── Copiar PR ── */
    .ga-copy { display: flex; flex-direction: column; gap: 8px; width: 310px; max-width: calc(100vw - 60px); margin: -6px -8px; }
    .ga-copy__title { display: flex; align-items: center; gap: 6px; padding: 2px 8px 6px; font-size: 13px; font-weight: 600;
      border-bottom: 1px solid var(--cc-surface-border, rgba(255, 255, 255, 0.08)); }
    .ga-copy__title mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--mat-sys-primary); }
    .ga-back { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0;
      border: none; border-radius: 50%; background: none; color: inherit; cursor: pointer; }
    .ga-back:hover { background: var(--cc-surface-2, rgba(255,255,255,.08)); }
    .ga-back mat-icon { color: inherit; }
    .ga-copy__all { display: flex; align-items: center; justify-content: space-between; padding: 0 8px; font-size: 12px; }
    .ga-copy__count { font-size: 11px; color: color-mix(in srgb, var(--mat-sys-on-surface) 60%, transparent); }
    .ga-copy__list { display: flex; flex-direction: column; gap: 2px; max-height: 260px; overflow-y: auto; padding: 0 2px; }
    .ga-pr { display: flex; align-items: center; gap: 6px; padding: 4px 8px 4px 2px; border-radius: 8px; cursor: pointer; }
    .ga-pr:hover { background: var(--cc-surface-2, rgba(255,255,255,.06)); }
    .ga-pr__main { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
    .ga-pr__top { display: flex; align-items: center; gap: 6px; font-size: 13px; min-width: 0; }
    .ga-pr__repo { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ga-pr__branch { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 60%, transparent); }
    .ga-env { flex: none; padding: 0 6px; border-radius: 6px; font-size: 11px; font-weight: 700;
      background: var(--cc-surface-2, rgba(255,255,255,.08)); }
    /* Status: mesmas cores da lista de PRs (verde = aberto, roxo = mesclado) */
    .ga-chip { flex: none; padding: 1px 8px; border-radius: 999px; border: 1px solid transparent;
      font-size: 10px; font-weight: 700; letter-spacing: .3px; }
    .ga-chip--open { color: #3fb950; background: rgba(63, 185, 80, 0.15); border-color: rgba(63, 185, 80, 0.4); }
    .ga-chip--merged { color: #a371f7; background: rgba(163, 113, 247, 0.15); border-color: rgba(163, 113, 247, 0.4); }
    .ga-copy__footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px 0;
      border-top: 1px solid var(--cc-surface-border, rgba(255, 255, 255, 0.08)); }
    .ga-format { --mat-button-toggle-height: 34px; font-size: 12px; }
  `],
})
export class GithubActionsMenuComponent {
  private readonly clipboard = inject(CliipboardService);

  readonly cardNumber = input<string | null>(null);
  readonly canOpenPr = input(false);
  /** PRs do GitHub do card (todos os status; o menu filtra o que pode copiar). */
  readonly prs = input<GithubPullRequest[]>([]);
  /** Destinos configurados (ActiveBranchs): o rótulo (ex.: HV) é o "ambiente" da cópia. */
  readonly targetOptions = input<TargetBranchOption[]>([]);

  readonly openPr = output<void>();

  private readonly pop = viewChild.required(CcPopoverComponent);
  private readonly trigger = viewChild.required<CdkOverlayOrigin>('origin');

  readonly view = signal<View>('menu');
  readonly format = signal<PrCopyFormat>('text');
  /** ids dos PRs desmarcados — assim PR novo na lista já nasce marcado. */
  private readonly unchecked = signal<ReadonlySet<number>>(new Set());

  readonly copyable = computed(() =>
    this.prs().filter(pr => COPYABLE_STATUS.includes(pr.status) && !!pr.url));
  readonly selectedRows = computed<PrCopyRow[]>(() =>
    this.copyable().filter(pr => this.isSelected(pr)).map(pr => ({
      card: pr.cardNumber || this.cardNumber() || '',
      env: this.envLabel(pr),
      url: pr.url,
    })));
  readonly allSelected = computed(() => this.copyable().length > 0 && this.selectedRows().length === this.copyable().length);
  readonly someSelected = computed(() => this.selectedRows().length > 0 && !this.allSelected());

  constructor() {
    const registry = inject(MatIconRegistry);
    registerGithubIcon(registry, inject(DomSanitizer));
    // Outro card: a seleção volta ao padrão (todos marcados).
    effect(() => {
      this.cardNumber();
      untracked(() => this.unchecked.set(new Set()));
    });
  }

  /** Abre o menu ancorado em outro elemento (ex.: botão "⋯" do rodapé quando este não cabe). */
  openAt(origin?: CdkOverlayOrigin): void {
    if (!this.canOpenPr() && this.copyable().length === 0) return;
    this.pop().open(origin ?? this.trigger());
  }

  envLabel(pr: GithubPullRequest): string {
    const option = this.targetOptions().find(o => o.value === pr.targetBranch);
    return option?.label || (pr.targetBranch ?? '').toUpperCase();
  }

  statusLabel(pr: GithubPullRequest): string {
    return pr.status === 'MERGED' ? 'MERGEADO' : 'ABERTO';
  }

  isSelected(pr: GithubPullRequest): boolean {
    return !this.unchecked().has(pr.id);
  }

  toggle(pr: GithubPullRequest, checked: boolean): void {
    const next = new Set(this.unchecked());
    if (checked) next.delete(pr.id); else next.add(pr.id);
    this.unchecked.set(next);
  }

  toggleAll(checked: boolean): void {
    this.unchecked.set(checked ? new Set() : new Set(this.copyable().map(pr => pr.id)));
  }

  openPrClicked(): void {
    if (!this.canOpenPr()) return;
    this.pop().close();
    this.openPr.emit();
  }

  showCopy(): void {
    if (this.copyable().length === 0) return;
    this.view.set('copy');
  }

  copy(pop: CcPopoverComponent): void {
    const rows = this.selectedRows();
    if (rows.length === 0) return;
    if (this.format() === 'table') {
      void this.clipboard.copyRichToClipboard(formatPrHtmlTable(rows), formatPrMarkdownTable(rows));
    } else {
      this.clipboard.copyFullDescriptionToClipboard(formatPrText(rows));
    }
    pop.close();
  }
}
