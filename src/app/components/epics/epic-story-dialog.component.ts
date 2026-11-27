import { Component, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DevOpsService } from '../../services/devops.service';
import { EpicStoriesService } from '../../services/epic-stories.service';
import { DevOpsFieldDef } from '../devops/devops.model';
import { DevOpsFieldInputComponent } from '../devops/devops-field-input.component';
import { DevOpsTagsInputComponent } from '../devops/devops-tags-input.component';
import { PlanMarkdownPipe } from '../execution-plan/plan-markdown.pipe';
import { PmComboComponent, PmComboOption } from '../pm-combo/pm-combo.component';
import { WORK_DIALOG_STYLES } from '../work-items/work-dialog.styles';
import { workDialogConfig } from '../work-items/work-dialog-config';
import {
  EpicStory, EpicStoryType, STORY_FIELD_DEFS, STORY_PRIORITIES, STORY_TITLE_MAX, STORY_TYPES, StoryDraft, buildSaveStory,
  emptyStoryDraft, isStoryEditable, severityValues, storyApiError, storyCardId, storyFieldText, storyStatusLook, storyToDraft,
  storyTypeLook, validateStory
} from './epic-stories.logic';

export interface EpicStoryDialogData {
  /** Épico dono (criar). */
  epic: number;
  /** Editar/ver esta história; sem ela = criar. */
  story?: EpicStory | null;
  /** Tipo inicial ao criar ("+ História" / "+ Bug"). */
  type?: EpicStoryType;
  /** Tags sugeridas além das do DevOps (as dos épicos). */
  suggestTags?: readonly string[];
}

/** `story`: salva/descartada/restaurada; `openCard`: a pessoa pediu o card convertido; `undefined`: fechou. */
export type EpicStoryDialogResult = { story?: EpicStory; openCard?: string } | undefined;

type MdKey = 'description' | 'acceptanceCriteria' | 'reproSteps';

/**
 * 0099 (ajustes 2): editor de uma história/bug do épico — tipo (História | Bug), título, descrição e critérios de
 * aceite (História) **ou** passos de reprodução (Bug) em markdown com prévia, prioridade, severidade (Bug; valores do
 * DevOps quando vêm), tags com sugestões, área/iteração/responsável pelos campos do DevOps e o status (rascunho/pronta).
 * Convertida abre só leitura com o "Card #n ↗". Salva aqui mesmo (o erro aparece no diálogo).
 */
@Component({
  selector: 'app-epic-story-dialog',
  standalone: true,
  imports: [DatePipe, NgTemplateOutlet, FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule, PlanMarkdownPipe,
    PmComboComponent, DevOpsTagsInputComponent, DevOpsFieldInputComponent],
  encapsulation: ViewEncapsulation.None,
  template: `
    @let t = typeLook();
    @let s = data.story;
    <div class="wi-dlg es" (keydown.control.enter)="save()" (keydown.meta.enter)="save()">
      <header class="wi-dlg__head">
        <mat-icon class="es__type-ico" [style.color]="t.color">{{ t.icon }}</mat-icon>
        <div class="wi-dlg__head-main">
          <span class="wi-dlg__title">{{ heading() }}</span>
          <span class="wi-dlg__sub">
            @if (s) {
              @let st = statusLook(s.status);
              <span class="wi-status" [style.color]="st.color" [matTooltip]="st.hint"><mat-icon>{{ st.icon }}</mat-icon>{{ st.label }}</span>
              <span>{{ s.createdByName || 'PRMake' }} · {{ s.createdAt | date: 'dd/MM/yyyy HH:mm' }}</span>
              @if (s.sourceCard) { <span matTooltip="Rascunho escrito pelo Especialista do caso deste card">pelo card {{ s.sourceCard }}</span> }
              @if (s.updatedAt && s.updatedAt !== s.createdAt) { <span>atualizada {{ s.updatedAt | date: 'dd/MM HH:mm' }}</span> }
            } @else {
              <span>Escreva aqui antes de virar card no DevOps — o card sai com estes campos quando você converter</span>
            }
          </span>
        </div>
        <button mat-icon-button mat-dialog-close aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </header>

      <div class="wi-dlg__body">
        @if (readOnly()) {
          <!-- Convertida: só leitura -->
          @if (cardId(); as cid) {
            <div class="wi-note">
              <mat-icon>move_up</mat-icon>
              <span>Virou o card <b>#{{ cid }}</b> no DevOps@if (s!.convertedByName) { — {{ s!.convertedByName }} }@if (s!.convertedAt) { em {{ s!.convertedAt | date: 'dd/MM/yyyy HH:mm' }} }.
                Mudanças agora são no card.</span>
              <span class="wi-dlg__spacer"></span>
              <button mat-stroked-button type="button" (click)="openCard(cid)"><mat-icon>open_in_new</mat-icon>Card #{{ cid }}</button>
            </div>
          }
          <h2 class="es__ro-title">{{ s!.title }}</h2>
          <div class="es__ro-meta">
            <span class="wi-chip" [style.color]="t.color"><mat-icon>{{ t.icon }}</mat-icon>{{ t.label }}</span>
            @if (s!.priority) { <span class="wi-chip" matTooltip="Prioridade">P{{ s!.priority }}</span> }
            @if (s!.type === 'bug' && s!.severity) { <span class="wi-chip" matTooltip="Severidade">{{ s!.severity }}</span> }
            @for (tag of s!.tags; track tag) { <span class="wi-chip">{{ tag }}</span> }
          </div>
          @if (roFields().length) {
            <table class="wi-table">
              @for (f of roFields(); track f.label) { <tr><td>{{ f.label }}</td><td>{{ f.value }}</td></tr> }
            </table>
          }
          <section class="wi-sec">
            <h3 class="wi-sec__title">Descrição</h3>
            <div class="plan-md wi-md" [innerHTML]="(s!.description || '_Sem descrição._') | planMarkdown"></div>
          </section>
          @if (s!.type === 'bug') {
            <section class="wi-sec">
              <h3 class="wi-sec__title">Passos de reprodução</h3>
              <div class="plan-md wi-md" [innerHTML]="(s!.reproSteps || '_Sem passos._') | planMarkdown"></div>
            </section>
          } @else {
            <section class="wi-sec">
              <h3 class="wi-sec__title">Critérios de aceite</h3>
              <div class="plan-md wi-md" [innerHTML]="(s!.acceptanceCriteria || '_Sem critérios._') | planMarkdown"></div>
            </section>
          }
        } @else {
          <div class="wi-field">
            <span>Tipo</span>
            <div class="es__types" role="radiogroup" aria-label="Tipo">
              @for (ty of types; track ty.key) {
                <button type="button" role="radio" class="es__type" [class.es__type--on]="draft().type === ty.key" [attr.aria-checked]="draft().type === ty.key"
                        [style.--ty]="ty.color" (click)="setType(ty.key)">
                  <mat-icon [style.color]="ty.color">{{ ty.icon }}</mat-icon>{{ ty.label }}<small>{{ ty.devOpsType }}</small>
                </button>
              }
            </div>
          </div>

          <label class="wi-field">
            <span>Título <b class="es__req">*</b></span>
            <input class="wi-input" [ngModel]="draft().title" (ngModelChange)="patch({ title: $event })" [maxlength]="titleMax"
                   [placeholder]="draft().type === 'bug' ? 'Ex.: Erro ao salvar a auditoria sem responsável' : 'Ex.: Como gestor, quero exportar o relatório em PDF'"
                   (keydown.enter)="$event.preventDefault()" autocomplete="off">
          </label>

          <ng-container *ngTemplateOutlet="md; context: { key: 'description', label: 'Descrição', rows: 5,
            placeholder: draft().type === 'bug' ? 'O que está errado, onde (ambiente, planta, tela) e o impacto…' : 'Quem, o quê e por quê — contexto e regras de negócio…' }" />
          @if (draft().type === 'bug') {
            <ng-container *ngTemplateOutlet="md; context: { key: 'reproSteps', label: 'Passos de reprodução', rows: 6,
              placeholder: '1. Entrar em…\\n2. Clicar em…\\n\\n**Esperado:** …\\n**Acontece:** …' }" />
          } @else {
            <ng-container *ngTemplateOutlet="md; context: { key: 'acceptanceCriteria', label: 'Critérios de aceite', rows: 5,
              placeholder: '- Dado … quando … então …\\n- …' }" />
          }

          <div class="es__row">
            <div class="wi-field es__grow">
              <span>Prioridade</span>
              <app-pm-combo [options]="priorityOptions" [value]="draft().priority ? '' + draft().priority : null"
                            (valueChange)="patch({ priority: $event ? +$event : null })" [allowEmpty]="true" emptyLabel="Sem prioridade"
                            placeholder="Sem prioridade" icon="flag" ariaLabel="Prioridade" />
            </div>
            @if (draft().type === 'bug') {
              <div class="wi-field es__grow">
                <span>Severidade</span>
                <app-pm-combo [options]="severityOptions()" [value]="draft().severity" (valueChange)="patch({ severity: $event })"
                              [allowEmpty]="true" emptyLabel="Sem severidade" [loading]="severityLoading()" loadingText="Lendo a lista do DevOps…"
                              placeholder="Sem severidade" icon="report" ariaLabel="Severidade" />
              </div>
            }
          </div>

          <div class="wi-field">
            <span>Tags <small class="wi-muted">(sugere as dos épicos e as do DevOps; Enter ou vírgula cria uma nova)</small></span>
            <app-devops-tags-input [tags]="draft().tags" (tagsChange)="patch({ tags: $event })" [suggest]="data.suggestTags ?? []"
                                   suggestHint="em épicos" newTitle="Tag nova — criada no DevOps ao converter" placeholder="Buscar ou criar tag" />
          </div>

          <div class="es__grid">
            @for (f of fieldDefs(); track f.referenceName) {
              <div class="wi-field">
                <span>{{ f.name }}@if (f.required) { <b class="es__req" title="O DevOps exige para virar card">*</b> }</span>
                <app-devops-field-input [field]="f" [value]="draft().fields[f.referenceName] ?? null" (valueChange)="setField(f.referenceName, $event)" />
              </div>
            }
          </div>

          <div class="wi-field">
            <span>Situação</span>
            <div class="es__seg" role="radiogroup" aria-label="Situação">
              <button type="button" role="radio" class="es__seg-btn" [class.es__seg-btn--on]="draft().status === 'draft'" [attr.aria-checked]="draft().status === 'draft'"
                      (click)="patch({ status: 'draft' })"><mat-icon>edit_note</mat-icon>Rascunho</button>
              <button type="button" role="radio" class="es__seg-btn" [class.es__seg-btn--on]="draft().status === 'ready'" [attr.aria-checked]="draft().status === 'ready'"
                      (click)="patch({ status: 'ready' })"><mat-icon>task_alt</mat-icon>Pronta para virar card</button>
            </div>
          </div>

          @if (validation().warnings.length) {
            <div class="wi-note wi-note--warn"><mat-icon>tips_and_updates</mat-icon>
              <span>@for (w of validation().warnings; track w) { {{ w }} }</span></div>
          }
          @if (s?.status === 'discarded') {
            <div class="wi-note"><mat-icon>restore_from_trash</mat-icon><span>Esta história está descartada — salvar a restaura.</span></div>
          }
        }
        @if (error()) { <div class="wi-note wi-note--warn"><mat-icon>error_outline</mat-icon><span>{{ error() }}</span></div> }
      </div>

      <footer class="wi-dlg__foot">
        @if (!readOnly() && s && s.status !== 'discarded') {
          <button mat-button type="button" class="es__discard" (click)="discard()" [disabled]="saving()"
                  matTooltip="Tira da lista de trabalho (fica em Descartadas, dá para restaurar)"><mat-icon>delete_outline</mat-icon>Descartar</button>
        }
        <span class="wi-dlg__spacer"></span>
        @if (readOnly()) {
          <button mat-button mat-dialog-close>Fechar</button>
        } @else {
          @if (validation().errors.length && touched()) { <span class="wi-err">{{ validation().errors[0] }}</span> }
          <button mat-button mat-dialog-close>Cancelar</button>
          <button mat-flat-button color="primary" type="button" (click)="save()" [disabled]="saving() || !validation().ok"
                  [matTooltip]="validation().errors[0] || 'Ctrl+Enter salva'" matTooltipShowDelay="500">
            <mat-icon>{{ s ? 'save' : 'add' }}</mat-icon>{{ saving() ? 'Salvando…' : s?.status === 'discarded' ? 'Restaurar e salvar' : s ? 'Salvar' : (draft().type === 'bug' ? 'Criar bug' : 'Criar história') }}
          </button>
        }
      </footer>
    </div>

    <ng-template #md let-key="key" let-label="label" let-rows="rows" let-placeholder="placeholder">
      <div class="wi-field">
        <span class="es__label-row">{{ label }} <small class="wi-muted">(markdown)</small>
          <button type="button" class="es__link" (click)="togglePreview(key)">{{ previewing(key) ? 'Editar' : 'Visualizar' }}</button></span>
        @if (previewing(key)) {
          <div class="es__preview plan-md wi-md" [innerHTML]="(mdValue(key) || '_Nada escrito._') | planMarkdown"></div>
        } @else {
          <textarea class="wi-textarea es__md" [ngModel]="mdValue(key)" (ngModelChange)="setMd(key, $event)" [rows]="rows"
                    [placeholder]="placeholder" [attr.aria-label]="label"></textarea>
        }
      </div>
    </ng-template>
  `,
  styles: [WORK_DIALOG_STYLES, `
    .es__type-ico { flex: none; }
    .es__req { color: #f85149; font-weight: 600; }
    .es__types { display: flex; flex-wrap: wrap; gap: 6px; }
    .es__type { --ty: #8b949e; display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px 5px 8px; border-radius: 8px; cursor: pointer;
      font: inherit; font-size: 13px; background: none; color: var(--cc-text-2); border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); }
    .es__type mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .es__type small { color: var(--cc-text-3); font-size: 11px; }
    .es__type--on { color: var(--cc-text-1); border-color: var(--ty); background: color-mix(in srgb, var(--ty) 14%, transparent); }
    .es__type:focus-visible, .es__seg-btn:focus-visible { outline: 2px solid var(--mat-sys-primary); outline-offset: 2px; }
    .es__label-row { display: flex; align-items: center; gap: 6px; }
    .es__link { margin-left: auto; background: none; border: 0; padding: 0; font: inherit; font-size: 11.5px; color: var(--mat-sys-primary); cursor: pointer; }
    .es__md { min-height: 96px; }
    .es__preview { min-height: 96px; max-height: 320px; overflow: auto; padding: 8px 10px; border-radius: 8px; background: var(--surface-input, #1a1f28);
      border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); }
    .es__row { display: flex; gap: 10px; flex-wrap: wrap; }
    .es__grow { flex: 1 1 200px; }
    .es__grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    @media (max-width: 720px) { .es__grid { grid-template-columns: minmax(0, 1fr); } }
    .es__seg { display: inline-flex; flex-wrap: wrap; gap: 2px; padding: 2px; border-radius: 9px; background: var(--surface-input, #1a1f28);
      border: 1px solid var(--cc-surface-border, rgba(255,255,255,.08)); align-self: flex-start; }
    .es__seg-btn { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border: 0; border-radius: 7px; background: none; cursor: pointer;
      font: inherit; font-size: 12.5px; color: var(--cc-text-2); }
    .es__seg-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .es__seg-btn--on { background: var(--surface-3, #212730); color: var(--cc-text-1); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--mat-sys-primary) 45%, transparent); }
    .es__discard { color: #f0883e !important; }
    .es__ro-title { margin: 0; font-size: 16px; font-weight: 600; line-height: 1.35; overflow-wrap: anywhere; }
    .es__ro-meta { display: flex; flex-wrap: wrap; gap: 6px; }
  `]
})
export class EpicStoryDialogComponent {
  readonly data = inject<EpicStoryDialogData>(MAT_DIALOG_DATA);
  private ref = inject<MatDialogRef<EpicStoryDialogComponent, EpicStoryDialogResult>>(MatDialogRef);
  private api = inject(EpicStoriesService);
  private devops = inject(DevOpsService);

  readonly types = STORY_TYPES;
  readonly titleMax = STORY_TITLE_MAX;
  /** Card 1109 (E1093): obrigatórios do DevOps para o tipo (ex.: Module da User Story) — sem eles o card não nasce. */
  readonly requiredDefs = signal<DevOpsFieldDef[]>([]);
  readonly fieldDefs = computed<DevOpsFieldDef[]>(() => [
    ...STORY_FIELD_DEFS,
    ...this.requiredDefs().filter((r) => !STORY_FIELD_DEFS.some((d) => d.referenceName === r.referenceName))
  ]);
  readonly priorityOptions: PmComboOption[] = STORY_PRIORITIES.map((p) => ({ value: `${p.value}`, label: p.label, hint: p.hint, icon: 'flag' }));

  readonly readOnly = computed(() => !!this.data.story && !isStoryEditable(this.data.story));
  readonly cardId = computed(() => storyCardId(this.data.story));
  readonly draft = signal<StoryDraft>(this.data.story ? storyToDraft(this.data.story) : emptyStoryDraft(this.data.type ?? 'user-story'));
  readonly typeLook = computed(() => storyTypeLook(this.readOnly() ? this.data.story!.type : this.draft().type));
  readonly validation = computed(() => validateStory(this.draft(), this.requiredDefs()));
  readonly heading = computed(() => {
    const s = this.data.story;
    const t = this.typeLook();
    return s ? `${t.label} #${s.number}` : this.draft().type === 'bug' ? 'Novo bug' : 'Nova história';
  });
  /** Campos do DevOps preenchidos (só leitura). */
  readonly roFields = computed(() => {
    const f = this.data.story?.fields ?? {};
    const defs = [...STORY_FIELD_DEFS, ...Object.keys(f).filter((ref) => !STORY_FIELD_DEFS.some((d) => d.referenceName === ref))
      .map((ref) => ({ referenceName: ref, name: this.requiredDefs().find((r) => r.referenceName === ref)?.name ?? ref.replace(/^Custom\./, '') }))];
    return defs.map((d) => ({ label: d.name, value: storyFieldText(d.referenceName, f[d.referenceName]) })).filter((x) => !!x.value);
  });

  /** Severidade: os valores do campo do DevOps (Bug) quando vêm; senão "1 - Critical…4 - Low". */
  private readonly severities = signal<string[]>(severityValues(null));
  readonly severityLoading = signal(false);
  private severityLoaded = false;
  readonly severityOptions = computed<PmComboOption[]>(() => {
    const cur = this.draft().severity;
    const list = this.severities();
    return [...(cur && !list.includes(cur) ? [cur] : []), ...list].map((v) => ({ value: v, label: v, icon: 'report' }));
  });

  private readonly previews = signal<Record<MdKey, boolean>>({ description: false, acceptanceCriteria: false, reproSteps: false });
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  /** Só mostra o erro de validação no rodapé depois de mexer. */
  readonly touched = signal(!!this.data.story);

  constructor() {
    if (this.draft().type === 'bug' && !this.readOnly()) this.loadSeverities();
    this.loadRequired(this.readOnly() ? this.data.story!.type : this.draft().type);
  }

  /** Obrigatórios do DevOps para o tipo; sem DevOps a lista fica vazia (a conversão confere de novo). */
  private loadRequired(type: EpicStoryType): void {
    this.api.requiredFields(type).subscribe({
      next: (r) => { if (this.draft().type === type || this.readOnly()) this.requiredDefs.set(r?.fields ?? []); },
      error: () => this.requiredDefs.set([])
    });
  }

  statusLook(status: string) {
    return storyStatusLook(status);
  }

  patch(p: Partial<StoryDraft>): void {
    this.draft.update((d) => ({ ...d, ...p }));
    this.touched.set(true);
  }

  setType(type: EpicStoryType): void {
    this.patch({ type });
    if (type === 'bug') this.loadSeverities();
    this.requiredDefs.set([]);
    this.loadRequired(type);
  }

  setField(ref: string, value: unknown): void {
    this.draft.update((d) => ({ ...d, fields: { ...d.fields, [ref]: value } }));
  }

  mdValue(key: MdKey): string {
    return this.draft()[key] ?? '';
  }

  setMd(key: MdKey, value: string): void {
    this.patch({ [key]: value ?? '' } as Partial<StoryDraft>);
  }

  previewing(key: MdKey): boolean {
    return this.previews()[key];
  }

  togglePreview(key: MdKey): void {
    this.previews.update((p) => ({ ...p, [key]: !p[key] }));
  }

  private loadSeverities(): void {
    if (this.severityLoaded || this.severityLoading()) return;
    this.severityLoading.set(true);
    this.devops.fields('Bug').subscribe({
      next: (defs) => { this.severities.set(severityValues(defs)); this.severityLoaded = true; this.severityLoading.set(false); },
      // Sem DevOps (ou sem o campo): ficam os valores padrão.
      error: () => { this.severityLoaded = true; this.severityLoading.set(false); }
    });
  }

  openCard(id: string): void {
    this.ref.close({ openCard: id });
  }

  async save(): Promise<void> {
    this.touched.set(true);
    if (this.readOnly() || this.saving() || !this.validation().ok) return;
    const body = buildSaveStory(this.draft());
    this.saving.set(true);
    this.error.set(null);
    try {
      const s = this.data.story;
      const story = s
        ? await firstValueFrom(this.api.update(s.number, body))
        : await firstValueFrom(this.api.create(this.data.epic, body));
      this.ref.close({ story });
    } catch (e) {
      this.error.set(storyApiError(e, this.data.story ? 'Não foi possível salvar.' : 'Não foi possível criar.').message);
    } finally {
      this.saving.set(false);
    }
  }

  async discard(): Promise<void> {
    const s = this.data.story;
    if (!s || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.api.discard(s.number));
      this.ref.close({ story: { ...s, status: 'discarded' } });
    } catch (e) {
      this.error.set(storyApiError(e, 'Não foi possível descartar.').message);
    } finally {
      this.saving.set(false);
    }
  }
}

/** Abre o editor (criar sem `story`; ver/editar com ela). */
export function openEpicStoryDialog(dialog: MatDialog, data: EpicStoryDialogData): Promise<EpicStoryDialogResult> {
  return firstValueFrom(dialog.open<EpicStoryDialogComponent, EpicStoryDialogData, EpicStoryDialogResult>(
    EpicStoryDialogComponent, workDialogConfig(data, '760px')
  ).afterClosed());
}
