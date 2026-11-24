import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription } from 'rxjs';
import { EpicsService, epicApiError } from '../../services/epics.service';
import { WsService } from '../../services/ws.service';
import { devOpsTypeColor } from './epic.logic';
import {
  EpicMonitorCard, EpicMonitorEnv, EpicMonitorPr, MONITOR_LEGEND, envBadge, envRow, environmentOrder, prLook, prName,
  snapshotLabel, summarizeMonitor, summaryText, touchesCards
} from './epic-monitor.logic';

/**
 * 0099 (ajustes 2): visão **Acompanhamento** da aba Cards da Mesa — por card do épico, estado/coluna, os PRs (status e
 * branch de destino, do registro do PRMake) e os ambientes como selos (retrato da AWS gravado pela máquina). Pensada para
 * o PO / gestor de problemas, que não tem git nem AWS na máquina: tudo vem do PRMake (`GET Epics/{n}/monitor`).
 * Atualiza sozinha no `epicsUpdated` do épico e no `devopsCardsUpdated` de um card dele.
 */
@Component({
  selector: 'app-epic-monitor',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mon__head">
      <span class="mon__summary" data-testid="monitor-summary">{{ summary() }}</span>
      <span class="mon__spacer"></span>
      @if (loadedAt(); as at) { <span class="mon__faint" matTooltip="Última leitura do acompanhamento">lido às {{ at }}</span> }
      <button mat-icon-button type="button" (click)="reload()" [disabled]="loading()" matTooltip="Atualizar o acompanhamento" aria-label="Atualizar o acompanhamento">
        <mat-icon>refresh</mat-icon>
      </button>
    </div>
    @if (loading()) { <mat-progress-bar mode="indeterminate" class="mon__bar"></mat-progress-bar> }
    @if (error(); as err) {
      <div class="mon__error" role="alert"><mat-icon>error_outline</mat-icon><span>{{ err }}</span>
        <button mat-button type="button" (click)="reload()">Tentar de novo</button></div>
    }

    @if (!rows().length && !loading() && !error()) {
      <p class="mon__empty">Nenhum card neste épico para acompanhar.</p>
    } @else {
      <ul class="mon__list">
        @for (c of rows(); track c.card) {
          <li class="mon__row" [style.--ct]="typeColor(c.type)">
            <span class="mon__typebar" aria-hidden="true"></span>
            <div class="mon__body">
              <button type="button" class="mon__title" (click)="openCard.emit('' + c.card)" [attr.aria-label]="'Abrir o card ' + c.card">
                @if (c.type) { <span class="mon__type">{{ c.type }}</span> }
                <span class="mon__id">#{{ c.card }}</span>
                <span class="mon__text">{{ c.title || 'Card ' + c.card }}</span>
              </button>
              <div class="mon__meta">
                @if (c.state) { <span class="mon__state" matTooltip="Estado no DevOps">{{ c.state }}</span> }
                @if (c.column && c.column !== c.state) { <span matTooltip="Coluna do board"><mat-icon>view_week</mat-icon>{{ c.column }}</span> }
                @if (c.assignedTo) { <span matTooltip="Responsável"><mat-icon>person</mat-icon>{{ c.assignedTo }}</span> }
                @if (c.url) { <a class="mon__devops" [href]="c.url" target="_blank" rel="noopener" matTooltip="Abrir no DevOps"><mat-icon>open_in_new</mat-icon>DevOps</a> }
              </div>

              <div class="mon__line">
                <span class="mon__label">PRs</span>
                @if (c.prs?.length) {
                  @for (p of c.prs; track $index) {
                    @let pl = look(p);
                    <a class="mon__pr mon__tone--{{ pl.tone }}" [attr.href]="p.url || null" target="_blank" rel="noopener"
                       [matTooltip]="prTooltip(p)" matTooltipShowDelay="300">
                      <mat-icon>{{ pl.icon }}</mat-icon>
                      <span class="mon__prname">{{ name(p) }}</span>
                      <span class="mon__prstatus">{{ pl.label }}</span>
                      @if (p.targetBranch) { <span class="mon__branch">→ {{ p.targetBranch }}</span> }
                    </a>
                  }
                } @else {
                  <span class="mon__faint">nenhum PR registrado no PRMake</span>
                }
              </div>

              <div class="mon__line">
                <span class="mon__label">Ambientes</span>
                @if (envs(c); as list) {
                  @for (e of list; track e.name) {
                    @let b = badge(e);
                    <span class="mon__env mon__tone--{{ b.tone }}" [matTooltip]="envTooltip(e)" matTooltipShowDelay="200"
                          [attr.aria-label]="e.name + ': ' + b.label">
                      <span class="mon__sym" aria-hidden="true">{{ b.symbol }}</span>{{ e.name }}
                    </span>
                  }
                  @if (snapshot(c.awsCollectedAt); as s) {
                    <span class="mon__faint mon__snap" [matTooltip]="c.awsCollectedBy ? 'coletado por ' + c.awsCollectedBy : ''">{{ s }}</span>
                  }
                } @else {
                  <span class="mon__env mon__tone--none" matTooltip="A máquina ainda não gravou o retrato da AWS deste card (aba AWS da Bancada ou sub-tarefa aws-deploy-map)">
                    <span class="mon__sym" aria-hidden="true">—</span>sem retrato da AWS
                  </span>
                }
              </div>
            </div>
          </li>
        }
      </ul>
    }

    <div class="mon__legend" aria-label="Legenda">
      <span class="mon__legend-title">Legenda:</span>
      @for (l of legend; track l.symbol) {
        <span class="mon__env mon__tone--{{ l.tone }}"><span class="mon__sym" aria-hidden="true">{{ l.symbol }}</span>{{ l.label }}</span>
      }
      <span class="mon__pr mon__tone--merged"><mat-icon>merge</mat-icon>PR mesclado</span>
      <span class="mon__pr mon__tone--ok"><mat-icon>call_split</mat-icon>PR aberto</span>
      <span class="mon__faint">→ branch de destino · PRs do registro do PRMake · ambientes do retrato da AWS gravado pela máquina</span>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 8px; min-height: 0;
      --mon-border: var(--cc-surface-border, rgba(255, 255, 255, .08));
      --mon-muted: var(--cc-text-2, rgba(255, 255, 255, .66));
      --mon-faint: var(--cc-text-3, rgba(255, 255, 255, .45)); }
    .mon__head { display: flex; align-items: center; gap: 8px; min-height: 36px; flex-wrap: wrap; }
    .mon__summary { font-weight: 500; }
    .mon__spacer { flex: 1 1 auto; }
    .mon__faint { color: var(--mon-faint); font-size: 12px; }
    .mon__bar { margin-top: -4px; }
    .mon__error { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 10px; color: #f85149;
      background: color-mix(in srgb, #f85149 10%, transparent); border: 1px solid color-mix(in srgb, #f85149 35%, transparent); }
    .mon__error span { flex: 1; color: var(--mat-sys-on-surface); }
    .mon__empty { color: var(--mon-muted); margin: 12px 0; }
    .mon__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .mon__row { --ct: #8b949e; display: flex; align-items: stretch; border-radius: 10px; border: 1px solid var(--mon-border);
      background: var(--surface-1, #262b33); overflow: hidden; }
    .mon__typebar { flex: none; width: 4px; background: var(--ct); }
    .mon__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; }
    .mon__title { all: unset; cursor: pointer; display: flex; align-items: baseline; gap: 6px; min-width: 0; }
    .mon__title:hover .mon__text { text-decoration: underline; }
    .mon__title:focus-visible { outline: 2px solid var(--mat-sys-primary); outline-offset: 2px; border-radius: 4px; }
    .mon__type { flex: none; font-size: 11px; padding: 0 6px; border-radius: 6px; color: var(--ct);
      background: color-mix(in srgb, var(--ct) 14%, transparent); }
    .mon__id { flex: none; font-weight: 700; font-variant-numeric: tabular-nums; }
    .mon__text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mon__meta { display: flex; flex-wrap: wrap; gap: 4px 12px; color: var(--mon-muted); font-size: 12px; }
    .mon__meta span { display: inline-flex; align-items: center; gap: 3px; }
    .mon__meta .mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .mon__state { font-weight: 500; color: var(--mat-sys-on-surface); }
    .mon__devops { display: inline-flex; align-items: center; gap: 3px; color: var(--mon-muted); text-decoration: none; }
    .mon__devops:hover { color: var(--mat-sys-primary); }
    .mon__line { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; font-size: 12px; }
    .mon__label { flex: none; width: 74px; color: var(--mon-faint); font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
    .mon__pr, .mon__env { --tc: #8b949e; display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 100%; height: 22px;
      padding: 0 8px; border-radius: 999px; font-size: 12px; white-space: nowrap; text-decoration: none; color: var(--mat-sys-on-surface);
      background: color-mix(in srgb, var(--tc) 12%, transparent); border: 1px solid color-mix(in srgb, var(--tc) 38%, transparent); }
    a.mon__pr[href]:hover { background: color-mix(in srgb, var(--tc) 22%, transparent); }
    .mon__pr .mat-icon { font-size: 14px; width: 14px; height: 14px; color: var(--tc); }
    .mon__prname { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .mon__prstatus { color: var(--tc); font-weight: 500; }
    .mon__branch { color: var(--mon-muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
    .mon__sym { color: var(--tc); font-weight: 700; }
    .mon__snap { margin-left: 4px; }
    .mon__tone--ok { --tc: #3fb950; }
    .mon__tone--warn { --tc: #e3b341; }
    .mon__tone--bad { --tc: #f85149; }
    .mon__tone--info { --tc: #58a6ff; }
    .mon__tone--merged { --tc: #a371f7; }
    .mon__tone--none { --tc: #8b949e; color: var(--mon-muted); }
    .mon__legend { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding-top: 6px; border-top: 1px dashed var(--mon-border); }
    .mon__legend-title { color: var(--mon-faint); font-size: 12px; }
    @media (max-width: 599px) { .mon__label { width: 100%; } }
  `]
})
export class EpicMonitorComponent {
  /** Número do épico. */
  readonly epic = input<number | null>(null);
  /** Cards do épico (a lista da aba) — muda quando um card entra/sai e serve de filtro do `devopsCardsUpdated`. */
  readonly cards = input<readonly string[]>([]);
  /** Clique no card: a Mesa abre o painel do card do DevOps. */
  readonly openCard = output<string>();

  private api = inject(EpicsService);
  private ws = inject(WsService);

  readonly rows = signal<EpicMonitorCard[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly loadedAt = signal<string | null>(null);
  readonly legend = MONITOR_LEGEND;
  readonly envOrder = computed(() => environmentOrder(this.rows()));
  readonly summary = computed(() => summaryText(summarizeMonitor(this.rows())));

  private sub?: Subscription;
  private timer?: ReturnType<typeof setTimeout>;
  private loadedEpic: number | null = null;
  private loadedKey: string | null = null;

  constructor() {
    effect(() => {
      const epic = this.epic();
      const key = this.cards().join(',');
      untracked(() => {
        // Mesma lista (nova referência a cada leitura do épico) não relê.
        const full = `${epic}|${key}`;
        if (full === this.loadedKey) return;
        if (epic !== this.loadedEpic) this.rows.set([]);
        this.loadedEpic = epic;
        this.loadedKey = full;
        this.load();
      });
    });

    const stopEpics = this.api.listen((payload) => {
      if (payload && payload.number !== this.epic()) return;
      this.schedule();
    });
    const onCards = (payload: { ids?: (string | number)[] } | null) => {
      const ids = this.rows().map(r => r.card);
      if (touchesCards(payload, ids.length ? ids : this.cards())) this.schedule();
    };
    this.ws.addToGroup('devops');
    this.ws.on('devopsCardsUpdated', onCards);

    inject(DestroyRef).onDestroy(() => {
      stopEpics();
      this.ws.off('devopsCardsUpdated', onCards);
      this.ws.removeFromGroup('devops');
      clearTimeout(this.timer);
      this.sub?.unsubscribe();
    });
  }

  reload(): void {
    this.load();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.load(), 800);
  }

  private load(): void {
    const epic = this.epic();
    this.sub?.unsubscribe();
    if (!epic) { this.rows.set([]); return; }
    this.loading.set(true);
    this.error.set(null);
    this.sub = this.api.monitor(epic).subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.loading.set(false);
        this.loadedAt.set(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(epicApiError(err, 'Não foi possível ler o acompanhamento do épico.'));
      }
    });
  }

  envs(c: EpicMonitorCard): EpicMonitorEnv[] | null { return envRow(c, this.envOrder()); }
  badge(e: EpicMonitorEnv) { return envBadge(e.status); }
  look(p: EpicMonitorPr) { return prLook(p); }
  name(p: EpicMonitorPr) { return prName(p); }
  snapshot(at?: string | null) { return snapshotLabel(at); }
  typeColor(type?: string | null) { return devOpsTypeColor(type); }

  envTooltip(e: EpicMonitorEnv): string {
    const b = envBadge(e.status);
    const at = e.at ? new Date(e.at) : null;
    const when = at && !isNaN(at.getTime()) ? ` em ${at.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : '';
    const msg = `${e.message ?? ''}`.trim();
    return `${e.name}: ${b.label}${b.status === 'deployed' ? when : ''}${msg ? ' — ' + msg : ''}`;
  }

  prTooltip(p: EpicMonitorPr): string {
    const l = prLook(p);
    const parts = [p.title || prName(p), `PR ${l.label}`];
    if (p.targetBranch) parts.push(`destino: ${p.targetBranch}`);
    if (p.branch) parts.push(`branch: ${p.branch}`);
    const at = l.status === 'merged' ? (p.mergedAt || p.statusSyncedAt) : null;
    if (at) {
      const d = new Date(at);
      if (!isNaN(d.getTime())) parts.push(`${p.mergedAt ? 'mesclado em' : 'visto mesclado em'} ${d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`);
    }
    return parts.join(' · ');
  }
}
