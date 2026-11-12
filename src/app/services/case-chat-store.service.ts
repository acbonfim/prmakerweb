import { Injectable, Signal, WritableSignal, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { WsService } from './ws.service';
import { StorageService } from './storage.service';
import { CaseChatService } from './case-chat.service';
import { executionPlanGroup } from '../components/execution-plan/execution-plan.model';
import {
  CASE_CHAT_EVENT, CaseChat, CaseChatRealtimePayload, CaseDelivery, CaseFile, CaseMessage, CaseViewMessage, isRunActive
} from '../components/case-chat/case-chat.model';

/** Arquivo escolhido/colado e ainda não enviado (fica no rascunho da conversa). */
export interface PendingFile {
  id: number;
  file: File;
  preview: string | null;
}

/** Mensagem que saiu deste navegador e ainda não foi gravada (envio otimista: aparece na conversa na hora). */
interface OutboxEntry {
  key: string;
  /** Última mensagem do servidor quando saiu — a gravada vem depois dela (acha a mesma se o evento chegar antes da resposta). */
  base: number;
  text: string;
  files: File[];
  previews: { name: string; preview: string | null }[];
  peopleOnly: boolean;
  deep: boolean;
  replyTo: number | null;
  createdAt: string;
  status: 'sending' | 'failed';
  posting: boolean;
  onError?: (message: string, err: unknown) => void;
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
  /** Saindo deste navegador (⏱) ou que falharam (tentar de novo). */
  readonly outbox: WritableSignal<OutboxEntry[]>;
  /** Id da mensagem gravada → chave da bolha otimista (a bolha continua a mesma, sem piscar). */
  readonly keys: Map<string, string>;
  /** Mensagens na tela: as do servidor e, no fim, as que estão saindo. */
  readonly view: Signal<CaseViewMessage[]>;
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
const SEEN_DEBOUNCE_MS = 800;

/**
 * 0081: estado da conversa do Especialista do caso por card, mantido em memória enquanto o app está aberto e
 * atualizado pelo WebSocket enquanto alguém acompanha o card (a tela do card assina; o modal só lê). Substitui o estado
 * que o modal carregava a cada abertura.
 */
@Injectable({ providedIn: 'root' })
export class CaseChatStore {
  private api = inject(CaseChatService);
  private ws = inject(WsService);
  private readonly me = inject(StorageService).getAccess()?.user ?? null;
  readonly myId = (this.me?.externalId ?? '').toLowerCase();
  /** Nome na bolha otimista (avatar com as iniciais/foto de quem escreveu, como a gravada). */
  private readonly myName = this.me?.fullName || this.me?.name || 'Você';

  private readonly rooms = new Map<string, CaseRoom>();
  private readonly statuses = new Map<string, Signal<CaseChatStatus>>();
  private readonly watched = new Map<string, number>();
  /** Card que perdeu eventos (ninguém acompanhava): recarrega ao voltar. */
  private readonly stale = new Set<string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly inflight = new Set<string>();
  private readonly loadingBlobs = new Set<string>();
  private readonly seenPosted = new Map<string, number>();
  private readonly seenWanted = new Map<string, number>();
  private readonly seenTimers = new Map<string, ReturnType<typeof setTimeout>>();
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
    const chat = signal<CaseChat | null>(null);
    const outbox = signal<OutboxEntry[]>([]);
    const keys = new Map<string, string>();
    r = {
      card,
      chat,
      loading: signal(true),
      loadError: signal(false),
      typing: signal<Record<string, number>>({}),
      blobs: signal<Record<string, string>>({}),
      seen: signal(this.readSeen(card)),
      replyTo: signal<CaseMessage | null>(null),
      pending: signal<PendingFile[]>([]),
      draft: { text: '', peopleOnly: false, deep: false },
      scrollTop: null,
      outbox,
      keys,
      view: computed<CaseViewMessage[]>(() => {
        const server = (chat()?.messages ?? []).map((m) => ({ ...m, key: keys.get(m.id) ?? m.id }));
        return [...server, ...outbox().map((e) => this.localMessage(e))];
      })
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
    this.postSeen(card, number);
    if (number <= room.seen()) return;
    try { localStorage.setItem(SEEN_KEY(card), `${number}`); } catch { /* sem storage */ }
    room.seen.set(number);
  }

  /** Avisa o servidor (o ✓✓ de quem escreveu) — junta as marcações seguidas numa chamada só. */
  private postSeen(card: string, number: number): void {
    if (!number || number <= (this.seenPosted.get(card) ?? 0)) return;
    this.seenWanted.set(card, Math.max(number, this.seenWanted.get(card) ?? 0));
    if (this.seenTimers.has(card)) return;
    this.seenTimers.set(card, setTimeout(() => {
      this.seenTimers.delete(card);
      const n = this.seenWanted.get(card) ?? 0;
      if (n <= (this.seenPosted.get(card) ?? 0)) return;
      this.seenPosted.set(card, n);
      this.api.seen(card, n).subscribe({ error: () => this.seenPosted.set(card, 0) });
    }, SEEN_DEBOUNCE_MS));
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

  /**
   * Manda o rascunho (ou `text`, sem mexer no rascunho) como no WhatsApp: a mensagem vai para a conversa na hora (⏱),
   * o campo fica livre para a próxima e o servidor confirma depois (✓). Saem em ordem, uma de cada vez. Falhou: a bolha
   * fica marcada com "tentar de novo" e `onError` avisa. Devolve false se não havia o que mandar.
   */
  send(card: string, text?: string, onError?: (message: string, err: unknown) => void): boolean {
    const room = this.room(card);
    const body = (text ?? room.draft.text).trim();
    const pending = room.pending();
    if (!body && !pending.length) return false;
    const entry: OutboxEntry = {
      key: `local-${++this.fileSeq}-${Date.now()}`,
      base: room.chat()?.messages.at(-1)?.number ?? 0,
      text: body,
      files: pending.map((p) => p.file),
      previews: pending.map((p) => ({ name: p.file.name, preview: p.preview })),
      peopleOnly: room.draft.peopleOnly,
      deep: room.draft.deep,
      replyTo: room.replyTo()?.number ?? null,
      createdAt: new Date().toISOString(),
      status: 'sending',
      posting: false,
      onError
    };
    if (text === undefined) room.draft.text = '';
    room.draft.deep = false;
    // As prévias seguem com a bolha (liberadas quando o servidor confirmar).
    room.pending.set([]);
    room.replyTo.set(null);
    room.outbox.update((list) => [...list, entry]);
    this.pump(card);
    return true;
  }

  /** Falhou: tenta de novo (volta para a fila, na ordem). */
  retry(card: string, key: string): void {
    const room = this.room(card);
    room.outbox.update((list) => list.map((e) => e.key === key ? { ...e, status: 'sending' as const } : e));
    this.pump(card);
  }

  /** Desiste da mensagem que falhou; o texto volta para o campo se ele estiver vazio. */
  discard(card: string, key: string): void {
    const room = this.room(card);
    const entry = room.outbox().find((e) => e.key === key);
    if (!entry || entry.posting) return;
    room.outbox.update((list) => list.filter((e) => e.key !== key));
    if (!room.draft.text.trim()) room.draft.text = entry.text;
    for (const p of entry.previews) if (p.preview) URL.revokeObjectURL(p.preview);
  }

  /** ⏱ enviando · ✓ recebida pelo servidor · ✓✓ lida pelo especialista ou por outra pessoa. */
  delivery(card: string, m: CaseViewMessage): CaseDelivery {
    if (m.outgoing) return m.outgoing;
    return this.readBy(card, m).length ? 'read' : 'sent';
  }

  /** Quem já leu a mensagem (o especialista e/ou outras pessoas). */
  readBy(card: string, m: CaseMessage): string[] {
    const c = this.room(card).chat();
    if (!c || !m.number) return [];
    const who: string[] = [];
    if ((c.specialistReadNumber ?? 0) >= m.number) who.push('Especialista');
    const author = (m.authorUserId ?? '').toLowerCase();
    for (const r of c.readers ?? []) {
      const id = (r.userId ?? '').toLowerCase();
      if (r.number >= m.number && id !== author && id !== this.myId) who.push(r.name.split(' ')[0]);
    }
    return who;
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
        this.reconcile(room);
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
    if (p.action === 'seen') {
      // ✓✓ na hora, sem recarregar a conversa.
      const c = room.chat();
      const n = p.number ?? 0;
      if (!c || !n) return;
      if (p.specialist) {
        if (n > (c.specialistReadNumber ?? 0)) room.chat.set({ ...c, specialistReadNumber: n });
        return;
      }
      if (!p.userId) return;
      const id = p.userId.toLowerCase();
      const readers = [...(c.readers ?? [])];
      const i = readers.findIndex((r) => r.userId.toLowerCase() === id);
      if (i >= 0 && readers[i].number >= n) return;
      const entry = { userId: p.userId, name: p.by ?? readers[i]?.name ?? '', number: n, at: new Date().toISOString() };
      if (i >= 0) readers[i] = entry; else readers.push(entry);
      room.chat.set({ ...c, readers });
      return;
    }
    // A mensagem chegou: quem escreveu parou de digitar.
    if (p.action === 'message') room.typing.set({});
    this.reload(card);
  };

  /** Manda a próxima da fila (uma de cada vez: a ordem na conversa é a ordem em que a pessoa escreveu). */
  private pump(card: string): void {
    const room = this.room(card);
    if (room.outbox().some((e) => e.posting)) return;
    const next = room.outbox().find((e) => e.status === 'sending');
    if (!next) return;
    const mark = (patch: Partial<OutboxEntry>) => room.outbox.update((list) => list.map((e) => e.key === next.key ? { ...e, ...patch } : e));
    mark({ posting: true });
    this.api.post(card, {
      text: next.text, files: next.files, peopleOnly: next.peopleOnly, deep: next.deep, replyTo: next.replyTo
    }).subscribe({
      next: (m) => {
        room.keys.set(m.id, next.key);
        room.outbox.update((list) => list.filter((e) => e.key !== next.key));
        for (const p of next.previews) if (p.preview) URL.revokeObjectURL(p.preview);
        this.appendMine(card, m);
        this.pump(card);
      },
      error: (err) => {
        mark({ posting: false, status: 'failed' });
        next.onError?.('Não foi possível enviar a mensagem — toque em tentar de novo.', err);
        this.pump(card);
      }
    });
  }

  /**
   * O evento do servidor pode chegar antes da resposta do envio (ou a resposta se perdeu e a mensagem foi gravada): a
   * gravada já está na lista. A bolha otimista passa a apontar para ela (mesma chave) e sai da fila.
   */
  private reconcile(room: CaseRoom): void {
    const out = room.outbox();
    if (!out.length) return;
    const server = room.chat()?.messages ?? [];
    const taken = new Set(room.keys.keys());
    const done: string[] = [];
    for (const e of out) {
      const m = server.find((x) => !taken.has(x.id) && x.number > e.base && this.isMine(x) && x.text.trim() === e.text);
      if (!m) continue;
      taken.add(m.id);
      room.keys.set(m.id, e.key);
      done.push(e.key);
    }
    // Mesmo com o envio no ar: a resposta dele só confirma (appendMine não repete).
    if (done.length) room.outbox.update((list) => list.filter((e) => !done.includes(e.key)));
  }

  private localMessage(e: OutboxEntry): CaseViewMessage {
    return {
      id: e.key, key: e.key, number: 0, authorKind: 'person', authorUserId: this.me?.externalId || null, authorName: this.myName, kind: 'text',
      text: e.text, transcript: null, peopleOnly: e.peopleOnly, deep: e.deep, mentions: [], steps: [], replyToNumber: e.replyTo,
      createdAt: e.createdAt, files: [], outgoing: e.status, localFiles: e.previews
    };
  }

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
