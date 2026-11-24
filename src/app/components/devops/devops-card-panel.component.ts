import { Component, ViewEncapsulation, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { DevOpsService } from '../../services/devops.service';
import { WorkItemPickerSource } from '../work-item-pickers/work-item-picker-source.service';
import { canAccept, laneKey, boardLanes } from './board.logic';
import { buildPatch, changedFields, displayValue, groupFields } from './card-edit.logic';
import { DevOpsFieldInputComponent } from './devops-field-input.component';
import { DevOpsTagsInputComponent } from './devops-tags-input.component';
import {
  BoardConfig, CardDetail, DevOpsFieldDef, DevOpsWorkItemType, F, MoveCardRequest, devOpsErrorMessage, devOpsWebUrl,
  typeColorCss, typeIcon
} from './devops.model';
import { DV_FORM_STYLES } from './devops.styles';
import { parseTags } from './tags.logic';

const SNACK = { horizontalPosition: 'right', verticalPosition: 'top' } as const;
const PARENT_REL = 'System.LinkTypes.Hierarchy-Reverse';
const CHILD_REL = 'System.LinkTypes.Hierarchy-Forward';

/**
 * 0099 (Mesa de gestão): painel do card do DevOps — cabeçalho (tipo, id, título editável, link para o DevOps, "Abrir
 * na Bancada", "Adicionar ao épico"), estado e — com time/board — coluna/lane/Done (move na hora, como arrastar no
 * board), campos do tipo agrupados (principais primeiro) com o controle de cada tipo, tags com criar, comentário e
 * "Salvar" que manda só o que mudou. Conflito/erro do DevOps aparece com a mensagem dele.
 *
 * Ocupa a altura do contêiner (a página decide se é gaveta lateral ou diálogo).
 */
@Component({
  selector: 'app-devops-card-panel',
  standalone: true,
  imports: [NgTemplateOutlet, FormsModule, MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule, DevOpsFieldInputComponent, DevOpsTagsInputComponent],
  encapsulation: ViewEncapsulation.None,
  template: `
    @let d = detail();
    @let ty = typeStyle();
    <div class="dvp" [style.--dvp-type]="ty.color">
      <header class="dvp__head">
        <div class="dvp__row">
          <mat-icon class="dvp__icon" [style.color]="ty.color">{{ ty.icon }}</mat-icon>
          <span class="dvp__type">{{ d?.type || 'Card' }}</span>
          @if (current(); as id) {
            @if (webUrl(); as url) {
              <a class="dvp__id" [href]="url" target="_blank" rel="noopener" matTooltip="Abrir no DevOps">{{ id }}<mat-icon>open_in_new</mat-icon></a>
            } @else { <span class="dvp__id">{{ id }}</span> }
          }
          <span class="dvp__spacer"></span>
          <button mat-icon-button type="button" (click)="reload()" [disabled]="loading() || !current()" matTooltip="Recarregar do DevOps" aria-label="Recarregar">
            <mat-icon>refresh</mat-icon>
          </button>
          <button mat-icon-button type="button" (click)="close()" aria-label="Fechar"><mat-icon>close</mat-icon></button>
        </div>
        @if (d) {
          <textarea class="dvp__title" rows="1" [ngModel]="title()" (ngModelChange)="title.set($event)" aria-label="Título"
                    [class.dvp__title--changed]="title().trim() !== d.title" (keydown.enter)="$event.preventDefault()"></textarea>
          <div class="dvp__actions">
            <button mat-stroked-button type="button" (click)="openWorkbench()" matTooltip="Trabalhar o card na Bancada (análise, itens, especialista)">
              <mat-icon>handyman</mat-icon>Abrir na Bancada
            </button>
            @if (epic(); as ep) {
              @if (inEpic()) {
                <span class="dvp__chip" matTooltip="O card já está no épico"><mat-icon>check</mat-icon>No épico #{{ ep }}</span>
              } @else {
                <button mat-stroked-button type="button" (click)="addToEpic()" [disabled]="addingToEpic()">
                  <mat-icon>playlist_add</mat-icon>Adicionar ao épico #{{ ep }}
                </button>
              }
            }
            @if (parentId(); as p) {
              <button type="button" class="dv-linkbtn" (click)="show(p)" matTooltip="Abrir o card pai aqui">Pai: {{ p }}</button>
            }
            @if (childCount()) { <span class="dv-hint">{{ childCount() }} {{ childCount() === 1 ? 'filho' : 'filhos' }}</span> }
          </div>
        }
      </header>
      @if (loading() || busy()) { <mat-progress-bar mode="indeterminate" class="dvp__progress" /> } @else { <div class="dvp__progress"></div> }

      <div class="dvp__body">
        @if (loadError(); as e) {
          <div class="dvp__note dvp__note--err"><mat-icon>error_outline</mat-icon><span>{{ e }}</span>
            <button type="button" class="dv-linkbtn" (click)="reload()">Tentar de novo</button></div>
        }
        @if (!current()) {
          <div class="dv-hint">Nenhum card selecionado.</div>
        }
        @if (d) {
          <section class="dvp__sec">
            <div class="dvp__grid">
              <div class="dv-field">
                <span class="dv-field__label">Estado @if (changed().has(stateRef)) { <i class="dv-changed"></i> }</span>
                <select class="dv-select" [ngModel]="valueOf(stateRef)" (ngModelChange)="setValue(stateRef, $event)" aria-label="Estado">
                  @for (s of stateOptions(); track s) { <option [value]="s">{{ s }}</option> }
                </select>
              </div>
              @if (board(); as cfg) {
                <div class="dv-field">
                  <span class="dv-field__label">Coluna do board</span>
                  <select #colSel class="dv-select" (change)="moveTo({ column: colSel.value }, colSel)" [disabled]="busy()" aria-label="Coluna do board">
                    @if (!boardColumn()) { <option value="" selected>—</option> }
                    @for (c of columnOptions(); track c.id) { <option [value]="c.name" [selected]="c.name === boardColumn()">{{ c.name }}</option> }
                  </select>
                </div>
                @if (laneOptions().length > 1) {
                  <div class="dv-field">
                    <span class="dv-field__label">Lane</span>
                    <select #laneSel class="dv-select" (change)="moveTo({ lane: laneSel.value }, laneSel)" [disabled]="busy()" aria-label="Lane">
                      @for (l of laneOptions(); track l.key) { <option [value]="l.key" [selected]="l.key === boardLane()">{{ l.name }}</option> }
                    </select>
                  </div>
                }
                @if (columnSplit()) {
                  <div class="dv-field">
                    <span class="dv-field__label">Doing / Done</span>
                    <label class="dv-check"><input #doneChk type="checkbox" [checked]="boardDone()" (change)="moveTo({ done: doneChk.checked }, doneChk)" [disabled]="busy()"> Done</label>
                  </div>
                }
              }
            </div>
          </section>

          @let g = groups();
          @if (g.main.length) {
            <section class="dvp__sec">
              <h4>Principais</h4>
              <div class="dvp__grid">
                @for (f of g.main; track f.referenceName) { <ng-container *ngTemplateOutlet="fieldTpl; context: { $implicit: f }" /> }
              </div>
            </section>
          }

          <section class="dvp__sec">
            <h4>Tags @if (tagsChanged()) { <i class="dv-changed"></i> }</h4>
            <app-devops-tags-input [(tags)]="tags" />
          </section>

          @if (g.texts.length) {
            <section class="dvp__sec">
              @for (f of g.texts; track f.referenceName) {
                <div class="dv-field dvp__text">
                  <span class="dv-field__label">{{ f.name }}@if (f.required) { <b>*</b> }@if (changed().has(f.referenceName)) { <i class="dv-changed"></i> }</span>
                  <app-devops-field-input [field]="f" [value]="valueOf(f.referenceName)" (valueChange)="setValue(f.referenceName, $event)" />
                </div>
              }
            </section>
          }

          <section class="dvp__sec">
            <h4>
              Outros campos
              <button type="button" class="dv-linkbtn" (click)="showAll.set(!showAll())">{{ showAll() ? 'Só os preenchidos' : 'Mostrar todos' }}</button>
            </h4>
            @if (g.others.length) {
              <div class="dvp__grid">
                @for (f of g.others; track f.referenceName) { <ng-container *ngTemplateOutlet="fieldTpl; context: { $implicit: f }" /> }
              </div>
            } @else { <span class="dv-hint">Nenhum outro campo preenchido.</span> }
          </section>

          <section class="dvp__sec">
            <h4>Comentário</h4>
            <textarea class="dv-textarea" rows="3" [ngModel]="comment()" (ngModelChange)="comment.set($event)"
                      placeholder="Escreva um comentário (vai para a discussion ao salvar; aceita markdown)" aria-label="Comentário"></textarea>
          </section>

          @if (g.readOnly.length) {
            <section class="dvp__sec dvp__sec--ro">
              <h4>Somente leitura</h4>
              <dl class="dvp__ro">
                @for (f of g.readOnly; track f.referenceName) {
                  <dt>{{ f.name }}</dt><dd>{{ shownValue(f) }}</dd>
                }
              </dl>
            </section>
          }
        }
      </div>

      @if (d) {
        <footer class="dvp__foot">
          @if (saveError(); as e) {
            <div class="dvp__note dvp__note--err dvp__foot-err">
              <mat-icon>error_outline</mat-icon><span>{{ e }}</span>
              @if (conflict()) { <button type="button" class="dv-linkbtn" (click)="reload(true)">Recarregar (perde as alterações)</button> }
            </div>
          }
          <span class="dv-hint">{{ dirty() ? pendingLabel() : 'Sem alterações' }}</span>
          <span class="dvp__spacer"></span>
          <button mat-button type="button" (click)="discard()" [disabled]="!dirty() || saving()">Descartar</button>
          <button mat-flat-button color="primary" type="button" (click)="save()" [disabled]="!dirty() || saving()">
            {{ saving() ? 'Salvando…' : 'Salvar' }}
          </button>
        </footer>
      }
    </div>

    <ng-template #fieldTpl let-f>
      <div class="dv-field" [class.dvp__wide]="f.type === 'html' || f.type === 'plainText'">
        <span class="dv-field__label" [attr.title]="f.referenceName">{{ f.name }}@if (f.required) { <b>*</b> }@if (changed().has(f.referenceName)) { <i class="dv-changed"></i> }</span>
        <app-devops-field-input [field]="f" [value]="valueOf(f.referenceName)" (valueChange)="setValue(f.referenceName, $event)" />
        @if (f.helpText) { <span class="dv-field__help">{{ f.helpText }}</span> }
      </div>
    </ng-template>
  `,
  styles: [DV_FORM_STYLES, `
    app-devops-card-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; }
    .dvp { display: flex; flex-direction: column; flex: 1; min-height: 0; background: var(--surface-1, #262b33); border-left: 4px solid var(--dvp-type, #8a8f98); }
    .dvp__head { padding: 6px 8px 8px 12px; display: flex; flex-direction: column; gap: 6px; background: var(--surface-2, #2e343f); flex: none; }
    .dvp__row { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .dvp__icon { font-size: 18px; width: 18px; height: 18px; }
    .dvp__type { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--cc-text-2); }
    .dvp__id { display: inline-flex; align-items: center; gap: 2px; font-weight: 600; font-size: 13px; color: var(--cc-text-1); text-decoration: none; }
    a.dvp__id:hover { color: var(--mat-sys-primary); }
    .dvp__id mat-icon { font-size: 13px; width: 13px; height: 13px; opacity: .7; }
    .dvp__spacer { flex: 1; }
    .dvp__title { width: 100%; box-sizing: border-box; resize: none; field-sizing: content; min-height: 32px; max-height: 120px; font: inherit; font-size: 16px; font-weight: 600;
      color: inherit; background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 4px 6px; }
    .dvp__title:hover { border-color: var(--cc-surface-border-strong, rgba(255,255,255,.18)); }
    .dvp__title:focus { outline: none; border-color: color-mix(in srgb, var(--mat-sys-primary) 70%, transparent); background: var(--surface-input, #1a1f28); }
    .dvp__title--changed { border-left: 3px solid var(--mat-sys-primary); }
    .dvp__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
    .dvp__actions .mat-mdc-outlined-button { height: 30px; font-size: 12.5px; }
    .dvp__chip { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: #3fb950; }
    .dvp__chip mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .dvp__progress { height: 2px; flex: none; }
    .dvp__body { flex: 1; min-height: 0; overflow: auto; padding: 10px 12px 16px; display: flex; flex-direction: column; gap: 14px; }
    .dvp__sec { display: flex; flex-direction: column; gap: 8px; }
    .dvp__sec h4 { margin: 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--cc-text-2);
      display: flex; align-items: center; gap: 8px; }
    .dvp__sec h4 .dv-linkbtn { text-transform: none; letter-spacing: 0; font-weight: 400; }
    .dvp__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px 12px; }
    .dvp__wide { grid-column: 1 / -1; }
    .dvp__text + .dvp__text { margin-top: 4px; }
    .dvp__ro { display: grid; grid-template-columns: max-content 1fr; gap: 3px 12px; margin: 0; font-size: 12.5px; }
    .dvp__ro dt { color: var(--cc-text-3); }
    .dvp__ro dd { margin: 0; color: var(--cc-text-2); overflow-wrap: anywhere; }
    .dvp__note { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 10px; font-size: 12.5px; }
    .dvp__note mat-icon { font-size: 17px; width: 17px; height: 17px; flex: none; }
    .dvp__note--err { background: rgba(248,81,73,.08); border: 1px solid rgba(248,81,73,.35); }
    .dvp__foot { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--cc-surface-border, rgba(255,255,255,.08));
      background: var(--surface-2, #2e343f); flex: none; }
    .dvp__foot-err { flex-basis: 100%; }
    i.dv-changed { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--mat-sys-primary); }
  `]
})
export class DevOpsCardPanelComponent {
  private api = inject(DevOpsService);
  private pickers = inject(WorkItemPickerSource);
  private router = inject(Router);
  private snack = inject(MatSnackBar);

  /** Card do DevOps a mostrar. */
  readonly cardId = input<number | string | null>(null);
  /** Épico da Mesa (habilita "Adicionar ao épico"). */
  readonly epic = input<number | null>(null);
  /** Time/board do DevOps (habilitam coluna/lane/Done do board). */
  readonly team = input<string | null>(null);
  readonly boardName = input<string | null>(null, { alias: 'board' });
  readonly closed = output<void>();
  /** Card gravado (salvar, mover, adicionar ao épico). */
  readonly saved = output<CardDetail>();

  readonly stateRef = F.state;

  /** Card em tela (o input, ou o pai/filho aberto aqui dentro). */
  readonly current = signal<string | null>(null);
  readonly detail = signal<CardDetail | null>(null);
  readonly defs = signal<DevOpsFieldDef[]>([]);
  readonly board = signal<BoardConfig | null>(null);
  private types = signal<DevOpsWorkItemType[]>([]);
  private states = signal<string[]>([]);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly saving = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);
  readonly conflict = signal(false);
  readonly inEpic = signal(false);
  readonly addingToEpic = signal(false);
  readonly showAll = signal(false);

  // Edição
  readonly values = signal<Record<string, unknown>>({});
  readonly title = signal('');
  readonly tags = signal<string[]>([]);
  readonly comment = signal('');

  private loadSeq = 0;

  readonly groups = computed(() => groupFields(this.defs(), this.values(), this.showAll()));
  readonly patch = computed(() => {
    const d = this.detail();
    return d ? buildPatch(d, this.defs(), this.values(), this.title(), this.tags(), this.comment()) : null;
  });
  readonly dirty = computed(() => !!this.patch());
  readonly changed = computed(() => {
    const d = this.detail();
    return d ? changedFields(d, this.defs(), this.values()) : new Set<string>();
  });
  readonly tagsChanged = computed(() => !!(this.patch()?.addTags?.length || this.patch()?.removeTags?.length));
  readonly pendingLabel = computed(() => {
    const p = this.patch();
    if (!p) return '';
    const parts: string[] = [];
    const n = Object.keys(p.fields ?? {}).length;
    if (n) parts.push(`${n} ${n === 1 ? 'campo' : 'campos'}`);
    if (p.addTags?.length || p.removeTags?.length) parts.push('tags');
    if (p.comment) parts.push('comentário');
    return `Alterado: ${parts.join(', ')}`;
  });

  readonly webUrl = computed(() => {
    const d = this.detail();
    return d ? devOpsWebUrl(d.url, d.id) : null;
  });
  readonly parentId = computed(() => this.detail()?.relations?.find((r) => r.rel === PARENT_REL)?.id ?? null);
  readonly childCount = computed(() => (this.detail()?.relations ?? []).filter((r) => r.rel === CHILD_REL).length);

  readonly typeStyle = computed(() => {
    const d = this.detail();
    const name = d?.type ?? '';
    const t = this.types().find((x) => x.name.toLowerCase() === name.toLowerCase());
    const boardColor = this.board()?.types.find((x) => x.name.toLowerCase() === name.toLowerCase())?.color;
    return { color: typeColorCss(t?.color ?? boardColor ?? null), icon: typeIcon(t?.icon, name) };
  });

  /** Estados do tipo: os do DevOps para o card; sem eles, os `allowedValues` do campo. */
  readonly stateOptions = computed(() => {
    const cur = `${this.values()[F.state] ?? this.detail()?.state ?? ''}`;
    const fromDef = this.defs().find((f) => f.referenceName === F.state)?.allowedValues ?? [];
    const list = this.states().length ? this.states() : fromDef;
    return cur && !list.includes(cur) ? [cur, ...list] : list;
  });

  readonly columnOptions = computed(() => {
    const cfg = this.board();
    const type = this.detail()?.type ?? '';
    return (cfg?.columns ?? []).filter((c) => canAccept(c, type));
  });
  readonly boardColumn = computed(() => {
    const cfg = this.board();
    const d = this.detail();
    return cfg && d ? `${d.fields[cfg.fields.column] ?? ''}` : '';
  });
  readonly laneOptions = computed(() => {
    const cfg = this.board();
    return cfg ? boardLanes(cfg).map((l) => ({ key: laneKey(l), name: l.isDefault ? (l.name || 'Padrão') : (l.name || 'Sem nome') })) : [];
  });
  readonly boardLane = computed(() => {
    const cfg = this.board();
    const d = this.detail();
    if (!cfg || !d) return '';
    const raw = `${d.fields[cfg.fields.lane] ?? ''}`.trim().toLowerCase();
    return this.laneOptions().find((l) => l.key.toLowerCase() === raw)?.key ?? '';
  });
  readonly boardDone = computed(() => {
    const cfg = this.board();
    const d = this.detail();
    return !!(cfg && d && d.fields[cfg.fields.done]);
  });
  readonly columnSplit = computed(() => !!this.board()?.columns.find((c) => c.name === this.boardColumn())?.isSplit);

  constructor() {
    this.api.types().subscribe({ next: (t) => this.types.set(t ?? []), error: () => {} });

    effect(() => {
      const id = this.cardId();
      untracked(() => this.show(id));
    });

    effect(() => {
      const team = this.team();
      const name = this.boardName();
      untracked(() => {
        this.board.set(null);
        if (team && name) this.api.board(team, name).subscribe({ next: (cfg) => this.board.set(cfg), error: () => {} });
      });
    });

    effect(() => {
      const ep = this.epic();
      const id = this.current();
      untracked(() => this.checkEpic(ep, id));
    });
  }

  /** Mostra um card (o do input ou um pai/filho aberto aqui). */
  show(id: number | string | null): void {
    const key = id == null || `${id}`.trim() === '' ? null : `${id}`.trim();
    if (key && key === this.current() && this.detail()) return;
    if (this.dirty() && !confirm('Há alterações não salvas neste card. Descartar e abrir o outro?')) return;
    this.current.set(key);
    this.detail.set(null);
    this.defs.set([]);
    this.states.set([]);
    this.loadError.set(null);
    this.saveError.set(null);
    this.conflict.set(false);
    if (key) this.load(key);
  }

  reload(force = false): void {
    const id = this.current();
    if (!id) return;
    if (!force && this.dirty() && !confirm('Recarregar descarta as alterações não salvas. Continuar?')) return;
    this.saveError.set(null);
    this.conflict.set(false);
    this.load(id);
  }

  private load(id: string): void {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.api.card(id).subscribe({
      next: (d) => {
        if (seq !== this.loadSeq) return;
        forkJoin({
          defs: this.api.fields(d.type).pipe(catchError(() => of([] as DevOpsFieldDef[]))),
          states: this.pickers.states(`${d.id}`).pipe(catchError(() => of(null))),
        }).subscribe(({ defs, states }) => {
          if (seq !== this.loadSeq) return;
          this.defs.set(defs ?? []);
          this.states.set((states?.states ?? []).map((s) => s.name));
          this.applyDetail(d);
          this.loading.set(false);
        });
      },
      error: (e) => {
        if (seq !== this.loadSeq) return;
        this.loadError.set(devOpsErrorMessage(e, `Não foi possível abrir o card ${id} no DevOps.`));
        this.loading.set(false);
      }
    });
  }

  /** Card novo do servidor: a edição volta a ser o que está gravado. */
  private applyDetail(d: CardDetail): void {
    this.detail.set(d);
    this.values.set({ ...(d.fields ?? {}), [F.state]: d.fields?.[F.state] ?? d.state });
    this.title.set(d.title ?? '');
    this.tags.set(d.tags?.length ? [...d.tags] : parseTags(d.fields?.[F.tags]));
    this.comment.set('');
  }

  private checkEpic(epic: number | null, id: string | null): void {
    this.inEpic.set(false);
    if (!epic || !id) return;
    this.api.epicsOfCard(id).subscribe({
      next: (list) => { if (this.current() === id) this.inEpic.set(list.some((e) => e.number === epic)); },
      error: () => {}
    });
  }

  valueOf(ref: string): unknown {
    return this.values()[ref] ?? null;
  }

  setValue(ref: string, v: unknown): void {
    this.values.update((m) => ({ ...m, [ref]: v }));
  }

  shownValue(f: DevOpsFieldDef): string {
    return displayValue(f, this.values()[f.referenceName]);
  }

  discard(): void {
    const d = this.detail();
    if (d) this.applyDetail(d);
    this.saveError.set(null);
    this.conflict.set(false);
  }

  save(): void {
    const d = this.detail();
    const body = this.patch();
    if (!d || !body || this.saving()) return;
    this.saving.set(true);
    this.saveError.set(null);
    this.conflict.set(false);
    this.api.update(d.id, body).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.applyDetail(res);
        this.saved.emit(res);
        this.snack.open(`Card ${res.id} salvo no DevOps`, 'Ok', { ...SNACK, duration: 3500 });
      },
      error: (e) => {
        this.saving.set(false);
        const msg = devOpsErrorMessage(e, 'O DevOps não aceitou as alterações.');
        this.conflict.set(e?.status === 409);
        this.saveError.set(e?.status === 409 ? `O card mudou no DevOps desde que foi aberto: ${msg}` : msg);
      }
    });
  }

  /** Coluna/lane/Done do board: grava na hora (como arrastar no board). */
  moveTo(change: { column?: string; lane?: string; done?: boolean }, el?: HTMLSelectElement | HTMLInputElement): void {
    const d = this.detail();
    const cfg = this.board();
    const team = this.team();
    const board = this.boardName();
    if (!d || !cfg || !team || !board) return;
    const column = change.column ?? this.boardColumn();
    if (!column) return;
    const col = cfg.columns.find((c) => c.name === column);
    const body: MoveCardRequest = { team, board, column };
    if (change.lane !== undefined) body.lane = change.lane;
    if (col?.isSplit) body.done = change.done ?? (change.column ? false : this.boardDone());
    this.busy.set(true);
    this.api.move(d.id, body).subscribe({
      next: (res) => {
        this.busy.set(false);
        // Mantém o que a pessoa está editando; atualiza estado/coluna/lane do servidor.
        const edits = this.values();
        const dirtyBefore = this.dirty();
        this.detail.set(res);
        if (!dirtyBefore) this.applyDetail(res);
        else this.values.set({ ...edits, [F.state]: res.fields?.[F.state] ?? res.state });
        this.saved.emit(res);
      },
      error: (e) => {
        this.busy.set(false);
        // O controle volta ao valor gravado.
        if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = this.boardDone();
        else if (el) el.value = change.lane !== undefined ? this.boardLane() : this.boardColumn();
        this.snack.open(`Não foi possível mover o card ${d.id}: ${devOpsErrorMessage(e)}`, 'Ok', { ...SNACK, duration: 9000 });
      }
    });
  }

  addToEpic(): void {
    const ep = this.epic();
    const d = this.detail();
    if (!ep || !d) return;
    this.addingToEpic.set(true);
    this.api.addToEpic(ep, d.id).subscribe({
      next: () => {
        this.addingToEpic.set(false);
        this.inEpic.set(true);
        this.snack.open(`Card ${d.id} adicionado ao épico #${ep}`, 'Ok', { ...SNACK, duration: 3500 });
      },
      error: (e) => {
        this.addingToEpic.set(false);
        this.snack.open(devOpsErrorMessage(e, 'Não foi possível adicionar ao épico.'), 'Ok', { ...SNACK, duration: 8000 });
      }
    });
  }

  openWorkbench(): void {
    const id = this.current();
    if (id) void this.router.navigate(['/auth/workbench'], { queryParams: { card: id } });
  }

  close(): void {
    if (this.dirty() && !confirm('Há alterações não salvas neste card. Fechar mesmo assim?')) return;
    this.closed.emit();
  }
}
