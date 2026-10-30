import { CommonModule } from '@angular/common';
import { CdkOverlayOrigin } from '@angular/cdk/overlay';
import { Component, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../services/auth.service';
import { CcPopoverComponent } from '../popover/cc-popover.component';
import { UserAvatarComponent } from '../user-avatar/user-avatar.component';
import { ExecutionPlanSummary, PLAN_STATUS_LABEL } from './execution-plan.model';

type PhaseFilter = 'all' | 'analysis' | 'correction';

export interface HistoryRow {
  item: ExecutionPlanSummary;
  /** Número da versão na fase (1 = a mais antiga). */
  version: number;
  phaseLabel: string;
  isLatest: boolean;
  parent: { id: string; label: string } | null;
  changedBy: string | null;
  duration: string;
  pct: number;
}

/**
 * Histórico de versões do plano do card (0074). Painel (popover) com cada versão: número por fase, status, progresso,
 * quem criou (avatar + nome), quando, e quem alterou por último. O gatilho (botão) fica no pai — assim o menu "⋯" do
 * celular abre o mesmo painel (`open(origin)`).
 */
@Component({
  selector: 'app-plan-history',
  standalone: true,
  imports: [CommonModule, MatIconModule, CcPopoverComponent, UserAvatarComponent],
  template: `
    <cc-popover #pop maxWidth="min(460px, calc(100vw - 24px))" (opened)="onOpened()">
      <div class="ph" (keydown)="onKeydown($event)">
        <div class="ph-head">
          <div class="ph-title"><mat-icon>history</mat-icon><span>Versões do plano</span></div>
          <div class="ph-sub">{{ subtitle() }}</div>
          @if (showFilter()) {
            <div class="ph-filter" role="tablist" aria-label="Filtrar por fase">
              @for (f of filters(); track f.key) {
                <button type="button" role="tab" class="ph-chip" [class.ph-chip--on]="filter() === f.key"
                        [attr.aria-selected]="filter() === f.key" (click)="filter.set(f.key)">
                  {{ f.label }} <span class="ph-chip__n">{{ f.count }}</span>
                </button>
              }
            </div>
          }
        </div>

        @if (rows().length) {
          <div class="ph-list" role="listbox" aria-label="Versões do plano" #list>
            @for (r of rows(); track r.item.id) {
              <button type="button" role="option" class="ph-row" [class.ph-row--current]="r.item.id === currentId()"
                      [attr.aria-selected]="r.item.id === currentId()" (click)="pick(r.item)">
                <span class="ph-ver ph-ver--{{ r.item.phase }}" [title]="r.phaseLabel + ' versão ' + r.version">
                  <span class="ph-ver__phase">{{ r.phaseLabel }}</span>
                  <span class="ph-ver__n">v{{ r.version }}</span>
                </span>
                <span class="ph-body">
                  <span class="ph-line1">
                    <span class="ph-name" [title]="r.item.title">{{ r.item.title }}</span>
                    @if (r.isLatest) { <span class="ph-tag">mais recente</span> }
                    @if (r.item.id === currentId()) { <span class="ph-tag ph-tag--cur">em exibição</span> }
                  </span>
                  <span class="ph-line2">
                    <span class="ph-status ph-st--{{ r.item.status }}"><span class="ph-dot"></span>{{ statusLabel[r.item.status] }}</span>
                    @if (r.item.stepsTotal > 0) {
                      <span class="ph-prog" [title]="r.item.stepsCompleted + ' de ' + r.item.stepsTotal + ' etapas'">
                        <span class="ph-bar"><span class="ph-bar__fill ph-st--{{ r.item.status }}" [style.width.%]="r.pct"></span></span>
                        {{ r.item.stepsCompleted }}/{{ r.item.stepsTotal }}
                      </span>
                    }
                    @if (r.duration) { <span class="ph-dur" title="Duração"><mat-icon>schedule</mat-icon>{{ r.duration }}</span> }
                  </span>
                  <span class="ph-line3">
                    <app-user-avatar [name]="r.item.createdBy" [imageUrl]="photoFor(r.item.createdByUserId)" [size]="22"></app-user-avatar>
                    <span class="ph-who">
                      <strong>{{ r.item.createdBy || 'Desconhecido' }}</strong>
                      criou em {{ formatDateTime(r.item.createdAt) }}
                      <span class="ph-rel">· {{ relative(r.item.createdAt) }}</span>
                    </span>
                  </span>
                  @if (r.changedBy) {
                    <span class="ph-line4">
                      <mat-icon>edit_note</mat-icon>
                      alterada por <strong>{{ r.changedBy }}</strong> em {{ formatDateTime(r.item.updatedAt) }}
                    </span>
                  }
                  @if (r.parent) {
                    <span class="ph-line4">
                      <mat-icon>subdirectory_arrow_right</mat-icon>
                      gerada da <a role="link" tabindex="0" (click)="$event.stopPropagation(); pickId(r.parent.id)"
                                   (keydown.enter)="$event.stopPropagation(); pickId(r.parent.id)">{{ r.parent.label }}</a>
                    </span>
                  }
                </span>
              </button>
            }
          </div>
        } @else {
          <div class="ph-empty">Nenhuma versão{{ filter() === 'all' ? '' : ' nesta fase' }}.</div>
        }
      </div>
    </cc-popover>
  `,
  styles: [`
    :host { display: contents; }
    .ph { width: 428px; max-width: calc(100vw - 56px); margin: -6px -8px; --ph-ok: #3fb950; --ph-warn: #d29922; --ph-err: #f0716a;
          --ph-run: var(--mat-sys-primary); --ph-muted: color-mix(in srgb, var(--mat-sys-on-surface) 50%, transparent);
          --ph-line: color-mix(in srgb, var(--mat-sys-on-surface) 12%, transparent); }
    .ph-head { padding: 2px 8px 8px; border-bottom: 1px solid var(--ph-line); }
    .ph-title { display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; }
    .ph-title mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--ph-muted); }
    .ph-sub { margin-top: 2px; font-size: 12px; color: var(--ph-muted); }
    .ph-filter { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
    .ph-chip { border: 1px solid var(--ph-line); background: transparent; color: inherit; border-radius: 999px; padding: 2px 10px;
               font: inherit; font-size: 12px; cursor: pointer; }
    .ph-chip:hover { background: color-mix(in srgb, var(--mat-sys-on-surface) 8%, transparent); }
    .ph-chip--on { border-color: var(--ph-run); color: var(--ph-run); background: color-mix(in srgb, var(--ph-run) 12%, transparent); }
    .ph-chip__n { opacity: .7; margin-left: 2px; }
    .ph-list { display: flex; flex-direction: column; gap: 2px; padding: 6px 0 0; max-height: min(520px, calc(100dvh - 200px)); overflow-y: auto; overscroll-behavior: contain; }
    .ph-row { display: flex; gap: 10px; align-items: flex-start; text-align: left; width: 100%; padding: 8px; border: 0; border-radius: 8px;
              background: transparent; color: inherit; font: inherit; cursor: pointer; border-left: 3px solid transparent; }
    .ph-row:hover, .ph-row:focus-visible { background: color-mix(in srgb, var(--mat-sys-on-surface) 8%, transparent); outline: none; }
    .ph-row:focus-visible { box-shadow: inset 0 0 0 2px var(--ph-run); }
    .ph-row--current { background: color-mix(in srgb, var(--ph-run) 10%, transparent); border-left-color: var(--ph-run); }
    .ph-ver { flex: 0 0 auto; display: flex; flex-direction: column; align-items: center; min-width: 62px; padding: 4px 6px; border-radius: 8px;
              background: color-mix(in srgb, var(--mat-sys-on-surface) 8%, transparent); line-height: 1.15; }
    .ph-ver--correction { background: color-mix(in srgb, var(--ph-warn) 16%, transparent); }
    .ph-ver__phase { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: var(--ph-muted); }
    .ph-ver__n { font-size: 16px; font-weight: 700; }
    .ph-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .ph-line1 { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .ph-name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .ph-tag { flex: 0 0 auto; font-size: 10px; padding: 1px 6px; border-radius: 999px; background: color-mix(in srgb, var(--ph-ok) 18%, transparent); color: var(--ph-ok); }
    .ph-tag--cur { background: color-mix(in srgb, var(--ph-run) 18%, transparent); color: var(--ph-run); }
    .ph-line2 { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 12px; }
    .ph-status { display: inline-flex; align-items: center; gap: 5px; font-weight: 500; color: var(--ph-c, var(--ph-muted)); }
    .ph-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ph-c, var(--ph-muted)); }
    .ph-st--pending { --ph-c: var(--ph-muted); } .ph-st--running { --ph-c: var(--ph-run); } .ph-st--paused { --ph-c: var(--ph-warn); }
    .ph-st--completed { --ph-c: var(--ph-ok); } .ph-st--failed { --ph-c: var(--ph-err); } .ph-st--cancelled { --ph-c: var(--ph-muted); }
    .ph-prog { display: inline-flex; align-items: center; gap: 5px; color: var(--ph-muted); font-variant-numeric: tabular-nums; }
    .ph-bar { width: 44px; height: 4px; border-radius: 2px; background: var(--ph-line); overflow: hidden; }
    .ph-bar__fill { display: block; height: 100%; background: var(--ph-c, var(--ph-muted)); }
    .ph-dur { display: inline-flex; align-items: center; gap: 2px; color: var(--ph-muted); }
    .ph-dur mat-icon, .ph-line4 mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .ph-line3 { display: flex; align-items: center; gap: 7px; font-size: 12px; }
    .ph-who { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .ph-rel { color: var(--ph-muted); }
    .ph-line4 { display: flex; align-items: center; gap: 4px; font-size: 11.5px; color: var(--ph-muted); }
    .ph-line4 a { color: var(--ph-run); cursor: pointer; text-decoration: underline; }
    .ph-empty { padding: 18px 8px; text-align: center; font-size: 13px; color: var(--ph-muted); }
    @media (max-width: 480px) { .ph-ver { min-width: 52px; } .ph-bar { display: none; } }
  `]
})
export class PlanHistoryComponent {
  private readonly auth = inject(AuthService);
  private readonly pop = viewChild.required(CcPopoverComponent);
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  /** Planos do card, do mais novo para o mais antigo (ordem do `GET ExecutionPlan/card/{n}`). */
  readonly items = input<ExecutionPlanSummary[]>([]);
  readonly currentId = input<string | null>(null);
  readonly cardNumber = input<string | null>(null);
  readonly picked = output<ExecutionPlanSummary>();

  readonly statusLabel = PLAN_STATUS_LABEL;
  readonly filter = signal<PhaseFilter>('all');
  private readonly photos = signal<Record<string, string>>({});

  /** Numeração: a do servidor; sem ela (API antiga), calcula igual — por fase, do mais antigo (1) ao mais novo. */
  private readonly numbered = computed(() => {
    const items = this.items();
    const fallback = new Map<string, number>();
    for (const phase of ['analysis', 'correction']) {
      [...items.filter((i) => i.phase === phase)]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        .forEach((i, idx) => fallback.set(i.id, idx + 1));
    }
    return items.map((i) => ({ item: i, version: i.versionNumber || fallback.get(i.id) || 1 }));
  });

  readonly rows = computed<HistoryRow[]>(() => {
    const all = this.numbered();
    const byId = new Map(all.map((r) => [r.item.id, r]));
    const f = this.filter();
    const latestId = this.items()[0]?.id;
    return all
      .filter((r) => f === 'all' || r.item.phase === f)
      .map(({ item, version }) => {
        const parent = item.parentPlanId ? byId.get(item.parentPlanId) : undefined;
        return {
          item,
          version,
          phaseLabel: item.phase === 'correction' ? 'Correção' : 'Análise',
          isLatest: item.id === latestId,
          parent: parent ? { id: parent.item.id, label: `Análise v${parent.version}` } : null,
          changedBy: this.changedBy(item),
          duration: this.duration(item),
          pct: item.stepsTotal > 0 ? Math.round((item.stepsCompleted / item.stepsTotal) * 100) : 0
        };
      });
  });

  private readonly counts = computed(() => {
    const items = this.items();
    return {
      all: items.length,
      analysis: items.filter((i) => i.phase !== 'correction').length,
      correction: items.filter((i) => i.phase === 'correction').length
    };
  });

  readonly showFilter = computed(() => this.counts().analysis > 0 && this.counts().correction > 0);
  readonly filters = computed(() => [
    { key: 'all' as PhaseFilter, label: 'Todas', count: this.counts().all },
    { key: 'analysis' as PhaseFilter, label: 'Análise', count: this.counts().analysis },
    { key: 'correction' as PhaseFilter, label: 'Correção', count: this.counts().correction }
  ]);

  readonly subtitle = computed(() => {
    const c = this.counts();
    const card = this.cardNumber() ? `Card ${this.cardNumber()} · ` : '';
    const parts: string[] = [];
    if (c.analysis) parts.push(`${c.analysis} ${c.analysis === 1 ? 'análise' : 'análises'}`);
    if (c.correction) parts.push(`${c.correction} ${c.correction === 1 ? 'correção' : 'correções'}`);
    return `${card}${c.all} ${c.all === 1 ? 'versão' : 'versões'}${parts.length ? ` (${parts.join(', ')})` : ''}`;
  });

  open(origin: CdkOverlayOrigin): void { this.pop().open(origin); }
  toggle(origin: CdkOverlayOrigin): void { this.pop().toggle(origin); }
  close(): void { this.pop().close(); }

  protected onOpened(): void {
    this.ensurePhotos();
    // O foco vai para a versão em exibição (ou a primeira), para navegar com as setas.
    setTimeout(() => {
      const rows = this.rowElements();
      (rows.find((el) => el.getAttribute('aria-selected') === 'true') ?? rows[0])?.focus();
    });
  }

  protected pick(item: ExecutionPlanSummary): void {
    this.picked.emit(item);
    this.close();
  }

  protected pickId(id: string): void {
    const item = this.items().find((i) => i.id === id);
    if (item) this.pick(item);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    const rows = this.rowElements();
    if (!rows.length) return;
    event.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLElement);
    let next = at;
    if (event.key === 'ArrowDown') next = at < 0 ? 0 : Math.min(rows.length - 1, at + 1);
    else if (event.key === 'ArrowUp') next = at < 0 ? rows.length - 1 : Math.max(0, at - 1);
    else if (event.key === 'Home') next = 0;
    else next = rows.length - 1;
    rows[next].focus();
  }

  private rowElements(): HTMLElement[] {
    const root = this.list()?.nativeElement;
    return root ? Array.from(root.querySelectorAll<HTMLElement>('.ph-row')) : [];
  }

  photoFor(userId?: string | null): string | null {
    return userId ? this.photos()[userId.toLowerCase()] || null : null;
  }

  private ensurePhotos(): void {
    const known = this.photos();
    const ids = Array.from(new Set(
      this.items().map((i) => i.createdByUserId).filter((x): x is string => !!x).map((x) => x.toLowerCase())
    )).filter((id) => !(id in known));
    if (!ids.length) return;
    this.auth.getPhotosByExternalIds(ids).subscribe({
      next: (res: any) => {
        const list = res?.object ?? res?.Object ?? [];
        const map = { ...this.photos() };
        for (const u of list) {
          const ext = (u.externalId || u.ExternalId || '').toLowerCase();
          const url = u.imageUrl || u.ImageUrl;
          if (ext && url) map[ext] = url;
        }
        for (const id of ids) if (!(id in map)) map[id] = '';
        this.photos.set(map);
      },
      error: () => {}
    });
  }

  /** "Alterada por": só quando outra pessoa (ou outro momento) mexeu no plano depois da criação. */
  private changedBy(item: ExecutionPlanSummary): string | null {
    const who = item.statusChangedBy?.trim();
    if (!who) return null;
    const gap = new Date(item.updatedAt).getTime() - new Date(item.createdAt).getTime();
    if (who === item.createdBy?.trim() && !(gap > 60_000)) return null;
    return who;
  }

  private duration(item: ExecutionPlanSummary): string {
    if (!item.startedAt || !item.finishedAt) return '';
    const sec = Math.round((new Date(item.finishedAt).getTime() - new Date(item.startedAt).getTime()) / 1000);
    if (!(sec >= 0)) return '';
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    return h < 24 ? `${h} h ${min % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
  }

  formatDateTime(value?: string | null): string {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  relative(value?: string | null): string {
    if (!value) return '';
    const ms = Date.now() - new Date(value).getTime();
    if (!(ms >= 0)) return '';
    const min = Math.floor(ms / 60_000);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `há ${h} h`;
    const d = Math.floor(h / 24);
    return d < 30 ? `há ${d} d` : '';
  }
}
