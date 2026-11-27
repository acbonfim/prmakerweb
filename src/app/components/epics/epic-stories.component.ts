import { Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Subscription, firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EpicStoriesService } from '../../services/epic-stories.service';
import { EpicsService } from '../../services/epics.service';
import {
  EpicStory, EpicStoryType, STORY_FILTERS, StoryFilter, buildSaveStory, canConvertStory, countByStoryFilter, filterStories,
  openStoryCount, storyApiError, storyCardId, storyStatusLook, storyToDraft, storyTypeLook
} from './epic-stories.logic';
import { openEpicStoryConvert } from './epic-story-convert-dialog.component';
import { openEpicStoryDialog } from './epic-story-dialog.component';

const SNACK = { duration: 4000, horizontalPosition: 'right' as const, verticalPosition: 'bottom' as const };

/**
 * 0099 (ajustes 2): aba **Histórias** do épico — histórias (User Story) e bugs escritos no PRMake antes de virarem card
 * no DevOps (pela pessoa ou em rascunho pelo Especialista). Lista com ícone do tipo, `#n`, título, situação, quem/quando
 * e o card convertido ("Card #123 ↗" → `cardOpened`); filtros por situação; "+ História"/"+ Bug" e o editor
 * (`EpicStoryDialogComponent`); "Converter em card" com confirmação de onde entra no board — some depois da conversão.
 *
 * Entradas: `epic` (número), `team`/`board` (board do épico, para a coluna/lane da conversão). Saídas: `cardOpened`
 * (número do card) e `countChange` (rascunhos + prontas — a contagem da aba). Tempo real: `epicsUpdated` do épico.
 */
@Component({
  selector: 'app-epic-stories',
  standalone: true,
  imports: [DatePipe, MatButtonModule, MatIconModule, MatMenuModule, MatProgressSpinnerModule, MatTooltipModule],
  template: `
    <div class="est__bar">
      <div class="est__seg" role="radiogroup" aria-label="Filtrar histórias por situação">
        @for (f of filters; track f.key) {
          <button type="button" role="radio" class="est__seg-btn" [class.est__seg-btn--on]="filter() === f.key" [attr.aria-checked]="filter() === f.key"
                  (click)="filter.set(f.key)">{{ f.label }}<small>{{ counts()[f.key] }}</small></button>
        }
      </div>
      <span class="est__spacer"></span>
      <button mat-stroked-button type="button" class="est__act" (click)="create('user-story')" matTooltip="Escrever uma história (vira User Story no DevOps)"
              matTooltipShowDelay="600"><mat-icon [style.color]="usLook.color">{{ usLook.icon }}</mat-icon>História</button>
      <button mat-stroked-button type="button" class="est__act" (click)="create('bug')" matTooltip="Escrever um bug (vira Bug no DevOps)"
              matTooltipShowDelay="600"><mat-icon [style.color]="bugLook.color">{{ bugLook.icon }}</mat-icon>Bug</button>
    </div>

    @if (loading() && !stories().length) {
      <div class="est__msg"><mat-spinner diameter="18"></mat-spinner>Carregando as histórias…</div>
    } @else if (error() && !stories().length) {
      <div class="est__msg est__msg--bad">{{ error() }}<button mat-button type="button" (click)="load()">Tentar de novo</button></div>
    } @else if (!stories().length) {
      <div class="est__empty">
        <mat-icon class="est__empty-icon">edit_note</mat-icon>
        <h2>Nenhuma história ainda</h2>
        <p>Escreva aqui histórias e bugs antes de virarem card no DevOps; o Especialista também escreve rascunhos. Quando estiver
          pronta, <b>Converter em card</b> cria o card no DevOps (dentro deste épico) e a história fica só leitura, com o link do card.</p>
        <div class="est__empty-acts">
          <button mat-flat-button color="primary" type="button" (click)="create('user-story')"><mat-icon>{{ usLook.icon }}</mat-icon>Nova história</button>
          <button mat-stroked-button type="button" (click)="create('bug')"><mat-icon>{{ bugLook.icon }}</mat-icon>Novo bug</button>
        </div>
      </div>
    } @else if (!visible().length) {
      <div class="est__msg">Nenhuma história neste filtro.<button mat-button type="button" (click)="filter.set('all')">Ver todas</button></div>
    } @else {
      <ul class="est__list">
        @for (s of visible(); track s.number) {
          @let t = typeLook(s.type);
          @let st = statusLook(s.status);
          @let cid = cardOf(s);
          <li class="est__row" [class.est__row--off]="s.status === 'discarded'" [style.--ty]="t.color">
            <span class="est__bar-ty" aria-hidden="true"></span>
            <button type="button" class="est__main" (click)="edit(s)" [attr.aria-label]="(s.status === 'converted' ? 'Ver ' : 'Editar ') + t.label + ' ' + s.number">
              <span class="est__line">
                <mat-icon class="est__ty" [style.color]="t.color" [matTooltip]="t.label + ' (' + t.devOpsType + ' no DevOps)'">{{ t.icon }}</mat-icon>
                <span class="est__num">#{{ s.number }}</span>
                <span class="est__title">{{ s.title }}</span>
              </span>
              <span class="est__meta">
                <span class="est__st" [style.--st]="st.color" [matTooltip]="st.hint"><mat-icon>{{ st.icon }}</mat-icon>{{ st.label }}</span>
                @if (s.priority) { <span matTooltip="Prioridade"><mat-icon>flag</mat-icon>P{{ s.priority }}</span> }
                @if (s.type === 'bug' && s.severity) { <span matTooltip="Severidade"><mat-icon>report</mat-icon>{{ s.severity }}</span> }
                @for (tag of s.tags.slice(0, 3); track tag) { <span class="est__tag">{{ tag }}</span> }
                @if (s.tags.length > 3) { <span class="est__faint">+{{ s.tags.length - 3 }}</span> }
                @if (s.sourceCard) {
                  <span class="est__tag" matTooltip="Rascunho escrito pelo Especialista do caso deste card"><mat-icon>chat</mat-icon>pelo card {{ s.sourceCard }}</span>
                }
                @if (s.status === 'converted' && (s.convertedByName || s.convertedAt)) {
                  <span>convertida@if (s.convertedByName) { por {{ s.convertedByName }} }@if (s.convertedAt) { · {{ s.convertedAt | date: 'dd/MM HH:mm' }} }</span>
                } @else {
                  <span>{{ s.createdByName || 'PRMake' }} · {{ s.updatedAt | date: 'dd/MM HH:mm' }}</span>
                }
              </span>
            </button>
            <span class="est__acts">
              @if (cid) {
                <button mat-stroked-button type="button" class="est__card" (click)="cardOpened.emit(cid)" [attr.aria-label]="'Abrir o card ' + cid">
                  Card #{{ cid }}<mat-icon iconPositionEnd>north_east</mat-icon>
                </button>
              } @else if (canConvert(s)) {
                <button mat-stroked-button type="button" class="est__act" (click)="convert(s)" [disabled]="busy() === s.number"
                        matTooltip="Criar o card no DevOps a partir desta história">
                  <mat-icon>move_up</mat-icon>Converter em card
                </button>
              }
              <button mat-icon-button type="button" class="est__icon" [matMenuTriggerFor]="rowMenu" [attr.aria-label]="'Ações da história ' + s.number">
                <mat-icon>more_vert</mat-icon>
              </button>
              <mat-menu #rowMenu="matMenu" class="app-menu">
                <button mat-menu-item type="button" (click)="edit(s)">
                  <mat-icon>{{ s.status === 'converted' ? 'visibility' : 'edit' }}</mat-icon><span>{{ s.status === 'converted' ? 'Ver' : 'Editar' }}</span>
                </button>
                @if (s.status === 'draft' || s.status === 'ready') {
                  <button mat-menu-item type="button" (click)="discard(s)"><mat-icon>delete_outline</mat-icon><span>Descartar</span></button>
                }
                @if (s.status === 'discarded') {
                  <button mat-menu-item type="button" (click)="restore(s)"><mat-icon>restore_from_trash</mat-icon><span>Restaurar como rascunho</span></button>
                }
              </mat-menu>
            </span>
          </li>
        }
      </ul>
    }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 8px; min-height: 0; --est-border: var(--cc-surface-border, rgba(255,255,255,.08));
      --est-muted: var(--cc-text-2, rgba(255,255,255,.66)); --est-faint: var(--cc-text-3, rgba(255,255,255,.45)); }
    .est__bar { flex: none; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .est__spacer { flex: 1 1 auto; }
    .est__seg { display: inline-flex; flex-wrap: wrap; gap: 2px; padding: 2px; border-radius: 9px; background: var(--surface-input, #1a1f28);
      border: 1px solid var(--est-border); }
    .est__seg-btn { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border: 0; border-radius: 7px; background: none; cursor: pointer;
      font: inherit; font-size: 12.5px; color: var(--est-muted); }
    .est__seg-btn small { font-size: 11px; color: var(--est-faint); font-variant-numeric: tabular-nums; }
    .est__seg-btn--on { background: var(--surface-3, #212730); color: var(--cc-text-1); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--mat-sys-primary) 45%, transparent); }
    .est__seg-btn:focus-visible { outline: 2px solid var(--mat-sys-primary); outline-offset: 1px; }
    .est__act.mat-mdc-outlined-button, .est__card.mat-mdc-outlined-button { height: 30px; font-size: 12.5px; padding: 0 10px; }
    .est__act mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .est__act mat-spinner { display: inline-block; margin-right: 6px; }
    .est__card { color: var(--mat-sys-primary) !important; }
    .est__card mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .est__msg { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 16px 4px; color: var(--est-muted); font-size: 13px; }
    .est__msg--bad { color: #f85149; }
    .est__empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; padding: 32px 16px; border-radius: 12px;
      border: 1px dashed var(--est-border); color: var(--est-muted); }
    .est__empty h2 { margin: 0; font-size: 16px; font-weight: 600; color: var(--cc-text-1); }
    .est__empty p { margin: 0; max-width: 560px; font-size: 13px; line-height: 1.5; }
    .est__empty-icon { font-size: 40px; width: 40px; height: 40px; color: var(--est-faint); }
    .est__empty-acts { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 4px; }
    .est__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .est__row { --ty: #8b949e; display: flex; align-items: stretch; gap: 8px; padding-right: 6px; border-radius: 10px; border: 1px solid var(--est-border);
      background: var(--surface-1, #262b33); overflow: hidden; }
    .est__row:hover { border-color: color-mix(in srgb, var(--ty) 45%, transparent); }
    .est__row--off { opacity: .62; }
    .est__bar-ty { flex: none; width: 4px; background: var(--ty); }
    .est__main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; padding: 8px 0; border: 0; background: none; color: inherit;
      font: inherit; text-align: left; cursor: pointer; }
    .est__main:focus-visible { outline: 2px solid var(--mat-sys-primary); outline-offset: 2px; }
    .est__line { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .est__ty { flex: none; font-size: 17px; width: 17px; height: 17px; }
    .est__num { flex: none; font-weight: 600; font-size: 13px; color: var(--est-muted); font-variant-numeric: tabular-nums; }
    .est__title { min-width: 0; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .est__row--off .est__title { text-decoration: line-through; }
    .est__meta { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 12px; font-size: 11.5px; color: var(--est-faint); }
    .est__meta > span { display: inline-flex; align-items: center; gap: 3px; }
    .est__meta mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .est__st { --st: #8b949e; padding: 0 7px 0 4px; border-radius: 999px; font-weight: 600; color: color-mix(in srgb, var(--st) 82%, white);
      background: color-mix(in srgb, var(--st) 14%, transparent); border: 1px solid color-mix(in srgb, var(--st) 34%, transparent); }
    .est__tag { padding: 0 6px; border-radius: 8px; background: var(--surface-3, #212730); color: var(--est-muted); }
    .est__faint { color: var(--est-faint); }
    .est__acts { flex: none; display: inline-flex; align-items: center; gap: 4px; }
    .est__icon.mat-mdc-icon-button { --mat-icon-button-state-layer-size: 32px; width: 32px; height: 32px; padding: 4px; }
    @media (max-width: 640px) {
      .est__row { flex-wrap: wrap; padding-right: 0; }
      .est__acts { width: 100%; justify-content: flex-end; padding: 0 6px 6px; }
    }
  `]
})
export class EpicStoriesComponent {
  private api = inject(EpicStoriesService);
  private epics = inject(EpicsService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);

  /** Número do épico. */
  readonly epic = input<number | null>(null);
  /** Board do épico (coluna/lane na conversão). */
  readonly team = input<string | null>(null);
  readonly board = input<string | null>(null);
  /** "Card #123 ↗": o número do card do DevOps. */
  readonly cardOpened = output<string>();
  /** Rascunhos + prontas (contagem da aba), a cada carga. */
  readonly countChange = output<number>();

  readonly filters = STORY_FILTERS;
  readonly usLook = storyTypeLook('user-story');
  readonly bugLook = storyTypeLook('bug');

  readonly stories = signal<EpicStory[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly filter = signal<StoryFilter>('all');
  readonly busy = signal<number | null>(null);
  readonly counts = computed(() => countByStoryFilter(this.stories()));
  readonly visible = computed(() => filterStories(this.stories(), this.filter()));

  /** Tags dos épicos (sugestões do editor). */
  private epicTags: string[] = [];
  private loadSub?: Subscription;
  private stopLive?: () => void;
  private liveTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    effect(() => {
      const n = this.epic();
      untracked(() => this.watch(n));
    });
    this.epics.tags().subscribe({ next: (t) => (this.epicTags = t ?? []), error: () => undefined });
    inject(DestroyRef).onDestroy(() => {
      this.loadSub?.unsubscribe();
      this.stopLive?.();
      clearTimeout(this.liveTimer);
    });
  }

  private watch(n: number | null): void {
    this.stopLive?.();
    this.stopLive = undefined;
    this.stories.set([]);
    this.error.set(null);
    this.filter.set('all');
    if (!n) return;
    this.load();
    this.stopLive = this.api.listen(n, () => {
      clearTimeout(this.liveTimer);
      this.liveTimer = setTimeout(() => this.load(true), 300);
    });
  }

  load(quiet = false): void {
    const n = this.epic();
    if (!n) return;
    this.loadSub?.unsubscribe();
    if (!quiet) this.loading.set(true);
    this.loadSub = this.api.list(n).subscribe({
      next: (list) => {
        if (this.epic() !== n) return;
        this.stories.set(list ?? []);
        this.error.set(null);
        this.loading.set(false);
        this.countChange.emit(openStoryCount(this.stories()));
      },
      error: (e) => {
        if (this.epic() !== n) return;
        this.error.set(storyApiError(e, 'Não foi possível carregar as histórias do épico.').message);
        this.loading.set(false);
      }
    });
  }

  typeLook(type: string) { return storyTypeLook(type); }
  statusLook(status: string) { return storyStatusLook(status); }
  cardOf(s: EpicStory): string | null { return storyCardId(s); }
  canConvert(s: EpicStory): boolean { return canConvertStory(s); }

  /** Troca a história na lista (resposta do salvar/converter) sem esperar o tempo real. */
  private upsert(story: EpicStory): void {
    this.stories.update((list) => {
      const i = list.findIndex((x) => x.number === story.number);
      return i < 0 ? [story, ...list] : list.map((x, j) => (j === i ? story : x));
    });
    this.countChange.emit(openStoryCount(this.stories()));
  }

  async create(type: EpicStoryType): Promise<void> {
    const n = this.epic();
    if (!n) return;
    const res = await openEpicStoryDialog(this.dialog, { epic: n, type, suggestTags: this.epicTags });
    if (res?.story) {
      this.upsert(res.story);
      if (this.filter() !== 'all' && this.filter() !== res.story.status) this.filter.set('all');
    }
  }

  async edit(s: EpicStory): Promise<void> {
    const n = this.epic();
    if (!n) return;
    const res = await openEpicStoryDialog(this.dialog, { epic: n, story: s, suggestTags: this.epicTags });
    if (res?.openCard) this.cardOpened.emit(res.openCard);
    if (res?.story) this.upsert(res.story);
  }

  /** Confirmação (o diálogo converte) → a linha vira "Card #n ↗". */
  async convert(s: EpicStory): Promise<void> {
    const n = this.epic();
    if (!n) return;
    const res = await openEpicStoryConvert(this.dialog, { story: s, epic: n, team: this.team(), board: this.board() });
    if (res?.story) {
      this.upsert(res.story);
      const cid = storyCardId(res.story);
      if (cid) {
        this.snack.open(`Card #${cid} criado no DevOps`, 'Abrir', { ...SNACK, duration: 6000 })
          .onAction().subscribe(() => this.cardOpened.emit(cid));
      }
    } else if (res && 'alreadyCard' in res) {
      this.snack.open(res.alreadyCard ? `Esta história já virou o card #${res.alreadyCard}.` : 'Esta história já virou card.', 'Ok', SNACK);
      this.load(true);
    }
  }

  async discard(s: EpicStory): Promise<void> {
    if (this.busy()) return;
    this.busy.set(s.number);
    try {
      await firstValueFrom(this.api.discard(s.number));
      this.upsert({ ...s, status: 'discarded' });
      this.snack.open(`#${s.number} descartada`, 'Desfazer', { ...SNACK, duration: 6000 })
        .onAction().subscribe(() => void this.restore({ ...s, status: 'discarded' }, s.status === 'ready' ? 'ready' : 'draft'));
    } catch (e) {
      this.snack.open(storyApiError(e, 'Não foi possível descartar.').message, 'Ok', SNACK);
    } finally {
      this.busy.set(null);
    }
  }

  /** Volta uma descartada (PUT com o conteúdo dela e a situação de antes — rascunho por padrão). */
  async restore(s: EpicStory, status: 'draft' | 'ready' = 'draft'): Promise<void> {
    try {
      const story = await firstValueFrom(this.api.update(s.number, buildSaveStory({ ...storyToDraft(s), status })));
      this.upsert(story);
    } catch (e) {
      this.snack.open(storyApiError(e, 'Não foi possível restaurar.').message, 'Ok', SNACK);
    }
  }
}
