import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, shareReplay, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  BoardConfig, BoardItemsRequest, BoardItemsResponse, CardDetail, CreateCardRequest, DevOpsBoardRef,
  DevOpsClassificationNode, DevOpsFieldDef, DevOpsPerson, DevOpsQueryRequest, DevOpsQueryResponse, DevOpsTeam,
  DevOpsWorkItemType, EpicRef, MoveCardRequest, UpdateCardRequest, DevOpsAttachment, DevOpsCommentsResponse, DevOpsMention
} from '../components/devops/devops.model';

/** Metadados do projeto mudam pouco: cinco minutos poupam chamadas a cada painel/diálogo aberto. */
const META_TTL_MS = 5 * 60_000;
/** Tags mudam mais (qualquer pessoa cria uma nova ao editar um card). */
const TAGS_TTL_MS = 2 * 60_000;
/** Configuração do board: o servidor também guarda 60 s; aqui só evita repetir a chamada no mesmo instante. */
const BOARD_TTL_MS = 30_000;

interface CacheEntry<T> { at: number; ttl: number; obs: Observable<T>; }

/**
 * 0099 (Mesa de gestão): rotas `api/v1/DevOps` — board do time e seus itens, metadados (tipos, campos por tipo, tags,
 * áreas, iterações, pessoas, times, boards), consulta, criar/editar/mover/comentar card. Todas usam a integração
 * pessoal "AzureDevOps Configurations" de quem age (o servidor responde 403 quando falta — o interceptor avisa).
 *
 * Metadados ficam num cache curto em memória (por sessão); gravar um card invalida as tags (pode ter criado uma).
 */
@Injectable({ providedIn: 'root' })
export class DevOpsService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}DevOps/`;
  private cache = new Map<string, CacheEntry<unknown>>();

  private cached<T>(key: string, ttl: number, load: () => Observable<T>): Observable<T> {
    const hit = this.cache.get(key) as CacheEntry<T> | undefined;
    if (hit && Date.now() - hit.at < hit.ttl) return hit.obs;
    const obs = load().pipe(
      tap({ error: () => this.cache.delete(key) }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.cache.set(key, { at: Date.now(), ttl, obs });
    return obs;
  }

  /** Esquece os metadados guardados (todos ou os que começam por `prefix`). */
  invalidate(prefix?: string): void {
    if (!prefix) { this.cache.clear(); return; }
    for (const k of [...this.cache.keys()]) if (k.startsWith(prefix)) this.cache.delete(k);
  }

  // ── Metadados ──

  types(): Observable<DevOpsWorkItemType[]> {
    return this.cached('types', META_TTL_MS, () => this.http.get<DevOpsWorkItemType[]>(`${this.base}meta/types`));
  }

  fields(type: string): Observable<DevOpsFieldDef[]> {
    const params = new HttpParams().set('type', type);
    return this.cached(`fields:${type.toLowerCase()}`, META_TTL_MS,
      () => this.http.get<DevOpsFieldDef[]>(`${this.base}meta/fields`, { params }));
  }

  /** Todas as tags do projeto (o filtro por texto é feito na tela, sem nova chamada a cada tecla). */
  tags(): Observable<string[]> {
    return this.cached('tags', TAGS_TTL_MS,
      () => this.http.get<string[]>(`${this.base}meta/tags`).pipe(map((t) => t ?? [])));
  }

  areas(): Observable<DevOpsClassificationNode[]> {
    return this.cached('areas', META_TTL_MS, () => this.http.get<DevOpsClassificationNode[]>(`${this.base}meta/areas`));
  }

  iterations(): Observable<DevOpsClassificationNode[]> {
    return this.cached('iterations', META_TTL_MS,
      () => this.http.get<DevOpsClassificationNode[]>(`${this.base}meta/iterations`));
  }

  /**
   * Pessoas do DevOps (ajustes 1: membros dos times + usuários da organização + busca de identidades + quem aparece
   * em cards recentes). Com `q`, a busca é no servidor (sem acento/caixa); `top` limita a resposta.
   */
  people(q = '', top?: number): Observable<DevOpsPerson[]> {
    const query = q.trim();
    let params = new HttpParams();
    if (query) params = params.set('q', query);
    if (top) params = params.set('top', `${top}`);
    return this.cached(`people:${query.toLowerCase()}|${top ?? ''}`, META_TTL_MS,
      () => this.http.get<DevOpsPerson[]>(`${this.base}meta/people`, { params }).pipe(map((p) => p ?? [])));
  }

  teams(): Observable<DevOpsTeam[]> {
    return this.cached('teams', META_TTL_MS, () => this.http.get<DevOpsTeam[]>(`${this.base}teams`));
  }

  boards(team: string): Observable<DevOpsBoardRef[]> {
    const params = new HttpParams().set('team', team);
    return this.cached(`boards:${team.toLowerCase()}`, META_TTL_MS,
      () => this.http.get<DevOpsBoardRef[]>(`${this.base}boards`, { params }));
  }

  // ── Board ──

  /** Colunas, lanes e mapeamentos do board. `fresh` ignora o cache local (a tela re-busca a cada 60 s). */
  board(team: string, board: string, fresh = false): Observable<BoardConfig> {
    const key = `board:${team.toLowerCase()}|${board.toLowerCase()}`;
    if (fresh) this.cache.delete(key);
    const params = new HttpParams().set('team', team).set('board', board);
    return this.cached(key, BOARD_TTL_MS, () => this.http.get<BoardConfig>(`${this.base}board`, { params }));
  }

  boardItems(body: BoardItemsRequest): Observable<BoardItemsResponse> {
    return this.http.post<BoardItemsResponse>(`${this.base}board/items`, body);
  }

  query(body: DevOpsQueryRequest): Observable<DevOpsQueryResponse> {
    return this.http.post<DevOpsQueryResponse>(`${this.base}query`, body);
  }

  // ── Card ──

  card(id: number | string): Observable<CardDetail> {
    return this.http.get<CardDetail>(`${this.base}workitems/${encodeURIComponent(`${id}`)}`);
  }

  create(body: CreateCardRequest): Observable<CardDetail> {
    return this.http.post<CardDetail>(`${this.base}workitems`, body).pipe(tap(() => this.invalidate('tags')));
  }

  update(id: number | string, body: UpdateCardRequest): Observable<CardDetail> {
    return this.http.patch<CardDetail>(`${this.base}workitems/${encodeURIComponent(`${id}`)}`, body)
      .pipe(tap(() => { if (body.addTags?.length) this.invalidate('tags'); }));
  }

  move(id: number | string, body: MoveCardRequest): Observable<CardDetail> {
    return this.http.post<CardDetail>(`${this.base}workitems/${encodeURIComponent(`${id}`)}/move`, body);
  }

  /** Comentário na discussion (markdown); `mentions` = pessoas citadas com `@Nome` (viram menção do DevOps). `#123` vira link do card. */
  comment(id: number | string, text: string, mentions: DevOpsMention[] = []): Observable<{ id: number; commentId: number }> {
    const body = mentions.length ? { text, mentions } : { text };
    return this.http.post<{ id: number; commentId: number }>(`${this.base}workitems/${encodeURIComponent(`${id}`)}/comment`, body);
  }

  /** Ajustes 3: discussion do card (mais novos primeiro). */
  comments(id: number | string, top = 200): Observable<DevOpsCommentsResponse> {
    const params = new HttpParams().set('top', `${top}`);
    return this.http.get<DevOpsCommentsResponse>(`${this.base}workitems/${encodeURIComponent(`${id}`)}/comments`, { params })
      .pipe(map((r) => ({ count: r?.count ?? r?.comments?.length ?? 0, comments: r?.comments ?? [] })));
  }

  /** Ajustes 3: anexos do card (arquivos anexados + imagens coladas nos campos e na discussion). */
  attachments(id: number | string): Observable<DevOpsAttachment[]> {
    return this.http.get<DevOpsAttachment[]>(`${this.base}workitems/${encodeURIComponent(`${id}`)}/attachments`).pipe(map((a) => a ?? []));
  }

  /** Conteúdo de um anexo pelo PRMake (o DevOps exige o token — o navegador não abre a URL direto). */
  attachmentBlob(id: number | string, attachmentId: string, name?: string | null, download = false): Observable<Blob> {
    let params = new HttpParams();
    if (name) params = params.set('name', name);
    if (download) params = params.set('download', 'true');
    return this.http.get(`${this.base}workitems/${encodeURIComponent(`${id}`)}/attachments/${encodeURIComponent(attachmentId)}`,
      { params, responseType: 'blob' });
  }

  // ── Épicos do card (rotas `api/v1/Epics`, usadas pelo painel para "Adicionar ao épico") ──

  epicsOfCard(card: number | string): Observable<EpicRef[]> {
    return this.http.get<EpicRef[]>(`${environment.apiUrl}Epics/by-card/${encodeURIComponent(`${card}`)}`)
      .pipe(map((e) => e ?? []));
  }

  addToEpic(epic: number, card: number | string): Observable<unknown> {
    return this.http.post(`${environment.apiUrl}Epics/${epic}/cards`, { card: `${card}`, role: 'linked' });
  }
}
