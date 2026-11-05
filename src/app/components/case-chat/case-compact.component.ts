import { Component, ElementRef, OnDestroy, ViewChild, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CaseChatService } from '../../services/case-chat.service';
import { CaseChatStore, CaseRoom, PendingFile } from '../../services/case-chat-store.service';
import { UserPhotoService } from '../../services/user-photo.service';
import { planApiError } from '../../services/execution-plan.service';
import { PlanMarkdownPipe } from '../execution-plan/plan-markdown.pipe';
import { CodeRefHostDirective } from '../code-ref/code-ref-host.directive';
import { UserAvatarComponent } from '../user-avatar/user-avatar.component';
import { CaseAction, CaseFile, CaseMessage, CaseProposal, SPECIALIST_NAME, isRunActive } from './case-chat.model';
import { CaseProposalDialogComponent, CaseProposalDialogData } from './case-proposal-dialog.component';
import { openCaseChat } from './open-case-chat';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 20;
const TYPING_TTL_MS = 6000;
const TYPING_EVERY_MS = 4000;

/**
 * 0081: o Especialista do caso em versão compacta, no lugar da antiga linha do tempo (coluna da direita do card). Lê o
 * mesmo estado do modal ({@link CaseChatStore}): mensagens ao vivo pelo WebSocket, o que ele está fazendo, quem está
 * digitando, proposta e ações pendentes, pontos e arquivos — e um campo para escrever (o rascunho é o mesmo do modal).
 * "Expandir" abre o modal grande (voz, contexto, histórico, ferramentas por mensagem).
 */
@Component({
  selector: 'app-case-compact',
  standalone: true,
  imports: [DatePipe, FormsModule, MatButtonModule, MatIconModule, MatTooltipModule, PlanMarkdownPipe, CodeRefHostDirective, UserAvatarComponent],
  templateUrl: './case-compact.component.html',
  styleUrls: ['./case-compact.component.css']
})
export class CaseCompactComponent implements OnDestroy {
  readonly card = input<string | null>(null);
  /** Tipo do card (as ferramentas da conversa grande mudam com ele). */
  readonly cardType = input<'bug' | 'user-story'>('bug');
  /** Item de trabalho criado/aberto por uma ferramenta da conversa grande (o hospedeiro mostra o item). */
  readonly itemOpened = output<number>();

  private store = inject(CaseChatStore);
  private api = inject(CaseChatService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);
  private host = inject(ElementRef<HTMLElement>);
  readonly photos = inject(UserPhotoService);
  readonly specialistName = SPECIALIST_NAME;

  @ViewChild('scroll') private scrollRef?: ElementRef<HTMLDivElement>;
  @ViewChild('box') private boxRef?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('picker') private pickerRef?: ElementRef<HTMLInputElement>;

  private watching: string | null = null;
  private stickToBottom = true;
  private lastTypingSent = 0;
  private clock = setInterval(() => this.now.set(Date.now()), 1000);
  readonly now = signal(Date.now());
  readonly sending = signal(false);
  readonly dropping = signal(false);
  /** Mensagens com "o que ele fez" aberto. */
  readonly openSteps = signal<Set<string>>(new Set());

  readonly room = computed<CaseRoom | null>(() => {
    const c = this.card();
    return c ? this.store.room(c) : null;
  });
  readonly chat = computed(() => this.room()?.chat() ?? null);
  readonly loading = computed(() => this.room()?.loading() ?? false);
  readonly loadError = computed(() => this.room()?.loadError() ?? false);
  readonly status = computed(() => {
    const c = this.card();
    return c ? this.store.status(c)() : null;
  });
  readonly messages = computed(() => this.chat()?.messages ?? []);
  readonly run = computed(() => this.chat()?.run ?? null);
  readonly working = computed(() => isRunActive(this.run()));
  readonly runLabel = computed(() => {
    const r = this.run();
    if (!r || !isRunActive(r)) return null;
    if (r.status === 'queued') return r.waitReason || 'Na fila — começa em instantes';
    return r.currentActivity?.label ?? 'Pensando…';
  });
  readonly proposalsById = computed(() => new Map((this.chat()?.proposals ?? []).map((p) => [p.id, p])));
  readonly actionsById = computed(() => new Map((this.chat()?.actions ?? []).map((a) => [a.id, a])));
  readonly pendingProposal = computed(() => (this.chat()?.proposals ?? []).filter((p) => p.status === 'pending').at(-1) ?? null);
  readonly pendingActions = computed(() => (this.chat()?.actions ?? []).filter((a) => a.status === 'pending'));
  readonly agreed = computed(() => (this.chat()?.points ?? []).filter((p) => p.status === 'agreed'));
  readonly agreedText = computed(() => this.agreed().map((p) => '• ' + p.text).join('\n'));
  readonly files = computed(() => this.chat()?.files ?? []);
  readonly people = computed(() => this.chat()?.participants ?? []);
  readonly typingNames = computed(() => {
    const now = this.now();
    return Object.entries(this.room()?.typing() ?? {}).filter(([, at]) => now - at < TYPING_TTL_MS).map(([name]) => name);
  });
  readonly replyTo = computed(() => this.room()?.replyTo() ?? null);
  readonly pending = computed(() => this.room()?.pending() ?? []);

  get draft(): string { return this.room()?.draft.text ?? ''; }
  set draft(v: string) { const r = this.room(); if (r) r.draft.text = v; }

  constructor() {
    effect(() => {
      const c = this.card();
      if (c === this.watching) return;
      if (this.watching) this.store.unwatch(this.watching);
      this.watching = c;
      this.stickToBottom = true;
      if (c) this.store.watch(c);
    });
    effect(() => {
      const c = this.chat();
      if (!c) return;
      untracked(() => {
        this.photos.ensure([...c.participants.map((p) => p.userId), ...c.messages.map((m) => m.authorUserId)]);
        if (this.stickToBottom) this.scrollToEnd();
      });
    });
  }

  ngOnDestroy(): void {
    if (this.watching) this.store.unwatch(this.watching);
    clearInterval(this.clock);
  }

  // ── Abrir / enviar ──────────────────────────────────────────────────────────────────────────────

  expand(): void {
    const c = this.card();
    if (!c) return;
    openCaseChat(this.dialog, c, this.host.nativeElement.querySelector('.ck'), this.cardType())
      .afterClosed().subscribe((r) => { if (r?.openItem) this.itemOpened.emit(r.openItem); });
  }

  send(text?: string): void {
    const c = this.card();
    if (!c || this.sending()) return;
    const request = this.store.send(c, text);
    if (!request) return;
    this.sending.set(true);
    this.stickToBottom = true;
    request.subscribe({
      next: () => {
        this.sending.set(false);
        this.scrollToEnd();
        this.boxRef?.nativeElement.focus();
      },
      error: (err) => {
        this.sending.set(false);
        this.snack.open(planApiError(err, 'Não foi possível enviar a mensagem.'), 'Fechar', { duration: 8000 });
      }
    });
  }

  onKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.send();
    }
  }

  onInput(): void {
    const c = this.card();
    const now = Date.now();
    if (c && this.draft.trim() && now - this.lastTypingSent > TYPING_EVERY_MS) {
      this.lastTypingSent = now;
      this.api.typing(c).subscribe({ error: () => {} });
    }
  }

  clearReply(): void {
    this.room()?.replyTo.set(null);
  }

  reply(m: CaseMessage): void {
    this.room()?.replyTo.set(m);
    this.boxRef?.nativeElement.focus();
  }

  pick(): void {
    this.pickerRef?.nativeElement.click();
  }

  onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.addFiles(Array.from(input.files ?? []));
    input.value = '';
  }

  onPaste(event: ClipboardEvent): void {
    const files = Array.from(event.clipboardData?.items ?? []).filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter((f): f is File => !!f);
    if (!files.length) return;
    event.preventDefault();
    this.addFiles(files, true);
  }

  onDragOver(event: DragEvent): void {
    if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    this.dropping.set(true);
  }

  onDrop(event: DragEvent): void {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    event.stopPropagation();
    this.dropping.set(false);
    this.addFiles(Array.from(event.dataTransfer.files));
  }

  private addFiles(files: File[], pasted = false): void {
    const c = this.card();
    if (c) this.store.addFiles(c, files, pasted, MAX_FILES, MAX_FILE_BYTES, (m) => this.snack.open(m, 'Ok', { duration: 5000 }));
  }

  removePending(p: PendingFile): void {
    const c = this.card();
    if (c) this.store.removePending(c, p);
  }

  // ── Proposta, ações, arquivos ───────────────────────────────────────────────────────────────────

  proposalOf(m: CaseMessage): CaseProposal | null {
    return m.proposalId ? this.proposalsById().get(m.proposalId) ?? null : null;
  }

  actionOf(m: CaseMessage): CaseAction | null {
    return m.actionId ? this.actionsById().get(m.actionId) ?? null : null;
  }

  openProposal(p: CaseProposal): void {
    const c = this.card();
    const chat = this.chat();
    if (!c || !chat) return;
    const data: CaseProposalDialogData = { card: c, proposal: p, canDecide: chat.canDecide, hasPlan: chat.hasPlan };
    this.dialog.open(CaseProposalDialogComponent, { data, width: '1100px', maxWidth: '96vw', maxHeight: '92vh', autoFocus: false })
      .afterClosed().subscribe((changed) => { if (changed) this.store.reload(c, 0); });
  }

  decideAction(a: CaseAction, confirm: boolean): void {
    const c = this.card();
    if (!c) return;
    this.api.decideAction(c, a.id, confirm).subscribe({
      next: () => this.store.reload(c, 0),
      error: (err) => this.snack.open(planApiError(err, 'Não foi possível decidir a ação.'), 'Fechar', { duration: 8000 })
    });
  }

  blob(f: CaseFile): string | null {
    const c = this.card();
    return c ? this.store.blob(c, f) : null;
  }

  openImage(f: CaseFile): void {
    const url = this.blob(f);
    if (url) window.open(url, '_blank', 'noopener');
  }

  toggleSteps(m: CaseMessage): void {
    const next = new Set(this.openSteps());
    if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
    this.openSteps.set(next);
  }

  // ── Apresentação ───────────────────────────────────────────────────────────────────────────────

  isMine(m: CaseMessage): boolean {
    return this.store.isMine(m);
  }

  who(m: CaseMessage): string {
    return m.authorKind === 'specialist' ? SPECIALIST_NAME : this.isMine(m) ? 'Você' : m.authorName;
  }

  quoted(n: number | null | undefined): string {
    const m = n ? this.messages().find((x) => x.number === n) : null;
    if (!m) return '';
    const t = (m.kind === 'voice' ? m.transcript ?? 'mensagem de voz' : m.text).replace(/\s+/g, ' ');
    return `${m.authorKind === 'specialist' ? 'Especialista' : m.authorName}: ${t.length > 70 ? t.slice(0, 70) + '…' : t}`;
  }

  /** Separador quando muda o dia. */
  newDay(i: number): boolean {
    const list = this.messages();
    return i === 0 || new Date(list[i - 1].createdAt).toDateString() !== new Date(list[i].createdAt).toDateString();
  }

  fileIcon(f: CaseFile): string {
    if (f.kind === 'image') return 'image';
    if (f.kind === 'audio') return 'graphic_eq';
    if (/\.sql$/i.test(f.name)) return 'code';
    if (/\.(csv|json)$/i.test(f.name)) return 'dataset';
    return 'description';
  }

  proposalState(p: CaseProposal): string {
    return ({ pending: 'aguardando decisão', accepted: 'aceita', rejected: 'recusada', superseded: 'substituída' })[p.status];
  }

  onScroll(): void {
    this.stickToBottom = this.isAtBottom();
    if (this.stickToBottom) this.markSeen();
  }

  private isAtBottom(): boolean {
    const el = this.scrollRef?.nativeElement;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }

  /** Viu o fim da conversa na tela (painel visível, não numa aba escondida do celular) → nada de "novas". */
  private markSeen(): void {
    const c = this.card();
    const last = this.messages().at(-1)?.number ?? 0;
    const visible = !!(this.host.nativeElement as HTMLElement).offsetParent && document.visibilityState === 'visible';
    if (c && last && visible) this.store.markSeen(c, last);
  }

  private scrollToEnd(): void {
    setTimeout(() => {
      const el = this.scrollRef?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
      this.markSeen();
    }, 30);
  }
}
