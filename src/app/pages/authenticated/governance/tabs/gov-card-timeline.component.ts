import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { LowerCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { GovernanceCardDetail, TIMELINE_KIND_ICON, TIMELINE_KIND_LABEL, TimelineKind, statusLabel, statusUntil } from '../../../../services/governance/governance.model';
import { buildCardTimeline, fmtMs, fmtNum } from '../../../../services/governance/governance.logic';
import { formatDateTime } from '../../../../services/usage/usage.model';
import { GovernanceStore } from '../governance.store';

const KINDS: TimelineKind[] = ['milestone', 'plan', 'step', 'work-item', 'task', 'request', 'event'];

/**
 * Linha do tempo do card (0098): quando iniciou e por quem, marcos (análise inicial, protótipo, correção, PR, QA,
 * fechado) com o tempo entre eles, e cada ação com início, fim e duração — com a barra mostrando onde caiu no período.
 */
@Component({
  selector: 'app-gov-card-timeline',
  standalone: true,
  imports: [LowerCasePipe, RouterLink, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  templateUrl: './gov-card-timeline.component.html',
  styleUrls: ['../governance-shared.css', './gov-card-timeline.component.css'],
})
export class GovCardTimelineComponent {
  readonly statusLabel = statusLabel;
  readonly statusUntil = statusUntil;
  readonly store = inject(GovernanceStore);
  readonly card = input.required<number>();
  readonly closed = output<void>();

  readonly detail = signal<GovernanceCardDetail | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Tipos mostrados (eventos soltos começam escondidos: costumam ser muitos). */
  readonly shown = signal<Set<TimelineKind>>(new Set(KINDS.filter((k) => k !== 'event')));

  readonly view = computed(() => {
    const d = this.detail();
    return d ? buildCardTimeline(d) : null;
  });
  readonly kindsPresent = computed(() => {
    const rows = this.view()?.rows ?? [];
    return KINDS.filter((k) => rows.some((r) => r.kind === k)).map((k) => ({ key: k, label: TIMELINE_KIND_LABEL[k], count: rows.filter((r) => r.kind === k).length }));
  });
  readonly rows = computed(() => (this.view()?.rows ?? []).filter((r) => this.shown().has(r.kind)));

  readonly kindLabel = TIMELINE_KIND_LABEL;
  readonly kindIcon = TIMELINE_KIND_ICON;

  constructor() {
    effect(() => {
      const c = this.card();
      this.store.refreshTick();
      untracked(() => this.load(c));
    });
  }

  private load(card: number): void {
    this.loading.set(true);
    this.error.set(null);
    this.store.api.card(card).subscribe({
      next: (d) => {
        this.detail.set(d);
        this.loading.set(false);
      },
      error: (e) => {
        this.detail.set(null);
        this.loading.set(false);
        this.error.set(e?.status === 404 ? `O card ${card} não tem atividade registrada na governança.` : 'Não consegui carregar a linha do tempo do card.');
      },
    });
  }

  toggle(k: TimelineKind): void {
    this.shown.update((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  }

  outcomeClass(o: string | null): string {
    if (!o) return '';
    const x = o.toLowerCase();
    if (x === 'ok' || x === 'done' || x === 'completed') return 'badge--ok';
    if (x === 'error' || x === 'failed') return 'badge--error';
    if (x === 'blocked') return 'badge--blocked';
    if (x === 'warned' || x === 'monitored') return `badge--${x}`;
    return '';
  }

  outcomeText(o: string | null): string {
    const map: Record<string, string> = { ok: 'ok', done: 'ok', completed: 'ok', error: 'erro', failed: 'falhou', blocked: 'barrado', warned: 'avisado', monitored: 'teria barrado', skipped: 'pulada', running: 'em andamento', cancelled: 'cancelada' };
    return o ? (map[o.toLowerCase()] ?? o) : '';
  }

  num = fmtNum;
  dur = fmtMs;
  dt = formatDateTime;
}
