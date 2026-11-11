import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DomSanitizer } from '@angular/platform-browser';
import { WorkItemsService } from '../../services/work-items.service';
import { WsService } from '../../services/ws.service';
import { PlanMarkdownPipe } from '../execution-plan/plan-markdown.pipe';
import { registerWorkItemTypeIcons } from '../../helpers/work-item-type-icons';
import { WiTypeIconComponent } from './wi-type-icon.component';
import {
  LiveFeedEntry,
  TASK_ACTION_LABELS,
  TICKET_ACTION_LABELS,
  TicketAction,
  WorkItem,
  WorkItemCatalog,
  WorkItemLive,
  WorkItemsUpdatedPayload,
  WorkTask,
  WorkTaskAction,
  WorkTaskLink,
  activityIcon,
  buildLiveFeed,
  canCancel,
  canExecute,
  canResolveWait,
  canUndo,
  changedTaskNumbers,
  currentTicket,
  executorLabel,
  formatElapsed,
  formatWorkNumber,
  isExecutingItem,
  itemProgress,
  itemStatusLook,
  kindInfo,
  prStatusLabel,
  pullRequestLinks,
  requestStatusLabel,
  taskExtraOutputLinks,
  taskLinkCiLook,
  taskLinkIcon,
  taskLinkStatusLook,
  taskLinks,
  taskPrHint,
  taskStatusLook,
  ticketTaskActions,
  userTaskActions,
  waitCodeLabel,
  waitingForResolve
} from './work-item.model';
import { WorkItemActionsService } from './work-item-actions.service';
import { listenWorkItems } from './work-items-live';
import { WorkItemQuestionsComponent } from './work-item-questions.component';
import { EXECUTION_PLAN_EVENT, ExecutionPlanRealtimePayload, ExecutionQuestion } from '../execution-plan/execution-plan.model';
import { ExecutionPlanService } from '../../services/execution-plan.service';
import { WorkItemFilesStore } from './work-item-files.store';

/** Debounce dos eventos do tempo real (rajadas de atividade viram um GET só). */
const LIVE_DEBOUNCE_MS = 300;
/** Polling de segurança: só enquanto o item roda e sem evento recente. */
const POLL_IDLE_MS = 10_000;
/** Heartbeat mais velho que isso → "sem sinal do executor". */
const QUIET_MS = 120_000;
/** Duração do destaque de uma sub-tarefa que mudou de status. */
const FLASH_MS = 1_600;

/**
 * 0085 (ajustes): **sessão de execução** de um item de trabalho — o que o Claude está fazendo naquele item, ao vivo.
 * Cabeçalho (tipo/#/título/status, robô animado enquanto roda, máquina, tempo decorrido, motivo da espera), sub-tarefas
 * com o status ao vivo (pendente → em andamento → concluída, com transição), "agora" (atividade do executor), feed do que
 * foi feito (atividades + registros; o mais novo embaixo, rola sozinho só se a pessoa estiver no fim), saídas das
 * sub-tarefas (PR/branch) e as ações (Cancelar…, Desfazer, Executar de novo). Ao concluir, um resumo final.
 * Chamado na Bancada: cada sub-tarefa mostra os chamados/PRs ligados a ela com o status; a de chamado da pessoa ganha
 * "Anexar chamado" e o menu do status (resolvido conclui sozinha; fechado sem resolução; reabrir).
 * "Já resolvi": sub-tarefa do Claude parada esperando a pessoa (sem acesso ao banco, credencial, decisão…) ganha um quadro
 * com o motivo, a nota opcional do que ela fez e o botão que devolve a sub-tarefa ao Claude e retoma o item.
 *
 * Fonte: `GET WorkItems/{number}` (sub-tarefas) + `GET WorkItems/{number}/live`. Tempo real: `workItemsUpdated` no grupo
 * `execplan:{card}` (refaz os GETs do item afetado com debounce de 300 ms; `_resynced` recarrega) + polling de 10 s só
 * enquanto roda e sem evento recente.
 *
 * API pública: `[number]` (obrigatório), `[card]` (opcional — sem ele usa o card do item), `[catalog]` (rótulos/ícones
 * das sub-tarefas), `(openDetails)` (número — abrir o modal do item), `(itemChange)` (item a cada carga).
 */
@Component({
  selector: 'app-work-item-execution',
  standalone: true,
  imports: [DatePipe, MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule, PlanMarkdownPipe, WiTypeIconComponent, WorkItemQuestionsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="wie" [class.wie--live]="live()" [class.wie--celebrate]="celebrate()" [attr.aria-busy]="live()"
             [attr.aria-label]="'Sessão de execução do item ' + num(number())">
      <header class="wie__head">
        <div class="wie__bot" [class.wie__bot--on]="running()" [class.wie__bot--wait]="waitingSomeone()" [style.--wie-c]="look().color"
             [matTooltip]="running() ? 'O Claude está trabalhando neste item' : look().label">
          <mat-icon>{{ botIcon() }}</mat-icon>
        </div>
        <div class="wie__head-main">
          <div class="wie__title">
            @if (item(); as it) { <app-wi-type-icon class="wie__type" [type]="it.type" [catalog]="catalog()" /> }
            <span class="wie__num">{{ num(number()) }}</span>
            <span class="wie__title-text" [title]="item()?.title || ''">{{ item()?.title || 'Carregando…' }}</span>
          </div>
          <div class="wie__sub">
            <span class="wie__status" [style.color]="look().color"><mat-icon [class.wie__spin]="look().spin" [class.cime-bob]="look().bob">{{ look().icon }}</mat-icon>{{ look().label }}</span>
            @if (liveData()?.request; as r) {
              @if (r.workerName) { <span class="wie__fact" matTooltip="Máquina que executa"><mat-icon>computer</mat-icon>{{ r.workerName }}</span> }
              @if (live()) { <span class="wie__fact wie__fact--muted">{{ requestLabel(r.status) }}</span> }
            }
            @if (elapsed()) { <span class="wie__fact" [matTooltip]="live() ? 'Tempo desde o início' : 'Duração'"><mat-icon>timer</mat-icon>{{ elapsed() }}</span> }
            @if (progress().total) { <span class="wie__fact">{{ progress().done }}/{{ progress().total }} sub-tarefas</span> }
            @if (!files.unavailable()) {
              <button class="wie__files" [class.wie__files--new]="filesFlash()" (click)="openFiles()" matTooltip="Arquivos do item (chamados, scripts, análises, anexos)"
                      [attr.aria-label]="'Arquivos do item: ' + files.count()">
                <mat-icon>folder_open</mat-icon>Arquivos ({{ files.count() }})
                @if (hasTicket()) { <mat-icon class="wie__files-ticket" matTooltip="Tem chamado pronto">confirmation_number</mat-icon> }
              </button>
            }
          </div>
        </div>
        <button mat-icon-button class="wie__open" (click)="openDetails.emit(number())" matTooltip="Abrir o item (descrição, histórico)" aria-label="Abrir o item">
          <mat-icon>open_in_new</mat-icon>
        </button>
      </header>

      <div class="wie__progress" role="progressbar" [attr.aria-valuenow]="progress().pct" aria-valuemin="0" aria-valuemax="100"
           [attr.aria-label]="progress().done + ' de ' + progress().total + ' sub-tarefas'">
        <span class="wie__progress-fill" [style.width.%]="progress().pct" [style.background]="look().color"></span>
        @if (live()) { <span class="wie__progress-run"></span> }
      </div>

      <div class="wie__body">
        @if (error()) { <div class="wie__note wie__note--err"><mat-icon>error_outline</mat-icon><span>{{ error() }}</span><button mat-button (click)="reload()">Tentar de novo</button></div> }

        @if (waitText(); as w) {
          <div class="wie__note wie__note--warn"><mat-icon>hourglass_top</mat-icon><span>{{ w }}</span></div>
        }
        @if (live() && liveData() && !liveData()!.executorOnline && !waitText()) {
          <div class="wie__note wie__note--warn"><mat-icon>cloud_off</mat-icon><span>Seu executor está offline — a execução continua quando ele voltar.</span></div>
        }
        @if (quietFor(); as q) {
          <div class="wie__note wie__note--muted"><mat-icon>signal_cellular_connected_no_internet_0_bar</mat-icon><span>Sem sinal do executor há {{ q }} — ele pode estar num comando longo.</span></div>
        }

        <!-- Perguntas do PRMake (plano do item): responder aqui, sem ir para a aba Execução. Elas destravam o Claude — o
             "Já resolvi" fica para as outras esperas (sem acesso, credencial…). -->
        @if (questionsShown().length && item()?.planId; as planId) {
          <app-work-item-questions [planId]="planId" [questions]="questionsShown()" [taskLabel]="waitingLabel()"
                                   (answered)="onAnswered($event)"></app-work-item-questions>
        } @else if (resolvable(); as rt) {
          <!-- "Já resolvi": o Claude parou esperando a pessoa (sem acesso, credencial, decisão…) — ela destrava daqui -->
          <div class="wie__unblock" role="group" [attr.aria-label]="'Destravar ' + num(rt.number)">
            <div class="wie__unblock-head">
              <mat-icon>front_hand</mat-icon>
              <span>O Claude parou em <b>{{ num(rt.number) }}</b> esperando você. Resolva o que ele pede e avise para ele continuar.</span>
            </div>
            @if (rt.result) { <div class="wie__unblock-why wie__md" [innerHTML]="rt.result | planMarkdown"></div> }
            <textarea class="wie__input wie__unblock-note" rows="2" [value]="resolveNote()" (input)="resolveNote.set($any($event.target).value)"
                      (keydown.control.enter)="resolve(rt)" (keydown.meta.enter)="resolve(rt)"
                      placeholder="O que você fez (opcional, o Claude lê ao retomar) — ex.: adicionei o alias do banco de DEV"
                      aria-label="O que você fez para destravar"></textarea>
            <div class="wie__unblock-actions">
              <button mat-button (click)="openTask(item()!, rt)">Ver a sub-tarefa</button>
              <button mat-flat-button color="primary" (click)="resolve(rt)" [disabled]="busyTask() === rt.number"
                      matTooltip="A sub-tarefa volta a andar e o Claude retoma o item de onde parou">
                <mat-icon>lock_open</mat-icon>Já resolvi — continuar
              </button>
            </div>
          </div>
        }

        @if (live()) {
          <div class="wie__now" aria-live="polite">
            @if (liveData()?.activity; as a) {
              <mat-icon class="wie__now-ico">{{ actIcon(a.tool) }}</mat-icon>
              <span class="wie__now-text"><b>Agora:</b> {{ a.label }}</span>
              <small class="wie__now-age">{{ ago(a.at) }}</small>
            } @else if (item()?.status === 'queued') {
              <mat-icon class="wie__now-ico">schedule</mat-icon><span class="wie__now-text">Na fila do executor — começa em instantes.</span>
            } @else if (item()?.status === 'waiting') {
              <mat-icon class="wie__now-ico">front_hand</mat-icon><span class="wie__now-text">{{ resolvable() ? 'Aguardando você — veja acima o que destravar.' : 'Aguardando uma ação para continuar.' }}</span>
            } @else {
              <mat-icon class="wie__now-ico wie__pulse">psychology</mat-icon><span class="wie__now-text">{{ item()?.activity || 'Pensando…' }}</span>
            }
          </div>
        }

        @if (finished(); as f) {
          <div class="wie__final wie__final--{{ f.tone }}">
            <mat-icon class="wie__final-ico">{{ f.icon }}</mat-icon>
            <div class="wie__final-main">
              <b>{{ f.title }}</b>
              <span>{{ f.text }}</span>
              @if (prs().length) {
                <div class="wie__links">
                  @for (p of prs(); track p.url) {
                    <a class="wie__link" [href]="p.url" target="_blank" rel="noopener"><mat-icon>merge</mat-icon>{{ p.title }}@if (p.status) { · {{ prLabel(p.status).toLowerCase() }} }</a>
                  }
                </div>
              }
            </div>
          </div>
        }

        <section class="wie__sec">
          <h4 class="wie__sec-title">Sub-tarefas</h4>
          @if (item(); as it) {
            @if (!it.tasks.length) { <p class="wie__muted">Sem sub-tarefas.</p> }
            <ol class="wie__tasks">
              @for (t of it.tasks; track t.id) {
                <li class="wie__task wie__task--{{ t.status }}" [class.wie__task--current]="t.number === currentTask()" [class.wie__task--flash]="flashed().has(t.number)">
                  <span class="wie__task-st" [style.color]="taskLook(t).color" [matTooltip]="taskLabel(t)">
                    <mat-icon [class.wie__spin]="taskLook(t).spin">{{ taskIcon(t) }}</mat-icon>
                  </span>
                  <div class="wie__task-main">
                    <button class="wie__task-btn" (click)="openTask(it, t)" [title]="t.title">
                      <span class="wie__num">{{ num(t.number) }}</span>
                      <mat-icon class="wie__task-kind" [matTooltip]="kind(t).label">{{ kind(t).icon }}</mat-icon>
                      <span class="wie__task-title">{{ t.title }}</span>
                    </button>
                    @if (links(t).length || outLinks(t).length) {
                      <span class="wie__outs">
                        <!-- Chamado na Bancada: chamados e PRs ligados à sub-tarefa, com o status -->
                        @for (l of links(t); track l.url) {
                          <a class="wie__out wie__out--{{ l.kind }}" [href]="l.url" target="_blank" rel="noopener" [matTooltip]="l.title ? l.title + ' — ' + l.url : l.url">
                            <mat-icon>{{ linkIco(l.kind) }}</mat-icon><span class="wie__out-text">{{ linkText(l) }}</span>
                            @if (linkLook(l); as st) { <span class="wie__out-st" [style.color]="st.color">{{ st.label }}</span> }
                            @if (ciLook(l); as ci) { <span class="wie__out-st" [style.color]="ci.color">{{ ci.label }}</span> }
                          </a>
                        }
                        @for (o of outLinks(t); track o.url) {
                          <a class="wie__out" [href]="o.url" target="_blank" rel="noopener" [matTooltip]="(o.title ? o.title + (o.status ? ' · ' + prLabel(o.status).toLowerCase() : '') + ' — ' : '') + o.url">
                            <mat-icon>{{ o.kind === 'pr' ? 'merge' : o.kind === 'branch' ? 'call_split' : 'link' }}</mat-icon>{{ o.kind === 'pr' ? 'PR' : o.kind === 'branch' ? 'Branch' : o.key }}
                          </a>
                        }
                      </span>
                    }
                    @if (ticketDraft()?.task === t.number) {
                      <div class="wie__ticket-form" role="group" [attr.aria-label]="'Anexar chamado em ' + num(t.number)">
                        <input class="wie__input" type="url" required [value]="ticketDraft()!.url" (input)="draftField('url', $any($event.target).value)"
                               (keydown.enter)="saveTicket(t)" (keydown.escape)="ticketDraft.set(null)" placeholder="Link do chamado (obrigatório)" aria-label="Link do chamado" />
                        <input class="wie__input wie__input--short" [value]="ticketDraft()!.title" (input)="draftField('title', $any($event.target).value)"
                               (keydown.enter)="saveTicket(t)" (keydown.escape)="ticketDraft.set(null)" placeholder="Título ou número (opcional)" aria-label="Título ou número do chamado" />
                        <button mat-button (click)="ticketDraft.set(null)" [disabled]="busyTask() === t.number">Cancelar</button>
                        <button mat-flat-button color="primary" (click)="saveTicket(t)" [disabled]="!ticketDraft()!.url.trim() || busyTask() === t.number">Anexar</button>
                      </div>
                    }
                    @if (ticketDraft()?.task === t.number) {
                      <small class="wie__ticket-help">A sub-tarefa conclui sozinha quando o chamado for marcado como resolvido.</small>
                    }
                  </div>
                  <span class="wie__task-label" [style.color]="taskLook(t).color">{{ taskLabel(t) }}</span>
                  <span class="wie__chip">{{ executor(t.executor) }}</span>
                  @if (ticketActs(it, t); as ta) {
                    @if (ta.length === 1 && ta[0] === 'attach') {
                      @if (ticketDraft()?.task !== t.number) {
                        <button mat-stroked-button class="wie__ticket-btn" (click)="startTicket(t)" [disabled]="busyTask() === t.number"
                                matTooltip="Informe o link do chamado aberto — a sub-tarefa aguarda o chamado ser resolvido">
                          <mat-icon>add_link</mat-icon>Anexar chamado
                        </button>
                      }
                    } @else if (ta.length) {
                      <button mat-stroked-button class="wie__ticket-btn" [matMenuTriggerFor]="ticketMenu" [matMenuTriggerData]="{ t: t, acts: ta }"
                              [disabled]="busyTask() === t.number" matTooltip="Marcar o status do chamado — resolvido conclui a sub-tarefa sozinha">
                        <mat-icon>confirmation_number</mat-icon>Chamado<mat-icon class="wie__ticket-caret">arrow_drop_down</mat-icon>
                      </button>
                    }
                  }
                  @if (canResolve(t)) {
                    <button mat-icon-button class="wie__qa" (click)="resolve(t)" [disabled]="busyTask() === t.number"
                            matTooltip="Já resolvi — o Claude continua" [attr.aria-label]="'Já resolvi ' + num(t.number)"><mat-icon>lock_open</mat-icon></button>
                  }
                  <!-- Chamado aberto: o status vai pelo menu "Chamado"; concluir/falhar/pular ficam no detalhe da sub-tarefa -->
                  @for (a of openTicket(t) ? [] : userActions(t); track a) {
                    <button mat-icon-button class="wie__qa" (click)="taskAct(t, a)" [disabled]="busyTask() === t.number"
                            [matTooltip]="actionLook(a).label" [attr.aria-label]="actionLook(a).label + ' ' + num(t.number)"><mat-icon>{{ actionLook(a).icon }}</mat-icon></button>
                  }
                </li>
              }
            </ol>
            <mat-menu #ticketMenu="matMenu">
              <ng-template matMenuContent let-t="t" let-acts="acts">
                @for (a of acts; track a) {
                  <button mat-menu-item (click)="ticketAct(t, a)"><mat-icon>{{ ticketLook(a).icon }}</mat-icon>{{ a === 'attach' ? 'Anexar outro chamado' : ticketLook(a).label }}</button>
                }
              </ng-template>
            </mat-menu>
          } @else if (!error()) {
            <p class="wie__muted">Carregando…</p>
          }
        </section>

        <section class="wie__sec wie__sec--feed">
          <h4 class="wie__sec-title">O que está sendo feito @if (feed().length) { <small>{{ feed().length }}</small> }</h4>
          <div class="wie__feed-wrap">
            <ol #feedEl class="wie__feed" (scroll)="onFeedScroll()" aria-label="Atividades da execução">
              @for (e of feed(); track $index) {
                <li class="wie__entry wie__entry--{{ e.source }}" [class.wie__entry--err]="e.kind === 'error' || e.kind === 'failed'">
                  <time class="wie__entry-at" [attr.datetime]="e.at">{{ e.at | date:'HH:mm:ss' }}</time>
                  <mat-icon class="wie__entry-ico">{{ entryIcon(e) }}</mat-icon>
                  <span class="wie__entry-text">
                    @if (e.taskNumber) { <span class="wie__num">{{ num(e.taskNumber) }}</span> }
                    @if (e.source === 'log') { <span class="wie__md" [innerHTML]="e.text | planMarkdown"></span> } @else { {{ e.text }} }
                  </span>
                </li>
              } @empty {
                <li class="wie__muted wie__entry--empty">{{ live() ? 'As atividades aparecem aqui assim que o executor começar.' : 'Nada registrado nesta execução.' }}</li>
              }
            </ol>
            @if (unseen()) {
              <button class="wie__jump" (click)="scrollToEnd()"><mat-icon>arrow_downward</mat-icon>Novas atividades</button>
            }
          </div>
        </section>
      </div>

      @if (item(); as it) {
        <footer class="wie__foot">
          @if (canUndoIt()) { <button mat-button (click)="undo()" [disabled]="acting()"><mat-icon>undo</mat-icon>Desfazer</button> }
          @if (canCancelIt()) { <button mat-button class="wie__cancel" (click)="cancel()" [disabled]="acting()"><mat-icon>stop_circle</mat-icon>Cancelar…</button> }
          <span class="wie__spacer"></span>
          @if (canRun()) {
            <button mat-flat-button color="primary" (click)="execute()" [disabled]="acting()"><mat-icon>play_arrow</mat-icon>{{ it.status === 'failed' ? 'Executar de novo' : 'Executar' }}</button>
          }
        </footer>
      }
    </section>
  `,
  styles: [`
    .wie__files { display: inline-flex; align-items: center; gap: 4px; padding: 0 8px; border-radius: 999px; font: inherit; font-size: 11.5px; line-height: 20px; cursor: pointer;
      background: transparent; color: var(--cc-text-2); border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); }
    .wie__files:hover { color: var(--mat-sys-on-surface); border-color: var(--mat-sys-primary); }
    .wie__files mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .wie__files-ticket { color: #d29922; }
    .wie__files--new { border-color: var(--mat-sys-primary); color: var(--mat-sys-primary); }
    :host { display: flex; flex-direction: column; min-height: 0; font-size: 13px; color: var(--mat-sys-on-surface); }
    .wie { position: relative; display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; border-radius: 12px; background: var(--surface-1, #262b33);
      border: 1px solid var(--cc-surface-border, rgba(255,255,255,.08)); overflow: hidden; }
    .wie--live { border-color: color-mix(in srgb, #58a6ff 45%, transparent); }
    .wie__head { display: flex; align-items: center; gap: 10px; padding: 10px 6px 10px 12px; background: var(--surface-2, #2e343f); flex: none; }
    .wie__bot { --wie-c: #9aa4b2; position: relative; flex: none; width: 38px; height: 38px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
      color: var(--wie-c); background: color-mix(in srgb, var(--wie-c) 14%, transparent); border: 1px solid color-mix(in srgb, var(--wie-c) 35%, transparent); }
    .wie__bot mat-icon { font-size: 22px; width: 22px; height: 22px; }
    .wie__head-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .wie__title { display: flex; align-items: center; gap: 6px; min-width: 0; font-weight: 600; font-size: 14.5px; }
    .wie__type { width: 16px; height: 16px; flex: none; }
    .wie__title-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wie__num { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--cc-text-2); flex: none; }
    .wie__sub { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; font-size: 11.5px; color: var(--cc-text-2); }
    .wie__status, .wie__fact { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
    .wie__status mat-icon, .wie__fact mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .wie__fact--muted { color: var(--cc-text-3); }
    .wie__open { flex: none; }
    .wie__open mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .wie__progress { position: relative; height: 3px; background: rgba(255,255,255,.08); overflow: hidden; flex: none; }
    .wie__progress-fill { position: absolute; inset: 0 auto 0 0; transition: width .5s ease; }
    .wie__progress-run { position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(88,166,255,.75), transparent); background-size: 40% 100%; background-repeat: no-repeat; }
    .wie__body { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 12px; padding: 12px; }
    .wie__note { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 10px; font-size: 12.5px;
      background: color-mix(in srgb, var(--mat-sys-primary) 8%, transparent); border: 1px solid color-mix(in srgb, var(--mat-sys-primary) 25%, transparent); }
    .wie__note mat-icon { font-size: 17px; width: 17px; height: 17px; flex: none; }
    .wie__note span { flex: 1; min-width: 0; }
    .wie__note--warn { background: rgba(210,153,34,.08); border-color: rgba(210,153,34,.3); color: #e3b341; }
    .wie__note--err { background: rgba(248,81,73,.08); border-color: rgba(248,81,73,.3); color: #f85149; }
    .wie__note--muted { background: transparent; border-color: var(--cc-surface-border, rgba(255,255,255,.08)); color: var(--cc-text-2); }
    .wie__unblock { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-radius: 10px; flex: none;
      background: rgba(210,153,34,.08); border: 1px solid rgba(210,153,34,.4); }
    .wie__unblock-head { display: flex; align-items: flex-start; gap: 8px; color: #e3b341; font-size: 13px; line-height: 1.4; }
    .wie__unblock-head mat-icon { font-size: 18px; width: 18px; height: 18px; flex: none; }
    .wie__unblock-why { max-height: 180px; overflow: auto; padding: 6px 10px; border-radius: 8px; font-size: 12.5px; line-height: 1.45;
      background: var(--surface-input, #1a1f28); border: 1px solid var(--cc-surface-border, rgba(255,255,255,.08)); overflow-wrap: anywhere; }
    .wie__unblock-why ::ng-deep p { display: block; margin: 0 0 6px; }
    .wie__unblock-why ::ng-deep ul { margin: 0 0 6px; padding-left: 18px; }
    .wie__unblock-note { width: 100%; resize: vertical; min-height: 38px; }
    .wie__unblock-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
    .wie__unblock-actions mat-icon { margin-right: 4px; }
    .wie__now { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 10px; background: color-mix(in srgb, #58a6ff 9%, transparent);
      border: 1px solid color-mix(in srgb, #58a6ff 28%, transparent); }
    .wie__now-ico { color: #58a6ff; font-size: 18px; width: 18px; height: 18px; flex: none; }
    .wie__now-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .wie__now-age { color: var(--cc-text-3); white-space: nowrap; font-size: 11px; }
    .wie__final { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); }
    .wie__final-ico { font-size: 26px; width: 26px; height: 26px; flex: none; }
    .wie__final-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .wie__final-main > span { color: var(--cc-text-2); font-size: 12.5px; }
    .wie__final--ok { border-color: rgba(63,185,80,.4); background: rgba(63,185,80,.07); }
    .wie__final--ok .wie__final-ico { color: #3fb950; }
    .wie__final--bad { border-color: rgba(248,81,73,.4); background: rgba(248,81,73,.06); }
    .wie__final--bad .wie__final-ico { color: #f85149; }
    .wie__final--muted .wie__final-ico { color: #bc8cff; }
    .wie__links { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 2px; }
    .wie__link { display: inline-flex; align-items: center; gap: 4px; color: var(--mat-sys-primary); text-decoration: none; font-size: 12.5px; overflow-wrap: anywhere; }
    .wie__link:hover { text-decoration: underline; }
    .wie__link mat-icon { font-size: 15px; width: 15px; height: 15px; flex: none; }
    .wie__sec { display: flex; flex-direction: column; gap: 6px; flex: none; }
    .wie__sec-title { margin: 0; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--cc-text-3); display: flex; gap: 6px; align-items: baseline; }
    .wie__sec-title small { font-weight: 500; letter-spacing: 0; opacity: .8; }
    .wie__muted { color: var(--cc-text-3); margin: 0; font-size: 12.5px; }
    .wie__tasks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
    .wie__task { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 8px; border: 1px solid transparent; transition: background-color .4s ease, border-color .4s ease; }
    .wie__task:hover { background: rgba(255,255,255,.03); }
    .wie__task--current { background: color-mix(in srgb, #58a6ff 8%, transparent); border-color: color-mix(in srgb, #58a6ff 25%, transparent); }
    .wie__task--waiting.wie__task--current { background: rgba(210,153,34,.08); border-color: rgba(210,153,34,.3); }
    .wie__task--cancelled .wie__task-title, .wie__task--reverted .wie__task-title, .wie__task--skipped .wie__task-title { color: var(--cc-text-3); }
    .wie__task--completed .wie__task-title { color: var(--cc-text-2); }
    .wie__task-st { display: inline-flex; flex: none; }
    .wie__task-st mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .wie__task-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .wie__task-btn { display: flex; align-items: center; gap: 6px; min-width: 0; background: none; border: 0; color: inherit; font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; padding: 2px 0; }
    .wie__task-btn:hover .wie__task-title { text-decoration: underline; }
    .wie__task-kind { font-size: 15px; width: 15px; height: 15px; color: var(--cc-text-3); flex: none; }
    .wie__task-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wie__task-label { font-size: 11px; white-space: nowrap; }
    .wie__outs { display: flex; flex-wrap: wrap; gap: 4px; padding-left: 2px; }
    .wie__out { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; line-height: 18px; padding: 0 7px; border-radius: 999px; text-decoration: none;
      color: var(--mat-sys-primary); border: 1px solid color-mix(in srgb, var(--mat-sys-primary) 40%, transparent); }
    .wie__out:hover { background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent); }
    .wie__out mat-icon { font-size: 13px; width: 13px; height: 13px; }
    .wie__out-text { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wie__out-st { font-weight: 600; white-space: nowrap; }
    .wie__out-st::before { content: '·'; margin: 0 3px 0 1px; color: var(--cc-text-3); font-weight: 400; }
    .wie__ticket-btn.mat-mdc-button-base { height: 26px; padding: 0 8px; font-size: 11.5px; flex: none; }
    .wie__ticket-btn mat-icon { font-size: 15px; width: 15px; height: 15px; margin-right: 3px; }
    .wie__ticket-btn .wie__ticket-caret { margin: 0 -4px 0 0; }
    .wie__ticket-form { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 4px 0 2px; }
    .wie__input { flex: 2 1 220px; min-width: 0; box-sizing: border-box; border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); border-radius: 8px;
      background: var(--surface-input, #1a1f28); color: inherit; font: inherit; font-size: 12.5px; padding: 5px 8px; }
    .wie__input--short { flex: 1 1 140px; }
    .wie__input:focus { outline: none; border-color: color-mix(in srgb, var(--mat-sys-primary) 70%, transparent); }
    .wie__ticket-form .mat-mdc-button-base { height: 28px; font-size: 12px; }
    .wie__ticket-help { color: var(--cc-text-3); font-size: 11px; }
    .wie__chip { display: inline-flex; align-items: center; padding: 0 7px; border-radius: 999px; font-size: 10.5px; line-height: 18px; white-space: nowrap;
      border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); color: var(--cc-text-2); }
    .wie__qa.mat-mdc-icon-button { width: 28px; height: 28px; padding: 2px; }
    .wie__qa mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .wie__sec--feed { flex: 1 1 auto; min-height: 140px; }
    .wie__feed-wrap { position: relative; flex: 1; min-height: 0; display: flex; }
    .wie__feed { list-style: none; margin: 0; padding: 6px 8px; flex: 1; min-height: 120px; max-height: 340px; overflow: auto; border-radius: 10px;
      background: var(--surface-input, #1a1f28); border: 1px solid var(--cc-surface-border, rgba(255,255,255,.08)); display: flex; flex-direction: column; gap: 3px;
      font-size: 12px; }
    .wie__entry { display: flex; align-items: flex-start; gap: 6px; line-height: 1.45; }
    .wie__entry-at { color: var(--cc-text-3); font-variant-numeric: tabular-nums; font-size: 11px; flex: none; padding-top: 1px; }
    .wie__entry-ico { font-size: 14px; width: 14px; height: 14px; flex: none; margin-top: 2px; color: var(--cc-text-3); }
    .wie__entry--log .wie__entry-ico { color: #58a6ff; }
    .wie__entry--err, .wie__entry--err .wie__entry-ico { color: #f85149; }
    .wie__entry-text { flex: 1; min-width: 0; overflow-wrap: anywhere; display: inline; }
    .wie__entry-text .wie__num { margin-right: 4px; font-size: 11.5px; }
    .wie__md ::ng-deep p { display: inline; margin: 0; }
    .wie__md ::ng-deep a { color: var(--mat-sys-primary); }
    .wie__entry--empty { padding: 8px 2px; }
    .wie__jump { position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%); display: inline-flex; align-items: center; gap: 4px; border: 0; border-radius: 999px;
      padding: 3px 10px; font: inherit; font-size: 11.5px; cursor: pointer; background: var(--mat-sys-primary); color: var(--mat-sys-on-primary); box-shadow: 0 4px 14px rgba(0,0,0,.3); }
    .wie__jump mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .wie__foot { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 12px; background: var(--surface-2, #2e343f); }
    .wie__foot .mat-mdc-button-base mat-icon { margin-right: 4px; }
    .wie__spacer { flex: 1; }

    /* Animações — só para quem não pediu menos movimento. */
    @media (prefers-reduced-motion: no-preference) {
      .wie__spin { animation: wie-spin 1.1s linear infinite; }
      .wie__pulse { animation: wie-fade 1.6s ease-in-out infinite; }
      .wie--live { animation: wie-glow 2.6s ease-in-out infinite; }
      .wie__bot--on mat-icon { animation: wie-bob 1.4s ease-in-out infinite; }
      .wie__bot--on::after { content: ''; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid transparent;
        border-top-color: var(--wie-c); border-right-color: color-mix(in srgb, var(--wie-c) 40%, transparent); animation: wie-spin 1.2s linear infinite; }
      .wie__bot--wait::after { content: ''; position: absolute; inset: -3px; border-radius: 50%; border: 2px solid var(--wie-c); animation: wie-ring 1.8s ease-out infinite; }
      .wie__progress-run { animation: wie-slide 1.4s ease-in-out infinite; }
      .wie__task--running .wie__task-st, .wie__task--waiting.wie__task--current .wie__task-st { animation: wie-fade 1.6s ease-in-out infinite; }
      .wie__task--flash { animation: wie-flash 1.6s ease-out; }
      .wie__task--flash.wie__task--completed .wie__task-st mat-icon { animation: wie-pop .5s cubic-bezier(.2,1.6,.4,1); }
      .wie--celebrate { animation: wie-done 2.4s ease-out; }
      .wie--celebrate .wie__final-ico { animation: wie-pop .6s cubic-bezier(.2,1.6,.4,1); }
      .wie__entry:last-child { animation: wie-in .35s ease-out; }
    }
    @keyframes wie-spin { to { transform: rotate(360deg); } }
    @keyframes wie-fade { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }
    @keyframes wie-bob { 0%, 100% { transform: translateY(0) rotate(0); } 25% { transform: translateY(-2px) rotate(-6deg); } 75% { transform: translateY(-1px) rotate(6deg); } }
    @keyframes wie-ring { 0% { opacity: .8; transform: scale(.92); } 100% { opacity: 0; transform: scale(1.25); } }
    @keyframes wie-slide { 0% { background-position: -40% 0; } 100% { background-position: 140% 0; } }
    @keyframes wie-glow { 0%, 100% { box-shadow: 0 0 0 0 rgba(88,166,255,0); } 50% { box-shadow: 0 0 0 3px rgba(88,166,255,.14); } }
    @keyframes wie-flash { 0% { background: rgba(88,166,255,.22); } 100% { background: transparent; } }
    @keyframes wie-pop { 0% { transform: scale(.4); } 100% { transform: scale(1); } }
    @keyframes wie-done { 0% { box-shadow: 0 0 0 0 rgba(63,185,80,.5); border-color: rgba(63,185,80,.8); } 100% { box-shadow: 0 0 0 14px rgba(63,185,80,0); } }
    @keyframes wie-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .wie__progress-fill, .wie__task { transition: none; } .wie__progress-run { display: none; } }
    @media (max-width: 560px) { .wie__task-label { display: none; } .wie__feed { max-height: 260px; } }
  `]
})
export class WorkItemExecutionComponent {
  readonly number = input.required<number>();
  readonly card = input<string | null>(null);
  readonly catalog = input<WorkItemCatalog | null>(null);
  /** Pediu para abrir o modal do item. */
  readonly openDetails = output<number>();
  /** Item recarregado (a lista aproveita para atualizar a linha sem outro GET). */
  readonly itemChange = output<WorkItem>();

  private api = inject(WorkItemsService);
  private actions = inject(WorkItemActionsService);
  private ws = inject(WsService);
  private injector = inject(Injector);

  readonly item = signal<WorkItem | null>(null);
  readonly liveData = signal<WorkItemLive | null>(null);
  readonly error = signal<string | null>(null);
  readonly acting = signal(false);
  readonly busyTask = signal<number | null>(null);
  readonly flashed = signal<ReadonlySet<number>>(new Set());
  readonly celebrate = signal(false);
  readonly unseen = signal(false);
  private readonly now = signal(Date.now());

  /** Rodada 5: arquivos do item (chip "Arquivos (n)", ao vivo). */
  readonly files = new WorkItemFilesStore();
  readonly hasTicket = computed(() => this.files.files().some((f) => f.kind === 'ticket'));
  /** Destaque curto no chip quando chega arquivo novo. */
  readonly filesFlash = signal(false);
  private filesSeen = -1;
  private filesFlashTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly feedEl = viewChild<ElementRef<HTMLElement>>('feedEl');

  readonly num = formatWorkNumber;
  readonly executor = executorLabel;
  readonly requestLabel = requestStatusLabel;
  readonly actIcon = activityIcon;
  readonly taskLook = (t: WorkTask) => taskStatusLook(t.status);
  readonly kind = (t: WorkTask) => kindInfo(t.kind, this.catalog());
  /** Chamado na Bancada + 0091: PR/branch das entregas da sub-tarefa (senão os links do `output`), sem repetir um link dela. */
  readonly outLinks = (t: WorkTask) => taskExtraOutputLinks(this.item(), t);
  readonly prLabel = prStatusLabel;
  readonly actionLook = (a: WorkTaskAction) => TASK_ACTION_LABELS[a];
  readonly links = (t: WorkTask) => taskLinks(t);
  readonly linkIco = taskLinkIcon;
  readonly linkLook = taskLinkStatusLook;
  readonly ciLook = taskLinkCiLook;
  readonly ticketLook = (a: TicketAction) => TICKET_ACTION_LABELS[a];
  readonly ticketActs = ticketTaskActions;
  readonly openTicket = (t: WorkTask) => { const c = currentTicket(t); return !!c && (c.status || 'open') === 'open'; };
  /** Chamado na Bancada: formulário "Anexar chamado" aberto numa sub-tarefa. */
  readonly ticketDraft = signal<{ task: number; url: string; title: string } | null>(null);
  /** "Já resolvi": sub-tarefa do Claude esperando a pessoa (a primeira) e a nota do que ela fez. */
  readonly resolvable = computed(() => waitingForResolve(this.item()));
  readonly canResolve = (t: WorkTask) => canResolveWait(t);
  readonly resolveNote = signal('');
  /** Perguntas do plano do item enquanto ele espera a pessoa (lidas do plano a cada carga do item em espera). */
  private plans = inject(ExecutionPlanService);
  private readonly planQuestions = signal<ExecutionQuestion[]>([]);
  /** Respondidas nesta tela: continuam à vista (com a resposta) até o item sair da espera. */
  private readonly answeredHere = signal<ReadonlySet<string>>(new Set());
  private questionsSeq = 0;
  private questionsKey: string | null = null;
  readonly questionsShown = computed(() => {
    const here = this.answeredHere();
    return this.planQuestions()
      .filter((q) => q.status === 'open' || (q.status === 'answered' && here.has(q.id)))
      .sort((a, b) => a.order - b.order);
  });
  readonly waitingLabel = computed(() => {
    const t = (this.item()?.tasks ?? []).find((x) => x.status === 'waiting');
    return t ? this.num(t.number) : null;
  });

  readonly look = computed(() => itemStatusLook(this.status()));
  readonly status = computed(() => this.item()?.status ?? (this.liveData()?.status as WorkItem['status'] | undefined) ?? null);
  readonly live = computed(() => isExecutingItem(this.status() ? { status: this.status()! } : null));
  readonly running = computed(() => this.status() === 'running' || this.status() === 'reverting');
  readonly waitingSomeone = computed(() => this.status() === 'waiting' || this.status() === 'queued');
  readonly botIcon = computed(() => {
    switch (this.status()) {
      case 'completed': return 'task_alt';
      case 'failed': return 'error_outline';
      case 'cancelled': return 'block';
      case 'reverted': case 'reverting': return 'undo';
      case 'queued': return 'hourglass_top';
      case 'waiting': return 'front_hand';
      default: return 'smart_toy';
    }
  });
  readonly progress = computed(() => {
    const it = this.item();
    return it ? itemProgress(it) : { done: 0, total: 0, pct: 0 };
  });
  readonly feed = computed<LiveFeedEntry[]>(() => buildLiveFeed(this.liveData()));
  readonly prs = computed(() => pullRequestLinks(this.item()));

  /** Sub-tarefa em foco: a que roda/espera; com o item vivo e nenhuma rodando, a próxima pendente. */
  readonly currentTask = computed<number | null>(() => {
    const it = this.item();
    if (!it) return null;
    const active = it.tasks.find((t) => t.status === 'running' || t.status === 'waiting');
    if (active) return active.number;
    return this.live() ? it.tasks.find((t) => t.status === 'pending')?.number ?? null : null;
  });

  readonly elapsed = computed(() => {
    const it = this.item();
    const r = this.liveData()?.request;
    const start = r?.startedAt || r?.claimedAt || it?.startedAt;
    if (!start) return '';
    const from = Date.parse(start);
    const end = this.live() ? this.now() : it?.completedAt ? Date.parse(it.completedAt) : NaN;
    return isNaN(from) || isNaN(end) ? '' : formatElapsed(Math.max(0, end - from));
  });

  readonly waitText = computed(() => {
    const r = this.liveData()?.request;
    if (!this.live() || !r || (r.status !== 'queued' && r.status !== 'claimed')) return null;
    return waitCodeLabel(r.waitCode);
  });

  /** Rodando sem heartbeat há mais de 2 min. */
  readonly quietFor = computed(() => {
    const r = this.liveData()?.request;
    if (!this.running() || r?.status !== 'running' || !r.lastHeartbeatAt) return null;
    const idle = this.now() - Date.parse(r.lastHeartbeatAt);
    return idle > QUIET_MS ? formatElapsed(idle) : null;
  });

  readonly finished = computed(() => {
    const it = this.item();
    if (!it || this.live() || it.status === 'pending') return null;
    const p = this.progress();
    const done = `${p.done} de ${p.total} sub-tarefa${p.total === 1 ? '' : 's'} concluída${p.total === 1 ? '' : 's'}`;
    const prs = this.prs().length;
    const extra = prs ? ` · ${prs} PR${prs > 1 ? 's' : ''} aberto${prs > 1 ? 's' : ''}` : '';
    switch (it.status) {
      case 'completed': return { tone: 'ok', icon: 'task_alt', title: 'Execução concluída', text: done + extra };
      case 'failed': return { tone: 'bad', icon: 'error_outline', title: 'A execução falhou', text: `${done}. Veja o que foi feito abaixo e execute de novo quando quiser.` };
      case 'cancelled': return { tone: 'muted', icon: 'block', title: 'Execução cancelada', text: (it.cancelReason ? `${it.cancelReason} · ` : '') + done };
      case 'reverted': return { tone: 'muted', icon: 'undo', title: 'Execução desfeita', text: 'As sub-tarefas concluídas foram desfeitas.' };
      default: return null;
    }
  });

  readonly canRun = computed(() => { const it = this.item(); return !!it && canExecute(it); });
  readonly canCancelIt = computed(() => { const it = this.item(); return !!it && canCancel(it); });
  readonly canUndoIt = computed(() => { const it = this.item(); return !!it && canUndo(it); });

  private current: number | null = null;
  private itemSeq = 0;
  private liveSeq = 0;
  private lastSignalAt = 0;
  private lastLoadAt = 0;
  private stick = true;
  private feedSize = 0;
  private stopLive: (() => void) | null = null;
  private liveCard: string | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private celebrateTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    registerWorkItemTypeIcons(inject(MatIconRegistry), inject(DomSanitizer));

    effect(() => {
      const n = this.number();
      untracked(() => this.start(n));
    });

    // Tempo real do card do item (o `[card]` ou, sem ele, o card que veio no item).
    effect(() => {
      const card = ((this.card() ?? '') || (this.item()?.cardNumber ?? '')).trim() || null;
      untracked(() => this.listen(card));
    });

    // Arquivos do item (o card do item quando não veio `[card]`).
    effect(() => {
      const n = this.number();
      const card = ((this.card() ?? '') || (this.item()?.cardNumber ?? '')).trim() || null;
      untracked(() => this.files.watch(n, card));
    });
    effect(() => {
      const count = this.files.count();
      const loaded = this.files.loaded();
      untracked(() => {
        if (!loaded) { this.filesSeen = -1; return; }
        if (this.filesSeen >= 0 && count > this.filesSeen) {
          this.filesFlash.set(true);
          if (this.filesFlashTimer) clearTimeout(this.filesFlashTimer);
          this.filesFlashTimer = setTimeout(() => this.filesFlash.set(false), 2400);
        }
        this.filesSeen = count;
      });
    });

    // Feed: rola sozinho só se a pessoa estiver no fim; senão mostra "Novas atividades".
    effect(() => {
      const size = this.feed().length;
      untracked(() => {
        if (size === this.feedSize) return;
        const grew = size > this.feedSize;
        this.feedSize = size;
        if (this.stick) afterNextRender(() => this.scrollToEnd(), { injector: this.injector });
        else if (grew) this.unseen.set(true);
      });
    });

    // Relógio do tempo decorrido + polling de segurança (só enquanto roda e sem evento recente).
    const tick = setInterval(() => {
      if (!this.live()) return;
      const t = Date.now();
      this.now.set(t);
      const hidden = typeof document !== 'undefined' && document.hidden;
      if (!hidden && t - this.lastSignalAt >= POLL_IDLE_MS && t - this.lastLoadAt >= POLL_IDLE_MS) this.reload();
    }, 1000);

    // Pergunta nova/respondida no plano do item (mesmo grupo `execplan:{card}` do tempo real dos itens): relê as perguntas.
    this.ws.on(EXECUTION_PLAN_EVENT, this.onPlanEvent);

    inject(DestroyRef).onDestroy(() => {
      this.ws.off(EXECUTION_PLAN_EVENT, this.onPlanEvent);
      clearInterval(tick);
      this.stopLive?.();
      if (this.flashTimer) clearTimeout(this.flashTimer);
      if (this.celebrateTimer) clearTimeout(this.celebrateTimer);
      if (this.filesFlashTimer) clearTimeout(this.filesFlashTimer);
    });
  }

  // ── carga ────────────────────────────────────────────────────────────────────────────────────

  private start(n: number): void {
    if (n === this.current) return;
    this.current = n;
    this.item.set(null);
    this.liveData.set(null);
    this.error.set(null);
    this.flashed.set(new Set());
    this.celebrate.set(false);
    this.unseen.set(false);
    this.resolveNote.set('');
    this.planQuestions.set([]);
    this.answeredHere.set(new Set());
    this.questionsKey = null;
    this.stick = true;
    this.feedSize = 0;
    if (n) this.reload();
  }

  reload(): void {
    const n = this.current;
    if (!n) return;
    this.lastLoadAt = Date.now();
    this.now.set(Date.now());
    const s1 = ++this.itemSeq;
    this.api.get(n).subscribe({
      next: (it) => {
        if (s1 !== this.itemSeq || n !== this.current) return;
        this.applyItem(it);
        this.error.set(null);
      },
      error: (e) => {
        if (s1 !== this.itemSeq || n !== this.current) return;
        if (!this.item()) this.error.set(e?.message || 'Não foi possível carregar o item.');
      }
    });
    const s2 = ++this.liveSeq;
    this.api.live(n).subscribe({
      next: (l) => {
        if (s2 !== this.liveSeq || n !== this.current) return;
        this.liveData.set(l ? { ...l, recent: l.recent ?? [], logs: l.logs ?? [] } : null);
      },
      // Sem o `/live` (servidor antigo ou falha passageira): a sessão segue só com o item e o histórico dele.
      error: () => {}
    });
  }

  private applyItem(raw: WorkItem): void {
    const it: WorkItem = { ...raw, tasks: (raw.tasks ?? []).slice().sort((a, b) => a.order - b.order), links: raw.links ?? [] };
    const prev = this.item();
    if (prev && prev.number === it.number) {
      const changed = changedTaskNumbers(prev.tasks, it.tasks);
      if (changed.length) {
        this.flashed.set(new Set(changed));
        if (this.flashTimer) clearTimeout(this.flashTimer);
        this.flashTimer = setTimeout(() => this.flashed.set(new Set()), FLASH_MS);
      }
      if (isExecutingItem(prev) && it.status === 'completed') {
        this.celebrate.set(true);
        if (this.celebrateTimer) clearTimeout(this.celebrateTimer);
        this.celebrateTimer = setTimeout(() => this.celebrate.set(false), 2600);
      }
    }
    this.item.set(it);
    this.loadQuestions(it);
    // Sem `/live`: o histórico do próprio item alimenta o feed.
    const l = this.liveData();
    if (!l || (l as { _fallback?: boolean })._fallback) this.liveData.set(this.fallbackLive(it));
    this.itemChange.emit(it);
  }

  /** Item em espera com plano: lê as perguntas do plano (as abertas viram o quadro de respostas da sessão). */
  private loadQuestions(it: WorkItem): void {
    const seq = ++this.questionsSeq;
    if (!it.planId || it.status !== 'waiting') {
      this.questionsKey = null;
      this.planQuestions.set([]);
      this.answeredHere.set(new Set());
      return;
    }
    // Só relê o plano quando o item mudou (o polling de 10 s do item em espera não vira um GET do plano a cada volta).
    const key = `${it.planId}|${it.updatedAt}|${this.waitingLabel()}`;
    if (key === this.questionsKey) return;
    this.questionsKey = key;
    const n = it.number;
    this.plans.get(it.planId).subscribe({
      next: (plan) => {
        if (seq !== this.questionsSeq || n !== this.current) return;
        this.planQuestions.set(plan?.questions ?? []);
      },
      error: () => { if (seq === this.questionsSeq) this.questionsKey = null; }
    });
  }

  private readonly onPlanEvent = (p: ExecutionPlanRealtimePayload): void => {
    const it = this.item();
    if (!it?.planId || p?.planId !== it.planId || p.action !== 'question') return;
    this.questionsKey = null;
    this.loadQuestions(it);
  };

  /** Resposta confirmada: fica à vista com a resposta e o item recarrega (a sub-tarefa sai da espera quando o Claude seguir). */
  onAnswered(q: ExecutionQuestion): void {
    this.answeredHere.update((s) => new Set(s).add(q.id));
    this.planQuestions.update((list) => list.map((x) => (x.id === q.id ? { ...x, ...q } : x)));
    this.reload();
  }

  /** Feed montado só com o item (enquanto o `/live` não chega ou não existe). */
  private fallbackLive(it: WorkItem): WorkItemLive {
    const logs = (it.logs ?? []).slice(-50).map((x) => ({ at: x.at, kind: x.kind, text: x.text, taskNumber: x.taskNumber ?? null }));
    const activity = it.activity ? { label: it.activity, at: it.updatedAt } : null;
    return { number: it.number, status: it.status, request: null, activity, recent: [], logs, executorOnline: true, _fallback: true } as WorkItemLive;
  }

  private listen(card: string | null): void {
    if (card === this.liveCard) return;
    this.stopLive?.();
    this.stopLive = null;
    this.liveCard = card;
    if (!card) return;
    this.stopLive = listenWorkItems(this.ws, card, (p: WorkItemsUpdatedPayload | null) => {
      // Payload nulo = vários eventos juntos ou volta da conexão: recarrega. Senão só o item desta sessão.
      if (p && p.number && Number(p.number) !== this.current) return;
      this.lastSignalAt = Date.now();
      this.reload();
    }, LIVE_DEBOUNCE_MS);
  }

  // ── feed ─────────────────────────────────────────────────────────────────────────────────────

  onFeedScroll(): void {
    const el = this.feedEl()?.nativeElement;
    if (!el) return;
    this.stick = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (this.stick) this.unseen.set(false);
  }

  scrollToEnd(): void {
    const el = this.feedEl()?.nativeElement;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    this.stick = true;
    this.unseen.set(false);
  }

  entryIcon(e: LiveFeedEntry): string {
    if (e.source === 'activity') return activityIcon(e.tool);
    switch (e.kind) {
      case 'error': case 'failed': return 'error_outline';
      case 'status': return 'flag';
      case 'task': return 'checklist';
      case 'undo': return 'undo';
      default: return 'notes';
    }
  }

  ago(at: string | null | undefined): string {
    if (!at) return '';
    const ms = this.now() - Date.parse(at);
    if (isNaN(ms)) return '';
    return ms < 5000 ? 'agora' : `há ${formatElapsed(ms)}`;
  }

  // ── sub-tarefas ──────────────────────────────────────────────────────────────────────────────

  /**
   * "Aguardando você" quando a sub-tarefa é do usuário e chegou a vez dela; com chamado aberto, "Aguardando o chamado";
   * etapa de PR pendente com PR aberto/mesclado mostra o PR no lugar de "Pendente".
   */
  taskLabel(t: WorkTask): string {
    if (t.status === 'waiting' && this.openTicket(t)) return 'Aguardando o chamado';
    if (t.executor === 'user' && (t.status === 'waiting' || (t.status === 'pending' && t.number === this.currentTask()))) return 'Aguardando você';
    if (canResolveWait(t)) return 'Aguardando você';
    return taskPrHint(t) ?? taskStatusLook(t.status).label;
  }

  /** Texto do chip do link: título (ou "Chamado"/"PR"). */
  linkText(l: WorkTaskLink): string {
    return (l.title ?? '').trim() || (l.kind === 'ticket' ? 'Chamado' : l.kind === 'pr' ? 'PR' : 'Link');
  }

  taskIcon(t: WorkTask): string {
    if ((t.executor === 'user' && t.status === 'waiting') || canResolveWait(t)) return 'front_hand';
    return taskStatusLook(t.status).icon;
  }

  /** Ações da sub-tarefa do usuário: em espera/andamento/falha sempre; pendente só quando é a vez dela. */
  userActions(t: WorkTask): WorkTaskAction[] {
    if (t.executor !== 'user') return [];
    if (t.status === 'pending' && t.number !== this.currentTask()) return [];
    return userTaskActions(t);
  }

  openFiles(): void {
    const it = this.item();
    const card = ((this.card() ?? '') || (it?.cardNumber ?? '')).trim();
    if (card) this.actions.openFiles(card, this.number(), it?.title ?? null);
  }

  openTask(item: WorkItem, t: WorkTask): void {
    const card = (this.card() ?? '') || item.cardNumber;
    if (card) this.actions.openTask(card, item, t.number, this.catalog());
  }

  // ── chamado na Bancada ───────────────────────────────────────────────────────────────────────

  startTicket(t: WorkTask): void {
    this.ticketDraft.set({ task: t.number, url: '', title: '' });
  }

  draftField(field: 'url' | 'title', value: string): void {
    const d = this.ticketDraft();
    if (d) this.ticketDraft.set({ ...d, [field]: value ?? '' });
  }

  async saveTicket(t: WorkTask): Promise<void> {
    const d = this.ticketDraft();
    if (!d || d.task !== t.number || !d.url.trim() || this.busyTask() === t.number) return;
    this.busyTask.set(t.number);
    const it = await this.actions.attachTicket(t, d.url.trim(), d.title.trim() || null);
    this.busyTask.set(null);
    if (it) { this.ticketDraft.set(null); this.afterTicket(it); }
  }

  async ticketAct(t: WorkTask, a: TicketAction): Promise<void> {
    if (a === 'attach') { this.startTicket(t); return; }
    this.busyTask.set(t.number);
    const it = await this.actions.setTicketStatus(t, a, currentTicket(t)?.id ?? null);
    this.busyTask.set(null);
    if (it) this.afterTicket(it);
  }

  /** O endpoint devolve o item atualizado: aplica na hora (sem item na resposta, recarrega). */
  private afterTicket(it: WorkItem | null | undefined): void {
    if (it && it.number === this.current && Array.isArray(it.tasks)) this.applyItem(it);
    else this.reload();
  }

  /** "Já resolvi": a sub-tarefa volta a andar e o item entra na fila de novo (item de plano: o "Já resolvi" da etapa). */
  async resolve(t: WorkTask): Promise<void> {
    if (this.busyTask() === t.number) return;
    this.busyTask.set(t.number);
    const it = await this.actions.resolveTask(t, this.resolveNote());
    this.busyTask.set(null);
    if (!it) return;
    this.resolveNote.set('');
    this.afterTicket(it);
  }

  async taskAct(t: WorkTask, a: WorkTaskAction): Promise<void> {
    this.busyTask.set(t.number);
    const ok = await this.actions.taskAction(t, a);
    this.busyTask.set(null);
    if (ok) this.reload();
  }

  // ── ações do item ────────────────────────────────────────────────────────────────────────────

  async execute(): Promise<void> {
    const it = this.item();
    if (!it) return;
    if (await this.act(() => this.actions.execute(it))) {
      this.item.set({ ...it, status: 'queued' });
      this.reload();
    }
  }

  async cancel(): Promise<void> {
    const it = this.item();
    if (it && (await this.act(() => this.actions.cancel(it)))) this.reload();
  }

  async undo(): Promise<void> {
    const it = this.item();
    if (it && (await this.act(() => this.actions.undo(it)))) this.reload();
  }

  private async act(fn: () => Promise<boolean>): Promise<boolean> {
    this.acting.set(true);
    try { return await fn(); } finally { this.acting.set(false); }
  }
}
