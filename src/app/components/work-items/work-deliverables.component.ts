import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { WorkItemPickerSource } from '../work-item-pickers/work-item-picker-source.service';
import { DeliverableDiffComponent } from './deliverable-diff.component';
import {
  DeliverableGroup,
  WorkDeliverable,
  deliverableHours,
  deliverableIcon,
  deliverableLabel,
  formatHours,
  formatWorkNumber,
  groupDeliverables,
  isUrl,
  prStatusLabel,
  prStatusOf,
  shortSha,
  ticketStatusLabel
} from './work-item.model';

/** Commits mostrados antes do "mais n". */
const COMMITS_SHOWN = 5;
/** Texto (Timeline, comentário, texto do PR, aviso) acima disso começa recolhido. */
const LONG_TEXT = 260;

const TEXT_KINDS: ReadonlySet<string> = new Set(['comment', 'timeline', 'pr-text', 'notify']);

/**
 * 0091: o que o item/sub-tarefa gerou — um cartão por entrega, pelo tipo: PR (repositório, #, origem → destino, estado,
 * checks/aprovações, "Ver alterações"), branch (base e link), código (commits, arquivos, +/− e o diff completo sob
 * demanda), chamado, estado do card no DevOps, comentário/Timeline/texto do PR/aviso (trecho), horas e links. Entrega
 * desfeita fica apagada com o selo "desfeito"; a deduzida dos registros antigos ganha o selo "deduzido". Lista vazia
 * não desenha nada (quem usa decide o estado vazio). `grouped` = cabeçalhos por grupo (aba Entregas do item).
 */
@Component({
  selector: 'app-work-deliverables',
  standalone: true,
  imports: [DatePipe, NgTemplateOutlet, MatIconModule, MatTooltipModule, DeliverableDiffComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (list().length) {
      <div class="wdl" [class.wdl--compact]="compact()">
        @for (g of groups(); track g.key) {
          <section class="wdl__group">
            @if (grouped()) {
              <h5 class="wdl__group-title"><mat-icon>{{ g.icon }}</mat-icon>{{ g.label }}<small>{{ g.items.length }}</small></h5>
            }
            <ul class="wdl__list">
              @for (d of g.items; track d.id) {
                <li class="wdl-card wdl-card--{{ d.kind }}" [class.wdl-card--reverted]="d.reverted">
                  <div class="wdl-card__head">
                    <mat-icon class="wdl-card__ico">{{ icon(d.kind) }}</mat-icon>
                    <span class="wdl-card__kind">{{ label(d.kind) }}</span>
                    @if (showTask() && d.taskNumber != null) {
                      <button type="button" class="wdl-chip wdl-chip--task" (click)="openTask.emit(d.taskNumber!)" matTooltip="Abrir a sub-tarefa">{{ num(d.taskNumber) }}</button>
                    }
                    @if (d.kind === 'pr' && prStatus(d); as s) { <span class="wdl-st wdl-st--{{ s }}">{{ prLabel(s) }}</span> }
                    @if (d.kind === 'ticket' && d.status) { <span class="wdl-st wdl-st--{{ d.status === 'resolved' || d.status === 'closed' ? 'resolved' : 'pending' }}">{{ ticketLabel(d.status) }}</span> }
                    @if (d.reverted) { <span class="wdl-chip wdl-chip--reverted" matTooltip="A sub-tarefa foi desfeita"><mat-icon>undo</mat-icon>desfeito</span> }
                    @if (d.source === 'deduced') { <span class="wdl-chip" matTooltip="Encontrado a partir dos registros do card (antes da 0091)"><mat-icon>manage_search</mat-icon>deduzido</span> }
                    <span class="wdl__spacer"></span>
                    @if (d.at) { <small class="wdl-card__at">{{ d.at | date:'dd/MM HH:mm' }}</small> }
                  </div>

                  @switch (d.kind) {
                    @case ('pr') {
                      <div class="wdl-card__main">
                        @if (d.url) { <a class="wdl-card__title" [href]="d.url" target="_blank" rel="noopener">{{ prTitle(d) }}</a> }
                        @else { <span class="wdl-card__title">{{ prTitle(d) }}</span> }
                        @if (d.branch || d.target) {
                          <span class="wdl-card__meta"><code>{{ d.branch || '?' }}</code><mat-icon class="wdl__arrow">arrow_forward</mat-icon><code>{{ d.target || '?' }}</code></span>
                        }
                        @if (d.number != null && d.title && d.title !== prTitle(d)) { <span class="wdl-card__sub">{{ d.title }}</span> }
                      </div>
                      @if (d.data; as x) {
                        @if (x.checks || x.approvals || x.changesRequested) {
                          <div class="wdl-card__facts">
                            @if (x.checks === 'success') { <span class="wdl-fact wdl-fact--ok"><mat-icon>check_circle</mat-icon>Checks ok</span> }
                            @else if (x.checks === 'failure') { <span class="wdl-fact wdl-fact--bad"><mat-icon>cancel</mat-icon>Checks falharam@if (x.checksFailed) { ({{ x.checksFailed }}) }</span> }
                            @else if (x.checks === 'pending') { <span class="wdl-fact wdl-fact--wait"><mat-icon>pending</mat-icon>Checks rodando</span> }
                            @if (x.approvals) { <span class="wdl-fact wdl-fact--ok"><mat-icon>thumb_up</mat-icon>{{ x.approvals }} aprovaç{{ x.approvals === 1 ? 'ão' : 'ões' }}</span> }
                            @if (x.changesRequested) { <span class="wdl-fact wdl-fact--bad"><mat-icon>rate_review</mat-icon>Alterações pedidas</span> }
                          </div>
                        }
                        @if (x.alreadyExisted) { <p class="wdl-card__note"><mat-icon>info_outline</mat-icon>O PR já existia — a sub-tarefa reaproveitou o aberto.</p> }
                      }
                    }
                    @case ('branch') {
                      <div class="wdl-card__main">
                        @if (branchUrl(d); as u) { <a class="wdl-card__title wdl-mono" [href]="u" target="_blank" rel="noopener">{{ d.branch || d.title }}</a> }
                        @else { <span class="wdl-card__title wdl-mono">{{ d.branch || d.title }}</span> }
                        <span class="wdl-card__meta">
                          @if (d.repository) { <span>{{ d.repository }}</span> }
                          @if (base(d); as b) { <span>base <code>{{ b }}</code></span> }
                          @if (d.sha) { <code>{{ sha(d.sha) }}</code> }
                        </span>
                      </div>
                      @if (d.data?.commits?.length) { <ng-container *ngTemplateOutlet="commits; context: { $implicit: d }"></ng-container> }
                    }
                    @case ('code') {
                      <div class="wdl-card__main">
                        <span class="wdl-card__meta">
                          @if (d.repository) { <b>{{ d.repository }}</b> }
                          @if (d.branch) {
                            @if (branchUrl(d); as u) { <a class="wdl-mono" [href]="u" target="_blank" rel="noopener">{{ d.branch }}</a> }
                            @else { <code>{{ d.branch }}</code> }
                          }
                          @if (base(d); as b) { <span>base <code>{{ b }}</code></span> }
                        </span>
                        <span class="wdl-card__stats">
                          @if (d.data?.commits?.length) { <span>{{ d.data!.commits!.length }} commit{{ d.data!.commits!.length === 1 ? '' : 's' }}</span> }
                          @if (d.data?.files != null) { <span>{{ d.data!.files }} arquivo{{ d.data!.files === 1 ? '' : 's' }}</span> }
                          @if (d.data?.additions != null) { <b class="wdl-add">+{{ d.data!.additions }}</b> }
                          @if (d.data?.deletions != null) { <b class="wdl-del">−{{ d.data!.deletions }}</b> }
                          @if (d.data?.truncated) { <span class="wdl-chip" matTooltip="O diff passou de 2 MB e foi gravado cortado">cortado</span> }
                        </span>
                      </div>
                      @if (d.data?.commits?.length) { <ng-container *ngTemplateOutlet="commits; context: { $implicit: d }"></ng-container> }
                      @if (d.data?.fileList?.length) {
                        <details class="wdl-files">
                          <summary>Arquivos alterados ({{ d.data!.fileList!.length }}@if ((d.data!.files ?? 0) > d.data!.fileList!.length) { de {{ d.data!.files }} })</summary>
                          <ul>
                            @for (f of d.data!.fileList!; track f.path) {
                              <li><span class="wdl-files__st wdl-files__st--{{ f.status || 'modified' }}">{{ fileMark(f.status) }}</span>
                                <span class="wdl-mono wdl-files__path">{{ f.path }}</span>
                                <span class="wdl-files__n"><b class="wdl-add">+{{ f.additions ?? 0 }}</b> <b class="wdl-del">−{{ f.deletions ?? 0 }}</b></span></li>
                            }
                          </ul>
                        </details>
                      }
                    }
                    @case ('commit') {
                      <div class="wdl-card__main">
                        <span class="wdl-card__meta">
                          @if (commitUrl(d); as u) { <a class="wdl-mono" [href]="u" target="_blank" rel="noopener">{{ sha(d.sha) || 'commit' }}</a> }
                          @else if (d.sha) { <code>{{ sha(d.sha) }}</code> }
                          <span class="wdl-card__sub">{{ d.data?.title || d.title }}</span>
                        </span>
                        @if (d.repository || d.branch) { <span class="wdl-card__meta">{{ d.repository }}@if (d.branch) { · <code>{{ d.branch }}</code> }</span> }
                      </div>
                    }
                    @case ('ticket') {
                      <div class="wdl-card__main">
                        @if (d.url) { <a class="wdl-card__title" [href]="d.url" target="_blank" rel="noopener">{{ d.title || d.url }}</a> }
                        @else { <span class="wdl-card__title">{{ d.title || 'Chamado' }}</span> }
                        @if (d.data?.system) { <span class="wdl-card__meta">{{ d.data!.system }}</span> }
                      </div>
                    }
                    @case ('devops-state') {
                      <div class="wdl-card__main">
                        @if (d.data?.from || d.data?.to) {
                          <span class="wdl-card__meta"><b>{{ d.data?.from || '?' }}</b><mat-icon class="wdl__arrow">arrow_forward</mat-icon><b>{{ d.data?.to || '?' }}</b></span>
                        } @else if (d.title) { <span class="wdl-card__title">{{ d.title }}</span> }
                        @if (d.data?.action) { <span class="wdl-card__sub">Ação: {{ d.data!.action }}</span> }
                        @if (d.url) { <a class="wdl-link" [href]="d.url" target="_blank" rel="noopener"><mat-icon>open_in_new</mat-icon>Abrir no DevOps</a> }
                      </div>
                    }
                    @case ('hours') {
                      <div class="wdl-card__main">
                        <span class="wdl-card__title">{{ hours(d) || d.title || 'Horas' }}</span>
                        @if (d.title && hours(d)) { <span class="wdl-card__sub">{{ d.title }}</span> }
                      </div>
                    }
                    @default {
                      <div class="wdl-card__main">
                        @if (d.title) {
                          @if (d.url && !isText(d.kind)) { <a class="wdl-card__title" [href]="d.url" target="_blank" rel="noopener">{{ d.title }}</a> }
                          @else { <span class="wdl-card__title">{{ d.title }}</span> }
                        } @else if (d.url && !isText(d.kind)) {
                          <a class="wdl-card__title" [href]="d.url" target="_blank" rel="noopener">{{ d.url }}</a>
                        }
                        @if (isText(d.kind) && d.text) {
                          <p class="wdl-text" [class.wdl-text--clamp]="isLong(d) && !expanded().has(d.id)">{{ d.text }}</p>
                          @if (isLong(d)) {
                            <button type="button" class="wdl-btn wdl-btn--link" (click)="toggleText(d)">{{ expanded().has(d.id) ? 'Ver menos' : 'Ver mais' }}</button>
                          }
                        }
                        @if (isText(d.kind) && d.url) { <a class="wdl-link" [href]="d.url" target="_blank" rel="noopener"><mat-icon>open_in_new</mat-icon>Abrir</a> }
                      </div>
                    }
                  }

                  @if (actionsOf(d); as a) {
                    @if (a.github || a.diff) {
                      <div class="wdl-card__acts">
                        @if (a.github) { <a class="wdl-btn" [href]="a.github" target="_blank" rel="noopener"><mat-icon>open_in_new</mat-icon>Abrir no GitHub</a> }
                        @if (a.diff) {
                          <button type="button" class="wdl-btn" (click)="toggleDiff(d)" [attr.aria-expanded]="diffOpen().has(d.id)">
                            <mat-icon>{{ diffOpen().has(d.id) ? 'expand_less' : 'difference' }}</mat-icon>{{ diffOpen().has(d.id) ? 'Esconder alterações' : a.diff }}
                          </button>
                        }
                      </div>
                    }
                  }
                  @if (diffLoaded().has(d.id) && itemNumber() != null) {
                    <app-deliverable-diff class="wdl-card__diff" [class.wdl-hide]="!diffOpen().has(d.id)" [itemNumber]="itemNumber()!" [deliverableId]="d.id" [fallbackUrl]="d.url ?? null" />
                  }
                </li>
              }
            </ul>
          </section>
        }
      </div>
    }

    <ng-template #commits let-d>
      <ul class="wdl-commits">
        @for (c of commitsOf(d); track c.sha) {
          <li><code>{{ sha(c.sha) }}</code><span>{{ c.title }}</span></li>
        }
      </ul>
      @if (d.data.commits.length > shownCommits && !moreCommits().has(d.id)) {
        <button type="button" class="wdl-btn wdl-btn--link" (click)="showCommits(d)">mais {{ d.data.commits.length - shownCommits }} commit{{ d.data.commits.length - shownCommits === 1 ? '' : 's' }}</button>
      }
    </ng-template>
  `,
  styles: [`
    :host { display: block; min-width: 0; --wdl-add: #2ea043; --wdl-del: #e5534b; --wdl-merged: #a371f7; --wdl-wait: #d29922; --wdl-gray: #8b949e; }
    .wdl { display: flex; flex-direction: column; gap: 12px; min-width: 0; font-size: 13px; }
    .wdl__group { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .wdl__group-title { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 12px; font-weight: 600; color: var(--cc-text-2); }
    .wdl__group-title mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .wdl__group-title small { color: var(--cc-text-3); font-weight: 400; }
    .wdl__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .wdl__spacer { flex: 1; }
    .wdl__arrow { font-size: 14px; width: 14px; height: 14px; color: var(--cc-text-3); flex: none; }
    .wdl-card { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 8px 10px; border-radius: 10px;
      border: 1px solid var(--cc-surface-border-strong, rgba(127,127,127,.3));
      background: color-mix(in srgb, var(--mat-sys-on-surface) 3%, transparent); }
    .wdl--compact .wdl-card { padding: 6px 8px; gap: 4px; }
    .wdl-card--reverted { opacity: .62; }
    .wdl-card--reverted .wdl-card__title { text-decoration: line-through; }
    .wdl-card__head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; min-width: 0; }
    .wdl-card__ico { font-size: 16px; width: 16px; height: 16px; color: var(--cc-text-2); flex: none; }
    .wdl-card__kind { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--cc-text-3); }
    .wdl-card__at { color: var(--cc-text-3); font-size: 11px; white-space: nowrap; }
    .wdl-card__main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .wdl-card__title { font-weight: 600; color: var(--mat-sys-on-surface); overflow-wrap: anywhere; text-decoration: none; }
    a.wdl-card__title { color: var(--mat-sys-primary); }
    a.wdl-card__title:hover { text-decoration: underline; }
    .wdl-card__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; font-size: 12px; color: var(--cc-text-2); min-width: 0; overflow-wrap: anywhere; }
    .wdl-card__meta code, .wdl-commits code, .wdl-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; overflow-wrap: anywhere; }
    .wdl-card__meta a, a.wdl-mono { color: var(--mat-sys-primary); text-decoration: none; }
    .wdl-card__meta a:hover, a.wdl-mono:hover { text-decoration: underline; }
    .wdl-card__sub { font-size: 12px; color: var(--cc-text-2); overflow-wrap: anywhere; }
    .wdl-card__stats { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 10px; font-size: 12px; color: var(--cc-text-2); font-variant-numeric: tabular-nums; }
    .wdl-card__facts { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 12px; }
    .wdl-card__note { display: flex; align-items: center; gap: 5px; margin: 0; font-size: 12px; color: var(--cc-text-2); }
    .wdl-card__note mat-icon { font-size: 15px; width: 15px; height: 15px; flex: none; }
    .wdl-card__acts { display: flex; flex-wrap: wrap; gap: 6px 12px; }
    .wdl-card__diff { margin-top: 2px; }
    .wdl-add { color: color-mix(in srgb, var(--wdl-add) 80%, var(--mat-sys-on-surface)); font-weight: 600; }
    .wdl-del { color: color-mix(in srgb, var(--wdl-del) 80%, var(--mat-sys-on-surface)); font-weight: 600; }
    .wdl-fact { display: inline-flex; align-items: center; gap: 4px; color: var(--cc-text-2); }
    .wdl-fact mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .wdl-fact--ok mat-icon { color: color-mix(in srgb, var(--wdl-add) 80%, var(--mat-sys-on-surface)); }
    .wdl-fact--bad mat-icon { color: color-mix(in srgb, var(--wdl-del) 80%, var(--mat-sys-on-surface)); }
    .wdl-fact--wait mat-icon { color: color-mix(in srgb, var(--wdl-wait) 85%, var(--mat-sys-on-surface)); }
    .wdl-chip { display: inline-flex; align-items: center; gap: 3px; padding: 0 7px; border-radius: 999px; font: inherit; font-size: 10.5px; line-height: 17px;
      border: 1px solid var(--cc-surface-border-strong, rgba(127,127,127,.3)); color: var(--cc-text-2); background: transparent; white-space: nowrap; }
    .wdl-chip mat-icon { font-size: 12px; width: 12px; height: 12px; }
    .wdl-chip--task { cursor: pointer; font-weight: 600; font-variant-numeric: tabular-nums; }
    .wdl-chip--task:hover { border-color: var(--mat-sys-primary); color: var(--mat-sys-on-surface); }
    .wdl-chip--reverted { color: color-mix(in srgb, var(--wdl-merged) 80%, var(--mat-sys-on-surface)); border-color: color-mix(in srgb, var(--wdl-merged) 45%, transparent); }
    /* Estado do PR (cores do GitHub, como em github-pr-list) — o texto se mistura com a cor do tema para ler bem nos dois. */
    .wdl-st { --c: var(--wdl-gray); display: inline-flex; align-items: center; padding: 0 8px; border-radius: 999px; font-size: 10.5px; font-weight: 700;
      letter-spacing: .3px; line-height: 17px; white-space: nowrap; color: color-mix(in srgb, var(--c) 80%, var(--mat-sys-on-surface));
      background: color-mix(in srgb, var(--c) 15%, transparent); border: 1px solid color-mix(in srgb, var(--c) 40%, transparent); }
    .wdl-st--open { --c: var(--wdl-add); }
    .wdl-st--merged { --c: var(--wdl-merged); }
    .wdl-st--closed { --c: var(--wdl-del); }
    .wdl-st--draft { --c: var(--wdl-gray); }
    .wdl-st--resolved { --c: var(--wdl-add); }
    .wdl-st--pending { --c: var(--wdl-wait); }
    .wdl-hide { display: none !important; }
    .wdl-btn { display: inline-flex; align-items: center; gap: 4px; padding: 0; border: 0; background: none; font: inherit; font-size: 12px; cursor: pointer;
      color: var(--mat-sys-primary); text-decoration: none; }
    .wdl-btn:hover { text-decoration: underline; }
    .wdl-btn mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .wdl-btn--link { align-self: flex-start; font-size: 11.5px; }
    .wdl-link { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--mat-sys-primary); text-decoration: none; width: fit-content; }
    .wdl-link:hover { text-decoration: underline; }
    .wdl-link mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .wdl-text { margin: 0; font-size: 12.5px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--mat-sys-on-surface); }
    .wdl-text--clamp { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
    .wdl-commits { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
    .wdl-commits li { display: flex; gap: 8px; min-width: 0; }
    .wdl-commits code { flex: none; color: var(--cc-text-2); }
    .wdl-commits span { min-width: 0; overflow-wrap: anywhere; }
    .wdl-files { font-size: 12px; }
    .wdl-files summary { cursor: pointer; color: var(--mat-sys-primary); width: fit-content; }
    .wdl-files ul { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 2px; max-height: 260px; overflow: auto; }
    .wdl-files li { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
    .wdl-files__st { flex: none; width: 12px; font-weight: 700; text-align: center; color: var(--cc-text-3); }
    .wdl-files__st--added { color: color-mix(in srgb, var(--wdl-add) 80%, var(--mat-sys-on-surface)); }
    .wdl-files__st--removed { color: color-mix(in srgb, var(--wdl-del) 80%, var(--mat-sys-on-surface)); }
    .wdl-files__path { flex: 1; min-width: 0; }
    .wdl-files__n { flex: none; white-space: nowrap; font-variant-numeric: tabular-nums; }
  `]
})
export class WorkDeliverablesComponent {
  readonly deliverables = input<readonly WorkDeliverable[] | null | undefined>([]);
  readonly card = input<string | null>(null);
  /** Item das entregas (o diff é por item). */
  readonly itemNumber = input<number | null>(null);
  /** Mostra o `#n` da sub-tarefa (aba Entregas do item). */
  readonly showTask = input(false);
  readonly compact = input(false);
  /** Cabeçalho por grupo (PRs, código e branches, chamados, card, outros). */
  readonly grouped = input(false);
  /** Clique no `#n` da sub-tarefa. */
  readonly openTask = output<number>();

  private pickers = inject(WorkItemPickerSource);

  readonly list = computed(() => (this.deliverables() ?? []).slice());
  readonly groups = computed<DeliverableGroup[]>(() => {
    const all = this.list();
    if (!all.length) return [];
    return this.grouped() ? groupDeliverables(all) : [{ key: 'other', label: '', icon: '', items: all }];
  });

  /** Diffs já abertos uma vez (ficam montados, só escondidos — não recarregam). */
  readonly diffLoaded = signal<ReadonlySet<string>>(new Set());
  readonly diffOpen = signal<ReadonlySet<string>>(new Set());
  readonly expanded = signal<ReadonlySet<string>>(new Set());
  readonly moreCommits = signal<ReadonlySet<string>>(new Set());
  readonly shownCommits = COMMITS_SHOWN;

  readonly num = formatWorkNumber;
  readonly icon = deliverableIcon;
  readonly label = deliverableLabel;
  readonly prLabel = prStatusLabel;
  readonly ticketLabel = ticketStatusLabel;
  readonly sha = shortSha;
  readonly prStatus = (d: WorkDeliverable) => prStatusOf(d);
  readonly hours = (d: WorkDeliverable) => formatHours(deliverableHours(d));
  readonly isText = (kind: string) => TEXT_KINDS.has(kind);
  readonly isLong = (d: WorkDeliverable) => (d.text ?? '').length > LONG_TEXT || (d.text ?? '').split('\n').length > 4;

  constructor() {
    this.pickers.ensureGithubUrl(null);
  }

  prTitle(d: WorkDeliverable): string {
    if (d.number != null) return [`#${d.number}`, d.repository].filter(Boolean).join(' · ');
    return d.title || d.url || 'Pull request';
  }

  base(d: WorkDeliverable): string | null {
    return d.target || d.data?.base || null;
  }

  /** Link da branch: a URL da entrega ou `github/<owner>/<repo>/tree/<branch>` quando a URL base é conhecida. */
  branchUrl(d: WorkDeliverable): string | null {
    if (d.kind === 'branch' && isUrl(d.url)) return d.url;
    const gh = this.pickers.githubUrl();
    if (!gh || !d.repository || !d.branch) return null;
    return `${gh}/${encodeURIComponent(d.repository)}/tree/${d.branch.split('/').map(encodeURIComponent).join('/')}`;
  }

  commitUrl(d: WorkDeliverable): string | null {
    if (isUrl(d.url)) return d.url;
    const gh = this.pickers.githubUrl();
    return gh && d.repository && d.sha ? `${gh}/${encodeURIComponent(d.repository)}/commit/${encodeURIComponent(d.sha)}` : null;
  }

  /** Ações do rodapé do cartão: GitHub (PR/código/branch com URL) e o diff (com `hasDiff`). */
  actionsOf(d: WorkDeliverable): { github: string | null; diff: string | null } {
    const diff = d.hasDiff && this.itemNumber() != null
      ? (d.kind === 'code' ? 'Ver código alterado' : 'Ver alterações')
      : null;
    let github: string | null = null;
    if (d.kind === 'pr' && isUrl(d.url)) github = d.url;
    else if (d.kind === 'code') github = isUrl(d.url) ? d.url : null;
    return { github, diff };
  }

  commitsOf(d: WorkDeliverable) {
    const all = d.data?.commits ?? [];
    return this.moreCommits().has(d.id) ? all : all.slice(0, COMMITS_SHOWN);
  }

  fileMark(status: string | null | undefined): string {
    switch (status) {
      case 'added': return 'A';
      case 'removed': return 'D';
      case 'renamed': return 'R';
      default: return 'M';
    }
  }

  toggleDiff(d: WorkDeliverable): void {
    if (!this.diffLoaded().has(d.id)) this.diffLoaded.set(new Set([...this.diffLoaded(), d.id]));
    this.diffOpen.set(toggled(this.diffOpen(), d.id));
  }

  toggleText(d: WorkDeliverable): void {
    this.expanded.set(toggled(this.expanded(), d.id));
  }

  showCommits(d: WorkDeliverable): void {
    this.moreCommits.set(new Set([...this.moreCommits(), d.id]));
  }
}

function toggled(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
}
