import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  CreateWorkItemRequest,
  ExecuteWorkItemResponse,
  UpdateWorkItemRequest,
  WorkItem,
  WorkItemCatalog,
  WorkItemError,
  WorkItemLive,
  WorkTaskAction,
  formatWorkNumber,
  itemStatusLook
} from '../components/work-items/work-item.model';

/**
 * 0085: API dos itens de trabalho do card (`api/v1/WorkItems`) e o cancelar-com-desfazer do plano
 * (`ExecutionPlan/{id}/cancel`). Os erros saem como `WorkItemError` com mensagem pronta para a tela
 * (409 `duplicate` traz o item existente; 409 `notEditable` explica que o item já começou).
 */
@Injectable({ providedIn: 'root' })
export class WorkItemsService {
  private http = inject(HttpClient);
  // environment.apiUrl já termina com /api/v1/
  private apiUrl = `${environment.apiUrl}WorkItems`;
  private planUrl = `${environment.apiUrl}ExecutionPlan`;

  private card(card: string): string {
    return encodeURIComponent(card);
  }

  /** Itens do card (com as sub-tarefas), em ordem de número. */
  list(card: string): Observable<WorkItem[]> {
    return this.http.get<WorkItem[]>(`${this.apiUrl}/card/${this.card(card)}`).pipe(this.fail('Não foi possível carregar os itens de trabalho.'));
  }

  /** Um item com os registros (histórico). */
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

  /** Kinds de sub-tarefa e modelos (já preenchidos para o card — ex.: branch `hotfix/77434-rv`). */
  catalog(card: string | null | undefined): Observable<WorkItemCatalog> {
    const params = card ? new HttpParams().set('card', card) : undefined;
    return this.http.get<WorkItemCatalog>(`${this.apiUrl}/catalog`, { params }).pipe(this.fail('Não foi possível carregar os modelos de item.'));
  }

  create(card: string, req: CreateWorkItemRequest): Observable<WorkItem> {
    return this.http.post<WorkItem>(`${this.apiUrl}/card/${this.card(card)}`, req).pipe(this.fail('Não foi possível criar o item.'));
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
