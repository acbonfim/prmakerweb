import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, OnDestroy, OnInit,
  afterNextRender, effect, inject, signal, untracked, viewChild,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ConfirmDialogComponent } from '../confirmDialog/confirmDialog.component';
import { HomeCardPullRequest } from '../../services/home-cards.service';
import { TabCardInfoService, CardTabInfo } from '../../services/tab-card-info.service';
import { Tab, TabsService } from '../../services/tabs.service';
import { UserPendingService } from '../../services/user-pending.service';

const PLAN_STATUS: Record<string, { label: string; icon: string; tone: string }> = {
  pending: { label: 'Plano pendente', icon: 'schedule', tone: 'neutral' },
  running: { label: 'Plano em andamento', icon: 'play_circle', tone: 'info' },
  paused: { label: 'Plano pausado', icon: 'pause_circle', tone: 'warn' },
  completed: { label: 'Plano concluído', icon: 'check_circle', tone: 'ok' },
  failed: { label: 'Plano falhou', icon: 'error', tone: 'error' },
  cancelled: { label: 'Plano cancelado', icon: 'cancel', tone: 'neutral' },
};

interface PrSummary { tone: string; count: number; label: string }

/** Preferência de altura da faixa; a classe no <html> troca o --cime-tabs-h (styles.scss) para as telas descontarem. */
const DENSITY_KEY = 'prmake.tabs.density';
const TALL_CLASS = 'cime-tabs-tall';
/** Largura das setas sobre as pontas da faixa: a aba ativa não fica escondida atrás delas. */
const ARROW_W = 28;

/**
 * Faixa de abas internas (0065), logo abaixo do topbar. Ampliada (padrão): duas linhas — número + título e, embaixo,
 * situação, plano, PRs e estado no DevOps. Compacta: uma linha fina (a tela de PR ganha altura). O título cede com
 * reticências e o botão de fechar fica sempre visível. Se as abas não cabem, a faixa rola pelas setas ‹ ›.
 * Amarela = plano aguardando o usuário.
 */
@Component({
  selector: 'app-tab-bar',
  standalone: true,
  imports: [NgTemplateOutlet, MatIconModule, MatTooltipModule],
  templateUrl: './tab-bar.component.html',
  styleUrls: ['./tab-bar.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabBarComponent implements OnInit, OnDestroy {
  readonly tabs = inject(TabsService);
  private readonly cardInfo = inject(TabCardInfoService);
  private readonly pending = inject(UserPendingService);
  private readonly dialog = inject(MatDialog);
  private readonly injector = inject(Injector);
  private readonly strip = viewChild.required<ElementRef<HTMLElement>>('strip');

  readonly tall = signal(readTall());
  readonly canLeft = signal(false);
  readonly canRight = signal(false);

  private resize?: ResizeObserver;
  private lastActive: string | null = null;

  constructor() {
    effect(() => {
      const tall = this.tall();
      document.documentElement.classList.toggle(TALL_CLASS, tall);
      try { localStorage.setItem(DENSITY_KEY, tall ? 'tall' : 'compact'); } catch { /* sem storage: só não lembra */ }
    });
    // Abas, indicadores ou altura mudaram: recalcula as setas e traz a ativa para a vista.
    effect(() => {
      this.tabs.tabs();
      this.cardInfo.info();
      this.pending.byCard();
      this.tall();
      const active = this.tabs.activeId();
      untracked(() => afterNextRender(() => {
        this.updateArrows();
        if (active !== this.lastActive) {
          this.lastActive = active;
          this.reveal(active);
        }
      }, { injector: this.injector }));
    });
    inject(DestroyRef).onDestroy(() => document.documentElement.classList.remove(TALL_CLASS));
  }

  ngOnInit(): void {
    this.cardInfo.start();
    afterNextRender(() => {
      this.resize = new ResizeObserver(() => this.updateArrows());
      this.resize.observe(this.strip().nativeElement);
    }, { injector: this.injector });
  }

  ngOnDestroy(): void {
    this.cardInfo.stop();
    this.resize?.disconnect();
  }

  toggleTall(): void {
    this.tall.update((v) => !v);
  }

  updateArrows(): void {
    const el = this.strip().nativeElement;
    this.canLeft.set(el.scrollLeft > 1);
    this.canRight.set(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }

  /** Seta: anda quase uma "tela" de abas, deixando a última visível como referência. */
  scrollBy(dir: 1 | -1): void {
    const el = this.strip().nativeElement;
    el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.8), behavior: 'smooth' });
  }

  /** Roda do mouse (vertical) rola a faixa na horizontal quando há abas escondidas. */
  onWheel(event: WheelEvent): void {
    const el = this.strip().nativeElement;
    if (el.scrollWidth <= el.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    el.scrollLeft += event.deltaY;
  }

  private reveal(id: string | null): void {
    const el = this.strip().nativeElement;
    const tab = id ? el.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`) : null;
    if (!tab) return;
    const left = tab.offsetLeft;
    const right = left + tab.offsetWidth;
    if (left < el.scrollLeft + ARROW_W) el.scrollTo({ left: Math.max(0, left - ARROW_W), behavior: 'smooth' });
    else if (right > el.scrollLeft + el.clientWidth - ARROW_W) el.scrollTo({ left: right - el.clientWidth + ARROW_W, behavior: 'smooth' });
  }

  infoOf(tab: Tab): CardTabInfo | null {
    return tab.card ? this.cardInfo.info().get(tab.card) ?? null : null;
  }

  /** "#75294" fica fixo; o resto (título) é o que trunca. */
  titleOf(tab: Tab): string {
    if (tab.label) return tab.label;   // a tela deu nome à aba (ex.: módulo da engenharia reversa)
    if (!tab.card) return tab.title;
    return this.infoOf(tab)?.devops?.title?.trim() || tab.title;
  }

  waiting(tab: Tab): boolean {
    return !!tab.card && this.pending.byCard().has(tab.card);
  }

  plan(tab: Tab) {
    const status = this.infoOf(tab)?.card?.plan?.status;
    return status ? PLAN_STATUS[status] ?? { label: `Plano: ${status}`, icon: 'schedule', tone: 'neutral' } : null;
  }

  /** "3/7" — etapas do plano concluídas (só na faixa ampliada). */
  steps(tab: Tab): string | null {
    const plan = this.infoOf(tab)?.card?.plan;
    return plan?.stepsTotal ? `${plan.stepsDone}/${plan.stepsTotal}` : null;
  }

  devopsState(tab: Tab): string | null {
    return this.infoOf(tab)?.devops?.state?.trim() || null;
  }

  prs(tab: Tab): PrSummary | null {
    const list: HomeCardPullRequest[] = this.infoOf(tab)?.card?.pullRequests ?? [];
    if (!list.length) return null;
    const open = list.filter((p) => p.status === 'OPEN');
    if (open.length) return { tone: 'open', count: open.length, label: `${open.length} PR(s) aberto(s)` };
    if (list.some((p) => p.status === 'MERGED')) return { tone: 'merged', count: list.length, label: `${list.length} PR(s), mesclado(s)` };
    return { tone: 'closed', count: list.length, label: `${list.length} PR(s) fechado(s)` };
  }

  tooltip(tab: Tab): string {
    const lines: string[] = [];
    lines.push(tab.card ? `#${tab.card} · ${this.titleOf(tab)}` : tab.label ? `${tab.title} · ${tab.label}` : tab.title);
    if (tab.status) lines.push(`Situação: ${tab.status.text}`);
    const info = this.infoOf(tab);
    if (info?.devops?.state) lines.push(`DevOps: ${info.devops.state}`);
    const plan = info?.card?.plan;
    if (plan) {
      const steps = plan.stepsTotal ? ` (${plan.stepsDone}/${plan.stepsTotal})` : '';
      lines.push(`${this.plan(tab)?.label}${steps}${plan.currentStep ? ` — ${plan.currentStep}` : ''}`);
    }
    const prs = this.prs(tab);
    if (prs) lines.push(prs.label);
    if (this.waiting(tab)) lines.push('⏳ Aguardando você');
    if (tab.dirty) lines.push('Edição não salva');
    if (tab.frozen) lines.push('❄ Congelada (inativa); abre de novo ao clicar');
    return lines.join('\n');
  }

  select(tab: Tab): void {
    void this.tabs.activate(tab.id);
  }

  add(): void {
    this.tabs.open();
  }

  auxClick(event: MouseEvent, tab: Tab): void {
    if (event.button !== 1) return;
    event.preventDefault();
    this.close(tab);
  }

  closeClick(event: Event, tab: Tab): void {
    event.stopPropagation();
    this.close(tab);
  }

  close(tab: Tab): void {
    if (!tab.dirty) {
      this.tabs.close(tab.id);
      return;
    }
    this.dialog
      .open(ConfirmDialogComponent, {
        data: {
          title: 'Fechar a aba?',
          description: 'Há alterações não salvas nesta aba. Se fechar, elas serão perdidas.',
          labelCancel: 'Continuar editando',
          labelConfirm: 'Fechar mesmo assim',
        },
      })
      .afterClosed()
      .subscribe((ok) => ok && this.tabs.close(tab.id));
  }

  /** Setas, Home e End percorrem as abas (padrão de tablist). */
  onKey(event: KeyboardEvent, index: number): void {
    const list = this.tabs.tabs();
    const target =
      event.key === 'ArrowRight' ? index + 1 :
      event.key === 'ArrowLeft' ? index - 1 :
      event.key === 'Home' ? 0 :
      event.key === 'End' ? list.length - 1 : -1;
    if (target < 0) return;
    event.preventDefault();
    const next = list[(target + list.length) % list.length];
    if (next) void this.tabs.activate(next.id);
  }
}

function readTall(): boolean {
  try { return localStorage.getItem(DENSITY_KEY) !== 'compact'; } catch { return true; }
}
