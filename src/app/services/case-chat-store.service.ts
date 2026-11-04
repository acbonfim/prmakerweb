import { Injectable, Signal, WritableSignal, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { WsService } from './ws.service';
import { StorageService } from './storage.service';
import { CaseChatService } from './case-chat.service';
import { executionPlanGroup } from '../components/execution-plan/execution-plan.model';
import { CASE_CHAT_EVENT, CaseChat, CaseChatRealtimePayload, CaseFile, CaseMessage, isRunActive } from '../components/case-chat/case-chat.model';

/** Arquivo escolhido/colado e ainda não enviado (fica no rascunho da conversa). */
export interface PendingFile {
  id: number;
  file: File;
  preview: string | null;
}

/**
 * 0081: uma conversa do caso em memória — o modal grande e a versão compacta da coluna da direita leem e escrevem o
 * mesmo estado. Fechar o modal não perde nada (mensagens, rascunho, anexos, "respondendo a", imagens baixadas, rolagem).
 */
export interface CaseRoom {
  readonly card: string;
  readonly chat: WritableSignal<CaseChat | null>;
  readonly loading: WritableSignal<boolean>;
  readonly loadError: WritableSignal<boolean>;
  /** Nome → último sinal de "digitando". */
  readonly typing: WritableSignal<Record<string, number>>;
  /** Blob URLs das imagens/áudios já baixados (por id do arquivo). */
  readonly blobs: WritableSignal<Record<string, string>>;
  /** Última mensagem vista neste navegador. */
  readonly seen: WritableSignal<number>;
  readonly replyTo: WritableSignal<CaseMessage | null>;
  readonly pending: WritableSignal<PendingFile[]>;
  /** Rascunho (ngModel): o mesmo texto no modal e na versão compacta. */
  draft: { text: string; peopleOnly: boolean; deep: boolean };
  /** Rolagem do modal quando foi fechado (null = no fim). */
  scrollTop: number | null;
}

export interface CaseChatStatus {
  /** Últimas mensagens (prévia). */
  last: CaseMessage[];
  lastNumber: number;
  seenNumber: number;
  unread: number;
  working: boolean;
  activity: string | null;
  people: number;
}

export const EMPTY_CASE_STATUS: CaseChatStatus = { last: [], lastNumber: 0, seenNumber: 0, unread: 0, working: false, activity: null, people: 0 };

const SEEN_KEY = (card: string) => `prmake.case-seen.${card}`;
/** Conversas guardadas em memória (as mais usadas); a mais antiga sai e libera as imagens. */
const MAX_ROOMS = 6;
const RELOAD_DEBOUNCE_MS = 200;

/**
 * 0081: estado da conversa do Especialista do caso por card, mantido em memória enquanto o app está aberto e
 * atualizado pelo WebSocket enquanto alguém acompanha o card (a tela do card assina; o modal só lê). Substitui o estado
 * que o modal carregava a cada abertura.
 */
@Injectable({ providedIn: 'root' })
export class CaseChatStore {
  private api = inject(CaseChatService);
  private ws = inject(WsService);
  readonly myId = (inject(StorageService).getAccess()?.user?.externalId ?? '').toLowerCase();

  private readonly rooms = new Map<string, CaseRoom>();
  private readonly statuses = new Map<string, Signal<CaseChatStatus>>();
  private readonly watched = new Map<string, number>();
  /** Card que perdeu eventos (ninguém acompanhava): recarrega ao voltar. */
  private readonly stale = new Set<string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly inflight = new Set<string>();
  private readonly loadingBlobs = new Set<string>();
  private listening = false;
  private fileSeq = 0;

  room(card: string): CaseRoom {
    let r = this.rooms.get(card);
    if (r) {
      // Mais recente no fim do Map (LRU).
      this.rooms.delete(card);
      this.rooms.set(card, r);
      return r;
    }
    r = {
      card,
      chat: signal<CaseChat | null>(null),
      loading: signal(true),
      loadError: signal(false),
      typing: signal<Record<string, number>>({}),
      blobs: signal<Record<string, string>>({}),
      seen: signal(this.readSeen(card)),
      replyTo: signal<CaseMessage | null>(null),
      pending: signal<PendingFile[]>([]),
      draft: { text: '', peopleOnly: false, deep: false },
      scrollTop: null
    };
    this.rooms.set(card, r);
    this.evict();
    return r;
  }

  /** Resumo para o botão do cabeçalho e para a versão compacta (mensagens novas, trabalhando, atividade). */
  status(card: string): Signal<CaseChatStatus> {
    let s = this.statuses.get(card);
    if (!s) {
      const room = this.room(card);
      s = computed<CaseChatStatus>(() => {
        const c = room.chat();
        const seen = room.seen();
        if (!c) return { ...EMPTY_CASE_STATUS, seenNumber: seen };
        const run = c.run;
        const working = isRunActive(run);
        return {
          last: c.messages.filter((m) => m.authorKind !== 'system').slice(-2),
          lastNumber: c.messages.at(-1)?.number ?? 0,
          seenNumber: seen,
          // Novas = de outras pessoas ou do especialista (as minhas e os avisos do PRMake não contam).
          unread: Math.min(c.messages.filter((m) => m.number > seen && m.authorKind !== 'system' && !this.isMine(m)).length, 99),
          working,
          activity: working ? (run!.status === 'queued' ? 'na fila' : run!.currentActivity?.label ?? 'pensando…') : null,
          people: c.participants.length
        };
      });
      this.statuses.set(card, s);
    }
    return s;
  }

  /** Começa a acompanhar o card (contagem de referências: `unwatch` ao sair). Carrega se ainda não tem ou perdeu eventos. */
  watch(card: string): void {
    if (!card) return;
    const n = (this.watched.get(card) ?? 0) + 1;
    this.watched.set(card, n);
    if (n > 1) return;
    this.ws.startConnection();
    this.ws.addToGroup(executionPlanGroup(card));
    if (!this.listening) {
      this.listening = true;
      this.ws.on(CASE_CHAT_EVENT, this.onRealtime);
      // Voltou a conexão: o que chegou enquanto estava fora só vem recarregando.
      this.ws._resynced.subscribe(() => { for (const c of this.watched.keys()) this.reload(c); });
    }
    const room = this.room(card);
    if (!room.chat() || this.stale.has(card)) this.reload(card, 0);
  }

  unwatch(card: string): void {
    const n = (this.watched.get(card) ?? 0) - 1;
    if (n > 0) { this.watched.set(card, n); return; }
    this.watched.delete(card);
    this.stale.add(card);
    this.ws.removeFromGroup(executionPlanGroup(card));
  }

  /** Recarrega a conversa (com espera curta para juntar vários eventos seguidos). */
  reload(card: string, delayMs = RELOAD_DEBOUNCE_MS): void {
    clearTimeout(this.timers.get(card));
    this.timers.set(card, setTimeout(() => this.fetch(card), delayMs));
  }

  markSeen(card: string, number: number): void {
    const room = this.room(card);
    if (number <= room.seen()) return;
    try { localStorage.setItem(SEEN_KEY(card), `${number}`); } catch { /* sem storage */ }
    room.seen.set(number);
  }

  isMine(m: CaseMessage): boolean {
    return m.authorKind === 'person' && !!this.myId && (m.authorUserId ?? '').toLowerCase() === this.myId;
  }

  // ── Rascunho e envio (compartilhados entre o modal e a versão compacta) ────────────────────────

  addFiles(card: string, files: File[], pasted: boolean, maxFiles: number, maxBytes: number, warn: (m: string) => void): void {
    const room = this.room(card);
    const next = [...room.pending()];
    for (const raw of files) {
      if (next.length >= maxFiles) { warn(`No máximo ${maxFiles} arquivos por mensagem.`); break; }
      if (raw.size > maxBytes) { warn(`${raw.name} passa de ${Math.round(maxBytes / 1024 / 1024)} MB.`); continue; }
      const file = pasted && raw.type.startsWith('image/')
        ? new File([raw], `colado-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}-${++this.fileSeq}.${raw.type.split('/')[1] || 'png'}`, { type: raw.type })
        : raw;
      next.push({ id: ++this.fileSeq, file, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null });
    }
    room.pending.set(next);
  }

  removePending(card: string, p: PendingFile): void {
    const room = this.room(card);
    if (p.preview) URL.revokeObjectURL(p.preview);
    room.pending.set(room.pending().filter((x) => x.id !== p.id));
  }

  /** Manda o rascunho (ou `text`, sem mexer no rascunho). No sucesso limpa o que foi enviado e mostra na hora. */
  send(card: string, text?: string): Observable<CaseMessage> | null {
    const room = this.room(card);
    const body = (text ?? room.draft.text).trim();
    const files = room.pending().map((p) => p.file);
    if (!body && !files.length) return null;
    return this.api.post(card, {
      text: body, files, peopleOnly: room.draft.peopleOnly, deep: room.draft.deep, replyTo: room.replyTo()?.number ?? null
    }).pipe(tap((m) => {
      if (text === undefined) room.draft.text = '';
      room.draft.deep = false;
      this.clearPending(room);
      room.replyTo.set(null);
      this.appendMine(card, m);
    }));
  }

  /** Mensagem própria aparece antes do evento do servidor (que depois recarrega e confirma). */
  appendMine(card: string, m: CaseMessage): void {
    const room = this.room(card);
    const c = room.chat();
    if (c && !c.messages.some((x) => x.id === m.id)) room.chat.set({ ...c, messages: [...c.messages, m] });
    this.markSeen(card, m.number);
    this.reload(card, 600);
  }

  clearPending(room: CaseRoom): void {
    for (const p of room.pending()) if (p.preview) URL.revokeObjectURL(p.preview);
    room.pending.set([]);
  }

  /** URL da imagem/áudio (baixa uma vez e guarda enquanto a conversa estiver em memória). */
  blob(card: string, file: CaseFile): string | null {
    const room = this.room(card);
    const url = room.blobs()[file.id];
    if (url) return url;
    if (!this.loadingBlobs.has(file.id) && (file.kind === 'image' || file.kind === 'audio')) {
      this.loadingBlobs.add(file.id);
      this.api.content(card, file).subscribe({
        next: (b) => room.blobs.update((m) => ({ ...m, [file.id]: URL.createObjectURL(b) })),
        error: () => this.loadingBlobs.delete(file.id)
      });
    }
    return null;
  }

  // ── Interno ────────────────────────────────────────────────────────────────────────────────────

  private fetch(card: string): void {
    if (this.inflight.has(card)) {
      // Já tem uma leitura no ar: lê de novo quando ela voltar (não perde o evento).
      this.reload(card);
      return;
    }
    this.inflight.add(card);
    const room = this.room(card);
    this.api.get(card).subscribe({
      next: (c) => {
        this.inflight.delete(card);
        this.stale.delete(card);
        room.loading.set(false);
        room.loadError.set(false);
        room.chat.set(c);
      },
      error: () => {
        this.inflight.delete(card);
        room.loading.set(false);
        if (!room.chat()) room.loadError.set(true);
      }
    });
  }

  private onRealtime = (p: CaseChatRealtimePayload): void => {
    const card = p?.cardNumber != null ? `${p.cardNumber}` : null;
    if (!card || !this.watched.has(card)) return;
    const room = this.room(card);
    if (p.action === 'typing') {
      if (p.userId && p.userId.toLowerCase() === this.myId) return;
      if (p.by) room.typing.update((t) => ({ ...t, [p.by!]: Date.now() }));
      return;
    }
    if (p.action === 'activity') {
      const c = room.chat();
      if (c?.run && c.run.id === p.requestId) {
        room.chat.set({ ...c, run: { ...c.run, status: (p.status as any) ?? c.run.status, currentActivity: p.activity ?? null, recentActivities: p.recent ?? [] } });
        return;
      }
    }
    // A mensagem chegou: quem escreveu parou de digitar.
    if (p.action === 'message') room.typing.set({});
    this.reload(card);
  };

  private evict(): void {
    for (const [card, room] of this.rooms) {
      if (this.rooms.size <= MAX_ROOMS) return;
      if (this.watched.has(card)) continue;
      for (const url of Object.values(room.blobs())) URL.revokeObjectURL(url);
      this.clearPending(room);
      this.rooms.delete(card);
      this.statuses.delete(card);
      this.stale.delete(card);
    }
  }

  private readSeen(card: string): number {
    try { return Number(localStorage.getItem(SEEN_KEY(card)) ?? 0) || 0; } catch { return 0; }
  }
}
