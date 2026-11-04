import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { UserAvatarComponent } from '../../../../components/user-avatar/user-avatar.component';
import { PresenceBadgeComponent } from '../../../../components/presence-badge/presence-badge.component';
import { PresenceService } from '../../../../services/usage/presence.service';
import { UsageApiService } from '../../../../services/usage/usage-api.service';
import {
  EVENT_KIND_LABEL, LOGIN_REASON_LABEL, PRESENCE_LABEL, PresenceEntry, UsageUserDetail,
  formatAgo, formatDateTime, formatDuration, parseApiDate,
} from '../../../../services/usage/usage.model';

export interface UserSessionDialogData {
  user: { externalId: string; fullName?: string; userName?: string; imagemUrlUser?: string | null; email?: string };
  lastSeen?: string | null;
}

/** Sessão do usuário (0079): abas abertas ao vivo + últimos logins, sessões e o caminho recente. */
@Component({
  selector: 'app-user-session-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, UserAvatarComponent, PresenceBadgeComponent],
  template: `
    <h2 mat-dialog-title class="sd-title">
      <app-user-avatar [name]="data.user.fullName || data.user.userName || ''" [imageUrl]="data.user.imagemUrlUser" [size]="36"></app-user-avatar>
      <span class="sd-title__text">
        <span>{{ data.user.fullName || data.user.userName }}</span>
        <app-presence-badge [presence]="presence()" [lastSeen]="data.lastSeen ?? null"></app-presence-badge>
      </span>
    </h2>

    <mat-dialog-content class="sd">
      <section>
        <h3>Agora <span class="muted">· ao vivo</span></h3>
        @if (!presence()) {
          <p class="muted">Sem abas abertas no momento{{ data.lastSeen ? ' · visto ' + ago(data.lastSeen) : '' }}.</p>
        } @else {
          <div class="tabs">
            @for (e of presence()!.entries; track e.connectionId; let i = $index) {
              <div class="tab">
                <div class="tab__head">
                  <span class="state state--{{ e.state ?? 'active' }}">{{ stateLabel(e) }}</span>
                  <strong>{{ e.screen || 'Tela desconhecida' }}</strong>
                  @if (e.card) { <span class="chip">card {{ e.card }}</span> }
                  <span class="muted ms-auto">aba {{ i + 1 }}</span>
                </div>
                @if (e.busy) { <div class="busy"><mat-icon>autorenew</mat-icon>{{ e.busy }}</div> }
                <dl class="facts">
                  <div><dt>Última interação</dt><dd>{{ ago(e.lastInputAt) }}</dd></div>
                  <div><dt>No estado desde</dt><dd>{{ ago(e.since) }}</dd></div>
                  <div><dt>Conectado desde</dt><dd>{{ dt(e.connectedAt) }}</dd></div>
                  <div><dt>Sessão iniciada</dt><dd>{{ dt(e.startedAt) }}</dd></div>
                  <div><dt>Aba</dt><dd>{{ e.visible ? 'Visível' : 'Oculta' }}{{ e.focused ? ' · com foco' : '' }}</dd></div>
                  <div><dt>IP</dt><dd class="mono">{{ e.ip || '—' }}</dd></div>
                  <div><dt>Navegador</dt><dd>{{ e.client?.browser || '—' }}</dd></div>
                  <div><dt>Sistema</dt><dd>{{ e.client?.os || '—' }}</dd></div>
                  <div><dt>Dispositivo</dt><dd>{{ e.client?.device || '—' }}</dd></div>
                  <div><dt>Tela</dt><dd>{{ e.client?.screenSize || '—' }}</dd></div>
                  <div><dt>Idioma</dt><dd>{{ e.client?.language || '—' }}</dd></div>
                  <div><dt>Fuso</dt><dd>{{ e.client?.timeZone || '—' }}</dd></div>
                  <div><dt>Versão do app</dt><dd class="mono">{{ e.client?.appVersion || '—' }}</dd></div>
                  <div><dt>Rota</dt><dd class="mono">{{ e.route || '—' }}</dd></div>
                </dl>
                @if (e.userAgent) { <div class="ua mono" [matTooltip]="e.userAgent">{{ e.userAgent }}</div> }
              </div>
            }
          </div>
        }
      </section>

      @if (loading()) {
        <div class="center"><mat-spinner diameter="28"></mat-spinner></div>
      } @else if (error()) {
        <p class="muted">{{ error() }}</p>
      } @else if (detail(); as d) {
        <section>
          <h3>Últimos 30 dias</h3>
          <div class="totals">
            <div><b>{{ d.totals?.sessions ?? (d.sessions?.length ?? 0) }}</b><span>sessões</span></div>
            <div><b>{{ d.totals?.logins ?? (d.logins?.length ?? 0) }}</b><span>{{ d.totals?.logins == null ? 'logins recentes' : 'logins' }}</span></div>
            <div><b>{{ dur(d.totals?.foregroundMs) }}</b><span>em primeiro plano</span></div>
            <div><b>{{ d.totals?.views ?? 0 }}</b><span>telas</span></div>
            <div><b>{{ d.totals?.actions ?? 0 }}</b><span>ações</span></div>
            <div><b>{{ d.totals?.errors ?? errorCount() }}</b><span>erros{{ d.totals?.errors == null ? ' recentes' : '' }}</span></div>
          </div>
        </section>

        <section>
          <h3>Últimos logins</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Quando</th><th>Resultado</th><th>IP</th><th>Navegador</th></tr></thead>
              <tbody>
                @for (l of d.logins ?? []; track l.id) {
                  <tr>
                    <td>{{ dt(l.at) }}</td>
                    <td><span class="res" [class.res--fail]="!l.success">{{ l.success ? '✓' : '✕' }} {{ reason(l.reason, l.success) }}</span></td>
                    <td class="mono">{{ l.ip || '—' }}</td>
                    <td class="ua-cell" [matTooltip]="l.userAgent || ''">{{ l.userAgent || '—' }}</td>
                  </tr>
                } @empty { <tr><td colspan="4" class="muted">Nenhum login no período.</td></tr> }
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3>Sessões</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Início</th><th>Última atividade</th><th>1º plano</th><th>2º plano</th><th>Ausente</th><th>Telas</th><th>Ações</th><th>IP</th><th>Navegador / sistema</th></tr></thead>
              <tbody>
                @for (s of d.sessions ?? []; track s.id) {
                  <tr [class.sel]="selectedSession() === s.id" (click)="toggleSession(s.id)" class="clickable">
                    <td>{{ dt(s.startedAt) }}</td>
                    <td>{{ ago(s.lastSeenAt) }}</td>
                    <td>{{ dur(s.foregroundMs) }}</td>
                    <td>{{ dur(s.backgroundMs) }}</td>
                    <td>{{ dur(s.awayMs) }}</td>
                    <td class="num">{{ s.views }}</td>
                    <td class="num">{{ s.actions }}</td>
                    <td class="mono">{{ s.ip || '—' }}</td>
                    <td>{{ s.browser || '—' }} · {{ s.os || '—' }} · {{ s.device || '—' }}</td>
                  </tr>
                } @empty { <tr><td colspan="9" class="muted">Nenhuma sessão no período.</td></tr> }
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3>Caminho recente {{ selectedSession() ? '· sessão selecionada' : '' }}</h3>
          <ol class="path">
            @for (e of pathEvents(); track e.id) {
              <li class="path__item path__item--{{ e.kind }}">
                <span class="path__time">{{ dt(e.at) }}</span>
                <span class="path__kind">{{ kind(e.kind) }}</span>
                <span class="path__name">{{ e.name }}</span>
                @if (e.screen && e.kind !== 'view') { <span class="muted">· {{ e.screen }}</span> }
                @if (e.card) { <span class="chip">card {{ e.card }}</span> }
                @if (e.durationMs) { <span class="muted">· {{ dur(e.durationMs) }}</span> }
                @if (e.status) { <span class="muted">· {{ e.status }}</span> }
              </li>
            } @empty { <li class="muted">Sem eventos.</li> }
          </ol>
        </section>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Fechar</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .sd-title { display: flex; align-items: center; gap: 12px; }
    .sd-title__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; font-size: 18px; }
    .sd { display: flex; flex-direction: column; gap: 18px; color: var(--cc-text-1); }
    h3 { font-size: 14px; font-weight: 600; margin: 0 0 8px; }
    .muted { color: var(--cc-text-3); font-size: 12px; }
    .ms-auto { margin-left: auto; }
    .center { display: flex; justify-content: center; padding: 16px; }
    .tabs { display: flex; flex-direction: column; gap: 10px; }
    .tab { border: 1px solid var(--cc-surface-border); border-radius: 10px; padding: 10px 12px; background: var(--surface-2); }
    .tab__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .state { font-size: 11px; padding: 1px 8px; border-radius: 10px; border: 1px solid currentColor; }
    .state--active { color: #3fb950; } .state--busy { color: #58a6ff; } .state--background { color: #8b949e; } .state--away { color: #d29922; }
    .busy { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #58a6ff; margin-top: 6px; }
    .busy mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 6px 14px; margin: 10px 0 0; }
    .facts div { min-width: 0; }
    dt { font-size: 11px; color: var(--cc-text-3); }
    dd { margin: 0; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
    .ua { margin-top: 8px; color: var(--cc-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chip { font-size: 11px; padding: 1px 7px; border-radius: 9px; background: color-mix(in srgb, var(--mat-sys-primary) 18%, transparent); }
    .totals { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; }
    .totals div { display: flex; flex-direction: column; padding: 8px 10px; border-radius: 8px; background: var(--surface-2); }
    .totals b { font-size: 18px; font-weight: 600; }
    .totals span { font-size: 11px; color: var(--cc-text-3); }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    th { text-align: left; font-weight: 500; color: var(--cc-text-3); font-size: 11px; padding: 4px 8px; border-bottom: 1px solid var(--cc-surface-border); white-space: nowrap; }
    td { padding: 5px 8px; border-bottom: 1px solid var(--cc-surface-border); white-space: nowrap; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .ua-cell { max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
    tr.clickable { cursor: pointer; }
    tr.clickable:hover td { background: color-mix(in srgb, var(--mat-sys-on-surface) 5%, transparent); }
    tr.sel td { background: color-mix(in srgb, var(--mat-sys-primary) 14%, transparent); }
    .res { color: #3fb950; } .res--fail { color: #f85149; }
    .path { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; max-height: 320px; overflow: auto; }
    .path__item { display: flex; gap: 8px; align-items: baseline; font-size: 12.5px; padding: 3px 0; border-bottom: 1px dashed transparent; flex-wrap: wrap; }
    .path__time { color: var(--cc-text-3); font-size: 11px; min-width: 104px; font-variant-numeric: tabular-nums; }
    .path__kind { font-size: 11px; min-width: 48px; color: var(--cc-text-2); }
    .path__item--error .path__kind { color: #f85149; }
    .path__item--view .path__name { font-weight: 600; }
  `],
})
export class UserSessionDialogComponent implements OnDestroy {
  readonly data = inject<UserSessionDialogData>(MAT_DIALOG_DATA);
  private readonly presenceService = inject(PresenceService);
  private readonly api = inject(UsageApiService);
  private readonly unwatch = this.presenceService.watch();

  readonly presence = computed(() => this.presenceService.for(this.data.user.externalId));
  readonly detail = signal<UsageUserDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly selectedSession = signal<string | null>(null);

  readonly errorCount = computed(() => (this.detail()?.events ?? []).filter((e) => e.kind === 'error').length);

  readonly pathEvents = computed(() => {
    const events = this.detail()?.events ?? [];
    const s = this.selectedSession();
    return s ? events.filter((e) => e.sessionId === s) : events;
  });

  constructor() {
    this.api.user(this.data.user.externalId).subscribe({
      next: (d) => {
        this.detail.set(d);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Não consegui carregar o histórico de uso.');
        this.loading.set(false);
      },
    });
  }

  ngOnDestroy(): void {
    this.unwatch();
  }

  toggleSession(id: string): void {
    this.selectedSession.update((s) => (s === id ? null : id));
  }

  stateLabel(e: PresenceEntry): string {
    return PRESENCE_LABEL[e.state ?? 'active'];
  }

  reason(r: string | null, ok: boolean): string {
    return LOGIN_REASON_LABEL[r ?? (ok ? 'ok' : 'error')] ?? r ?? '';
  }

  kind(k: string): string {
    return (EVENT_KIND_LABEL as Record<string, string>)[k] ?? k;
  }

  ago(iso: string | null | undefined): string {
    return parseApiDate(iso) ? formatAgo(iso, this.presenceService.now()) : '—';
  }

  dt = formatDateTime;
  dur = formatDuration;
}
