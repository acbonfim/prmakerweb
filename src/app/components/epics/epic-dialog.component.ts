import { Component, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { DevOpsService } from '../../services/devops.service';
import { DevOpsOption, EpicsService, epicApiError } from '../../services/epics.service';
import { boardLanes, laneFilterName, normalizeBoardFilter } from '../devops/board.logic';
import { DevOpsTagsInputComponent } from '../devops/devops-tags-input.component';
import { PmComboComponent, PmComboOption } from '../pm-combo/pm-combo.component';
import { hasValue } from '../pm-combo/pm-combo.logic';
import { PlanMarkdownPipe } from '../execution-plan/plan-markdown.pipe';
import { WORK_DIALOG_STYLES } from '../work-items/work-dialog.styles';
import { workDialogConfig } from '../work-items/work-dialog-config';
import { DEFAULT_EPIC_COLOR, EPIC_COLORS, Epic, SaveEpicRequest, epicColor, normalizeTags } from './epic.logic';

export interface EpicDialogData {
  /** Editar este épico; sem ele = criar. */
  epic?: Epic | null;
}

/** Épico salvo (criado ou editado) ou `undefined` (desistiu). */
export type EpicDialogResult = Epic | undefined;

/**
 * 0099: criar/editar épico da Mesa de gestão — título, descrição (markdown, com visualizar), cor (paleta), tags,
 * time/board do DevOps (`DevOps/teams` e `DevOps/boards?team=`) e, opcional, o card do DevOps que representa o épico.
 * Salva aqui mesmo (o erro aparece no diálogo).
 *
 * Ajustes 1: tags com chips e sugestões (as dos épicos — `GET Epics/tags` — e as do DevOps) + criar nova; time/board
 * no `app-pm-combo`; seção "Board do time" com as lanes do board escolhido (multi — viram `boardFilters.lanes`, as
 * únicas faixas mostradas) e as colunas exibidas (gravadas como `boardFilters.hiddenColumns`: as que ficaram de fora).
 */
@Component({
  selector: 'app-epic-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule, MatSlideToggleModule, PlanMarkdownPipe,
    PmComboComponent, DevOpsTagsInputComponent],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="wi-dlg ed">
      <header class="wi-dlg__head">
        <span class="ed__dot" [style.background]="color()"></span>
        <div class="wi-dlg__head-main">
          <span class="wi-dlg__title">{{ editing ? 'Editar épico #' + data.epic!.number : 'Novo épico' }}</span>
          <span class="wi-dlg__sub">Um tema de gestão: tarefas, cards do DevOps, arquivos e a conversa com o especialista num lugar só</span>
        </div>
        <button mat-icon-button mat-dialog-close aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </header>

      <div class="wi-dlg__body">
        <label class="wi-field">
          <span>Título</span>
          <input class="wi-input" [(ngModel)]="title" maxlength="300" placeholder="Ex.: Relatório de bugs de novembro"
                 (keydown.enter)="$event.preventDefault()">
        </label>

        <div class="wi-field">
          <span class="ed__label-row">Descrição <small class="wi-muted">(markdown)</small>
            <button type="button" class="ed__link" (click)="preview.set(!preview())">{{ preview() ? 'Editar' : 'Visualizar' }}</button></span>
          @if (preview()) {
            <div class="ed__preview plan-md wi-md" [innerHTML]="(description || '_Sem descrição._') | planMarkdown"></div>
          } @else {
            <textarea class="wi-textarea ed__desc" [(ngModel)]="description" rows="6"
                      placeholder="O que este épico organiza, o objetivo, critérios, links úteis…"></textarea>
          }
        </div>

        <div class="wi-field">
          <span>Cor</span>
          <div class="ed__colors" role="radiogroup" aria-label="Cor do épico">
            @for (c of colors; track c) {
              <button type="button" role="radio" class="ed__swatch" [style.background]="c" [class.ed__swatch--on]="color() === c"
                      [attr.aria-checked]="color() === c" [attr.aria-label]="'Cor ' + c" (click)="color.set(c)">
                @if (color() === c) { <mat-icon>check</mat-icon> }
              </button>
            }
          </div>
        </div>

        <div class="wi-field">
          <span>Tags <small class="wi-muted">(sugere as dos épicos e as do DevOps; Enter ou vírgula cria uma nova)</small></span>
          <app-devops-tags-input [(tags)]="tags" [suggest]="epicTags()" suggestHint="em épicos" newTitle="Tag nova"
                                 placeholder="Buscar ou criar tag" />
        </div>

        <div class="ed__sec">
          <span class="ed__sec-title"><mat-icon>view_kanban</mat-icon>Board do time</span>
          <div class="ed__row">
            <div class="wi-field ed__grow">
              <span>Time do DevOps</span>
              <app-pm-combo [options]="teamOptions()" [value]="team()" (valueChange)="pickTeam($event)" [allowEmpty]="true" emptyLabel="Sem time"
                            [loading]="teamsLoading()" loadingText="Carregando times…" icon="groups" placeholder="Sem time"
                            ariaLabel="Time do DevOps" emptyText="Nenhum time com esse nome" />
            </div>
            <div class="wi-field ed__grow">
              <span>Board</span>
              <app-pm-combo [options]="boardOptions()" [value]="board()" (valueChange)="pickBoard($event)" [disabled]="!team()"
                            [loading]="boardsLoading()" loadingText="Carregando boards…" icon="view_kanban"
                            [placeholder]="team() ? 'Escolha o board' : 'Escolha o time antes'" ariaLabel="Board"
                            emptyText="Nenhum board com esse nome" />
            </div>
          </div>
          @if (team() && board()) {
            <div class="ed__row">
              <div class="wi-field ed__grow">
                <span>Lanes mostradas <small class="wi-muted">(sem nenhuma, todas)</small></span>
                <app-pm-combo [multiple]="true" [options]="laneOptions()" [values]="lanes()" (valuesChange)="lanes.set($event)"
                              [loading]="lanesLoading()" loadingText="Carregando as lanes do board…" [error]="lanesError()"
                              noOptionsText="O board não tem lanes" emptyText="Nenhuma lane com esse nome"
                              placeholder="Todas as lanes" ariaLabel="Lanes mostradas" />
              </div>
              <div class="wi-field ed__grow">
                <span>Colunas mostradas <small class="wi-muted">(sem nenhuma, todas)</small></span>
                <app-pm-combo [multiple]="true" [options]="columnOptions()" [values]="shownColumns()" (valuesChange)="pickColumns($event)"
                              [loading]="lanesLoading()" loadingText="Carregando as colunas do board…" [error]="lanesError()"
                              noOptionsText="O board não tem colunas" emptyText="Nenhuma coluna com esse nome"
                              placeholder="Todas as colunas" ariaLabel="Colunas mostradas" />
              </div>
            </div>
          }
          @if (devOpsError()) { <small class="wi-err">{{ devOpsError() }}</small> }
          <small class="wi-muted">O board do épico abre neste time/board (dá para trocar para o board inteiro do time na aba Board). As lanes
            e colunas escolhidas ficam salvas no épico (filtro de Lane e "Colunas" do board) — o especialista considera no board do time.</small>
        </div>

        <label class="wi-field">
          <span>Card do DevOps que representa o épico <small class="wi-muted">(opcional — Epic/Feature)</small></span>
          <input class="wi-input ed__card" [(ngModel)]="devOpsCardId" inputmode="numeric" maxlength="100" placeholder="Ex.: 78100">
        </label>

        <!-- 0104: rascunhos de histórias pelos cards do épico (ligado por padrão; muda a qualquer momento) -->
        <div class="wi-field ed__drafts">
          <mat-slide-toggle [(ngModel)]="allowCardStoryDrafts" aria-describedby="ed-drafts-hint">
            Permitir rascunhos de histórias pelos cards
          </mat-slide-toggle>
          <small id="ed-drafts-hint" class="wi-muted">O Especialista do caso dos cards deste épico pode escrever histórias e bugs como
            <b>rascunho</b> na aba Histórias. Converter em card continua só aqui na Mesa (papel admin ou management).</small>
        </div>

        @if (error()) { <div class="wi-note wi-note--warn"><mat-icon>error_outline</mat-icon><span>{{ error() }}</span></div> }
      </div>

      <footer class="wi-dlg__foot">
        <span class="wi-dlg__spacer"></span>
        <button mat-button mat-dialog-close>Cancelar</button>
        <button mat-flat-button color="primary" (click)="save()" [disabled]="saving() || !title.trim()">
          <mat-icon>{{ editing ? 'save' : 'add' }}</mat-icon>{{ saving() ? 'Salvando…' : editing ? 'Salvar' : 'Criar épico' }}
        </button>
      </footer>
    </div>
  `,
  styles: [WORK_DIALOG_STYLES, `
    .ed__dot { width: 14px; height: 14px; border-radius: 50%; flex: none; margin-left: 2px; box-shadow: 0 0 0 3px rgba(255,255,255,.08); }
    .ed__label-row { display: flex; align-items: center; gap: 6px; }
    .ed__link { margin-left: auto; background: none; border: 0; padding: 0; font: inherit; font-size: 11.5px; color: var(--mat-sys-primary); cursor: pointer; }
    .ed__desc { min-height: 120px; }
    .ed__drafts { gap: 6px; }
    .ed__preview { min-height: 120px; max-height: 320px; overflow: auto; padding: 8px 10px; border-radius: 8px; background: var(--surface-input, #1a1f28);
      border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); }
    .ed__colors { display: flex; flex-wrap: wrap; gap: 8px; }
    .ed__swatch { width: 28px; height: 28px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; display: grid; place-items: center; padding: 0; color: #fff; }
    .ed__swatch:focus-visible { outline: 2px solid var(--mat-sys-primary); outline-offset: 2px; }
    .ed__swatch--on { border-color: var(--mat-sys-on-surface); }
    .ed__swatch mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .ed__sec { display: flex; flex-direction: column; gap: 10px; padding: 10px 12px 12px; border-radius: 10px;
      border: 1px solid var(--cc-surface-border, rgba(255,255,255,.08)); background: color-mix(in srgb, var(--surface-2, #2e343f) 40%, transparent); }
    .ed__sec-title { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; text-transform: uppercase;
      letter-spacing: .04em; color: var(--cc-text-2); }
    .ed__sec-title mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .ed__row { display: flex; gap: 10px; flex-wrap: wrap; }
    .ed__grow { flex: 1 1 200px; }
    .ed__card { max-width: 220px; }
  `]
})
export class EpicDialogComponent {
  readonly data = inject<EpicDialogData>(MAT_DIALOG_DATA) ?? {};
  private ref = inject<MatDialogRef<EpicDialogComponent, EpicDialogResult>>(MatDialogRef);
  private api = inject(EpicsService);
  private devops = inject(DevOpsService);

  readonly editing = !!this.data.epic;
  readonly colors = EPIC_COLORS;

  title = this.data.epic?.title ?? '';
  description = this.data.epic?.description ?? '';
  devOpsCardId = this.data.epic?.devOpsCardId ?? '';
  /** 0104: rascunhos de histórias pelos cards (épico antigo sem o campo = ligado). */
  allowCardStoryDrafts = this.data.epic?.allowCardStoryDrafts ?? true;
  readonly color = signal(this.data.epic ? epicColor(this.data.epic.color) : DEFAULT_EPIC_COLOR);
  readonly tags = signal<string[]>(normalizeTags(this.data.epic?.tags));
  readonly team = signal<string | null>(this.data.epic?.devOpsTeam || null);
  readonly board = signal<string | null>(this.data.epic?.devOpsBoard || null);
  readonly preview = signal(false);

  readonly teams = signal<DevOpsOption[]>([]);
  readonly boards = signal<DevOpsOption[]>([]);
  readonly teamsLoading = signal(false);
  readonly boardsLoading = signal(false);
  readonly devOpsError = signal<string | null>(null);
  /** O valor salvo continua na lista mesmo se o DevOps não responder (ou o time sumiu). */
  readonly teamOptions = computed<PmComboOption[]>(() =>
    withCurrent(this.teams().map((t) => t.name), this.team()).map((n) => ({ value: n, label: n, icon: 'groups' })));
  readonly boardOptions = computed<PmComboOption[]>(() =>
    withCurrent(this.boards().map((b) => b.name), this.board()).map((n) => ({ value: n, label: n, icon: 'view_kanban' })));

  /** Tags já usadas nos épicos (sugestões antes das do DevOps). */
  readonly epicTags = signal<string[]>([]);

  /** Lanes do board escolhido e as que o épico acompanha (`boardFilters.lanes`). */
  private readonly savedFilters = normalizeBoardFilter(this.data.epic?.boardFilters);
  readonly lanes = signal<string[]>(this.savedFilters.lanes);
  readonly boardLaneNames = signal<string[]>([]);
  readonly lanesLoading = signal(false);
  readonly lanesError = signal<string | null>(null);
  readonly laneOptions = computed<PmComboOption[]>(() =>
    withCurrentList(this.boardLaneNames(), this.lanes()).map((n) => ({ value: n, label: n, icon: 'table_rows' })));

  /** Colunas do board e as mostradas (vazio = todas; grava as de fora como `hiddenColumns`). */
  readonly boardColumnNames = signal<string[]>([]);
  readonly shownColumns = signal<string[]>([]);
  /** Ocultas a gravar: começam nas salvas; mudam quando a pessoa escolhe as colunas ou troca o board. */
  private hiddenColumns: string[] = this.savedFilters.hiddenColumns;
  readonly columnOptions = computed<PmComboOption[]>(() =>
    this.boardColumnNames().map((n) => ({ value: n, label: n, icon: 'view_week' })));

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    void this.loadTeams();
    if (this.team()) void this.loadBoards(this.team()!);
    if (this.team() && this.board()) void this.loadLanes(this.team()!, this.board()!);
    this.api.tags().subscribe({ next: (t) => this.epicTags.set(t ?? []), error: () => undefined });
  }

  /** Lanes e colunas do board (`GET DevOps/board?team=&board=`); a lane padrão sem nome aparece como "Padrão". */
  private async loadLanes(team: string, board: string): Promise<void> {
    this.lanesLoading.set(true);
    this.lanesError.set(null);
    this.boardLaneNames.set([]);
    this.boardColumnNames.set([]);
    try {
      const cfg = await firstValueFrom(this.devops.board(team, board));
      if (this.team() !== team || this.board() !== board) return;
      this.boardLaneNames.set(boardLanes(cfg).map(laneFilterName).filter(Boolean));
      const cols = (cfg.columns ?? []).map((c) => c.name);
      this.boardColumnNames.set(cols);
      // Com colunas ocultas salvas, as mostradas são as outras (todas ocultas = todas).
      const shown = this.hiddenColumns.length ? cols.filter((c) => !hasValue(this.hiddenColumns, c)) : [];
      this.shownColumns.set(shown.length === cols.length ? [] : shown);
    } catch (e) {
      if (this.team() === team && this.board() === board) this.lanesError.set(epicApiError(e, 'Não foi possível ler as lanes do board.'));
    } finally {
      if (this.team() === team && this.board() === board) this.lanesLoading.set(false);
    }
  }

  private async loadTeams(): Promise<void> {
    this.teamsLoading.set(true);
    try {
      this.teams.set(await firstValueFrom(this.api.teams()) ?? []);
    } catch (e) {
      this.devOpsError.set(epicApiError(e, 'Não foi possível ler os times do DevOps (confira sua integração pessoal).'));
    } finally {
      this.teamsLoading.set(false);
    }
  }

  private async loadBoards(team: string): Promise<void> {
    this.boardsLoading.set(true);
    try {
      const list = await firstValueFrom(this.api.boards(team)) ?? [];
      if (this.team() !== team) return;
      this.boards.set(list);
      // Um board só (o comum): já vem escolhido.
      if (!this.board() && list.length === 1) this.pickBoard(list[0].name);
    } catch (e) {
      if (this.team() === team) this.devOpsError.set(epicApiError(e, 'Não foi possível ler os boards do time.'));
    } finally {
      if (this.team() === team) this.boardsLoading.set(false);
    }
  }

  pickTeam(team: string | null): void {
    if (team === this.team()) return;
    this.team.set(team);
    this.board.set(null);
    this.boards.set([]);
    this.resetBoardView();
    this.devOpsError.set(null);
    if (team) void this.loadBoards(team);
  }

  /** Outro time/board: lanes e colunas voltam a "todas". */
  private resetBoardView(): void {
    this.lanes.set([]);
    this.boardLaneNames.set([]);
    this.boardColumnNames.set([]);
    this.shownColumns.set([]);
    this.hiddenColumns = [];
  }

  /** Colunas mostradas → ocultas (as do board que ficaram de fora; nenhuma ou todas = nenhuma oculta). */
  pickColumns(shown: string[]): void {
    const all = this.boardColumnNames();
    const full = !shown.length || all.every((c) => hasValue(shown, c));
    this.shownColumns.set(full ? [] : shown);
    this.hiddenColumns = full ? [] : all.filter((c) => !hasValue(shown, c));
  }

  pickBoard(board: string | null): void {
    if (board === this.board()) return;
    this.board.set(board);
    this.resetBoardView();
    const team = this.team();
    if (team && board) void this.loadLanes(team, board);
  }

  /** Filtros do board a gravar: só quando lanes/colunas mudaram (null = o servidor não mexe). */
  private boardFiltersToSave(): SaveEpicRequest['boardFilters'] {
    const lanes = this.lanes();
    const hiddenColumns = this.hiddenColumns;
    const differs = (a: string[], b: string[]) => a.length !== b.length || a.some((x) => !hasValue(b, x));
    if (!differs(lanes, this.savedFilters.lanes) && !differs(hiddenColumns, this.savedFilters.hiddenColumns)) return null;
    return { ...this.savedFilters, lanes, hiddenColumns };
  }

  async save(): Promise<void> {
    const title = this.title.trim();
    if (!title || this.saving()) return;
    const body: SaveEpicRequest = {
      title,
      description: this.description.trim() || null,
      color: this.color(),
      tags: normalizeTags(this.tags()),
      devOpsTeam: this.team(),
      devOpsBoard: this.team() ? this.board() : null,
      devOpsCardId: `${this.devOpsCardId ?? ''}`.trim().replace(/^#/, '') || null,
      boardFilters: this.boardFiltersToSave(),
      allowCardStoryDrafts: this.allowCardStoryDrafts
    };
    this.saving.set(true);
    this.error.set(null);
    try {
      const saved = this.editing
        ? await firstValueFrom(this.api.update(this.data.epic!.number, body))
        : await firstValueFrom(this.api.create(body));
      this.ref.close(saved);
    } catch (e) {
      this.error.set(epicApiError(e, this.editing ? 'Não foi possível salvar o épico.' : 'Não foi possível criar o épico.'));
    } finally {
      this.saving.set(false);
    }
  }
}

function withCurrent(list: string[], current: string | null): string[] {
  return current && !list.includes(current) ? [current, ...list] : list;
}

/** As lanes já escolhidas continuam na lista mesmo se o board não as tiver mais. */
function withCurrentList(list: string[], current: string[]): string[] {
  return [...list, ...current.filter((c) => !hasValue(list, c))];
}

/** Abre o diálogo de épico (criar sem `epic`; editar com ele). */
export function openEpicDialog(dialog: MatDialog, epic?: Epic | null): Promise<EpicDialogResult> {
  return firstValueFrom(dialog.open<EpicDialogComponent, EpicDialogData, EpicDialogResult>(
    EpicDialogComponent, workDialogConfig({ epic: epic ?? null }, '640px')
  ).afterClosed());
}
