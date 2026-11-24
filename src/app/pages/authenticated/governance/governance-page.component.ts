import { Component, DestroyRef, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { GOV_TABS, GovTab, GovernanceStore } from './governance.store';
import { MODE_HINT, MODE_LABEL } from '../../../services/governance/governance.model';
import { GovPeriod, PERIODS } from '../../../services/governance/governance.logic';
import { GovOverviewComponent } from './tabs/gov-overview.component';
import { GovUsersComponent } from './tabs/gov-users.component';
import { GovCardsComponent } from './tabs/gov-cards.component';
import { GovTasksComponent } from './tabs/gov-tasks.component';

/**
 * Governança do PRMake (0098, admin): casca com as abas internas (aba na query `?aba=`), o filtro de período
 * compartilhado e o selo do modo global (desligada / monitorando / aplicando). Cada aba carrega só quando aberta.
 */
@Component({
  selector: 'app-governance-page',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatTooltipModule, GovOverviewComponent, GovUsersComponent, GovCardsComponent, GovTasksComponent],
  providers: [GovernanceStore],
  templateUrl: './governance-page.component.html',
  styleUrls: ['./governance-shared.css', './governance-page.component.css'],
})
export class GovernancePageComponent {
  readonly store = inject(GovernanceStore);
  private readonly route = inject(ActivatedRoute);

  readonly tabs = GOV_TABS;
  readonly periods = PERIODS;
  readonly current = computed(() => GOV_TABS.find((t) => t.key === this.store.tab()) ?? GOV_TABS[0]);
  readonly modeLabel = computed(() => {
    const m = this.store.mode();
    return m ? MODE_LABEL[m] : '…';
  });
  readonly modeHint = computed(() => {
    const m = this.store.mode();
    return m ? `Modo global: ${MODE_LABEL[m]}. ${MODE_HINT[m]} Clique para mudar.` : 'Lendo o modo global…';
  });

  constructor() {
    const sub = this.route.queryParamMap.subscribe((q) => {
      const aba = q.get('aba') as GovTab | null;
      this.store.tab.set(GOV_TABS.some((t) => t.key === aba) ? aba! : 'visao-geral');
      const card = Number(q.get('card'));
      this.store.selectedCard.set(Number.isInteger(card) && card > 0 ? card : null);
      this.store.selectedUser.set(q.get('usuario') || null);
    });
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
    this.store.loadSettings();
  }

  setTab(t: GovTab): void {
    if (t !== this.store.tab()) this.store.go(t);
  }

  setPeriod(p: GovPeriod): void {
    this.store.period.set(p);
  }
}
