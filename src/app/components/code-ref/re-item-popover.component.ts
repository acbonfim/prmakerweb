import {
  Component, ElementRef, ViewEncapsulation, afterNextRender, computed, effect, inject, input, output, signal, untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CliipboardService } from '../../services/cliipboard.service';
import { parseReHref, renderMarkdown } from '../../helpers/markdown-ext';
import { ReItem, ReItemService } from './re-item.service';

export type ReItemMode = 'popover' | 'sheet';

const MAX_CITED = 12;

/** Cor do selo pelo prefixo do id (UC azul, RN âmbar, TELA verde-água, API roxo, DB verde…). */
const KIND_TONES: [RegExp, string][] = [
  [/^(UC|FLX|SEQ|TUT|FN)$/, '#58a6ff'],
  [/^(RN|CFG|PER|REL)$/, '#d29922'],
  [/^(TELA|UI|CMP)$/, '#39c5cf'],
  [/^(API|INT|EVT|JOB|NTF|INF)$/, '#bc8cff'],
  [/^(DB|SQL|TRG|OBJ|EST)$/, '#3fb950'],
  [/^(GAP|NFR|ADR|TEC|PRF)$/, '#f0883e'],
];

export function reKindTone(itemId: string | null | undefined): string {
  const prefix = (itemId ?? '').split('#').pop()!.split('-')[0].toUpperCase();
  return KIND_TONES.find(([re]) => re.test(prefix))?.[1] ?? '#8b9bb4';
}

/** `revamp-kaizen#UC-121` → `UC-121`. */
function idOf(ref: string): string {
  return ref.includes('#') ? ref.slice(ref.indexOf('#') + 1) : ref;
}

/**
 * Popover de um item da engenharia reversa citado no card (0076): selo do tipo, id + módulo, título, o
 * texto do item, armadilhas e "Citado por" (navegável dentro do popover, com voltar). Mesmo overlay/folha
 * inferior do popover de código (aberto pela `appCodeRefHost`). Estados: carregando, erro, 403 (só
 * administradores), 404 e ambíguo (o id existe em mais de um módulo).
 */
@Component({
  selector: 'app-re-item-popover',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'rei',
    '[class.rei--popover]': "mode() === 'popover'",
    '[class.rei--sheet]': "mode() === 'sheet'",
    role: 'dialog',
    tabindex: '-1',
    '[attr.aria-label]': "'Item da engenharia reversa ' + current()",
    '(keydown)': 'onKeydown($event)',
  },
  template: `
    <header class="rei__head">
      @if (stack().length > 1) {
        <button mat-icon-button type="button" class="rei__back" (click)="back()" matTooltip="Voltar" aria-label="Voltar ao item anterior">
          <mat-icon>arrow_back</mat-icon>
        </button>
      }
      <div class="rei__titles">
        <div class="rei__line">
          @if (item(); as it) {
            <span class="rei__kind" [style.--rei-kind]="tone()">{{ it.kindLabel || it.kind }}</span>
          }
          <span class="rei__id">{{ item()?.itemId || idOf(current()) }}</span>
          @if (item(); as it) {
            <span class="rei__module" [title]="it.moduleKey">{{ it.moduleName || it.moduleKey }}</span>
          }
        </div>
        @if (item()?.title; as t) { <span class="rei__title">{{ t }}</span> }
      </div>
      <span class="rei__actions">
        <button mat-icon-button type="button" (click)="copyRef()" matTooltip="Copiar a referência" aria-label="Copiar a referência do item">
          <mat-icon>content_copy</mat-icon>
        </button>
        <button mat-icon-button type="button" (click)="close()" matTooltip="Fechar (Esc)" aria-label="Fechar">
          <mat-icon>close</mat-icon>
        </button>
      </span>
    </header>

    <div class="rei__scroll">
      @switch (status()) {
        @case ('loading') {
          <div class="rei__state" role="status"><mat-icon class="rei__spin">progress_activity</mat-icon> Carregando o item…</div>
        }
        @case ('error') {
          <div class="rei__state rei__state--error" role="alert">
            <mat-icon>error_outline</mat-icon> Não foi possível carregar o item.
            <button mat-stroked-button type="button" (click)="reload()">Tentar de novo</button>
          </div>
        }
        @case ('forbidden') {
          <div class="rei__state rei__state--locked" role="status">
            <mat-icon>lock</mat-icon>
            <span>Os itens da engenharia reversa são visíveis só para administradores.</span>
          </div>
        }
        @case ('missing') {
          <div class="rei__state" role="status">
            <mat-icon>search_off</mat-icon>
            <span>O item <code>{{ current() }}</code> não foi encontrado na engenharia reversa.</span>
          </div>
        }
        @case ('ambiguous') {
          <div class="rei__state rei__state--warn" role="status">
            <mat-icon>call_split</mat-icon>
            <span>{{ message() }}</span>
          </div>
        }
        @case ('ready') {
          @if (item(); as it) {
            @if (it.removed) {
              <div class="rei__removed"><mat-icon>history_toggle_off</mat-icon> Item removido da versão atual da engenharia reversa.</div>
            }
            @if (bodyHtml()) {
              <div class="rei__md" [innerHTML]="bodyHtml()" (click)="onBodyClick($event)"></div>
            } @else {
              <p class="rei__empty">Sem texto neste item.</p>
            }

            @if (it.traps.length) {
              <section class="rei__traps" aria-label="Armadilhas">
                <div class="rei__section"><mat-icon>report</mat-icon>Armadilhas <span class="rei__count">{{ it.traps.length }}</span></div>
                @for (t of trapsView(); track $index) {
                  <div class="rei-trap">
                    <div class="rei-trap__head">
                      <span class="rei-trap__title">{{ t.title }}</span>
                      @if (t.needsReview) { <span class="rei-trap__review">A revisar</span> }
                    </div>
                    @if (t.html) { <div class="rei__md rei-trap__text" [innerHTML]="t.html" (click)="onBodyClick($event)"></div> }
                    @if (t.cards.length) {
                      <div class="rei-trap__cards">
                        @for (c of t.cards; track c) { <span class="rei__chip rei__chip--card">card {{ c }}</span> }
                      </div>
                    }
                  </div>
                }
              </section>
            }

            @if (it.referencedBy.length) {
              <section class="rei__cited" aria-label="Citado por">
                <div class="rei__section"><mat-icon>alt_route</mat-icon>Citado por <span class="rei__count">{{ it.referencedBy.length }}</span></div>
                <div class="rei__chips">
                  @for (r of citedShown(); track r) {
                    <button type="button" class="rei__chip rei__chip--ref" (click)="go(r)" [style.--rei-kind]="toneOf(r)" [title]="r">{{ citedLabel(r, it.moduleKey) }}</button>
                  }
                  @if (citedMore() > 0) {
                    <button type="button" class="rei__chip rei__chip--more" (click)="showAllCited.set(true)">+{{ citedMore() }}</button>
                  }
                </div>
              </section>
            }

            @if (it.evidence.length) {
              <details class="rei__evidence">
                <summary><mat-icon>code</mat-icon>Onde está no código ({{ it.evidence.length }})</summary>
                <ul>
                  @for (e of it.evidence; track e) { <li><code>{{ e }}</code></li> }
                </ul>
              </details>
            }

            <footer class="rei__foot">
              {{ docLabel(it.docType) }}@if (it.sectionVersion) { · versão {{ it.sectionVersion }} }
              · <span class="rei__foot-ref">{{ it.ref }}</span>
            </footer>
          }
        }
      }
    </div>
  `,
  styles: [`
    .rei { display: flex; flex-direction: column; min-height: 0; color: var(--mat-sys-on-surface, #e6edf3);
      background: #161b22; border: 1px solid #30363d; border-radius: 12px; box-shadow: 0 16px 48px rgba(0,0,0,.55);
      font: var(--mat-sys-body-medium); font-size: 13px; outline: none; overflow: hidden; }
    .rei.rei--popover { width: min(620px, calc(100vw - 24px)); max-height: min(68vh, 640px); animation: rei-in .12s ease-out; }
    .rei.rei--sheet { width: 100vw; max-height: 82vh; border-radius: 14px 14px 0 0; border-bottom: none; animation: rei-up .18s ease-out; }
    @keyframes rei-in { from { opacity: 0; transform: scale(.97); } to { opacity: 1; transform: none; } }
    @keyframes rei-up { from { transform: translateY(24px); opacity: .6; } to { transform: none; opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .rei.rei--popover, .rei.rei--sheet { animation: none; } }

    .rei__head { flex: none; display: flex; align-items: flex-start; gap: 8px; padding: 10px 6px 10px 14px; border-bottom: 1px solid #30363d; background: #1c2128; }
    .rei__back { margin: -4px -4px 0 -10px; }
    .rei__titles { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
    .rei__line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
    .rei__kind { --rei-kind: #8b9bb4; display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 999px;
      font-size: 11px; font-weight: 600; white-space: nowrap; color: color-mix(in srgb, var(--rei-kind) 82%, white);
      background: color-mix(in srgb, var(--rei-kind) 14%, transparent); border: 1px solid color-mix(in srgb, var(--rei-kind) 36%, transparent); }
    .rei__id { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; font-weight: 600; color: #d2a8ff; }
    .rei__module { font-size: 11.5px; color: #8b949e; }
    .rei__module::before { content: '·'; margin-right: 8px; color: #484f58; }
    .rei__title { font-weight: 600; font-size: 14px; line-height: 1.35; }
    .rei__actions { flex: none; display: flex; align-items: center; margin-top: -4px; }
    .rei__actions .mat-mdc-icon-button, .rei__back.mat-mdc-icon-button { --mat-icon-button-state-layer-size: 32px; width: 32px; height: 32px; padding: 4px; }
    .rei__actions .mat-icon, .rei__back .mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .rei__scroll { flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 12px 16px 12px; }
    .rei__state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 22px 12px; text-align: center; color: #8b949e; line-height: 1.5; }
    .rei__state .mat-icon { font-size: 26px; width: 26px; height: 26px; }
    .rei__state--error { color: #f2b8b5; }
    .rei__state--locked .mat-icon { color: #d29922; }
    .rei__state--warn .mat-icon { color: #e3b341; }
    .rei__state code { padding: 1px 6px; border-radius: 5px; background: rgba(110,118,129,.2); color: #d2a8ff; }
    .rei__spin { animation: rei-spin .9s linear infinite; }
    @keyframes rei-spin { to { transform: rotate(360deg); } }

    .rei__removed { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; padding: 6px 10px; border-radius: 8px; font-size: 12.5px;
      color: #e3b341; background: color-mix(in srgb, #d29922 10%, transparent); border: 1px solid color-mix(in srgb, #d29922 30%, transparent); }
    .rei__removed .mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .rei__empty { margin: 0; color: #8b949e; }

    .rei__md { line-height: 1.55; overflow-wrap: anywhere; }
    .rei__md > :first-child { margin-top: 0; }
    .rei__md > :last-child { margin-bottom: 0; }
    .rei__md p { margin: 0 0 8px; }
    .rei__md ul, .rei__md ol { margin: 0 0 8px; padding-left: 1.3em; }
    .rei__md li + li { margin-top: 2px; }
    .rei__md h1, .rei__md h2, .rei__md h3, .rei__md h4 { margin: 12px 0 6px; font-size: 13px; font-weight: 600; }
    .rei__md code { padding: 0 5px; color: #e6edf3; border-radius: 4px; background: rgba(110,118,129,.22); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .9em; }
    .rei__md pre { padding: 8px 10px; border-radius: 8px; background: #0d1117; border: 1px solid #30363d; overflow-x: auto; }
    .rei__md pre code { padding: 0; background: none; }
    .rei__md a { color: #79c0ff; }

    .rei__section { display: flex; align-items: center; gap: 6px; margin: 16px 0 8px; font-size: 10.5px; font-weight: 700; letter-spacing: .07em;
      text-transform: uppercase; color: #8b949e; }
    .rei__section .mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .rei__count { padding: 0 6px; border-radius: 999px; background: rgba(110,118,129,.25); color: #c9d1d9; font-size: 10.5px; letter-spacing: 0; line-height: 16px; }
    .rei__traps .rei__section { color: #f0883e; }
    .rei-trap { padding: 9px 12px; border: 1px solid color-mix(in srgb, #f0883e 30%, transparent); border-left: 3px solid #f0883e; border-radius: 4px 10px 10px 4px;
      background: color-mix(in srgb, #f0883e 7%, transparent); }
    .rei-trap + .rei-trap { margin-top: 8px; }
    .rei-trap__head { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-bottom: 4px; }
    .rei-trap__title { font-weight: 600; }
    .rei-trap__review { height: 18px; padding: 0 7px; border-radius: 999px; font-size: 10.5px; font-weight: 600; line-height: 18px;
      color: #e3b341; border: 1px dashed color-mix(in srgb, #e3b341 55%, transparent); }
    .rei-trap__text { font-size: 12.5px; }
    .rei-trap__cards { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }

    .rei__chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .rei__chip { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: 6px; border: 1px solid #30363d; background: #1c2128;
      color: #c9d1d9; font: inherit; font-size: 11.5px; white-space: nowrap; }
    .rei__chip--ref { --rei-kind: #8b9bb4; cursor: pointer; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px;
      color: color-mix(in srgb, var(--rei-kind) 80%, white); border-color: color-mix(in srgb, var(--rei-kind) 32%, transparent);
      background: color-mix(in srgb, var(--rei-kind) 8%, transparent); }
    .rei__chip--ref:hover, .rei__chip--ref:focus-visible { background: color-mix(in srgb, var(--rei-kind) 18%, transparent); outline: none; }
    .rei__chip--more { cursor: pointer; color: #8b949e; }
    .rei__chip--card { height: 18px; font-size: 10.5px; color: #8b949e; }

    .rei__evidence { margin-top: 14px; border-top: 1px solid #21262d; padding-top: 10px; }
    .rei__evidence summary { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px; color: #8b949e; list-style: none; }
    .rei__evidence summary::-webkit-details-marker { display: none; }
    .rei__evidence summary .mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .rei__evidence ul { margin: 6px 0 0; padding-left: 1.2em; font-size: 11.5px; }
    .rei__evidence code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #79c0ff; overflow-wrap: anywhere; }
    .rei__foot { margin-top: 14px; font-size: 11px; color: #6e7681; }
    .rei__foot-ref { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

    .cdk-overlay-pane.re-item-pane { max-width: 100vw; }
  `],
})
export class ReItemPopoverComponent {
  private svc = inject(ReItemService);
  private clipboard = inject(CliipboardService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly card = input<string | null>(null);
  readonly ref = input<string | null>(null);
  readonly mode = input<ReItemMode>('popover');

  readonly closed = output<void>();

  /** Itens visitados (o último é o atual) — "Citado por" navega dentro do popover. */
  readonly stack = signal<string[]>([]);
  readonly current = computed(() => this.stack().at(-1) ?? '');
  readonly status = signal<'loading' | 'error' | 'forbidden' | 'missing' | 'ambiguous' | 'ready'>('loading');
  readonly item = signal<ReItem | null>(null);
  readonly message = signal('');
  readonly showAllCited = signal(false);

  readonly idOf = idOf;
  readonly tone = computed(() => reKindTone(this.item()?.itemId ?? this.current()));
  readonly bodyHtml = computed(() => {
    const body = this.item()?.body?.trim();
    return body ? renderMarkdown(body, { codeRefs: false, reRefs: true }) : '';
  });
  readonly trapsView = computed(() => (this.item()?.traps ?? []).map(t => ({
    ...t,
    html: t.text?.trim() ? renderMarkdown(t.text, { codeRefs: false, reRefs: true }) : '',
  })));
  readonly citedShown = computed(() => {
    const all = this.item()?.referencedBy ?? [];
    return this.showAllCited() ? all : all.slice(0, MAX_CITED);
  });
  readonly citedMore = computed(() => (this.item()?.referencedBy.length ?? 0) - this.citedShown().length);

  private seq = 0;

  constructor() {
    effect(() => {
      const ref = this.ref();
      untracked(() => {
        this.stack.set(ref ? [ref] : []);
        this.load();
      });
    });
    afterNextRender(() => this.host.nativeElement.focus({ preventScroll: true }));
  }

  toneOf(ref: string): string {
    return reKindTone(idOf(ref));
  }

  /** Item do mesmo módulo: só o id (`RN-012`); de outro módulo: `modulo#ID`. */
  citedLabel(ref: string, moduleKey: string | null | undefined): string {
    return moduleKey && ref.toLowerCase().startsWith(`${moduleKey.toLowerCase()}#`) ? idOf(ref) : ref;
  }

  docLabel(doc: string | null | undefined): string {
    const d = (doc ?? '').trim();
    return d ? `Documento ${d}` : 'Engenharia reversa';
  }

  reload(): void { this.load(); }

  go(ref: string): void {
    if (!ref || ref === this.current()) return;
    this.stack.update(s => [...s, ref]);
    this.load();
  }

  back(): void {
    if (this.stack().length < 2) return;
    this.stack.update(s => s.slice(0, -1));
    this.load();
  }

  /** Link `UC-121` dentro do texto do item → navega no próprio popover. */
  onBodyClick(event: MouseEvent): void {
    const a = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a');
    if (!a) return;
    const ref = parseReHref(a.getAttribute('href'));
    if (ref) {
      event.preventDefault();
      event.stopPropagation();
      this.go(ref);
      return;
    }
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#')) { event.preventDefault(); return; }
    event.preventDefault();
    window.open(href, '_blank', 'noopener,noreferrer');
  }

  copyRef(): void {
    const ref = this.item()?.ref || this.current();
    if (ref) this.clipboard.copyFullDescriptionToClipboard(ref);
  }

  close(): void { this.closed.emit(); }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    } else if (event.key === 'Backspace' && this.stack().length > 1 && !(event.target as HTMLElement)?.closest('input,textarea')) {
      event.preventDefault();
      this.back();
    }
  }

  private async load(): Promise<void> {
    const seq = ++this.seq;
    const card = `${this.card() ?? ''}`.trim();
    const ref = this.current();
    this.showAllCited.set(false);
    if (!ref) { this.status.set('missing'); return; }
    this.status.set('loading');
    try {
      const res = await this.svc.get(card, ref);
      if (seq !== this.seq) return;
      if (res.status === 'ok') {
        this.item.set(res.item);
        this.status.set('ready');
        this.host.nativeElement.querySelector('.rei__scroll')?.scrollTo?.({ top: 0 });
        return;
      }
      this.item.set(null);
      if (res.status === 'ambiguous') this.message.set(res.message);
      this.status.set(res.status);
    } catch {
      if (seq !== this.seq) return;
      this.item.set(null);
      this.status.set('error');
    }
  }
}
