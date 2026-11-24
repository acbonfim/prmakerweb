import { Injectable, computed, inject, isDevMode, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { GovRange, GovernanceApi, GovernanceApiService } from '../../../services/governance/governance-api.service';
import { GovernanceDemoApi } from '../../../services/governance/governance.demo';
import { GovernanceSettings, GovernanceUserRow } from '../../../services/governance/governance.model';
import { GovPeriod, dayKey, periodRange } from '../../../services/governance/governance.logic';

export type GovTab = 'visao-geral' | 'usuarios' | 'cards' | 'tarefas' | 'auditoria' | 'regras' | 'hooks' | 'configuracoes';

export const GOV_TABS: { key: GovTab; label: string; icon: string; usesPeriod: boolean }[] = [
  { key: 'visao-geral', label: 'Visão geral', icon: 'dashboard', usesPeriod: true },
  { key: 'usuarios', label: 'Usuários', icon: 'group', usesPeriod: true },
  { key: 'cards', label: 'Cards', icon: 'view_agenda', usesPeriod: true },
  { key: 'tarefas', label: 'Tarefas', icon: 'checklist', usesPeriod: true },
  { key: 'auditoria', label: 'Auditoria', icon: 'manage_search', usesPeriod: true },
  { key: 'regras', label: 'Regras e guardrails', icon: 'gavel', usesPeriod: false },
  { key: 'hooks', label: 'Hooks', icon: 'webhook', usesPeriod: false },
  { key: 'configuracoes', label: 'Configurações', icon: 'settings', usesPeriod: false },
];

/** Filtros da auditoria vindos de outra aba (ex.: "ver eventos deste card"). */
export interface AuditPreset {
  user?: string | null;
  card?: number | null;
  outcome?: string | null;
  action?: string | null;
}

/**
 * Estado compartilhado da área de Governança (0098): aba (na query `?aba=`), período, modo global, seleção (card,
 * usuário) e a fonte de dados — HTTP ou demonstração (`?exemplo=1` em desenvolvimento).
 */
@Injectable()
export class GovernanceStore {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly demo = isDevMode() && this.route.snapshot.queryParamMap.get('exemplo') === '1';
  readonly api: GovernanceApi = this.demo ? new GovernanceDemoApi() : inject(GovernanceApiService);

  readonly tab = signal<GovTab>('visao-geral');
  readonly period = signal<GovPeriod>('7');
  readonly customFrom = signal(dayKey(new Date(Date.now() - 6 * 86_400_000)));
  readonly customTo = signal(dayKey(new Date()));
  /** Sobe a cada "Atualizar" (as abas recarregam). */
  readonly refreshTick = signal(0);

  readonly range = computed<GovRange>(() => {
    this.refreshTick();
    const { from, to } = periodRange(this.period(), this.customFrom(), this.customTo());
    return { from: from.toISOString(), to: to.toISOString() };
  });
  readonly rangeDates = computed(() => ({ from: new Date(this.range().from), to: new Date(this.range().to) }));

  readonly settings = signal<GovernanceSettings | null>(null);
  readonly settingsError = signal<string | null>(null);
  readonly mode = computed(() => this.settings()?.mode ?? null);

  /** Usuários do período (opções dos filtros). */
  readonly userOptions = signal<{ id: string; name: string }[]>([]);

  readonly selectedCard = signal<number | null>(null);
  readonly selectedUser = signal<string | null>(null);
  readonly auditPreset = signal<AuditPreset | null>(null);

  loadSettings(): void {
    this.api.settings().subscribe({
      next: (s) => {
        this.settings.set(s);
        this.settingsError.set(null);
      },
      error: () => this.settingsError.set('Não consegui ler as configurações da governança.'),
    });
  }

  refresh(): void {
    this.refreshTick.update((n) => n + 1);
    this.loadSettings();
  }

  /** Junta usuários conhecidos (o filtro não perde opções ao trocar de período). */
  mergeUsers(rows: Pick<GovernanceUserRow, 'userId' | 'userName'>[]): void {
    const m = new Map(this.userOptions().map((u) => [u.id, u]));
    for (const r of rows) if (r.userId) m.set(r.userId, { id: r.userId, name: r.userName || r.userId });
    this.userOptions.set([...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
  }

  // ---- navegação (a URL guarda aba e seleção) ----

  go(tab: GovTab, extra: Record<string, string | number | null> = {}): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { aba: tab, card: null, usuario: null, ...extra },
      queryParamsHandling: 'merge',
      replaceUrl: false,
    });
  }

  openCard(card: number): void {
    this.go('cards', { card });
  }

  openUser(userId: string): void {
    this.go('usuarios', { usuario: userId });
  }

  openAudit(preset: AuditPreset): void {
    this.auditPreset.set(preset);
    this.go('auditoria');
  }

  /** Seleção dentro da aba atual (sem empilhar histórico). */
  select(param: 'card' | 'usuario', value: string | number | null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [param]: value },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  userName(id: string | null | undefined): string {
    if (!id) return '—';
    return this.userOptions().find((u) => u.id === id)?.name ?? id;
  }
}
