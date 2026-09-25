import { Component, computed, inject, input, output, signal } from '@angular/core';
import { OverlayModule } from '@angular/cdk/overlay';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CcPopoverComponent } from '../popover/cc-popover.component';
import { CardFull } from '../card-details-dialog/card-full.model';
import {
  DevOpsActionsConfig, DevOpsActionsService, DevOpsCardAction, apiErrorMessage, isUserStoryCard,
} from '../../services/devops-actions.service';

type OptionId = 'root-cause' | 'summary' | DevOpsCardAction;

interface MenuOption {
  id: OptionId;
  icon: string;
  label: string;
  /** Tooltip formatado (uma linha por item) com o que a opção faz. */
  details: string;
  /** Motivo do bloqueio (null = habilitada). */
  blockReason: string | null;
  /** Altera o card no DevOps: pede confirmação antes. */
  confirm: boolean;
}

const FIELD_AREA = 'System.AreaPath';
const FIELD_ORIGINAL = 'Microsoft.VSTS.Scheduling.OriginalEstimate';
const FIELD_REMAINING = 'Microsoft.VSTS.Scheduling.RemainingWork';

const SNACK = { direction: 'ltr', horizontalPosition: 'right', verticalPosition: 'top' } as const;

/**
 * Botão "Ações DevOps" da tela do card (feature 0011): substitui o "Salvar RC no DevOps" por um
 * menu (cc-popover) com as automações do DevOps para cards do tipo Bug. Cada opção explica no
 * tooltip o que faz (com os valores efetivos do usuário, do plugin AI Configurations) e, quando
 * bloqueada, mostra o cadeado e o motivo. As regras são revalidadas no backend.
 */
@Component({
  selector: 'app-devops-actions-menu',
  standalone: true,
  imports: [OverlayModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, CcPopoverComponent],
  template: `
    <span class="da-trigger-wrap" [matTooltip]="triggerTooltip()" matTooltipClass="devops-tooltip">
      <button mat-raised-button cdkOverlayOrigin #origin="cdkOverlayOrigin"
              [disabled]="!cardFull() || cardLoading()" (click)="pop.toggle(origin)">
        Ações DevOps
        @if (running()) { <mat-spinner diameter="16" class="da-trigger-spinner"></mat-spinner> }
        @else { <mat-icon>settings_suggest</mat-icon> }
      </button>
    </span>

    <cc-popover #pop (opened)="onOpened()" (closed)="confirming.set(null)">
      <div class="da-list" role="menu">
        <div class="da-head">
          <mat-icon>settings_suggest</mat-icon>
          <span>Ações DevOps · #{{ cardNumber() }}</span>
          @if (configLoading()) { <mat-spinner diameter="14" class="ms-auto"></mat-spinner> }
        </div>

        @if (confirming(); as opt) {
          <div class="da-confirm">
            <div class="da-confirm__title"><mat-icon>{{ opt.icon }}</mat-icon>{{ opt.label }}?</div>
            <div class="da-confirm__details">{{ opt.details }}</div>
            <div class="da-confirm__actions">
              <button mat-button (click)="confirming.set(null)">Cancelar</button>
              <button mat-flat-button color="primary" (click)="execute(opt); pop.close()">
                <mat-icon>check</mat-icon>Confirmar
              </button>
            </div>
          </div>
        } @else {
          @for (opt of options(); track opt.id) {
            <span class="da-wrap" [matTooltip]="tooltipOf(opt)" matTooltipClass="devops-tooltip" matTooltipPosition="left">
              <button type="button" class="da-item" role="menuitem" [disabled]="!!opt.blockReason || running()"
                      (click)="select(opt, pop)">
                <mat-icon>{{ opt.icon }}</mat-icon><span>{{ opt.label }}</span>
                @if (opt.blockReason) { <mat-icon class="da-item__lock">lock</mat-icon> }
              </button>
            </span>
          }

          @if (isUs()) {
            <div class="da-note">
              <mat-icon>info</mat-icon>
              <span>Ações para User Story serão configuradas em breve.</span>
            </div>
          }
        }
      </div>
    </cc-popover>
  `,
  styles: [`
    :host { display: contents; }
    .da-trigger-wrap { display: inline-block; margin-left: 10px; }
    .da-trigger-spinner { display: inline-block; margin-left: 6px; }

    .da-list { display: flex; flex-direction: column; gap: 1px; width: 290px; max-width: calc(100vw - 60px); margin: -6px -8px; }
    .da-head {
      display: flex; align-items: center; gap: 6px; padding: 2px 8px 8px;
      font-size: 12px; font-weight: 600;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 65%, transparent);
      border-bottom: 1px solid var(--cc-surface-border, rgba(255, 255, 255, 0.08)); margin-bottom: 4px;
    }
    .da-head mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--mat-sys-primary); }
    .da-wrap { display: block; }
    /* Mesmo visual dos atalhos rápidos da lista de PRs (pr-quick-actions) */
    .da-item {
      display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
      padding: 7px 8px; border: none; border-radius: 8px; background: none; font: inherit; font-size: 13px;
      color: var(--cc-text-1, inherit); cursor: pointer;
    }
    .da-item:hover:not(:disabled) { background: var(--cc-surface-2, rgba(255,255,255,.06)); }
    .da-item:disabled { opacity: .45; cursor: default; }
    .da-item mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--cc-text-2, inherit); }
    .da-item__lock { margin-left: auto; font-size: 16px !important; width: 16px !important; height: 16px !important; }

    .da-note { display: flex; gap: 8px; align-items: flex-start; margin-top: 6px; padding: 8px;
      border-radius: 8px; font-size: 12px; background: color-mix(in srgb, var(--mat-sys-primary) 10%, transparent); }
    .da-note mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--mat-sys-primary); flex: none; }

    .da-confirm { display: flex; flex-direction: column; gap: 8px; padding: 2px 8px 4px; }
    .da-confirm__title { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 13px; }
    .da-confirm__title mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--mat-sys-primary); }
    .da-confirm__details { white-space: pre-line; font-size: 12px; line-height: 1.5;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 75%, transparent); }
    .da-confirm__actions { display: flex; justify-content: flex-end; gap: 6px; }
  `],
})
export class DevOpsActionsMenuComponent {
  private service = inject(DevOpsActionsService);
  private snackBar = inject(MatSnackBar);

  readonly cardNumber = input<string | null>(null);
  /** Card do DevOps (null = não encontrado → botão desabilitado). */
  readonly cardFull = input<CardFull | null>(null);
  readonly cardLoading = input(false);
  /** Root cause local (Markdown) preenchido. */
  readonly hasRootCause = input(false);
  /** Registro do card já salvo no PRMake (o resumo é gravado nele). */
  readonly registerSaved = input(false);
  readonly hasSummary = input(false);
  /** "Salvar RC" em andamento (feito pela tela). */
  readonly rootCauseSaving = input(false);

  readonly saveRootCause = output<void>();
  readonly openSummary = output<string>();
  /** Uma ação alterou o card no DevOps: a tela recarrega os detalhes e as pendências. */
  readonly changed = output<void>();

  readonly config = signal<DevOpsActionsConfig | null>(null);
  readonly configLoading = signal(false);
  readonly confirming = signal<MenuOption | null>(null);
  private readonly actionRunning = signal(false);
  readonly running = computed(() => this.actionRunning() || this.rootCauseSaving());

  readonly isUs = computed(() => isUserStoryCard(this.cardFull()));

  readonly triggerTooltip = computed(() => {
    if (this.cardLoading()) return 'Carregando o card do DevOps…';
    return this.cardFull() ? 'Automações do DevOps para este card' : '🔒 Card não encontrado no DevOps';
  });

  readonly options = computed<MenuOption[]>(() => {
    const card = this.cardFull();
    const cfg = this.config();
    const saveRc: MenuOption = {
      id: 'root-cause', icon: 'beenhere', label: 'Salvar RC no DevOps', confirm: false,
      details: 'Grava o Root Cause escrito aqui (convertido para HTML) no campo de Root Cause do card no DevOps.',
      blockReason: this.isUs() ? 'User Story não tem Root Cause'
        : !this.hasRootCause() ? 'Escreva o Root Cause antes de salvar no DevOps' : null,
    };
    if (!card || this.isUs()) return [saveRc];

    const loading = !cfg ? (this.configLoading() ? 'Carregando as configurações…' : 'Configurações do AI Configurations indisponíveis') : null;
    const pendencies = this.pendencies(card);
    const pendencyReason = pendencies.length ? `O card tem pendências: ${pendencies.join(', ')}` : null;
    const bug = cfg?.bug;

    const tip = bug?.testInProduction;
    const area = (card.fields?.[FIELD_AREA] ?? '') as string;
    const wrongArea = tip?.requiredArea && area.trim().toLowerCase() !== tip.requiredArea.trim().toLowerCase()
      ? `O card precisa estar na área ${tip.requiredArea} (está em ${area || '—'})` : null;

    const est = bug?.initialEstimate;
    const original = this.number(card, FIELD_ORIGINAL);
    const remaining = this.number(card, FIELD_REMAINING);

    return [
      saveRc,
      {
        id: 'summary', icon: 'translate', confirm: false,
        label: this.hasSummary() ? 'Resumo não técnico (ver/editar)' : 'Gerar resumo não técnico',
        details: [
          'Gera com IA um resumo não técnico (PT-BR + EN-US) do problema e da solução, para a discussion do card.',
          '• Abre no editor: dá para editar, gerar de novo e salvar.',
          '• Salvar publica na discussion (ou atualiza o comentário já publicado) e guarda no PRMake.',
        ].join('\n'),
        blockReason: loading ?? (!this.registerSaved() ? 'Salve o card no PRMake antes (botão Salvar)'
          : !bug?.summaryPrompt ? 'Prompt do resumo não configurado pelo administrador (AI Configurations)' : null),
      },
      {
        id: 'test-in-production', icon: 'rocket_launch', label: 'Mover para Test in production', confirm: true,
        details: [
          `• Área → ${tip?.area || '—'}`,
          `• Estado → ${tip?.state || '—'}`,
          tip?.comment ? `• Comentário na discussion: “${tip.comment}”` : '• Sem comentário',
          `Exige: card sem pendências${tip?.requiredArea ? ` e na área ${tip.requiredArea}` : ''}.`,
        ].join('\n'),
        blockReason: loading ?? pendencyReason ?? wrongArea
          ?? (!tip?.area || !tip?.state ? 'Área/estado de destino não configurados (AI Configurations)' : null),
      },
      {
        id: 'ready-for-qa', icon: 'fact_check', label: 'Mover para Ready for QA', confirm: true,
        details: [`• Estado → ${bug?.readyForQa.state || '—'}`, 'Exige: card sem pendências.'].join('\n'),
        blockReason: loading ?? pendencyReason
          ?? (!bug?.readyForQa.state ? 'Estado de Ready for QA não configurado (AI Configurations)' : null),
      },
      {
        id: 'initial-estimate', icon: 'schedule', label: 'Realizar estimativa inicial', confirm: true,
        details: [
          `• Original Estimate → ${this.fmt(est?.originalEstimate)}`,
          `• Remaining Work → ${this.fmt(est?.remainingWork)}`,
          `• Completed Work → ${this.fmt(est?.completedWork)}`,
          'Só para card sem Original Estimate. Valores definidos por você em Minhas integrações → AI Configurations.',
        ].join('\n'),
        blockReason: loading ?? (!est?.configured
          ? 'Preencha Original Estimate, Remaining Work e Completed Work em Minhas integrações → AI Configurations'
          : original ? `O card já tem Original Estimate (${this.fmt(original)})` : null),
      },
      {
        id: 'zero-remaining', icon: 'timer_off', label: 'Zerar Remaining', confirm: true,
        details: `• Remaining Work → 0${remaining ? ` (hoje: ${this.fmt(remaining)})` : ''}`,
        blockReason: !remaining ? 'O Remaining Work já está zerado' : null,
      },
    ];
  });

  tooltipOf(opt: MenuOption): string {
    return opt.blockReason ? `🔒 Bloqueado: ${opt.blockReason}\n\n${opt.label}\n${opt.details}` : `${opt.label}\n${opt.details}`;
  }

  /** Relê a configuração a cada abertura (o usuário pode ter mudado em "Minhas integrações"). */
  async onOpened(): Promise<void> {
    if (this.configLoading() || !this.cardFull() || this.isUs()) return;
    await this.loadConfig();
  }

  /** Relê a configuração (ex.: depois de salvar em "Minhas integrações"). */
  async loadConfig(): Promise<void> {
    this.configLoading.set(true);
    try {
      this.config.set(await this.service.getConfig());
    } catch (e) {
      console.error('Falha ao carregar a configuração das Ações DevOps', e);
    } finally {
      this.configLoading.set(false);
    }
  }

  select(opt: MenuOption, pop: CcPopoverComponent): void {
    if (opt.blockReason) return;
    if (opt.confirm) {
      this.confirming.set(opt);
      return;
    }
    pop.close();
    if (opt.id === 'root-cause') this.saveRootCause.emit();
    else if (opt.id === 'summary') this.openSummary.emit(this.config()?.bug.summaryPrompt ?? '');
  }

  async execute(opt: MenuOption): Promise<void> {
    const card = this.cardNumber();
    if (!card || opt.id === 'root-cause' || opt.id === 'summary') return;

    this.confirming.set(null);
    this.actionRunning.set(true);
    try {
      const result = await this.service.run(card, opt.id);
      this.snackBar.open(result.message || `${opt.label}: concluído`, 'Ok', { ...SNACK, duration: 5000 });
      this.changed.emit();
    } catch (e) {
      this.snackBar.open(apiErrorMessage(e, `Não foi possível concluir: ${opt.label}`), 'Ok', { ...SNACK, duration: 8000 });
    } finally {
      this.actionRunning.set(false);
    }
  }

  private pendencies(card: CardFull): string[] {
    const a = card.alerts;
    if (!a) return [];
    return [
      a.missingRootCause && 'Root Cause',
      a.missingResolutionType && 'Resolution Type',
      a.missingGeneralClassification && 'General Classification',
      a.missingClassification && 'Classification',
      a.remainingNotZero && 'Remaining não zerado',
    ].filter((x): x is string => !!x);
  }

  private number(card: CardFull, field: string): number | null {
    const v = card.fields?.[field];
    return typeof v === 'number' && v !== 0 ? v : null;
  }

  private fmt(v: number | null | undefined): string {
    return v === null || v === undefined ? '—' : String(v);
  }
}
