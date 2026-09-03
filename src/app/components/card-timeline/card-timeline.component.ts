import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription, firstValueFrom } from 'rxjs';
import { TimelineService } from '../../services/timeline.service';
import { StorageService } from '../../services/storage.service';
import { TeamsGraphService, TeamsChat } from '../../services/teams-graph.service';
import { TimelineEntry } from './timeline.model';

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
  readonly isPosting = signal(false);
  readonly loadError = signal(false);
  newEntry = '';

  // Edição / exclusão dos próprios registros
  currentUserId: string | null = null;
  readonly editingId = signal<number | null>(null);
  editText = '';
  readonly isSavingEdit = signal(false);
  readonly confirmDeleteId = signal<number | null>(null);
  readonly deletingId = signal<number | null>(null);

  // Importação de mensagens do Teams (login do próprio usuário via MSAL)
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

  private sub?: Subscription;

  constructor(
    private timelineService: TimelineService,
    private storageService: StorageService,
    private teamsGraph: TeamsGraphService
  ) {
    const access = this.storageService.getAccess();
    this.currentUserId = access && access.user ? (access.user.externalId ?? null) : null;
  }

  get canSubmit(): boolean {
    return (
      this.canPost &&
      !this.isPosting() &&
      !!this._cardNumber &&
      this.newEntry.trim().length > 0
    );
  }

  /** (Re)carrega a linha do tempo de um card. */
  load(cardNumber?: string | number): void {
    const card =
      cardNumber !== null && cardNumber !== undefined
        ? `${cardNumber}`.trim()
        : this._cardNumber;

    if (!card) {
      this.entries.set([]);
      return;
    }

    this._cardNumber = card;
    this.isLoading.set(true);
    this.loadError.set(false);

    this.sub?.unsubscribe();
    this.sub = this.timelineService.getByCardNumber(card).subscribe({
      next: (data) => {
        // Mais antigo em cima, mais recente embaixo.
        const sorted = (data ?? [])
          .slice()
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        this.entries.set(sorted);
        this.isLoading.set(false);
        this.scrollToBottom();
      },
      error: () => {
        this.entries.set([]);
        this.isLoading.set(false);
        this.loadError.set(true);
      }
    });
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
        error: () => {
          this.isPosting.set(false);
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
      error: () => {
        this.isSavingEdit.set(false);
      }
    });
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

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
