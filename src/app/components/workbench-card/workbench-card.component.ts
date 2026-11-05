import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { CardFull } from '../card-details-dialog/card-full.model';
import { CardHoursInsightComponent } from '../card-hours-insight/card-hours-insight.component';
import { hasNoEstimate } from '../card-hours-insight/hours-insight';
import { CardAssistantService, formatHours, serverMessage } from '../../services/card-assistant.service';

/** Botões rápidos de "lançar horas" (horas). */
export const QUICK_HOURS = [1, 2, 4] as const;
export const MIN_LOG_HOURS = 0.5;
export const MAX_LOG_HOURS = 24;

const REPRO_FIELD = 'Microsoft.VSTS.TCM.ReproSteps';
const DESCRIPTION_FIELD = 'System.Description';
const ACCEPTANCE_FIELD = 'Microsoft.VSTS.Common.AcceptanceCriteria';

/** Texto de um campo do DevOps (identidade → nome; "-" = vazio). */
function fieldText(card: CardFull | null | undefined, key: string): string {
  const v = card?.fields?.[key];
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return `${v.displayName ?? v.name ?? ''}`.trim().replace(/\s*<.*>$/, '');
  const s = `${v}`.trim();
  return s === '-' ? '' : s.replace(/\s*<.*>$/, '');
}

/** "0,5" / "2h" / "1.5" → número; inválido → NaN. */
export function parseLogHours(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined) return NaN;
  const s = `${raw}`.trim().replace(',', '.').replace(/h$/i, '').trim();
  if (!s) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Valida o "outro": de 0,5 a 24h, em meias horas. Devolve a mensagem do erro, ou null quando vale. */
export function logHoursError(hours: number): string | null {
  if (!Number.isFinite(hours)) return 'Digite as horas (ex.: 3 ou 1,5).';
  if (hours < MIN_LOG_HOURS || hours > MAX_LOG_HOURS) return 'De 0,5 a 24h.';
  if (Math.round(hours * 2) !== hours * 2) return 'Use meias horas (ex.: 1,5).';
  return null;
}

interface CardDatum {
  key: string;
  label: string;
  value: string;
  icon: string;
  tooltip?: string;
}

/**
 * 0085 (ajustes): aba **Card** da Bancada (desktop e celular) — o que antes ficava no popover do botão "Card":
 * - **Horas**: `app-card-hours-insight` (Bug: Completed × média dos bugs; US: planejado × realizado) e **lançar horas**
 *   com +1h / +2h / +4h ou "outro" (0,5 a 24h) — confirmação curta antes de gravar (`POST Azure/card/{n}/actions/log-hours`
 *   pelo `CardAssistantService`, o mesmo do +1h do assistente, que recarrega as horas); erro do servidor visível.
 * - **Dados principais** do `CardFull` (estado, área, iteração, responsável, prioridade, datas, tags) e as contagens de
 *   anexos/links que o DevOps já manda nos campos (`System.AttachedFileCount`…).
 * - **Texto do card**: Repro Steps (Bug) ou Descrição + Critérios de aceite (US).
 *
 * Rodada 5: layout denso, sem sobra — faixa de cima com Horas (compacta; +1h/+2h/+4h/outro numa linha) e Dados do card
 * em grade de 2–3 colunas (pela largura do próprio cartão) com os contadores em chips numa linha; o texto do card ocupa
 * a largura toda (US: descrição e critérios lado a lado quando cabem). Serve à aba Card e ao modal
 * (`openWorkbenchCard`, workbench-card-dialog.component.ts).
 */
@Component({
  selector: 'app-workbench-card',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatTooltipModule, CardHoursInsightComponent],
  template: `
    @let st = effort();
    @let us = cardType() === 'user-story';
    <div class="wc">
      <!-- Faixa de cima: horas (compacta) + dados do card em grade (usa a largura toda, sem cartões estreitos) -->
      <div class="wc-top">
        <section class="wc-box wc-box--hours" aria-label="Horas do card" data-tour="wb-hours">
          <app-card-hours-insight [card]="card()" [cardType]="cardType()"></app-card-hours-insight>

          <div class="wc-log" role="group" aria-label="Lançar horas em Completed">
            <span class="wc-log__label" matTooltip="Lançar horas: soma em Completed e tira do Remaining (com confirmação)"
                  aria-label="Lançar horas">
              <mat-icon>more_time</mat-icon>
            </span>
            @for (q of quick; track q) {
              <button type="button" class="wc-btn" [class.wc-btn--on]="pending() === q && confirming()"
                      [disabled]="!card() || !!busy()" (click)="ask(q)"
                      [matTooltip]="'Lançar ' + h(q) + ' em Completed e tirar ' + h(q) + ' do Remaining'">+{{ h(q) }}</button>
            }
            <span class="wc-log__other">
              <input class="wc-input" type="text" inputmode="decimal" autocomplete="off" placeholder="outro"
                     aria-label="Outro valor de horas (0,5 a 24)" [(ngModel)]="other" [disabled]="!card() || !!busy()"
                     (keyup.enter)="askOther()" (ngModelChange)="otherError.set(null)"/>
              <span class="wc-log__unit">h</span>
              <button type="button" class="wc-btn" [disabled]="!card() || !!busy() || !other" (click)="askOther()"
                      matTooltip="Lançar o valor digitado">OK</button>
            </span>
          </div>
          @if (noEstimate()) {
            <button type="button" class="wc-link wc-link--start" [disabled]="!!busy()" (click)="estimate()">
              {{ busy() === 'estimate' ? 'Registrando…' : 'Registrar estimativa inicial' }}
            </button>
          }
          @if (otherError(); as err) { <p class="wc-hint wc-hint--bad" role="alert">{{ err }}</p> }

          @if (confirming() && pending(); as hrs) {
            <div class="wc-confirm" role="alertdialog" aria-label="Confirmar o lançamento de horas">
              <span>
                Lançar <strong>+{{ h(hrs) }}</strong> em Completed
                @if (st?.effort; as e) {
                  ({{ h(e.completedWork ?? 0) }} → {{ h((e.completedWork ?? 0) + hrs) }}) e −{{ h(hrs) }} no Remaining
                  ({{ h(e.remainingWork ?? 0) }} → {{ h(remainingAfter(hrs)) }})?
                } @else {
                  e tirar {{ h(hrs) }} do Remaining?
                }
              </span>
              <span class="wc-confirm__actions">
                <button type="button" class="wc-link" (click)="cancelLog()" [disabled]="!!busy()">Cancelar</button>
                <button type="button" class="wc-btn wc-btn--primary" (click)="log()" [disabled]="!!busy()">
                  {{ busy() === 'log' ? 'Lançando…' : 'Lançar' }}
                </button>
              </span>
            </div>
          }
          @if (message(); as m) {
            <div class="wc-msg" [class.wc-msg--error]="!m.ok" role="status">
              <mat-icon>{{ m.ok ? 'check_circle' : 'error_outline' }}</mat-icon><span>{{ m.text }}</span>
              <button type="button" class="wc-x" (click)="message.set(null)" aria-label="Fechar o aviso"><mat-icon>close</mat-icon></button>
            </div>
          }
        </section>

        <section class="wc-box wc-box--data" aria-label="Dados do card">
          <header class="wc-h"><mat-icon>info_outline</mat-icon>Dados do card
            <span class="wc-spacer"></span>
            @if (cardFull()) {
              <button type="button" class="wc-link" (click)="openDetails.emit()"
                      matTooltip="Todos os campos, o histórico e os comentários">Ver tudo</button>
            }
          </header>
          @if (!cardFull()) {
            <p class="wc-muted">Não foi possível ler o card no DevOps — os dados aparecem quando ele responder.</p>
          } @else {
            <dl class="wc-data">
              @for (d of data(); track d.key) {
                <div class="wc-data__row"
                     [matTooltip]="d.tooltip || ''" [matTooltipDisabled]="!d.tooltip">
                  <dt><mat-icon>{{ d.icon }}</mat-icon>{{ d.label }}</dt>
                  <dd>{{ d.value }}</dd>
                </div>
              }
            </dl>
            <div class="wc-foot">
              <div class="wc-links" aria-label="Anexos e links no DevOps">
                @for (l of links(); track l.label) {
                  <span class="wc-chip" [class.wc-chip--zero]="!l.count" [matTooltip]="l.tooltip">
                    <mat-icon>{{ l.icon }}</mat-icon><b>{{ l.count }}</b> {{ l.label }}
                  </span>
                }
              </div>
              @if (tags().length) {
                <div class="wc-tags" aria-label="Tags">
                  <mat-icon class="wc-tags__icon">sell</mat-icon>
                  @for (t of tags(); track t) { <span class="wc-tag">{{ t }}</span> }
                </div>
              }
            </div>
          }
        </section>
      </div>

      <!-- Texto do card na largura toda (US: descrição e critérios lado a lado quando cabem) -->
      <div class="wc-text" [class.wc-text--two]="sections().length > 1">
        @for (s of sections(); track s.title) {
          <section class="wc-box wc-box--text" [attr.aria-label]="s.title">
            <header class="wc-h"><mat-icon>{{ s.icon }}</mat-icon>{{ s.title }}</header>
            <div class="wc-rich" [innerHTML]="s.html"></div>
          </section>
        } @empty {
          <section class="wc-box wc-box--text" [attr.aria-label]="us ? 'Descrição e critérios de aceite' : 'Repro Steps'">
            <header class="wc-h"><mat-icon>notes</mat-icon>{{ us ? 'Descrição e critérios de aceite' : 'Repro Steps' }}</header>
            <p class="wc-muted">{{ !cardFull() ? 'Texto indisponível sem o DevOps.' : us ? 'A US não tem descrição nem critérios de aceite.' : 'O bug não tem Repro Steps.' }}</p>
          </section>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; min-width: 0; font-size: 13px; color: var(--cc-text-1); container-type: inline-size; container-name: wcard; }
    .wc { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    .wc-top { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; align-items: stretch; }
    @container wcard (min-width: 760px) { .wc-top { grid-template-columns: minmax(290px, 31%) minmax(0, 1fr); } }
    .wc-box { min-width: 0; display: flex; flex-direction: column; gap: 8px; padding: 10px 14px; border-radius: 10px;
      background: var(--surface-1, #262b33); border: 1px solid var(--cc-surface-border, rgba(255,255,255,.08)); }
    .wc-h { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 10.5px; font-weight: 700; letter-spacing: .06em;
      text-transform: uppercase; color: var(--cc-text-2); }
    .wc-h .mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--cc-text-3); }
    .wc-spacer { flex: 1 1 auto; }
    .wc-muted { margin: 0; color: var(--cc-text-3); }

    /* Lançar horas: uma linha (+1h +2h +4h outro OK) */
    .wc-log { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: auto; padding-top: 8px;
      border-top: 1px dashed var(--cc-surface-border, rgba(255,255,255,.08)); }
    .wc-log__label { display: inline-flex; align-items: center; gap: 4px; margin-right: 2px; font-size: 12px; color: var(--cc-text-2); cursor: default; }
    .wc-log__label .mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--cc-text-3); }
    .wc-log__other { display: inline-flex; align-items: center; gap: 4px; }
    .wc-log__unit { color: var(--cc-text-3); font-size: 12px; }
    .wc-btn { flex: none; height: 28px; padding: 0 7px; border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18));
      border-radius: 7px; background: transparent; color: #79c0ff; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer;
      font-variant-numeric: tabular-nums; }
    .wc-btn:hover:not(:disabled), .wc-btn--on { background: color-mix(in srgb, #58a6ff 14%, transparent); border-color: color-mix(in srgb, #58a6ff 45%, transparent); }
    .wc-btn:disabled { opacity: .5; cursor: default; }
    .wc-btn--primary { background: var(--mat-sys-primary); border-color: transparent; color: var(--mat-sys-on-primary); }
    .wc-btn--primary:hover:not(:disabled) { background: var(--mat-sys-primary); filter: brightness(1.08); }
    .wc-input { width: 50px; height: 28px; box-sizing: border-box; padding: 0 8px; border-radius: 7px; font: inherit; font-size: 12.5px;
      color: var(--cc-text-1); background: var(--surface-input, #1a1f28); border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); }
    .wc-input:focus { outline: none; border-color: var(--mat-sys-primary); }
    .wc-link { padding: 0 2px; border: 0; background: none; color: var(--mat-sys-primary); font: inherit; font-size: 12px; cursor: pointer;
      text-transform: none; letter-spacing: 0; font-weight: 500; }
    .wc-link--start { align-self: flex-start; }
    .wc-link:hover:not(:disabled) { text-decoration: underline; }
    .wc-link:disabled { opacity: .5; cursor: default; }
    .wc-hint { margin: 0; font-size: 12px; }
    .wc-hint--bad { color: #f2b8b5; }
    .wc-confirm { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 12px; padding: 7px 8px 7px 10px; border-radius: 8px;
      background: color-mix(in srgb, #58a6ff 9%, transparent); border: 1px solid color-mix(in srgb, #58a6ff 28%, transparent); }
    .wc-confirm > span:first-child { flex: 1 1 220px; line-height: 1.45; }
    .wc-confirm__actions { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; }
    .wc-msg { display: flex; align-items: flex-start; gap: 6px; padding: 6px 6px 6px 9px; border-radius: 8px;
      color: color-mix(in srgb, #3fb950 75%, white); background: color-mix(in srgb, #3fb950 9%, transparent); }
    .wc-msg--error { color: #f2b8b5; background: color-mix(in srgb, #f85149 10%, transparent); }
    .wc-msg .mat-icon { flex: none; font-size: 16px; width: 16px; height: 16px; margin-top: 1px; }
    .wc-msg > span { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
    .wc-x { flex: none; display: inline-flex; padding: 0; border: 0; background: none; color: inherit; cursor: pointer; opacity: .7; }
    .wc-x .mat-icon { font-size: 15px; width: 15px; height: 15px; }

    /* Dados: pares rótulo/valor em 2–3 colunas (pela largura do próprio cartão) */
    .wc-box--data { container-type: inline-size; container-name: wdata; }
    .wc-data { margin: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px 18px; }
    @container wdata (min-width: 340px) { .wc-data { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @container wdata (min-width: 470px) { .wc-data { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    .wc-data__row { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .wc-data dt { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--cc-text-3); white-space: nowrap; }
    .wc-data dt .mat-icon { flex: none; font-size: 13px; width: 13px; height: 13px; }
    .wc-data dd { margin: 0; color: var(--cc-text-1); line-height: 1.35; overflow-wrap: anywhere; }
    .wc-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; margin-top: auto; padding-top: 8px;
      border-top: 1px dashed var(--cc-surface-border, rgba(255,255,255,.08)); }
    .wc-tags, .wc-links { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
    .wc-tags__icon { font-size: 15px; width: 15px; height: 15px; color: var(--cc-text-3); }
    .wc-tag { padding: 1px 8px; border-radius: 999px; font-size: 11.5px; color: var(--cc-text-2);
      background: color-mix(in srgb, var(--mat-sys-on-surface) 8%, transparent); }
    .wc-chip { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px; border-radius: 11px; font-size: 12px;
      color: var(--cc-text-1); border: 1px solid var(--cc-surface-border, rgba(255,255,255,.08)); cursor: default; white-space: nowrap; }
    .wc-chip b { font-weight: 700; font-variant-numeric: tabular-nums; }
    .wc-chip .mat-icon { font-size: 14px; width: 14px; height: 14px; color: var(--cc-text-3); }
    .wc-chip--zero { color: var(--cc-text-3); }
    .wc-chip--zero b { font-weight: 500; }

    /* Texto do card na largura toda; US com duas seções lado a lado quando cabe */
    .wc-text { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; align-items: start; }
    @container wcard (min-width: 720px) { .wc-text--two { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

    /* HTML do DevOps (Repro Steps / Descrição / Critérios de aceite) */
    .wc-rich { line-height: 1.55; overflow-wrap: anywhere; color: var(--cc-text-1); }
    .wc-rich ::ng-deep p, .wc-rich ::ng-deep ul, .wc-rich ::ng-deep ol { margin: 0 0 6px; }
    .wc-rich ::ng-deep ul, .wc-rich ::ng-deep ol { padding-left: 20px; }
    .wc-rich ::ng-deep img { max-width: 100%; height: auto; border-radius: 6px; }
    .wc-rich ::ng-deep table { border-collapse: collapse; max-width: 100%; display: block; overflow-x: auto; }
    .wc-rich ::ng-deep td, .wc-rich ::ng-deep th { border: 1px solid var(--cc-surface-border, rgba(255,255,255,.08)); padding: 2px 6px; }
    .wc-rich ::ng-deep a { color: #79b8ff; }
    /* Cores fixas do editor do DevOps somem no tema escuro. */
    .wc-rich ::ng-deep *[style*="color"] { color: inherit !important; }
    .wc-rich ::ng-deep *[style*="background"] { background: transparent !important; }
  `],
})
export class WorkbenchCardComponent {
  /** Número do card aberto na Bancada. */
  readonly card = input<string | null>(null);
  /** 'bug' | 'user-story' (decide o texto e a comparação das horas). */
  readonly cardType = input<string | null>('bug');
  /** Card lido no DevOps (null = DevOps indisponível; horas e lançamento seguem tentando). */
  readonly cardFull = input<CardFull | null>(null);
  /** "Ver tudo" — a página abre o diálogo de detalhes (campos, histórico, comentários). */
  readonly openDetails = output<void>();

  private svc = inject(CardAssistantService);

  readonly quick = QUICK_HOURS;
  /** Valor digitado no "outro". */
  other = '';
  readonly otherError = signal<string | null>(null);
  /** Horas a lançar aguardando a confirmação. */
  readonly pending = signal<number | null>(null);
  readonly confirming = signal(false);
  readonly busy = signal<'log' | 'estimate' | null>(null);
  readonly message = signal<{ ok: boolean; text: string } | null>(null);

  readonly effort = computed(() => {
    const c = this.card();
    return c ? this.svc.effortOf(c)() : null;
  });
  readonly noEstimate = computed(() => {
    const st = this.effort();
    return st?.status === 'ready' && hasNoEstimate(st.effort);
  });

  readonly data = computed<CardDatum[]>(() => {
    const cf = this.cardFull();
    if (!cf) return [];
    const t = (k: string) => fieldText(cf, k);
    const rows: CardDatum[] = [];
    const push = (key: string, label: string, value: string, icon: string, tooltip?: string) => {
      if (value) rows.push({ key, label, value, icon, tooltip });
    };
    const state = t('System.State');
    const column = t('System.BoardColumn');
    push('state', 'Estado', [state, column && column !== state ? column : ''].filter(Boolean).join(' · '), 'flag',
      [column && `Coluna: ${column}`, t('System.BoardLane') && `Raia: ${t('System.BoardLane')}`, t('System.Reason') && `Motivo: ${t('System.Reason')}`]
        .filter(Boolean).join('\n'));
    push('assigned', 'Responsável', t('System.AssignedTo'), 'person');
    const priority = t('Microsoft.VSTS.Common.Priority');
    const severity = t('Microsoft.VSTS.Common.Severity');
    push('priority', this.cardType() === 'user-story' || !severity ? 'Prioridade' : 'Prioridade · severidade',
      [priority && `P${priority}`, this.cardType() === 'user-story' ? '' : severity].filter(Boolean).join(' · '), 'priority_high');
    push('points', 'Story points', t('Microsoft.VSTS.Scheduling.StoryPoints'), 'stacked_bar_chart');
    push('env', 'Ambiente', t('Custom.Environment'), 'dns');
    push('module', 'Módulo', t('Custom.Module'), 'widgets');
    const area = t('System.AreaPath');
    push('area', 'Área', lastPart(area), 'folder_open', area);
    const iteration = t('System.IterationPath');
    push('iteration', 'Iteração', lastPart(iteration), 'event_repeat', iteration);
    push('created', 'Criado', who(dateText(t('System.CreatedDate')), t('System.CreatedBy')), 'add_circle_outline');
    push('changed', 'Alterado', who(dateText(t('System.ChangedDate')), t('System.ChangedBy')), 'update');
    return rows;
  });

  readonly tags = computed(() => fieldText(this.cardFull(), 'System.Tags').split(';').map((s) => s.trim()).filter(Boolean));

  /** Contagens que o DevOps manda nos campos (`$expand=all`) — sem outra chamada. */
  readonly links = computed(() => {
    const cf = this.cardFull();
    const n = (k: string) => {
      const v = Number(cf?.fields?.[k]);
      return Number.isFinite(v) && v > 0 ? v : 0;
    };
    return [
      { icon: 'attach_file', label: n('System.AttachedFileCount') === 1 ? 'anexo' : 'anexos', count: n('System.AttachedFileCount'),
        tooltip: 'Arquivos anexados ao card no DevOps' },
      { icon: 'link', label: n('System.HyperLinkCount') === 1 ? 'link' : 'links', count: n('System.HyperLinkCount'),
        tooltip: 'Hiperlinks do card no DevOps' },
      { icon: 'merge_type', label: 'de código', count: n('System.ExternalLinkCount'),
        tooltip: 'Links de código (PRs, commits, branches) ligados ao card' },
      { icon: 'account_tree', label: n('System.RelatedLinkCount') === 1 ? 'relacionado' : 'relacionados', count: n('System.RelatedLinkCount'),
        tooltip: 'Work items relacionados (pai, filhos, relacionados)' }
    ];
  });

  /** Repro Steps (Bug) ou Descrição + Critérios de aceite (US). */
  readonly sections = computed<{ title: string; icon: string; html: string }[]>(() => {
    const cf = this.cardFull();
    if (!cf) return [];
    const html = (key: string) => {
      const v = cf.fields?.[key];
      return typeof v === 'string' ? v.trim() : '';
    };
    const list = this.cardType() === 'user-story'
      ? [{ title: 'Descrição', icon: 'notes', html: html(DESCRIPTION_FIELD) },
         { title: 'Critérios de aceite', icon: 'fact_check', html: html(ACCEPTANCE_FIELD) }]
      : [{ title: 'Repro Steps', icon: 'format_list_numbered', html: html(REPRO_FIELD) || html(DESCRIPTION_FIELD) }];
    return list.filter((s) => !!s.html);
  });

  private loaded = '';

  constructor() {
    // Card novo: limpa a confirmação, o "outro" e os avisos do card anterior.
    effect(() => {
      const card = this.card() ?? '';
      untracked(() => {
        if (card === this.loaded) return;
        this.loaded = card;
        this.cancelLog();
        this.message.set(null);
        this.other = '';
        this.otherError.set(null);
      });
    });
  }

  h(v: number | null | undefined): string {
    return formatHours(v);
  }

  remainingAfter(hours: number): number {
    return Math.max(0, (this.effort()?.effort?.remainingWork ?? 0) - hours);
  }

  ask(hours: number): void {
    this.message.set(null);
    this.otherError.set(null);
    this.pending.set(hours);
    this.confirming.set(true);
  }

  askOther(): void {
    const hours = parseLogHours(this.other);
    const err = logHoursError(hours);
    if (err) {
      this.otherError.set(err);
      return;
    }
    this.ask(hours);
  }

  cancelLog(): void {
    this.confirming.set(false);
    this.pending.set(null);
  }

  async log(): Promise<void> {
    const card = this.card();
    const hours = this.pending();
    if (!card || !hours || this.busy()) return;
    this.busy.set('log');
    try {
      // O serviço recarrega as horas depois (deu certo ou não).
      const res = await this.svc.logHours(card, hours);
      this.message.set({ ok: true, text: res?.message || `+${formatHours(hours)} lançada(s) em Completed.` });
      this.cancelLog();
      this.other = '';
    } catch (err) {
      this.message.set({ ok: false, text: serverMessage(err, 'O DevOps não aceitou o lançamento de horas.') });
    } finally {
      this.busy.set(null);
    }
  }

  async estimate(): Promise<void> {
    const card = this.card();
    if (!card || this.busy()) return;
    this.busy.set('estimate');
    this.message.set(null);
    try {
      const res = await this.svc.initialEstimate(card);
      this.message.set({ ok: true, text: res?.message || 'Estimativa inicial registrada no DevOps.' });
    } catch (err) {
      this.message.set({ ok: false, text: serverMessage(err, 'Não foi possível registrar a estimativa no DevOps.') });
    } finally {
      this.busy.set(null);
    }
  }
}

/** "Solvace\\Product Development\\Core" → "Core". */
function lastPart(path: string): string {
  const parts = path.split('\\').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function dateText(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function who(date: string, name: string): string {
  return [date, name && `por ${name}`].filter(Boolean).join(' ');
}
