import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { renderMarkdown } from '../../helpers/markdown-ext';
import { CliipboardService } from '../../services/cliipboard.service';
import { apiErrorMessage } from '../../services/devops-actions.service';
import { CodeRefHostDirective } from '../code-ref/code-ref-host.directive';
import {
  CardSituation, CardSituationPullRequest, CardSituationService, situationAgo, situationDate,
} from './card-situation.service';

const COLLAPSED_KEY = 'prmake.situation-collapsed';

/**
 * Cartão "Situação atual" (0075/F4) no topo do plano: em que pé o card está, o que é aguardado, desde
 * quando, de quem e o que vem depois — fatos do PRMake (PRs, chamados, QA, perguntas, DevOps), o
 * contexto da passagem (handoff da skill, com links de código) e o próximo passo. Some quando nada é
 * aguardado (`kind === 'none'`). Copiar resumo (markdown + HTML) e Publicar no DevOps (manual, com
 * confirmação — a discussion é lida pelo cliente). Tempo real pelo `CardSituationService`.
 */
@Component({
  selector: 'app-card-situation',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, CodeRefHostDirective],
  templateUrl: './card-situation.component.html',
  styleUrl: './card-situation.component.css',
})
export class CardSituationComponent {
  readonly cardNumber = input<string | number | null | undefined>(null);

  private svc = inject(CardSituationService);
  private clipboard = inject(CliipboardService);

  readonly card = computed(() => {
    const c = this.cardNumber();
    return c === null || c === undefined ? '' : `${c}`.trim();
  });
  readonly situation = computed<CardSituation | null>(() => {
    const card = this.card();
    return card ? this.svc.situationOf(card)() : null;
  });
  /** Mostra o cartão: há algo sendo aguardado. */
  readonly visible = computed(() => {
    const s = this.situation();
    return !!s && !!s.kind && s.kind !== 'none';
  });

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly collapsed = signal(loadCollapsed());
  readonly showDone = signal(false);
  readonly confirmPublish = signal(false);
  readonly publishing = signal(false);
  readonly publishResult = signal<{ ok: boolean; text: string } | null>(null);
  /** Relógio dos "há X" (1 min). */
  readonly now = signal(Date.now());

  readonly handoffHtml = computed(() => md(this.situation()?.handoff));
  readonly checklistHtml = computed(() => md(this.situation()?.qaChecklist));
  readonly nextHtml = computed(() => md(this.situation()?.next));
  readonly since = computed(() => situationAgo(this.situation()?.since, this.now()));
  readonly sinceTitle = computed(() => {
    const at = situationDate(this.situation()?.since);
    return at ? `Desde ${at}` : '';
  });
  readonly devOps = computed(() => {
    const s = this.situation();
    if (!s?.devOpsState && !s?.devOpsColumn) return '';
    return [s.devOpsState, s.devOpsColumn && s.devOpsColumn !== s.devOpsState ? s.devOpsColumn : null].filter(Boolean).join(' · ');
  });
  /** A etapa só aparece quando diz algo além do título (ex.: "Aguardando chamado" · etapa "Chamado: X"). */
  readonly showStep = computed(() => {
    const s = this.situation();
    return !!s?.stepTitle && s.stepTitle.trim().toLowerCase() !== (s.title ?? '').trim().toLowerCase();
  });
  readonly showQa = computed(() => {
    const s = this.situation();
    return !!s && (s.kind === 'qa-validation' || !!s.devTestInQaAt || !!s.devTestInQaError);
  });

  private watched: string | null = null;

  constructor() {
    effect(() => {
      const card = this.card();
      untracked(() => this.switchCard(card));
    });
    const timer = setInterval(() => this.now.set(Date.now()), 60_000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      if (this.watched) this.svc.unwatch(this.watched);
    });
  }

  private switchCard(card: string): void {
    if (card === this.watched) return;
    if (this.watched) this.svc.unwatch(this.watched);
    this.watched = card || null;
    this.confirmPublish.set(false);
    this.publishResult.set(null);
    this.error.set(null);
    if (!card) return;
    this.svc.watch(card);
    this.reload(card);
  }

  /** 1ª carga do cartão: com o DevOps (estado/coluna); mostra o que já estava em cache enquanto isso. */
  reload(card = this.card()): void {
    if (!card) return;
    this.loading.set(true);
    this.error.set(null);
    this.svc.load(card, { devops: true, force: true }).then(
      () => { if (card === this.card()) this.loading.set(false); },
      (err) => {
        if (card !== this.card()) return;
        this.loading.set(false);
        this.error.set(apiErrorMessage(err, 'Não foi possível carregar a situação do card.'));
      },
    );
  }

  toggleCollapsed(): void {
    const v = !this.collapsed();
    this.collapsed.set(v);
    try { localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0'); } catch { /* sem storage */ }
  }

  ago(iso: string | null | undefined): string {
    return situationAgo(iso, this.now());
  }

  date(iso: string | null | undefined): string {
    return situationDate(iso);
  }

  /** "repo → destino". */
  prRoute(pr: CardSituationPullRequest): string {
    return [pr.repository, pr.targetBranch].filter(Boolean).join(' → ');
  }

  ciIcon(checks: string | null | undefined): string {
    switch ((checks ?? '').toLowerCase()) {
      case 'success': return '✅';
      case 'failure': return '❌';
      case 'pending': return '⏳';
      default: return '';
    }
  }

  ciLabel(checks: string | null | undefined): string {
    switch ((checks ?? '').toLowerCase()) {
      case 'success': return 'CI passou';
      case 'failure': return 'CI falhou';
      case 'pending': return 'CI rodando';
      default: return '';
    }
  }

  copy(): void {
    const s = this.situation();
    if (!s?.markdown) return;
    void this.clipboard.copyRichToClipboard(renderMarkdown(s.markdown, { codeRefs: false }), s.markdown);
  }

  askPublish(): void {
    this.publishResult.set(null);
    this.confirmPublish.set(true);
  }

  async publish(): Promise<void> {
    const s = this.situation();
    const card = this.card();
    if (!s?.markdown || !card || this.publishing()) return;
    this.publishing.set(true);
    try {
      await this.svc.publish(card, renderMarkdown(s.markdown, { codeRefs: false }));
      this.publishResult.set({ ok: true, text: 'Resumo publicado na discussion do card no DevOps.' });
      this.confirmPublish.set(false);
    } catch (err) {
      this.publishResult.set({ ok: false, text: apiErrorMessage(err, 'Não foi possível publicar no DevOps.') });
    } finally {
      this.publishing.set(false);
    }
  }
}

function md(text: string | null | undefined): string {
  return text?.trim() ? renderMarkdown(text, { codeRefs: true }) : '';
}

function loadCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
}
