import { Component, ElementRef, ViewEncapsulation, afterNextRender, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { WorkItemsService } from '../../services/work-items.service';
import {
  WorkItem,
  WorkItemError,
  formatWorkNumber,
  itemProgress,
  itemStatusLook,
  linkIcon,
  pullRequestLinks,
  taskStatusLook
} from './work-item.model';
import { itemTypeLook } from './work-item-types';

export type WorkItemPopoverMode = 'popover' | 'sheet';

const MAX_TASKS = 8;

/**
 * 0090: popover de um item de trabalho citado na conversa do especialista (`#123`; número de sub-tarefa → o item dono
 * com a sub-tarefa em destaque) — tipo, estado, título, card,
 * progresso, sub-tarefas, PRs/links e o motivo do cancelamento, com "Abrir na Bancada". Mesmo overlay/folha inferior
 * dos outros popovers da `appCodeRefHost`. Estados: carregando, erro e não encontrado.
 */
@Component({
  selector: 'app-work-item-popover',
  standalone: true,
  imports: [DatePipe, MatButtonModule, MatIconModule, MatTooltipModule],
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'wip',
    '[class.wip--popover]': "mode() === 'popover'",
    '[class.wip--sheet]': "mode() === 'sheet'",
    role: 'dialog',
    tabindex: '-1',
    '[attr.aria-label]': "'Item de trabalho ' + label()",
  },
  template: `
    <header class="wip__head">
      <div class="wip__titles">
        <div class="wip__line">
          <span class="wip__num">{{ label() }}</span>
          @if (item(); as it) {
            <span class="wip__chip" [style.--wip-c]="type().color || '#8b9bb4'"><mat-icon>{{ type().icon }}</mat-icon>{{ type().label }}</span>
            <span class="wip__chip" [style.--wip-c]="status().color"><mat-icon [class.wip__spin]="status().spin">{{ status().icon }}</mat-icon>{{ status().label }}</span>
            @if (otherCard()) { <span class="wip__card" matTooltip="Item de outro card">card {{ it.cardNumber }}</span> }
          }
        </div>
        @if (matchedTask(); as mt) {
          <span class="wip__title">{{ mt.title }}</span>
          <span class="wip__parent"><mat-icon>subdirectory_arrow_right</mat-icon>sub-tarefa do item <b>{{ itemLabel() }}</b> · {{ item()?.title }}</span>
        } @else if (item()?.title; as t) { <span class="wip__title">{{ t }}</span> }
      </div>
      <button mat-icon-button type="button" class="wip__close" (click)="closed.emit()" matTooltip="Fechar (Esc)" aria-label="Fechar"><mat-icon>close</mat-icon></button>
    </header>

    <div class="wip__scroll">
      @switch (state()) {
        @case ('loading') { <div class="wip__state" role="status"><mat-icon class="wip__spin">progress_activity</mat-icon> Carregando o item…</div> }
        @case ('missing') { <div class="wip__state" role="status"><mat-icon>search_off</mat-icon><span>Não existe item de trabalho {{ label() }}.</span></div> }
        @case ('error') {
          <div class="wip__state wip__state--bad" role="alert"><mat-icon>error_outline</mat-icon><span>{{ error() }}</span>
            <button mat-stroked-button type="button" (click)="load()">Tentar de novo</button></div>
        }
        @default {
          @if (item(); as it) {
            @if ((matchedTask() ? matchedTask()?.description : it.description) || it.description; as d) { <p class="wip__desc">{{ d }}</p> }
            @if (it.activity) { <p class="wip__activity"><mat-icon class="wip__spin">autorenew</mat-icon>{{ it.activity }}</p> }
            @if (it.cancelReason) { <p class="wip__reason"><mat-icon>block</mat-icon>{{ it.cancelReason }}</p> }
            @if (progress().total) {
              <div class="wip__progress" [attr.aria-label]="progress().done + ' de ' + progress().total + ' sub-tarefas'">
                <span class="wip__bar"><i [style.width.%]="progress().pct"></i></span>
                <small>{{ progress().done }}/{{ progress().total }} sub-tarefas</small>
              </div>
              <ul class="wip__tasks">
                @for (t of tasks(); track t.id) {
                  <li [class.wip__task--on]="t.number === matchedTask()?.number"><mat-icon [style.color]="taskLook(t.status).color" [class.wip__spin]="taskLook(t.status).spin" [matTooltip]="taskLook(t.status).label">{{ taskLook(t.status).icon }}</mat-icon>
                    <span><b class="wip__tnum">#{{ t.number }}</b> {{ t.title }}</span><small>{{ t.executor === 'user' ? 'pessoa' : 'Claude' }}</small></li>
                }
                @if (it.tasks.length > tasks().length) { <li class="wip__more">+ {{ it.tasks.length - tasks().length }} sub-tarefas</li> }
              </ul>
            }
            @if (links().length) {
              <div class="wip__links">
                @for (l of links(); track l.url) {
                  <a [href]="l.url" target="_blank" rel="noopener" class="wip__link"><mat-icon>{{ l.icon }}</mat-icon><span>{{ l.title }}</span></a>
                }
              </div>
            }
            <footer class="wip__foot">
              <span>{{ it.createdByName || 'PRMake' }} · {{ it.createdAt | date: 'dd/MM HH:mm' }}@if (it.completedAt) { · terminou {{ it.completedAt | date: 'dd/MM HH:mm' }} }</span>
              <span class="wip__spacer"></span>
              <button mat-stroked-button type="button" (click)="openWorkbench(it)"><mat-icon>handyman</mat-icon>Abrir na Bancada</button>
            </footer>
          }
        }
      }
    </div>
  `,
  styles: [`
    .wip { display: flex; flex-direction: column; min-height: 0; color: var(--mat-sys-on-surface, #e6edf3); background: #161b22;
      border: 1px solid #30363d; border-radius: 12px; box-shadow: 0 16px 48px rgba(0,0,0,.55); font-size: 13px; outline: none; overflow: hidden; }
    .wip.wip--popover { width: min(460px, calc(100vw - 24px)); max-height: min(64vh, 560px); animation: wip-in .12s ease-out; }
    .wip.wip--sheet { width: 100vw; max-height: 80vh; border-radius: 14px 14px 0 0; border-bottom: none; }
    @keyframes wip-in { from { opacity: 0; transform: scale(.97); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .wip.wip--popover { animation: none; } }
    .wip__head { flex: none; display: flex; align-items: flex-start; gap: 8px; padding: 10px 6px 10px 14px; border-bottom: 1px solid #30363d; background: #1c2128; }
    .wip__titles { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
    .wip__line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .wip__num { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-weight: 700; color: #79c0ff; }
    .wip__chip { --wip-c: #8b9bb4; display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 8px; border-radius: 999px; font-size: 11px;
      font-weight: 600; white-space: nowrap; color: color-mix(in srgb, var(--wip-c) 82%, white); background: color-mix(in srgb, var(--wip-c) 14%, transparent);
      border: 1px solid color-mix(in srgb, var(--wip-c) 36%, transparent); }
    .wip__chip .mat-icon { font-size: 13px; width: 13px; height: 13px; }
    .wip__card { font-size: 11.5px; color: #d29922; }
    .wip__title { font-weight: 600; font-size: 14px; line-height: 1.35; overflow-wrap: anywhere; }
    .wip__close.mat-mdc-icon-button { --mat-icon-button-state-layer-size: 32px; width: 32px; height: 32px; padding: 4px; margin-top: -4px; }
    .wip__close .mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .wip__scroll { overflow: auto; padding: 10px 14px 12px; display: flex; flex-direction: column; gap: 10px; }
    .wip__state { display: flex; align-items: center; gap: 8px; color: #8b949e; flex-wrap: wrap; }
    .wip__state--bad { color: #f85149; }
    .wip__desc { margin: 0; color: #c9d1d9; white-space: pre-wrap; line-height: 1.45; max-height: 8.5em; overflow: auto; }
    .wip__activity, .wip__reason { margin: 0; display: flex; gap: 6px; align-items: flex-start; font-size: 12px; color: #8b949e; }
    .wip__activity .mat-icon, .wip__reason .mat-icon { font-size: 16px; width: 16px; height: 16px; flex: none; }
    .wip__reason { color: #f0883e; }
    .wip__progress { display: flex; align-items: center; gap: 8px; }
    .wip__bar { flex: 1; height: 6px; border-radius: 3px; background: #30363d; overflow: hidden; }
    .wip__bar i { display: block; height: 100%; background: #3fb950; }
    .wip__progress small { color: #8b949e; white-space: nowrap; }
    .wip__tasks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .wip__tasks li { display: flex; align-items: flex-start; gap: 6px; }
    .wip__tasks li .mat-icon { font-size: 16px; width: 16px; height: 16px; flex: none; margin-top: 1px; }
    .wip__tasks li span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .wip__tasks li small { color: #8b949e; font-size: 11px; }
    .wip__more { color: #8b949e; padding-left: 22px; }
    .wip__tnum { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-weight: 600; font-size: 11.5px; color: #8b949e; }
    .wip__tasks li.wip__task--on { background: rgba(88,166,255,.14); border-radius: 6px; margin: 0 -6px; padding: 2px 6px; }
    .wip__task--on .wip__tnum { color: #79c0ff; }
    .wip__parent { display: flex; align-items: center; gap: 4px; font-size: 12px; color: #8b949e; overflow-wrap: anywhere; }
    .wip__parent .mat-icon { font-size: 15px; width: 15px; height: 15px; flex: none; }
    .wip__parent b { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #79c0ff; }
    .wip__links { display: flex; flex-wrap: wrap; gap: 6px; }
    .wip__link { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 2px 8px; border-radius: 999px; border: 1px solid #30363d;
      color: #79c0ff; text-decoration: none; font-size: 12px; }
    .wip__link span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wip__link .mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .wip__foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 8px; border-top: 1px solid #30363d; font-size: 11.5px; color: #8b949e; }
    .wip__spacer { flex: 1; }
    .wip__spin { animation: wip-spin 1.1s linear infinite; }
    @keyframes wip-spin { to { transform: rotate(360deg); } }
  `]
})
export class WorkItemPopoverComponent {
  /** Número do item (`#123`). */
  readonly number = input.required<number>();
  /** Card da conversa (item de outro card ganha o aviso). */
  readonly card = input<string | null>(null);
  readonly mode = input<WorkItemPopoverMode>('popover');
  readonly closed = output<void>();

  private api = inject(WorkItemsService);
  private router = inject(Router);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly item = signal<WorkItem | null>(null);
  readonly state = signal<'loading' | 'ready' | 'missing' | 'error'>('loading');
  readonly error = signal('');
  readonly label = computed(() => formatWorkNumber(this.number()));
  readonly itemLabel = computed(() => formatWorkNumber(this.item()?.number));
  /** O `#n` citado era de uma sub-tarefa (a numeração é a mesma) — o popover mostra o item dono com ela em destaque. */
  readonly matchedTask = computed(() => {
    const it = this.item();
    return it?.matchedTaskNumber ? (it.tasks ?? []).find((t) => t.number === it.matchedTaskNumber) ?? null : null;
  });
  readonly type = computed(() => itemTypeLook(this.item()?.type));
  readonly status = computed(() => itemStatusLook(this.item()?.status));
  readonly progress = computed(() => { const it = this.item(); return it ? itemProgress(it) : { done: 0, total: 0, pct: 0 }; });
  readonly tasks = computed(() => {
    const all = (this.item()?.tasks ?? []).slice().sort((a, b) => a.order - b.order);
    const shown = all.slice(0, MAX_TASKS);
    // A sub-tarefa citada aparece mesmo além das primeiras.
    const mt = this.matchedTask();
    if (mt && !shown.some((t) => t.number === mt.number)) shown.splice(MAX_TASKS - 1, 1, mt);
    return shown;
  });
  readonly otherCard = computed(() => {
    const it = this.item();
    const c = `${this.card() ?? ''}`.trim();
    return !!it && !!c && `${it.cardNumber}`.trim() !== c;
  });
  readonly links = computed(() => {
    const it = this.item();
    if (!it) return [];
    const prs = pullRequestLinks(it).map((l) => ({ ...l, icon: 'merge' }));
    const others = (it.links ?? []).filter((l) => !!l.url && l.kind !== 'pr' && !prs.some((p) => p.url === l.url))
      .map((l) => ({ url: l.url!, title: l.title || l.url!, icon: linkIcon(l.kind) }));
    return [...prs, ...others].slice(0, 8);
  });

  private seq = 0;

  constructor() {
    effect(() => {
      this.number();
      untracked(() => void this.load());
    });
    afterNextRender(() => this.host.nativeElement.focus({ preventScroll: true }));
  }

  async load(): Promise<void> {
    const n = this.number();
    const seq = ++this.seq;
    this.state.set('loading');
    try {
      const it = await firstValueFrom(this.api.get(n));
      if (seq !== this.seq) return;
      this.item.set(it);
      this.state.set('ready');
    } catch (e) {
      if (seq !== this.seq) return;
      if (e instanceof WorkItemError && e.code === 'notFound') {
        this.state.set('missing');
      } else {
        this.error.set(e instanceof Error ? e.message : `Não foi possível carregar o item ${formatWorkNumber(n)}.`);
        this.state.set('error');
      }
    }
  }

  taskLook(status: string) {
    return taskStatusLook(status);
  }

  openWorkbench(it: WorkItem): void {
    this.closed.emit();
    void this.router.navigate(['/auth/workbench'], { queryParams: { card: it.cardNumber, item: it.number } });
  }
}
