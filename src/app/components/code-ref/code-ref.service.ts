import { Injectable, Signal, WritableSignal, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { WsService } from '../../services/ws.service';
import {
  EXECUTION_PLAN_EVENT,
  ExecutionPlanRealtimePayload,
  executionPlanGroup,
} from '../execution-plan/execution-plan.model';
import { CodeRef, CodeRefHead, matchCitation } from './code-ref.model';

const MAX_BLOBS = 40;

/**
 * Fotografias de código do card (0075/F2) e imagens `anexo:` do markdown (F3).
 *
 * - **Cabeças** (`GET card/{card}/code-refs`): carregadas na 1ª necessidade (um texto com link de
 *   código na tela), em cache por card; o tempo real `codeRef` do card invalida.
 * - **Ref completa** (`GET card/{card}/code-refs/{ref}`): no 1º clique, em cache.
 * - **Imagens** (`GET card/{card}/artifacts/by-name/{nome}/content`): blob (a api-key vai pelo
 *   interceptor), em cache curto; o tempo real `artifact` do card invalida.
 *
 * `watch(card)`/`unwatch(card)` (a diretiva do contêiner) entram/saem do grupo de tempo real do card.
 */
@Injectable({ providedIn: 'root' })
export class CodeRefService {
  private http = inject(HttpClient);
  private ws = inject(WsService);
  private apiUrl = `${environment.apiUrl}ExecutionPlan`;

  private heads = new Map<string, Promise<CodeRefHead[]>>();
  private headsState = new Map<string, WritableSignal<CodeRefHead[] | null>>();
  private refs = new Map<string, Promise<CodeRef | null>>();
  private blobs = new Map<string, Promise<Blob>>();
  private watchers = new Map<string, number>();
  private listening = false;

  /** Mudou alguma coisa do card (refs ou arquivos): a diretiva redecora/recarrega. */
  readonly changes = signal<{ card: string; kind: 'codeRef' | 'artifact' | 'all'; at: number } | null>(null);

  // ── Cabeças ───────────────────────────────────────────────────────────────────────────────────

  /** Cabeças do card como signal (null enquanto não carregou). Não dispara a carga. */
  headsOf(card: string): Signal<CodeRefHead[] | null> {
    return this.stateOf(card).asReadonly();
  }

  /** Cabeças do card (carrega na 1ª vez; falha → lista vazia, tenta de novo na próxima). */
  loadHeads(card: string): Promise<CodeRefHead[]> {
    const key = norm(card);
    let p = this.heads.get(key);
    if (!p) {
      p = firstValueFrom(this.http.get<CodeRefHead[]>(`${this.apiUrl}/card/${encodeURIComponent(key)}/code-refs`))
        .then(list => {
          const heads = (list ?? []).map(h => ({ ...h, ref: (h.ref ?? '').toLowerCase() }));
          if (this.heads.get(key) === p) this.stateOf(key).set(heads);
          return heads;
        })
        .catch(() => {
          if (this.heads.get(key) === p) this.heads.delete(key);
          return [] as CodeRefHead[];
        });
      this.heads.set(key, p);
    }
    return p;
  }

  /** Ref completa (null = não existe). Erro de rede propaga (o popover mostra "tentar de novo"). */
  get(card: string, ref: string): Promise<CodeRef | null> {
    const key = `${norm(card)}|${ref.toLowerCase()}`;
    let p = this.refs.get(key);
    if (!p) {
      p = firstValueFrom(this.http.get<CodeRef>(
        `${this.apiUrl}/card/${encodeURIComponent(norm(card))}/code-refs/${encodeURIComponent(ref.toLowerCase())}`))
        .then(r => (r ? { ...r, annotations: r.annotations ?? [], firstLine: r.firstLine || 1 } : null))
        .catch((err: HttpErrorResponse) => {
          if (this.refs.get(key) === p) this.refs.delete(key);
          if (err?.status === 404) return null;
          throw err;
        });
      this.refs.set(key, p);
    }
    return p;
  }

  /** A ref do card para a citação `caminho:ini-fim`, ou null (sem fotografia). */
  async match(card: string, path: string, start: number, end: number): Promise<CodeRefHead | null> {
    return matchCitation(await this.loadHeads(card), path, start, end);
  }

  // ── Imagens anexo: ────────────────────────────────────────────────────────────────────────────

  /** Bytes de um arquivo do card pelo nome (plano atual ou o pai). */
  attachment(card: string, name: string): Promise<Blob> {
    const key = `${norm(card)}|${name}`;
    let p = this.blobs.get(key);
    if (p) {
      // LRU simples: reinsere no fim
      this.blobs.delete(key);
      this.blobs.set(key, p);
      return p;
    }
    p = firstValueFrom(this.http.get(
      `${this.apiUrl}/card/${encodeURIComponent(norm(card))}/artifacts/by-name/${encodeURIComponent(name)}/content`,
      { responseType: 'blob' }))
      .catch(err => {
        if (this.blobs.get(key) === p) this.blobs.delete(key);
        throw err;
      });
    this.blobs.set(key, p);
    while (this.blobs.size > MAX_BLOBS) this.blobs.delete(this.blobs.keys().next().value!);
    return p;
  }

  // ── Tempo real ────────────────────────────────────────────────────────────────────────────────

  watch(card: string | null | undefined): void {
    const key = norm(card);
    if (!key) return;
    this.listen();
    const count = this.watchers.get(key) ?? 0;
    this.watchers.set(key, count + 1);
    if (count === 0) this.ws.addToGroup(executionPlanGroup(key));
  }

  unwatch(card: string | null | undefined): void {
    const key = norm(card);
    const count = this.watchers.get(key) ?? 0;
    if (!key || count === 0) return;
    if (count > 1) { this.watchers.set(key, count - 1); return; }
    this.watchers.delete(key);
    this.ws.removeFromGroup(executionPlanGroup(key));
    // Sem ninguém olhando, o tempo real não chega mais: o cache deixaria de ser confiável.
    this.invalidate(key, 'all', false);
  }

  /** Esquece o que o card tem em cache (refs e/ou imagens). */
  invalidate(card: string, kind: 'codeRef' | 'artifact' | 'all' = 'all', notify = true): void {
    const key = norm(card);
    if (kind !== 'artifact') {
      this.heads.delete(key);
      this.headsState.get(key)?.set(null);
      for (const k of [...this.refs.keys()]) if (k.startsWith(key + '|')) this.refs.delete(k);
    }
    if (kind !== 'codeRef') {
      for (const k of [...this.blobs.keys()]) if (k.startsWith(key + '|')) this.blobs.delete(k);
    }
    if (notify) this.changes.set({ card: key, kind, at: Date.now() });
  }

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    this.ws.startConnection();
    this.ws.on(EXECUTION_PLAN_EVENT, (payload: ExecutionPlanRealtimePayload | { action?: string; cardNumber?: string }) => {
      const card = norm(payload?.cardNumber);
      const action = payload?.action as string | undefined;
      if (!card) return;
      if (action === 'codeRef') this.invalidate(card, 'codeRef');
      else if (action === 'artifact') this.invalidate(card, 'artifact');
    });
    // Voltou a conexão: o que mudou no meio do caminho não chegou.
    this.ws._resynced.subscribe(() => {
      for (const card of new Set([...this.heads.keys(), ...this.watchers.keys()])) this.invalidate(card, 'all');
    });
  }

  private stateOf(card: string): WritableSignal<CodeRefHead[] | null> {
    const key = norm(card);
    let s = this.headsState.get(key);
    if (!s) { s = signal<CodeRefHead[] | null>(null); this.headsState.set(key, s); }
    return s;
  }
}

function norm(card: string | number | null | undefined): string {
  return card === null || card === undefined ? '' : `${card}`.trim();
}
