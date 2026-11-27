import { SlaBadgeComponent } from '../sla-badge/sla-badge.component';
import { Component, ViewEncapsulation, computed, effect, inject, input, linkedSignal, output, signal, untracked, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { CdkOverlayOrigin, OverlayModule } from '@angular/cdk/overlay';
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
import { RoleService } from '../../services/role.service';
import { CcPopoverComponent } from '../popover/cc-popover.component';
import { PmComboComponent, PmComboOption } from '../pm-combo/pm-combo.component';
import { WorkItemPickerSource } from '../work-item-pickers/work-item-picker-source.service';
import { canAccept, laneKey, boardLanes } from './board.logic';
import { PendingChange, buildPatch, changedFields, changesLabel, describeChanges, displayValue, groupFields } from './card-edit.logic';
import { DevOpsAttachmentImagesDirective } from './devops-attachment-images.directive';
import { DevOpsCardAttachmentsComponent } from './devops-card-attachments.component';
import { DevOpsCardDiscussionComponent } from './devops-card-discussion.component';
import { DevOpsCardHistoryComponent } from './devops-card-history.component';
import { DevOpsCardRelatedComponent } from './devops-card-related.component';
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
/** Valor da lane padrão no combo (a chave dela é vazia). */
const DEFAULT_LANE = '__default__';
/** Cor da bolinha do estado pela categoria do DevOps. */
const STATE_CATEGORY_COLORS: Record<string, string> = {
  proposed: '#8b949e', inprogress: '#58a6ff', resolved: '#d29922', completed: '#3fb950', removed: '#f85149',
};
/** Campos que ficam no cabeçalho (como no DevOps): responsável na linha das tags; área e iteração na faixa do estado. */
const HEADER_FIELDS: string[] = [F.assignedTo, F.area, F.iteration];

/** Abas do modal (ajustes 3). */
export type CardTab = 'details' | 'fields' | 'discussion' | 'attachments' | 'related' | 'history';

/** Onde o modal abre: na Mesa (com "Abrir na Bancada"/"Adicionar ao épico") ou na própria Bancada (sem eles). */
export type CardPanelContext = 'desk' | 'workbench';

/**
 * 0099 (Mesa de gestão): o card do DevOps. Ajustes 3: modal largo com o desenho do formulário do DevOps — cabeçalho com
 * tipo/id, título, responsável, comentários, tags (tirar/pôr) e "Salvar"; faixa com estado, motivo, área, iteração e
 * coluna/lane/Done do board; seletor de abas à direita: Detalhes (textos + planejamento), Campos (outros + sistema),
 * Discussion (comentar com @ e #, "Enviar" separado do "Salvar"), Anexos e Relacionados. "Alterado: n campos" abre o
 * antes × depois (com desfazer por campo) e o "Salvar" pede confirmação com a mesma lista.
 * Modal único: é o mesmo card da Bancada ("Ver tudo", `context="workbench"`: sem "Abrir na Bancada"/"Adicionar ao épico", com o
 * board achado pelo card) e ganhou a aba Histórico.
 *
 * Ocupa a altura do contêiner (a página decide o tamanho do modal).
 */
@Component({
  selector: 'app-devops-card-panel',
  standalone: true,
  imports: [
    SlaBadgeComponent,
    NgTemplateOutlet, OverlayModule, FormsModule, MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule, PmComboComponent,
    CcPopoverComponent, DevOpsFieldInputComponent, DevOpsTagsInputComponent, DevOpsCardDiscussionComponent, DevOpsCardAttachmentsComponent,
    DevOpsCardRelatedComponent, DevOpsCardHistoryComponent, DevOpsAttachmentImagesDirective
  ],
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
          @if (d) {
            <span class="dvp__links">
              @if (parentId(); as p) {
                <button type="button" class="dv-linkbtn" (click)="show(p)" matTooltip="Abrir o card pai aqui">Pai: {{ p }}</button>
              }
              @if (childCount()) {
                <button type="button" class="dv-linkbtn" (click)="tab.set('related')">{{ childCount() }} {{ childCount() === 1 ? 'filho' : 'filhos' }}</button>
              }
            </span>
          }
          @if (d?.sla; as sla) { <app-sla-badge class="dvp__sla" [sla]="sla" /> }
          <span class="dvp__spacer"></span>
          @if (d) {
            @if (showWorkbenchLink()) {
              <button mat-stroked-button type="button" class="dvp__small" (click)="openWorkbench()" matTooltip="Trabalhar o card na Bancada (análise, itens, especialista)">
                <mat-icon>handyman</mat-icon>Abrir na Bancada
              </button>
            }
            @if (context() === 'desk' ? epic() : null; as ep) {
              @if (inEpic()) {
                <span class="dvp__chip" matTooltip="O card já está no épico"><mat-icon>check</mat-icon>No épico #{{ ep }}</span>
              } @else {
                <button mat-stroked-button type="button" class="dvp__small" (click)="addToEpic()" [disabled]="addingToEpic()">
                  <mat-icon>playlist_add</mat-icon>Adicionar ao épico #{{ ep }}
                </button>
              }
            }
          }
          <button mat-icon-button type="button" (click)="reload()" [disabled]="loading() || !current()" matTooltip="Recarregar do DevOps" aria-label="Recarregar">
            <mat-icon>refresh</mat-icon>
          </button>
          <button mat-icon-button type="button" (click)="close()" matTooltip="Fechar (Esc)" aria-label="Fechar"><mat-icon>close</mat-icon></button>
        </div>
        @if (d) {
          <div class="dvp__titlerow">
            <span class="dvp__titleid">{{ d.id }}</span>
            <textarea class="dvp__title" rows="1" [ngModel]="title()" (ngModelChange)="title.set($event)" aria-label="Título"
                      [class.dvp__title--changed]="title().trim() !== d.title" (keydown.enter)="$event.preventDefault()"></textarea>
          </div>
          <div class="dvp__who">
            @if (headerDef(assignedRef); as f) {
              <div class="dvp__assigned" [class.dvp__changed]="changed().has(f.referenceName)">
                <app-devops-field-input [field]="f" [value]="valueOf(f.referenceName)" (valueChange)="setValue(f.referenceName, $event)" placeholder="Sem responsável" />
              </div>
            }
            <button type="button" class="dvp__comments" (click)="openDiscussion()" matTooltip="Ver a discussion e comentar">
              <mat-icon>chat_bubble_outline</mat-icon>{{ commentCount() }} {{ commentCount() === 1 ? 'comentário' : 'comentários' }}
            </button>
            <div class="dvp__tags" [class.dvp__changed]="tagsChanged()">
              <app-devops-tags-input [(tags)]="tags" placeholder="Adicionar tag" />
            </div>
            <span class="dvp__spacer"></span>
            <div class="dvp__save">
              @if (dirty()) {
                <button type="button" class="dv-linkbtn dvp__pending" cdkOverlayOrigin #pendingOrigin="cdkOverlayOrigin"
                        (click)="showChanges(pendingOrigin, false)" matTooltip="Ver o que mudou (antes × depois)">{{ pendingLabel() }}</button>
                <button mat-button type="button" (click)="discard()" [disabled]="saving()">Descartar</button>
              }
              <button mat-flat-button color="primary" type="button" cdkOverlayOrigin #saveOrigin="cdkOverlayOrigin"
                      (click)="askSave(saveOrigin)" [disabled]="!dirty() || saving()">
                <mat-icon>save</mat-icon>{{ saving() ? 'Salvando…' : 'Salvar' }}
              </button>
            </div>
          </div>
        }
      </header>

      @if (d) {
        <div class="dvp__strip">
          <div class="dvp__strip-fields">
            <div class="dvp__sf">
              <span class="dvp__sf-label">Estado @if (changed().has(stateRef)) { <i class="dv-changed"></i> }</span>
              <app-pm-combo [options]="stateCombo()" [value]="stateText()" (valueChange)="$event && setValue(stateRef, $event)"
                            [clearable]="false" ariaLabel="Estado" placeholder="Estado" emptyText="Nenhum estado com esse nome" />
            </div>
            <div class="dvp__sf dvp__sf--ro">
              <span class="dvp__sf-label">Motivo</span>
              <span class="dvp__ro-value" [title]="reasonText()">{{ reasonText() || '—' }}</span>
            </div>
            @if (headerDef(areaRef); as f) {
              <div class="dvp__sf dvp__sf--wide">
                <span class="dvp__sf-label">Área @if (changed().has(f.referenceName)) { <i class="dv-changed"></i> }</span>
                <app-devops-field-input [field]="f" [value]="valueOf(f.referenceName)" (valueChange)="setValue(f.referenceName, $event)" />
              </div>
            }
            @if (headerDef(iterationRef); as f) {
              <div class="dvp__sf dvp__sf--wide">
                <span class="dvp__sf-label">Iteração @if (changed().has(f.referenceName)) { <i class="dv-changed"></i> }</span>
                <app-devops-field-input [field]="f" [value]="valueOf(f.referenceName)" (valueChange)="setValue(f.referenceName, $event)" />
              </div>
            }
            @if (board(); as cfg) {
              <div class="dvp__sf">
                <span class="dvp__sf-label">Coluna do board</span>
                <app-pm-combo [options]="columnCombo()" [value]="columnPick()" (valueChange)="pickColumn($event)" [disabled]="busy()"
                              [clearable]="false" icon="view_column" placeholder="—" ariaLabel="Coluna do board"
                              emptyText="Nenhuma coluna com esse nome" />
              </div>
              @if (laneOptions().length > 1) {
                <div class="dvp__sf">
                  <span class="dvp__sf-label">Lane</span>
                  <app-pm-combo [options]="laneCombo()" [value]="lanePick()" (valueChange)="pickLane($event)" [disabled]="busy()"
                                [clearable]="false" ariaLabel="Lane" emptyText="Nenhuma lane com esse nome" />
                </div>
              }
              @if (columnSplit()) {
                <div class="dvp__sf dvp__sf--ro">
                  <span class="dvp__sf-label">Doing / Done</span>
                  <label class="dv-check"><input #doneChk type="checkbox" [checked]="boardDone()" (change)="moveTo({ done: doneChk.checked }, doneChk)" [disabled]="busy()"> Done</label>
                </div>
              }
            }
          </div>
          <nav class="dvp__tabs" role="tablist" aria-label="Seções do card">
            @for (t of tabs(); track t.id) {
              <button type="button" role="tab" class="dvp__tab" [class.dvp__tab--on]="tab() === t.id" [attr.aria-selected]="tab() === t.id"
                      (click)="selectTab(t.id)">
                <mat-icon>{{ t.icon }}</mat-icon><span>{{ t.label }}</span>
                @if (t.count != null) { <span class="dvp__tab-n">{{ t.count }}</span> }
                @if (t.dot) { <i class="dv-changed"></i> }
              </button>
            }
          </nav>
        </div>
      }

      @if (loading() || busy()) { <mat-progress-bar mode="indeterminate" class="dvp__progress" /> } @else { <div class="dvp__progress"></div> }

      @if (saveError(); as e) {
        <div class="dvp__note dvp__note--err dvp__note--bar">
          <mat-icon>error_outline</mat-icon><span>{{ e }}</span>
          @if (conflict()) { <button type="button" class="dv-linkbtn" (click)="reload(true)">Recarregar (perde as alterações)</button> }
        </div>
      }

      <div class="dvp__body" [dvAttachmentImages]="current()">
        @if (loadError(); as e) {
          <div class="dvp__note dvp__note--err"><mat-icon>error_outline</mat-icon><span>{{ e }}</span>
            <button type="button" class="dv-linkbtn" (click)="reload()">Tentar de novo</button></div>
        }
        @if (!current()) { <div class="dv-hint">Nenhum card selecionado.</div> }
        @if (!d && loading()) { <div class="dv-hint">Abrindo o card no DevOps…</div> }
        @if (d) {
          @let g = groups();
          <!-- Detalhes: textos à esquerda (Descrição, Repro Steps…), planejamento à direita — como o formulário do DevOps -->
          <div class="dvp__pane dvp__cols" [hidden]="tab() !== 'details'" role="tabpanel">
            <div class="dvp__texts">
              @for (f of g.texts; track f.referenceName) {
                <section class="dvp__sec">
                  <h3>{{ f.name }}@if (f.required) { <b class="dvp__req">*</b> }@if (changed().has(f.referenceName)) { <i class="dv-changed"></i> }</h3>
                  <app-devops-field-input class="dvp__textfield" [field]="f" [value]="valueOf(f.referenceName)" (valueChange)="setValue(f.referenceName, $event)" />
                </section>
              } @empty { <span class="dv-hint">Este tipo de card não tem campos de texto longo preenchidos.</span> }
            </div>
            <aside class="dvp__side">
              <section class="dvp__sec">
                <h3>Planejamento</h3>
                @if (planning().length) {
                  <div class="dvp__stack">
                    @for (f of planning(); track f.referenceName) { <ng-container *ngTemplateOutlet="fieldTpl; context: { $implicit: f }" /> }
                  </div>
                } @else { <span class="dv-hint">Sem campos de planejamento neste tipo.</span> }
              </section>
              @if (dates().length) {
                <section class="dvp__sec">
                  <h3>Datas</h3>
                  <dl class="dvp__ro">
                    @for (x of dates(); track x.label) { <dt>{{ x.label }}</dt><dd>{{ x.value }}</dd> }
                  </dl>
                </section>
              }
            </aside>
          </div>

          <!-- Campos: os demais campos editáveis + os do sistema (somente leitura) -->
          <div class="dvp__pane" [hidden]="tab() !== 'fields'" role="tabpanel">
            <section class="dvp__sec">
              <h3>
                Outros campos
                <button type="button" class="dv-linkbtn" (click)="showAll.set(!showAll())">{{ showAll() ? 'Só os preenchidos' : 'Mostrar todos' }}</button>
              </h3>
              @if (g.others.length) {
                <div class="dvp__grid">
                  @for (f of g.others; track f.referenceName) { <ng-container *ngTemplateOutlet="fieldTpl; context: { $implicit: f }" /> }
                </div>
              } @else { <span class="dv-hint">Nenhum outro campo preenchido — "Mostrar todos" lista os vazios.</span> }
            </section>
            @if (g.readOnly.length) {
              <section class="dvp__sec dvp__sec--ro">
                <h3>Sistema (somente leitura)</h3>
                <dl class="dvp__ro dvp__ro--cols">
                  @for (f of g.readOnly; track f.referenceName) {
                    <div><dt>{{ f.name }}</dt><dd>{{ shownValue(f) }}</dd></div>
                  }
                </dl>
              </section>
            }
          </div>

          @if (visited().has('discussion')) {
            <div class="dvp__pane" [hidden]="tab() !== 'discussion'" role="tabpanel">
              <app-devops-card-discussion #discussion [card]="current()" (countChange)="commentsLoaded.set($event)" (posted)="onCommented()" />
            </div>
          }
          @if (visited().has('attachments')) {
            <div class="dvp__pane" [hidden]="tab() !== 'attachments'" role="tabpanel">
              <app-devops-card-attachments [card]="current()" [webUrl]="webUrl()" (countChange)="attachmentsLoaded.set($event)" />
            </div>
          }
          @if (visited().has('history')) {
            <div class="dvp__pane" [hidden]="tab() !== 'history'" role="tabpanel">
              <app-devops-card-history [card]="current()" [labels]="fieldLabels()" (countChange)="historyLoaded.set($event)" (openCard)="show($event)" />
            </div>
          }
          @if (visited().has('related')) {
            <div class="dvp__pane" [hidden]="tab() !== 'related'" role="tabpanel">
              <app-devops-card-related [relations]="d.relations" (openCard)="show($event)" />
            </div>
          }
        }
      </div>
    </div>

    <ng-template #fieldTpl let-f>
      <div class="dv-field" [class.dvp__wide]="f.type === 'html' || f.type === 'plainText'">
        <span class="dv-field__label" [attr.title]="f.referenceName">{{ f.name }}@if (f.required) { <b>*</b> }@if (changed().has(f.referenceName)) { <i class="dv-changed"></i> }</span>
        <app-devops-field-input [field]="f" [value]="valueOf(f.referenceName)" (valueChange)="setValue(f.referenceName, $event)" />
        @if (f.helpText) { <span class="dv-field__help">{{ f.helpText }}</span> }
      </div>
    </ng-template>

    <!-- Antes × depois (link "Alterado: …") e confirmação do Salvar -->
    <cc-popover #changesPop maxWidth="min(620px, calc(100vw - 24px))">
      <div class="dvp-diff">
        <div class="dvp-diff__title">{{ confirming() ? 'Salvar estas alterações no DevOps?' : 'Alterações não salvas' }}</div>
        <table class="dvp-diff__table">
          <thead><tr><th>Campo</th><th>Antes</th><th>Depois</th><th></th></tr></thead>
          <tbody>
            @for (c of changes(); track c.ref) {
              <tr>
                <td class="dvp-diff__label">{{ c.label }}</td>
                <td class="dvp-diff__before">{{ c.before }}</td>
                <td class="dvp-diff__after">{{ c.after }}</td>
                <td><button mat-icon-button type="button" class="dvp-diff__undo" (click)="undo(c)" matTooltip="Desfazer esta alteração" aria-label="Desfazer"><mat-icon>undo</mat-icon></button></td>
              </tr>
            }
          </tbody>
        </table>
        @if (confirming()) {
          <p class="dvp-diff__note">O card {{ d?.id }} é gravado no DevOps em seu nome — a alteração aparece no histórico do card para todos.</p>
          <div class="dvp-diff__actions">
            <button mat-button type="button" (click)="changesPop.close()">Cancelar</button>
            <button mat-flat-button color="primary" type="button" (click)="confirmSave()" [disabled]="saving() || !dirty()">
              <mat-icon>save</mat-icon>Confirmar e salvar
            </button>
          </div>
        } @else {
          <div class="dvp-diff__actions">
            <button mat-button type="button" (click)="discard(); changesPop.close()">Descartar tudo</button>
            <button mat-flat-button color="primary" type="button" (click)="confirming.set(true)" [disabled]="!dirty()"><mat-icon>save</mat-icon>Salvar…</button>
          </div>
        }
      </div>
    </cc-popover>
  `,
  styles: [DV_FORM_STYLES, `
    app-devops-card-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; }
    .dvp { display: flex; flex-direction: column; flex: 1; min-height: 0; background: var(--surface-1, #262b33); border-left: 4px solid var(--dvp-type, #8a8f98); }
    .dvp__head { padding: 6px 10px 8px 16px; display: flex; flex-direction: column; gap: 4px; background: var(--surface-1, #262b33); flex: none; }
    .dvp__row { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
    .dvp__icon { font-size: 18px; width: 18px; height: 18px; }
    .dvp__type { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--cc-text-2); }
    .dvp__id { display: inline-flex; align-items: center; gap: 2px; font-weight: 600; font-size: 13px; color: var(--cc-text-1); text-decoration: none; }
    a.dvp__id:hover { color: var(--mat-sys-primary); }
    .dvp__id mat-icon { font-size: 13px; width: 13px; height: 13px; opacity: .7; }
    .dvp__links { display: inline-flex; gap: 10px; margin-left: 10px; }
    .dvp__spacer { flex: 1; }
    .dvp__small.mat-mdc-outlined-button { height: 30px; font-size: 12.5px; }
    .dvp__chip { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: #3fb950; }
    .dvp__chip mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .dvp__titlerow { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
    .dvp__titleid { font-size: 20px; font-weight: 600; padding: 4px 0; flex: none; }
    .dvp__title { flex: 1; min-width: 0; box-sizing: border-box; resize: none; field-sizing: content; min-height: 36px; max-height: 120px; font: inherit; font-size: 20px; font-weight: 500;
      color: inherit; background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 3px 6px; }
    .dvp__title:hover { border-color: var(--cc-surface-border-strong, rgba(255,255,255,.18)); }
    .dvp__title:focus { outline: none; border-color: color-mix(in srgb, var(--mat-sys-primary) 70%, transparent); background: var(--surface-input, #1a1f28); }
    .dvp__title--changed { border-left: 3px solid var(--mat-sys-primary); }
    .dvp__who { display: flex; align-items: center; gap: 8px 14px; flex-wrap: wrap; min-width: 0; }
    .dvp__assigned { width: 240px; max-width: 100%; }
    .dvp__tags { flex: 1 1 260px; min-width: 200px; max-width: 520px; }
    .dvp__changed { box-shadow: inset 3px 0 0 var(--mat-sys-primary); border-radius: 6px; padding-left: 4px; }
    .dvp__comments { display: inline-flex; align-items: center; gap: 4px; border: 0; background: none; color: var(--mat-sys-primary); font: inherit; font-size: 13px;
      cursor: pointer; padding: 4px 2px; white-space: nowrap; }
    .dvp__comments:hover { text-decoration: underline; }
    .dvp__comments mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .dvp__save { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .dvp__save mat-icon { margin-right: 4px; }
    .dvp__pending { font-size: 12.5px; text-decoration: underline dotted; }
    .dvp__strip { display: flex; align-items: flex-end; gap: 12px; padding: 8px 10px 0 16px; flex: none; flex-wrap: wrap;
      background: var(--surface-2, #2e343f); border-top: 1px solid var(--cc-surface-border, rgba(255,255,255,.08)); }
    .dvp__strip-fields { flex: 1 1 520px; display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px 12px; padding-bottom: 8px; min-width: 0; }
    .dvp__sf { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .dvp__sf--wide { grid-column: span 2; }
    .dvp__sf-label { font-size: 11.5px; color: var(--cc-text-2); display: flex; align-items: center; gap: 4px; }
    .dvp__ro-value { font-size: 13px; color: var(--cc-text-2); padding: 6px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dvp__tabs { display: flex; align-items: flex-end; gap: 2px; flex-wrap: wrap; margin-left: auto; }
    .dvp__tab { display: inline-flex; align-items: center; gap: 5px; border: 1px solid transparent; border-bottom: 0; border-radius: 8px 8px 0 0; background: transparent;
      color: var(--cc-text-2); font: inherit; font-size: 13px; padding: 7px 12px; cursor: pointer; white-space: nowrap; }
    .dvp__tab mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .dvp__tab:hover { color: var(--cc-text-1); background: color-mix(in srgb, var(--surface-1, #262b33) 50%, transparent); }
    .dvp__tab--on { background: var(--surface-1, #262b33); color: var(--cc-text-1); border-color: var(--cc-surface-border, rgba(255,255,255,.08));
      box-shadow: inset 0 2px 0 var(--mat-sys-primary); font-weight: 600; }
    .dvp__tab-n { font-size: 11px; min-width: 18px; padding: 0 5px; border-radius: 9px; text-align: center; background: color-mix(in srgb, var(--cc-text-2) 18%, transparent); }
    .dvp__progress { height: 2px; flex: none; }
    .dvp__body { flex: 1; min-height: 0; overflow: auto; padding: 14px 16px 20px; }
    .dvp__pane[hidden] { display: none !important; }
    .dvp__pane { display: flex; flex-direction: column; gap: 18px; }
    .dvp__cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 340px); gap: 24px; align-items: start; }
    .dvp__texts { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
    .dvp__side { display: flex; flex-direction: column; gap: 18px; min-width: 0; position: sticky; top: 0; }
    .dvp__stack { display: flex; flex-direction: column; gap: 10px; }
    .dvp__sec { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .dvp__sec h3 { margin: 0; padding-bottom: 6px; font-size: 14px; font-weight: 600; color: var(--cc-text-1); border-bottom: 1px solid var(--cc-surface-border, rgba(255,255,255,.08));
      display: flex; align-items: center; gap: 8px; }
    .dvp__sec h3 .dv-linkbtn { font-weight: 400; }
    .dvp__req { color: #f85149; }
    .dvp__textfield .dv-html { max-height: 420px; }
    .dvp__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px 16px; }
    .dvp__wide { grid-column: 1 / -1; }
    .dvp__ro { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0; font-size: 12.5px; }
    .dvp__ro dt { color: var(--cc-text-3); }
    .dvp__ro dd { margin: 0; color: var(--cc-text-2); overflow-wrap: anywhere; }
    .dvp__ro--cols { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px 16px; }
    .dvp__ro--cols > div { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .dvp__note { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 10px; font-size: 12.5px; }
    .dvp__note mat-icon { font-size: 17px; width: 17px; height: 17px; flex: none; }
    .dvp__note--err { background: rgba(248,81,73,.08); border: 1px solid rgba(248,81,73,.35); }
    .dvp__note--bar { margin: 8px 16px 0; flex: none; }
    i.dv-changed { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--mat-sys-primary); }
    .dv-img--loading { opacity: .4; min-height: 40px; min-width: 60px; background: var(--surface-input, #1a1f28); }
    .dv-img--error { outline: 1px dashed rgba(248,81,73,.5); }
    @media (max-width: 900px) {
      .dvp__cols { grid-template-columns: 1fr; }
      .dvp__side { position: static; }
      .dvp__tabs { margin-left: 0; overflow-x: auto; flex-wrap: nowrap; max-width: 100%; }
      .dvp__sf--wide { grid-column: span 1; }
      .dvp__titleid, .dvp__title { font-size: 17px; }
    }
    /* Popover do antes × depois */
    .dvp-diff { display: flex; flex-direction: column; gap: 10px; min-width: min(420px, 80vw); }
    .dvp-diff__title { font-weight: 600; font-size: 14px; }
    .dvp-diff__table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
    .dvp-diff__table th { text-align: left; font-weight: 500; color: var(--cc-text-3); padding: 2px 6px 4px; border-bottom: 1px solid var(--cc-surface-border, rgba(127,127,127,.25)); }
    .dvp-diff__table td { padding: 5px 6px; vertical-align: top; border-bottom: 1px solid var(--cc-surface-border, rgba(127,127,127,.15)); overflow-wrap: anywhere; }
    .dvp-diff__label { font-weight: 600; white-space: nowrap; }
    .dvp-diff__before { color: #f85149; text-decoration: line-through; text-decoration-color: rgba(248,81,73,.5); max-width: 200px; }
    .dvp-diff__after { color: #3fb950; max-width: 200px; }
    .dvp-diff__undo { --mdc-icon-button-state-layer-size: 28px; width: 28px; height: 28px; padding: 2px; }
    .dvp-diff__undo mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .dvp-diff__note { margin: 0; font-size: 12px; color: var(--cc-text-2); }
    .dvp-diff__actions { display: flex; justify-content: flex-end; gap: 8px; }
    .dvp-diff__actions mat-icon { margin-right: 4px; }
  `]
})
export class DevOpsCardPanelComponent {
  private api = inject(DevOpsService);
  private pickers = inject(WorkItemPickerSource);
  private router = inject(Router);
  private snack = inject(MatSnackBar);
  /** 0099 (ajustes 2): "Abrir na Bancada" só para admin ou desenvolvedor. */
  readonly canOpenWorkbench = inject(RoleService).canOpenWorkbenchFromDesk;
  readonly showWorkbenchLink = computed(() => this.context() === 'desk' && this.canOpenWorkbench);

  /** Card do DevOps a mostrar. */
  readonly cardId = input<number | string | null>(null);
  /** Épico da Mesa (habilita "Adicionar ao épico"). */
  readonly epic = input<number | null>(null);
  /** Time/board do DevOps (habilitam coluna/lane/Done do board). */
  readonly team = input<string | null>(null);
  readonly boardName = input<string | null>(null, { alias: 'board' });
  /** Aba inicial (ex.: "discussion" para abrir já nos comentários). */
  readonly initialTab = input<CardTab | null>(null);
  /** Mesa ou Bancada (na Bancada some "Abrir na Bancada" e "Adicionar ao épico"). */
  readonly context = input<CardPanelContext>('desk');
  readonly closed = output<void>();
  /** Card gravado (salvar, mover, adicionar ao épico, comentar). */
  readonly saved = output<CardDetail>();

  readonly stateRef = F.state;
  readonly assignedRef = F.assignedTo;
  readonly areaRef = F.area;
  readonly iterationRef = F.iteration;

  private readonly changesPop = viewChild.required<CcPopoverComponent>('changesPop');
  private readonly discussion = viewChild<DevOpsCardDiscussionComponent>('discussion');

  /** Card em tela (o input, ou o pai/filho aberto aqui dentro). */
  readonly current = signal<string | null>(null);
  readonly detail = signal<CardDetail | null>(null);
  readonly defs = signal<DevOpsFieldDef[]>([]);
  readonly board = signal<BoardConfig | null>(null);
  private types = signal<DevOpsWorkItemType[]>([]);
  private states = signal<string[]>([]);
  /** Categoria de cada estado (cor da bolinha). */
  private stateCategories = signal<Record<string, string>>({});
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly saving = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);
  readonly conflict = signal(false);
  readonly inEpic = signal(false);
  readonly addingToEpic = signal(false);
  readonly showAll = signal(false);

  // Abas
  readonly tab = signal<CardTab>('details');
  /** Abas já abertas (ficam montadas: trocar de aba não recarrega a discussion/anexos). */
  readonly visited = signal<ReadonlySet<CardTab>>(new Set<CardTab>(['details']));
  readonly commentsLoaded = signal<number | null>(null);
  readonly attachmentsLoaded = signal<number | null>(null);
  readonly historyLoaded = signal<number | null>(null);
  /** Board achado pelo card quando a página não diz o time/board (Bancada). */
  private readonly autoBoard = signal<{ team: string; board: string } | null>(null);
  /** Time/board em uso: os da página (épico) ou o achado pelo card. */
  readonly boardTeam = computed(() => this.team() ?? this.autoBoard()?.team ?? null);
  readonly boardBoard = computed(() => this.boardName() ?? this.autoBoard()?.board ?? null);
  /** Popover do antes × depois em modo "confirmar o Salvar". */
  readonly confirming = signal(false);

  // Edição
  readonly values = signal<Record<string, unknown>>({});
  readonly title = signal('');
  readonly tags = signal<string[]>([]);

  private loadSeq = 0;

  readonly groups = computed(() => groupFields(this.defs(), this.values(), this.showAll()));
  /** Planejamento (lado direito dos Detalhes): os principais menos os que estão no cabeçalho. */
  readonly planning = computed(() => this.groups().main.filter((f) => !HEADER_FIELDS.includes(f.referenceName)));
  readonly patch = computed(() => {
    const d = this.detail();
    return d ? buildPatch(d, this.defs(), this.values(), this.title(), this.tags()) : null;
  });
  readonly dirty = computed(() => !!this.patch());
  readonly changed = computed(() => {
    const d = this.detail();
    return d ? changedFields(d, this.defs(), this.values()) : new Set<string>();
  });
  readonly changes = computed<PendingChange[]>(() => {
    const d = this.detail();
    return d ? describeChanges(d, this.defs(), this.values(), this.title(), this.tags()) : [];
  });
  readonly tagsChanged = computed(() => !!(this.patch()?.addTags?.length || this.patch()?.removeTags?.length));
  readonly pendingLabel = computed(() => changesLabel(this.changes()) || 'Alterado');

  readonly webUrl = computed(() => {
    const d = this.detail();
    return d ? devOpsWebUrl(d.url, d.id) : null;
  });
  readonly parentId = computed(() => this.detail()?.relations?.find((r) => r.rel === PARENT_REL)?.id ?? null);
  readonly childCount = computed(() => (this.detail()?.relations ?? []).filter((r) => r.rel === CHILD_REL).length);
  readonly commentCount = computed(() => this.commentsLoaded() ?? Number(this.detail()?.fields?.['System.CommentCount'] ?? 0));
  readonly attachmentCount = computed(() =>
    this.attachmentsLoaded() ?? (this.detail()?.relations ?? []).filter((r) => r.rel === 'AttachedFile').length);
  readonly relatedCount = computed(() => (this.detail()?.relations ?? []).filter((r) => r.rel !== 'AttachedFile').length);
  readonly reasonText = computed(() => `${this.detail()?.fields?.[F.reason] ?? ''}`);

  readonly tabs = computed(() => {
    const ch = this.changed();
    const fieldsDirty = this.groups().others.some((f) => ch.has(f.referenceName));
    const detailsDirty = [...this.groups().texts, ...this.planning()].some((f) => ch.has(f.referenceName));
    return [
      { id: 'details' as CardTab, label: 'Detalhes', icon: 'article', count: null, dot: detailsDirty },
      { id: 'fields' as CardTab, label: 'Campos', icon: 'tune', count: null, dot: fieldsDirty },
      { id: 'discussion' as CardTab, label: 'Discussion', icon: 'forum', count: this.commentCount(), dot: false },
      { id: 'attachments' as CardTab, label: 'Anexos', icon: 'attach_file', count: this.attachmentCount(), dot: false },
      { id: 'related' as CardTab, label: 'Relacionados', icon: 'link', count: this.relatedCount(), dot: false },
      { id: 'history' as CardTab, label: 'Histórico', icon: 'history', count: this.historyLoaded(), dot: false },
    ];
  });

  /** Nome de cada campo do tipo (aba Histórico). */
  readonly fieldLabels = computed(() => Object.fromEntries(this.defs().map((f) => [f.referenceName, f.referenceName === F.state ? 'Estado' : f.name])));

  /** Datas do card (somente leitura, como o bloco "Dates" do DevOps). */
  readonly dates = computed(() => {
    const d = this.detail();
    if (!d) return [];
    const fmt = (v: unknown) => displayValue({ type: 'dateTime', referenceName: 'x', allowedValues: [] }, v);
    const who = (v: unknown) => displayValue({ type: 'identity', referenceName: F.createdBy, allowedValues: [] }, v);
    const out: { label: string; value: string }[] = [];
    if (d.fields[F.createdDate]) out.push({ label: 'Criado', value: `${fmt(d.fields[F.createdDate])} · ${who(d.fields[F.createdBy])}` });
    if (d.fields[F.changedDate]) out.push({ label: 'Alterado', value: `${fmt(d.fields[F.changedDate])} · ${who(d.fields[F.changedBy])}` });
    return out;
  });

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

  readonly stateText = computed(() => {
    const v = this.values()[F.state] ?? this.detail()?.state;
    return v == null || v === '' ? null : `${v}`;
  });
  readonly stateCombo = computed<PmComboOption[]>(() => {
    const cats = this.stateCategories();
    return this.stateOptions().map((name) => {
      const cat = (cats[name.toLowerCase()] ?? '').replace(/\s+/g, '').toLowerCase();
      return { value: name, label: name, color: STATE_CATEGORY_COLORS[cat] ?? '#8b949e' };
    });
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
  readonly columnCombo = computed<PmComboOption[]>(() => this.columnOptions().map((c) => ({ value: c.name, label: c.name })));
  readonly laneCombo = computed<PmComboOption[]>(() =>
    this.laneOptions().map((l) => ({ value: l.key || DEFAULT_LANE, label: l.name })));
  /** O que o combo mostra (volta ao gravado quando o DevOps recusa o movimento). */
  readonly columnPick = linkedSignal(() => this.boardColumn() || null);
  readonly lanePick = linkedSignal(() => this.boardLane() || DEFAULT_LANE);

  constructor() {
    this.api.types().subscribe({ next: (t) => this.types.set(t ?? []), error: () => {} });

    effect(() => {
      const id = this.cardId();
      untracked(() => this.show(id));
    });

    effect(() => {
      const t = this.initialTab();
      if (t) untracked(() => this.selectTab(t));
    });

    effect(() => {
      const team = this.boardTeam();
      const name = this.boardBoard();
      untracked(() => {
        this.board.set(null);
        if (team && name) this.api.board(team, name).subscribe({ next: (cfg) => this.board.set(cfg), error: () => {} });
      });
    });

    effect(() => {
      const ep = this.context() === 'desk' ? this.epic() : null;
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
    this.commentsLoaded.set(null);
    this.attachmentsLoaded.set(null);
    this.historyLoaded.set(null);
    this.autoBoard.set(null);
    if (this.tab() === 'related') this.tab.set('details');
    if (key) {
      this.load(key);
      this.findBoard(key);
    }
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
          this.stateCategories.set(Object.fromEntries((states?.states ?? []).map((s) => [s.name.toLowerCase(), s.category ?? ''])));
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
  }

  /** Sem time/board da página (Bancada): acha o board em que o card aparece, para coluna/lane/Done. */
  private findBoard(id: string): void {
    if (this.team() && this.boardName()) return;
    this.api.cardBoard(id).subscribe({
      next: (r) => { if (this.current() === id && r.team && r.board) this.autoBoard.set({ team: r.team, board: r.board }); },
      error: () => {}
    });
  }

  private checkEpic(epic: number | null, id: string | null): void {
    this.inEpic.set(false);
    if (!epic || !id) return;
    this.api.epicsOfCard(id).subscribe({
      next: (list) => { if (this.current() === id) this.inEpic.set(list.some((e) => e.number === epic)); },
      error: () => {}
    });
  }

  /** Definição de um campo do cabeçalho (responsável, área, iteração) — só quando o tipo tem e é editável. */
  headerDef(ref: string): DevOpsFieldDef | null {
    return this.defs().find((f) => f.referenceName === ref && !f.readOnly) ?? null;
  }

  selectTab(t: CardTab): void {
    this.tab.set(t);
    if (!this.visited().has(t)) this.visited.update((v) => new Set([...v, t]));
  }

  openDiscussion(): void {
    this.selectTab('discussion');
    setTimeout(() => this.discussion()?.focus(), 0);
  }

  onCommented(): void {
    const d = this.detail();
    if (d) this.saved.emit(d);
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

  /** Desfaz uma alteração da lista (volta ao valor gravado). */
  undo(c: PendingChange): void {
    const d = this.detail();
    if (!d) return;
    if (c.ref === F.title) this.title.set(d.title ?? '');
    else if (c.ref === 'tags') this.tags.set(d.tags?.length ? [...d.tags] : parseTags(d.fields?.[F.tags]));
    else this.setValue(c.ref, c.ref === F.state ? (d.fields?.[F.state] ?? d.state) : (d.fields?.[c.ref] ?? null));
    if (!this.dirty()) this.changesPop().close();
  }

  /** Link "Alterado: …": mostra o antes × depois. */
  showChanges(origin: CdkOverlayOrigin, confirm: boolean): void {
    this.confirming.set(confirm);
    this.changesPop().open(origin);
  }

  /** "Salvar": confirma antes, com a lista do que vai para o DevOps. */
  askSave(origin: CdkOverlayOrigin): void {
    if (!this.dirty() || this.saving()) return;
    this.showChanges(origin, true);
  }

  confirmSave(): void {
    this.changesPop().close();
    this.save();
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

  pickColumn(column: string | null): void {
    if (!column || column === this.boardColumn()) return;
    this.columnPick.set(column);
    this.moveTo({ column });
  }

  pickLane(value: string | null): void {
    const lane = !value || value === DEFAULT_LANE ? '' : value;
    if (lane === this.boardLane()) return;
    this.lanePick.set(value || DEFAULT_LANE);
    this.moveTo({ lane });
  }

  /** Coluna/lane/Done do board: grava na hora (como arrastar no board). */
  moveTo(change: { column?: string; lane?: string; done?: boolean }, el?: HTMLInputElement): void {
    const d = this.detail();
    const cfg = this.board();
    const team = this.boardTeam();
    const board = this.boardBoard();
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
        if (el) el.checked = this.boardDone();
        this.columnPick.set(this.boardColumn() || null);
        this.lanePick.set(this.boardLane() || DEFAULT_LANE);
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
    if (!this.showWorkbenchLink()) return;
    const id = this.current();
    if (id) void this.router.navigate(['/auth/workbench'], { queryParams: { card: id } });
  }

  close(): void {
    if (this.dirty() && !confirm('Há alterações não salvas neste card. Fechar mesmo assim?')) return;
    this.closed.emit();
  }
}
