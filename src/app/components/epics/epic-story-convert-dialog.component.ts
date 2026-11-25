import { Component, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { DevOpsService } from '../../services/devops.service';
import { EpicStoriesService } from '../../services/epic-stories.service';
import { boardLanes, laneFilterName } from '../devops/board.logic';
import { BoardLane, DevOpsFieldDef, devOpsErrorMessage } from '../devops/devops.model';
import { DevOpsFieldInputComponent } from '../devops/devops-field-input.component';
import { PmComboComponent, PmComboOption } from '../pm-combo/pm-combo.component';
import { WORK_DIALOG_STYLES } from '../work-items/work-dialog.styles';
import { workDialogConfig } from '../work-items/work-dialog-config';
import { EpicStory, convertWarnings, missingStoryFields, storyApiError, storyBoardColumns, storyTypeLook } from './epic-stories.logic';

export interface EpicStoryConvertData {
  story: EpicStory;
  epic: number;
  /** Board do épico (sem ele o card entra no estado inicial do DevOps, fora de coluna escolhida). */
  team?: string | null;
  board?: string | null;
}

/** `story`: convertida (com `cardId`); `alreadyCard`: já tinha virado card (409); `undefined`: desistiu. */
export type EpicStoryConvertResult = { story?: EpicStory; alreadyCard?: string } | undefined;

/**
 * 0099 (ajustes 2): confirmação do "Converter em card" — mostra o tipo do card que sai no DevOps, que ele entra no
 * épico e, com o board do épico, a coluna/lane onde entra (opcionais; colunas que aceitam o tipo). Converte aqui
 * mesmo (`POST EpicStories/{n}/convert`); "já convertida" (409) devolve o card que já existe.
 */
@Component({
  selector: 'app-epic-story-convert-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, PmComboComponent, DevOpsFieldInputComponent],
  encapsulation: ViewEncapsulation.None,
  template: `
    @let t = type;
    <div class="wi-dlg">
      <header class="wi-dlg__head">
        <mat-icon [style.color]="t.color">{{ t.icon }}</mat-icon>
        <div class="wi-dlg__head-main">
          <span class="wi-dlg__title">Converter em card</span>
          <span class="wi-dlg__sub">#{{ data.story.number }} · {{ data.story.title }}</span>
        </div>
        <button mat-icon-button mat-dialog-close aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </header>

      <div class="wi-dlg__body">
        <div class="wi-note">
          <mat-icon>add_task</mat-icon>
          <span>Cria um card <b [style.color]="t.color">{{ t.devOpsType }}</b> no DevOps com o título, a descrição,
            {{ data.story.type === 'bug' ? 'os passos de reprodução' : 'os critérios de aceite' }}, as tags e os campos
            {{ data.story.type === 'bug' ? 'deste bug' : 'desta história' }}, pela sua integração pessoal. O card entra no épico <b>#{{ data.epic }}</b>
            e a história fica só leitura.</span>
        </div>

        @if (data.team && data.board) {
          <div class="wi-sec">
            <h3 class="wi-sec__title">Onde entra no board <small class="wi-muted">({{ data.team }} · {{ data.board }})</small></h3>
            <div class="ec__row">
              <div class="wi-field ec__grow">
                <span>Coluna <small class="wi-muted">(opcional)</small></span>
                <app-pm-combo [options]="columnOptions()" [value]="column()" (valueChange)="column.set($event)" [allowEmpty]="true"
                              emptyLabel="Primeira coluna (padrão)" placeholder="Primeira coluna (padrão)" icon="view_week"
                              [loading]="loading()" loadingText="Lendo o board…" [error]="boardError()" ariaLabel="Coluna" />
              </div>
              <div class="wi-field ec__grow">
                <span>Lane <small class="wi-muted">(opcional)</small></span>
                <app-pm-combo [options]="laneOptions()" [value]="lane()" (valueChange)="lane.set($event)" [allowEmpty]="true"
                              emptyLabel="Lane padrão" placeholder="Lane padrão" icon="table_rows" [loading]="loading()"
                              loadingText="Lendo o board…" noOptionsText="O board não tem outras lanes" ariaLabel="Lane" />
              </div>
            </div>
          </div>
        } @else {
          <small class="wi-muted">O épico não tem board do time — o card entra no estado inicial do DevOps (escolha o time/board
            em "Editar épico" para dizer a coluna).</small>
        }

        @if (missing().length) {
          <div class="wi-sec">
            <h3 class="wi-sec__title">Obrigatórios no DevOps <small class="wi-muted">(faltam na história)</small></h3>
            <div class="ec__row">
              @for (f of missing(); track f.referenceName) {
                <div class="wi-field ec__grow">
                  <span>{{ f.name }} <b class="ec__req">*</b></span>
                  <app-devops-field-input [field]="f" [value]="values()[f.referenceName] ?? null" (valueChange)="setValue(f.referenceName, $event)" />
                </div>
              }
            </div>
          </div>
        }

        @if (warnings.length) {
          <div class="wi-note wi-note--warn"><mat-icon>tips_and_updates</mat-icon>
            <span>@for (w of warnings; track w) { {{ w }} } Dá para converter assim mesmo.</span></div>
        }
        @if (error()) { <div class="wi-note wi-note--warn"><mat-icon>error_outline</mat-icon><span>{{ error() }}</span></div> }
      </div>

      <footer class="wi-dlg__foot">
        <span class="wi-dlg__spacer"></span>
        <button mat-button mat-dialog-close>Cancelar</button>
        <button mat-flat-button color="primary" type="button" (click)="convert()" [disabled]="saving() || !!pending().length"
                [title]="pending().length ? 'Preencha ' + pending().join(', ') : ''">
          <mat-icon>move_up</mat-icon>{{ saving() ? 'Criando o card…' : 'Converter em card' }}
        </button>
      </footer>
    </div>
  `,
  styles: [WORK_DIALOG_STYLES, `
    .ec__row { display: flex; gap: 10px; flex-wrap: wrap; }
    .ec__grow { flex: 1 1 200px; }
    .ec__req { color: #f85149; font-weight: 600; }
  `]
})
export class EpicStoryConvertDialogComponent {
  readonly data = inject<EpicStoryConvertData>(MAT_DIALOG_DATA);
  private ref = inject<MatDialogRef<EpicStoryConvertDialogComponent, EpicStoryConvertResult>>(MatDialogRef);
  private api = inject(EpicStoriesService);
  private devops = inject(DevOpsService);

  readonly type = storyTypeLook(this.data.story.type);
  readonly warnings = convertWarnings(this.data.story);

  private readonly columns = signal<string[]>([]);
  private readonly lanes = signal<BoardLane[]>([]);
  readonly column = signal<string | null>(null);
  readonly lane = signal<string | null>(null);
  readonly loading = signal(false);
  readonly boardError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  /** Card 1109 (E1093): obrigatórios do DevOps que a história não preencheu (ex.: Module) — pedidos aqui. */
  private readonly required = signal<DevOpsFieldDef[]>([]);
  readonly missing = computed(() => missingStoryFields(this.required(), this.data.story.fields ?? {}));
  readonly values = signal<Record<string, unknown>>({});
  readonly pending = computed(() => missingStoryFields(this.missing(), this.values()).map((f) => f.name));

  readonly columnOptions = computed<PmComboOption[]>(() => this.columns().map((c) => ({ value: c, label: c, icon: 'view_week' })));
  /** Lanes com nome (a padrão é o "vazio" do combo). */
  readonly laneOptions = computed<PmComboOption[]>(() =>
    this.lanes().filter((l) => !l.isDefault).map((l) => laneFilterName(l)).filter(Boolean).map((n) => ({ value: n, label: n, icon: 'table_rows' })));

  constructor() {
    if (this.data.team && this.data.board) void this.loadBoard(this.data.team, this.data.board);
    this.api.requiredFields(this.data.story.type).subscribe({
      next: (r) => this.required.set(r?.fields ?? []),
      // Sem os metadados, a conversão confere no servidor e devolve o que faltou.
      error: () => {}
    });
  }

  setValue(ref: string, v: unknown): void {
    this.values.update((m) => ({ ...m, [ref]: v }));
  }

  private async loadBoard(team: string, board: string): Promise<void> {
    this.loading.set(true);
    try {
      const cfg = await firstValueFrom(this.devops.board(team, board));
      this.columns.set(storyBoardColumns(cfg.columns, this.type.devOpsType).map((c) => c.name));
      this.lanes.set(boardLanes(cfg));
    } catch (e) {
      this.boardError.set(devOpsErrorMessage(e, 'Não foi possível ler o board — o card entra na primeira coluna.'));
    } finally {
      this.loading.set(false);
    }
  }

  async convert(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    const withBoard = !!this.data.team && !!this.data.board;
    try {
      const story = await firstValueFrom(this.api.convert(this.data.story.number, {
        team: withBoard ? this.data.team : null,
        board: withBoard ? this.data.board : null,
        column: withBoard ? this.column() : null,
        lane: withBoard ? this.lane() : null,
        fields: Object.keys(this.values()).length ? this.values() : null
      }));
      this.ref.close({ story });
    } catch (e) {
      const err = storyApiError(e, 'O DevOps não criou o card.');
      if (err.code === 'alreadyConverted') { this.ref.close({ alreadyCard: err.cardId ?? undefined }); return; }
      // O DevOps exige campos que não vieram: passam a ser pedidos aqui.
      if (err.code === 'required_fields' && err.fields?.length) {
        const known = new Set(this.required().map((f) => f.referenceName));
        this.required.update((list) => [...list, ...err.fields!.filter((f) => !known.has(f.referenceName))]);
      }
      this.error.set(err.message);
    } finally {
      this.saving.set(false);
    }
  }
}

/** Abre a confirmação do "Converter em card". */
export function openEpicStoryConvert(dialog: MatDialog, data: EpicStoryConvertData): Promise<EpicStoryConvertResult> {
  return firstValueFrom(dialog.open<EpicStoryConvertDialogComponent, EpicStoryConvertData, EpicStoryConvertResult>(
    EpicStoryConvertDialogComponent, workDialogConfig(data, '560px')
  ).afterClosed());
}
