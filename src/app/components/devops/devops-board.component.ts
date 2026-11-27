import { SlaBadgeComponent } from '../sla-badge/sla-badge.component';
import { CdkDrag, CdkDragDrop, CdkDropList, DragDropModule } from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import {
  Component, DestroyRef, ViewEncapsulation, computed, effect, inject, input, model, output, signal, untracked
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription, firstValueFrom } from 'rxjs';
import { DevOpsService } from '../../services/devops.service';
import { EpicBoardFilters, EpicsService, epicApiError } from '../../services/epics.service';
import { WsService } from '../../services/ws.service';
import { PmComboComponent, PmComboOption } from '../pm-combo/pm-combo.component';
import { UserAvatarComponent } from '../user-avatar/user-avatar.component';
import {
  BoardCell, BoardFilter, ColumnCount, EMPTY_FILTER, SLA_FILTERS, slaFilterKey, applyMove, canAccept, columnCounts, filterCount, filterItems, filterOptions,
  groupBoard, isFilterActive, isRealMove, laneFilterName, laneMatches, laneOf, limitBoard, boardLanes, neighborsAt, normalizeBoardFilter,
  sameFilter, shownByColumn, shownTotal, toggleValue, typeOnBoard, visibleColumns
} from './board.logic';
import { openDevOpsCardCreate } from './devops-card-create';
import {
  BoardColumn, BoardConfig, BoardItem, BoardScope, BoardTagStyle, DevOpsBoardRef, DevOpsTeam, DevOpsWorkItemType, MoveCardRequest,
  devOpsErrorMessage, typeColorCss, typeIcon
} from './devops.model';

/** Re-busca automática com a aba visível (o servidor guarda a configuração por 60 s). */
const REFRESH_MS = 60_000;
/** Vários `devopsCardsUpdated` seguidos (um lote do especialista) viram uma consulta só. */
const WS_DEBOUNCE_MS = 700;
/** Ajustes 1: filtros mexidos em sequência (digitar, marcar vários) viram uma gravação só no épico. */
const FILTER_SAVE_MS = 600;
const SNACK = { horizontalPosition: 'right', verticalPosition: 'top' } as const;

function storageGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* sem armazenamento: só não lembra */ }
}

/**
 * 0099 (Mesa de gestão): board do DevOps "exatamente igual o DevOps" — colunas na ordem do board com contagem e limite
 * WIP, colunas divididas (Doing/Done), lanes recolhíveis, cartões com a cor do tipo, arrastar entre colunas, lanes,
 * Doing↔Done e reordenar (otimista, desfaz com o aviso do DevOps em erro), coluna que não aceita o tipo bloqueada no
 * arraste, filtros como os do DevOps e alternância "Cards do épico | Board do time".
 *
 * Atualiza sozinho: a cada 60 s com a aba visível e no `devopsCardsUpdated` (grupo `devops`); `configHash` novo ⇒
 * redesenha colunas/lanes (colunas e estados novos aparecem sem recarregar a tela).
 *
 * `team`/`board` são `model()`: sem valor, o board escolhe o último usado (ou o primeiro) e devolve a escolha.
 *
 * Ajustes 1: time/board no `app-pm-combo`, filtro de Lane (as lanes escolhidas são as únicas faixas mostradas),
 * "Colunas" para ocultar colunas e, com épico, filtros e colunas vêm de `savedFilters` (`epic.boardFilters`) e são
 * gravados no épico (`PUT Epics/{n}/board-filters`, debounce de 600 ms) — valem para "Cards do épico" e "Board do
 * time" e o especialista os usa no board do time.
 */
@Component({
  selector: 'app-devops-board',
  standalone: true,
  imports: [SlaBadgeComponent, NgTemplateOutlet, FormsModule, DragDropModule, CdkScrollable, MatButtonModule, MatIconModule, MatMenuModule, MatProgressBarModule,
    MatTooltipModule, PmComboComponent, UserAvatarComponent],
  encapsulation: ViewEncapsulation.None,
  template: `
    @let cfg = config();
    @let f = filter();
    @let opts = options();
    <div class="dvb">
      <div class="dvb-bar">
        <div class="dvb-bar__group">
          <app-pm-combo class="dvb-combo" size="sm" icon="groups" [options]="teamOptions()" [value]="team()" (valueChange)="pickTeam($event)"
                        [clearable]="false" placeholder="Time…" ariaLabel="Time do DevOps" [loading]="!teams().length && pickingContext()"
                        noOptionsText="Nenhum time" emptyText="Nenhum time com esse nome" panelWidth="300px" />
          <app-pm-combo class="dvb-combo" size="sm" icon="view_kanban" [options]="boardOptions()" [value]="board()" (valueChange)="pickBoard($event)"
                        [clearable]="false" [disabled]="!team()" placeholder="Board…" ariaLabel="Board (backlog) do time"
                        noOptionsText="Nenhum board" emptyText="Nenhum board com esse nome" panelWidth="260px" />
        </div>

        @if (epic()) {
          <div class="dvb-seg" role="group" aria-label="O que mostrar">
            <button type="button" [class.dvb-seg--on]="effectiveScope() === 'epic'" (click)="setScope('epic')">Cards do épico</button>
            <button type="button" [class.dvb-seg--on]="effectiveScope() === 'board'" (click)="setScope('board')">Board do time</button>
          </div>
        }

        <label class="dvb-search">
          <mat-icon>filter_list</mat-icon>
          <input [ngModel]="f.text" (ngModelChange)="setText($event)" placeholder="Filtrar por palavra-chave ou id" aria-label="Filtrar">
          @if (f.text) { <button type="button" (click)="setText('')" aria-label="Limpar texto"><mat-icon>close</mat-icon></button> }
        </label>

        <button type="button" class="dvb-filter" [class.dvb-filter--on]="f.types.length" [matMenuTriggerFor]="typesMenu">
          Tipo @if (f.types.length) { <b>{{ f.types.length }}</b> }<mat-icon>arrow_drop_down</mat-icon>
        </button>
        <button type="button" class="dvb-filter" [class.dvb-filter--on]="f.assignedTo.length" [matMenuTriggerFor]="peopleMenu">
          Responsável @if (f.assignedTo.length) { <b>{{ f.assignedTo.length }}</b> }<mat-icon>arrow_drop_down</mat-icon>
        </button>
        <button type="button" class="dvb-filter" [class.dvb-filter--on]="f.tags.length" [matMenuTriggerFor]="tagsMenu">
          Tags @if (f.tags.length) { <b>{{ f.tags.length }}</b> }<mat-icon>arrow_drop_down</mat-icon>
        </button>
        <button type="button" class="dvb-filter" [class.dvb-filter--on]="f.states.length" [matMenuTriggerFor]="statesMenu">
          Estado @if (f.states.length) { <b>{{ f.states.length }}</b> }<mat-icon>arrow_drop_down</mat-icon>
        </button>
        @if (hasSla() || f.sla.length) {
          <button type="button" class="dvb-filter" [class.dvb-filter--on]="f.sla.length" [matMenuTriggerFor]="slaMenu"
                  matTooltip="Filtrar pelo SLA (prazo em dias úteis)" matTooltipShowDelay="600">
            SLA @if (f.sla.length) { <b>{{ f.sla.length }}</b> }<mat-icon>arrow_drop_down</mat-icon>
          </button>
        }
        @if (laneChoices().length > 1 || f.lanes.length) {
          <button type="button" class="dvb-filter" [class.dvb-filter--on]="f.lanes.length" [matMenuTriggerFor]="lanesMenu">
            Lane @if (f.lanes.length) { <b>{{ f.lanes.length }}</b> }<mat-icon>arrow_drop_down</mat-icon>
          </button>
        }
        @if (cfg) {
          <button type="button" class="dvb-filter" [class.dvb-filter--on]="f.hiddenColumns.length" [matMenuTriggerFor]="columnsMenu"
                  matTooltip="Escolher as colunas que o board mostra">
            <mat-icon class="dvb-filter__lead">view_week</mat-icon>Colunas
            @if (hiddenCount()) { <b>{{ shownColumns().length }}/{{ cfg.columns.length }}</b> }<mat-icon>arrow_drop_down</mat-icon>
          </button>
        }
        @if (filterActive()) {
          <button type="button" class="dv-linkbtn dvb-clear" (click)="clearFilter()">Limpar filtros ({{ filterCount() }})</button>
        }

        <span class="dvb-bar__spacer"></span>
        <span class="dvb-total">{{ totalLabel() }}</span>
        <button mat-icon-button type="button" (click)="refresh(true)" [disabled]="!team() || !board()"
                [matTooltip]="lastLoadLabel()" aria-label="Atualizar o board">
          <mat-icon [class.dvb-spin]="loading()">refresh</mat-icon>
        </button>
        <button mat-flat-button color="primary" type="button" (click)="newCard()" [disabled]="!team() || !board()">
          <mat-icon>add</mat-icon>Novo card
        </button>
      </div>
      @if (loading()) { <mat-progress-bar class="dvb-progress" mode="indeterminate" /> } @else { <div class="dvb-progress"></div> }
      @if (epic() && (filterActive() || hiddenCount())) {
        <div class="dvb-saved" [class.dvb-saved--err]="filterSave() === 'error'">
          <mat-icon>{{ filterSave() === 'error' ? 'sync_problem' : 'bookmark' }}</mat-icon>
          <span>
            @switch (filterSave()) {
              @case ('saving') { Salvando os filtros no épico… }
              @case ('error') { Não foi possível salvar os filtros no épico. <button type="button" class="dv-linkbtn" (click)="saveFiltersNow()">Tentar de novo</button> }
              @default { {{ filterActive() ? 'Filtros' : 'Colunas' }} salvos no épico — o especialista usa no board do time. }
            }
          </span>
          @if (filterActive()) { <button type="button" class="dv-linkbtn" (click)="clearFilter()">Limpar filtros</button> }
          @if (hiddenCount()) { <button type="button" class="dv-linkbtn" (click)="showAllColumns()">Mostrar todas as colunas</button> }
        </div>
      }

      @if (error(); as e) {
        <div class="dvb-note dvb-note--err">
          <mat-icon>error_outline</mat-icon><span>{{ e }}</span>
          <button type="button" class="dv-linkbtn" (click)="refresh(true)">Tentar de novo</button>
        </div>
      }
      @if (!team() || !board()) {
        <div class="dvb-empty">
          <mat-icon>view_kanban</mat-icon>
          <span>{{ pickingContext() ? 'Procurando os times do DevOps…' : 'Escolha o time e o board do DevOps.' }}</span>
        </div>
      } @else if (cfg) {
        @if (!loading() && !items().length && effectiveScope() === 'epic') {
          <div class="dvb-note">
            <mat-icon>info</mat-icon>
            <span>O épico ainda não tem cards neste board. Crie um em <b>Novo card</b> ou veja o <button type="button" class="dv-linkbtn" (click)="setScope('board')">Board do time</button>.</span>
          </div>
        }
        <div class="dvb-scroll" cdkScrollable>
          <div class="dvb-grid" [style.min-width.px]="gridWidth()">
            <!-- Cabeçalho das colunas -->
            <div class="dvb-heads">
              @for (col of shownColumns(); track col.id) {
                @let cnt = counts().get(col.name);
                <div class="dvb-head" [style.width.px]="colWidth(col)" [class.dvb-head--blocked]="blocked(col)"
                     [class.dvb-head--accept]="accepts(col)">
                  <div class="dvb-head__top">
                    <span class="dvb-head__name" [matTooltip]="col.description || ''" [matTooltipDisabled]="!col.description">{{ col.name }}</span>
                    @if (cnt) {
                      @let shown = shownCounts().get(col.name) ?? 0;
                      @if (shown !== cnt.count) {
                        <span class="dvb-head__shown" [matTooltip]="shown + ' na tela (filtros/lanes) de ' + cnt.count + ' na coluna'">{{ shown }} de</span>
                      }
                      <span class="dvb-head__count" [class.dvb-head__count--over]="cnt.over"
                            [matTooltip]="cnt.limit ? (cnt.over ? 'Passou do limite WIP (' + cnt.limit + ') — conta a coluna inteira, como o DevOps' : 'Limite WIP: ' + cnt.limit + ' (coluna inteira)') : 'Cards na coluna'"
                            >{{ cnt.count }}@if (cnt.limit) {<span>/{{ cnt.limit }}</span>}</span>
                    }
                    <span class="dvb-bar__spacer"></span>
                    @if (creatable(col)) {
                      <button type="button" class="dvb-head__add" (click)="newCard(col.name)" [matTooltip]="'Novo card em ' + col.name"
                              [attr.aria-label]="'Novo card em ' + col.name"><mat-icon>add</mat-icon></button>
                    }
                  </div>
                  @if (col.isSplit) {
                    <div class="dvb-head__split"><span>Doing</span><span>Done</span></div>
                  }
                </div>
              }
            </div>

            <!-- Lanes -->
            @for (lane of lanes(); track lane.key) {
              @if (lane.title) {
                <button type="button" class="dvb-lane" (click)="toggleLane(lane.key)" [attr.aria-expanded]="!isCollapsed(lane.key)">
                  <mat-icon>{{ isCollapsed(lane.key) ? 'chevron_right' : 'expand_more' }}</mat-icon>
                  <span class="dvb-lane__name">{{ lane.title }}</span>
                  <span class="dvb-lane__count">{{ lane.count }}</span>
                </button>
              }
              @if (!isCollapsed(lane.key)) {
                <div class="dvb-row">
                  @for (slot of lane.columns; track slot.column.id) {
                    <div class="dvb-colcell" cdkScrollable [style.width.px]="colWidth(slot.column)" [class.dvb-colcell--blocked]="blocked(slot.column)"
                         [class.dvb-colcell--accept]="accepts(slot.column)">
                      <ng-container *ngTemplateOutlet="cellTpl; context: { $implicit: slot.doing }" />
                      @if (slot.done; as d) {
                        <ng-container *ngTemplateOutlet="cellTpl; context: { $implicit: d }" />
                      }
                    </div>
                  }
                </div>
              }
            }
          </div>
        </div>
      }
    </div>

    <ng-template #cellTpl let-cell>
      <div class="dvb-cell" [class.dvb-cell--done]="cell.done" cdkDropList [id]="cell.id" [cdkDropListData]="cell"
           [cdkDropListConnectedTo]="cellIds()"
           [cdkDropListEnterPredicate]="enterPredicate" (cdkDropListDropped)="drop($event)">
        @for (item of cellItems(cell); track item.id) {
          @let ty = typeOf(item.type);
          <div class="dvb-card" cdkDrag [cdkDragData]="item" [cdkDragDisabled]="!draggable(item)"
               (cdkDragStarted)="dragging.set(item)" (cdkDragEnded)="dragEnded()" [style.--dvb-type]="ty.color"
               [class.dvb-card--styled]="!!item.cardColor" [style.background]="item.cardColor || null"
               [class.dvb-card--moving]="moving().has(item.id)">
            <div class="dvb-card__top">
              <mat-icon class="dvb-card__icon" [style.color]="ty.color" [matTooltip]="item.type">{{ ty.icon }}</mat-icon>
              <span class="dvb-card__id">{{ item.id }}</span>
              <a class="dvb-card__title" href="" [style.color]="item.titleColor || null" (click)="open(item, $event)" [matTooltip]="'Abrir o card ' + item.id" matTooltipShowDelay="700">{{ item.title }}</a>
            </div>
            <div class="dvb-card__who">
              @if (item.assignedTo; as a) {
                <app-user-avatar [name]="a.displayName" [imageUrl]="a.imageUrl" [size]="18" />
                <span>{{ a.displayName }}</span>
              } @else {
                <span class="dvb-card__nobody">Sem responsável</span>
              }
            </div>
            <div class="dvb-card__state"><span class="dvb-card__label">Estado</span><span class="dvb-dot"></span>{{ item.state }}
              @if (item.sla; as sla) { <app-sla-badge class="dvb-card__sla" [sla]="sla" [compact]="true" /> }
            </div>
            @if (item.tags.length) {
              <div class="dvb-card__tags">
                @for (t of item.tags; track t) {
                  @let ts = tagStyle(t);
                  <span class="dvb-tag" [style.background]="ts?.background || null" [style.color]="ts?.color || null">{{ t }}</span>
                }
              </div>
            }
            @if (!draggable(item)) {
              <div class="dvb-card__off" matTooltip="Este tipo não tem coluna neste board — mude o estado pelo card">fora do fluxo do board</div>
            }
            <div *cdkDragPlaceholder class="dvb-card dvb-card--placeholder"></div>
          </div>
        }
      </div>
    </ng-template>

    <mat-menu #typesMenu="matMenu" class="dvb-menu">
      @for (t of opts.types; track t) {
        <button mat-menu-item type="button" (click)="toggle('types', t, $event)">
          <mat-icon>{{ has(f.types, t) ? 'check_box' : 'check_box_outline_blank' }}</mat-icon>
          <span class="dv-type-dot" [style.background]="typeOf(t).color"></span> {{ t }}
        </button>
      } @empty { <div class="dvb-menu__empty">Nenhum tipo</div> }
    </mat-menu>
    <mat-menu #peopleMenu="matMenu" class="dvb-menu">
      @for (p of opts.people; track p.key) {
        <button mat-menu-item type="button" (click)="toggle('assignedTo', p.key, $event)">
          <mat-icon>{{ has(f.assignedTo, p.key) ? 'check_box' : 'check_box_outline_blank' }}</mat-icon>
          <span>{{ p.name }}</span>
        </button>
      } @empty { <div class="dvb-menu__empty">Ninguém</div> }
    </mat-menu>
    <mat-menu #tagsMenu="matMenu" class="dvb-menu">
      @for (t of opts.tags; track t) {
        <button mat-menu-item type="button" (click)="toggle('tags', t, $event)">
          <mat-icon>{{ has(f.tags, t) ? 'check_box' : 'check_box_outline_blank' }}</mat-icon><span>{{ t }}</span>
        </button>
      } @empty { <div class="dvb-menu__empty">Nenhuma tag</div> }
    </mat-menu>
    <mat-menu #columnsMenu="matMenu" class="dvb-menu">
      @for (col of cfg?.columns ?? []; track col.id) {
        @let on = !isHidden(f.hiddenColumns, col.name);
        <button mat-menu-item type="button" (click)="toggleColumn(col.name, $event)" [disabled]="on && shownColumns().length === 1">
          <mat-icon>{{ on ? 'check_box' : 'check_box_outline_blank' }}</mat-icon><span>{{ col.name }}</span>
        </button>
      }
      @if (f.hiddenColumns.length) {
        <button mat-menu-item type="button" (click)="showAllColumns()"><mat-icon>view_week</mat-icon><span>Mostrar todas</span></button>
      }
    </mat-menu>
    <mat-menu #lanesMenu="matMenu" class="dvb-menu">
      @for (l of laneChoices(); track l.name) {
        <button mat-menu-item type="button" (click)="toggleLane$(l.lane, $event)">
          <mat-icon>{{ laneOn(f.lanes, l.lane) ? 'check_box' : 'check_box_outline_blank' }}</mat-icon><span>{{ l.name }}</span>
        </button>
      } @empty { <div class="dvb-menu__empty">O board não tem lanes</div> }
    </mat-menu>
    <mat-menu #slaMenu="matMenu" class="dvb-menu">
      @for (o of slaFilters; track o.value) {
        <button mat-menu-item type="button" (click)="toggle('sla', o.value, $event)">
          <mat-icon>{{ has(f.sla, o.value) ? 'check_box' : 'check_box_outline_blank' }}</mat-icon>
          <span class="dvb-sla-dot" [style.background]="o.color" [class.dvb-sla-dot--hollow]="!o.color"></span>
          <span>{{ o.label }}</span><span class="dvb-menu__count">{{ slaCounts().get(o.value) ?? 0 }}</span>
        </button>
      }
    </mat-menu>
    <mat-menu #statesMenu="matMenu" class="dvb-menu">
      @for (s of opts.states; track s) {
        <button mat-menu-item type="button" (click)="toggle('states', s, $event)">
          <mat-icon>{{ has(f.states, s) ? 'check_box' : 'check_box_outline_blank' }}</mat-icon><span>{{ s }}</span>
        </button>
      } @empty { <div class="dvb-menu__empty">Nenhum estado</div> }
    </mat-menu>
  `,
  styles: [`
    app-devops-board { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; }
    .dvb { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; }
    .dvb-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; padding: 6px 8px; flex: none; }
    .dvb-bar__group { display: flex; gap: 6px; }
    .dvb-bar__spacer { flex: 1; }
    .dvb-combo { width: 172px; }
    .dvb-saved { display: flex; align-items: center; gap: 6px; margin: 0 8px 2px; padding: 2px 8px; font-size: 11.5px; color: var(--cc-text-3); flex: none; }
    .dvb-saved mat-icon { font-size: 14px; width: 14px; height: 14px; flex: none; }
    .dvb-saved .dv-linkbtn { font-size: 11.5px; }
    .dvb-saved > .dv-linkbtn { margin-left: 4px; }
    .dvb-saved--err { color: #d29922; }
    .dvb-seg { display: inline-flex; border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); border-radius: 8px; overflow: hidden; }
    .dvb-seg button { background: none; border: 0; color: var(--cc-text-2); font: inherit; font-size: 12.5px; padding: 5px 10px; cursor: pointer; }
    .dvb-seg button + button { border-left: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); }
    .dvb-seg .dvb-seg--on { background: color-mix(in srgb, var(--mat-sys-primary) 22%, transparent); color: var(--cc-text-1); }
    .dvb-search { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18));
      border-radius: 8px; background: var(--surface-input, #1a1f28); padding: 0 6px; min-width: 180px; flex: 0 1 260px; }
    .dvb-search:focus-within { border-color: color-mix(in srgb, var(--mat-sys-primary) 70%, transparent); }
    .dvb-search mat-icon { font-size: 17px; width: 17px; height: 17px; color: var(--cc-text-3); flex: none; }
    .dvb-search input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; color: inherit; font: inherit; font-size: 12.5px; padding: 6px 0; }
    .dvb-search button { background: none; border: 0; padding: 0; color: var(--cc-text-3); cursor: pointer; display: inline-flex; }
    .dvb-filter { display: inline-flex; align-items: center; gap: 2px; background: none; border: 1px solid transparent; border-radius: 8px;
      color: var(--cc-text-2); font: inherit; font-size: 12.5px; padding: 4px 2px 4px 8px; cursor: pointer; }
    .dvb-filter:hover { background: color-mix(in srgb, var(--mat-sys-on-surface) 6%, transparent); }
    .dvb-filter--on { color: var(--cc-text-1); border-color: color-mix(in srgb, var(--mat-sys-primary) 45%, transparent); }
    .dvb-filter b { font-size: 11px; background: var(--mat-sys-primary); color: var(--mat-sys-on-primary); border-radius: 999px; padding: 0 5px; margin-left: 3px; }
    .dvb-filter mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .dvb-filter .dvb-filter__lead { font-size: 16px; width: 16px; height: 16px; margin-right: 3px; }
    .dvb-total { font-size: 12px; color: var(--cc-text-3); white-space: nowrap; }
    .dvb-progress { height: 2px; flex: none; }
    .dvb-spin { animation: dvb-spin 1s linear infinite; }
    @keyframes dvb-spin { to { transform: rotate(360deg); } }
    .dvb-note { display: flex; align-items: center; gap: 8px; margin: 4px 8px; padding: 6px 10px; border-radius: 10px; font-size: 12.5px; flex: none;
      background: color-mix(in srgb, var(--mat-sys-primary) 8%, transparent); border: 1px solid color-mix(in srgb, var(--mat-sys-primary) 25%, transparent); }
    .dvb-note mat-icon { font-size: 17px; width: 17px; height: 17px; flex: none; }
    .dvb-note--err { background: rgba(248,81,73,.08); border-color: rgba(248,81,73,.35); }
    .dvb-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--cc-text-3); font-size: 13px; }
    .dvb-empty mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: .5; }

    .dvb-scroll { flex: 1; min-height: 0; overflow: auto; padding: 0 8px 8px; }
    .dvb-grid { display: flex; flex-direction: column; height: 100%; }
    .dvb-heads { display: flex; gap: 8px; position: sticky; top: 0; z-index: 2; background: var(--surface-1, #262b33); padding-top: 4px; }
    .dvb-head { flex: none; box-sizing: border-box; padding: 6px 8px 4px; border-radius: 8px 8px 0 0; background: var(--surface-2, #2e343f);
      border-bottom: 2px solid color-mix(in srgb, var(--mat-sys-primary) 35%, transparent); transition: opacity .15s; }
    .dvb-head__top { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .dvb-head__name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dvb-head__count { font-size: 12px; color: var(--cc-text-2); white-space: nowrap; }
    .dvb-head__shown { font-size: 12px; color: var(--cc-text-1); font-weight: 600; white-space: nowrap; margin-right: 3px; }
    .dvb-head__count span { color: var(--cc-text-3); }
    .dvb-head__count--over, .dvb-head__count--over span { color: #f85149; font-weight: 600; }
    .dvb-head__add { background: none; border: 0; padding: 0; color: var(--cc-text-3); cursor: pointer; display: inline-flex; border-radius: 6px; }
    .dvb-head__add:hover { color: var(--cc-text-1); background: color-mix(in srgb, var(--mat-sys-on-surface) 8%, transparent); }
    .dvb-head__add mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .dvb-head__split { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 4px; font-size: 11px; color: var(--cc-text-3);
      text-transform: uppercase; letter-spacing: .04em; }
    .dvb-head--blocked, .dvb-colcell--blocked { opacity: .35; }
    .dvb-head--accept { border-bottom-color: var(--mat-sys-primary); }
    .dvb-colcell--accept { background: color-mix(in srgb, var(--mat-sys-primary) 5%, transparent); }

    .dvb-lane { position: sticky; left: 0; display: inline-flex; align-items: center; gap: 4px; align-self: flex-start; margin: 10px 0 4px;
      background: none; border: 0; color: var(--cc-text-1); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; padding: 2px 4px; border-radius: 6px; }
    .dvb-lane:hover { background: color-mix(in srgb, var(--mat-sys-on-surface) 6%, transparent); }
    .dvb-lane mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .dvb-lane__count { font-size: 11.5px; font-weight: 400; color: var(--cc-text-3); }
    .dvb-row { display: flex; gap: 8px; border-top: 1px solid var(--cc-surface-border, rgba(255,255,255,.08)); }
    /* Cada coluna rola sozinha: as lanes abertas dividem a altura do board (a mais cheia fica com mais espaço) e,
       só com muitas lanes abertas, o board rola entre elas. */
    .dvb-row { flex: 1 1 auto; min-height: 120px; }
    .dvb-colcell { flex: none; display: flex; gap: 6px; box-sizing: border-box; background: color-mix(in srgb, var(--surface-2, #2e343f) 45%, transparent);
      transition: opacity .15s, background .15s; overflow-x: hidden; overflow-y: auto; scrollbar-width: thin;
      scrollbar-color: color-mix(in srgb, var(--mat-sys-on-surface) 18%, transparent) transparent; }
    .dvb-colcell::-webkit-scrollbar { width: 8px; }
    .dvb-colcell::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--mat-sys-on-surface) 18%, transparent); border-radius: 8px; }
    .dvb-cell { flex: 1; min-width: 0; min-height: 72px; display: flex; flex-direction: column; gap: 6px; padding: 6px; box-sizing: border-box; }
    .dvb-cell--done { border-left: 1px dashed var(--cc-surface-border-strong, rgba(255,255,255,.18)); }

    .dvb-card { position: relative; box-sizing: border-box; padding: 6px 8px 6px 11px; border-radius: 4px; background: var(--surface-1, #262b33);
      box-shadow: 0 1px 2px rgba(0,0,0,.35); font-size: 12.5px; cursor: grab; display: flex; flex-direction: column; gap: 3px; }
    .dvb-card::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; border-radius: 4px 0 0 4px; background: var(--dvb-type, #8a8f98); }
    .dvb-card:hover { box-shadow: 0 2px 6px rgba(0,0,0,.45); }
    .dvb-card--moving { opacity: .7; }
    /* Card pintado por regra de estilo do board (cores claras do DevOps): texto escuro, como lá. */
    .dvb-card--styled { --cc-text-1: #1b1f24; --cc-text-2: rgba(0,0,0,.72); --cc-text-3: rgba(0,0,0,.55); color: #1b1f24; }
    .dvb-card--styled .dvb-tag { background: rgba(0,0,0,.09); }
    .dvb-card--styled .dvb-card__title:hover { color: inherit; }
    .dvb-card__top { display: flex; align-items: flex-start; gap: 4px; min-width: 0; }
    .dvb-card__icon { font-size: 15px; width: 15px; height: 15px; flex: none; margin-top: 1px; }
    .dvb-card__id { font-weight: 600; flex: none; }
    .dvb-card__title { color: var(--cc-text-1); text-decoration: none; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3;
      -webkit-box-orient: vertical; overflow: hidden; }
    .dvb-card__title:hover { text-decoration: underline; color: var(--mat-sys-primary); }
    .dvb-card__who { display: flex; align-items: center; gap: 5px; color: var(--cc-text-2); min-width: 0; }
    .dvb-card__who span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dvb-card__nobody { color: var(--cc-text-3); font-style: italic; }
    .dvb-card__state { display: flex; flex-wrap: wrap; align-items: center; gap: 3px 5px; color: var(--cc-text-2); }
    .dvb-card__label { color: var(--cc-text-3); }
    .dvb-card__sla { margin-left: auto; }
    .dvb-sla-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; flex: none; }
    .dvb-sla-dot--hollow { box-shadow: inset 0 0 0 1.5px var(--cc-text-3, #8a8f98); }
    .dvb-menu__count { margin-left: 10px; color: var(--cc-text-3); font-size: 12px; }
    .dvb-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dvb-type, #8a8f98); flex: none; }
    .dvb-card__tags { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 1px; }
    .dvb-tag { font-size: 10.5px; line-height: 16px; padding: 0 6px; border-radius: 3px; background: color-mix(in srgb, var(--mat-sys-on-surface) 12%, transparent);
      color: var(--cc-text-1); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dvb-card__off { font-size: 10.5px; color: #d29922; }
    .dvb-card--placeholder { min-height: 48px; opacity: .35; background: color-mix(in srgb, var(--mat-sys-primary) 25%, transparent); box-shadow: none; }
    .dvb-card--placeholder::before { display: none; }
    .cdk-drag-preview.dvb-card { box-shadow: 0 8px 24px rgba(0,0,0,.5); cursor: grabbing; transform: rotate(2deg); }
    .cdk-drag-animating.dvb-card { transition: transform 200ms cubic-bezier(0, 0, .2, 1); }
    .dvb-cell.cdk-drop-list-dragging .dvb-card:not(.cdk-drag-placeholder) { transition: transform 200ms cubic-bezier(0, 0, .2, 1); }
    .dvb-menu .mat-mdc-menu-content { max-height: 360px; overflow: auto; }
    .dvb-menu .mat-mdc-menu-item { min-height: 34px; font-size: 13px; }
    .dvb-menu .mat-mdc-menu-item .mat-icon { margin-right: 8px; font-size: 18px; width: 18px; height: 18px; }
    .dvb-menu__empty { padding: 8px 16px; font-size: 12.5px; color: var(--cc-text-3); }
    .dv-linkbtn { background: none; border: 0; padding: 0; color: var(--mat-sys-primary); font: inherit; font-size: 12.5px; cursor: pointer; }
    .dv-linkbtn:hover { text-decoration: underline; }
    .dv-type-dot { width: 4px; height: 16px; border-radius: 2px; flex: none; display: inline-block; margin-right: 6px; vertical-align: middle; }
  `]
})
export class DevOpsBoardComponent {
  private api = inject(DevOpsService);
  private epicsApi = inject(EpicsService);
  private ws = inject(WsService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);
  private destroyRef = inject(DestroyRef);

  /** Time do DevOps (sem valor, o board escolhe o último usado ou o primeiro). */
  readonly team = model<string | null>(null);
  /** Board do time (backlog: Stories, Features…). */
  readonly board = model<string | null>(null);
  /** Número do épico da Mesa (habilita "Cards do épico"). */
  readonly epic = input<number | null>(null);
  readonly scope = model<BoardScope>('epic');
  /** Ajustes 1: filtros salvos no épico (`epic.boardFilters`); com `epic`, mudar o filtro grava no épico. */
  readonly savedFilters = input<EpicBoardFilters | null>(null);
  /** Clique no título do cartão. */
  readonly cardOpened = output<number>();

  readonly config = signal<BoardConfig | null>(null);
  readonly items = signal<BoardItem[]>([]);
  readonly teams = signal<DevOpsTeam[]>([]);
  readonly boards = signal<DevOpsBoardRef[]>([]);
  private metaTypes = signal<DevOpsWorkItemType[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly pickingContext = signal(false);
  readonly filter = signal<BoardFilter>(EMPTY_FILTER);
  readonly collapsed = signal<Set<string>>(new Set());
  readonly dragging = signal<BoardItem | null>(null);
  /** Cards com movimento aguardando o DevOps. */
  readonly moving = signal<Set<number>>(new Set());
  private lastLoadAt = signal(0);

  readonly effectiveScope = computed<BoardScope>(() => (this.epic() ? this.scope() : 'board'));
  readonly visibleItems = computed(() => {
    const cfg = this.config();
    return filterItems(this.items(), this.filter(), cfg ? boardLanes(cfg) : null);
  });
  /** Lanes do board para o filtro (nome no filtro + a lane). */
  readonly laneChoices = computed(() => {
    const cfg = this.config();
    return cfg ? boardLanes(cfg).map((lane) => ({ name: laneFilterName(lane), lane })) : [];
  });
  readonly teamOptions = computed<PmComboOption[]>(() => {
    const names = this.teams().map((t) => t.name);
    const cur = this.team();
    if (cur && !names.includes(cur)) names.unshift(cur);
    return names.map((n) => ({ value: n, label: n, icon: 'groups' }));
  });
  readonly boardOptions = computed<PmComboOption[]>(() => {
    const names = this.boards().map((b) => b.name);
    const cur = this.board();
    if (cur && !names.includes(cur)) names.unshift(cur);
    return names.map((n) => ({ value: n, label: n, icon: 'view_kanban' }));
  });
  /** Gravação dos filtros no épico. */
  readonly filterSave = signal<'idle' | 'saving' | 'saved' | 'error'>('idle');
  readonly lanes = computed(() => {
    const cfg = this.config();
    return cfg ? limitBoard(groupBoard(cfg, this.visibleItems()), cfg, this.filter()) : [];
  });
  /** Colunas na tela (as ocultas saem; coluna nova do DevOps aparece sozinha). */
  readonly shownColumns = computed(() => {
    const cfg = this.config();
    return cfg ? visibleColumns(cfg, this.filter().hiddenColumns) : [];
  });
  readonly hiddenCount = computed(() => (this.config()?.columns.length ?? 0) - this.shownColumns().length);
  readonly counts = computed(() => {
    const cfg = this.config();
    return cfg ? columnCounts(cfg, this.items()) : new Map<string, ColumnCount>();
  });
  /** Ids das células visíveis (lanes abertas) — todas ligadas entre si para arrastar de qualquer uma para qualquer outra. */
  readonly cellIds = computed(() => this.lanes()
    .filter((l) => !this.collapsed().has(l.key))
    .flatMap((l) => l.columns.flatMap((c) => (c.done ? [c.doing.id, c.done.id] : [c.doing.id]))));
  readonly options = computed(() => filterOptions(this.items()));
  readonly filterActive = computed(() => isFilterActive(this.filter()));
  readonly filterCount = computed(() => filterCount(this.filter()));
  /** 0105: opções do filtro de SLA e quantos cards do board caem em cada uma (antes dos outros filtros). */
  readonly slaFilters = SLA_FILTERS;
  readonly hasSla = computed(() => this.items().some((i) => !!i.sla));
  readonly slaCounts = computed(() => {
    const counts = new Map<string, number>();
    for (const i of this.items()) counts.set(slaFilterKey(i), (counts.get(slaFilterKey(i)) ?? 0) + 1);
    return counts;
  });
  /** Cards na tela por coluna (com lanes escolhidas e filtros) — o cabeçalho mostra este e o total da coluna. */
  readonly shownCounts = computed(() => shownByColumn(this.lanes()));
  readonly totalLabel = computed(() => {
    const all = this.items().length;
    // O que está na tela: filtros + lanes escolhidas + colunas ocultas (antes contava só os filtros).
    const vis = shownTotal(this.lanes());
    const n = (x: number) => `${x} ${x === 1 ? 'card' : 'cards'}`;
    return this.filterActive() || vis !== all ? `${vis} de ${n(all)}` : n(all);
  });
  readonly lastLoadLabel = computed(() => {
    const at = this.lastLoadAt();
    return at ? `Atualizar (atualizado às ${new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})` : 'Atualizar';
  });
  readonly gridWidth = computed(() =>this.shownColumns().reduce((w, c) => w + this.colWidth(c) + 8, 0));

  /** Cor e ícone por tipo: cor do board, senão a dos tipos do projeto. */
  private typeInfo = computed(() => {
    const map = new Map<string, { color: string; icon: string }>();
    for (const t of this.metaTypes()) map.set(t.name.toLowerCase(), { color: typeColorCss(t.color), icon: typeIcon(t.icon, t.name) });
    for (const t of this.config()?.types ?? []) {
      const cur = map.get(t.name.toLowerCase());
      map.set(t.name.toLowerCase(), { color: typeColorCss(t.color ?? null, cur?.color), icon: cur?.icon ?? typeIcon(null, t.name) });
    }
    return map;
  });

  private tagStyles = computed(() => new Map((this.config()?.tagStyles ?? []).map(t => [t.name.toLowerCase(), t] as const)));

  private loadSeq = 0;
  private refreshQueued = false;
  private wsTimer: ReturnType<typeof setTimeout> | null = null;
  private loadedKey = '';
  private subs: Subscription[] = [];
  /** Filtros: épico a que pertencem, o último gravado (ou lido) e a gravação pendente. */
  private filterEpic: number | null = null;
  private lastSavedFilter: BoardFilter | null = null;
  private filterTimer: ReturnType<typeof setTimeout> | null = null;
  private filterSaving = false;

  constructor() {
    this.api.types().subscribe({ next: (t) => this.metaTypes.set(t ?? []), error: () => {} });
    this.api.teams().subscribe({ next: (t) => this.teams.set(t ?? []), error: () => {} });

    // Contexto (time/board/épico/escopo) mudou: escolhe o que falta e recarrega.
    effect(() => {
      const team = this.team();
      const board = this.board();
      const epic = this.epic();
      const scope = this.effectiveScope();
      untracked(() => this.onContext(team, board, epic, scope));
    });

    // Filtros salvos no épico: aplica ao trocar de épico e quando outra tela/o especialista mudou (sem gravação pendente).
    effect(() => {
      const epic = this.epic();
      const saved = this.savedFilters();
      untracked(() => this.onSavedFilters(epic, saved));
    });

    // Boards do time escolhido (para o seletor).
    effect(() => {
      const team = this.team();
      untracked(() => {
        this.boards.set([]);
        if (team) this.api.boards(team).subscribe({ next: (b) => this.boards.set(b ?? []), error: () => {} });
      });
    });

    // Tempo real: qualquer gravação de card pelo PRMake avisa o grupo `devops`.
    const onCards = () => this.scheduleRefresh();
    this.ws.addToGroup('devops');
    this.ws.on('devopsCardsUpdated', onCards);
    this.subs.push(this.ws._resynced.subscribe(() => this.scheduleRefresh()));

    // Re-busca a cada 60 s com a aba visível; ao voltar para a aba, se passou do tempo.
    const tick = setInterval(() => this.refreshIfStale(), 15_000);
    const onVisible = () => this.refreshIfStale();
    document.addEventListener('visibilitychange', onVisible);

    this.destroyRef.onDestroy(() => {
      this.flushFilterSave();
      clearInterval(tick);
      if (this.wsTimer) clearTimeout(this.wsTimer);
      document.removeEventListener('visibilitychange', onVisible);
      this.ws.off('devopsCardsUpdated', onCards);
      this.ws.removeFromGroup('devops');
      this.subs.forEach((s) => s.unsubscribe());
    });
  }

  // ── Contexto ──

  private onContext(team: string | null, board: string | null, epic: number | null, scope: BoardScope): void {
    if (!team) { this.chooseTeam(); return; }
    if (!board) { this.chooseBoard(team); return; }
    const key = `${team}|${board}`;
    if (key !== this.loadedKey) {
      this.loadedKey = key;
      this.config.set(null);
      this.items.set([]);
      this.collapsed.set(this.readCollapsed(key));
    }
    void this.refresh(false);
  }

  private chooseTeam(): void {
    this.pickingContext.set(true);
    this.api.teams().subscribe({
      next: (teams) => {
        this.pickingContext.set(false);
        if (this.team()) return;
        const last = storageGet('dvb-last-team');
        const pick = teams.find((t) => t.name === last) ?? teams[0];
        if (pick) this.team.set(pick.name);
        else this.error.set('Nenhum time encontrado no projeto do DevOps.');
      },
      error: (e) => { this.pickingContext.set(false); this.error.set(devOpsErrorMessage(e, 'Não foi possível listar os times do DevOps.')); }
    });
  }

  private chooseBoard(team: string): void {
    this.pickingContext.set(true);
    this.api.boards(team).subscribe({
      next: (boards) => {
        this.pickingContext.set(false);
        if (this.board() || this.team() !== team) return;
        const last = storageGet(`dvb-last-board:${team}`);
        const pick = boards.find((b) => b.name === last)
          ?? boards.find((b) => /stories|backlog items|requirements/i.test(b.name))
          ?? boards[0];
        if (pick) this.board.set(pick.name);
        else this.error.set(`O time "${team}" não tem boards.`);
      },
      error: (e) => { this.pickingContext.set(false); this.error.set(devOpsErrorMessage(e, 'Não foi possível listar os boards do time.')); }
    });
  }

  pickTeam(name: string | null): void {
    if (!name || name === this.team()) return;
    storageSet('dvb-last-team', name);
    this.board.set(null);
    this.team.set(name);
  }

  pickBoard(name: string | null): void {
    if (!name || name === this.board()) return;
    const team = this.team();
    if (team) storageSet(`dvb-last-board:${team}`, name);
    this.board.set(name);
  }

  setScope(s: BoardScope): void {
    if (this.scope() !== s) this.scope.set(s);
  }

  // ── Carga ──

  /** Busca os itens (e a configuração quando o hash mudou ou `reloadConfig`). */
  async refresh(reloadConfig: boolean): Promise<void> {
    const team = this.team();
    const board = this.board();
    if (!team || !board) return;
    if (this.dragging() || this.moving().size) { this.refreshQueued = true; return; }
    this.refreshQueued = false;
    const seq = ++this.loadSeq;
    this.loading.set(true);
    try {
      const current = this.config();
      const needConfig = reloadConfig || !current || current.team !== team || current.board !== board;
      const [cfg, res] = await Promise.all([
        needConfig ? firstValueFrom(this.api.board(team, board, true)) : Promise.resolve(current!),
        firstValueFrom(this.api.boardItems({ team, board, epic: this.epic(), scope: this.effectiveScope(), top: 300 })),
      ]);
      if (seq !== this.loadSeq) return;
      let config = cfg;
      // Colunas/estados/lanes mudaram no DevOps: pega a configuração nova e redesenha.
      if (res.configHash && cfg.configHash && res.configHash !== cfg.configHash) {
        config = await firstValueFrom(this.api.board(team, board, true));
        if (seq !== this.loadSeq) return;
      }
      if (!current || current.configHash !== config.configHash || current.team !== config.team || current.board !== config.board || needConfig) {
        this.config.set(config);
      }
      this.items.set(res.items ?? []);
      this.error.set(null);
      this.lastLoadAt.set(Date.now());
    } catch (e) {
      if (seq === this.loadSeq) this.error.set(devOpsErrorMessage(e, 'Não foi possível carregar o board do DevOps.'));
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }

  private refreshIfStale(): void {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (this.loading()) return;
    if (Date.now() - this.lastLoadAt() >= REFRESH_MS) void this.refresh(false);
  }

  private scheduleRefresh(): void {
    if (this.wsTimer) clearTimeout(this.wsTimer);
    this.wsTimer = setTimeout(() => { this.wsTimer = null; void this.refresh(false); }, WS_DEBOUNCE_MS);
  }

  // ── Visual ──

  /** Cor da tag pelo board do DevOps (nome sem caixa). */
  tagStyle(tag: string): BoardTagStyle | undefined {
    return this.tagStyles().get((tag ?? '').toLowerCase());
  }

  typeOf(type: string): { color: string; icon: string } {
    return this.typeInfo().get((type ?? '').toLowerCase()) ?? { color: typeColorCss(null), icon: typeIcon(null, type) };
  }

  colWidth(col: BoardColumn): number {
    return col.isSplit ? 420 : 268;
  }

  cellItems(cell: BoardCell): BoardItem[] {
    return cell.items;
  }

  /** Coluna que aceita algum tipo (mostra o "+"). */
  creatable(col: BoardColumn): boolean {
    return Object.keys(col.stateMappings ?? {}).length > 0;
  }

  /** Durante o arraste: coluna sem mapeamento para o tipo do card fica esmaecida. */
  blocked(col: BoardColumn): boolean {
    const d = this.dragging();
    return !!d && !canAccept(col, d.type);
  }

  accepts(col: BoardColumn): boolean {
    const d = this.dragging();
    return !!d && canAccept(col, d.type);
  }

  draggable(item: BoardItem): boolean {
    return typeOnBoard(this.config(), item.type) && !this.moving().has(item.id);
  }

  isCollapsed(key: string): boolean {
    return this.collapsed().has(key);
  }

  toggleLane(key: string): void {
    const next = new Set(this.collapsed());
    if (next.has(key)) next.delete(key); else next.add(key);
    this.collapsed.set(next);
    storageSet(`dvb-collapsed:${this.loadedKey}`, JSON.stringify([...next]));
  }

  private readCollapsed(key: string): Set<string> {
    try {
      const raw = storageGet(`dvb-collapsed:${key}`);
      const list = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(list) ? list.map((x) => `${x}`) : []);
    } catch { return new Set(); }
  }

  open(item: BoardItem, e: Event): void {
    e.preventDefault();
    e.stopPropagation();
    this.cardOpened.emit(item.id);
  }

  // ── Filtros ──

  setText(text: string): void {
    this.filter.update((f) => ({ ...f, text: text ?? '' }));
    this.filterChanged();
  }

  has(list: string[], v: string): boolean {
    return list.some((x) => x.toLowerCase() === v.toLowerCase());
  }

  toggle(key: 'types' | 'assignedTo' | 'tags' | 'states' | 'sla', value: string, e: Event): void {
    e.stopPropagation(); // o menu fica aberto para marcar vários
    this.filter.update((f) => ({ ...f, [key]: toggleValue(f[key], value) }));
    this.filterChanged();
  }

  laneOn(values: string[], lane: { name: string | null; isDefault: boolean }): boolean {
    return values.some((v) => laneMatches(v, lane));
  }

  /** Liga/desliga a lane (o valor salvo pode ser um apelido da padrão, como "default"). */
  toggleLane$(lane: { name: string | null; isDefault: boolean }, e: Event): void {
    e.stopPropagation();
    this.filter.update((f) => ({
      ...f,
      lanes: this.laneOn(f.lanes, lane) ? f.lanes.filter((v) => !laneMatches(v, lane)) : [...f.lanes, laneFilterName(lane)],
    }));
    this.filterChanged();
  }

  /** Limpa os filtros de cards (as colunas ocultas ficam — é personalização do board). */
  clearFilter(): void {
    this.filter.update((f) => ({ ...EMPTY_FILTER, hiddenColumns: f.hiddenColumns }));
    this.filterChanged();
  }

  isHidden(hidden: string[], column: string): boolean {
    return hidden.some((h) => h.toLowerCase() === column.toLowerCase());
  }

  toggleColumn(column: string, e: Event): void {
    e.stopPropagation(); // o menu fica aberto para marcar várias
    this.filter.update((f) => ({ ...f, hiddenColumns: toggleValue(f.hiddenColumns, column) }));
    this.filterChanged();
  }

  showAllColumns(): void {
    this.filter.update((f) => ({ ...f, hiddenColumns: [] }));
    this.filterChanged();
  }

  // ── Filtros salvos no épico (ajustes 1) ──

  private onSavedFilters(epic: number | null, saved: EpicBoardFilters | null): void {
    if (epic !== this.filterEpic) {
      // Trocou de épico: grava o que estava pendente no anterior e carrega os filtros do novo.
      this.flushFilterSave();
      this.filterEpic = epic;
      this.filterSave.set('idle');
      const f = epic ? normalizeBoardFilter(saved) : EMPTY_FILTER;
      this.lastSavedFilter = epic ? f : null;
      this.filter.set(f);
      return;
    }
    if (!epic || this.filterTimer || this.filterSaving) return; // a mudança local pendente vence
    const f = normalizeBoardFilter(saved);
    if (this.lastSavedFilter && sameFilter(f, this.lastSavedFilter)) return;
    this.lastSavedFilter = f;
    if (!sameFilter(f, this.filter())) this.filter.set(f);
  }

  private filterChanged(): void {
    if (!this.epic()) return;
    if (this.filterTimer) clearTimeout(this.filterTimer);
    this.filterTimer = setTimeout(() => { this.filterTimer = null; this.saveFiltersNow(); }, FILTER_SAVE_MS);
  }

  /** Grava já o filtro atual no épico (fim do debounce, "Tentar de novo"). */
  saveFiltersNow(): void {
    const epic = this.filterEpic;
    if (!epic) return;
    const f = normalizeBoardFilter(this.filter());
    if (this.lastSavedFilter && sameFilter(f, this.lastSavedFilter) && this.filterSave() !== 'error') return;
    this.filterSaving = true;
    this.filterSave.set('saving');
    this.epicsApi.saveBoardFilters(epic, { ...f, text: f.text.trim() }).subscribe({
      next: () => {
        this.filterSaving = false;
        if (this.filterEpic !== epic) return;
        this.lastSavedFilter = f;
        this.filterSave.set('saved');
        // Mudou de novo enquanto gravava: grava a versão nova.
        if (!sameFilter(this.filter(), f) && !this.filterTimer) this.filterChanged();
      },
      error: (e) => {
        this.filterSaving = false;
        if (this.filterEpic !== epic) return;
        this.filterSave.set('error');
        console.warn('[0099] filtros do board não gravados no épico', epicApiError(e, ''));
      }
    });
  }

  /** Gravação pendente vai agora (trocar de épico, sair da tela). */
  private flushFilterSave(): void {
    if (!this.filterTimer) return;
    clearTimeout(this.filterTimer);
    this.filterTimer = null;
    this.saveFiltersNow();
  }

  // ── Arrastar ──

  /** Só entra na coluna que tem estado mapeado para o tipo do card. */
  readonly enterPredicate = (drag: CdkDrag<BoardItem>, drop: CdkDropList<BoardCell>): boolean => {
    const cfg = this.config();
    const col = cfg?.columns.find((c) => c.name === drop.data?.column);
    return !!col && canAccept(col, drag.data.type);
  };

  dragEnded(): void {
    // O drop roda antes do ended; solta o estado de arraste no próximo ciclo para o visual não piscar.
    setTimeout(() => {
      this.dragging.set(null);
      if (this.refreshQueued && !this.moving().size) void this.refresh(false);
    });
  }

  drop(event: CdkDragDrop<BoardCell, BoardCell, BoardItem>): void {
    const cfg = this.config();
    const team = this.team();
    const board = this.board();
    const item = event.item.data;
    const target = event.container.data;
    const same = event.container === event.previousContainer;
    if (!cfg || !team || !board || !item || !target) return;
    if (!isRealMove(same, event.previousIndex, event.currentIndex)) return;
    const col = cfg.columns.find((c) => c.name === target.column);
    if (!col || !canAccept(col, item.type)) return;

    const neighbors = neighborsAt(target.items, item.id, event.currentIndex);
    const before = this.items().find((i) => i.id === item.id) ?? item;
    const fromLane = laneOf(boardLanes(cfg), before);
    this.items.set(applyMove(cfg, this.items(), item.id, { lane: target.lane, column: target.column, done: target.done }, neighbors));

    const body: MoveCardRequest = { team, board, column: target.column, previousId: neighbors.previousId, nextId: neighbors.nextId };
    if (target.lane !== fromLane) body.lane = target.lane;
    if (col.isSplit) body.done = target.done;

    this.setMoving(item.id, true);
    this.api.move(item.id, body).subscribe({
      next: (d) => {
        this.items.update((list) => list.map((i) => i.id === item.id
          ? { ...i, rev: d?.rev ?? i.rev, state: d?.state || i.state, title: d?.title || i.title }
          : i));
        this.afterMove(item.id);
      },
      error: (e) => {
        // Desfaz só este card (outros movimentos podem estar em andamento).
        this.items.update((list) => list.map((i) => (i.id === item.id ? before : i)));
        this.afterMove(item.id);
        this.snack.open(`Não foi possível mover o card ${item.id}: ${devOpsErrorMessage(e)}`, 'Ok', { ...SNACK, duration: 9000 });
      }
    });
  }

  private setMoving(id: number, on: boolean): void {
    const next = new Set(this.moving());
    if (on) next.add(id); else next.delete(id);
    this.moving.set(next);
  }

  private afterMove(id: number): void {
    this.setMoving(id, false);
    if (this.refreshQueued && !this.moving().size && !this.dragging()) void this.refresh(false);
  }

  // ── Criar ──

  newCard(column?: string): void {
    const team = this.team();
    const board = this.board();
    const lanes = this.lanes();
    // Lane inicial: a padrão (ou a primeira aberta, quando a padrão está recolhida).
    const lane = lanes.find((l) => l.lane.isDefault && !this.isCollapsed(l.key)) ?? lanes.find((l) => !this.isCollapsed(l.key));
    openDevOpsCardCreate(this.dialog, {
      epic: this.epic(), team, board, column, lane: column && lane && !lane.lane.isDefault ? lane.key : undefined,
    }).subscribe((card) => {
      if (!card) return;
      this.snack.open(`Card ${card.id} criado no DevOps`, 'Abrir', { ...SNACK, duration: 6000 })
        .onAction().subscribe(() => this.cardOpened.emit(card.id));
      void this.refresh(false);
    });
  }
}
