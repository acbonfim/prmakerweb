import {
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CliipboardService } from '../../services/cliipboard.service';
import { ExecutionPlanService, planApiError } from '../../services/execution-plan.service';
import { PlanMarkdownPipe } from './plan-markdown.pipe';
import { ExecutionArtifact, ExecutionNote, NoteTargetPlan, PlanPhase, StepStatus } from './execution-plan.model';

/** Mesmos limites da API (10 MB por arquivo, 20 por comentário). */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 20;
/** Comentários visíveis antes do "ver todos" (painel). */
const COLLAPSED_COUNT = 4;
/** "Analisando" vale por este tempo depois da leitura — sem resposta depois disso, fica só "lido". */
const ANALYZING_FOR_MS = 30 * 60 * 1000;

interface PendingFile {
  id: number;
  file: File;
  preview: string | null;
}

/** 0037: comentário enviado e ainda sem confirmação do servidor — a tela já mostra (como as respostas, 0036). */
interface OutgoingNote {
  tempId: number;
  text: string;
  planId: string;
  stepKey: string | null;
  files: PendingFile[];
  /** Id do comentário gravado; some da lista quando o plano recarregado já o traz. */
  confirmedId?: string;
}

/** Para onde vai o comentário: o plano (análise/correção) e, opcionalmente, uma etapa dele. */
interface NoteTarget {
  planId: string;
  stepKey: string | null;
}

/** sent = gravado, o Claude ainda não leu · analyzing = leu há pouco · read = leu · replied = o Claude respondeu depois. */
type ReadState = 'sent' | 'analyzing' | 'read' | 'replied';

/**
 * Comentários e anexos do usuário no plano de execução (0031) — funcionam como prompts para o Claude. Texto +
 * imagens/arquivos (arrastando, colando com Ctrl+V ou pelo ícone de anexo), numerados por card ("comentário #n",
 * "anexo #n"). Duas apresentações (0037): `inline` (seção compacta no painel) e `chat` (a conversa inteira, no popup):
 * envio instantâneo, destino escolhido num menu (plano + etapa) e o status de leitura pelo Claude.
 */
@Component({
  selector: 'app-plan-notes',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule, PlanMarkdownPipe],
  template: `
    @if (isChat()) {
      <!-- ── Conversa (popup) ─────────────────────────────────────────────────────────── -->
      <section class="chat" aria-label="Conversa com o Claude"
               (dragover)="onDragOver($event)" (dragleave)="dropping.set(false)" (drop)="onDrop($event)">
        <div class="chat__scroll" #scroll data-keep-scroll>
          @if (!notes().length && !outgoingVisible().length) {
            <div class="chat__empty">
              <span class="chat__empty-icon"><mat-icon>forum</mat-icon></span>
              <div class="chat__empty-title">Fale com o Claude sobre este card</div>
              <p>Tudo o que você escreve aqui vira entrada da análise: peça para considerar algo, corrija uma hipótese ou
                cole um print (Ctrl+V). Cite <strong>#n</strong> para falar de um comentário ou anexo.</p>
              <div class="chat__chips">
                @for (s of suggestions; track s) {
                  <button type="button" class="chat__chip" (click)="useSuggestion(s)">{{ s }}</button>
                }
              </div>
            </div>
          }

          @for (note of notes(); track note.id; let i = $index) {
            @if (dayLabel(i); as day) { <div class="chat__day"><span>{{ day }}</span></div> }
            <div class="msg" [class.msg--mine]="isMine(note)" [class.msg--claude]="note.fromExecutor"
                 [class.msg--removing]="removing().has(note.id)" [attr.data-note]="note.number">
              @if (!isMine(note)) {
                <span class="msg__avatar" aria-hidden="true"><mat-icon>{{ note.fromExecutor ? 'smart_toy' : 'person' }}</mat-icon></span>
              }
              <div class="msg__col">
                <div class="msg__bubble">
                  <div class="msg__head">
                    <strong>{{ note.fromExecutor ? 'Claude' : isMine(note) ? 'Você' : note.authorName }}</strong>
                    <button type="button" class="note__num" (click)="copyRef('comentário #' + note.number)"
                            matTooltip="Copiar a referência (cite no Claude: comentário #{{ note.number }})">#{{ note.number }}</button>
                    @if (note.stepKey) {
                      <span class="note__tag note__tag--step" [matTooltip]="'Etapa: ' + stepTitle(note.stepKey)">
                        <mat-icon>subdirectory_arrow_right</mat-icon>{{ stepTitle(note.stepKey) }}
                      </span>
                    }
                    @if (note.planId !== planId()) { <span class="note__tag">{{ phaseLabel(note.planPhase) }}</span> }
                    <span class="note__spacer"></span>
                    @if (canChange(note) && editingId() !== note.id && confirmDeleteId() !== note.id && !isChanging(note)) {
                      <span class="msg__actions">
                        <button mat-icon-button class="note__action" (click)="startEdit(note)" matTooltip="Editar" aria-label="Editar"><mat-icon>edit</mat-icon></button>
                        <button mat-icon-button class="note__action" (click)="confirmDeleteId.set(note.id)" matTooltip="Remover" aria-label="Remover"><mat-icon>delete_outline</mat-icon></button>
                      </span>
                    }
                  </div>
                  <ng-container *ngTemplateOutlet="noteBody; context: { $implicit: note }"></ng-container>
                </div>
                <div class="msg__meta">
                  <span [matTooltip]="formatDateTime(note.createdAt)">{{ time(note.createdAt) }}</span>
                  @if (savingEdits()[note.id] !== undefined) {
                    <span class="note__sending"><mat-icon class="note__spin">progress_activity</mat-icon>salvando…</span>
                  } @else if (removing().has(note.id)) {
                    <span class="note__sending"><mat-icon class="note__spin">progress_activity</mat-icon>removendo…</span>
                  } @else if (note.updatedAt) { <span>· editado</span> }
                  @if (isMine(note)) {
                    <mat-icon class="msg__ticks" [class.msg__ticks--read]="isRead(note)"
                              [matTooltip]="isRead(note) ? 'Lido pelo Claude' : 'Enviado — o Claude ainda não leu'">{{ isRead(note) ? 'done_all' : 'done' }}</mat-icon>
                  }
                </div>
                @if (lastMine()?.id === note.id && !outgoingVisible().length && readState() !== 'analyzing') {
                  <ng-container *ngTemplateOutlet="readStatus"></ng-container>
                }
              </div>
            </div>
          }

          @for (o of outgoingVisible(); track o.tempId) {
            <div class="msg msg--mine msg--sending" aria-live="polite">
              <div class="msg__col">
                <div class="msg__bubble">
                  <div class="msg__head">
                    <strong>Você</strong>
                    @if (o.stepKey) { <span class="note__tag note__tag--step"><mat-icon>subdirectory_arrow_right</mat-icon>{{ stepTitle(o.stepKey) }}</span> }
                  </div>
                  <ng-container *ngTemplateOutlet="outgoingBody; context: { $implicit: o }"></ng-container>
                </div>
                <div class="msg__meta">
                  @if (o.confirmedId) {
                    <span class="note__sending note__sending--ok"><mat-icon>check</mat-icon>enviado</span>
                  } @else {
                    <span class="note__sending"><mat-icon class="note__spin">progress_activity</mat-icon>enviando…</span>
                  }
                </div>
              </div>
            </div>
          }

          @if (readState() === 'analyzing' && !outgoingVisible().length) {
            <div class="msg msg--claude msg--typing" aria-live="polite">
              <span class="msg__avatar" aria-hidden="true"><mat-icon>smart_toy</mat-icon></span>
              <div class="msg__col">
                <div class="msg__bubble">
                  <span class="typing"><i></i><i></i><i></i></span>
                  <span class="typing__text">analisando o seu comentário #{{ lastMine()?.number }}…</span>
                </div>
              </div>
            </div>
          }
        </div>

        <ng-container *ngTemplateOutlet="composer"></ng-container>
      </section>
    } @else {
      <!-- ── Seção compacta (painel do plano) ─────────────────────────────────────────── -->
      <section class="notes" aria-label="Comentários e anexos">
        <div class="notes__title">
          <mat-icon>forum</mat-icon>
          Comentários e anexos
          @if (notes().length) { <span class="notes__count">{{ notes().length }}</span> }
          <span class="notes__hint">o Claude considera tudo na análise — cite "anexo #n" ou "comentário #n"</span>
          <span class="note__spacer"></span>
          <button mat-button class="notes__open" (click)="openChat.emit()" matTooltip="Abrir a conversa inteira">
            <mat-icon>open_in_full</mat-icon>Abrir conversa
          </button>
        </div>

        @if (hiddenCount() > 0) {
          <button mat-button class="notes__more" (click)="openChat.emit()">
            <mat-icon>expand_less</mat-icon>Ver os {{ hiddenCount() }} comentários anteriores
          </button>
        }

        @for (note of visibleNotes(); track note.id) {
          <article class="note" [class.note--claude]="note.fromExecutor" [class.note--removing]="removing().has(note.id)" [attr.data-note]="note.number">
            <span class="note__avatar" aria-hidden="true"><mat-icon>{{ note.fromExecutor ? 'smart_toy' : 'person' }}</mat-icon></span>
            <div class="note__main">
              <div class="note__head">
                <strong>{{ note.fromExecutor ? 'Claude' : note.authorName }}</strong>
                <button type="button" class="note__num" (click)="copyRef('comentário #' + note.number)"
                        matTooltip="Copiar a referência (cite no Claude: comentário #{{ note.number }})">#{{ note.number }}</button>
                <span class="note__time" [matTooltip]="formatDateTime(note.createdAt)">{{ relative(note.createdAt) }}</span>
                @if (savingEdits()[note.id] !== undefined) {
                  <span class="note__sending"><mat-icon class="note__spin">progress_activity</mat-icon>salvando…</span>
                } @else if (removing().has(note.id)) {
                  <span class="note__sending"><mat-icon class="note__spin">progress_activity</mat-icon>removendo…</span>
                } @else if (note.updatedAt) { <span class="note__tag">editado</span> }
                @if (note.planId !== planId()) { <span class="note__tag">{{ phaseLabel(note.planPhase) }}</span> }
                @if (note.stepKey) {
                  <span class="note__tag note__tag--step" [matTooltip]="'Etapa: ' + stepTitle(note.stepKey)">
                    <mat-icon>subdirectory_arrow_right</mat-icon>{{ stepTitle(note.stepKey) }}
                  </span>
                }
                <span class="note__spacer"></span>
                @if (canChange(note) && editingId() !== note.id && confirmDeleteId() !== note.id && !isChanging(note)) {
                  <button mat-icon-button class="note__action" (click)="startEdit(note)" matTooltip="Editar" aria-label="Editar"><mat-icon>edit</mat-icon></button>
                  <button mat-icon-button class="note__action" (click)="confirmDeleteId.set(note.id)" matTooltip="Remover" aria-label="Remover"><mat-icon>delete_outline</mat-icon></button>
                }
              </div>
              <ng-container *ngTemplateOutlet="noteBody; context: { $implicit: note }"></ng-container>
              @if (lastMine()?.id === note.id && !outgoingVisible().length) {
                <ng-container *ngTemplateOutlet="readStatus"></ng-container>
              }
            </div>
          </article>
        }

        @for (o of outgoingVisible(); track o.tempId) {
          <article class="note note--sending" aria-live="polite">
            <span class="note__avatar" aria-hidden="true"><mat-icon>person</mat-icon></span>
            <div class="note__main">
              <div class="note__head">
                <strong>Você</strong>
                @if (o.confirmedId) {
                  <span class="note__sending note__sending--ok"><mat-icon>check</mat-icon>enviado</span>
                } @else {
                  <span class="note__sending"><mat-icon class="note__spin">progress_activity</mat-icon>enviando…</span>
                }
                @if (o.stepKey) { <span class="note__tag note__tag--step"><mat-icon>subdirectory_arrow_right</mat-icon>{{ stepTitle(o.stepKey) }}</span> }
              </div>
              <ng-container *ngTemplateOutlet="outgoingBody; context: { $implicit: o }"></ng-container>
            </div>
          </article>
        }

        <ng-container *ngTemplateOutlet="composer"></ng-container>
      </section>
    }

    <!-- Corpo do comentário: confirmação de remoção, edição, texto e anexos. -->
    <ng-template #noteBody let-note>
      @if (confirmDeleteId() === note.id) {
        <div class="note__confirm">
          Remover o comentário #{{ note.number }}{{ note.attachments.length ? ' e os anexos' : '' }}?
          <button mat-button (click)="confirmDeleteId.set(null)">Não</button>
          <button mat-flat-button color="warn" (click)="remove(note)">Remover</button>
        </div>
      }
      @if (editingId() === note.id) {
        <textarea class="notes__input notes__input--edit" [(ngModel)]="editText" rows="3" (keydown)="onEditKey($event, note)"></textarea>
        <div class="note__edit-actions">
          <button mat-button (click)="editingId.set(null)">Cancelar</button>
          <button mat-flat-button color="primary" (click)="saveEdit(note)" [disabled]="!editText.trim()">Salvar</button>
        </div>
      } @else if (savingEdits()[note.id] ?? note.text; as shown) {
        <div class="note__text plan-md" [innerHTML]="shown | planMarkdown"></div>
      }
      @if (note.attachments.length) {
        <div class="note__files">
          @for (a of note.attachments; track a.id) {
            @if (a.kind === 'image') {
              <button type="button" class="note__thumb" (click)="open(a)" [matTooltip]="'anexo #' + a.number + ' — ' + a.name + ' (' + size(a.size) + ')'">
                @if (thumbs()[a.id]; as src) { <img [src]="src" [alt]="a.name" /> } @else { <mat-icon>image</mat-icon> }
                <span class="note__badge">#{{ a.number }}</span>
              </button>
            } @else {
              <button type="button" class="note__file" (click)="open(a)" [matTooltip]="'anexo #' + a.number + ' — ' + size(a.size)">
                <mat-icon>{{ fileIcon(a) }}</mat-icon>
                <span class="note__file-num">#{{ a.number }}</span>
                <span class="note__file-name">{{ a.name }}</span>
              </button>
            }
          }
        </div>
      }
    </ng-template>

    <ng-template #outgoingBody let-o>
      @if (o.text) { <div class="note__text plan-md" [innerHTML]="o.text | planMarkdown"></div> }
      @if (o.files.length) {
        <div class="note__files">
          @for (f of o.files; track f.id) {
            @if (f.preview) {
              <span class="note__thumb note__thumb--sending"><img [src]="f.preview" [alt]="f.file.name" /></span>
            } @else {
              <span class="note__file"><mat-icon>{{ pendingIcon(f.file) }}</mat-icon><span class="note__file-name">{{ f.file.name }}</span></span>
            }
          }
        </div>
      }
    </ng-template>

    <!-- 0037: o que o Claude fez com o seu último comentário. -->
    <ng-template #readStatus>
      @switch (readState()) {
        @case ('sent') {
          <div class="read read--sent">
            <mat-icon>schedule</mat-icon>
            <span>Enviado · aguardando o Claude ler{{ claudeOnline() ? ' (ele confere o plano em até 1 min)' : ' — sem sessão do Claude ativa agora: ele lê quando voltar ao card' }}</span>
          </div>
        }
        @case ('analyzing') {
          <div class="read read--analyzing">
            <span class="typing typing--small"><i></i><i></i><i></i></span>
            <span>O Claude leu{{ notesReadAt() ? ' às ' + time(notesReadAt()!) : '' }} e está analisando</span>
          </div>
        }
        @case ('read') {
          <div class="read read--read"><mat-icon>done_all</mat-icon><span>Lido pelo Claude{{ notesReadAt() ? ' em ' + formatDateTime(notesReadAt()!) : '' }}</span></div>
        }
        @case ('replied') {
          <div class="read read--read"><mat-icon>reply</mat-icon><span>O Claude respondeu</span></div>
        }
      }
    </ng-template>

    <!-- Destino do comentário: plano (análise/correção) e etapa. -->
    <ng-template #targetPicker>
      <button type="button" class="target" [matMenuTriggerFor]="targetMenu" [matTooltip]="'O comentário vai para: ' + targetLabel()">
        <mat-icon class="target__icon">{{ target().stepKey ? 'subdirectory_arrow_right' : 'account_tree' }}</mat-icon>
        <span class="target__text">
          <span class="target__plan">{{ targetPlanLabel() }}</span>
          <span class="target__step">{{ targetStepLabel() }}</span>
        </span>
        <mat-icon class="target__caret">expand_more</mat-icon>
      </button>
      <mat-menu #targetMenu="matMenu" class="note-target-menu" xPosition="after">
        @for (plan of targetPlans(); track plan.planId) {
          <div class="tm__group" (click)="$event.stopPropagation()">
            <mat-icon>{{ plan.phase === 'correction' ? 'build' : 'travel_explore' }}</mat-icon>
            {{ plan.phase === 'correction' ? 'Plano de correção' : 'Plano de análise' }}
            @if (plan.current) { <span class="tm__current">em tela</span> }
          </div>
          <button mat-menu-item class="tm__item" [class.tm__item--on]="isTarget(plan.planId, null)" (click)="chooseTarget(plan.planId, null)">
            <span class="tm__num tm__num--plan"><mat-icon>account_tree</mat-icon></span>
            <span class="tm__label">Plano inteiro <small>comentário geral</small></span>
            @if (isTarget(plan.planId, null)) { <span class="tm__check"><mat-icon>check</mat-icon></span> }
          </button>
          @for (s of plan.steps; track s.key; let n = $index) {
            <button mat-menu-item class="tm__item" [class.tm__item--on]="isTarget(plan.planId, s.key)" (click)="chooseTarget(plan.planId, s.key)">
              <span class="tm__num tm__num--{{ s.status }}">
                @if (stepStatusIcon(s.status); as ic) { <mat-icon>{{ ic }}</mat-icon> } @else { {{ n + 1 }} }
              </span>
              <span class="tm__label">{{ s.title }} <small>{{ stepStatusLabel(s.status) }}</small></span>
              @if (isTarget(plan.planId, s.key)) { <span class="tm__check"><mat-icon>check</mat-icon></span> }
            </button>
          }
        }
      </mat-menu>
    </ng-template>

    <ng-template #composer>
      <div class="composer" [class.composer--chat]="isChat()" [class.composer--drop]="dropping()" [class.composer--focus]="composerFocus()"
           (dragover)="onDragOver($event)" (dragleave)="dropping.set(false)" (drop)="onDrop($event)">
        @if (isChat()) {
          <div class="composer__to"><span>Para</span><ng-container *ngTemplateOutlet="targetPicker"></ng-container></div>
        }
        <textarea #input class="notes__input" [(ngModel)]="text" [rows]="isChat() ? 1 : 2"
                  [placeholder]="isChat() ? 'Escreva para o Claude… (cole um print com Ctrl+V)' : 'Comente, cole uma imagem (Ctrl+V) ou arraste arquivos para cá…'"
                  (paste)="onPaste($event)" (keydown)="onKey($event)" (input)="autosize()"
                  (focus)="composerFocus.set(true)" (blur)="composerFocus.set(false)"></textarea>

        @if (pending().length) {
          <div class="composer__pending">
            @for (p of pending(); track p.id) {
              <span class="composer__file" [matTooltip]="p.file.name + ' (' + size(p.file.size) + ')'">
                @if (p.preview) { <img [src]="p.preview" alt="" /> } @else { <mat-icon>{{ pendingIcon(p.file) }}</mat-icon> }
                <span class="composer__file-name">{{ p.file.name }}</span>
                <button type="button" class="composer__remove" (click)="removePending(p)" aria-label="Remover anexo"><mat-icon>close</mat-icon></button>
              </span>
            }
          </div>
        }

        <div class="composer__bar">
          <input #picker type="file" multiple hidden (change)="onPick($event)" />
          <button mat-icon-button (click)="picker.click()" matTooltip="Anexar imagens ou arquivos" aria-label="Anexar"><mat-icon>attach_file</mat-icon></button>
          @if (!isChat()) { <ng-container *ngTemplateOutlet="targetPicker"></ng-container> }
          <span class="composer__spacer"></span>
          <span class="composer__keys">{{ isChat() ? 'Enter envia · Shift+Enter quebra a linha' : 'Ctrl+Enter envia' }}</span>
          @if (isChat()) {
            <button mat-fab extended class="composer__send" [class.composer__send--fly]="flying()" (click)="send()" [disabled]="!canSend()" aria-label="Enviar">
              <mat-icon>send</mat-icon>Enviar
            </button>
          } @else {
            <button mat-flat-button color="primary" (click)="send()" [disabled]="!canSend()">
              @if (sendingCount()) { <mat-icon class="note__spin">progress_activity</mat-icon> } @else { <mat-icon>send</mat-icon> }
              Comentar
            </button>
          }
        </div>
        @if (dropping()) {
          <div class="composer__overlay"><mat-icon>upload_file</mat-icon>Solte para anexar ao comentário</div>
        }
      </div>
    </ng-template>
  `,
  styles: [`
    :host { display: block; }
    :host(.plan-notes--chat) { height: 100%; min-height: 0; }

    /* ── Seção compacta ── */
    .notes { margin: 14px 0 6px; padding-top: 12px; border-top: 1px solid var(--plan-line, rgba(255,255,255,.1)); }
    .notes__title { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; letter-spacing: .02em;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 80%, transparent); margin-bottom: 8px; flex-wrap: wrap; }
    .notes__title .mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--mat-sys-primary); }
    .notes__count { font-size: 11px; padding: 0 6px; border-radius: 9px; background: color-mix(in srgb, var(--mat-sys-primary) 22%, transparent); }
    .notes__hint { font-weight: 400; font-size: 11px; color: var(--plan-muted, #888); }
    .notes__open { font-size: 12px; height: 28px; }
    .notes__open .mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .notes__more { font-size: 12px; margin-bottom: 4px; }

    .note { display: flex; gap: 8px; padding: 8px 6px; border-radius: 8px; animation: note-in .25s ease-out; }
    .note:hover { background: rgba(255,255,255,.025); }
    .note__avatar { flex: none; width: 26px; height: 26px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
      background: color-mix(in srgb, var(--mat-sys-on-surface) 12%, transparent); }
    .note__avatar .mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .note--claude .note__avatar { background: color-mix(in srgb, var(--mat-sys-primary) 25%, transparent); color: var(--mat-sys-primary); }
    .note__main { flex: 1; min-width: 0; }
    .note__head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; min-height: 26px; }
    .note__num { border: none; cursor: pointer; font: inherit; font-size: 11px; font-weight: 600; padding: 0 6px; border-radius: 9px;
      color: var(--mat-sys-primary); background: color-mix(in srgb, var(--mat-sys-primary) 14%, transparent); }
    .note__time { color: var(--plan-muted, #888); font-size: 11px; }
    .note__tag { display: inline-flex; align-items: center; gap: 2px; font-size: 10.5px; padding: 0 6px; border-radius: 9px;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 70%, transparent); background: rgba(255,255,255,.06); max-width: 220px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .note__tag .mat-icon { font-size: 12px; width: 12px; height: 12px; }
    .note__spacer { flex: 1; }
    .note__action.mat-mdc-icon-button { width: 26px; height: 26px; padding: 3px; opacity: .6; }
    .note__action.mat-mdc-icon-button:hover { opacity: 1; }
    .note__action .mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .note__text { font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
    .note__text :first-child { margin-top: 2px; }
    .note__text :last-child { margin-bottom: 0; }
    .note__confirm { display: flex; align-items: center; gap: 6px; font-size: 12px; margin: 4px 0; flex-wrap: wrap; }
    .note__edit-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 4px; }
    .note--sending { background: color-mix(in srgb, var(--mat-sys-primary) 6%, transparent); }
    .note--sending .note__text { opacity: .85; }
    .note--removing, .msg--removing { opacity: .45; transition: opacity .2s; }
    .note__sending { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; color: var(--mat-sys-primary); }
    .note__sending .mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .note__sending--ok { color: #3fb950; }
    .note__spin { animation: note-spin .9s linear infinite; }

    .note__files { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .note__thumb { position: relative; width: 96px; height: 72px; padding: 0; border-radius: 6px; overflow: hidden; cursor: zoom-in;
      border: 1px solid rgba(255,255,255,.12); background: rgba(0,0,0,.25); display: inline-flex; align-items: center; justify-content: center;
      color: var(--plan-muted, #888); transition: transform .15s, border-color .15s; }
    .note__thumb:hover { transform: translateY(-1px); border-color: var(--mat-sys-primary); }
    .note__thumb img { width: 100%; height: 100%; object-fit: cover; }
    .note__thumb--sending { cursor: default; opacity: .8; }
    .note__badge { position: absolute; left: 4px; bottom: 4px; font-size: 10px; font-weight: 700; padding: 0 5px; border-radius: 8px;
      background: rgba(0,0,0,.7); color: #fff; }
    .note__file { display: inline-flex; align-items: center; gap: 4px; max-width: 260px; height: 28px; padding: 0 10px 0 6px; cursor: pointer;
      border-radius: 14px; border: 1px solid rgba(255,255,255,.14); background: transparent; color: inherit; font: inherit; font-size: 12px; }
    .note__file:hover { border-color: var(--mat-sys-primary); }
    .note__file .mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--mat-sys-primary); }
    .note__file-num { font-weight: 700; font-size: 11px; }
    .note__file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* Status de leitura do último comentário */
    .read { display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; padding: 3px 10px 3px 8px; border-radius: 12px;
      font-size: 11.5px; animation: note-in .25s ease-out; }
    .read .mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .read--sent { color: color-mix(in srgb, var(--mat-sys-on-surface) 65%, transparent); background: rgba(255,255,255,.05); }
    .read--analyzing { color: var(--mat-sys-primary); background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent); }
    .read--read { color: #3fb950; background: color-mix(in srgb, #3fb950 10%, transparent); }

    .typing { display: inline-flex; gap: 3px; align-items: center; }
    .typing i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .35; animation: typing 1.2s infinite ease-in-out; }
    .typing i:nth-child(2) { animation-delay: .15s; }
    .typing i:nth-child(3) { animation-delay: .3s; }
    .typing--small i { width: 4px; height: 4px; }

    /* Destino (plano + etapa) */
    .target { display: inline-flex; align-items: center; gap: 6px; max-width: 320px; height: 30px; padding: 0 6px 0 8px; cursor: pointer;
      border-radius: 15px; border: 1px solid color-mix(in srgb, var(--mat-sys-primary) 35%, transparent);
      background: color-mix(in srgb, var(--mat-sys-primary) 8%, transparent); color: inherit; font: inherit; transition: background .15s, border-color .15s; }
    .target:hover { background: color-mix(in srgb, var(--mat-sys-primary) 16%, transparent); border-color: var(--mat-sys-primary); }
    .target__icon { font-size: 16px; width: 16px; height: 16px; color: var(--mat-sys-primary); flex: none; }
    .target__text { display: inline-flex; align-items: baseline; gap: 5px; min-width: 0; font-size: 12px; }
    .target__plan { font-weight: 600; white-space: nowrap; }
    .target__step { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: color-mix(in srgb, var(--mat-sys-on-surface) 75%, transparent); }
    .target__caret { font-size: 18px; width: 18px; height: 18px; flex: none; opacity: .7; }

    /* Compositor */
    .composer { position: relative; margin-top: 8px; padding: 8px; border-radius: 10px; border: 1px solid rgba(255,255,255,.1);
      background: rgba(0,0,0,.18); transition: border-color .15s, background .15s, box-shadow .15s; }
    .composer:focus-within { border-color: color-mix(in srgb, var(--mat-sys-primary) 60%, transparent); }
    .composer--drop { border-color: var(--mat-sys-primary); border-style: dashed; background: color-mix(in srgb, var(--mat-sys-primary) 8%, transparent); }
    .notes__input { width: 100%; box-sizing: border-box; resize: vertical; min-height: 40px; max-height: 260px; border: none; outline: none;
      background: transparent; color: inherit; font: inherit; font-size: 13px; line-height: 1.45; }
    .notes__input--edit { border: 1px solid rgba(255,255,255,.14); border-radius: 6px; padding: 6px 8px; margin-top: 4px; }
    .composer__pending { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0; }
    .composer__file { display: inline-flex; align-items: center; gap: 6px; max-width: 220px; height: 34px; padding: 0 2px 0 3px; border-radius: 8px;
      background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); font-size: 12px; animation: note-in .2s ease-out; }
    .composer__file img { width: 28px; height: 28px; object-fit: cover; border-radius: 5px; }
    .composer__file .mat-icon { font-size: 18px; width: 18px; height: 18px; margin-left: 4px; color: var(--mat-sys-primary); }
    .composer__file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .composer__remove { border: none; background: transparent; color: inherit; cursor: pointer; display: inline-flex; padding: 2px; border-radius: 50%; opacity: .7; }
    .composer__remove:hover { opacity: 1; background: rgba(255,255,255,.08); }
    .composer__remove .mat-icon { font-size: 15px; width: 15px; height: 15px; margin: 0; color: inherit; }
    .composer__bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .composer__spacer { flex: 1; }
    .composer__keys { font-size: 11px; color: var(--plan-muted, #888); }
    .composer__overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 8px; border-radius: 10px;
      pointer-events: none; font-size: 13px; font-weight: 600; color: var(--mat-sys-primary);
      background: color-mix(in srgb, var(--surface-1, #2a2a2a) 80%, transparent); }

    /* ── Conversa (popup) ── */
    .chat { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; }
    .chat__scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 18px 22px 10px; scroll-behavior: smooth; }
    .chat__empty { max-width: 520px; margin: 8vh auto 0; text-align: center; animation: note-in .35s ease-out; }
    .chat__empty-icon { display: inline-flex; width: 56px; height: 56px; border-radius: 18px; align-items: center; justify-content: center;
      background: linear-gradient(135deg, color-mix(in srgb, var(--mat-sys-primary) 35%, transparent), color-mix(in srgb, var(--mat-sys-primary) 8%, transparent));
      color: var(--mat-sys-primary); margin-bottom: 12px; }
    .chat__empty-icon .mat-icon { font-size: 28px; width: 28px; height: 28px; }
    .chat__empty-title { font-size: 16px; font-weight: 600; margin-bottom: 6px; }
    .chat__empty p { font-size: 13px; line-height: 1.5; color: color-mix(in srgb, var(--mat-sys-on-surface) 68%, transparent); }
    .chat__chips { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-top: 12px; }
    .chat__chip { border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.03); color: inherit; font: inherit; font-size: 12px;
      padding: 6px 12px; border-radius: 16px; cursor: pointer; transition: border-color .15s, background .15s, transform .15s; }
    .chat__chip:hover { border-color: var(--mat-sys-primary); background: color-mix(in srgb, var(--mat-sys-primary) 10%, transparent); transform: translateY(-1px); }
    .chat__day { display: flex; align-items: center; gap: 10px; margin: 14px 0 10px; font-size: 11px; color: var(--plan-muted, #888); }
    .chat__day::before, .chat__day::after { content: ''; flex: 1; height: 1px; background: rgba(255,255,255,.07); }

    .msg { display: flex; gap: 10px; align-items: flex-end; margin: 8px 0; animation: msg-in .28s cubic-bezier(.2, 0, 0, 1); }
    .msg--mine { justify-content: flex-end; }
    .msg__avatar { flex: none; width: 32px; height: 32px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
      background: color-mix(in srgb, var(--mat-sys-on-surface) 12%, transparent); margin-bottom: 18px; }
    .msg__avatar .mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .msg--claude .msg__avatar { color: var(--mat-sys-primary);
      background: linear-gradient(135deg, color-mix(in srgb, var(--mat-sys-primary) 40%, transparent), color-mix(in srgb, var(--mat-sys-primary) 12%, transparent)); }
    .msg__col { display: flex; flex-direction: column; max-width: min(640px, 78%); min-width: 0; }
    .msg--mine .msg__col { align-items: flex-end; }
    .msg__bubble { position: relative; padding: 9px 13px 10px; border-radius: 16px 16px 16px 4px; min-width: 120px; max-width: 100%; box-sizing: border-box;
      background: var(--surface-2, #323232); border: 1px solid rgba(255,255,255,.06); }
    .msg--mine .msg__bubble { border-radius: 16px 16px 4px 16px;
      background: color-mix(in srgb, var(--mat-sys-primary) 20%, var(--surface-2, #323232));
      border-color: color-mix(in srgb, var(--mat-sys-primary) 38%, transparent); }
    .msg--claude .msg__bubble { border-color: color-mix(in srgb, var(--mat-sys-primary) 28%, transparent);
      box-shadow: inset 3px 0 0 color-mix(in srgb, var(--mat-sys-primary) 70%, transparent); }
    .msg--sending .msg__bubble { animation: sending 1.4s ease-in-out infinite; }
    .msg__head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; margin-bottom: 3px; }
    .msg__actions { display: inline-flex; opacity: 0; transition: opacity .15s; }
    .msg:hover .msg__actions { opacity: 1; }
    .msg__meta { display: flex; align-items: center; gap: 4px; margin-top: 3px; padding: 0 4px; font-size: 10.5px; color: var(--plan-muted, #888); }
    .msg__ticks { font-size: 15px; width: 15px; height: 15px; }
    .msg__ticks--read { color: var(--mat-sys-primary); }
    .msg--typing .msg__bubble { display: inline-flex; align-items: center; gap: 8px; color: var(--mat-sys-primary); font-size: 12.5px; }
    .typing__text { color: color-mix(in srgb, var(--mat-sys-on-surface) 75%, transparent); }

    .composer--chat { margin: 0; border-radius: 0 0 14px 14px; border: none; border-top: 1px solid rgba(255,255,255,.08);
      background: var(--surface-2, #323232); padding: 10px 16px 12px; }
    .composer--chat.composer--focus { box-shadow: inset 0 2px 0 color-mix(in srgb, var(--mat-sys-primary) 70%, transparent); }
    .composer--chat .notes__input { resize: none; min-height: 44px; max-height: 200px; font-size: 14px; padding: 10px 12px; border-radius: 12px;
      background: rgba(0,0,0,.22); border: 1px solid rgba(255,255,255,.08); transition: border-color .15s; }
    .composer--chat .notes__input:focus { border-color: color-mix(in srgb, var(--mat-sys-primary) 60%, transparent); }
    .composer__to { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 11.5px; color: var(--plan-muted, #888); }
    .composer--chat .composer__bar { margin-top: 8px; }
    .composer__send { height: 40px !important; transition: transform .2s; }
    .composer__send .mat-icon { transition: transform .35s cubic-bezier(.2, 0, 0, 1), opacity .35s; }
    .composer__send--fly .mat-icon { transform: translate(14px, -10px) rotate(-20deg); opacity: 0; }

    /* Menu de destino (abre no overlay do CDK). */
    ::ng-deep .note-target-menu { min-width: 300px !important; max-width: 420px !important; }
    ::ng-deep .note-target-menu .tm__group { display: flex; align-items: center; gap: 6px; padding: 10px 16px 4px; font-size: 11px; font-weight: 600;
      letter-spacing: .04em; text-transform: uppercase; color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent); }
    ::ng-deep .note-target-menu .tm__group .mat-icon { font-size: 15px; width: 15px; height: 15px; color: var(--mat-sys-primary); }
    ::ng-deep .note-target-menu .tm__current { margin-left: auto; text-transform: none; letter-spacing: 0; font-weight: 500; font-size: 10.5px;
      padding: 0 7px; border-radius: 9px; color: var(--mat-sys-primary); background: color-mix(in srgb, var(--mat-sys-primary) 14%, transparent); }
    ::ng-deep .note-target-menu .tm__item.mat-mdc-menu-item { min-height: 40px; }
    ::ng-deep .note-target-menu .tm__item .mat-mdc-menu-item-text { display: flex; align-items: center; gap: 10px; width: 100%; }
    ::ng-deep .note-target-menu .tm__item--on { background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent); }
    ::ng-deep .note-target-menu .tm__label { flex: 1; min-width: 0; display: flex; flex-direction: column; font-size: 13px; line-height: 1.25;
      overflow: hidden; }
    ::ng-deep .note-target-menu .tm__label small { font-size: 11px; color: color-mix(in srgb, var(--mat-sys-on-surface) 50%, transparent); }
    ::ng-deep .note-target-menu .tm__num { flex: none; width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center;
      justify-content: center; font-size: 11px; font-weight: 700; border: 1.5px solid rgba(255,255,255,.25); }
    ::ng-deep .note-target-menu .tm__num .mat-icon { font-size: 14px; width: 14px; height: 14px; margin: 0; }
    ::ng-deep .note-target-menu .tm__num--completed { background: #3fb950; border-color: #3fb950; color: #0d1117; }
    ::ng-deep .note-target-menu .tm__num--running { border-color: var(--mat-sys-primary); color: var(--mat-sys-primary); }
    ::ng-deep .note-target-menu .tm__num--waiting { border-color: #d29922; color: #d29922; border-style: dotted; }
    ::ng-deep .note-target-menu .tm__num--cancelled { opacity: .5; border-style: dashed; }
    ::ng-deep .note-target-menu .tm__num--failed { background: #f0716a; border-color: #f0716a; color: #0d1117; }
    ::ng-deep .note-target-menu .tm__check { display: inline-flex; color: var(--mat-sys-primary); }
    ::ng-deep .note-target-menu .tm__check .mat-icon { margin: 0; font-size: 18px; width: 18px; height: 18px; }
    ::ng-deep .note-target-menu .tm__num--plan { border: none; color: var(--mat-sys-primary); }

    @keyframes note-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    @keyframes msg-in { from { opacity: 0; transform: translateY(10px) scale(.98); } to { opacity: 1; transform: none; } }
    @keyframes note-spin { to { transform: rotate(360deg); } }
    @keyframes typing { 0%, 80%, 100% { opacity: .3; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }
    @keyframes sending { 0%, 100% { opacity: 1; } 50% { opacity: .72; } }
    @media (prefers-reduced-motion: reduce) {
      .note, .msg, .read, .chat__empty, .note__spin, .typing i, .msg--sending .msg__bubble, .composer__send .mat-icon { animation: none !important; transition: none !important; }
    }
  `],
  host: { '[class.plan-notes--chat]': 'isChat()' }
})
export class PlanNotesComponent implements OnDestroy {
  private api = inject(ExecutionPlanService);
  private snackBar = inject(MatSnackBar);
  private clipboard = inject(CliipboardService);

  /** Plano em tela (onde os comentários novos são gravados por padrão). */
  readonly planId = input.required<string>();
  readonly planPhase = input<PlanPhase>('analysis');
  readonly notes = input<ExecutionNote[]>([]);
  readonly steps = input<{ key: string; title: string; status?: StepStatus }[]>([]);
  /** Etapa aberta no plano — padrão do destino do comentário. */
  readonly selectedStepKey = input<string | null>(null);
  readonly currentUserId = input<string | null>(null);
  /** 0037: `inline` (seção do painel) ou `chat` (a conversa inteira, no popup). */
  readonly variant = input<'inline' | 'chat'>('inline');
  /** Planos para onde o comentário pode ir (o em tela e o outro da dupla análise/correção). Vazio = só o em tela. */
  readonly targets = input<NoteTargetPlan[]>([]);
  /** Até qual comentário a skill leu e quando (0037). */
  readonly notesReadNumber = input<number | null | undefined>(null);
  readonly notesReadAt = input<string | null | undefined>(null);
  /** Plano ativo e sessão do Claude dando sinal (para o texto do status). */
  readonly planActive = input(false);
  readonly claudeOnline = input(false);

  /** Algo mudou (comentário criado/editado/removido) — o plano recarrega. */
  readonly changed = output<void>();
  /** Abrir um arquivo do plano em tela no visualizador de arquivos. */
  readonly openArtifact = output<ExecutionArtifact>();
  /** "Abrir conversa" na seção do painel. */
  readonly openChat = output<void>();

  @ViewChild('input') private inputRef?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('scroll') private scrollRef?: ElementRef<HTMLDivElement>;

  readonly isChat = computed(() => this.variant() === 'chat');
  readonly suggestions = [
    'Considere também o ambiente de QA',
    'Veja o print que vou colar a seguir',
    'O usuário afetado é outro: …',
    'Pode seguir sem o banco desta vez'
  ];

  text = '';
  editText = '';
  readonly pending = signal<PendingFile[]>([]);
  /** 0037: comentários a caminho do servidor, edições salvando e remoções em andamento (feedback na hora). */
  readonly outgoing = signal<OutgoingNote[]>([]);
  readonly savingEdits = signal<Partial<Record<string, string>>>({});
  readonly removing = signal<ReadonlySet<string>>(new Set());
  readonly sendingCount = computed(() => this.outgoing().filter((o) => !o.confirmedId).length);
  /** Enviados que o plano recarregado ainda não trouxe (os confirmados saem quando chegam em `notes`). */
  readonly outgoingVisible = computed(() => {
    const ids = new Set(this.notes().map((n) => n.id));
    return this.outgoing().filter((o) => !o.confirmedId || !ids.has(o.confirmedId));
  });
  readonly dropping = signal(false);
  readonly composerFocus = signal(false);
  readonly flying = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly confirmDeleteId = signal<string | null>(null);
  readonly thumbs = signal<Record<string, string>>({});
  private readonly now = signal(Date.now());

  // ── Destino ────────────────────────────────────────────────────────────────────────────────────

  readonly targetPlans = computed<NoteTargetPlan[]>(() => {
    const list = this.targets();
    if (list.length) return list;
    return [{ planId: this.planId(), phase: this.planPhase(), title: '', current: true,
      steps: this.steps().map((s) => ({ key: s.key, title: s.title, status: s.status ?? 'pending' })) }];
  });
  /** undefined = segue a etapa aberta no plano em tela. */
  private readonly targetOverride = signal<NoteTarget | undefined>(undefined);
  readonly target = computed<NoteTarget>(() => {
    const chosen = this.targetOverride();
    if (chosen && this.targetPlans().some((p) => p.planId === chosen.planId)) return chosen;
    const key = this.selectedStepKey();
    const current = this.targetPlans().find((p) => p.planId === this.planId());
    return { planId: this.planId(), stepKey: key && current?.steps.some((s) => s.key === key) ? key : null };
  });
  private readonly targetPlan = computed(() => this.targetPlans().find((p) => p.planId === this.target().planId) ?? this.targetPlans()[0]);
  readonly targetPlanLabel = computed(() => (this.targetPlan()?.phase === 'correction' ? 'Correção' : 'Análise'));
  readonly targetStepLabel = computed(() => {
    const key = this.target().stepKey;
    if (!key) return '· plano inteiro';
    const steps = this.targetPlan()?.steps ?? [];
    const i = steps.findIndex((s) => s.key === key);
    return i < 0 ? `· ${key}` : `· ${i + 1}. ${steps[i].title}`;
  });
  readonly targetLabel = computed(() => `${this.targetPlanLabel()} ${this.targetStepLabel()}`.replace(' · ', ' — '));

  isTarget(planId: string, stepKey: string | null): boolean {
    const t = this.target();
    return t.planId === planId && t.stepKey === stepKey;
  }

  chooseTarget(planId: string, stepKey: string | null): void {
    this.targetOverride.set({ planId, stepKey });
    this.focus();
  }

  stepStatusIcon(status: StepStatus): string | null {
    return ({ completed: 'check', running: 'play_arrow', waiting: 'hourglass_top', failed: 'priority_high', cancelled: 'block' } as Record<string, string>)[status] ?? null;
  }

  stepStatusLabel(status: StepStatus): string {
    return ({ pending: 'pendente', running: 'em andamento', waiting: 'aguardando', completed: 'concluída', failed: 'falhou', cancelled: 'cancelada' } as Record<string, string>)[status] ?? status;
  }

  // ── Leitura pelo Claude ────────────────────────────────────────────────────────────────────────

  /** Último comentário do usuário logado (sem login conhecido: o último de uma pessoa). */
  readonly lastMine = computed<ExecutionNote | null>(() => {
    const me = this.currentUserId()?.toLowerCase();
    const list = this.notes();
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      if (!n.fromExecutor && (!me || n.authorUserId?.toLowerCase() === me)) return n;
    }
    return null;
  });

  readonly readState = computed<ReadState | null>(() => {
    const last = this.lastMine();
    if (!last) return null;
    if (this.notes().some((n) => n.fromExecutor && n.number > last.number)) return 'replied';
    const read = this.notesReadNumber();
    if (read == null || read < last.number) return 'sent';
    const at = this.notesReadAt();
    const recent = !!at && this.now() - Date.parse(at) < ANALYZING_FOR_MS;
    return this.planActive() && recent ? 'analyzing' : 'read';
  });

  isRead(note: ExecutionNote): boolean {
    const read = this.notesReadNumber();
    return read != null && read >= note.number;
  }

  isMine(note: ExecutionNote): boolean {
    const me = this.currentUserId()?.toLowerCase();
    return !note.fromExecutor && !!me && note.authorUserId?.toLowerCase() === me;
  }

  // ── Lista ──────────────────────────────────────────────────────────────────────────────────────

  readonly visibleNotes = computed(() => {
    const all = this.notes();
    return all.length <= COLLAPSED_COUNT ? all : all.slice(-COLLAPSED_COUNT);
  });
  readonly hiddenCount = computed(() => this.notes().length - this.visibleNotes().length);

  private seq = 0;
  private loadingThumbs = new Set<string>();
  private clock?: ReturnType<typeof setInterval>;
  private lastScrollSize = -1;

  constructor() {
    effect(() => {
      for (const note of this.notes())
        for (const a of note.attachments)
          if (a.kind === 'image') this.loadThumb(a);
    });
    // O comentário confirmado chegou no plano recarregado: a cópia otimista sai (e libera as prévias).
    effect(() => {
      const ids = new Set(this.notes().map((n) => n.id));
      const arrived = this.outgoing().filter((o) => o.confirmedId && ids.has(o.confirmedId));
      if (!arrived.length) return;
      arrived.forEach((o) => this.revoke(o.files));
      this.outgoing.update((list) => list.filter((o) => !arrived.includes(o)));
    });
    // Conversa: desce para a mensagem nova (enviada, recebida ou o "analisando").
    effect(() => {
      const size = this.notes().length + this.outgoingVisible().length + (this.readState() === 'analyzing' ? 1 : 0);
      if (!this.isChat() || size === this.lastScrollSize) return;
      const first = this.lastScrollSize < 0;
      this.lastScrollSize = size;
      setTimeout(() => this.scrollToEnd(first));
    });
    this.clock = setInterval(() => this.now.set(Date.now()), 30_000);
  }

  // ── Compositor ─────────────────────────────────────────────────────────────────────────────────

  canSend(): boolean {
    return this.text.trim().length > 0 || this.pending().length > 0;
  }

  /** Arquivos vindos do arrastar-e-soltar (no painel inteiro), do seletor ou da área de transferência. */
  addFiles(files: File[] | FileList | null | undefined, fromClipboard = false): void {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    const accepted: PendingFile[] = [];
    for (const original of list) {
      if (original.size > MAX_FILE_BYTES) {
        this.snackBar.open(`"${original.name}" passa de 10 MB — não anexado.`, 'Fechar', { duration: 6000 });
        continue;
      }
      const file = fromClipboard || !original.name || /^image\.(png|jpe?g|gif|webp)$/i.test(original.name)
        ? this.renameClipboardFile(original)
        : original;
      accepted.push({ id: ++this.seq, file, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null });
    }
    const merged = [...this.pending(), ...accepted];
    if (merged.length > MAX_FILES) {
      this.snackBar.open(`No máximo ${MAX_FILES} anexos por comentário.`, 'Fechar', { duration: 5000 });
      merged.splice(MAX_FILES).forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
    }
    this.pending.set(merged);
    this.focus();
  }

  focus(): void {
    setTimeout(() => {
      const el = this.inputRef?.nativeElement;
      el?.focus();
      if (!this.isChat()) el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  useSuggestion(text: string): void {
    this.text = text;
    this.focus();
    setTimeout(() => this.autosize());
  }

  /** Conversa: a caixa cresce com o texto (até o limite do CSS). */
  autosize(): void {
    const el = this.inputRef?.nativeElement;
    if (!el || !this.isChat()) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  removePending(p: PendingFile): void {
    if (p.preview) URL.revokeObjectURL(p.preview);
    this.pending.update((list) => list.filter((x) => x.id !== p.id));
  }

  onPaste(event: ClipboardEvent): void {
    const files = PlanNotesComponent.clipboardFiles(event);
    if (!files.length) return;
    event.preventDefault();
    this.addFiles(files, true);
  }

  onDragOver(event: DragEvent): void {
    if (!PlanNotesComponent.hasFiles(event)) return;
    event.preventDefault();
    this.dropping.set(true);
  }

  onDrop(event: DragEvent): void {
    if (!PlanNotesComponent.hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    this.dropping.set(false);
    this.addFiles(event.dataTransfer?.files);
  }

  onPick(event: Event): void {
    const inputEl = event.target as HTMLInputElement;
    this.addFiles(inputEl.files);
    inputEl.value = '';
  }

  /** Painel: Ctrl+Enter envia. Conversa: Enter envia, Shift+Enter quebra a linha (como num chat). */
  onKey(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.isComposing) return;
    if (event.ctrlKey || event.metaKey || (this.isChat() && !event.shiftKey)) {
      event.preventDefault();
      this.send();
    }
  }

  /**
   * 0037: envio otimista — o comentário aparece na hora ("enviando…"), a caixa fica livre para o próximo e a
   * confirmação troca pelo comentário gravado. Erro: o texto e os anexos voltam para a caixa.
   */
  send(): void {
    if (!this.canSend()) return;
    const target = this.target();
    const item: OutgoingNote = { tempId: ++this.seq, text: this.text.trim(), planId: target.planId, stepKey: target.stepKey, files: this.pending() };
    this.outgoing.update((list) => [...list, item]);
    this.text = '';
    this.pending.set([]);
    this.flying.set(true);
    setTimeout(() => { this.flying.set(false); this.autosize(); }, 380);
    this.api.addNote(item.planId, item.text, item.stepKey, item.files.map((p) => p.file)).subscribe({
      next: (note) => {
        this.outgoing.update((list) => list.map((o) => (o.tempId === item.tempId ? { ...o, confirmedId: note.id } : o)));
        if (!this.isChat()) this.snackBar.open(`Comentário #${note.number} enviado — o Claude considera na análise.`, 'Ok', { duration: 4000 });
        this.changed.emit();
      },
      error: (err) => {
        this.outgoing.update((list) => list.filter((o) => o.tempId !== item.tempId));
        // Devolve o que foi escrito (sem apagar o que já foi digitado depois).
        this.text = this.text.trim() ? `${item.text}\n\n${this.text}` : item.text;
        this.pending.update((list) => [...item.files, ...list]);
        this.targetOverride.set({ planId: item.planId, stepKey: item.stepKey });
        this.snackBar.open(planApiError(err, 'Não foi possível enviar o comentário — ele voltou para a caixa.'), 'Fechar', { duration: 8000 });
        setTimeout(() => this.autosize());
      }
    });
  }

  // ── Editar / remover ───────────────────────────────────────────────────────────────────────────

  canChange(note: ExecutionNote): boolean {
    const me = this.currentUserId();
    return !note.fromExecutor && !!me && !!note.authorUserId && note.authorUserId.toLowerCase() === me.toLowerCase();
  }

  isChanging(note: ExecutionNote): boolean {
    return this.savingEdits()[note.id] !== undefined || this.removing().has(note.id);
  }

  startEdit(note: ExecutionNote): void {
    this.editText = note.text;
    this.editingId.set(note.id);
  }

  onEditKey(event: KeyboardEvent, note: ExecutionNote): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); this.saveEdit(note); }
    if (event.key === 'Escape') this.editingId.set(null);
  }

  /** Edição otimista: o texto novo aparece na hora ("salvando…"); erro → volta a edição com o texto. */
  saveEdit(note: ExecutionNote): void {
    const text = this.editText.trim();
    if (!text || this.isChanging(note)) return;
    this.savingEdits.update((m) => ({ ...m, [note.id]: text }));
    this.editingId.set(null);
    const done = () => this.savingEdits.update((m) => { const { [note.id]: _, ...rest } = m; return rest; });
    this.api.editNote(note.planId, note.id, text).subscribe({
      next: () => { this.changed.emit(); setTimeout(done, 1200); },
      error: (err) => {
        done();
        this.editText = text;
        this.editingId.set(note.id);
        this.snackBar.open(planApiError(err, 'Não foi possível editar.'), 'Fechar', { duration: 8000 });
      }
    });
  }

  /** Remoção otimista: o comentário esmaece com "removendo…" e some quando o plano recarrega. */
  remove(note: ExecutionNote): void {
    if (this.isChanging(note)) return;
    this.confirmDeleteId.set(null);
    this.removing.update((s) => new Set(s).add(note.id));
    const done = () => this.removing.update((s) => { const next = new Set(s); next.delete(note.id); return next; });
    this.api.deleteNote(note.planId, note.id).subscribe({
      next: () => { this.changed.emit(); setTimeout(done, 3000); },
      error: (err) => { done(); this.snackBar.open(planApiError(err, 'Não foi possível remover.'), 'Fechar', { duration: 8000 }); }
    });
  }

  // ── Anexos ─────────────────────────────────────────────────────────────────────────────────────

  /** Sempre no visualizador de arquivos do app (inclusive anexos do outro plano) — nada de guia com blob (PWA). */
  open(a: ExecutionArtifact): void {
    this.openArtifact.emit(a);
  }

  private loadThumb(a: ExecutionArtifact): void {
    if (this.thumbs()[a.id] || this.loadingThumbs.has(a.id)) return;
    this.loadingThumbs.add(a.id);
    this.api.content(a.planId, a.id).subscribe({
      next: (blob) => this.thumbs.update((t) => ({ ...t, [a.id]: URL.createObjectURL(blob) })),
      error: () => this.loadingThumbs.delete(a.id)
    });
  }

  copyRef(text: string): void {
    this.clipboard.copyFullDescriptionToClipboard(text);
  }

  private revoke(files: PendingFile[]): void {
    files.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
  }

  private scrollToEnd(instant: boolean): void {
    const el = this.scrollRef?.nativeElement;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: instant ? 'auto' : 'smooth' });
  }

  // ── Formatação ─────────────────────────────────────────────────────────────────────────────────

  stepTitle(key: string): string {
    for (const plan of this.targetPlans()) {
      const step = plan.steps.find((s) => s.key === key);
      if (step) return step.title;
    }
    return this.steps().find((s) => s.key === key)?.title ?? key;
  }

  phaseLabel(phase: PlanPhase): string {
    return phase === 'correction' ? 'na correção' : 'na análise';
  }

  /** Separador de dia na conversa: só quando o dia muda em relação ao comentário anterior. */
  dayLabel(index: number): string | null {
    const list = this.notes();
    const day = (v: string) => new Date(v).toDateString();
    if (index > 0 && day(list[index - 1].createdAt) === day(list[index].createdAt)) return null;
    const d = new Date(list[index].createdAt);
    if (isNaN(d.getTime())) return null;
    const today = new Date();
    const yesterday = new Date(Date.now() - 86_400_000);
    if (d.toDateString() === today.toDateString()) return 'Hoje';
    if (d.toDateString() === yesterday.toDateString()) return 'Ontem';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  }

  fileIcon(a: ExecutionArtifact): string {
    return ({ script: 'code', analysis: 'description', data: 'dataset', image: 'image' } as Record<string, string>)[a.kind] ?? this.iconByName(a.name);
  }

  pendingIcon(file: File): string {
    return this.iconByName(file.name);
  }

  private iconByName(name: string): string {
    if (/\.pdf$/i.test(name)) return 'picture_as_pdf';
    if (/\.(csv|xlsx?|json|log|txt|xml)$/i.test(name)) return 'dataset';
    if (/\.(zip|rar|7z)$/i.test(name)) return 'folder_zip';
    return 'insert_drive_file';
  }

  size(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  relative(value: string): string {
    const diff = Date.now() - Date.parse(value);
    if (isNaN(diff)) return '';
    const min = Math.floor(Math.max(0, diff) / 60000);
    if (min < 1) return 'agora mesmo';
    if (min < 60) return `há ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `há ${h} h`;
    return this.formatDateTime(value);
  }

  time(value: string): string {
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  formatDateTime(value: string): string {
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /** Imagem colada/arrastada sem nome útil ("image.png") vira "colado-AAAAMMDD-HHMMSS-n.png". */
  private renameClipboardFile(file: File): File {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'bin';
    const name = `colado-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${this.seq + 1}.${ext}`;
    return new File([file], name, { type: file.type || 'application/octet-stream', lastModified: file.lastModified });
  }

  static hasFiles(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files');
  }

  static clipboardFiles(event: ClipboardEvent): File[] {
    return Array.from(event.clipboardData?.items ?? [])
      .filter((i) => i.kind === 'file')
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);
  }

  ngOnDestroy(): void {
    clearInterval(this.clock);
    Object.values(this.thumbs()).forEach((url) => URL.revokeObjectURL(url));
    this.pending().forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
    this.outgoing().forEach((o) => this.revoke(o.files));
  }
}
