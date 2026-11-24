import { Component, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DevOpsOption, EpicsService, epicApiError } from '../../services/epics.service';
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
 * 0099: criar/editar épico da Mesa de gestão — título, descrição (markdown, com visualizar), cor (paleta), tags livres
 * (chips: Enter ou vírgula), time/board do DevOps (selects de `DevOps/teams` e `DevOps/boards?team=`) e, opcional, o
 * card do DevOps que representa o épico. Salva aqui mesmo (o erro aparece no diálogo).
 */
@Component({
  selector: 'app-epic-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule, PlanMarkdownPipe],
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
          <span>Tags</span>
          <div class="ed__tags" (click)="tagInput.focus()">
            @for (t of tags(); track t) {
              <span class="ed__tag">{{ t }}<button type="button" (click)="removeTag(t); $event.stopPropagation()" [attr.aria-label]="'Remover a tag ' + t"><mat-icon>close</mat-icon></button></span>
            }
            <input #tagInput class="ed__tag-input" [(ngModel)]="tagDraft" placeholder="Nova tag — Enter para adicionar"
                   (keydown.enter)="addTag(); $event.preventDefault()" (keydown)="onTagKey($event)" (blur)="addTag()" aria-label="Nova tag">
          </div>
        </div>

        <div class="ed__row">
          <label class="wi-field ed__grow">
            <span>Time do DevOps</span>
            <select class="wi-select" [ngModel]="team()" (ngModelChange)="pickTeam($event)" [disabled]="teamsLoading()">
              <option [ngValue]="null">{{ teamsLoading() ? 'Carregando times…' : 'Sem time' }}</option>
              @for (t of teamOptions(); track t) { <option [ngValue]="t">{{ t }}</option> }
            </select>
          </label>
          <label class="wi-field ed__grow">
            <span>Board</span>
            <select class="wi-select" [ngModel]="board()" (ngModelChange)="board.set($event)" [disabled]="!team() || boardsLoading()">
              <option [ngValue]="null">{{ boardsLoading() ? 'Carregando boards…' : (team() ? 'Escolha o board' : 'Escolha o time antes') }}</option>
              @for (b of boardOptions(); track b) { <option [ngValue]="b">{{ b }}</option> }
            </select>
          </label>
        </div>
        @if (devOpsError()) { <small class="wi-err">{{ devOpsError() }}</small> }
        <small class="wi-muted">O board do épico abre neste time/board (dá para trocar para o board inteiro do time na aba Board).</small>

        <label class="wi-field">
          <span>Card do DevOps que representa o épico <small class="wi-muted">(opcional — Epic/Feature)</small></span>
          <input class="wi-input ed__card" [(ngModel)]="devOpsCardId" inputmode="numeric" maxlength="100" placeholder="Ex.: 78100">
        </label>

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
    .ed__preview { min-height: 120px; max-height: 320px; overflow: auto; padding: 8px 10px; border-radius: 8px; background: var(--surface-input, #1a1f28);
      border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); }
    .ed__colors { display: flex; flex-wrap: wrap; gap: 8px; }
    .ed__swatch { width: 28px; height: 28px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; display: grid; place-items: center; padding: 0; color: #fff; }
    .ed__swatch:focus-visible { outline: 2px solid var(--mat-sys-primary); outline-offset: 2px; }
    .ed__swatch--on { border-color: var(--mat-sys-on-surface); }
    .ed__swatch mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .ed__tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-height: 36px; padding: 4px 6px; border-radius: 8px; cursor: text;
      background: var(--surface-input, #1a1f28); border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); }
    .ed__tag { display: inline-flex; align-items: center; gap: 2px; height: 24px; padding: 0 4px 0 10px; border-radius: 999px; font-size: 12px;
      background: color-mix(in srgb, var(--mat-sys-primary) 16%, transparent); border: 1px solid color-mix(in srgb, var(--mat-sys-primary) 35%, transparent); }
    .ed__tag button { display: grid; place-items: center; width: 18px; height: 18px; border: 0; border-radius: 50%; padding: 0; background: none; color: inherit; cursor: pointer; }
    .ed__tag button:hover { background: rgba(255,255,255,.12); }
    .ed__tag mat-icon { font-size: 13px; width: 13px; height: 13px; }
    .ed__tag-input { flex: 1 1 160px; min-width: 120px; border: 0; outline: none; background: none; color: inherit; font: inherit; font-size: 13px; padding: 4px; }
    .ed__row { display: flex; gap: 10px; flex-wrap: wrap; }
    .ed__grow { flex: 1 1 200px; }
    .ed__card { max-width: 220px; }
  `]
})
export class EpicDialogComponent {
  readonly data = inject<EpicDialogData>(MAT_DIALOG_DATA) ?? {};
  private ref = inject<MatDialogRef<EpicDialogComponent, EpicDialogResult>>(MatDialogRef);
  private api = inject(EpicsService);

  readonly editing = !!this.data.epic;
  readonly colors = EPIC_COLORS;

  title = this.data.epic?.title ?? '';
  description = this.data.epic?.description ?? '';
  tagDraft = '';
  devOpsCardId = this.data.epic?.devOpsCardId ?? '';
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
  readonly teamOptions = computed(() => withCurrent(this.teams().map((t) => t.name), this.team()));
  readonly boardOptions = computed(() => withCurrent(this.boards().map((b) => b.name), this.board()));

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    void this.loadTeams();
    if (this.team()) void this.loadBoards(this.team()!);
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
      if (!this.board() && list.length === 1) this.board.set(list[0].name);
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
    this.devOpsError.set(null);
    if (team) void this.loadBoards(team);
  }

  addTag(): void {
    const parts = this.tagDraft.split(',');
    this.tagDraft = '';
    this.tags.set(normalizeTags([...this.tags(), ...parts]));
  }

  onTagKey(event: KeyboardEvent): void {
    if (event.key === ',') {
      event.preventDefault();
      this.addTag();
    } else if (event.key === 'Backspace' && !this.tagDraft && this.tags().length) {
      this.tags.set(this.tags().slice(0, -1));
    }
  }

  removeTag(tag: string): void {
    this.tags.set(this.tags().filter((t) => t !== tag));
  }

  async save(): Promise<void> {
    const title = this.title.trim();
    if (!title || this.saving()) return;
    if (this.tagDraft.trim()) this.addTag();
    const body: SaveEpicRequest = {
      title,
      description: this.description.trim() || null,
      color: this.color(),
      tags: this.tags(),
      devOpsTeam: this.team(),
      devOpsBoard: this.team() ? this.board() : null,
      devOpsCardId: `${this.devOpsCardId ?? ''}`.trim().replace(/^#/, '') || null
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

/** Abre o diálogo de épico (criar sem `epic`; editar com ele). */
export function openEpicDialog(dialog: MatDialog, epic?: Epic | null): Promise<EpicDialogResult> {
  return firstValueFrom(dialog.open<EpicDialogComponent, EpicDialogData, EpicDialogResult>(
    EpicDialogComponent, workDialogConfig({ epic: epic ?? null }, '640px')
  ).afterClosed());
}
