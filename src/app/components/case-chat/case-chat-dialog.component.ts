import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { WsService } from '../../services/ws.service';
import { StorageService } from '../../services/storage.service';
import { CaseChatService } from '../../services/case-chat.service';
import { UserPhotoService } from '../../services/user-photo.service';
import { CaseChatStatusService } from '../../services/case-chat-status.service';
import { planApiError, saveBlob } from '../../services/execution-plan.service';
import { PlanMarkdownPipe } from '../execution-plan/plan-markdown.pipe';
import { CodeRefHostDirective } from '../code-ref/code-ref-host.directive';
import { UserAvatarComponent } from '../user-avatar/user-avatar.component';
import { executionPlanGroup } from '../execution-plan/execution-plan.model';
import {
  CASE_CHAT_EVENT,
  CaseAction,
  CaseChat,
  CaseChatRealtimePayload,
  CaseFile,
  CaseMessage,
  CasePoint,
  CaseProposal,
  SPECIALIST_NAME,
  isRunActive
} from './case-chat.model';
import { VoiceRecorder, VoiceResult } from './voice-recorder';
import { CaseProposalDialogComponent, CaseProposalDialogData } from './case-proposal-dialog.component';

export interface CaseChatDialogData {
  card: string;
}

interface PendingFile {
  id: number;
  file: File;
  preview: string | null;
}

/** Mesmos limites da API (10 MB por arquivo, 20 por mensagem). */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 20;
/** "Fulano está digitando" some depois disso sem novo sinal. */
const TYPING_TTL_MS = 6000;
/** Sinal de digitando no máximo a cada... */
const TYPING_EVERY_MS = 4000;
const REFRESH_DEBOUNCE_MS = 200;

/** Atalhos do compositor: preenchem o texto (a pessoa ainda pode ajustar) ou mandam direto. */
const QUICK = [
  { icon: 'summarize', label: 'Resumir a conversa', text: 'Resuma a conversa até aqui: o que já combinamos e o que falta decidir.' },
  { icon: 'auto_awesome', label: 'Gerar nova versão do plano', text: 'Pode gerar a nova versão do plano com o que combinamos?' },
  { icon: 'code', label: 'Mostrar o código', text: 'Mostre o trecho de código envolvido (com caminho:linha e a branch).' },
  { icon: 'storage', label: 'Consultar o banco (só leitura)', text: 'Consulte no banco (só leitura) e me mostre os valores que importam aqui.' },
  { icon: 'image', label: 'Gerar imagem / mock', text: 'Gere um Antes × Depois (mock) do que muda para a pessoa usuária.' },
  { icon: 'note_add', label: 'Gerar arquivo', text: 'Gere o arquivo (script ou texto do chamado) para eu revisar.' }
];

/**
 * 0080: Especialista do caso — a conversa do card com um agente próprio (pista do especialista no executor), que conhece
 * o caso inteiro, mostra o que está fazendo ao vivo e nunca altera o plano: conclusões viram proposta que uma pessoa aceita.
 * Várias pessoas escrevem na mesma conversa (avatares, "digitando"); imagens coladas/arrastadas, arquivos e voz.
 */
@Component({
  selector: 'app-case-chat-dialog',
  standalone: true,
  imports: [DatePipe, DecimalPipe, FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule,
    PlanMarkdownPipe, CodeRefHostDirective, UserAvatarComponent],
  templateUrl: './case-chat-dialog.component.html',
  styleUrls: ['./case-chat-dialog.component.css']
})
export class CaseChatDialogComponent implements AfterViewInit, OnDestroy {
  readonly data = inject<CaseChatDialogData>(MAT_DIALOG_DATA);
  private ref = inject(MatDialogRef<CaseChatDialogComponent>);
  private api = inject(CaseChatService);
  private ws = inject(WsService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);
  readonly photos = inject(UserPhotoService);
  private status = inject(CaseChatStatusService);
  private readonly me = inject(StorageService).getAccess()?.user ?? null;

  readonly specialistName = SPECIALIST_NAME;
  readonly quick = QUICK;
  readonly myId = (this.me?.externalId ?? '').toLowerCase();

  readonly chat = signal<CaseChat | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal(false);
  readonly sending = signal(false);
  readonly showHistory = signal(false);
  readonly showAside = signal(window.matchMedia('(min-width: 1000px)').matches);
  readonly typing = signal<Record<string, number>>({});
  readonly now = signal(Date.now());
  readonly replyTo = signal<CaseMessage | null>(null);
  readonly pending = signal<PendingFile[]>([]);
  readonly dropping = signal(false);
  readonly mentionQuery = signal<string | null>(null);
  draft = '';
  peopleOnly = false;
  deep = false;

  readonly voice = new VoiceRecorder();
  readonly voiceReview = signal<VoiceResult | null>(null);
  voiceTranscript = '';
  readonly canRecord = VoiceRecorder.supported();

  /** Blob URLs dos arquivos (imagens e áudios) carregados sob demanda. */
  readonly blobs = signal<Record<string, string>>({});
  private loadingBlobs = new Set<string>();

  @ViewChild('scroll') private scrollRef?: ElementRef<HTMLDivElement>;
  @ViewChild('box') private boxRef?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('picker') private pickerRef?: ElementRef<HTMLInputElement>;

  readonly messages = computed(() => this.chat()?.messages ?? []);
  readonly run = computed(() => this.chat()?.run ?? null);
  readonly working = computed(() => isRunActive(this.run()));
  readonly proposalsById = computed(() => new Map((this.chat()?.proposals ?? []).map((p) => [p.id, p])));
  readonly actionsById = computed(() => new Map((this.chat()?.actions ?? []).map((a) => [a.id, a])));
  readonly points = computed(() => (this.chat()?.points ?? []).filter((p) => p.status !== 'dropped'));
  readonly agreedPoints = computed(() => this.points().filter((p) => p.status === 'agreed').length);
  readonly people = computed(() => this.chat()?.participants ?? []);
  readonly convFiles = computed(() => (this.chat()?.files ?? []).slice().reverse());
  readonly pendingProposal = computed(() => (this.chat()?.proposals ?? []).filter((p) => p.status === 'pending').at(-1) ?? null);
  readonly typingNames = computed(() => {
    const now = this.now();
    return Object.entries(this.typing()).filter(([, at]) => now - at < TYPING_TTL_MS).map(([name]) => name);
  });
  readonly mentionOptions = computed(() => {
    const q = (this.mentionQuery() ?? '').toLowerCase();
    const names = [SPECIALIST_NAME.split(' ')[0], ...this.people().map((p) => p.name.split(' ')[0])];
    return Array.from(new Set(names)).filter((n) => n.toLowerCase().startsWith(q)).slice(0, 6);
  });
  readonly runLabel = computed(() => {
    const r = this.run();
    if (!r || !isRunActive(r)) return null;
    if (r.status === 'queued') return r.waitReason || 'Na fila — começa em instantes';
    return r.currentActivity?.label ?? 'Pensando…';
  });
  readonly tokensLabel = computed(() => {
    const c = this.chat();
    if (!c) return '';
    const total = (c.inputTokens ?? 0) + (c.outputTokens ?? 0);
    return total >= 1_000_000 ? `${(total / 1_000_000).toFixed(1)} M` : total >= 1000 ? `${Math.round(total / 1000)} k` : `${total}`;
  });

  private refreshTimer?: ReturnType<typeof setTimeout>;
  private clock?: ReturnType<typeof setInterval>;
  private lastTypingSent = 0;
  private fileSeq = 0;
  private stickToBottom = true;
  private readonly group = executionPlanGroup(this.data.card);

  constructor() {
    this.ws.startConnection();
    this.ws.addToGroup(this.group);
    this.ws.on(CASE_CHAT_EVENT, this.onRealtime);
    this.clock = setInterval(() => this.now.set(Date.now()), 1000);
    this.load();
    effect(() => {
      const c = this.chat();
      if (!c) return;
      this.photos.ensure([...c.participants.map((p) => p.userId), ...c.messages.map((m) => m.authorUserId), this.me?.externalId]);
    });
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.boxRef?.nativeElement.focus(), 50);
  }

  ngOnDestroy(): void {
    this.ws.off(CASE_CHAT_EVENT, this.onRealtime);
    this.ws.removeFromGroup(this.group);
    clearInterval(this.clock);
    clearTimeout(this.refreshTimer);
    if (this.voice.recording()) this.voice.cancel();
    for (const url of Object.values(this.blobs())) URL.revokeObjectURL(url);
    for (const p of this.pending()) if (p.preview) URL.revokeObjectURL(p.preview);
  }

  close(): void {
    this.ref.close();
  }

  // ── Carga e tempo real ─────────────────────────────────────────────────────────────────────────

  load(): void {
    this.api.get(this.data.card).subscribe({
      next: (c) => {
        this.loading.set(false);
        this.loadError.set(false);
        this.stickToBottom = this.isAtBottom();
        this.chat.set(c);
        this.status.markSeen(this.data.card, c.messages.at(-1)?.number ?? 0);
        if (this.stickToBottom) this.scrollToEnd();
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set(true);
      }
    });
  }

  private onRealtime = (p: CaseChatRealtimePayload): void => {
    if (!p || `${p.cardNumber}` !== this.data.card) return;
    if (p.action === 'typing') {
      if (p.userId && p.userId.toLowerCase() === this.myId) return;
      if (p.by) this.typing.update((t) => ({ ...t, [p.by!]: Date.now() }));
      return;
    }
    if (p.action === 'activity') {
      const c = this.chat();
      if (c?.run && c.run.id === p.requestId) {
        this.chat.set({ ...c, run: { ...c.run, status: (p.status as any) ?? c.run.status, currentActivity: p.activity ?? null, recentActivities: p.recent ?? [] } });
        this.scrollIfNear();
        return;
      }
    }
    if (p.action === 'message') {
      // A mensagem chegou: quem escreveu parou de digitar.
      this.typing.set({});
    }
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.load(), REFRESH_DEBOUNCE_MS);
  };

  // ── Envio ──────────────────────────────────────────────────────────────────────────────────────

  send(textOverride?: string): void {
    const text = (textOverride ?? this.draft).trim();
    const files = this.pending().map((p) => p.file);
    if ((!text && !files.length) || this.sending()) return;
    this.sending.set(true);
    const replyTo = this.replyTo()?.number ?? null;
    this.api.post(this.data.card, { text, files, peopleOnly: this.peopleOnly, deep: this.deep, replyTo }).subscribe({
      next: (m) => {
        this.sending.set(false);
        if (textOverride === undefined) this.draft = '';
        this.clearPending();
        this.replyTo.set(null);
        this.deep = false;
        this.appendMine(m);
      },
      error: (err) => {
        this.sending.set(false);
        this.snack.open(planApiError(err, 'Não foi possível enviar a mensagem.'), 'Fechar', { duration: 8000 });
      }
    });
  }

  private appendMine(m: CaseMessage): void {
    const c = this.chat();
    if (c && !c.messages.some((x) => x.id === m.id)) this.chat.set({ ...c, messages: [...c.messages, m] });
    this.scrollToEnd();
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.load(), 600);
  }

  quickSend(text: string): void {
    if (this.draft.trim()) {
      this.draft = `${this.draft.trim()}\n${text}`;
      this.boxRef?.nativeElement.focus();
      return;
    }
    this.send(text);
  }

  onKey(event: KeyboardEvent): void {
    if (this.mentionQuery() !== null && this.mentionOptions().length && (event.key === 'Enter' || event.key === 'Tab')) {
      event.preventDefault();
      this.pickMention(this.mentionOptions()[0]);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.send();
    }
    if (event.key === 'Escape' && this.mentionQuery() !== null) this.mentionQuery.set(null);
  }

  onInput(): void {
    const box = this.boxRef?.nativeElement;
    const before = (box ? this.draft.slice(0, box.selectionStart ?? this.draft.length) : this.draft);
    const m = /(?:^|\s)@([\p{L}\p{N}._-]*)$/u.exec(before);
    this.mentionQuery.set(m ? m[1] : null);
    const now = Date.now();
    if (this.draft.trim() && now - this.lastTypingSent > TYPING_EVERY_MS) {
      this.lastTypingSent = now;
      this.api.typing(this.data.card).subscribe({ error: () => {} });
    }
  }

  pickMention(name: string): void {
    const box = this.boxRef?.nativeElement;
    const caret = box?.selectionStart ?? this.draft.length;
    const before = this.draft.slice(0, caret).replace(/@([\p{L}\p{N}._-]*)$/u, `@${name} `);
    this.draft = before + this.draft.slice(caret);
    this.mentionQuery.set(null);
    setTimeout(() => { box?.focus(); box?.setSelectionRange(before.length, before.length); });
  }

  reply(m: CaseMessage): void {
    this.replyTo.set(m);
    this.boxRef?.nativeElement.focus();
  }

  // ── Arquivos ───────────────────────────────────────────────────────────────────────────────────

  pick(): void {
    this.pickerRef?.nativeElement.click();
  }

  onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.addFiles(input.files);
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
    this.dropping.set(true);
  }

  onDrop(event: DragEvent): void {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    this.dropping.set(false);
    this.addFiles(event.dataTransfer.files);
  }

  addFiles(list: FileList | File[] | null | undefined, pasted = false): void {
    const files = Array.from(list ?? []);
    const next = [...this.pending()];
    for (const raw of files) {
      if (next.length >= MAX_FILES) { this.snack.open(`No máximo ${MAX_FILES} arquivos por mensagem.`, 'Ok', { duration: 4000 }); break; }
      if (raw.size > MAX_FILE_BYTES) { this.snack.open(`${raw.name} passa de 10 MB.`, 'Ok', { duration: 5000 }); continue; }
      const file = pasted && raw.type.startsWith('image/')
        ? new File([raw], `colado-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}-${++this.fileSeq}.${raw.type.split('/')[1] || 'png'}`, { type: raw.type })
        : raw;
      next.push({ id: ++this.fileSeq, file, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null });
    }
    this.pending.set(next);
  }

  removePending(p: PendingFile): void {
    if (p.preview) URL.revokeObjectURL(p.preview);
    this.pending.set(this.pending().filter((x) => x.id !== p.id));
  }

  private clearPending(): void {
    for (const p of this.pending()) if (p.preview) URL.revokeObjectURL(p.preview);
    this.pending.set([]);
  }

  blob(file: CaseFile): string | null {
    const url = this.blobs()[file.id];
    if (url) return url;
    if (!this.loadingBlobs.has(file.id) && (file.kind === 'image' || file.kind === 'audio')) {
      this.loadingBlobs.add(file.id);
      this.api.content(this.data.card, file).subscribe({
        next: (b) => this.blobs.update((m) => ({ ...m, [file.id]: URL.createObjectURL(b) })),
        error: () => {}
      });
    }
    return null;
  }

  download(file: CaseFile): void {
    this.api.content(this.data.card, file).subscribe({
      next: (b) => saveBlob(b, file.name),
      error: () => this.snack.open(`Não foi possível baixar ${file.name}.`, 'Fechar', { duration: 6000 })
    });
  }

  openImage(file: CaseFile): void {
    const url = this.blob(file);
    if (url) window.open(url, '_blank', 'noopener');
  }

  // ── Voz ────────────────────────────────────────────────────────────────────────────────────────

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
    const r = this.voiceReview();
    if (!r || this.sending()) return;
    this.sending.set(true);
    this.api.post(this.data.card, {
      voice: true, transcript: this.voiceTranscript.trim(), files: [r.file], peopleOnly: this.peopleOnly, deep: this.deep,
      replyTo: this.replyTo()?.number ?? null
    }).subscribe({
      next: (m) => {
        this.sending.set(false);
        this.voiceReview.set(null);
        this.voiceTranscript = '';
        this.replyTo.set(null);
        this.appendMine(m);
      },
      error: (err) => {
        this.sending.set(false);
        this.snack.open(planApiError(err, 'Não foi possível enviar o áudio.'), 'Fechar', { duration: 8000 });
      }
    });
  }

  // ── Propostas, ações, pontos ───────────────────────────────────────────────────────────────────

  proposalOf(m: CaseMessage): CaseProposal | null {
    return m.proposalId ? this.proposalsById().get(m.proposalId) ?? null : null;
  }

  actionOf(m: CaseMessage): CaseAction | null {
    return m.actionId ? this.actionsById().get(m.actionId) ?? null : null;
  }

  openProposal(p: CaseProposal): void {
    const data: CaseProposalDialogData = { card: this.data.card, proposal: p, canDecide: !!this.chat()?.canDecide, hasPlan: !!this.chat()?.hasPlan };
    this.dialog.open(CaseProposalDialogComponent, { data, width: '1100px', maxWidth: '96vw', maxHeight: '92vh', autoFocus: false })
      .afterClosed().subscribe((changed) => { if (changed) this.load(); });
  }

  decideProposal(p: CaseProposal, accept: boolean, execute = false): void {
    if (this.sending()) return;
    this.sending.set(true);
    this.api.decideProposal(this.data.card, p.id, accept, execute).subscribe({
      next: () => {
        this.sending.set(false);
        this.snack.open(accept ? 'Proposta aceita — o Claude do tratamento monta a nova versão do plano.' : 'Proposta recusada.', 'Ok', { duration: 6000 });
        this.load();
      },
      error: (err) => {
        this.sending.set(false);
        this.snack.open(planApiError(err, 'Não foi possível decidir a proposta.'), 'Fechar', { duration: 8000 });
      }
    });
  }

  decideAction(a: CaseAction, confirm: boolean): void {
    this.api.decideAction(this.data.card, a.id, confirm).subscribe({
      next: () => this.load(),
      error: (err) => this.snack.open(planApiError(err, 'Não foi possível decidir a ação.'), 'Fechar', { duration: 8000 })
    });
  }

  toPlan(m: CaseMessage): void {
    this.api.toPlan(this.data.card, m.id).subscribe({
      next: () => this.snack.open(`Mensagem ${m.number} levada para o plano — o Claude do tratamento considera na próxima vez.`, 'Ok', { duration: 6000 }),
      error: (err) => this.snack.open(planApiError(err, 'Não foi possível levar para o plano.'), 'Fechar', { duration: 8000 })
    });
  }

  pin(m: CaseMessage): void {
    const text = (m.kind === 'voice' ? m.transcript : m.text) ?? '';
    const short = text.replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!short) return;
    this.api.addPoint(this.data.card, short, m.number).subscribe({
      next: () => this.load(),
      error: (err) => this.snack.open(planApiError(err, 'Não foi possível fixar o ponto.'), 'Fechar', { duration: 8000 })
    });
  }

  setPoint(p: CasePoint, status: CasePoint['status']): void {
    this.api.point(this.data.card, p.id, status).subscribe({ next: () => this.load(), error: () => {} });
  }

  askAgain(deep = false): void {
    this.api.ask(this.data.card, deep).subscribe({
      next: () => this.load(),
      error: (err) => this.snack.open(planApiError(err, 'Não foi possível chamar o especialista.'), 'Fechar', { duration: 8000 })
    });
  }

  stopRun(): void {
    this.api.cancelRun(this.data.card).subscribe({ next: () => this.load(), error: () => {} });
  }

  edit(m: CaseMessage): void {
    this.draft = m.text;
    this.api.remove(this.data.card, m.id).subscribe({ next: () => this.load(), error: () => {} });
    this.boxRef?.nativeElement.focus();
  }

  remove(m: CaseMessage): void {
    this.api.remove(this.data.card, m.id).subscribe({
      next: () => this.load(),
      error: (err) => this.snack.open(planApiError(err, 'Não foi possível apagar.'), 'Fechar', { duration: 8000 })
    });
  }

  // ── Apresentação ───────────────────────────────────────────────────────────────────────────────

  isMine(m: CaseMessage): boolean {
    return m.authorKind === 'person' && !!m.authorUserId && m.authorUserId.toLowerCase() === this.myId;
  }

  messageTextOf(n: number | null | undefined): string {
    if (!n) return '';
    const m = this.messages().find((x) => x.number === n);
    const t = m ? (m.kind === 'voice' ? m.transcript ?? 'mensagem de voz' : m.text) : '';
    return t.length > 90 ? t.slice(0, 90) + '…' : t;
  }

  authorOf(n: number | null | undefined): string {
    const m = n ? this.messages().find((x) => x.number === n) : null;
    return m ? (m.authorKind === 'specialist' ? 'Especialista' : m.authorName) : '';
  }

  /** Separador de dia entre mensagens. */
  newDay(i: number): boolean {
    const list = this.messages();
    if (i === 0) return true;
    return new Date(list[i - 1].createdAt).toDateString() !== new Date(list[i].createdAt).toDateString();
  }

  duration(ms?: number | null): string {
    if (!ms) return '';
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
  }

  tokens(m: CaseMessage): string {
    const t = (m.inputTokens ?? 0) + (m.outputTokens ?? 0);
    if (!t) return '';
    return t >= 1000 ? `${(t / 1000).toFixed(1)} k tokens` : `${t} tokens`;
  }

  changeIcon(kind: string): string {
    return ({ add: 'add', remove: 'remove', decision: 'how_to_reg', keep: 'check' } as Record<string, string>)[kind] ?? 'edit';
  }

  fileIcon(f: CaseFile): string {
    if (f.kind === 'image') return 'image';
    if (f.kind === 'audio') return 'graphic_eq';
    if (/\.(sql)$/i.test(f.name)) return 'code';
    if (/\.(csv|json)$/i.test(f.name)) return 'dataset';
    return 'description';
  }

  pointIcon(p: CasePoint): string {
    return p.status === 'agreed' ? 'check_circle' : 'pending';
  }

  seconds(s: number): string {
    return `${Math.floor(s / 60)}:${`${s % 60}`.padStart(2, '0')}`;
  }

  trackMessage = (_: number, m: CaseMessage) => m.id;

  onScroll(): void {
    this.stickToBottom = this.isAtBottom();
  }

  private isAtBottom(): boolean {
    const el = this.scrollRef?.nativeElement;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  private scrollIfNear(): void {
    if (this.isAtBottom()) this.scrollToEnd();
  }

  private scrollToEnd(): void {
    setTimeout(() => {
      const el = this.scrollRef?.nativeElement;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }, 30);
  }
}
