import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription, firstValueFrom } from 'rxjs';
import { TimelineService } from '../../services/timeline.service';
import { AuthService } from '../../services/auth.service';
import { StorageService } from '../../services/storage.service';
import { TeamsGraphService, TeamsChat } from '../../services/teams-graph.service';
import { WsService } from '../../services/ws.service';
import { TimelineEntry } from './timeline.model';
import { TimelineMarkdownPipe } from '../../pipes/timeline-markdown.pipe';
import { BackNavigationService } from '../../services/back-navigation.service';

/** Evento e prefixo de grupo do tempo real da timeline (em sincronia com o backend). */
const TIMELINE_EVENT = 'timelineUpdated';
const timelineGroup = (card: string) => `timeline:${card}`;

/** Animação da tela cheia (feature 0020): o chat cresce do lugar até o modal e encolhe de volta. */
const EXPAND_ANIMATION: KeyframeAnimationOptions = { duration: 320, easing: 'cubic-bezier(0.2, 0, 0, 1)' };
type Rect = { top: number; left: number; width: number; height: number };

/**
 * Componente compartilhado de linha do tempo de um card.
 * Exibe os registros no estilo de comentários de rede social e permite
 * que o usuário logado registre, edite e exclua suas próprias entradas.
 *
 * Estado reativo em signals (a app roda com change detection zoneless).
 */
@Component({
  selector: 'app-card-timeline',
  standalone: true,
  imports: [
    TimelineMarkdownPipe,
    CommonModule,
    FormsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatButtonModule,
    MatTooltipModule
  ],
  templateUrl: './card-timeline.component.html',
  styleUrls: ['./card-timeline.component.css']
})
export class CardTimelineComponent implements OnDestroy {
  readonly entries = signal<TimelineEntry[]>([]);
  readonly isLoading = signal(false);
  /** Atualização discreta (via WebSocket) de um comentário NOVO: mostra um skeleton no fim. */
  readonly isRefreshing = signal(false);
  /**
   * Ids dos comentários sendo atualizados/excluídos por outro cliente (via WebSocket).
   * Cada um renderiza um skeleton no lugar do próprio comentário até o refetch concluir.
   */
  readonly refreshingIds = signal<ReadonlySet<number>>(new Set());
  readonly isPosting = signal(false);
  readonly loadError = signal(false);
  newEntry = '';

  /**
   * Placeholders da carga inicial (não-realtime): vários comentários de tamanhos variados
   * que preenchem o container enquanto os dados chegam. Gerados uma vez (visual estável).
   */
  readonly loadingSkeletons = Array.from({ length: 8 }, () => {
    const rnd = (min: number, max: number) => Math.round(min + Math.random() * (max - min));
    const lineCount = 1 + Math.floor(Math.random() * 3); // 1 a 3 linhas de conteúdo
    return {
      meta: `${rnd(24, 46)}%`,
      lines: Array.from({ length: lineCount }, (_, i) =>
        `${i === lineCount - 1 ? rnd(30, 55) : rnd(72, 98)}%`)
    };
  });

  // Edição / exclusão dos próprios registros
  currentUserId: string | null = null;
  readonly editingId = signal<number | null>(null);
  editText = '';
  readonly isSavingEdit = signal(false);
  readonly confirmDeleteId = signal<number | null>(null);
  readonly deletingId = signal<number | null>(null);

  // Importação de mensagens do Teams (login do próprio usuário via MSAL).
  /** Escondido por ora (feature 0020); o código fica para uso futuro — basta ligar a flag. */
  readonly teamsImportEnabled = false;
  readonly showImport = signal(false);
  readonly teamsConnected = signal(false);
  readonly teamsAccount = signal<string | null>(null);
  readonly chats = signal<TeamsChat[]>([]);
  selectedChatId = '';
  readonly isConnecting = signal(false);
  readonly isLoadingChats = signal(false);
  readonly isImporting = signal(false);
  readonly importResult = signal<{ imported: number; skipped: number; total: number } | null>(null);
  readonly importError = signal<string | null>(null);

  get teamsConfigured(): boolean {
    return this.teamsGraph.isConfigured;
  }

  private _cardNumber: string | null = null;

  @Input()
  set cardNumber(value: string | number | null | undefined) {
    const normalized =
      value !== null && value !== undefined && `${value}`.trim() !== ''
        ? `${value}`.trim()
        : null;

    if (normalized === this._cardNumber) {
      return;
    }

    this._cardNumber = normalized;
    this.switchTimelineGroup(normalized);

    if (!normalized) {
      this.entries.set([]);
      return;
    }

    if (this.autoLoad) {
      this.load();
    }
  }

  get cardNumber(): string | null {
    return this._cardNumber;
  }

  /** Quando true, alterar [cardNumber] dispara a busca automaticamente. */
  @Input() autoLoad = false;

  /** Permite (ou não) registrar novas entradas pelo rodapé. */
  @Input() canPost = true;

  @Output() entryAdded = new EventEmitter<TimelineEntry>();

  @ViewChild('body') private bodyRef?: ElementRef<HTMLDivElement>;
  @ViewChild('timeline') private timelineRef?: ElementRef<HTMLDivElement>;

  /**
   * Tela cheia (feature 0020). É o MESMO elemento (rascunho, edição, tempo real e rolagem
   * continuam): enquanto aberta, o `.timeline` vai para o <body> — nenhum transform/overflow de
   * ancestral atrapalha o position: fixed — e volta para o host ao fechar.
   */
  readonly expanded = signal(false);
  private animating = false;
  /** Abrir/fechar em fila: um clique durante a animação vale quando ela termina (não se perde). */
  private transition: Promise<void> = Promise.resolve();
  private destroyed = false;
  private backdrop?: HTMLDivElement;
  private previousHtmlOverflow = '';
  /** 0043: a página rola na .content-area — trava junto com o <html> enquanto a tela cheia está aberta. */
  private lockedScrollers: { el: HTMLElement; overflow: string }[] = [];
  /** 0043: Voltar do app/sistema fecha a tela cheia. */
  private readonly back = inject(BackNavigationService);
  private releaseBack?: () => void;

  private sub?: Subscription;
  private resyncSub?: Subscription;
  private currentGroup: string | null = null;

  readonly photos = signal<Record<string, string>>({});

  constructor(
    private timelineService: TimelineService,
    private storageService: StorageService,
    private teamsGraph: TeamsGraphService,
    private ws: WsService,
    private authService: AuthService,
    private snackBar: MatSnackBar,
    private hostRef: ElementRef<HTMLElement>
  ) {
    const access = this.storageService.getAccess();
    this.currentUserId = access && access.user ? (access.user.externalId ?? null) : null;

    // Atualização em tempo real: recarrega quando a timeline deste card muda em outro cliente.
    this.ws.startConnection();
    this.ws.on(TIMELINE_EVENT, this.onTimelineUpdated);
    // Conexão voltou após cair: os eventos da queda se perderam, recarrega em silêncio.
    this.resyncSub = this.ws._resynced.subscribe(() => {
      if (this._cardNumber) this.load(undefined, { silent: true });
    });
  }

  /** Recebe o sinal do servidor e refaz o fetch autenticado (padrão sinal + refetch). */
  private onTimelineUpdated = (payload: any): void => {
    const card =
      payload?.cardNumber !== null && payload?.cardNumber !== undefined
        ? `${payload.cardNumber}`.trim()
        : null;
    if (!(card && this._cardNumber && card === this._cardNumber)) {
      return;
    }

    const action = payload?.action;
    const entryId = Number(payload?.entryId);
    const hasEntry = Number.isFinite(entryId) && entryId > 0;

    // update/delete de um comentário existente: skeleton NO comentário afetado.
    if ((action === 'update' || action === 'delete') && hasEntry && this.entries().some((e) => e.id === entryId)) {
      this.refreshingIds.update((set) => new Set(set).add(entryId));
      // Leva o usuário até o registro que está mudando.
      this.scrollToEntry(entryId);
    } else {
      // create (ou payload sem detalhe): skeleton de comentário novo no fim.
      this.isRefreshing.set(true);
      // Revela o skeleton do novo comentário mesmo com a lista cheia/rolada pra cima.
      this.scrollToBottom();
    }

    // Atualização discreta: mantém a lista e refaz o fetch, sem tela cheia de "carregando".
    this.load(undefined, { silent: true });
  };

  /** Entra no grupo do card atual e sai do anterior. */
  private switchTimelineGroup(card: string | null): void {
    const group = card ? timelineGroup(card) : null;
    if (group === this.currentGroup) return;
    if (this.currentGroup) this.ws.removeFromGroup(this.currentGroup);
    this.currentGroup = group;
    if (group) this.ws.addToGroup(group);
  }

  get canSubmit(): boolean {
    return (
      this.canPost &&
      !this.isPosting() &&
      !!this._cardNumber &&
      this.newEntry.trim().length > 0
    );
  }

  /**
   * (Re)carrega a linha do tempo de um card.
   * `silent` (atualização via WebSocket): mantém a lista atual visível e não rola nem mostra
   * estado de erro. Qual skeleton exibir (comentário novo no fim vs. um comentário específico)
   * é decidido por quem chama, via `isRefreshing` / `refreshingIds`.
   */
  load(cardNumber?: string | number, options?: { silent?: boolean }): void {
    const card =
      cardNumber !== null && cardNumber !== undefined
        ? `${cardNumber}`.trim()
        : this._cardNumber;

    if (!card) {
      this.entries.set([]);
      return;
    }

    this._cardNumber = card;
    this.switchTimelineGroup(card);

    // Só é discreto quando já há algo na tela para preservar; senão, carga normal (skeletons cheios).
    const silent = options?.silent === true && this.entries().length > 0;
    if (!silent) {
      this.isLoading.set(true);
      this.loadError.set(false);
    }

    this.sub?.unsubscribe();
    this.sub = this.timelineService.getByCardNumber(card).subscribe({
      next: (data) => {
        // Mais antigo em cima, mais recente embaixo.
        const sorted = (data ?? [])
          .slice()
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        this.entries.set(sorted);
        this.ensurePhotos(sorted);
        this.clearSkeletons();
        // Numa atualização discreta preserva a posição de leitura; só rola na carga inicial.
        if (!silent) this.scrollToBottom();
      },
      error: () => {
        // Best-effort: numa atualização discreta, não destrói a lista nem mostra erro.
        if (silent) {
          this.clearSkeletons();
          return;
        }
        this.entries.set([]);
        this.clearSkeletons();
        this.loadError.set(true);
      }
    });
  }

  /** Zera todos os indicadores de skeleton (carga concluída ou interrompida). */
  private clearSkeletons(): void {
    this.isLoading.set(false);
    this.isRefreshing.set(false);
    if (this.refreshingIds().size > 0) this.refreshingIds.set(new Set());
  }

  submit(): void {
    if (!this.canSubmit || !this._cardNumber) {
      return;
    }

    const description = this.newEntry.trim();
    this.isPosting.set(true);

    this.timelineService
      .create({ cardNumber: this._cardNumber, description })
      .subscribe({
        next: (created) => {
          if (created) {
            // Registro mais recente vai para o fim da lista.
            this.entries.update((list) => [...list, created]);
            this.entryAdded.emit(created);
          } else {
            this.load();
          }
          this.newEntry = '';
          this.isPosting.set(false);
          this.scrollToBottom();
        },
        error: (err) => {
          // O texto digitado fica no campo; a mensagem diz o motivo (ex.: acima do limite).
          this.isPosting.set(false);
          this.showSaveError(err, 'Não foi possível salvar o registro.');
        }
      });
  }

  toggleImport(): void {
    this.showImport.update((v) => !v);
    this.importResult.set(null);
    this.importError.set(null);
  }

  /** Login do próprio usuário no Teams e carregamento dos grupos a que ele tem acesso. */
  async connectTeams(): Promise<void> {
    if (this.isConnecting()) {
      return;
    }
    this.isConnecting.set(true);
    this.importError.set(null);

    try {
      const name = await this.teamsGraph.login();
      this.teamsAccount.set(name);
      this.teamsConnected.set(true);
      await this.loadChats();
    } catch {
      this.importError.set('Não foi possível conectar ao Teams.');
    } finally {
      this.isConnecting.set(false);
    }
  }

  private async loadChats(): Promise<void> {
    this.isLoadingChats.set(true);
    try {
      const chats = await this.teamsGraph.listChats();
      this.chats.set(chats);
    } catch {
      this.importError.set('Não foi possível carregar os grupos do Teams.');
    } finally {
      this.isLoadingChats.set(false);
    }
  }

  chatLabel(chat: TeamsChat): string {
    return chat.topic?.trim() || '(grupo sem nome)';
  }

  /** Lê as mensagens do grupo selecionado e as importa para a linha do tempo do card. */
  async importSelected(): Promise<void> {
    const card = this._cardNumber;
    const chatId = this.selectedChatId;
    if (!card || !chatId || this.isImporting()) {
      return;
    }

    this.isImporting.set(true);
    this.importResult.set(null);
    this.importError.set(null);

    try {
      const messages = await this.teamsGraph.listMessages(chatId);
      let imported = 0;
      let skipped = 0;
      let total = 0;

      for (const m of messages) {
        if (m.messageType !== 'message' || m.deletedDateTime) continue;
        if (!m.text || m.text.length < 3) continue;

        total++;
        const res = await firstValueFrom(
          this.timelineService.ingestTeamsMessage({
            cardNumber: card,
            messageId: m.id,
            text: m.text,
            userName: m.fromDisplayName ?? 'Teams',
            occurredAt: m.createdDateTime
          })
        );
        if (res?.imported) imported++;
        else skipped++;
      }

      this.importResult.set({ imported, skipped, total });
      this.load(); // recarrega a linha do tempo com as novas mensagens
    } catch {
      this.importError.set('Não foi possível importar as mensagens do Teams.');
    } finally {
      this.isImporting.set(false);
    }
  }

  onKeydown(event: KeyboardEvent): void {
    // Enter envia; Shift+Enter quebra linha.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.submit();
    }
  }

  /** Indica se o registro foi criado pelo usuário logado (pode editar/excluir). */
  isMine(entry: TimelineEntry): boolean {
    return (
      !!entry.userId &&
      !!this.currentUserId &&
      entry.userId.toLowerCase() === this.currentUserId.toLowerCase()
    );
  }

  startEdit(entry: TimelineEntry): void {
    this.editingId.set(entry.id);
    this.editText = entry.description;
    this.confirmDeleteId.set(null);
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.editText = '';
  }

  saveEdit(entry: TimelineEntry): void {
    const description = this.editText.trim();
    if (!description || this.isSavingEdit()) {
      return;
    }

    this.isSavingEdit.set(true);

    this.timelineService.update(entry.id, { description }).subscribe({
      next: (updated) => {
        this.entries.update((list) =>
          list.map((e) => (e.id === entry.id ? (updated ?? { ...e, description }) : e))
        );
        this.editingId.set(null);
        this.editText = '';
        this.isSavingEdit.set(false);
      },
      error: (err) => {
        this.isSavingEdit.set(false);
        this.showSaveError(err, 'Não foi possível salvar a alteração.');
      }
    });
  }

  /** Mostra a mensagem de validação do backend (400 { error }) ou uma genérica. */
  private showSaveError(err: any, fallback: string): void {
    const body = err?.error;
    const message = (typeof body === 'string' && body) || body?.error || body?.message || fallback;
    this.snackBar.open(message, 'Fechar', { duration: 8000 });
  }

  requestDelete(entry: TimelineEntry): void {
    this.confirmDeleteId.set(entry.id);
    this.editingId.set(null);
  }

  cancelDelete(): void {
    this.confirmDeleteId.set(null);
  }

  deleteEntry(entry: TimelineEntry): void {
    if (this.deletingId()) {
      return;
    }

    this.deletingId.set(entry.id);

    this.timelineService.delete(entry.id).subscribe({
      next: () => {
        this.entries.update((list) => list.filter((e) => e.id !== entry.id));
        this.confirmDeleteId.set(null);
        this.deletingId.set(null);
      },
      error: () => {
        this.deletingId.set(null);
      }
    });
  }

  // URL da foto do autor (por externalId), ou null para cair nas iniciais.
  photoFor(userId?: string | null): string | null {
    if (!userId) return null;
    return this.photos()[userId.toLowerCase()] || null;
  }

  // Busca as fotos dos autores das entradas (por externalId) que ainda não temos.
  private ensurePhotos(entries: TimelineEntry[]): void {
    const current = this.photos();
    const ids = Array.from(new Set(
      entries.map(e => e.userId).filter((x): x is string => !!x).map(x => x.toLowerCase())
    )).filter(id => !(id in current));

    if (!ids.length) return;

    this.authService.getPhotosByExternalIds(ids).subscribe({
      next: (res: any) => {
        const list = res?.object ?? res?.Object ?? [];
        const map = { ...this.photos() };
        for (const u of list) {
          const ext = (u.externalId || u.ExternalId || '').toLowerCase();
          const url = u.imageUrl || u.ImageUrl;
          if (ext && url) map[ext] = url;
        }
        // Marca ids sem foto (valor vazio) para não re-buscar sempre.
        for (const id of ids) if (!(id in map)) map[id] = '';
        this.photos.set(map);
      },
      error: () => {}
    });
  }

  initials(name: string): string {
    if (!name) {
      return '?';
    }
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0] ?? '';
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase();
  }

  /** Cor determinística a partir do nome, para o avatar. */
  avatarColor(name: string): string {
    let hash = 0;
    for (let i = 0; i < (name?.length ?? 0); i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 45%, 45%)`;
  }

  formatDateTime(value: string | null | undefined): string {
    if (!value) {
      return '';
    }
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return '';
    }
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
  }

  relativeTime(value: string | null | undefined): string {
    if (!value) {
      return '';
    }
    const date = new Date(value);
    const diffMs = Date.now() - date.getTime();
    if (isNaN(diffMs)) {
      return '';
    }
    const sec = Math.floor(diffMs / 1000);
    if (sec < 60) {
      return 'agora mesmo';
    }
    const min = Math.floor(sec / 60);
    if (min < 60) {
      return `há ${min} min`;
    }
    const hours = Math.floor(min / 60);
    if (hours < 24) {
      return `há ${hours} h`;
    }
    const days = Math.floor(hours / 24);
    if (days < 30) {
      return `há ${days} d`;
    }
    return this.formatDateTime(value);
  }

  trackById(_index: number, entry: TimelineEntry): number {
    return entry.id;
  }

  private scrollToBottom(): void {
    // Aguarda o render para rolar até o registro mais recente (embaixo).
    setTimeout(() => {
      const el = this.bodyRef?.nativeElement;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    });
  }

  /** Rola o container até centralizar o comentário (ou seu skeleton) de um id específico. */
  private scrollToEntry(entryId: number): void {
    // Aguarda o render (o comentário pode ter virado skeleton neste tick).
    setTimeout(() => {
      const container = this.bodyRef?.nativeElement;
      const target = container?.querySelector<HTMLElement>(`[data-entry-id="${entryId}"]`);
      if (!container || !target) {
        return;
      }
      // Posição relativa ao container (independe do offsetParent) para centralizar o alvo.
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const delta =
        targetRect.top - containerRect.top - (container.clientHeight - target.clientHeight) / 2;
      container.scrollTo({ top: Math.max(0, container.scrollTop + delta), behavior: 'smooth' });
    });
  }

  toggleExpanded(): void {
    this.enqueue(() => (this.expanded() ? this.collapse() : this.expand()));
  }

  private enqueue(step: () => Promise<void>): void {
    const run = () => (this.destroyed ? undefined : step());
    this.transition = this.transition.then(run, run);
  }

  /** Abre em tela cheia: a timeline sai do lugar e cresce até o modal. */
  private async expand(): Promise<void> {
    const el = this.timelineRef?.nativeElement;
    if (!el || this.expanded()) return;

    const host = this.hostRef.nativeElement;
    const from = this.rectOf(el);
    const scroll = this.saveScroll();
    const focused = this.focusedInside(el);

    // Reserva o lugar na página (nada "pula" atrás do modal).
    host.style.height = `${from.height}px`;

    this.backdrop = document.createElement('div');
    this.backdrop.className = 'timeline-backdrop';
    Object.assign(this.backdrop.style, {
      position: 'fixed', inset: '0', zIndex: '1000',
      background: 'rgba(0, 0, 0, 0.55)', backdropFilter: 'blur(2px)'
    });
    this.backdrop.addEventListener('click', this.onBackdropClick);
    // Mesmo z-index da barra do topo (1000) e depois dela no DOM → cobre a página; inserido ANTES do
    // overlay do CDK (também 1000) → tooltips, menus e snackbars continuam por cima do modal.
    const overlay = document.body.querySelector(':scope > .cdk-overlay-container');
    document.body.insertBefore(this.backdrop, overlay);
    document.body.insertBefore(el, overlay);

    this.lockScroll();

    el.classList.add('timeline--expanded');
    const to = this.expandedRect();
    this.applyRect(el, to);
    this.expanded.set(true);
    this.restoreScroll(scroll);
    focused?.focus({ preventScroll: true });

    document.addEventListener('keydown', this.onKeydownWhileExpanded);
    window.addEventListener('resize', this.onResizeWhileExpanded);
    this.releaseBack = this.back.push(() => this.enqueue(() => this.collapse()));

    if (this.reducedMotion()) return;
    this.animating = true;
    this.backdrop.animate([{ opacity: 0 }, { opacity: 1 }], EXPAND_ANIMATION);
    const anim = el.animate(
      [this.keyframe(from, 10), this.keyframe(to, 14)],
      EXPAND_ANIMATION
    );
    await anim.finished.catch(() => {});
    this.animating = false;
    if (scroll.atBottom) this.scrollToBottom();
  }

  /** Fecha a tela cheia: encolhe até o lugar original e volta para dentro do host. */
  private async collapse(): Promise<void> {
    const el = this.timelineRef?.nativeElement;
    if (!el || !this.expanded()) return;

    const host = this.hostRef.nativeElement;
    const scroll = this.saveScroll();
    const focused = this.focusedInside(el);

    document.removeEventListener('keydown', this.onKeydownWhileExpanded);
    window.removeEventListener('resize', this.onResizeWhileExpanded);
    this.releaseBack?.();
    this.releaseBack = undefined;

    if (!this.reducedMotion()) {
      this.animating = true;
      // Destino: onde o host está AGORA (a página pode ter mudado de tamanho enquanto aberta).
      const to = this.rectOf(host);
      const anim = el.animate(
        [this.keyframe(this.rectOf(el), 14), this.keyframe(to, 10)],
        { ...EXPAND_ANIMATION, fill: 'forwards' }
      );
      this.backdrop?.animate([{ opacity: 1 }, { opacity: 0 }], { ...EXPAND_ANIMATION, fill: 'forwards' });
      await anim.finished.catch(() => {});
      this.animating = false;
      this.restoreInPlace(el, host);
      anim.cancel();
    } else {
      this.restoreInPlace(el, host);
    }

    this.restoreScroll(scroll);
    focused?.focus({ preventScroll: true });
  }

  /** Devolve o elemento ao host e desfaz tudo o que a tela cheia mudou. */
  private restoreInPlace(el: HTMLElement, host: HTMLElement): void {
    host.insertBefore(el, host.firstChild);
    el.classList.remove('timeline--expanded');
    for (const prop of ['top', 'left', 'width', 'height'] as const) el.style[prop] = '';
    host.style.height = '';
    this.backdrop?.remove();
    this.backdrop = undefined;
    this.unlockScroll();
    this.expanded.set(false);
  }

  private lockScroll(): void {
    this.previousHtmlOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    this.lockedScrollers = Array.from(document.querySelectorAll<HTMLElement>('.content-area')).map((el) => {
      const saved = { el, overflow: el.style.overflow };
      el.style.overflow = 'hidden';
      return saved;
    });
  }

  private unlockScroll(): void {
    document.documentElement.style.overflow = this.previousHtmlOverflow;
    for (const s of this.lockedScrollers) s.el.style.overflow = s.overflow;
    this.lockedScrollers = [];
  }

  private onBackdropClick = (): void => {
    this.enqueue(() => this.collapse());
  };

  private onKeydownWhileExpanded = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      this.enqueue(() => this.collapse());
    }
  };

  private onResizeWhileExpanded = (): void => {
    const el = this.timelineRef?.nativeElement;
    if (el && !this.animating) this.applyRect(el, this.expandedRect());
  };

  /** Retângulo do modal: centralizado, ~92% da tela, no máximo 1200 px de largura; no celular, a tela toda (0043). */
  private expandedRect(): Rect {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (vw <= 768) return { top: 0, left: 0, width: vw, height: vh };
    const width = Math.min(1200, vw - 2 * Math.max(16, vw * 0.04));
    const height = vh - 2 * Math.max(16, vh * 0.04);
    return { top: (vh - height) / 2, left: (vw - width) / 2, width, height };
  }

  private rectOf(el: HTMLElement): Rect {
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  }

  private applyRect(el: HTMLElement, r: Rect): void {
    el.style.top = `${r.top}px`;
    el.style.left = `${r.left}px`;
    el.style.width = `${r.width}px`;
    el.style.height = `${r.height}px`;
  }

  /** Anima a geometria (e não scale): o texto não distorce enquanto o chat cresce/encolhe. */
  private keyframe(r: Rect, radius: number): Keyframe {
    return {
      top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px`,
      borderRadius: `${radius}px`
    };
  }

  private reducedMotion(): boolean {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  private focusedInside(el: HTMLElement): HTMLElement | null {
    const active = document.activeElement as HTMLElement | null;
    return active && active !== document.body && el.contains(active) ? active : null;
  }

  /** Mover o nó no DOM zera a rolagem da lista: guarda e restaura (quem lia o fim continua no fim). */
  private saveScroll(): { top: number; atBottom: boolean } {
    const b = this.bodyRef?.nativeElement;
    if (!b) return { top: 0, atBottom: true };
    return { top: b.scrollTop, atBottom: b.scrollHeight - b.scrollTop - b.clientHeight < 8 };
  }

  private restoreScroll(scroll: { top: number; atBottom: boolean }): void {
    const b = this.bodyRef?.nativeElement;
    if (!b) return;
    b.scrollTop = scroll.atBottom ? b.scrollHeight : scroll.top;
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    // Destruída aberta (ex.: troca de rota): tira o modal e o fundo do <body>.
    if (this.expanded()) {
      document.removeEventListener('keydown', this.onKeydownWhileExpanded);
      window.removeEventListener('resize', this.onResizeWhileExpanded);
      this.timelineRef?.nativeElement.remove();
      this.backdrop?.remove();
      this.unlockScroll();
      this.releaseBack?.();
    }
    this.sub?.unsubscribe();
    if (this.currentGroup) this.ws.removeFromGroup(this.currentGroup);
    this.ws.off(TIMELINE_EVENT, this.onTimelineUpdated);
    this.resyncSub?.unsubscribe();
  }

  /** Links dentro de um registro em markdown abrem em nova aba (sem sair da tela do card). */
  onContentClick(event: MouseEvent): void {
    const anchor = (event.target as HTMLElement | null)?.closest('a');
    const href = anchor?.getAttribute('href');
    if (!anchor || !href || href.startsWith('#')) return;
    event.preventDefault();
    window.open(href, '_blank', 'noopener,noreferrer');
  }
}
