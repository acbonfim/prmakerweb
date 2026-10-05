import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject } from '@angular/core';
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

/**
 * Faixa de abas internas (0065), logo abaixo do topbar. Fina de propósito (a tela de PR precisa da altura):
 * número do card e indicadores não encolhem; o título cede com reticências. Amarela = plano aguardando o usuário.
 */
@Component({
  selector: 'app-tab-bar',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule],
  templateUrl: './tab-bar.component.html',
  styleUrls: ['./tab-bar.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabBarComponent implements OnInit, OnDestroy {
  readonly tabs = inject(TabsService);
  private readonly cardInfo = inject(TabCardInfoService);
  private readonly pending = inject(UserPendingService);
  private readonly dialog = inject(MatDialog);

  ngOnInit(): void {
    this.cardInfo.start();
  }

  ngOnDestroy(): void {
    this.cardInfo.stop();
  }

  infoOf(tab: Tab): CardTabInfo | null {
    return tab.card ? this.cardInfo.info().get(tab.card) ?? null : null;
  }

  /** "#75294" fica fixo; o resto (título) é o que trunca. */
  titleOf(tab: Tab): string {
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
    lines.push(tab.card ? `#${tab.card} · ${this.titleOf(tab)}` : tab.title);
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
