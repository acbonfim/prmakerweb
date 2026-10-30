import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CliipboardService } from '../../../services/cliipboard.service';
import {
  PromotionCopyOptions, formatPromotionHtmlTable, formatPromotionMarkdownTable, formatPromotionText, selectCopyItems
} from './promotion-copy';
import { MOTION_CSS } from './promotion-motion';
import { ITEM_STATUS_LABEL, PromotionBatch, PromotionItem, isItemRetryable, itemHasPr } from './promotion.model';

/**
 * Resultado de um lote (0074): progresso por item, a tabela com os PRs abertos e a cópia como texto ou como tabela
 * (o mesmo formato do registro de PR). Atualiza sozinho enquanto houver item na fila.
 */
@Component({
  selector: 'app-promotion-result',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    @if (batch(); as b) {
      <section class="res">
        <header class="res__head">
          <div>
            <h2>Lote {{ b.version }} @if (b.kind) { <span class="res__kind">{{ b.kind === 'hotfix' ? 'Hotfix' : 'Release' }}</span> }</h2>
            <p class="res__sub">{{ b.ownerName }} · {{ formatDateTime(b.createdAt) }}
              @if (b.active) { · <span class="res__live"><span class="res__pulse"></span>em andamento</span> }
              @else if (b.finishedAt) { · terminou {{ formatDateTime(b.finishedAt) }} }</p>
          </div>
          <div class="res__actions">
            <button mat-button (click)="newBatch.emit()"><mat-icon>add</mat-icon> Novo lote</button>
          </div>
        </header>

        <div class="res__summary" role="status" aria-live="polite">
          @for (c of chips(); track c.key + ':' + c.count) {
            <span class="chip chip--{{ c.key }}" [title]="c.title"><strong>{{ c.count }}</strong> {{ c.label }}</span>
          }
        </div>

        @if (b.active) {
          <div class="res__bar" role="progressbar" [attr.aria-valuenow]="progress()" aria-valuemin="0" aria-valuemax="100"><div class="res__bar-fill" [style.width.%]="progress()"></div></div>
        }

        <div class="res__toolbar">
          <button mat-stroked-button (click)="copy('text')" [disabled]="!hasCopy()" [class.res__copied]="copied() === 'text'"
                  matTooltip="Uma linha por PR: AB#card [destino] - link (o formato do registro de PR)">
            <mat-icon [class.pop]="copied() === 'text'">{{ copied() === 'text' ? 'check' : 'content_copy' }}</mat-icon> {{ copied() === 'text' ? 'Copiado!' : 'Copiar como texto' }}
          </button>
          <button mat-stroked-button (click)="copy('table')" [disabled]="!hasCopy()" [class.res__copied]="copied() === 'table'"
                  matTooltip="Tabela com card, título, repositório, destino e link — cola formatada no Teams/Outlook/DevOps">
            <mat-icon [class.pop]="copied() === 'table'">{{ copied() === 'table' ? 'check' : 'table_chart' }}</mat-icon> {{ copied() === 'table' ? 'Copiado!' : 'Copiar como tabela' }}
          </button>
          <label class="res__check"><input type="checkbox" [checked]="includeFailures()" (change)="includeFailures.set($any($event.target).checked)" /> incluir conflitos e erros</label>
          <span class="res__spacer"></span>
          @if (retryable().length) {
            <button mat-flat-button color="primary" (click)="retry.emit(retryableIds())" [disabled]="busy()" [attr.aria-busy]="busy()">
              <mat-icon [class.spin]="busy()">{{ busy() ? 'progress_activity' : 'replay' }}</mat-icon> {{ busy() ? 'Reenviando…' : 'Reenviar ' + retryable().length + (retryable().length === 1 ? ' pendente' : ' pendentes') }}
            </button>
          }
          @if (b.summary.queued > 0) {
            <button mat-button (click)="cancel.emit()" [disabled]="busy()"><mat-icon [class.spin]="busy()">{{ busy() ? 'progress_activity' : 'block' }}</mat-icon> Cancelar a fila</button>
          }
        </div>

        <div class="res__scroll">
          <table class="res__table">
            <thead>
              <tr><th>Card</th><th>Repositório</th><th>Origem → Destino</th><th>Situação</th><th>PR</th></tr>
            </thead>
            <tbody>
              @for (i of items(); track i.id; let ri = $index) {
                <tr [class.res__row--bad]="bad(i)" [class.res__row--active]="isActive(i)" [style.--i]="ri">
                  <td class="res__card">
                    <strong>AB#{{ i.card }}</strong>
                    <span class="res__title" [title]="i.title">{{ i.title }}</span>
                  </td>
                  <td class="res__repo" [title]="i.repository">{{ shortRepo(i.repository) }}</td>
                  <td class="res__flow">
                    <code>{{ i.sourceBranch }}</code> <mat-icon>arrow_forward</mat-icon> <code>{{ i.target }}</code>
                    @if (i.draft) { <span class="chip chip--draft">rascunho</span> }
                    @if (i.mode === 'direct') { <span class="chip chip--muted" matTooltip="PR da própria branch, sem cherry-pick">direto</span> }
                  </td>
                  <td>
                    <span class="status status--{{ i.status }}">
                      @if (i.status === 'running') { <span class="res__pulse"></span> }
                      {{ statusLabel[i.status] }}
                    </span>
                    @if (i.commitCount > 0 && i.mode === 'cherry-pick') { <span class="res__muted"> · {{ i.commitCount }} commit(s)</span> }
                    @if (i.status === 'queued') { <div class="res__msg">esperando o executor…</div> }
                    @if (i.message) { <div class="res__msg" [title]="i.message">{{ i.message }}</div> }
                    @if (i.conflictFiles.length) {
                      <div class="res__files"><mat-icon>warning_amber</mat-icon>
                        @for (f of i.conflictFiles; track f) { <code>{{ f }}</code> }
                      </div>
                    }
                  </td>
                  <td>
                    @if (hasPr(i)) {
                      <a [href]="i.pullRequestUrl" target="_blank" rel="noopener" class="res__pr">#{{ i.pullRequestNumber }} <mat-icon>open_in_new</mat-icon></a>
                    } @else if (isActive(i)) {
                      <span class="sk sk--pill" style="width: 64px" aria-label="Aguardando o PR"></span>
                    } @else { <span class="res__muted">—</span> }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }
  `,
  styles: [MOTION_CSS, `
    :host { display: block; }
    .res { --ok: #3fb950; --warn: #d29922; --err: #f0716a; --run: var(--mat-sys-primary);
           --muted: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent);
           --line: color-mix(in srgb, var(--mat-sys-on-surface) 12%, transparent); }
    .res__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
    .res__head h2 { margin: 0; font-size: 20px; display: flex; align-items: center; gap: 8px; }
    .res__kind { font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, var(--run) 18%, transparent); color: var(--run); }
    .res__sub { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
    .res__live { display: inline-flex; align-items: center; gap: 5px; color: var(--run); }
    .res__pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--run); display: inline-block; animation: pulse 1.4s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }
    .res__summary { display: flex; gap: 8px; flex-wrap: wrap; margin: 14px 0 8px; }
    .chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 999px; font-size: 12px; background: color-mix(in srgb, var(--mat-sys-on-surface) 8%, transparent); }
    .chip--opened { background: color-mix(in srgb, var(--ok) 18%, transparent); color: var(--ok); }
    .chip--conflict, .chip--error, .chip--missing_target { background: color-mix(in srgb, var(--err) 18%, transparent); color: var(--err); }
    .chip--running, .chip--queued { background: color-mix(in srgb, var(--run) 16%, transparent); color: var(--run); }
    .chip--draft { background: color-mix(in srgb, var(--warn) 18%, transparent); color: var(--warn); }
    .chip--muted { color: var(--muted); }
    .res__bar { height: 4px; border-radius: 2px; background: var(--line); overflow: hidden; margin-bottom: 10px; }
    .res__bar { position: relative; }
    .res__bar-fill { position: relative; height: 100%; background: var(--run); transition: width .6s cubic-bezier(.2, .8, .2, 1); overflow: hidden; }
    .res__bar-fill::after { content: ''; position: absolute; inset: 0; background: linear-gradient(100deg, transparent 30%, rgba(255,255,255,.45) 50%, transparent 70%); animation: mo-sweep 1.3s ease-in-out infinite; }
    .res { animation: mo-fade .3s ease both; }
    .res__table tbody tr { animation: mo-rise .28s ease both; animation-delay: calc(var(--i, 0) * 35ms); }
    .res__row--active { background: color-mix(in srgb, var(--run) 5%, transparent); }
    .status--opened, .status--already_open { animation: mo-pop .35s ease both; }
    .status--conflict, .status--error, .status--missing_target { animation: mo-shake .4s ease both; }
    .res__pr { animation: mo-pop .35s ease both; }
    .res__copied { border-color: var(--ok) !important; color: var(--ok) !important; }
    .res .pop { animation: mo-pop .3s ease both; }
    .res__toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 8px 0 12px; }
    .res__spacer { flex: 1; }
    .res__check { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); cursor: pointer; }
    .res__scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; }
    .res__table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .res__table th { text-align: left; padding: 8px 10px; font-weight: 600; color: var(--muted); border-bottom: 1px solid var(--line); white-space: nowrap; }
    .res__table td { padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
    .res__table tr:last-child td { border-bottom: 0; }
    .res__row--bad { background: color-mix(in srgb, var(--err) 6%, transparent); }
    .res__card { display: flex; flex-direction: column; gap: 2px; min-width: 150px; max-width: 260px; }
    .res__title { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .res__repo { color: var(--muted); white-space: nowrap; }
    .res__flow { white-space: nowrap; }
    .res__flow mat-icon { font-size: 14px; width: 14px; height: 14px; vertical-align: middle; color: var(--muted); }
    code { font-size: 12px; background: color-mix(in srgb, var(--mat-sys-on-surface) 8%, transparent); padding: 1px 6px; border-radius: 4px; }
    .status { display: inline-flex; align-items: center; gap: 5px; font-weight: 600; color: var(--c, var(--muted)); }
    .status--opened, .status--already_open { --c: var(--ok); }
    .status--running, .status--queued { --c: var(--run); }
    .status--conflict, .status--error, .status--missing_target { --c: var(--err); }
    .status--no_changes { --c: var(--warn); }
    .res__muted { color: var(--muted); font-size: 12px; }
    .res__msg { color: var(--muted); font-size: 12px; max-width: 360px; margin-top: 2px; }
    .res__files { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
    .res__files mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--warn); }
    .res__pr { display: inline-flex; align-items: center; gap: 3px; color: var(--run); font-weight: 600; text-decoration: none; }
    .res__pr mat-icon { font-size: 15px; width: 15px; height: 15px; }
    @media (max-width: 640px) { .res__table th:nth-child(2), .res__table td:nth-child(2) { display: none; } }
  `]
})
export class PromotionResultComponent {
  private clipboard = inject(CliipboardService);

  readonly batch = input<PromotionBatch | null>(null);
  readonly busy = input(false);
  readonly retry = output<string[]>();
  readonly cancel = output<void>();
  readonly newBatch = output<void>();

  readonly statusLabel = ITEM_STATUS_LABEL;
  readonly includeFailures = signal(false);
  /** Qual cópia acabou de ser feita (mostra "Copiado!" por um instante). */
  readonly copied = signal<'text' | 'table' | null>(null);
  private copiedTimer?: ReturnType<typeof setTimeout>;

  readonly items = computed(() => [...(this.batch()?.items ?? [])].sort((a, b) => a.position - b.position));
  readonly retryable = computed(() => this.items().filter(i => isItemRetryable(i.status)));
  readonly retryableIds = computed(() => this.retryable().map(i => i.id));
  private readonly copyOptions = computed<PromotionCopyOptions>(() => ({ includeFailures: this.includeFailures() }));
  readonly hasCopy = computed(() => selectCopyItems(this.items(), this.copyOptions()).length > 0);

  readonly progress = computed(() => {
    const s = this.batch()?.summary;
    return s && s.total > 0 ? Math.round(((s.total - s.queued - s.running) / s.total) * 100) : 0;
  });

  readonly chips = computed(() => {
    const s = this.batch()?.summary;
    if (!s) return [];
    const all = [
      { key: 'opened', label: 'abertos', count: s.opened, title: 'PRs abertos agora' },
      { key: 'already_open', label: 'já existiam', count: s.alreadyOpen, title: 'Já havia PR aberto deste card para o destino' },
      { key: 'running', label: 'em andamento', count: s.running, title: '' },
      { key: 'queued', label: 'na fila', count: s.queued, title: 'Esperando o executor' },
      { key: 'conflict', label: 'com conflito', count: s.conflict, title: 'O cherry-pick bateu em conflito' },
      { key: 'missing_target', label: 'destino inexistente', count: s.missingTarget, title: '' },
      { key: 'no_changes', label: 'sem mudanças', count: s.noChanges, title: 'Os commits já estão no destino' },
      { key: 'error', label: 'com erro', count: s.error, title: '' },
      { key: 'cancelled', label: 'cancelados', count: s.cancelled, title: '' }
    ];
    return all.filter(c => c.count > 0);
  });

  hasPr = itemHasPr;
  isActive = (i: PromotionItem) => i.status === 'queued' || i.status === 'running';
  bad = (i: PromotionItem) => i.status === 'conflict' || i.status === 'error' || i.status === 'missing_target';
  shortRepo = (r: string) => r.includes('/') ? r.slice(r.lastIndexOf('/') + 1) : r;

  copy(format: 'text' | 'table'): void {
    const items = selectCopyItems(this.items(), this.copyOptions());
    if (!items.length) return;
    if (format === 'text') this.clipboard.copyFullDescriptionToClipboard(formatPromotionText(items));
    else void this.clipboard.copyRichToClipboard(formatPromotionHtmlTable(items), formatPromotionMarkdownTable(items));
    this.copied.set(format);
    clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => this.copied.set(null), 1800);
  }

  formatDateTime(value?: string | null): string {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
}
