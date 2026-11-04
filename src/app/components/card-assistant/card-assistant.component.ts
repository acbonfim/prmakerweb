import { Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription } from 'rxjs';
import { renderMarkdown } from '../../helpers/markdown-ext';
import { CardAssistantService, CardSuggestion, isPending, serverMessage } from '../../services/card-assistant.service';
import { situationAgo, situationDate } from '../card-situation/card-situation.service';
import { CardHoursComponent } from './card-hours.component';

const COLLAPSED_KEY = 'prmake.assistant-collapsed';
/** Quanto a sugestão nova fica destacada (ms). */
const FLASH_MS = 6000;
/** Abertas visíveis antes do "Mais N sugestões" (o bloco não empurra o plano para baixo demais). */
const MAX_VISIBLE = 2;

const KIND_ICON: Record<string, string> = {
  'initial-estimate': 'timer',
  'log-hours': 'more_time',
  'situation-auto-post': 'campaign',
};

/**
 * "O PRMake conversa" (0078) — assistente no topo do plano: mensagens do sistema com o que o PRMake sugere
 * fazer no card (estimativa inicial, publicar os resumos de espera, lançar horas), com as ações (a primária em
 * destaque) e "Dispensar". **Nunca bloqueia**: o plano e a skill seguem; ninguém espera a resposta. Respondidas
 * viram uma linha no histórico (recolhido); falhou → a mensagem do DevOps e "Tentar de novo". Sugestão nova pelo
 * tempo real → aviso discreto (snackbar) "O PRMake tem uma sugestão: X · Ver". Inclui a linha de horas do card.
 */
@Component({
  selector: 'app-card-assistant',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule, CardHoursComponent],
  template: `
    @if (card()) {
      <section class="as" [class.as--collapsed]="collapsed()" role="region" aria-label="Assistente do PRMake neste card">
        <div class="as__head">
          <button type="button" class="as__toggle" (click)="toggle()" [attr.aria-expanded]="!collapsed()"
                  [matTooltip]="collapsed() ? 'Mostrar as sugestões do PRMake' : 'Recolher'">
            <span class="as__avatar" aria-hidden="true"><mat-icon>assistant</mat-icon></span>
            <span class="as__kicker">PRMake</span>
            @if (pending().length; as n) {
              <span class="as__count" [attr.aria-label]="n + ' sugestões abertas'">{{ n === 1 ? '1 sugestão' : n + ' sugestões' }}</span>
              @if (collapsed()) { <span class="as__latest">{{ pending()[0].title }}</span> }
            } @else if (loaded()) {
              <span class="as__quiet">nada pendente</span>
            }
            <mat-icon class="as__chevron">{{ collapsed() ? 'expand_more' : 'expand_less' }}</mat-icon>
          </button>
          <app-card-hours class="as__hours" [cardNumber]="card()"></app-card-hours>
        </div>

        @if (!collapsed()) {
          @if (loadError()) {
            <div class="as__error" role="alert">
              <mat-icon>error_outline</mat-icon><span>{{ loadError() }}</span>
              <button type="button" class="as__link" (click)="reload()">Tentar de novo</button>
            </div>
          }
          @if (pending().length) {
            <ol class="as__msgs" aria-label="Sugestões abertas">
              @for (s of visible(); track s.id) {
                <li class="msg" [class.msg--failed]="s.status === 'failed'" [class.msg--flash]="flashId() === s.id" [attr.data-suggestion]="s.id">
                  <span class="msg__avatar" aria-hidden="true"><mat-icon>{{ icon(s) }}</mat-icon></span>
                  <div class="msg__body">
                    <div class="msg__top">
                      <span class="msg__title">{{ s.title }}</span>
                      <span class="msg__when" [title]="date(s.createdAt)">{{ ago(s.createdAt) }}</span>
                    </div>
                    @if (s.text) { <div class="msg__text" [innerHTML]="md(s.text)"></div> }
                    @if (s.status === 'failed') {
                      <div class="msg__fail" role="alert">
                        <mat-icon>error_outline</mat-icon>
                        <span>Não deu certo{{ s.chosenAction ? ' (' + label(s, s.chosenAction) + ')' : '' }}: {{ s.result || 'o DevOps recusou.' }}</span>
                      </div>
                    }
                    @if (errors()[s.id]; as err) {
                      <div class="msg__fail" role="alert"><mat-icon>error_outline</mat-icon><span>{{ err }}</span></div>
                    }
                    <div class="msg__actions">
                      @if (s.status === 'failed' && s.chosenAction) {
                        <button type="button" class="msg__btn msg__btn--primary" (click)="act(s, s.chosenAction)" [disabled]="!!busy()">
                          {{ busy() === s.id ? 'Tentando…' : 'Tentar de novo' }}
                        </button>
                      }
                      @for (a of s.actions; track a.key) {
                        @if (!(s.status === 'failed' && a.key === s.chosenAction)) {
                          <button type="button" class="msg__btn" [class.msg__btn--primary]="a.primary && s.status !== 'failed'"
                                  (click)="act(s, a.key)" [disabled]="!!busy()">
                            {{ busy() === s.id && acting() === a.key ? 'Fazendo…' : a.label }}
                          </button>
                        }
                      }
                      <button type="button" class="msg__dismiss" (click)="dismiss(s)" [disabled]="!!busy()"
                              matTooltip="Some daqui — dá para ver no histórico">Dispensar</button>
                    </div>
                  </div>
                </li>
              }
            </ol>
            @if (hiddenCount()) {
              <button type="button" class="as__link as__more" (click)="showAll.set(true)">
                <mat-icon>expand_more</mat-icon>Mais {{ hiddenCount() === 1 ? '1 sugestão' : hiddenCount() + ' sugestões' }}
              </button>
            }
          }
          @if (history().length) {
            <div class="as__hist">
              <button type="button" class="as__link as__hist-toggle" (click)="showHistory.set(!showHistory())" [attr.aria-expanded]="showHistory()">
                <mat-icon>{{ showHistory() ? 'expand_less' : 'chevron_right' }}</mat-icon>Respondidas ({{ history().length }})
              </button>
              @if (showHistory()) {
                <ul class="as__hist-list">
                  @for (s of history(); track s.id) {
                    <li class="hist" [class.hist--dismissed]="s.status === 'dismissed'">
                      <mat-icon class="hist__icon">{{ s.status === 'dismissed' ? 'do_not_disturb_on' : 'check_circle' }}</mat-icon>
                      <span class="hist__text">
                        <span class="hist__title">{{ s.title }}</span>
                        <span class="hist__result">— {{ outcome(s) }}</span>
                      </span>
                      <span class="hist__who" [title]="date(s.resolvedAt)">{{ s.status === 'dismissed' ? 'Dispensada' : 'Feito' }}{{ s.resolvedBy ? ' por ' + s.resolvedBy : '' }} {{ ago(s.resolvedAt) }}</span>
                    </li>
                  }
                </ul>
              }
            </div>
          }
        }
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .as { margin: 0 0 10px; border: 1px solid rgba(255,255,255,.08); border-radius: 10px; background: rgba(255,255,255,.025); font-size: 13px; }
    .as__head { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 12px; padding: 4px 10px 4px 4px; }
    .as__toggle { flex: 0 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 4px 8px; border: 0; border-radius: 8px;
      background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .as__toggle:hover { background: rgba(255,255,255,.035); }
    .as__toggle:focus-visible { outline: 2px solid #58a6ff; outline-offset: -2px; }
    .as__avatar { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%;
      background: linear-gradient(135deg, color-mix(in srgb, #bc8cff 55%, transparent), color-mix(in srgb, #58a6ff 55%, transparent)); color: #fff; }
    .as__avatar .mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .as__kicker { font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: color-mix(in srgb, var(--mat-sys-on-surface) 72%, transparent); }
    .as__count { flex: none; padding: 0 8px; border-radius: 999px; font-size: 11px; font-weight: 700; line-height: 18px; color: #1b1f24; background: #d2a8ff; }
    .as__latest { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: color-mix(in srgb, var(--mat-sys-on-surface) 62%, transparent); }
    .as__quiet { font-size: 12px; color: color-mix(in srgb, var(--mat-sys-on-surface) 48%, transparent); }
    .as__chevron { flex: none; font-size: 18px; width: 18px; height: 18px; color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent); }
    .as__hours { flex: 1 1 320px; min-width: 0; padding: 2px 0 2px 4px; }
    .as__error { display: flex; align-items: center; gap: 6px; margin: 0 12px 8px; color: #f2b8b5; font-size: 12.5px; }
    .as__error .mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .as__link { display: inline-flex; align-items: center; gap: 2px; padding: 0 2px; border: 0; background: none; color: var(--mat-sys-primary); font: inherit; font-size: 12px; cursor: pointer; }
    .as__link:hover { text-decoration: underline; }
    .as__link .mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .as__msgs { list-style: none; margin: 0; padding: 2px 10px 8px; display: flex; flex-direction: column; gap: 8px; border-top: 1px solid rgba(255,255,255,.06); padding-top: 8px; }
    .msg { display: flex; gap: 10px; padding: 8px 10px; border-radius: 10px; background: color-mix(in srgb, #bc8cff 6%, rgba(255,255,255,.02));
      border: 1px solid color-mix(in srgb, #bc8cff 18%, transparent); transition: box-shadow .3s ease, border-color .3s ease; }
    .msg--failed { background: color-mix(in srgb, #f85149 6%, transparent); border-color: color-mix(in srgb, #f85149 30%, transparent); }
    .msg--flash { border-color: color-mix(in srgb, #d2a8ff 70%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, #d2a8ff 22%, transparent); animation: msg-in .3s ease-out; }
    @keyframes msg-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
    .msg__avatar { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%;
      background: color-mix(in srgb, #bc8cff 22%, transparent); color: #d2a8ff; }
    .msg__avatar .mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .msg--failed .msg__avatar { background: color-mix(in srgb, #f85149 20%, transparent); color: #ffa198; }
    .msg__body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .msg__top { display: flex; align-items: baseline; gap: 8px; }
    .msg__title { font-weight: 600; line-height: 1.35; }
    .msg__when { flex: none; margin-left: auto; font-size: 11.5px; color: color-mix(in srgb, var(--mat-sys-on-surface) 50%, transparent); }
    .msg__text { line-height: 1.5; color: color-mix(in srgb, var(--mat-sys-on-surface) 82%, transparent); }
    .msg__text ::ng-deep p { margin: 0; }
    .msg__text ::ng-deep p + p { margin-top: 4px; }
    .msg__fail { display: flex; align-items: flex-start; gap: 6px; font-size: 12.5px; color: #ffa198; }
    .msg__fail .mat-icon { flex: none; font-size: 16px; width: 16px; height: 16px; margin-top: 1px; }
    .msg__actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
    .msg__btn { height: 28px; padding: 0 12px; border: 1px solid rgba(255,255,255,.16); border-radius: 7px; background: transparent; color: var(--mat-sys-on-surface);
      font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer; transition: background-color .15s ease, border-color .15s ease; }
    .msg__btn:hover:not(:disabled) { background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.28); }
    .msg__btn--primary { background: var(--mat-sys-primary); border-color: transparent; color: var(--mat-sys-on-primary); font-weight: 600; }
    .msg__btn--primary:hover:not(:disabled) { background: var(--mat-sys-primary); filter: brightness(1.08); }
    .msg__btn:disabled, .msg__dismiss:disabled { opacity: .55; cursor: default; }
    .msg__dismiss { height: 28px; padding: 0 8px; border: 0; background: none; color: color-mix(in srgb, var(--mat-sys-on-surface) 58%, transparent); font: inherit; font-size: 12.5px; cursor: pointer; }
    .msg__dismiss:hover:not(:disabled) { color: var(--mat-sys-on-surface); text-decoration: underline; }

    .as__hist { padding: 2px 12px 8px; }
    .as__msgs + .as__hist { padding-top: 0; }
    .as__hist-toggle { color: color-mix(in srgb, var(--mat-sys-on-surface) 60%, transparent); }
    .as__hist-list { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; }
    .hist { display: flex; align-items: center; gap: 8px; min-height: 28px; padding: 3px 4px; font-size: 12.5px; }
    .hist + .hist { border-top: 1px solid rgba(255,255,255,.04); }
    .hist__icon { flex: none; font-size: 16px; width: 16px; height: 16px; color: #3fb950; }
    .hist--dismissed .hist__icon { color: color-mix(in srgb, var(--mat-sys-on-surface) 40%, transparent); }
    .hist__text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hist__title { font-weight: 500; }
    .as__more { margin: -2px 12px 8px; }
    .hist__result { margin-left: 5px; color: color-mix(in srgb, var(--mat-sys-on-surface) 68%, transparent); }
    .hist__who { flex: none; font-size: 11.5px; color: color-mix(in srgb, var(--mat-sys-on-surface) 50%, transparent); }
    @media (max-width: 576px) {
      .as__latest { display: none; }
      .as__hours { flex-basis: 100%; padding-left: 10px; }
      .hist { flex-wrap: wrap; }
      .hist__text { white-space: normal; }
      .hist__who { flex-basis: 100%; padding-left: 24px; }
    }
    @media (prefers-reduced-motion: reduce) { .msg--flash { animation: none; } }
  `],
})
export class CardAssistantComponent {
  readonly cardNumber = input<string | number | null | undefined>(null);

  private svc = inject(CardAssistantService);
  private snackBar = inject(MatSnackBar);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly card = computed(() => {
    const c = this.cardNumber();
    return c === null || c === undefined ? '' : `${c}`.trim();
  });
  private readonly list = computed(() => (this.card() ? this.svc.suggestionsOf(this.card())() : null));
  readonly loaded = computed(() => this.list() !== null);
  readonly pending = computed(() => (this.list() ?? []).filter(isPending));
  readonly history = computed(() => (this.list() ?? []).filter(s => !isPending(s))
    .sort((a, b) => (b.resolvedAt ?? b.createdAt).localeCompare(a.resolvedAt ?? a.createdAt)));

  /** Compacto: as 2 primeiras abertas; o resto num clique (a sugestão em destaque sempre aparece). */
  readonly showAll = signal(false);
  readonly visible = computed(() => {
    const list = this.pending();
    if (this.showAll() || list.length <= MAX_VISIBLE) return list;
    const head = list.slice(0, MAX_VISIBLE);
    const flash = this.flashId();
    const flashed = flash ? list.find(s => s.id === flash) : null;
    return flashed && !head.includes(flashed) ? [flashed, ...head.slice(0, MAX_VISIBLE - 1)] : head;
  });
  readonly hiddenCount = computed(() => this.pending().length - this.visible().length);

  readonly collapsed = signal(loadCollapsed());
  readonly showHistory = signal(false);
  readonly busy = signal<string | null>(null);
  readonly acting = signal<string | null>(null);
  readonly errors = signal<Record<string, string>>({});
  readonly loadError = signal<string | null>(null);
  readonly flashId = signal<string | null>(null);
  readonly now = signal(Date.now());

  private watched: string | null = null;
  private freshSub: Subscription;
  private flashTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    effect(() => {
      const card = this.card();
      untracked(() => this.switchCard(card));
    });
    this.freshSub = this.svc.fresh$.subscribe(e => { if (e.card === this.card()) this.announce(e.suggestion); });
    const clock = setInterval(() => this.now.set(Date.now()), 60_000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(clock);
      clearTimeout(this.flashTimer);
      this.freshSub.unsubscribe();
      if (this.watched) this.svc.unwatch(this.watched);
    });
  }

  private switchCard(card: string): void {
    if (card === this.watched) return;
    if (this.watched) this.svc.unwatch(this.watched);
    this.watched = card || null;
    this.errors.set({});
    this.loadError.set(null);
    this.showAll.set(false);
    if (!card) return;
    this.svc.watch(card);
    this.reload(card);
  }

  reload(card = this.card()): void {
    if (!card) return;
    this.loadError.set(null);
    this.svc.loadSuggestions(card).catch(err => {
      if (card === this.card()) this.loadError.set(serverMessage(err, 'Não foi possível carregar as sugestões do PRMake.'));
    });
  }

  toggle(): void {
    const v = !this.collapsed();
    this.collapsed.set(v);
    try { localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0'); } catch { /* sem storage */ }
  }

  /** Abre o bloco e mostra a sugestão (o "Ver" do aviso e o contador do cabeçalho do plano). */
  reveal(id?: string | null): void {
    if (this.collapsed()) this.toggle();
    const target = id ?? this.pending()[0]?.id ?? null;
    if (target) this.flash(target);
    if (target && !this.visible().some(s => s.id === target)) this.showAll.set(true);
    setTimeout(() => {
      const el = (target && this.host.nativeElement.querySelector(`[data-suggestion="${target}"]`)) || this.host.nativeElement;
      (el as HTMLElement).scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    });
  }

  async act(s: CardSuggestion, action: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(s.id);
    this.acting.set(action);
    this.setError(s.id, null);
    try {
      const res = await this.svc.act(this.card(), s, action);
      if (res.status === 'done' && action !== 'skip') {
        this.snackBar.open(res.result || `${s.title} — feito.`, 'Ok', { duration: 5000 });
      }
    } catch (err) {
      this.setError(s.id, `Não foi possível responder: ${serverMessage(err, 'o servidor não respondeu')} — tente de novo ou dispense.`);
    } finally {
      this.busy.set(null);
      this.acting.set(null);
    }
  }

  async dismiss(s: CardSuggestion): Promise<void> {
    if (this.busy()) return;
    this.busy.set(s.id);
    this.setError(s.id, null);
    try {
      await this.svc.dismiss(this.card(), s);
    } catch (err) {
      this.setError(s.id, serverMessage(err, 'Não foi possível dispensar a sugestão.'));
    } finally {
      this.busy.set(null);
    }
  }

  icon(s: CardSuggestion): string {
    return s.status === 'failed' ? 'error_outline' : KIND_ICON[s.kind] ?? 'tips_and_updates';
  }

  label(s: CardSuggestion, key: string | null): string {
    return s.actions.find(a => a.key === key)?.label ?? key ?? '';
  }

  /** Resultado em uma linha: a ação escolhida e o que o DevOps respondeu. */
  outcome(s: CardSuggestion): string {
    if (s.status === 'dismissed') return 'dispensada';
    const action = this.label(s, s.chosenAction);
    if (s.result && action && s.result !== action) return `${action}: ${s.result}`;
    return s.result || action || 'feito';
  }

  md(text: string): string {
    return renderMarkdown(text, { codeRefs: false });
  }

  ago(iso: string | null | undefined): string {
    return situationAgo(iso, this.now());
  }

  date(iso: string | null | undefined): string {
    return situationDate(iso);
  }

  private announce(s: CardSuggestion): void {
    this.flash(s.id);
    const ref = this.snackBar.open(`O PRMake tem uma sugestão: ${s.title}`, 'Ver', { duration: 8000 });
    ref.onAction().subscribe(() => this.reveal(s.id));
  }

  private flash(id: string): void {
    this.flashId.set(id);
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.flashId.set(null), FLASH_MS);
  }

  private setError(id: string, msg: string | null): void {
    this.errors.update(m => {
      const next = { ...m };
      if (msg) next[id] = msg; else delete next[id];
      return next;
    });
  }
}

function loadCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
}
