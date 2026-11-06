import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  AttachTicketRequest,
  CreateWorkItemRequest,
  ExecuteWorkItemResponse,
  TicketStatusRequest,
  UpdateWorkItemRequest,
  WorkItem,
  WorkDeliverable,
  WorkDeliverableDiff,
  WorkItemCatalog,
  WorkItemError,
  WorkItemLive,
  WorkTaskAction,
  formatWorkNumber,
  itemStatusLook
} from '../components/work-items/work-item.model';
import {
  CreateWorkItemTextFileRequest,
  WorkItemFile,
  WorkItemFileKind,
  WorkItemFilesResult,
  normalizeFiles,
  resolveFileContentUrl
} from '../components/work-items/work-item-files';

/** Branch do GitHub (`GET GitHub/branches`). */
export interface GitHubBranch {
  name: string;
  protected?: boolean | null;
  isDefault?: boolean | null;
}

/** Um estado válido do tipo do card no DevOps; `suggested` = próximos usuais (ações configuradas). */
export interface CardStateOption {
  name: string;
  category?: string | null;
  suggested?: boolean | null;
  /** Ação configurada que leva a este estado (ex.: `ready-for-qa`). */
  action?: string | null;
  /** É o estado atual do card. */
  current?: boolean | null;
}

/** `GET Azure/card/{id}/states`. */
export interface CardStates {
  type?: string | null;
  current?: string | null;
  states: CardStateOption[];
}

/** Commit de uma branch (`GET GitHub/commits` → BranchCommitResponse). */
export interface BranchCommit {
  sha: string;
  title?: string | null;
  description?: string | null;
  author?: string | null;
  date?: string | null;
  url?: string | null;
}

/** Repositório do owner do GitHub (`GET GitHub/repositories`). */
export interface GitHubRepositoryOption {
  id: string;
  label: string;
  private?: boolean;
  defaultBranch?: string | null;
}

/** Regras do card (`GET Skills/rules?card=`) — só o que o editor usa. */
export interface CardRulesSummary {
  mainBranch?: string | null;
  branchesByTarget?: Record<string, string> | null;
  flowTargets?: string | null;
}

/**
 * 0085 rodada 4: criar o item a partir de uma ferramenta (`POST WorkItems/card/{card}/from-template`) — o servidor
 * renderiza o modelo com as respostas dos `ask` e cria o item (origem `template`; 409 `duplicate` igual ao criar).
 */
export interface FromTemplateRequest {
  templateKey: string;
  answers: Record<string, string>;
  title?: string | null;
  /** Tipo do item escolhido (padrão no servidor: o do modelo ou `task`). */
  type?: string | null;
  allowDuplicate?: boolean;
  duplicateReason?: string | null;
}

/**
 * 0085: API dos itens de trabalho do card (`api/v1/WorkItems`) e o cancelar-com-desfazer do plano
 * (`ExecutionPlan/{id}/cancel`). Os erros saem como `WorkItemError` com mensagem pronta para a tela
 * (409 `duplicate` traz o item existente; 409 `notEditable` explica que o item já começou).
 */
/** Resultado da busca de itens/sub-tarefas por número, título ou card (`GET WorkItems/search` — o `##` do compositor). */
export interface WorkItemSearchHit {
  kind: 'item' | 'task';
  number: number;
  title: string;
  status: string;
  cardNumber: string;
  /** Item dono (na sub-tarefa; no item é o próprio). */
  itemNumber: number;
  itemTitle: string;
  itemType: string;
  updatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class WorkItemsService {
  private http = inject(HttpClient);
  // environment.apiUrl já termina com /api/v1/
  private apiUrl = `${environment.apiUrl}WorkItems`;
  private planUrl = `${environment.apiUrl}ExecutionPlan`;
  private base = environment.apiUrl;

  private card(card: string): string {
    return encodeURIComponent(card);
  }

  /** Itens do card (com as sub-tarefas), em ordem de número. */
  list(card: string): Observable<WorkItem[]> {
    return this.http.get<WorkItem[]>(`${this.apiUrl}/card/${this.card(card)}`).pipe(this.fail('Não foi possível carregar os itens de trabalho.'));
  }

  /** Itens e sub-tarefas de qualquer card pelo começo do número, título ou card (`exceptCard` tira os do card). */
  search(query: string, exceptCard?: string | null, limit = 10): Observable<WorkItemSearchHit[]> {
    let params = new HttpParams().set('limit', limit);
    if (query.trim()) params = params.set('q', query.trim());
    if (exceptCard) params = params.set('exceptCard', exceptCard);
    return this.http.get<WorkItemSearchHit[]>(`${this.apiUrl}/search`, { params }).pipe(this.fail('Não foi possível buscar os itens de trabalho.'));
  }

  /** Um item com os registros (histórico). Número de sub-tarefa → o item dono, com `matchedTaskNumber`. */
  get(number: number): Observable<WorkItem> {
    return this.http.get<WorkItem>(`${this.apiUrl}/${number}`).pipe(this.fail(`Não foi possível carregar o item ${formatWorkNumber(number)}.`));
  }

  /**
   * Estado ao vivo da execução do item (pedido do executor, atividade agora, últimas atividades e os últimos 50
   * registros) — a sessão de execução da Bancada. Item de plano usa o pedido ativo da pista main do plano.
   */
  live(number: number): Observable<WorkItemLive> {
    return this.http.get<WorkItemLive>(`${this.apiUrl}/${number}/live`).pipe(this.fail(`Não foi possível acompanhar o item ${formatWorkNumber(number)}.`));
  }

  /**
   * 0091: entregas do item (as mesmas do `GET WorkItems/{n}`, sozinhas). Servidor sem o endpoint (404/405) → lista
   * vazia.
   */
  deliverables(number: number): Observable<WorkDeliverable[]> {
    return this.http.get<WorkDeliverable[]>(`${this.apiUrl}/${number}/deliverables`).pipe(
      map((raw) => (Array.isArray(raw) ? raw : [])),
      catchError((err) => (err instanceof HttpErrorResponse && (err.status === 404 || err.status === 405)
        ? of<WorkDeliverable[]>([])
        : throwError(() => toWorkItemError(err, `Não foi possível carregar as entregas do item ${formatWorkNumber(number)}.`))))
    );
  }

  /**
   * 0091: diff de uma entrega (fotografia gravada ou compare ao vivo no GitHub) — só sob demanda, nunca no GET do item.
   * O id pode ser sintético (`out:57:pr`, `pr:edv-solvace#123`): vai codificado. 404 (sem diff) → `null`; o GitHub fora
   * do ar volta com `error` (no corpo 200 ou no erro HTTP).
   */
  deliverableDiff(number: number, id: string): Observable<WorkDeliverableDiff | null> {
    return this.http.get<WorkDeliverableDiff>(`${this.apiUrl}/${number}/deliverables/${encodeURIComponent(id)}/diff`).pipe(
      map((raw) => raw ?? null),
      catchError((err) => {
        if (err instanceof HttpErrorResponse && err.status === 404) return of(null);
        const body: any = err instanceof HttpErrorResponse ? err.error : null;
        if (body && typeof body === 'object' && typeof body.error === 'string' && body.error) {
          return of<WorkDeliverableDiff>({ ...body, files: Array.isArray(body.files) ? body.files : [], error: body.error });
        }
        return throwError(() => toWorkItemError(err, 'Não foi possível carregar as alterações.'));
      })
    );
  }

  /** Kinds de sub-tarefa e modelos (já preenchidos para o card — ex.: branch `hotfix/77434-rv`). */
  catalog(card: string | null | undefined): Observable<WorkItemCatalog> {
    const params = card ? new HttpParams().set('card', card) : undefined;
    return this.http.get<WorkItemCatalog>(`${this.apiUrl}/catalog`, { params }).pipe(this.fail('Não foi possível carregar os modelos de item.'));
  }

  create(card: string, req: CreateWorkItemRequest): Observable<WorkItem> {
    return this.http.post<WorkItem>(`${this.apiUrl}/card/${this.card(card)}`, req).pipe(this.fail('Não foi possível criar o item.'));
  }

  /** Rodada 4: cria o item a partir de uma ferramenta (modelo + respostas). */
  fromTemplate(card: string, req: FromTemplateRequest): Observable<WorkItem> {
    return this.http.post<WorkItem>(`${this.apiUrl}/card/${this.card(card)}/from-template`, req).pipe(this.fail('Não foi possível criar o item pela ferramenta.'));
  }

  update(number: number, req: UpdateWorkItemRequest): Observable<WorkItem> {
    return this.http.put<WorkItem>(`${this.apiUrl}/${number}`, req).pipe(this.fail(`Não foi possível salvar o item ${formatWorkNumber(number)}.`));
  }

  /** "Criar novo a partir deste": cópia pendente (editável). */
  duplicate(number: number): Observable<WorkItem> {
    return this.http.post<WorkItem>(`${this.apiUrl}/${number}/duplicate`, {}).pipe(this.fail(`Não foi possível criar um item a partir do ${formatWorkNumber(number)}.`));
  }

  execute(number: number): Observable<ExecuteWorkItemResponse> {
    return this.http.post<ExecuteWorkItemResponse>(`${this.apiUrl}/${number}/execute`, {}).pipe(this.fail(`Não foi possível executar o item ${formatWorkNumber(number)}.`));
  }

  cancel(number: number, undo: boolean, reason?: string | null): Observable<WorkItem> {
    return this.http.post<WorkItem>(`${this.apiUrl}/${number}/cancel`, { reason: reason || null, undo })
      .pipe(this.fail(`Não foi possível cancelar o item ${formatWorkNumber(number)}.`));
  }

  /** Desfaz item já cancelado/concluído. */
  undo(number: number): Observable<WorkItem> {
    return this.http.post<WorkItem>(`${this.apiUrl}/${number}/undo`, {}).pipe(this.fail(`Não foi possível desfazer o item ${formatWorkNumber(number)}.`));
  }

  /** Ação numa sub-tarefa (do usuário): start/complete/fail/skip — devolve o item atualizado. */
  taskAction(taskNumber: number, action: WorkTaskAction, body: { result?: string | null; output?: Record<string, unknown> | null } = {}): Observable<WorkItem> {
    return this.http.post<WorkItem>(`${this.apiUrl}/tasks/${taskNumber}/${action}`, { result: body.result ?? null, output: body.output ?? null })
      .pipe(this.fail(`Não foi possível atualizar a sub-tarefa ${formatWorkNumber(taskNumber)}.`));
  }

  /** Chamado na Bancada: anexa o chamado à sub-tarefa (ela passa a aguardar o chamado) — devolve o item atualizado. */
  attachTicket(taskNumber: number, req: AttachTicketRequest): Observable<WorkItem> {
    return this.http.post<WorkItem>(`${this.apiUrl}/tasks/${taskNumber}/ticket`, { url: req.url.trim(), title: req.title?.trim() || null })
      .pipe(this.fail(`Não foi possível anexar o chamado na sub-tarefa ${formatWorkNumber(taskNumber)}.`));
  }

  /**
   * Chamado na Bancada: status do chamado da sub-tarefa (`resolved` conclui a sub-tarefa; `closed` = fechado sem
   * resolução; `open` = reabrir) — devolve o item atualizado.
   */
  setTicketStatus(taskNumber: number, req: TicketStatusRequest): Observable<WorkItem> {
    return this.http.put<WorkItem>(`${this.apiUrl}/tasks/${taskNumber}/ticket`, { status: req.status, linkId: req.linkId ?? null })
      .pipe(this.fail(`Não foi possível atualizar o chamado da sub-tarefa ${formatWorkNumber(taskNumber)}.`));
  }

  /** Materializa o item de um plano (cards antigos) — idempotente. */
  fromPlan(card: string, planId: string): Observable<WorkItem> {
    return this.http.post<WorkItem>(`${this.apiUrl}/card/${this.card(card)}/from-plan/${planId}`, {})
      .pipe(this.fail('Não foi possível gerar os itens a partir do plano.'));
  }

  /** Cancela o plano e os itens dele (com `undo` desfaz o que já foi feito). */
  cancelPlan(planId: string, undo: boolean, reason?: string | null): Observable<unknown> {
    return this.http.post(`${this.planUrl}/${planId}/cancel`, { reason: reason || null, undo })
      .pipe(this.fail('Não foi possível cancelar o plano.'));
  }

  /**
   * Rodada 5 (1.2): arquivos do item (os dele e os do plano ligado, `source: 'plan'`). Servidor sem o endpoint (404)
   * → lista vazia com `unavailable` (a tela mostra um aviso discreto em vez de erro).
   */
  files(number: number): Observable<WorkItemFilesResult> {
    return this.http.get<unknown>(`${this.apiUrl}/${number}/files`).pipe(
      map((raw): WorkItemFilesResult => ({ files: normalizeFiles(raw), unavailable: false })),
      catchError((err) => (err instanceof HttpErrorResponse && (err.status === 404 || err.status === 405)
        ? of<WorkItemFilesResult>({ files: [], unavailable: true })
        : throwError(() => toWorkItemError(err, `Não foi possível carregar os arquivos do item ${formatWorkNumber(number)}.`))))
    );
  }

  /**
   * 0087: todos os arquivos do card (itens, planos ligados e planos sem item — `workItemNumber` 0). Servidor sem o
   * endpoint (404/405) → lista vazia com `unavailable`.
   */
  cardFiles(card: string): Observable<WorkItemFilesResult> {
    return this.http.get<unknown>(`${this.apiUrl}/card/${encodeURIComponent(card)}/files`).pipe(
      map((raw): WorkItemFilesResult => ({ files: normalizeFiles(raw), unavailable: false })),
      catchError((err) => (err instanceof HttpErrorResponse && (err.status === 404 || err.status === 405)
        ? of<WorkItemFilesResult>({ files: [], unavailable: true })
        : throwError(() => toWorkItemError(err, `Não foi possível carregar os arquivos do card #${card}.`))))
    );
  }

  /** Conteúdo do arquivo (blob, com a x-api-key do interceptor) — os do plano pelo `contentUrl`. */
  fileContent(number: number, file: Pick<WorkItemFile, 'id' | 'contentUrl'>): Observable<Blob> {
    return this.http.get(resolveFileContentUrl(this.base, number, file), { responseType: 'blob' })
      .pipe(this.fail('Não foi possível baixar o arquivo.'));
  }

  /** Anexa um arquivo ao item (multipart `file`; `kind`/`taskNumber` opcionais). */
  uploadFile(number: number, file: File, kind?: WorkItemFileKind | null, taskNumber?: number | null): Observable<WorkItemFile> {
    const form = new FormData();
    form.append('file', file, file.name);
    if (kind) form.append('kind', kind);
    if (taskNumber != null) form.append('taskNumber', `${taskNumber}`);
    return this.http.post<WorkItemFile>(`${this.apiUrl}/${number}/files`, form)
      .pipe(this.fail(`Não foi possível anexar "${file.name}".`));
  }

  /** Grava um texto como arquivo do item (chamado, script, análise gerados). */
  addTextFile(number: number, req: CreateWorkItemTextFileRequest): Observable<WorkItemFile> {
    return this.http.post<WorkItemFile>(`${this.apiUrl}/${number}/files`, { ...req, taskNumber: req.taskNumber ?? null })
      .pipe(this.fail(`Não foi possível gravar "${req.name}".`));
  }

  /**
   * Rodada 3: branches do repositório (integração do usuário; cache curto no servidor) para os autocompletes do editor.
   * `card` deixa o servidor priorizar as do card.
   */
  branches(repository: string, search?: string | null, card?: string | null, limit = 50): Observable<GitHubBranch[]> {
    let params = new HttpParams().set('repository', repository).set('limit', `${limit}`);
    if (search?.trim()) params = params.set('search', search.trim());
    if (card) params = params.set('card', card);
    return this.http.get<GitHubBranch[]>(`${this.base}GitHub/branches`, { params })
      .pipe(this.fail(`Não foi possível listar as branches de ${repository}.`));
  }

  /** Rodada 3: estados válidos do tipo do card no DevOps (sugeridos marcados) e o estado atual. */
  cardStates(card: string): Observable<CardStates> {
    return this.http.get<CardStates>(`${this.base}Azure/card/${this.card(card)}/states`)
      .pipe(this.fail('Não foi possível carregar os estados do card.'));
  }

  /** Últimos commits de uma branch (seletor de commits do cherry-pick). */
  commits(repository: string, branch: string): Observable<BranchCommit[]> {
    const params = new HttpParams().set('repository', repository).set('branch', branch);
    return this.http.get<BranchCommit[]>(`${this.base}GitHub/commits`, { params })
      .pipe(this.fail(`Não foi possível carregar os commits de "${branch}".`));
  }

  /** Repositórios do owner configurado no plugin do GitHub. */
  repositories(): Observable<GitHubRepositoryOption[]> {
    return this.http.get<GitHubRepositoryOption[]>(`${this.base}GitHub/repositories`)
      .pipe(this.fail('Não foi possível listar os repositórios.'));
  }

  /** Regras do card (branch principal, branch por destino, destinos do fluxo). */
  rules(card: string): Observable<CardRulesSummary> {
    return this.http.get<CardRulesSummary>(`${this.base}Skills/rules`, { params: new HttpParams().set('card', card) })
      .pipe(this.fail('Não foi possível carregar as regras do card.'));
  }

  private fail<T>(fallback: string) {
    return catchError<T, Observable<never>>((err) => throwError(() => toWorkItemError(err, fallback)));
  }
}

/** Erro HTTP → `WorkItemError` com mensagem clara (exportado para os testes). */
export function toWorkItemError(err: unknown, fallback: string): WorkItemError {
  if (err instanceof WorkItemError) return err;
  const http = err instanceof HttpErrorResponse ? err : null;
  const status = http?.status ?? (err as { status?: number })?.status ?? 0;
  const body: any = http ? http.error : (err as { error?: unknown })?.error;
  const code: string | undefined = body?.code ?? body?.extensions?.code;
  const serverText: string | null = (typeof body === 'string' && body) || body?.message || body?.detail || (typeof body?.error === 'string' ? body.error : null) || null;

  if (status === 409 && code === 'duplicate') {
    const existing = body?.existing ?? body?.extensions?.existing ?? null;
    const msg = existing
      ? `Já existe um item igual: ${formatWorkNumber(existing.number)} "${existing.title}" (${itemStatusLook(existing.status).label.toLowerCase()}).`
      : 'Já existe um item igual a este no card.';
    return new WorkItemError(msg, 'duplicate', existing, status);
  }
  if (status === 409 && code === 'notEditable') {
    return new WorkItemError('Este item já foi iniciado e não pode mais ser editado — crie um novo a partir dele.', 'notEditable', null, status);
  }
  if (status === 404) return new WorkItemError(serverText || 'Item não encontrado.', 'notFound', null, status);
  if (status === 409) return new WorkItemError(serverText || fallback, 'conflict', null, status);
  if (status === 0) return new WorkItemError(`${fallback} Sem conexão com o servidor.`, 'error', null, status);
  return new WorkItemError(serverText || fallback, 'error', null, status);
}
