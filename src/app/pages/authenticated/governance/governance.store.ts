import { Injectable, computed, inject, isDevMode, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { GovRange, GovernanceApi, GovernanceApiService } from '../../../services/governance/governance-api.service';
import { GovernanceDemoApi } from '../../../services/governance/governance.demo';
import { GovernanceEvent, GovernanceRule, GovernanceSettings, GovernanceUserRow, Standard } from '../../../services/governance/governance.model';
import { standardLookup } from '../../../services/governance/standards.logic';
import { GovEventDialogComponent, GovEventDialogResult } from './tabs/gov-event-dialog.component';
import { GovPeriod, dayKey, periodRange } from '../../../services/governance/governance.logic';

export type GovTab = 'visao-geral' | 'usuarios' | 'cards' | 'tarefas' | 'auditoria' | 'regras' | 'padroes' | 'licoes' | 'hooks' | 'configuracoes';

/** 0101: vistas da aba Padrões (na query `?vista=`). */
export type StandardsView = 'catalogo' | 'importar' | 'aderencia';
export const STANDARDS_VIEWS: { key: StandardsView; label: string; icon: string }[] = [
  { key: 'catalogo', label: 'Catálogo', icon: 'menu_book' },
  { key: 'importar', label: 'Importar', icon: 'cloud_download' },
  { key: 'aderencia', label: 'Aderência', icon: 'fact_check' },
];

export const GOV_TABS: { key: GovTab; label: string; icon: string; usesPeriod: boolean }[] = [
  { key: 'visao-geral', label: 'Visão geral', icon: 'dashboard', usesPeriod: true },
  { key: 'usuarios', label: 'Usuários', icon: 'group', usesPeriod: true },
  { key: 'cards', label: 'Cards', icon: 'view_agenda', usesPeriod: true },
  { key: 'tarefas', label: 'Tarefas', icon: 'checklist', usesPeriod: true },
  { key: 'auditoria', label: 'Auditoria', icon: 'manage_search', usesPeriod: true },
  { key: 'regras', label: 'Regras e guardrails', icon: 'gavel', usesPeriod: false },
  { key: 'padroes', label: 'Padrões', icon: 'rule', usesPeriod: false },
  // 0106: lições aprendidas com os erros dos agentes (e os sinais de erro em aberto).
  { key: 'licoes', label: 'Lições', icon: 'school', usesPeriod: false },
  { key: 'hooks', label: 'Hooks', icon: 'webhook', usesPeriod: false },
  { key: 'configuracoes', label: 'Configurações', icon: 'settings', usesPeriod: false },
];

/** Filtros da auditoria vindos de outra aba (ex.: "ver eventos deste card"). */
export interface AuditPreset {
  user?: string | null;
  card?: number | null;
  outcome?: string | null;
  action?: string | null;
  /** 0101: ex.: 'standard' (achados de padrões). */
  category?: string | null;
  /** 0101: texto livre (ex.: a chave do padrão). */
  search?: string | null;
}

/**
 * Estado compartilhado da área de Governança (0098): aba (na query `?aba=`), período, modo global, seleção (card,
 * usuário) e a fonte de dados — HTTP ou demonstração (`?exemplo=1` em desenvolvimento).
 */
@Injectable()
export class GovernanceStore {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(MatDialog);

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
  /** 0101: vista da aba Padrões e o padrão aberto (`?vista=` e `?padrao=`). */
  readonly standardsView = signal<StandardsView>('catalogo');
  readonly selectedStandard = signal<string | null>(null);

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
      queryParams: { aba: tab, card: null, usuario: null, vista: null, padrao: null, ...extra },
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

  /** 0101: aba Padrões numa vista (catálogo/importar/aderência), opcionalmente com um padrão aberto. */
  openStandards(view: StandardsView = 'catalogo', standardKey: string | null = null): void {
    this.go('padroes', { vista: view === 'catalogo' ? null : view, padrao: standardKey });
  }

  /** Seleção dentro da aba atual (sem empilhar histórico). */
  select(param: 'card' | 'usuario' | 'vista' | 'padrao', value: string | number | null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [param]: value },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Regras (para mostrar o nome das que dispararam); a aba de regras atualiza ao gravar. */
  readonly rules = signal<GovernanceRule[] | null>(null);

  ensureRules(): void {
    if (this.rules()) return;
    this.api.rules().subscribe({ next: (r) => this.rules.set(r), error: () => this.rules.set([]) });
  }

  ruleName(key: string): string {
    const rule = this.rules()?.find((r) => r.key === key);
    if (rule) return rule.name;
    const std = this.standardFinder()(key);
    return std ? `${std.code} · ${std.title}` : key;
  }

  /** 0101: padrões (catálogo) — a aba Padrões atualiza ao gravar/importar; as outras só leem para mostrar nomes. */
  readonly standards = signal<Standard[] | null>(null);
  private readonly standardFinder = computed(() => standardLookup(this.standards() ?? []));

  ensureStandards(): void {
    if (this.standards()) return;
    this.api.standards().subscribe({ next: (s) => this.standards.set(s ?? []), error: () => this.standards.set([]) });
  }

  findStandard(ref: string): Standard | null {
    return this.standardFinder()(ref);
  }

  /** Detalhe do evento; "Ver card"/"Ver pessoa" navegam para a aba certa. */
  showEvent(event: GovernanceEvent): void {
    this.ensureRules();
    this.ensureStandards();
    this.dialog
      .open<GovEventDialogComponent, unknown, GovEventDialogResult>(GovEventDialogComponent, {
        width: '720px', maxWidth: '96vw', maxHeight: '92vh', autoFocus: false,
        data: { event, rules: this.rules() ?? [], standards: this.standards() ?? [] },
      })
      .afterClosed()
      .subscribe((r) => {
        if (r?.go === 'card') this.openCard(r.card);
        if (r?.go === 'user') this.openUser(r.userId);
        if (r?.go === 'standard') this.openStandards('catalogo', r.key);
      });
  }

  userName(id: string | null | undefined): string {
    if (!id) return '—';
    return this.userOptions().find((u) => u.id === id)?.name ?? id;
  }
}
