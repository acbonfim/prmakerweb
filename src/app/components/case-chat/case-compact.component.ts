import { Component, ElementRef, Injector, OnDestroy, ViewChild, afterNextRender, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
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
import { CASE_QUICK, CASE_STARTERS, CaseAction, CaseDelivery, CaseFile, CaseMessage, CaseProposal, CaseViewMessage, EPIC_QUICK, EPIC_STARTERS, SPECIALIST_NAME,
  isRunActive } from './case-chat.model';
import { StickyScroll, flyToChat } from './chat-motion';
import { CaseProposalDialogComponent, CaseProposalDialogData } from './case-proposal-dialog.component';
import { openCaseChat } from './open-case-chat';
import { openCaseFile } from './open-case-file';
import { CaseComposer, CaseComposerService } from './case-composer.service';
import { ComposerAction, ComposerSuggestion } from './composer-suggest';
import { ComposerSuggestComponent } from './composer-suggest.component';
import { CaseCardType } from '../../helpers/work-item-type-icons';
import { VoiceRecorder, VoiceResult } from './voice-recorder';
import { composerHint, silentTail } from './specialist-call';

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
  imports: [DatePipe, FormsModule, MatButtonModule, MatIconModule, MatTooltipModule, PlanMarkdownPipe, CodeRefHostDirective, UserAvatarComponent,
    ComposerSuggestComponent],
  templateUrl: './case-compact.component.html',
  styleUrls: ['./case-compact.component.css']
})
export class CaseCompactComponent implements OnDestroy {
  readonly card = input<string | null>(null);
  /** Tipo do card (as ferramentas da conversa grande mudam com ele). */
  readonly cardType = input<CaseCardType>('bug');
  /** 0099: conversa de um épico da Mesa de gestão (chave `E{n}`) — rótulos e sugestões de gestão. */
  readonly epic = computed(() => this.cardType() === 'epic');
  /** Sugestões da conversa vazia e atalhos sobre o campo — as mesmas da conversa grande. */
  readonly starters = computed(() => this.epic() ? EPIC_STARTERS : CASE_STARTERS);
  readonly quick = computed(() => this.epic() ? EPIC_QUICK : CASE_QUICK);
  /** Item de trabalho criado/aberto por uma ferramenta da conversa grande (o hospedeiro mostra o item). */
  readonly itemOpened = output<number>();
  /** Bancada: mostra a seta que recolhe o painel para a direita (o hospedeiro esconde e mostra a seta de volta). */
  readonly collapsible = input(false);
  readonly collapse = output<void>();

  private store = inject(CaseChatStore);
  private api = inject(CaseChatService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);
  private host = inject(ElementRef<HTMLElement>);
  readonly photos = inject(UserPhotoService);
  readonly specialistName = SPECIALIST_NAME;
  private composerSvc = inject(CaseComposerService);
  /** 0090: `/` comandos e ferramentas, `#` itens de trabalho (o mesmo do modal). */
  readonly composer = new CaseComposer(this.composerSvc, () => this.card(), () => this.cardType());

  @ViewChild('scroll') private set scrollEl(ref: ElementRef<HTMLDivElement> | undefined) {
    this.scrollRef = ref;
    if (ref) this.sticky.attach(ref.nativeElement);
    else this.sticky.detach();
  }
  private scrollRef?: ElementRef<HTMLDivElement>;
  @ViewChild('box') private boxRef?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('picker') private pickerRef?: ElementRef<HTMLInputElement>;

  private injector = inject(Injector);
  private watching: string | null = null;
  /** Abre na mensagem mais nova e segue o fim enquanto o conteúdo cresce, até a pessoa rolar para cima. */
  readonly sticky = new StickyScroll(60, () => this.markSeen());
  /** Mensagens que chegaram com a conversa aberta (entram animadas); as que já estavam, não. */
  readonly fresh = new Set<string>();
  private known: Set<string> | null = null;
  /** O botão de enviar "decola" a cada envio. */
  readonly launching = signal(false);
  private launchTimer?: ReturnType<typeof setTimeout>;
  private lastTypingSent = 0;
  private clock = setInterval(() => this.now.set(Date.now()), 1000);
  readonly now = signal(Date.now());
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
  /** As do servidor e, no fim, as que estão saindo deste navegador (⏱). */
  readonly messages = computed<CaseViewMessage[]>(() => this.room()?.view() ?? []);
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
  /** Com 2+ pessoas o especialista só entra com "?" ou @especialista — a caixa lembra e a mensagem que não chamou ganha "Chamar". */
  readonly placeholder = computed(() => composerHint(this.people().length, this.working()));
  readonly silent = computed(() => this.working() ? new Set<string>() : silentTail(this.messages(), this.people().length));
  readonly calling = signal(false);

  /** @ menciona as pessoas da conversa (e o especialista), como na conversa grande. */
  readonly mentionQuery = signal<string | null>(null);
  readonly mentionOptions = computed(() => {
    const q = (this.mentionQuery() ?? '').toLowerCase();
    const names = [SPECIALIST_NAME.split(' ')[0], ...this.people().map((p) => p.name.split(' ')[0])];
    return Array.from(new Set(names)).filter((n) => n.toLowerCase().startsWith(q)).slice(0, 6);
  });

  /** Mensagem de voz (mesmo gravador da conversa grande). */
  readonly voice = new VoiceRecorder();
  readonly voiceReview = signal<VoiceResult | null>(null);
  voiceTranscript = '';
  readonly canRecord = VoiceRecorder.supported();
  readonly sendingVoice = signal(false);
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
      this.known = null;
      this.fresh.clear();
      this.sticky.toEnd();
      if (c) this.store.watch(c);
    });
    effect(() => {
      const c = this.chat();
      const list = this.messages();
      if (!c) return;
      untracked(() => {
        this.trackFresh(list);
        this.photos.ensure([...c.participants.map((p) => p.userId), ...c.messages.map((m) => m.authorUserId)]);
        if (this.sticky.atEnd()) afterNextRender(() => this.markSeen(), { injector: this.injector });
      });
    });
  }

  ngOnDestroy(): void {
    if (this.voice.recording()) this.voice.cancel();
    if (this.watching) this.store.unwatch(this.watching);
    clearInterval(this.clock);
    clearTimeout(this.launchTimer);
    this.sticky.detach();
  }

  // ── Abrir / enviar ──────────────────────────────────────────────────────────────────────────────

  expand(tool?: string): void {
    const c = this.card();
    if (!c) return;
    openCaseChat(this.dialog, c, this.host.nativeElement.querySelector('.ck'), this.cardType(), tool)
      .afterClosed().subscribe((r) => { if (r?.openItem) this.itemOpened.emit(r.openItem); });
  }

  /** Atalho: com texto no campo, junta ao que a pessoa escreveu (ela ainda ajusta); campo vazio, manda direto. */
  quickSend(text: string): void {
    if (this.draft.trim()) {
      this.draft = `${this.draft.trim()}\n${text}`;
      this.boxRef?.nativeElement.focus();
      return;
    }
    this.send(text);
  }

  send(text?: string): void {
    const c = this.card();
    if (!c) return;
    // 0090: comando digitado (`/clear`, `/cancelar-item-de-trabalho #n`, `/ferramenta`) não vai como mensagem.
    if (text === undefined && !this.pending().length && this.runCommand(c)) return;
    const body = (text ?? this.draft).trim();
    // Como no WhatsApp: vai para a conversa na hora (⏱) e o campo fica livre; o servidor confirma depois (✓).
    if (!this.store.send(c, text, (m) => this.snack.open(m, 'Fechar', { duration: 8000 }))) return;
    const key = this.room()?.outbox().at(-1)?.key;
    this.launch();
    this.sticky.toEnd();
    afterNextRender(() => {
      this.sticky.toEnd();
      if (body) flyToChat(this.boxRef?.nativeElement, this.bubbleOf(key), body);
    }, { injector: this.injector });
    this.boxRef?.nativeElement.focus();
  }

  retry(m: CaseViewMessage): void {
    const c = this.card();
    if (c) this.store.retry(c, m.key);
  }

  discard(m: CaseViewMessage): void {
    const c = this.card();
    if (c) this.store.discard(c, m.key);
  }

  delivery(m: CaseViewMessage): CaseDelivery {
    const c = this.card();
    return c ? this.store.delivery(c, m) : 'sent';
  }

  deliveryLabel(m: CaseViewMessage): string {
    switch (this.delivery(m)) {
      case 'sending': return 'Enviando…';
      case 'failed': return 'Não foi enviada';
      case 'read': return 'Lida por ' + this.store.readBy(this.card() ?? '', m).join(', ');
      default: return 'Recebida — ainda não lida';
    }
  }

  private launch(): void {
    clearTimeout(this.launchTimer);
    this.launching.set(false);
    // Próximo quadro: a classe sai e volta, e a animação roda de novo mesmo em envios seguidos.
    requestAnimationFrame(() => {
      this.launching.set(true);
      this.launchTimer = setTimeout(() => this.launching.set(false), 500);
    });
  }

  private bubbleOf(key: string | undefined): HTMLElement | null {
    if (!key) return null;
    return this.scrollRef?.nativeElement.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"] .km__bubble`) ?? null;
  }

  /** Primeira carga: tudo "já estava". Depois, o que chega de outros entra animado (as minhas voam do campo). */
  private trackFresh(list: CaseViewMessage[]): void {
    if (!this.known) {
      this.known = new Set(list.map((m) => m.key));
      return;
    }
    for (const m of list) {
      if (this.known.has(m.key)) continue;
      this.known.add(m.key);
      if (!m.outgoing) this.fresh.add(m.key);
    }
  }

  onKey(event: KeyboardEvent): void {
    const action = this.composer.key(event, this.draft);
    if (action !== undefined) {
      if (action) this.applyComposer(action);
      return;
    }
    if (this.mentionQuery() !== null && this.mentionOptions().length && (event.key === 'Enter' || event.key === 'Tab')) {
      event.preventDefault();
      this.pickMention(this.mentionOptions()[0]);
      return;
    }
    if (event.key === 'Escape' && this.mentionQuery() !== null) {
      event.preventDefault();
      event.stopPropagation();
      this.mentionQuery.set(null);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.send();
    }
  }

  onInput(): void {
    const c = this.card();
    this.onCaret();
    const box = this.boxRef?.nativeElement;
    const before = box ? this.draft.slice(0, box.selectionStart ?? this.draft.length) : this.draft;
    const m = /(?:^|\s)@([\p{L}\p{N}._-]*)$/u.exec(before);
    this.mentionQuery.set(m ? m[1] : null);
    const now = Date.now();
    if (c && this.draft.trim() && now - this.lastTypingSent > TYPING_EVERY_MS) {
      this.lastTypingSent = now;
      this.api.typing(c).subscribe({ error: () => {} });
    }
  }

  /** Cursor andou (digitou, clicou, ←/→): a lista segue o que está no cursor. */
  onCaret(event?: KeyboardEvent): void {
    if (event && ['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape', 'Shift'].includes(event.key)) return;
    const box = this.boxRef?.nativeElement;
    this.composer.update(this.draft, box?.selectionStart ?? this.draft.length);
  }

  pickMention(name: string): void {
    const box = this.boxRef?.nativeElement;
    const current = box?.value ?? this.draft;
    const caret = box?.selectionStart ?? current.length;
    const before = current.slice(0, caret).replace(/@([\p{L}\p{N}._-]*)$/u, `@${name} `);
    const next = before + current.slice(caret);
    this.draft = next;
    if (box) {
      box.value = next;
      box.focus();
      box.setSelectionRange(before.length, before.length);
    }
    this.mentionQuery.set(null);
  }

  /** "Chamar": o especialista lê as mensagens que ainda não respondeu (sem repetir a mensagem). */
  callSpecialist(): void {
    const c = this.card();
    if (!c || this.calling()) return;
    this.calling.set(true);
    this.api.ask(c).subscribe({
      next: () => this.calling.set(false),
      error: (err) => {
        this.calling.set(false);
        this.snack.open(planApiError(err, 'Não foi possível chamar o especialista.'), 'Fechar', { duration: 8000 });
      }
    });
  }

  async startVoice(): Promise<void> {
    this.voiceReview.set(null);
    await this.voice.start((m) => this.snack.open(m, 'Ok', { duration: 6000 }));
  }

  async stopVoice(): Promise<void> {
    const r = await this.voice.stop();
    if (!r) return;
    this.voiceTranscript = r.transcript;
    this.voiceReview.set(r);
  }

  cancelVoice(): void {
    if (this.voice.recording()) this.voice.cancel();
    this.voiceReview.set(null);
    this.voiceTranscript = '';
  }

  sendVoice(): void {
    const c = this.card();
    const r = this.voiceReview();
    if (!c || !r || this.sendingVoice()) return;
    this.sendingVoice.set(true);
    this.api.post(c, {
      voice: true, transcript: this.voiceTranscript.trim(), files: [r.file], peopleOnly: false, deep: false,
      replyTo: this.replyTo()?.number ?? null
    }).subscribe({
      next: (m) => {
        this.sendingVoice.set(false);
        this.voiceReview.set(null);
        this.voiceTranscript = '';
        this.room()?.replyTo.set(null);
        this.store.appendMine(c, m);
        this.sticky.toEnd();
      },
      error: (err) => {
        this.sendingVoice.set(false);
        this.snack.open(planApiError(err, 'Não foi possível enviar o áudio.'), 'Fechar', { duration: 8000 });
      }
    });
  }

  seconds(s: number): string {
    return `${Math.floor(s / 60)}:${`${s % 60}`.padStart(2, '0')}`;
  }

  pickSuggestion(s: ComposerSuggestion): void {
    const action = this.composer.pick(s, this.draft);
    if (action) this.applyComposer(action);
  }

  private applyComposer(action: ComposerAction): void {
    const box = this.boxRef?.nativeElement;
    switch (action.kind) {
      case 'insert':
        this.draft = action.text;
        if (box) {
          box.value = action.text;
          box.focus();
          box.setSelectionRange(action.caret, action.caret);
        }
        this.composer.update(action.text, action.caret);
        return;
      case 'clear':
        this.draft = '';
        void this.clearConversation();
        return;
      case 'tool':
        this.draft = '';
        this.expand(action.key);
        return;
    }
  }

  private runCommand(card: string): boolean {
    const cmd = this.composer.command(this.draft);
    if (!cmd) return false;
    switch (cmd.kind) {
      case 'clear':
        void this.clearConversation();
        return true;
      case 'tool':
        this.draft = '';
        this.expand(cmd.key);
        return true;
      case 'cancel':
        if (!cmd.number) {
          this.snack.open('Diga qual item: /cancelar-item-de-trabalho #123 (digite # para escolher).', 'Ok', { duration: 5000 });
          return true;
        }
        void this.composerSvc.cancelItem(card, cmd.number, cmd.reason).then((ok) => { if (ok) this.draft = ''; });
        return true;
      case 'unknown':
        this.snack.open(`Não existe o comando /${cmd.name} — digite / no começo da mensagem para ver os comandos e as ferramentas.`, 'Ok', { duration: 6000 });
        return true;
    }
  }

  private async clearConversation(): Promise<void> {
    const c = this.card();
    if (!c || !(await this.composerSvc.clear(c))) return;
    this.draft = '';
    this.clearReply();
    this.sticky.toEnd();
    this.store.reload(c, 0);
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

  /** Imagem ou arquivo da conversa no visualizador (← → entre os arquivos). */
  openFile(f: CaseFile): void {
    const c = this.card();
    if (c) openCaseFile(this.dialog, this.api, c, this.chat()?.files ?? [], f);
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
    this.sticky.onScroll();
  }

  toEnd(): void {
    this.sticky.toEnd(true);
  }

  /** Viu o fim da conversa na tela (painel visível, não numa aba escondida do celular) → nada de "novas". */
  private markSeen(): void {
    const c = this.card();
    const last = this.chat()?.messages.at(-1)?.number ?? 0;
    const visible = !!(this.host.nativeElement as HTMLElement).offsetParent && document.visibilityState === 'visible';
    if (c && last && visible) this.store.markSeen(c, last);
  }
}
