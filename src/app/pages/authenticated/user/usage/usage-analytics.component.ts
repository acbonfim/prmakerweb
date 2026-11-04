import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { PresenceBadgeComponent } from '../../../../components/presence-badge/presence-badge.component';
import { BarDatum, BarSeries, UsageBarsComponent, UsageHBarsComponent, UsageHeatmapComponent } from '../../../../components/usage-charts/usage-charts';
import { UserAvatarComponent } from '../../../../components/user-avatar/user-avatar.component';
import { PresenceService, UserPresence } from '../../../../services/usage/presence.service';
import { UsageApiService, UsageFilter } from '../../../../services/usage/usage-api.service';
import {
  EVENT_KIND_LABEL, LOGIN_REASON_LABEL, PRESENCE_LABEL, UsageEventItem, UsageEventKind, UsageLoginItem, UsageNamedCount, UsageSessionItem,
  UsageSummary, UsageUserStat, formatAgo, formatDateTime, formatDuration,
} from '../../../../services/usage/usage.model';
import { UserSessionDialogComponent } from '../dialogs/user-session-dialog.component';

type Period = '1' | '7' | '30' | '90' | 'custom';
type TableTab = 'logins' | 'sessions' | 'events';
type UserSort = keyof Pick<UsageUserStat, 'userName' | 'sessions' | 'logins' | 'foregroundMs' | 'views' | 'actions' | 'errors' | 'lastSeenAt'>;

const PAGE_SIZE = 20;
const SERIES_BLUE = '#3987e5';
const STATUS_FAIL = '#d03b3b';

/**
 * Análise de uso (0079, admin): quem está online agora, indicadores, gráficos e tabelas de logins, sessões e eventos.
 * Tudo sob demanda (só ao abrir/filtrar); a agregação é feita no banco pela API.
 */
@Component({
  selector: 'app-usage-analytics',
  standalone: true,
  imports: [
    FormsModule, RouterLink, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule,
    UsageBarsComponent, UsageHBarsComponent, UsageHeatmapComponent, PresenceBadgeComponent, UserAvatarComponent,
  ],
  templateUrl: './usage-analytics.component.html',
  styleUrls: ['./usage-analytics.component.css'],
})
export class UsageAnalyticsComponent implements OnInit, OnDestroy {
  private readonly api = inject(UsageApiService);
  private readonly dialog = inject(MatDialog);
  readonly presence = inject(PresenceService);
  private readonly unwatch = this.presence.watch();

  // ---- filtros ----
  readonly period = signal<Period>('7');
  readonly customFrom = signal(this.dateInput(new Date(Date.now() - 6 * 86_400_000)));
  readonly customTo = signal(this.dateInput(new Date()));
  readonly user = signal<string>('');
  readonly screen = signal<string>('');
  readonly kind = signal<string>('');

  readonly periods: { key: Period; label: string }[] = [
    { key: '1', label: '24 h' }, { key: '7', label: '7 dias' }, { key: '30', label: '30 dias' }, { key: '90', label: '90 dias' },
    { key: 'custom', label: 'Personalizado' },
  ];
  readonly kinds = (Object.keys(EVENT_KIND_LABEL) as UsageEventKind[]).map((k) => ({ key: k, label: EVENT_KIND_LABEL[k] }));

  // ---- dados ----
  readonly summary = signal<UsageSummary | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Opções de usuário/tela acumuladas (o filtro por usuário não pode sumir com as outras opções). */
  readonly userOptions = signal<{ id: string; name: string }[]>([]);
  readonly screenOptions = signal<string[]>([]);

  readonly tab = signal<TableTab>('sessions');
  readonly logins = signal<UsageLoginItem[]>([]);
  readonly sessions = signal<UsageSessionItem[]>([]);
  readonly events = signal<UsageEventItem[]>([]);
  readonly tableTotal = signal(0);
  readonly tablePage = signal(0);
  readonly tableLoading = signal(false);
  readonly loginSuccess = signal<'' | 'true' | 'false'>('');
  readonly eventSearch = signal('');
  readonly sessionFilter = signal<string | null>(null);

  readonly userSort = signal<{ key: UserSort; dir: 1 | -1 }>({ key: 'foregroundMs', dir: -1 });

  // ---- derivados ----
  readonly kpis = computed(() => this.summary()?.kpis ?? null);
  readonly avgSessionMs = computed(() => {
    const k = this.kpis();
    return k ? (k.avgSessionMs ?? (k.avgSessionMinutes != null ? k.avgSessionMinutes * 60_000 : 0)) : 0;
  });

  readonly dayKeys = computed(() => {
    const { from, to } = this.range();
    const out: string[] = [];
    const d = new Date(from);
    d.setHours(0, 0, 0, 0);
    const end = new Date(to);
    while (d <= end && out.length < 400) {
      out.push(this.dayKey(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  });

  private readonly daysByKey = computed(() => new Map((this.summary()?.days ?? []).map((d) => [d.day.slice(0, 10), d])));

  readonly activeUsersBars = computed<BarDatum[]>(() =>
    this.dayKeys().map((k) => ({ label: this.shortDay(k), title: this.longDay(k), values: [this.daysByKey().get(k)?.activeUsers ?? 0] })));
  readonly activeUsersSeries: BarSeries[] = [{ name: 'Usuários ativos', color: SERIES_BLUE }];

  readonly loginBars = computed<BarDatum[]>(() =>
    this.dayKeys().map((k) => {
      const d = this.daysByKey().get(k);
      // `logins` = com sucesso; `failedLogins` à parte.
      return { label: this.shortDay(k), title: this.longDay(k), values: [d?.logins ?? 0, d?.failedLogins ?? 0] };
    }));
  readonly loginSeries: BarSeries[] = [{ name: 'Sucesso', color: SERIES_BLUE }, { name: 'Falha', color: STATUS_FAIL }];

  readonly screenBars = computed(() => (this.summary()?.screens ?? []).map((s) => {
    const ms = s.durationMs ?? s.foregroundMs ?? 0;
    return {
      label: s.screen || '—', value: s.views, text: `${s.views} · ${formatDuration(ms)}`,
      tip: `${s.views} visitas · ${formatDuration(ms)} em primeiro plano · ${s.users} usuários`,
    };
  }));
  readonly screenTimeBars = computed(() => (this.summary()?.screens ?? []).map((s) => {
    const ms = s.durationMs ?? s.foregroundMs ?? 0;
    return { label: s.screen || '—', value: ms, text: formatDuration(ms) };
  }));
  readonly actionBars = computed(() => (this.summary()?.actions ?? []).map((a) => ({
    label: a.name, value: a.count, text: `${a.count}`, tip: `${a.count} vezes · ${a.users} usuários${a.screen ? ' · ' + a.screen : ''}`,
  })));
  readonly errorBars = computed(() => (this.summary()?.errors ?? []).map((e) => ({
    label: `${e.name}${e.status ? ` (${e.status})` : ''}`, value: e.count,
  })));
  readonly browserBars = computed(() => this.clientBars(this.summary()?.clients?.browsers));
  readonly osBars = computed(() => this.clientBars(this.summary()?.clients?.os));
  readonly deviceBars = computed(() => this.clientBars(this.summary()?.clients?.devices));

  private clientBars(list: UsageNamedCount[] | null | undefined) {
    return (list ?? []).map((c) => {
      const value = c.sessions ?? c.count ?? 0;
      return { label: c.name || '—', value, tip: `${value} sessões${c.users != null ? ` · ${c.users} usuários` : ''}` };
    });
  }

  readonly sortedUsers = computed(() => {
    const { key, dir } = this.userSort();
    return [...(this.summary()?.users ?? [])].sort((a, b) => {
      const va = a[key] ?? '';
      const vb = b[key] ?? '';
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return `${va}`.localeCompare(`${vb}`) * dir;
    });
  });

  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.tableTotal() / PAGE_SIZE)));

  ngOnInit(): void {
    this.reload();
  }

  ngOnDestroy(): void {
    this.unwatch();
  }

  // ---- ações ----

  setPeriod(p: Period): void {
    this.period.set(p);
    if (p !== 'custom') this.reload();
  }

  applyCustom(): void {
    if (this.period() === 'custom') this.reload();
  }

  setUser(v: string): void {
    this.user.set(v);
    this.reload();
  }

  setScreen(v: string): void {
    this.screen.set(v);
    this.reload();
  }

  setKind(v: string): void {
    this.kind.set(v);
    this.tab.set('events');
    this.loadTable(0);
  }

  clearFilters(): void {
    this.user.set('');
    this.screen.set('');
    this.kind.set('');
    this.sessionFilter.set(null);
    this.eventSearch.set('');
    this.loginSuccess.set('');
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.summary(this.filter()).subscribe({
      next: (s) => {
        this.summary.set(s);
        this.mergeOptions(s);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Não consegui carregar a análise de uso.');
      },
    });
    this.loadTable(0);
  }

  setTab(t: TableTab): void {
    this.tab.set(t);
    this.loadTable(0);
  }

  openSessionEvents(s: UsageSessionItem): void {
    this.sessionFilter.set(s.id);
    this.tab.set('events');
    this.loadTable(0);
  }

  clearSessionFilter(): void {
    this.sessionFilter.set(null);
    this.loadTable(0);
  }

  page(delta: number): void {
    const next = Math.min(this.pageCount() - 1, Math.max(0, this.tablePage() + delta));
    if (next !== this.tablePage()) this.loadTable(next);
  }

  sortUsers(key: UserSort): void {
    this.userSort.update((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === 'userName' ? 1 : -1 }));
  }

  sortMark(key: UserSort): string {
    const s = this.userSort();
    return s.key === key ? (s.dir === 1 ? '▲' : '▼') : '';
  }

  openUser(id: string | null, name: string): void {
    if (!id) return;
    this.dialog.open(UserSessionDialogComponent, {
      width: '960px', maxWidth: '96vw', maxHeight: '92vh', autoFocus: false,
      data: { user: { externalId: id, fullName: name } },
    });
  }

  openPresence(p: UserPresence): void {
    this.openUser(p.userId, p.name);
  }

  // ---- tabelas ----

  loadTable(page: number): void {
    this.tablePage.set(page);
    this.tableLoading.set(true);
    const f: UsageFilter = { ...this.filter(), page, size: PAGE_SIZE };
    const tab = this.tab();
    const done = () => this.tableLoading.set(false);
    if (tab === 'logins') {
      this.api.logins({ ...f, success: this.loginSuccess() === '' ? null : this.loginSuccess() === 'true' })
        .pipe(catchError(() => of({ items: [], total: 0 })))
        .subscribe((r) => { this.logins.set(r.items ?? []); this.tableTotal.set(r.total ?? 0); done(); });
    } else if (tab === 'sessions') {
      this.api.sessions(f).pipe(catchError(() => of({ items: [], total: 0 })))
        .subscribe((r) => { this.sessions.set(r.items ?? []); this.tableTotal.set(r.total ?? 0); done(); });
    } else {
      this.api.events({ ...f, kind: this.kind() || null, session: this.sessionFilter(), search: this.eventSearch() || null })
        .pipe(catchError(() => of({ items: [], total: 0 })))
        .subscribe((r) => { this.events.set(r.items ?? []); this.tableTotal.set(r.total ?? 0); done(); });
    }
  }

  // ---- utilitários ----

  private filter(): UsageFilter {
    const { from, to } = this.range();
    return { from: from.toISOString(), to: to.toISOString(), user: this.user() || null, screen: this.screen() || null };
  }

  private range(): { from: Date; to: Date } {
    const p = this.period();
    if (p === 'custom') {
      const from = new Date(`${this.customFrom()}T00:00:00`);
      const to = new Date(`${this.customTo()}T23:59:59`);
      if (Number.isFinite(from.getTime()) && Number.isFinite(to.getTime()) && from <= to) return { from, to };
    }
    const days = p === 'custom' ? 7 : Number(p);
    const to = new Date();
    return { from: new Date(to.getTime() - days * 86_400_000), to };
  }

  private mergeOptions(s: UsageSummary): void {
    const users = new Map(this.userOptions().map((u) => [u.id, u]));
    for (const u of s.users ?? []) if (u.userExternalId) users.set(u.userExternalId, { id: u.userExternalId, name: u.userName || u.userExternalId });
    this.userOptions.set([...users.values()].sort((a, b) => a.name.localeCompare(b.name)));
    const screens = new Set(this.screenOptions());
    for (const sc of s.screens ?? []) if (sc.screen) screens.add(sc.screen);
    this.screenOptions.set([...screens].sort((a, b) => a.localeCompare(b)));
  }

  private dateInput(d: Date): string {
    return this.dayKey(d);
  }

  private dayKey(d: Date): string {
    const y = d.getFullYear();
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private shortDay(k: string): string {
    return `${k.slice(8, 10)}/${k.slice(5, 7)}`;
  }

  private longDay(k: string): string {
    const d = new Date(`${k}T12:00:00`);
    return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
  }

  stateLabel(p: UserPresence): string {
    return PRESENCE_LABEL[p.state];
  }

  reason(r: string | null, ok: boolean): string {
    return LOGIN_REASON_LABEL[r ?? (ok ? 'ok' : 'error')] ?? r ?? '';
  }

  kindLabel(k: string): string {
    return (EVENT_KIND_LABEL as Record<string, string>)[k] ?? k;
  }

  ago(iso: string | null | undefined): string {
    return formatAgo(iso, this.presence.now());
  }

  num(v: number | null | undefined): string {
    return new Intl.NumberFormat('pt-BR').format(v ?? 0);
  }

  dt = formatDateTime;
  dur = formatDuration;
}
