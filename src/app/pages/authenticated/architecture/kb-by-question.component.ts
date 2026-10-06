import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PlanMarkdownPipe } from '../../../components/execution-plan/plan-markdown.pipe';
import { ReverseEngineeringService, ReverseIndexHit, ReverseItem } from '../../../services/reverse-engineering.service';

/** Uma pergunta de quem usa a base (CS, negócio, analistas) e os tipos de item da engenharia reversa que a respondem. */
interface Question { key: string; icon: string; title: string; hint: string; kinds: string[]; filter?: RegExp; }

/**
 * 0066 — a engenharia reversa organizada por PERGUNTA (como a Base Solvace antiga: o que é, para quem, dados,
 * integrações…), para quem não é técnico achar a resposta sem abrir documentos enormes. Tudo vem dos itens publicados
 * (o tipo do item diz em que pergunta ele cabe) — sem IA, sem custo.
 */
const QUESTIONS: Question[] = [
  { key: 'oque', icon: 'help_center', title: 'O que é e para quem', hint: 'Objetivo, quem usa e o que o módulo faz', kinds: ['OBJ', 'PER', 'FN'] },
  { key: 'telas', icon: 'web', title: 'Telas, menus e relatórios', hint: 'Onde fica cada coisa e como se navega', kinds: ['TELA', 'FLX', 'REL'] },
  { key: 'quem', icon: 'admin_panel_settings', title: 'Quem pode o quê', hint: 'Perfis, permissões e quem vê / edita (inclui registros restritos)',
    kinds: ['PRF', 'RN'], filter: /acess|permiss|perfil|pode|restrit|confidencial|vis[ií]vel|v[eê] |administrador|aprovador|respons[aá]vel|dono|originador/i },
  { key: 'regras', icon: 'gavel', title: 'Regras de negócio', hint: 'Como o sistema decide — com valores e mensagens exatos', kinds: ['RN', 'EST', 'UC'] },
  { key: 'dados', icon: 'storage', title: 'Dados e configurações', hint: 'O que é guardado, parâmetros por planta e o glossário', kinds: ['DB', 'CFG', 'GLO'] },
  { key: 'conversa', icon: 'hub', title: 'Com quem conversa', hint: 'Integrações com outros módulos e serviços (evento, fila, API, banco)', kinds: ['INT', 'API'] },
  { key: 'sozinho', icon: 'schedule', title: 'O que roda sozinho', hint: 'Jobs, eventos, filas, gatilhos do banco e notificações', kinds: ['JOB', 'EVT', 'TRG', 'NTF', 'SQL'] },
  { key: 'tecnologia', icon: 'memory', title: 'Tecnologias e infraestrutura', hint: 'Onde roda, cache, armazenamento e decisões técnicas', kinds: ['TEC', 'CMP', 'INF', 'ADR', 'NFR'] },
  { key: 'faq', icon: 'support_agent', title: 'Perguntas e passo a passo', hint: 'Como fazer cada tarefa e as dúvidas mais comuns', kinds: ['FAQ', 'TUT'] },
  { key: 'problemas', icon: 'report', title: 'Problemas conhecidos', hint: 'Lacunas, riscos e comportamentos que parecem bug', kinds: ['GAP'] }
];

@Component({
  selector: 'app-kb-by-question',
  standalone: true,
  imports: [FormsModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, PlanMarkdownPipe],
  template: `
    @if (total()) {
      <section class="bq" aria-label="Por pergunta">
        <div class="bq__head">
          <mat-icon>quiz</mat-icon><strong>Por pergunta</strong>
          <span class="bq__muted">{{ total() }} itens da engenharia reversa publicada · clique numa pergunta ou pesquise</span>
        </div>
        <form class="bq__search" (submit)="$event.preventDefault(); find()">
          <mat-icon>search</mat-icon>
          <input type="search" name="q" [(ngModel)]="query" placeholder="Ex.: quem pode ver um registro restrito? por que o calendário dá erro?" />
          @if (query) { <button type="button" class="bq__clear" (click)="query = ''; results.set(null)" aria-label="Limpar"><mat-icon>close</mat-icon></button> }
        </form>
        <div class="bq__grid">
          @for (q of questions; track q.key) {
            @if (count(q); as n) {
              <button type="button" class="bq__card" [class.bq__card--on]="open() === q.key" (click)="toggle(q)" [matTooltip]="q.hint">
                <mat-icon>{{ q.icon }}</mat-icon>
                <span class="bq__title">{{ q.title }}</span>
                <span class="bq__count">{{ q.filter ? '' : n }}</span>
              </button>
            }
          }
        </div>

        @if (loading()) { <div class="bq__state"><mat-spinner diameter="22"></mat-spinner></div> }
        @if (error()) { <div class="bq__state bq__state--err"><mat-icon>error_outline</mat-icon>{{ error() }}</div> }

        @if (results(); as list) {
          <div class="bq__list">
            <div class="bq__list-head">{{ listTitle() }} <span class="bq__muted">({{ list.length }}{{ list.length >= limit ? '+' : '' }})</span>
              @if (list.length > 8) {
                <input class="bq__filter" type="search" [ngModel]="filterText()" (ngModelChange)="filterText.set($event)" name="f" placeholder="filtrar nesta lista…" />
              }
            </div>
            @for (g of grouped(); track g.kind) {
              <div class="bq__group">{{ g.label }}</div>
              @for (h of g.hits; track h.ref) {
                <button type="button" class="bq__hit" [class.bq__hit--on]="openRef() === h.ref" (click)="openHit(h)">
                  <span class="bq__id">{{ h.itemId }}</span><span>{{ h.title }}</span>
                </button>
                @if (openRef() === h.ref) {
                  <div class="bq__item">
                    @if (item(); as it) {
                      <div class="bq__md" [innerHTML]="it.body | planMarkdown"></div>
                      <div class="bq__item-foot">
                        <span class="bq__muted">{{ it.moduleName || it.moduleKey }} · {{ it.docType }} · v{{ it.sectionVersion }}</span>
                        <button type="button" class="bq__link" (click)="openReverse.emit(it.ref)"><mat-icon>open_in_new</mat-icon>abrir na engenharia reversa</button>
                      </div>
                    } @else { <mat-spinner diameter="18"></mat-spinner> }
                  </div>
                }
              }
            } @empty {
              <div class="bq__muted bq__empty">Nada encontrado{{ query ? ' para "' + query + '"' : '' }}. Tente outras palavras (o nome da tela, a mensagem que aparece).</div>
            }
          </div>
        }
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .bq { margin: 12px 0 8px; padding: 10px 12px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.02); }
    .bq__head { display: flex; align-items: center; gap: 8px; font-size: 13.5px; flex-wrap: wrap; }
    .bq__head mat-icon { font-size: 19px; width: 19px; height: 19px; color: var(--mat-sys-primary); }
    .bq__muted { font-size: 12px; opacity: .65; }
    .bq__search { display: flex; align-items: center; gap: 6px; margin: 10px 0; padding: 4px 10px; border-radius: 8px; background: rgba(0,0,0,.25);
      border: 1px solid rgba(255,255,255,.1); }
    .bq__search mat-icon { font-size: 18px; width: 18px; height: 18px; opacity: .6; }
    .bq__search input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; color: inherit; font: inherit; font-size: 13.5px; padding: 4px 0; }
    .bq__clear { border: none; background: transparent; color: inherit; cursor: pointer; opacity: .6; display: flex; padding: 0; }
    .bq__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 6px; }
    .bq__card { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,.1);
      background: rgba(255,255,255,.03); color: inherit; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
    .bq__card:hover { background: rgba(255,255,255,.06); }
    .bq__card--on { border-color: var(--mat-sys-primary); background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent); }
    .bq__card mat-icon { font-size: 18px; width: 18px; height: 18px; flex: none; opacity: .85; }
    .bq__title { flex: 1; }
    .bq__count { font-size: 11.5px; opacity: .6; }
    .bq__state { display: flex; align-items: center; gap: 8px; padding: 10px 2px; font-size: 13px; }
    .bq__state--err { color: #f85149; }
    .bq__list { margin-top: 10px; border-top: 1px solid rgba(255,255,255,.08); padding-top: 8px; }
    .bq__list-head { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13.5px; margin-bottom: 4px; flex-wrap: wrap; }
    .bq__filter { margin-left: auto; width: 200px; max-width: 100%; border-radius: 6px; border: 1px solid rgba(255,255,255,.12); background: rgba(0,0,0,.2);
      color: inherit; font: inherit; font-size: 12.5px; padding: 3px 8px; }
    .bq__group { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; opacity: .6; margin: 10px 0 2px; font-weight: 700; }
    .bq__hit { display: flex; align-items: baseline; gap: 8px; width: 100%; padding: 4px 6px; border: none; border-radius: 6px; background: transparent;
      color: inherit; font: inherit; font-size: 13.5px; text-align: left; cursor: pointer; }
    .bq__hit:hover, .bq__hit--on { background: rgba(255,255,255,.05); }
    .bq__id { flex: none; font-family: ui-monospace, monospace; font-size: 11.5px; padding: 0 6px; border-radius: 6px; background: rgba(255,255,255,.08);
      color: var(--mat-sys-primary); }
    .bq__item { margin: 2px 0 10px 12px; padding: 8px 12px; border-left: 2px solid var(--mat-sys-primary); background: rgba(255,255,255,.02); border-radius: 0 6px 6px 0; }
    .bq__item-foot { display: flex; align-items: center; gap: 10px; margin-top: 6px; flex-wrap: wrap; }
    .bq__link { display: inline-flex; align-items: center; gap: 4px; border: none; background: transparent; color: var(--mat-sys-primary); font: inherit;
      font-size: 12.5px; cursor: pointer; padding: 0; }
    .bq__link mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .bq__empty { padding: 8px 2px; }
    :host ::ng-deep .bq__md { font-size: 13.5px; line-height: 1.55; overflow-wrap: normal; }
    :host ::ng-deep .bq__md h2, :host ::ng-deep .bq__md h3, :host ::ng-deep .bq__md h4 { font-size: 14px; margin: 4px 0 6px; }
    :host ::ng-deep .bq__md p { margin: 4px 0; }
    :host ::ng-deep .bq__md ul, :host ::ng-deep .bq__md ol { margin: 4px 0; padding-left: 20px; }
    :host ::ng-deep .bq__md code { font-size: 12px; padding: 0 4px; border-radius: 4px; background: rgba(255,255,255,.07); white-space: nowrap; }
    :host ::ng-deep .bq__md pre { overflow: auto; padding: 8px; border-radius: 6px; background: rgba(0,0,0,.25); }
    :host ::ng-deep .bq__md pre code { white-space: pre; background: transparent; }
    :host ::ng-deep .bq__md table { border-collapse: collapse; margin: 6px 0; font-size: 12.5px; display: block; overflow-x: auto; }
    :host ::ng-deep .bq__md th, :host ::ng-deep .bq__md td { border: 1px solid rgba(255,255,255,.12); padding: 3px 8px; text-align: left; vertical-align: top; }
  `]
})
export class KbByQuestionComponent {
  private readonly re = inject(ReverseEngineeringService);

  /** Chave do módulo (projeto da Base Solvace). */
  readonly moduleKey = input<string | null>(null);
  /** Abre o item na tela da engenharia reversa (modulo#RN-012). */
  readonly openReverse = output<string>();

  readonly questions = QUESTIONS;
  readonly limit = 400;
  query = '';
  readonly filterText = signal('');

  readonly byKind = signal<Record<string, number>>({});
  readonly open = signal<string | null>(null);
  readonly results = signal<ReverseIndexHit[] | null>(null);
  readonly listTitle = signal('');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly openRef = signal<string | null>(null);
  readonly item = signal<ReverseItem | null>(null);

  readonly total = computed(() => Object.values(this.byKind()).reduce((a, b) => a + b, 0));

  readonly grouped = computed(() => {
    const list = this.results() ?? [];
    const f = this.filterText().trim().toLowerCase();
    const visible = f ? list.filter(h => `${h.itemId} ${h.title} ${(h.tags ?? []).join(' ')}`.toLowerCase().includes(f)) : list;
    const order = new Map<string, number>();
    const q = QUESTIONS.find(x => x.key === this.open());
    (q?.kinds ?? []).forEach((k, i) => order.set(k, i));
    const groups = new Map<string, ReverseIndexHit[]>();
    for (const h of visible) groups.set(h.kind, [...(groups.get(h.kind) ?? []), h]);
    return [...groups.entries()]
      .sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99))
      .map(([kind, hits]) => ({ kind, label: hits[0]?.kindLabel ?? kind, hits }));
  });

  constructor() {
    effect(() => {
      const key = this.moduleKey();
      this.byKind.set({});
      this.reset();
      if (!key) return;
      this.re.module(key).subscribe({ next: m => this.byKind.set(m.itemsByKind ?? {}), error: () => this.byKind.set({}) });
    });
  }

  count(q: Question): number {
    const k = this.byKind();
    return q.kinds.reduce((n, kind) => n + (k[kind] ?? 0), 0);
  }

  toggle(q: Question): void {
    if (this.open() === q.key) { this.reset(); return; }
    this.open.set(q.key);
    this.query = '';
    this.filterText.set('');
    this.load(this.re.search('', { module: this.moduleKey()!, kind: q.kinds.join(','), limit: this.limit }), q.title, q.filter);
  }

  find(): void {
    const q = this.query.trim();
    if (!q) { this.reset(); return; }
    this.open.set(null);
    this.filterText.set('');
    this.load(this.re.search(q, { module: this.moduleKey()!, limit: 40 }), `Resultado para "${q}"`);
  }

  openHit(h: ReverseIndexHit): void {
    if (this.openRef() === h.ref) { this.openRef.set(null); return; }
    this.openRef.set(h.ref);
    this.item.set(null);
    this.re.items([h.ref]).subscribe({ next: list => this.item.set(list[0] ?? null), error: () => this.openRef.set(null) });
  }

  private load(source: ReturnType<ReverseEngineeringService['search']>, title: string, filter?: RegExp): void {
    this.loading.set(true);
    this.error.set(null);
    this.openRef.set(null);
    this.listTitle.set(title);
    source.subscribe({
      next: hits => {
        // "Quem pode o quê": perfis inteiros + só as regras que falam de acesso
        const list = filter ? hits.filter(h => h.kind !== 'RN' || filter.test(`${h.title} ${(h.tags ?? []).join(' ')}`)) : hits;
        this.results.set(list.filter(h => !h.removed));
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); this.error.set('Não foi possível carregar os itens.'); }
    });
  }

  private reset(): void {
    this.open.set(null);
    this.results.set(null);
    this.openRef.set(null);
    this.item.set(null);
  }
}
