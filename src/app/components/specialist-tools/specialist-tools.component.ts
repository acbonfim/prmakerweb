import { Component, ElementRef, ViewEncapsulation, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { CaseChatService } from '../../services/case-chat.service';
import { WorkItemsService } from '../../services/work-items.service';
import { WorkItemActionsService } from '../work-items/work-item-actions.service';
import { WORK_DIALOG_STYLES } from '../work-items/work-dialog.styles';
import { WorkItemCatalog, WorkItemError, formatWorkNumber, itemStatusLook, kindInfo } from '../work-items/work-item.model';
import { WiParamFieldComponent } from '../work-item-pickers/wi-param-field.component';
import { WiTypeChipsComponent } from '../work-items/wi-type-icon.component';
import { WorkItemPickerSource } from '../work-item-pickers/work-item-picker-source.service';
import { BranchSuggestContext } from '../work-item-pickers/param-input';
import {
  ToolAsk,
  ToolView,
  askOptions,
  askToParam,
  buildToolViews,
  displayTitle,
  filterTools,
  groupTools,
  initialAnswers,
  missingAnswers,
  previewTasks,
  specialistToolMessage,
  toolContext
} from './specialist-tools.logic';

/**
 * 0085 rodada 4: **Ferramentas do especialista** — atalhos para criar itens de trabalho do dia a dia (abrir PR para uma
 * branch, PRs do fluxo, promover para release-version/edge, fechamento, validar em QA, script com chamado…). A lista vem
 * do catálogo (`GET WorkItems/catalog?card=` → `templates`, com `ask`/`applicable` da rodada 4), com busca e grupos; as
 * que não se aplicam ao card ficam atrás de "mostrar também" (desabilitadas, com o motivo). Clicar abre um formulário
 * curto com as perguntas (`ask`, nos controles do editor de itens), a prévia das sub-tarefas e duas saídas:
 * **Criar item** (`POST WorkItems/card/{card}/from-template`; 409 `duplicate` mostra o existente e "criar mesmo assim")
 * e **Pedir ao especialista** (mensagem na conversa do caso com a ferramenta e as respostas).
 *
 * API: `[card]`, `[cardType]`, `(created)` (número do item criado), `(asked)` (pedido enviado ao especialista),
 * `(closed)` (botão fechar), `(countChange)` (ferramentas aplicáveis ao card, a cada carga do catálogo).
 */
@Component({
  selector: 'app-specialist-tools',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, WiParamFieldComponent, WiTypeChipsComponent],
  encapsulation: ViewEncapsulation.None,
  template: `
    <section class="st" role="dialog" aria-label="Ferramentas do especialista" (keydown.escape)="onEscape($event)">
      <header class="st__head">
        @if (current(); as v) {
          <button mat-icon-button class="st__icon-btn" (click)="back()" matTooltip="Voltar à lista" aria-label="Voltar à lista"><mat-icon>arrow_back</mat-icon></button>
          <span class="st__ico" aria-hidden="true" [style.--st-c]="v.color"><mat-icon>{{ v.icon }}</mat-icon></span>
          <div class="st__titles">
            <b>{{ formTitle() }}</b>
            <small>{{ groupLabel(v) }} · ferramenta do especialista</small>
          </div>
        } @else {
          <span class="st__ico" aria-hidden="true"><mat-icon>construction</mat-icon></span>
          <div class="st__titles">
            <b>Ferramentas do especialista</b>
            <small>atalhos do dia a dia — criam o item de trabalho já montado para o card</small>
          </div>
        }
        <button mat-icon-button class="st__icon-btn" (click)="closed.emit()" matTooltip="Fechar" aria-label="Fechar as ferramentas"><mat-icon>close</mat-icon></button>
      </header>

      @if (current(); as v) {
        <!-- Formulário da ferramenta -->
        <div class="st__body st__form">
          @if (v.description) { <p class="st__desc">{{ formDescription() }}</p> }

          @if (v.ask.length) {
            <div class="st__fields">
              @for (a of v.ask; track a.key) {
                <label class="wi-field st__field">
                  <span>{{ a.label || a.key }}@if (required(a)) {<i class="st__req" aria-hidden="true">*</i>}</span>
                  <app-wi-param-field [param]="param(a)" [value]="answers()[a.key]" (valueChange)="setAnswer(a.key, $event)"
                                      [card]="card()" [repository]="repository()" [sourceBranch]="ctx().mainBranch ?? null"
                                      [suggest]="suggestFor(a)" [githubUrl]="githubUrl()" />
                  @if (optionsHint(a); as hint) { <small class="st__hint">{{ hint }}</small> }
                </label>
              }
            </div>
          } @else {
            <p class="st__muted"><mat-icon>bolt</mat-icon>Sem perguntas — o item sai pronto com os dados do card.</p>
          }

          <div class="wi-field st__field">
            <span>Tipo do item</span>
            <app-wi-type-chips [value]="itemType()" (valueChange)="itemType.set($event)" [catalog]="catalog()" />
          </div>

          <label class="wi-field st__field">
            <span>Observação <small class="st__muted-inline">(opcional — vai junto no pedido ao especialista)</small></span>
            <textarea class="wi-textarea" rows="2" [ngModel]="note()" (ngModelChange)="note.set($event)"
                      placeholder="Ex.: o PR antigo para release-version foi fechado por conflito"></textarea>
          </label>

          @if (preview().length) {
            <div class="st__preview" aria-label="Prévia das sub-tarefas">
              <h4 class="st__sub">Prévia · {{ preview().length }} {{ preview().length === 1 ? 'sub-tarefa' : 'sub-tarefas' }}</h4>
              <ol>
                @for (t of preview(); track $index) {
                  <li>
                    <mat-icon class="st__kind" [matTooltip]="kindLabel(t.kind)">{{ kindIcon(t.kind) }}</mat-icon>
                    <span class="st__task">{{ t.title }}</span>
                  </li>
                }
              </ol>
              <small class="st__hint">Prévia montada na tela; o PRMake renderiza os nomes de branch pelas regras do card ao criar.</small>
            </div>
          }

          @if (duplicate(); as d) {
            <div class="wi-note wi-note--warn st__dup" role="alert">
              <mat-icon>content_copy</mat-icon>
              <div>
                <b>Já existe um item igual: {{ num(d.number) }} "{{ d.title }}"</b> ({{ statusLabel(d.status) }}).
                @if (d.number) { <button type="button" class="st__link" (click)="openExisting(d.number)">Abrir {{ num(d.number) }}</button> }
                <br>Se for mesmo outro trabalho, diga o motivo e crie assim mesmo.
                <textarea class="wi-textarea" rows="2" [ngModel]="duplicateReason()" (ngModelChange)="duplicateReason.set($event)" placeholder="Motivo (obrigatório)"></textarea>
              </div>
            </div>
          }
          @if (error()) { <p class="wi-err" role="alert">{{ error() }}</p> }
        </div>

        <footer class="st__foot">
          @if (missing().length) { <small class="st__missing">Falta: {{ missing().join(', ') }}</small> }
          <span class="st__spacer"></span>
          <button mat-stroked-button type="button" (click)="askSpecialist()" [disabled]="busy()"
                  matTooltip="Manda a ferramenta e as respostas na conversa do caso — o especialista confere e cria o item">
            <mat-icon>psychology</mat-icon>Pedir ao especialista
          </button>
          @if (duplicate()) {
            <button mat-flat-button color="warn" type="button" (click)="create(true, startAfter())" [disabled]="busy() || !duplicateReason().trim()">
              <mat-icon>content_copy</mat-icon>{{ startAfter() ? 'Criar e iniciar mesmo assim' : 'Criar mesmo assim' }}
            </button>
          } @else {
            <button mat-stroked-button color="primary" type="button" class="st__create" (click)="create()" [disabled]="busy() || missing().length > 0">
              @if (busy() === 'create' && !startAfter()) { <mat-spinner diameter="16"></mat-spinner> } @else { <mat-icon>add_task</mat-icon> }
              Criar item
            </button>
            <button mat-flat-button color="primary" type="button" class="st__create st__create-start" (click)="create(false, true)" [disabled]="busy() || missing().length > 0"
                    matTooltip="Cria o item e já coloca na fila do executor">
              @if (busy() === 'create' && startAfter()) { <mat-spinner diameter="16"></mat-spinner> } @else { <mat-icon>play_arrow</mat-icon> }
              Criar e iniciar
            </button>
          }
        </footer>
      } @else {
        <!-- Lista -->
        <div class="st__search">
          <mat-icon>search</mat-icon>
          <input #search class="st__search-input" type="search" placeholder="Buscar ferramenta (PR, release, QA, chamado…)" aria-label="Buscar ferramenta"
                 [ngModel]="query()" (ngModelChange)="query.set($event)">
          @if (query()) { <button mat-icon-button class="st__icon-btn" (click)="query.set('')" aria-label="Limpar a busca"><mat-icon>close</mat-icon></button> }
        </div>
        <div class="st__body">
          @if (loading() && !views().length) {
            <div class="st__state"><mat-spinner diameter="22"></mat-spinner><span>Carregando as ferramentas…</span></div>
          } @else if (loadError()) {
            <div class="st__state st__state--err"><mat-icon>error_outline</mat-icon><span>{{ loadError() }}</span>
              <button mat-button (click)="load(true)">Tentar de novo</button></div>
          } @else if (!views().length) {
            <div class="st__state"><mat-icon>construction</mat-icon><span>Nenhuma ferramenta cadastrada.</span></div>
          } @else {
            @for (g of groups(); track g.key) {
              <section class="st__group" [attr.aria-label]="g.label">
                <h4 class="st__sub"><mat-icon>{{ g.icon }}</mat-icon>{{ g.label }}<small>{{ g.tools.length }}</small></h4>
                @for (v of g.tools; track v.key) {
                  <button type="button" class="st-tool" [class.st-tool--off]="!v.applicable" [disabled]="!v.applicable"
                          [attr.data-tool]="v.key" (click)="pick(v)" [attr.aria-label]="v.title + (v.reason ? ' — ' + v.reason : '')">
                    <span class="st-tool__ico" aria-hidden="true" [style.--st-c]="v.color"><mat-icon>{{ v.icon }}</mat-icon></span>
                    <span class="st-tool__main">
                      <span class="st-tool__title">{{ v.title }}@if (v.ask.length) {<mat-icon class="st-tool__ask" matTooltip="Pergunta antes de criar">tune</mat-icon>}</span>
                      @if (v.reason) { <span class="st-tool__reason"><mat-icon>block</mat-icon>{{ v.reason }}</span> }
                      @else if (v.description) { <span class="st-tool__desc">{{ shortDescription(v) }}</span> }
                    </span>
                    @if (v.applicable) { <mat-icon class="st-tool__go" aria-hidden="true">chevron_right</mat-icon> }
                  </button>
                }
              </section>
            } @empty {
              <div class="st__state"><mat-icon>search_off</mat-icon><span>Nada encontrado para "{{ query() }}".</span></div>
            }
            @if (offCount()) {
              <button type="button" class="st__more" (click)="showAll.set(!showAll())" [attr.aria-expanded]="showAll()">
                <mat-icon>{{ showAll() ? 'expand_less' : 'expand_more' }}</mat-icon>
                {{ showAll() ? 'Esconder' : 'Mostrar também' }} {{ offCount() === 1 ? 'a que não se aplica' : 'as ' + offCount() + ' que não se aplicam' }} a este card
              </button>
            }
          }
        </div>
      }
    </section>
  `,
  styles: [WORK_DIALOG_STYLES, `
app-specialist-tools { display: block; min-height: 0; }
.st { display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--mat-sys-on-surface); background: var(--surface-1, #262b33);
  border-radius: inherit; overflow: hidden; font-size: 13px; }
.st__head { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 6px 8px 10px;
  background: linear-gradient(135deg, rgba(142,108,240,.22), rgba(142,108,240,.04)); }
.st__ico { --st-c: #8e6cf0; flex: none; width: 30px; height: 30px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--st-c) 35%, transparent); color: #fff; }
.st__ico .mat-icon { font-size: 18px; width: 18px; height: 18px; }
.st__titles { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.st__titles b { font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.st__titles small { font-size: 11.5px; opacity: .75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.st__icon-btn.mat-mdc-icon-button { width: 34px; height: 34px; padding: 5px; flex: none; }
.st__icon-btn .mat-icon { font-size: 20px; width: 20px; height: 20px; }
.st__search { flex: none; display: flex; align-items: center; gap: 6px; margin: 10px 10px 4px; padding: 0 4px 0 10px; border-radius: 10px;
  background: var(--surface-input, #1a1f28); border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); }
.st__search:focus-within { border-color: color-mix(in srgb, var(--mat-sys-primary) 70%, transparent); }
.st__search > .mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--cc-text-3); flex: none; }
.st__search-input { flex: 1; min-width: 0; background: none; border: 0; outline: none; color: inherit; font: inherit; font-size: 13px; padding: 8px 0; }
.st__body { flex: 1; min-height: 0; overflow: auto; padding: 6px 10px 12px; display: flex; flex-direction: column; gap: 10px; }
.st__state { display: flex; align-items: center; gap: 8px; padding: 18px 8px; color: var(--cc-text-2); justify-content: center; flex-wrap: wrap; text-align: center; }
.st__state--err { color: #f85149; }
.st__group { display: flex; flex-direction: column; gap: 4px; }
.st__sub { display: flex; align-items: center; gap: 6px; margin: 4px 2px 2px; font-size: 11px; font-weight: 700; letter-spacing: .06em;
  text-transform: uppercase; color: var(--cc-text-3); }
.st__sub .mat-icon { font-size: 15px; width: 15px; height: 15px; }
.st__sub small { font-weight: 600; opacity: .8; }
.st-tool { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 8px 8px 8px 8px; border-radius: 10px; cursor: pointer;
  background: var(--surface-2, #2e343f); color: inherit; font: inherit; border: 1px solid var(--cc-surface-border, rgba(255,255,255,.08));
  transition: border-color .15s ease, background .15s ease; }
.st-tool:hover:not(:disabled), .st-tool:focus-visible { border-color: color-mix(in srgb, var(--mat-sys-primary) 60%, transparent);
  background: color-mix(in srgb, var(--mat-sys-primary) 8%, var(--surface-2, #2e343f)); outline: none; }
.st-tool--off { cursor: not-allowed; opacity: .55; }
.st-tool__ico { --st-c: var(--mat-sys-primary); flex: none; width: 32px; height: 32px; border-radius: 9px; display: inline-flex; align-items: center;
  justify-content: center; background: color-mix(in srgb, var(--st-c) 16%, transparent); color: var(--st-c); }
.st-tool--off .st-tool__ico { background: rgba(255,255,255,.06); color: var(--cc-text-3); }
.st-tool__ico .mat-icon { font-size: 18px; width: 18px; height: 18px; }
.st-tool__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.st-tool__title { font-weight: 600; font-size: 13px; line-height: 1.3; display: inline-flex; align-items: center; gap: 4px; }
.st-tool__ask { font-size: 14px; width: 14px; height: 14px; color: var(--cc-text-3); flex: none; }
.st-tool__desc { font-size: 11.5px; color: var(--cc-text-2); line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.st-tool__reason { font-size: 11.5px; color: #d29922; display: inline-flex; align-items: center; gap: 4px; }
.st-tool__reason .mat-icon { font-size: 13px; width: 13px; height: 13px; }
.st-tool__go { color: var(--cc-text-3); flex: none; }
.st__more { align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; background: none; border: 0; color: var(--cc-text-2);
  font: inherit; font-size: 12px; cursor: pointer; padding: 4px 2px; }
.st__more:hover { color: var(--mat-sys-primary); }
.st__more .mat-icon { font-size: 18px; width: 18px; height: 18px; }
.st__form { gap: 12px; padding-top: 10px; }
.st__desc { margin: 0; font-size: 12.5px; line-height: 1.45; color: var(--cc-text-2); }
.st__fields { display: flex; flex-direction: column; gap: 10px; }
.st__field > span { display: inline-flex; gap: 3px; align-items: baseline; }
.st__req { color: #f85149; font-style: normal; }
.st__hint { font-size: 11px; color: var(--cc-text-3); }
.st__muted { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 12px; color: var(--cc-text-2); }
.st__muted .mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--mat-sys-primary); }
.st__muted-inline { color: var(--cc-text-3); font-size: 11px; }
.st__preview { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border-radius: 10px;
  background: color-mix(in srgb, var(--mat-sys-primary) 6%, transparent); border: 1px dashed color-mix(in srgb, var(--mat-sys-primary) 30%, transparent); }
.st__preview .st__sub { margin: 0 0 2px; }
.st__preview ol { margin: 0; padding: 0; list-style: none; counter-reset: st; display: flex; flex-direction: column; gap: 3px; }
.st__preview li { display: flex; align-items: flex-start; gap: 6px; font-size: 12.5px; line-height: 1.35; counter-increment: st; }
.st__preview li::before { content: counter(st) '.'; color: var(--cc-text-3); min-width: 16px; font-variant-numeric: tabular-nums; }
.st__kind { font-size: 15px; width: 15px; height: 15px; color: var(--cc-text-3); flex: none; margin-top: 1px; }
.st__task { min-width: 0; overflow-wrap: anywhere; }
.st__dup .wi-textarea { margin-top: 6px; }
.st__link { background: none; border: 0; padding: 0 4px; color: var(--mat-sys-primary); font: inherit; cursor: pointer; text-decoration: underline; }
.st__foot { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px; background: var(--surface-2, #2e343f);
  padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px)); }
.st__foot .mat-mdc-button-base .mat-icon { margin-right: 4px; }
.st__foot .mat-mdc-progress-spinner { display: inline-block; margin-right: 6px; vertical-align: middle; }
.st__spacer { flex: 1; }
.st__missing { font-size: 11.5px; color: #d29922; flex-basis: 100%; }
@media (max-width: 1023.98px) {
  .st-tool { padding: 10px 8px; }
}
`]
})
export class SpecialistToolsComponent {
  readonly card = input<string | null>(null);
  readonly cardType = input<'bug' | 'user-story'>('bug');
  /** Painel visível (foca a busca ao abrir). */
  readonly open = input<boolean>(true);
  readonly created = output<number>();
  readonly asked = output<void>();
  readonly closed = output<void>();
  readonly countChange = output<number>();

  private actions = inject(WorkItemActionsService);
  private api = inject(WorkItemsService);
  private chat = inject(CaseChatService);
  private pickers = inject(WorkItemPickerSource);
  private snack = inject(MatSnackBar);
  private searchRef = viewChild<ElementRef<HTMLInputElement>>('search');
  private host = inject(ElementRef<HTMLElement>);

  readonly catalog = signal<WorkItemCatalog | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly query = signal('');
  readonly showAll = signal(false);
  readonly selectedKey = signal<string | null>(null);
  readonly answers = signal<Record<string, string>>({});
  readonly note = signal('');
  readonly busy = signal<'create' | 'ask' | null>(null);
  readonly error = signal<string | null>(null);
  readonly duplicate = signal<WorkItemError['existing'] | null>(null);
  readonly duplicateReason = signal('');
  /** "Criar e iniciar": depois de criar, já executa (fila do executor). */
  readonly startAfter = signal(false);
  /** Tipo do item que será criado (o do modelo ou `task`; a pessoa pode trocar). */
  readonly itemType = signal('task');
  readonly githubUrl = this.pickers.githubUrl;
  private loadSeq = 0;
  /** Ferramenta pedida antes de o catálogo chegar. */
  private pendingKey: string | null = null;

  readonly ctx = computed(() => toolContext(this.catalog(), this.card()));
  readonly views = computed(() => buildToolViews(this.catalog(), this.cardType()));
  readonly applicableCount = computed(() => this.views().filter((v) => v.applicable).length);
  readonly offCount = computed(() => this.views().filter((v) => !v.applicable).length);
  readonly groups = computed(() => {
    const list = filterTools(this.views(), this.query());
    // Buscando, as que não se aplicam aparecem (desabilitadas) para a pessoa saber o motivo.
    return groupTools(this.showAll() || this.query().trim() ? list : list.filter((v) => v.applicable));
  });
  readonly current = computed(() => this.views().find((v) => v.key === this.selectedKey()) ?? null);
  readonly formTitle = computed(() => {
    const v = this.current();
    return v ? displayTitle(v.tool.title || v.key, v.ask, this.answers()) : '';
  });
  readonly formDescription = computed(() => {
    const v = this.current();
    if (!v) return '';
    return previewTasks({ tasks: [{ title: v.description, kind: 'manual' }], ask: v.ask }, this.answers(), this.ctx())[0]?.title ?? v.description;
  });
  readonly preview = computed(() => {
    const v = this.current();
    return v ? previewTasks(v.tool, this.answers(), this.ctx()) : [];
  });
  readonly missing = computed(() => {
    const v = this.current();
    return v ? missingAnswers(v.ask, this.answers()) : [];
  });
  /** Repositório das perguntas de branch/commits: o respondido; senão o padrão do card. */
  readonly repository = computed(() => {
    const v = this.current();
    const a = this.answers();
    const repoAsk = v?.ask.find((x) => `${x.input ?? ''}`.toLowerCase() === 'repository' || x.key === 'repository');
    return (repoAsk ? `${a[repoAsk.key] ?? ''}`.trim() : '') || this.ctx().defaultRepository || null;
  });

  constructor() {
    effect(() => {
      const card = (this.card() ?? '').trim() || null;
      untracked(() => this.switchCard(card));
    });
    effect(() => {
      const n = this.applicableCount();
      const loaded = !!this.catalog();
      untracked(() => { if (loaded) this.countChange.emit(n); });
    });
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        if (this.loadError()) this.load(true);
        setTimeout(() => this.searchRef()?.nativeElement.focus(), 120);
      });
    });
  }

  private switchCard(card: string | null): void {
    this.catalog.set(null);
    this.loadError.set(null);
    this.back();
    this.query.set('');
    this.showAll.set(false);
    if (card) this.load();
  }

  load(force = false): void {
    const card = (this.card() ?? '').trim();
    if (!card) return;
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.loadError.set(null);
    if (force) this.catalog.set(null);
    this.actions.catalog(card).subscribe({
      next: (c) => {
        if (seq !== this.loadSeq) return;
        this.catalog.set(c);
        this.loading.set(false);
        this.pickers.ensureGithubUrl(c);
        if (this.pendingKey) this.openTool(this.pendingKey);
      },
      error: (e) => {
        if (seq !== this.loadSeq) return;
        this.loading.set(false);
        this.loadError.set(e?.message ?? 'Não foi possível carregar as ferramentas.');
      }
    });
  }

  /** Abre o formulário da ferramenta (a lista do painel some; "voltar" retorna). */
  pick(v: ToolView): void {
    if (!v.applicable) return;
    this.pickers.loadRepositories();
    this.selectedKey.set(v.key);
    this.answers.set(initialAnswers(v.ask, this.ctx()));
    this.itemType.set(v.itemType);
    this.note.set('');
    this.error.set(null);
    this.duplicate.set(null);
    this.duplicateReason.set('');
  }

  /** Abre direto uma ferramenta pela chave (ex.: vindo de outro botão; 0090: do `/` do compositor) — espera o catálogo. */
  openTool(key: string): void {
    if (!this.catalog()) { this.pendingKey = key; return; }
    this.pendingKey = null;
    const v = this.views().find((x) => x.key === key);
    if (v) this.pick(v);
  }

  back(): void {
    this.selectedKey.set(null);
    this.error.set(null);
    this.duplicate.set(null);
    this.busy.set(null);
  }

  onEscape(e: Event): void {
    // Esc fecha primeiro o autocomplete (o painel dele fica no overlay); no formulário, volta à lista.
    if ((e.target as HTMLElement | null)?.getAttribute?.('aria-expanded') === 'true') return;
    e.stopPropagation();
    if (this.current()) this.back(); else this.closed.emit();
  }

  setAnswer(key: string, value: string | null | undefined): void {
    this.answers.update((a) => ({ ...a, [key]: `${value ?? ''}` }));
    if (this.duplicate()) { this.duplicate.set(null); this.duplicateReason.set(''); }
  }

  param(a: ToolAsk) {
    return askToParam(a);
  }

  required(a: ToolAsk): boolean {
    return a.required !== false;
  }

  /** Destino/branch: as opções da pergunta entram como destinos sugeridos; o resto vem das regras do card. */
  suggestFor(a: ToolAsk): BranchSuggestContext {
    const c = this.ctx();
    const opts = askOptions(a);
    return { mainBranch: c.mainBranch ?? null, branchesByTarget: c.branchesByTarget ?? null, flowTargets: opts.length ? opts : c.flowTargets ?? null };
  }

  /** Destinos conhecidos do repositório (quando a pergunta é de branch e traz opções). */
  optionsHint(a: ToolAsk): string | null {
    const input = `${a.input ?? ''}`.toLowerCase();
    if (input !== 'target-branch' && input !== 'branch') return null;
    const opts = askOptions(a);
    return opts.length ? `Destinos conhecidos: ${opts.join(', ')} — ou qualquer branch do repositório.` : null;
  }

  groupLabel(v: ToolView): string {
    return groupTools([v])[0]?.label ?? '';
  }

  shortDescription(v: ToolView): string {
    return previewTasks({ tasks: [{ title: v.description, kind: 'manual' }], ask: v.ask }, initialAnswers(v.ask, this.ctx()), this.ctx())[0]?.title ?? v.description;
  }

  kindIcon(kind: string): string {
    return kindInfo(kind, this.catalog()).icon;
  }

  kindLabel(kind: string): string {
    return kindInfo(kind, this.catalog()).label;
  }

  num(n: number): string {
    return formatWorkNumber(n);
  }

  statusLabel(s: string): string {
    return itemStatusLook(s).label.toLowerCase();
  }

  openExisting(n: number): void {
    this.created.emit(n);
  }

  /**
   * "Criar item": o servidor renderiza o modelo com as respostas e cria (origem `template`). "Criar e iniciar" (`start`) já
   * executa o item criado; se a execução falhar, o item fica criado e a mensagem diz para executar pela Bancada.
   */
  async create(allowDuplicate = false, start = false): Promise<void> {
    const v = this.current();
    const card = (this.card() ?? '').trim();
    if (!v || !card || this.busy()) return;
    if (!allowDuplicate && this.missing().length) { this.error.set(`Responda: ${this.missing().join(', ')}.`); return; }
    this.startAfter.set(start);
    this.busy.set('create');
    this.error.set(null);
    try {
      const item = await firstValueFrom(this.api.fromTemplate(card, {
        templateKey: v.key,
        answers: this.cleanAnswers(v),
        type: this.itemType(),
        ...(allowDuplicate ? { allowDuplicate: true, duplicateReason: this.duplicateReason().trim() } : {})
      }));
      let message = `Item ${formatWorkNumber(item.number)} criado pela ferramenta "${v.title}".`;
      if (start) {
        try {
          await firstValueFrom(this.api.execute(item.number));
          message = `Item ${formatWorkNumber(item.number)} criado e iniciado pela ferramenta "${v.title}".`;
        } catch (e) {
          message = `Item ${formatWorkNumber(item.number)} criado, mas não iniciou: ${e instanceof WorkItemError ? e.message : 'execute pela Bancada.'}`;
        }
      }
      this.snack.open(message, 'Ok', { duration: 5000 });
      this.back();
      this.created.emit(item.number);
    } catch (e) {
      if (e instanceof WorkItemError && e.code === 'duplicate') {
        this.duplicate.set(e.existing ?? { number: 0, title: '—', status: 'pending' });
        setTimeout(() => this.host.nativeElement.querySelector('.st__dup')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60);
      } else {
        this.error.set(e instanceof WorkItemError ? e.message : 'Não foi possível criar o item pela ferramenta.');
      }
    } finally {
      this.busy.set(null);
    }
  }

  /** "Pedir ao especialista": a mesma conversa do caso que o "Pedir ao especialista" da lista de itens usa. */
  async askSpecialist(): Promise<void> {
    const v = this.current();
    const card = (this.card() ?? '').trim();
    if (!v || !card || this.busy()) return;
    this.busy.set('ask');
    this.error.set(null);
    try {
      const text = specialistToolMessage({ key: v.key, title: this.formTitle() || v.title }, v.ask, this.cleanAnswers(v), this.note(), this.itemType());
      await firstValueFrom(this.chat.post(card, { text }));
      this.snack.open('Pedido enviado — o especialista responde na conversa do caso.', 'Ok', { duration: 3500 });
      this.back();
      this.asked.emit();
    } catch {
      this.error.set('Não foi possível enviar o pedido ao especialista.');
    } finally {
      this.busy.set(null);
    }
  }

  private cleanAnswers(v: ToolView): Record<string, string> {
    const a = this.answers();
    const out: Record<string, string> = {};
    for (const q of v.ask) {
      const value = `${a[q.key] ?? ''}`.trim();
      if (value) out[q.key] = value;
    }
    return out;
  }
}
