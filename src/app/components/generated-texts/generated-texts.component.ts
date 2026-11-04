import { Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ExecutionPlanService } from '../../services/execution-plan.service';
import { WsService } from '../../services/ws.service';
import { CardSituationService, situationAgo, situationDate } from '../card-situation/card-situation.service';
import {
  EXECUTION_PLAN_EVENT, ExecutionPlan, ExecutionPlanRealtimePayload,
} from '../execution-plan/execution-plan.model';
import { GeneratedText, PHASE_LABEL, artifactTexts, time } from './generated-texts.model';

const OPEN_KEY = 'prmake.generated-texts-open';
/** Quanto o aviso "O Claude gerou" fica na tela (ms). */
export const FRESH_MS = 12_000;
/** Só avisa de texto gravado há pouco (o outro plano carrega depois e não é "novo"). */
const FRESH_WINDOW_MS = 3 * 60_000;
const OTHER_RELOAD_MS = 800;
const MAX_SHOWN = 5;

/**
 * "Textos gerados" (0076) — o sistema conversa: no topo do plano, a lista compacta (recolhível) do que o
 * Claude/PRMake escreveu no card — os `.md` dos planos de análise e correção (Análise, Soluções propostas,
 * Descrição do PR, Root cause, Texto do chamado…) e o Resumo da situação (atual e o publicado) — com a
 * fase, quando, quem e **Ver** (diálogo com o texto renderizado, links de código/itens e copiar). Texto
 * novo pelo tempo real (`artifact`) → aviso discreto "O Claude gerou: X · Ver", que some sozinho.
 *
 * 0077: é o atalho da central de textos — "Ver" abre a central (`openTexts`) com o texto selecionado, onde dá
 * para editar, gerar de novo com IA e enviar ao DevOps.
 */
@Component({
  selector: 'app-generated-texts',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule],
  template: `
    @if (texts().length) {
      <section class="gt" [class.gt--open]="open()" aria-label="Textos gerados no card">
        <button type="button" class="gt__head" (click)="toggle()" [attr.aria-expanded]="open()">
          <mat-icon class="gt__icon">article</mat-icon>
          <span class="gt__kicker">Textos gerados</span>
          <span class="gt__count">{{ texts().length }}</span>
          @if (!open() && texts()[0]; as last) {
            <span class="gt__latest">Último: {{ last.label }}@if (ago(last.at)) { · {{ ago(last.at) }}}</span>
          }
          <span class="gt__spacer"></span>
          <mat-icon class="gt__chevron">{{ open() ? 'expand_less' : 'expand_more' }}</mat-icon>
        </button>

        @if (fresh(); as f) {
          <div class="gt__fresh" role="status" aria-live="polite">
            <span class="gt__fresh-dot" aria-hidden="true"></span>
            <span class="gt__fresh-text">{{ f.source === 'artifact' ? 'O Claude gerou' : 'O PRMake atualizou' }}: <strong>{{ f.label }}</strong></span>
            <button type="button" class="gt__fresh-view" (click)="view(f)">Ver</button>
            <button type="button" class="gt__fresh-x" (click)="dismissFresh()" aria-label="Fechar o aviso"><mat-icon>close</mat-icon></button>
          </div>
        }

        @if (open()) {
          <ul class="gt__list">
            @for (t of shown(); track t.key) {
              <li class="gt-item" [class.gt-item--new]="isNew(t)">
                <mat-icon class="gt-item__icon" aria-hidden="true">{{ t.icon }}</mat-icon>
                <span class="gt-item__label" [title]="t.source === 'artifact' ? (t.detail ?? '') : ''">{{ t.label }}</span>
                @if (t.phase) { <span class="gt-phase gt-phase--{{ t.phase }}">{{ phaseLabel[t.phase] }}</span> }
                @else { <span class="gt-phase gt-phase--card">Card</span> }
                <span class="gt-item__meta">
                  @if (t.source !== 'artifact' && t.detail) { <span class="gt-item__detail">{{ t.detail }}</span> }
                  @if (t.at) { <span [title]="date(t.at)">{{ ago(t.at) }}</span> }
                  @if (t.by) { <span class="gt-item__by">{{ t.by }}</span> }
                </span>
                <button type="button" class="gt-item__view" (click)="view(t)" [attr.aria-label]="'Ver ' + t.label">
                  <mat-icon>visibility</mat-icon>Ver
                </button>
              </li>
            }
            <li class="gt__more">
              @if (texts().length > maxShown && !showAll()) {
                <button type="button" (click)="showAll.set(true)">Mostrar todos ({{ texts().length }})</button>
              }
              <button type="button" class="gt__center" (click)="openTexts.emit(null)">
                <mat-icon>edit_note</mat-icon>Abrir a central de textos — editar, gerar de novo com IA, enviar
              </button>
            </li>
          </ul>
        }
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .gt { margin: 0 0 12px; border: 1px solid rgba(255,255,255,.08); border-radius: 10px; background: rgba(255,255,255,.025); overflow: hidden; font-size: 13px; }
    .gt__head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px 8px 12px; border: 0; background: none; color: inherit;
      font: inherit; text-align: left; cursor: pointer; }
    .gt__head:hover { background: rgba(255,255,255,.03); }
    .gt__head:focus-visible { outline: 2px solid #58a6ff; outline-offset: -2px; border-radius: 10px; }
    .gt__icon { flex: none; font-size: 18px; width: 18px; height: 18px; color: #79c0ff; }
    .gt__kicker { font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: color-mix(in srgb, var(--mat-sys-on-surface) 72%, transparent); }
    .gt__count { padding: 0 7px; border-radius: 999px; font-size: 11px; font-weight: 600; line-height: 18px; color: #c9d1d9; background: rgba(110,118,129,.28); }
    .gt__latest { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: color-mix(in srgb, var(--mat-sys-on-surface) 58%, transparent); }
    .gt__spacer { flex: 1; }
    .gt__chevron { flex: none; font-size: 20px; width: 20px; height: 20px; color: color-mix(in srgb, var(--mat-sys-on-surface) 60%, transparent); }

    .gt__fresh { display: flex; align-items: center; gap: 8px; margin: 0 10px 8px; padding: 6px 6px 6px 10px; border-radius: 8px; font-size: 12.5px;
      background: color-mix(in srgb, #58a6ff 12%, transparent); border: 1px solid color-mix(in srgb, #58a6ff 35%, transparent);
      animation: gt-in .25s ease-out; }
    .gt__fresh-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: #58a6ff; box-shadow: 0 0 0 3px color-mix(in srgb, #58a6ff 25%, transparent); animation: gt-pulse 1.6s ease-in-out infinite; }
    .gt__fresh-text { flex: 1 1 auto; min-width: 0; }
    .gt__fresh-view { flex: none; padding: 2px 8px; border: 0; border-radius: 6px; background: none; color: #79c0ff; font: inherit; font-weight: 600; cursor: pointer; }
    .gt__fresh-view:hover { background: color-mix(in srgb, #58a6ff 18%, transparent); }
    .gt__fresh-x { flex: none; display: inline-flex; padding: 2px; border: 0; border-radius: 6px; background: none; color: inherit; cursor: pointer; opacity: .7; }
    .gt__fresh-x .mat-icon { font-size: 16px; width: 16px; height: 16px; }
    @keyframes gt-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
    @keyframes gt-pulse { 50% { opacity: .35; } }

    .gt__list { list-style: none; margin: 0; padding: 4px 6px 6px; display: flex; flex-direction: column; border-top: 1px solid rgba(255,255,255,.06); }
    .gt-item { display: flex; align-items: center; gap: 8px; min-height: 34px; padding: 3px 4px 3px 8px; border-radius: 7px; transition: background-color .15s ease; }
    .gt-item + .gt-item { border-top: 1px solid rgba(255,255,255,.04); }
    .gt-item:hover { background: rgba(255,255,255,.035); }
    .gt-item--new { background: color-mix(in srgb, #58a6ff 10%, transparent); }
    .gt-item__icon { flex: none; font-size: 17px; width: 17px; height: 17px; color: #79c0ff; opacity: .9; }
    .gt-item__label { flex: 0 1 auto; min-width: 0; font-weight: 500; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gt-item__meta { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 0 6px; overflow: hidden; white-space: nowrap; font-size: 11.5px;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent); }
    .gt-item__meta > span + span::before { content: '·'; margin-right: 6px; opacity: .7; }
    .gt-item__detail { color: color-mix(in srgb, #d29922 80%, white); }
    .gt-item__by { overflow: hidden; text-overflow: ellipsis; }
    .gt-phase { flex: none; height: 16px; padding: 0 6px; border-radius: 4px; font-size: 9.5px; font-weight: 700; letter-spacing: .05em; line-height: 16px; text-transform: uppercase;
      --gt-phase: #8b9bb4; color: color-mix(in srgb, var(--gt-phase) 85%, white); background: color-mix(in srgb, var(--gt-phase) 15%, transparent); }
    .gt-phase--analysis { --gt-phase: #58a6ff; }
    .gt-phase--correction { --gt-phase: #3fb950; }
    .gt-phase--card { --gt-phase: #bc8cff; }
    .gt-item__view { flex: none; display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 10px 0 8px; border: 1px solid rgba(255,255,255,.12);
      border-radius: 6px; background: transparent; color: #79c0ff; font: inherit; font-size: 12px; font-weight: 500; cursor: pointer; transition: background-color .15s ease, border-color .15s ease; }
    .gt-item__view:hover, .gt-item__view:focus-visible { background: color-mix(in srgb, #58a6ff 14%, transparent); border-color: color-mix(in srgb, #58a6ff 45%, transparent); outline: none; }
    .gt-item__view .mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .gt__more { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; padding: 4px 8px 2px; }
    .gt__center { display: inline-flex; align-items: center; gap: 4px; }
    .gt__center .mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .gt__more button { padding: 2px 0; border: 0; background: none; color: var(--mat-sys-primary); font: inherit; font-size: 12px; cursor: pointer; }
    .gt__more button:hover { text-decoration: underline; }
    @media (max-width: 576px) {
      .gt__latest { display: none; }
      .gt-item { flex-wrap: wrap; row-gap: 2px; padding: 6px 4px 6px 8px; }
      .gt-item__label { flex: 1 1 calc(100% - 120px); white-space: normal; }
      .gt-item__meta { order: 5; flex-basis: 100%; padding-left: 25px; }
    }
    @media (prefers-reduced-motion: reduce) { .gt__fresh, .gt__fresh-dot { animation: none; } }
  `],
})
export class GeneratedTextsComponent {
  readonly cardNumber = input<string | number | null | undefined>(null);
  /** Plano em tela (análise ou correção). */
  readonly plan = input<ExecutionPlan | null>(null);
  /** Dupla análise ↔ correção (o outro plano é carregado aqui). */
  readonly pair = input<{ analysisId: string | null; correctionId: string | null } | null>(null);

  /** 0077: abre a central de textos com o texto selecionado (null = o primeiro). */
  readonly openTexts = output<string | null>();

  private api = inject(ExecutionPlanService);
  private situations = inject(CardSituationService);
  private ws = inject(WsService);

  readonly phaseLabel = PHASE_LABEL;
  readonly open = signal(loadOpen());
  readonly fresh = signal<GeneratedText | null>(null);
  readonly newKeys = signal<ReadonlySet<string>>(new Set());
  readonly now = signal(Date.now());
  /** Lista compacta: os mais recentes; "Mostrar todos" abre o resto. */
  readonly maxShown = MAX_SHOWN;
  readonly showAll = signal(false);
  readonly shown = computed(() => (this.showAll() ? this.texts() : this.texts().slice(0, MAX_SHOWN)));

  private readonly other = signal<ExecutionPlan | null>(null);
  private readonly card = computed(() => {
    const c = this.cardNumber();
    return c === null || c === undefined ? '' : `${c}`.trim();
  });
  private readonly otherId = computed(() => {
    const p = this.plan();
    const pair = this.pair();
    if (!p || !pair) return null;
    const id = pair.analysisId === p.id ? pair.correctionId : pair.analysisId;
    return id && id !== p.id ? id : null;
  });

  readonly texts = computed<GeneratedText[]>(() => {
    const plan = this.plan();
    const other = this.other();
    const list = artifactTexts([plan, other && other.id === this.otherId() ? other : null]);
    const card = this.card();
    const s = card ? this.situations.situationOf(card)() : null;
    if (s?.markdown && s.kind && s.kind !== 'none') {
      const published = !!s.publishedAt && !s.publishPending;
      list.push({
        key: 'summary',
        source: 'summary',
        label: 'Resumo da situação',
        icon: 'summarize',
        phase: null,
        at: s.publishedAt && published ? s.publishedAt : s.since,
        by: published ? s.publishedBy ?? null : null,
        detail: published ? 'publicado na discussion' : s.publishPending ? 'pronto para publicar' : 'não publicado',
        version: `summary@${hash(s.markdown)}`,
        markdown: s.markdown,
      });
      if (s.publishedMarkdown && s.publishPending) {
        list.push({
          key: 'published',
          source: 'published',
          label: 'Resumo publicado na discussion',
          icon: 'forum',
          phase: null,
          at: s.publishedAt ?? null,
          by: s.publishedBy ?? null,
          detail: 'versão anterior',
          version: `published@${s.publishedAt ?? ''}`,
          markdown: s.publishedMarkdown,
        });
      }
    }
    return list.sort((a, b) => time(b.at) - time(a.at));
  });

  private known: Set<string> | null = null;
  private knownCard = '';
  private freshTimer?: ReturnType<typeof setTimeout>;
  private otherTimer?: ReturnType<typeof setTimeout>;
  private otherSeq = 0;

  constructor() {
    // O outro plano da dupla (análise ↔ correção).
    effect(() => {
      const id = this.otherId();
      untracked(() => this.loadOther(id));
    });

    // Texto novo/regravado depois da 1ª carga → aviso "O Claude gerou".
    effect(() => {
      const list = this.texts();
      const card = this.card();
      untracked(() => this.detectFresh(card, list));
    });

    this.ws.on(EXECUTION_PLAN_EVENT, this.onRealtime);
    const clock = setInterval(() => this.now.set(Date.now()), 60_000);
    inject(DestroyRef).onDestroy(() => {
      this.ws.off(EXECUTION_PLAN_EVENT, this.onRealtime);
      clearInterval(clock);
      clearTimeout(this.freshTimer);
      clearTimeout(this.otherTimer);
    });
  }

  toggle(): void {
    const v = !this.open();
    this.open.set(v);
    try { localStorage.setItem(OPEN_KEY, v ? '1' : '0'); } catch { /* sem storage */ }
  }

  ago(iso: string | null | undefined): string {
    return situationAgo(iso, this.now());
  }

  date(iso: string | null | undefined): string {
    return situationDate(iso);
  }

  isNew(t: GeneratedText): boolean {
    return this.newKeys().has(t.key);
  }

  dismissFresh(): void {
    clearTimeout(this.freshTimer);
    this.fresh.set(null);
  }

  /** Abre o texto na central (0077) — o resumo (atual ou o publicado) é o "Resumo da situação" de lá. */
  view(t: GeneratedText): void {
    if (this.fresh()?.key === t.key) this.dismissFresh();
    this.openTexts.emit(t.source === 'artifact' ? t.key : 'situation');
  }

  private loadOther(id: string | null): void {
    const seq = ++this.otherSeq;
    if (!id) { this.other.set(null); return; }
    this.api.get(id).subscribe({
      next: p => { if (seq === this.otherSeq) this.other.set(p); },
      error: () => { if (seq === this.otherSeq) this.other.set(null); },
    });
  }

  /** Arquivo novo no outro plano da dupla (o plano em tela o componente pai já recarrega). */
  private onRealtime = (payload: ExecutionPlanRealtimePayload): void => {
    const card = payload?.cardNumber != null ? `${payload.cardNumber}`.trim() : '';
    if (!card || card !== this.card() || payload.action !== 'artifact') return;
    const otherId = this.otherId();
    if (!otherId || payload.planId !== otherId) return;
    clearTimeout(this.otherTimer);
    this.otherTimer = setTimeout(() => this.loadOther(this.otherId()), OTHER_RELOAD_MS);
  };

  private detectFresh(card: string, list: GeneratedText[]): void {
    if (card !== this.knownCard) {
      this.knownCard = card;
      this.showAll.set(false);
      this.known = null;
      this.dismissFresh();
      this.newKeys.set(new Set());
    }
    const versions = new Set(list.map(t => t.version));
    if (!this.known) {
      if (list.length) this.known = versions;
      return;
    }
    const now = Date.now();
    const added = list.filter(t => !this.known!.has(t.version)
      && (t.source !== 'artifact' || now - time(t.at) <= FRESH_WINDOW_MS));
    for (const v of versions) this.known.add(v);
    const newest = added.find(t => t.source === 'artifact') ?? null;
    if (!newest) return;
    this.fresh.set(newest);
    this.newKeys.set(new Set(added.map(t => t.key)));
    clearTimeout(this.freshTimer);
    this.freshTimer = setTimeout(() => { this.fresh.set(null); this.newKeys.set(new Set()); }, FRESH_MS);
  }
}

function loadOpen(): boolean {
  try { return localStorage.getItem(OPEN_KEY) !== '0'; } catch { return true; }
}

/** Hash curto (djb2) — versão do resumo. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
