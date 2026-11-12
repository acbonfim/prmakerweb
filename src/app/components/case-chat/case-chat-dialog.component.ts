import {
  AfterViewInit,
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  ViewChild,
  afterNextRender,
  computed,
  effect,
  inject,
  signal
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { StorageService } from '../../services/storage.service';
import { CaseChatService } from '../../services/case-chat.service';
import { UserPhotoService } from '../../services/user-photo.service';
import { CaseChatStore, CaseRoom, PendingFile } from '../../services/case-chat-store.service';
import { planApiError, saveBlob } from '../../services/execution-plan.service';
import { PlanMarkdownPipe } from '../execution-plan/plan-markdown.pipe';
import { CodeRefHostDirective } from '../code-ref/code-ref-host.directive';
import { UserAvatarComponent } from '../user-avatar/user-avatar.component';
import { SpecialistToolsComponent } from '../specialist-tools/specialist-tools.component';
import {
  CaseAction,
  CaseDelivery,
  CaseFile,
  CaseMessage,
  CasePoint,
  CaseProposal,
  CaseViewMessage,
  SPECIALIST_NAME,
  isRunActive
} from './case-chat.model';
import { VoiceRecorder, VoiceResult } from './voice-recorder';
import { CaseProposalDialogComponent, CaseProposalDialogData } from './case-proposal-dialog.component';
import { CaseComposer, CaseComposerService } from './case-composer.service';
import { ComposerAction, ComposerSuggestion } from './composer-suggest';
import { ComposerSuggestComponent } from './composer-suggest.component';
import { StickyScroll, flyToChat } from './chat-motion';
import { TokenUsageComponent } from '../token-usage/token-usage.component';
import { TokenUsage } from '../../services/token-pricing.service';
import { formatTokens, formatUsd } from '../../services/ai-usage.service';

export interface CaseChatDialogData {
  card: string;
  /** Tipo do card — as ferramentas do especialista mudam com ele (padrão: bug). */
  cardType?: 'bug' | 'user-story';
  /** 0090: abre já no formulário desta ferramenta (o `/ferramenta` da conversa compacta). */
  tool?: string;
}

/** Resultado ao fechar: `openItem` = item de trabalho criado/aberto por uma ferramenta (quem hospeda mostra o item). */
export interface CaseChatDialogResult {
  openItem?: number;
}

/** Mesmos limites da API (10 MB por arquivo, 20 por mensagem). */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 20;
/** "Fulano está digitando" some depois disso sem novo sinal. */
const TYPING_TTL_MS = 6000;
/** Sinal de digitando no máximo a cada... */
const TYPING_EVERY_MS = 4000;

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
  imports: [DatePipe, FormsModule, MatDialogModule, MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule, MatBadgeModule,
    PlanMarkdownPipe, CodeRefHostDirective, UserAvatarComponent, SpecialistToolsComponent, ComposerSuggestComponent, TokenUsageComponent],
  templateUrl: './case-chat-dialog.component.html',
  styleUrls: ['./case-chat-dialog.component.css']
})
export class CaseChatDialogComponent implements AfterViewInit, OnDestroy {
  readonly data = inject<CaseChatDialogData>(MAT_DIALOG_DATA);
  private ref = inject<MatDialogRef<CaseChatDialogComponent, CaseChatDialogResult>>(MatDialogRef);
  private api = inject(CaseChatService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);
  readonly photos = inject(UserPhotoService);
  private store = inject(CaseChatStore);
  private composerSvc = inject(CaseComposerService);
  /** 0090: `/` comandos e ferramentas, `#` itens de trabalho. */
  readonly composer = new CaseComposer(this.composerSvc, () => this.data.card, () => this.data.cardType ?? 'bug');
  /** 0081: a conversa fica em memória (CaseChatStore) — fechar e abrir de novo não recarrega nem perde o rascunho. */
  private readonly room: CaseRoom = this.store.room(this.data.card);
  private readonly me = inject(StorageService).getAccess()?.user ?? null;

  readonly specialistName = SPECIALIST_NAME;
  readonly quick = QUICK;
  readonly myId = (this.me?.externalId ?? '').toLowerCase();

  readonly chat = this.room.chat;
  readonly loading = this.room.loading;
  readonly loadError = this.room.loadError;
  /** Decidindo proposta/enviando áudio (o texto não trava: sai na hora, como no WhatsApp). */
  readonly sending = signal(false);
  /** O botão de enviar "decola" a cada envio. */
  readonly launching = signal(false);
  private launchTimer?: ReturnType<typeof setTimeout>;
  /** Abre na mensagem mais nova e segue o fim enquanto o conteúdo cresce, até a pessoa rolar para cima. */
  readonly sticky = new StickyScroll(80);
  /** Mensagens que chegaram com a conversa aberta (entram animadas); as que já estavam, não. */
  readonly fresh = new Set<string>();
  private known: Set<string> | null = null;
  private injector = inject(Injector);
  readonly showHistory = signal(false);
  /** Ferramentas do especialista (painel sobre a conversa) e quantas se aplicam ao card (contagem do ícone). */
  readonly toolsOpen = signal(false);
  readonly toolCount = signal<number | null>(null);
  readonly showAside = signal(window.matchMedia('(min-width: 1000px)').matches);
  readonly typing = this.room.typing;
  readonly now = signal(Date.now());
  readonly replyTo = this.room.replyTo;
  readonly pending = this.room.pending;
  readonly dropping = signal(false);
  readonly mentionQuery = signal<string | null>(null);
  get draft(): string { return this.room.draft.text; }
  set draft(v: string) { this.room.draft.text = v; }
  get peopleOnly(): boolean { return this.room.draft.peopleOnly; }
  set peopleOnly(v: boolean) { this.room.draft.peopleOnly = v; }
  get deep(): boolean { return this.room.draft.deep; }
  set deep(v: boolean) { this.room.draft.deep = v; }

  readonly voice = new VoiceRecorder();
  readonly voiceReview = signal<VoiceResult | null>(null);
  voiceTranscript = '';
  readonly canRecord = VoiceRecorder.supported();
  /** Celular: textos de ajuda mais curtos. */
  readonly compact = window.matchMedia('(max-width: 640px)').matches;


  @ViewChild('scroll') private scrollRef?: ElementRef<HTMLDivElement>;
  @ViewChild('box') private boxRef?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('picker') private pickerRef?: ElementRef<HTMLInputElement>;
  @ViewChild(SpecialistToolsComponent) private toolsRef?: SpecialistToolsComponent;

  /** As do servidor e, no fim, as que estão saindo deste navegador (⏱). */
  readonly messages = computed<CaseViewMessage[]>(() => this.room.view());
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
  /**
   * Consumo desde o último /clear, com a entrada separada: o número antigo somava tudo desde que a conversa existe e
   * contava o cache lido (≈ 1/10 do preço) como entrada — 7 M de "entrada" no 78161 eram 97% cache lido.
   */
  readonly usage = computed<TokenUsage | null>(() => {
    const c = this.chat();
    if (!c) return null;
    const u = c.usage;
    const allTime = `Desde o início da conversa: entrada ${formatTokens(c.inputTokens ?? 0)} (com o cache lido) · saída ${formatTokens(c.outputTokens ?? 0)} · ${formatUsd(c.costUsd ?? 0)}.`;
    if (!u) {
      if (!c.inputTokens && !c.outputTokens) return null;
      return { input: c.inputTokens, output: c.outputTokens, reportedCostUsd: c.costUsd || null, reportedBy: 'Claude Code', title: 'Consumo do especialista nesta conversa' };
    }
    if (!u.responses && !u.inputTokens) return null;
    return {
      freshInput: u.freshInputTokens,
      cacheRead: u.cacheReadTokens,
      cacheWrite: u.cacheWriteTokens,
      input: u.freshInputTokens || u.cacheReadTokens || u.cacheWriteTokens ? null : u.inputTokens,
      output: u.outputTokens,
      reportedCostUsd: u.costUsd || null,
      reportedBy: 'Claude Code',
      calls: u.responses,
      title: u.since ? 'Consumo do especialista desde a última limpeza (/clear)' : 'Consumo do especialista nesta conversa',
      subtitle: `${u.responses} ${u.responses === 1 ? 'resposta' : 'respostas'}`,
      notes: [
        'Cada resposta relê o contexto da sessão: o cache lido é a maior parte da entrada e custa cerca de 1/10 da entrada nova.',
        u.since ? allTime : null
      ]
    };
  });

  private clock?: ReturnType<typeof setInterval>;
  private lastTypingSent = 0;

  constructor() {
    // A tela do card já acompanha o card; o modal também (aberto de outro lugar, ou se a tela fechar por baixo).
    this.store.watch(this.data.card);
    this.clock = setInterval(() => this.now.set(Date.now()), 1000);
    effect(() => {
      const c = this.chat();
      const list = this.messages();
      if (!c) return;
      this.trackFresh(list);
      this.photos.ensure([...c.participants.map((p) => p.userId), ...c.messages.map((m) => m.authorUserId), this.me?.externalId]);
      // Mensagem nova ou atividade do especialista: marca como vista (a rolagem segue o fim sozinha se a pessoa estava lá).
      this.store.markSeen(this.data.card, c.messages.at(-1)?.number ?? 0);
    });
  }

  ngAfterViewInit(): void {
    // Volta para onde estava (ou para o fim) sem animação — reabrir parece que nunca fechou. Conversa grande: continua
    // no fim enquanto o texto e as imagens ganham altura.
    const el = this.scrollRef?.nativeElement;
    if (el) this.sticky.attach(el, this.room.scrollTop);
    setTimeout(() => {
      this.boxRef?.nativeElement.focus();
      if (this.data.tool) this.openTool(this.data.tool);
    }, 0);
  }

  ngOnDestroy(): void {
    this.room.scrollTop = this.sticky.atEnd() ? null : this.sticky.scrollTop;
    this.sticky.detach();
    this.store.unwatch(this.data.card);
    clearInterval(this.clock);
    clearTimeout(this.launchTimer);
    if (this.voice.recording()) this.voice.cancel();
  }

  close(): void {
    this.ref.close();
  }

  /** Item criado (ou aberto) por uma ferramenta: fecha a conversa e quem hospeda mostra o item. */
  onToolCreated(n: number): void {
    this.ref.close({ openItem: n });
  }

  /** Pedido enviado ao especialista pela ferramenta: volta à conversa para ver a resposta chegar. */
  onToolAsked(): void {
    this.toolsOpen.set(false);
    this.load();
  }

  // ── Carga e tempo real ─────────────────────────────────────────────────────────────────────────

  load(): void {
    this.store.reload(this.data.card, 0);
  }

  // ── Envio ──────────────────────────────────────────────────────────────────────────────────────

  send(textOverride?: string): void {
    // 0090: comando digitado (`/clear`, `/cancelar-item-de-trabalho #n`, `/ferramenta`) não vai como mensagem.
    if (textOverride === undefined && !this.pending().length && this.runCommand()) return;
    const body = (textOverride ?? this.draft).trim();
    // Como no WhatsApp: vai para a conversa na hora (⏱) e o campo fica livre; o servidor confirma depois (✓).
    if (!this.store.send(this.data.card, textOverride, (m) => this.snack.open(m, 'Fechar', { duration: 8000 }))) return;
    const key = this.room.outbox().at(-1)?.key;
    this.launch();
    this.sticky.toEnd();
    afterNextRender(() => {
      this.sticky.toEnd();
      if (body) flyToChat(this.boxRef?.nativeElement, this.bubbleOf(key), body);
    }, { injector: this.injector });
    this.boxRef?.nativeElement.focus();
  }

  retry(m: CaseViewMessage): void {
    this.store.retry(this.data.card, m.key);
  }

  discard(m: CaseViewMessage): void {
    this.store.discard(this.data.card, m.key);
  }

  delivery(m: CaseViewMessage): CaseDelivery {
    return this.store.delivery(this.data.card, m);
  }

  deliveryLabel(m: CaseViewMessage): string {
    switch (this.delivery(m)) {
      case 'sending': return 'Enviando…';
      case 'failed': return 'Não foi enviada';
      case 'read': return 'Lida por ' + this.store.readBy(this.data.card, m).join(', ');
      default: return 'Recebida — ainda não lida';
    }
  }

  toEnd(): void {
    this.sticky.toEnd(true);
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
    return this.scrollRef?.nativeElement.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"] .msg__bubble`) ?? null;
  }

  /** Primeira carga: tudo "já estava". Depois, o que chega de outros entra animado (as minhas voam do campo). */
  private trackFresh(list: CaseViewMessage[]): void {
    if (!this.known) {
      if (this.loading()) return;
      this.known = new Set(list.map((m) => m.key));
      return;
    }
    for (const m of list) {
      if (this.known.has(m.key)) continue;
      this.known.add(m.key);
      if (!m.outgoing) this.fresh.add(m.key);
    }
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
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.send();
    }
    if (event.key === 'Escape' && this.mentionQuery() !== null) {
      // Esc fecha só a lista de menções, não a conversa.
      event.preventDefault();
      event.stopPropagation();
      this.mentionQuery.set(null);
    }
  }

  onInput(): void {
    const box = this.boxRef?.nativeElement;
    const before = (box ? this.draft.slice(0, box.selectionStart ?? this.draft.length) : this.draft);
    const m = /(?:^|\s)@([\p{L}\p{N}._-]*)$/u.exec(before);
    this.mentionQuery.set(m ? m[1] : null);
    this.composer.update(this.draft, before.length);
    const now = Date.now();
    if (this.draft.trim() && now - this.lastTypingSent > TYPING_EVERY_MS) {
      this.lastTypingSent = now;
      this.api.typing(this.data.card).subscribe({ error: () => {} });
    }
  }

  /** Cursor andou (clique, ←/→, Home/End): a lista segue o que está no cursor. */
  onCaret(event?: KeyboardEvent): void {
    if (event && ['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape', 'Shift'].includes(event.key)) return;
    const box = this.boxRef?.nativeElement;
    if (box) this.composer.update(this.draft, box.selectionStart ?? this.draft.length);
  }

  pickSuggestion(s: ComposerSuggestion): void {
    const action = this.composer.pick(s, this.draft);
    if (action) this.applyComposer(action);
  }

  /** Escolha da lista: completa o texto, limpa a conversa ou abre a ferramenta. */
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
        this.openTool(action.key);
        return;
    }
  }

  /** O texto inteiro é um comando? Executa e diz que tratou (não envia como mensagem). */
  private runCommand(): boolean {
    const cmd = this.composer.command(this.draft);
    if (!cmd) return false;
    switch (cmd.kind) {
      case 'clear':
        void this.clearConversation();
        return true;
      case 'tool':
        this.draft = '';
        this.openTool(cmd.key);
        return true;
      case 'cancel':
        if (!cmd.number) {
          this.snack.open('Diga qual item: /cancelar-item-de-trabalho #123 (digite # para escolher).', 'Ok', { duration: 5000 });
          return true;
        }
        void this.composerSvc.cancelItem(this.data.card, cmd.number, cmd.reason).then((ok) => { if (ok) this.draft = ''; });
        return true;
      case 'unknown':
        this.snack.open(`Não existe o comando /${cmd.name} — digite / no começo da mensagem para ver os comandos e as ferramentas.`, 'Ok', { duration: 6000 });
        return true;
    }
  }

  private async clearConversation(): Promise<void> {
    if (!(await this.composerSvc.clear(this.data.card))) return;
    this.draft = '';
    this.replyTo.set(null);
    this.room.scrollTop = null;
    this.sticky.toEnd();
    this.load();
  }

  /** Abre o painel de Ferramentas já no formulário da ferramenta. */
  openTool(key: string): void {
    this.toolsOpen.set(true);
    this.toolsRef?.openTool(key);
  }

  pickMention(name: string): void {
    const box = this.boxRef?.nativeElement;
    const current = box?.value ?? this.draft;
    const caret = box?.selectionStart ?? current.length;
    const before = current.slice(0, caret).replace(/@([\p{L}\p{N}._-]*)$/u, `@${name} `);
    const next = before + current.slice(caret);
    // Na hora (não no próximo ciclo): quem digita rápido não embaralha o texto.
    this.draft = next;
    if (box) {
      box.value = next;
      box.focus();
      box.setSelectionRange(before.length, before.length);
    }
    this.mentionQuery.set(null);
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
    this.store.addFiles(this.data.card, Array.from(list ?? []), pasted, MAX_FILES, MAX_FILE_BYTES,
      (m) => this.snack.open(m, 'Ok', { duration: 5000 }));
  }

  removePending(p: PendingFile): void {
    this.store.removePending(this.data.card, p);
  }

  blob(file: CaseFile): string | null {
    return this.store.blob(this.data.card, file);
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
        this.store.appendMine(this.data.card, m);
        this.sticky.toEnd();
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
    if (!ms || ms < 1000) return '';
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

  onScroll(): void {
    this.sticky.onScroll();
  }
}
