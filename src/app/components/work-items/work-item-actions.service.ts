import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable, firstValueFrom, shareReplay, catchError, throwError } from 'rxjs';
import { WorkItemsService } from '../../services/work-items.service';
import { CaseChatService } from '../../services/case-chat.service';
import { ExecutionQueueService } from '../../services/execution-queue.service';
import {
  WorkItem,
  WorkItemCatalog,
  WorkItemError,
  WorkItemType,
  WorkTask,
  WorkTaskAction,
  WorkTaskControlRequest,
  WorkTaskMove,
  TASK_ACTION_LABELS,
  TICKET_STATUS_DONE,
  TicketStatus,
  formatSchedule,
  formatWorkNumber
} from './work-item.model';
import { WorkScheduleDialogComponent, WorkScheduleDialogData, WorkScheduleDialogResult } from './work-schedule-dialog.component';
import { workDialogConfig } from './work-dialog-config';
import { CancelWorkDialogComponent, CancelWorkDialogData, CancelWorkDialogResult } from './cancel-work-dialog.component';
import { WorkItemEditorDialogComponent, WorkItemEditorDialogData, WorkItemEditorDialogResult } from './work-item-editor-dialog.component';
import { WorkTaskDialogComponent, WorkTaskDialogData } from './work-task-dialog.component';
import { WorkItemFilesDialogComponent, WorkItemFilesDialogData } from './work-item-files-dialog.component';
import { WorkPromptDialogComponent, WorkPromptDialogData, WorkPromptDialogResult } from './work-prompt-dialog.component';
import { CancelTaskDialogComponent, CancelTaskDialogData, CancelTaskDialogResult } from './cancel-task-dialog.component';

const MOVE_DONE: Record<WorkTaskMove, string> = {
  first: 'foi para o início',
  up: 'subiu uma posição',
  down: 'desceu uma posição',
  last: 'foi para o fim'
};

/** Catálogo guardado por card por pouco tempo (o editor e os modais abrem várias vezes). */
const CATALOG_TTL_MS = 60_000;

/**
 * 0085: ações dos itens de trabalho compartilhadas pela lista e pelo modal do item — executar, editar/criar, criar a
 * partir de, cancelar (com desfazer), desfazer, ações de sub-tarefa do usuário, pedir ao especialista. Cada ação abre o
 * diálogo que precisa, chama a API e avisa no snackbar; devolve se deu certo (quem chamou recarrega/acompanha pelo
 * tempo real).
 */
@Injectable({ providedIn: 'root' })
export class WorkItemActionsService {
  private api = inject(WorkItemsService);
  private chat = inject(CaseChatService);
  private queue = inject(ExecutionQueueService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);
  private router = inject(Router);
  private catalogs = new Map<string, { at: number; obs: Observable<WorkItemCatalog> }>();

  catalog(card: string): Observable<WorkItemCatalog> {
    const hit = this.catalogs.get(card);
    if (hit && Date.now() - hit.at < CATALOG_TTL_MS) return hit.obs;
    const obs = this.api.catalog(card).pipe(
      catchError((e) => { this.catalogs.delete(card); return throwError(() => e); }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.catalogs.set(card, { at: Date.now(), obs });
    return obs;
  }

  /** Catálogo já carregado (ou null) — para quem só quer rótulos/ícones sem esperar. */
  async catalogOrNull(card: string): Promise<WorkItemCatalog | null> {
    try { return await firstValueFrom(this.catalog(card)); } catch { return null; }
  }

  /** Executa (o play da tela é sempre "agora": item agendado/em espera tira o agendamento). */
  async execute(item: WorkItem): Promise<boolean> {
    try {
      const r = await firstValueFrom(this.api.execute(item.number, true));
      this.ok(`${formatWorkNumber(item.number)} ${r?.status === 'running' ? 'em execução' : 'na fila do executor'}.`);
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    }
  }

  /** Criar item (modelo ou do zero). */
  async create(card: string, cardType: WorkItemType, templateKey?: string | null): Promise<WorkItem | undefined> {
    const catalog = await this.peekCatalog(card);
    const saved = await this.openEditor({ card, cardType, catalog, templateKey: templateKey ?? null });
    if (saved) this.ok(`Item ${formatWorkNumber(saved.number)} criado.`);
    return saved;
  }

  /** Editar — item já iniciado explica e oferece "Criar novo a partir deste". */
  async edit(card: string, cardType: WorkItemType, item: WorkItem): Promise<WorkItem | undefined> {
    if (!item.editable) {
      const go = await this.prompt({
        title: `${formatWorkNumber(item.number)} não pode ser editado`,
        icon: 'lock',
        text: 'Este item já foi iniciado (ou terminou): mudar agora deixaria o histórico inconsistente.\nCrie um novo item a partir deste e ajuste o que precisar.',
        confirm: 'Criar novo a partir deste',
        confirmIcon: 'content_copy'
      });
      return go ? this.duplicateAndEdit(card, cardType, item) : undefined;
    }
    const catalog = await this.peekCatalog(card);
    const saved = await this.openEditor({ card, cardType, item, catalog });
    if (saved) this.ok(`Item ${formatWorkNumber(saved.number)} salvo.`);
    return saved;
  }

  /** "Criar novo a partir deste": o servidor copia (pendente) e o editor abre na cópia. */
  async duplicateAndEdit(card: string, cardType: WorkItemType, item: WorkItem): Promise<WorkItem | undefined> {
    let copy: WorkItem;
    try {
      copy = await firstValueFrom(this.api.duplicate(item.number));
    } catch (e) {
      this.fail(e);
      return undefined;
    }
    this.ok(`Item ${formatWorkNumber(copy.number)} criado a partir do ${formatWorkNumber(item.number)} — ajuste e salve.`);
    const catalog = await this.peekCatalog(card);
    return (await this.openEditor({ card, cardType, item: copy, catalog })) ?? copy;
  }

  async cancel(item: WorkItem): Promise<boolean> {
    const res = await this.openCancel({ kind: 'item', title: item.title, number: item.number, planId: item.planId ?? undefined });
    if (!res) return false;
    try {
      await firstValueFrom(this.api.cancel(item.number, res.undo, res.reason));
      this.ok(res.undo ? `${formatWorkNumber(item.number)} cancelado — desfazendo o que já foi feito.` : `${formatWorkNumber(item.number)} cancelado.`);
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    }
  }

  /** Cancelar o plano (e os itens dele), com desfazer opcional — usado pela aba Plano da Bancada. */
  async cancelPlan(planId: string, title: string): Promise<boolean> {
    const res = await this.openCancel({ kind: 'plan', title, planId });
    if (!res) return false;
    try {
      await firstValueFrom(this.api.cancelPlan(planId, res.undo, res.reason));
      this.ok(res.undo ? 'Plano cancelado — desfazendo o que já foi feito.' : 'Plano cancelado.');
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    }
  }

  async undo(item: WorkItem): Promise<boolean> {
    const go = await this.prompt({
      title: `Desfazer ${formatWorkNumber(item.number)}?`,
      icon: 'undo',
      text: 'As sub-tarefas concluídas são desfeitas em ordem reversa (fechar PRs, apagar branches criadas, reverter commits, voltar o estado do card). Roda pelo executor, como um pedido na fila.',
      confirm: 'Desfazer',
      confirmIcon: 'undo',
      danger: true
    });
    if (!go) return false;
    try {
      await firstValueFrom(this.api.undo(item.number));
      this.ok(`${formatWorkNumber(item.number)}: desfazendo.`);
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    }
  }

  async taskAction(task: WorkTask, action: WorkTaskAction): Promise<boolean> {
    try {
      await firstValueFrom(this.api.taskAction(task.number, action));
      this.ok(`${formatWorkNumber(task.number)}: ${TASK_ACTION_LABELS[action].label.toLowerCase()} — ok.`);
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    }
  }

  /**
   * Card 78680: muda a ordem / pausa / continua uma sub-tarefa sem cancelar o item — devolve o item atualizado (ou
   * undefined se falhou; a recusa por dependência vem com o motivo no snackbar).
   */
  async controlTask(task: Pick<WorkTask, 'number'>, req: WorkTaskControlRequest): Promise<WorkItem | undefined> {
    try {
      const it = await firstValueFrom(this.api.controlTask(task.number, req));
      const n = formatWorkNumber(task.number);
      const restarted = it.status === 'queued' || it.status === 'running' ? ' A execução segue na ordem nova.' : '';
      switch (req.action) {
        case 'move': this.ok(`${n} ${MOVE_DONE[req.position as WorkTaskMove] ?? 'mudou de lugar'}.${restarted}`); break;
        case 'pause': this.ok(`${n} pausada — o Claude não a faz (nem as que dependem dela) até você continuar.`); break;
        case 'resume': this.ok(`${n} continua.${restarted}`); break;
        case 'cancel': this.ok(`${n} cancelada — o item segue com as outras.`); break;
        case 'schedule': this.ok(`${n} agendada para ${formatSchedule(req.at)} — continua sozinha no horário.`); break;
      }
      return it;
    } catch (e) {
      this.fail(e);
      return undefined;
    }
  }

  /**
   * 0103: agenda o item (ou deixa em espera sem data, tira o agendamento, executa agora) — devolve o item atualizado (ou
   * undefined se desistiu/falhou).
   */
  async scheduleItem(item: WorkItem): Promise<WorkItem | undefined> {
    const res = await this.openSchedule({
      title: `${formatWorkNumber(item.number)} ${item.title}`, subject: 'item', current: item.scheduledAt ?? null, parked: !!item.parked
    });
    if (!res) return undefined;
    const n = formatWorkNumber(item.number);
    try {
      if (res.action === 'run-now') {
        const r = await firstValueFrom(this.api.execute(item.number, true));
        this.ok(`${n} executando agora — agendamento removido.`);
        return r.item ?? undefined;
      }
      const it = await firstValueFrom(this.api.schedule(item.number, res.action === 'set' ? { action: 'set', at: res.at } : { action: res.action }));
      this.ok(res.action === 'set' ? `${n} agendado para ${formatSchedule(it.scheduledAt ?? res.at)} — começa sozinho no seu executor.`
        : res.action === 'park' ? `${n} em espera, sem data — roda quando você executar.` : `${n}: agendamento removido.`);
      return it;
    } catch (e) {
      this.fail(e);
      return undefined;
    }
  }

  /** 0103: agenda a sub-tarefa (pausada até o horário), muda o horário, tira (continua) ou executa agora. */
  async scheduleTask(item: Pick<WorkItem, 'tasks'>, task: WorkTask): Promise<WorkItem | undefined> {
    const res = await this.openSchedule({
      title: `${formatWorkNumber(task.number)} ${task.title}`, subject: 'task', current: task.scheduledAt ?? null,
      dependents: task.controls?.dependents ?? []
    });
    if (!res) return undefined;
    switch (res.action) {
      case 'set': return this.controlTask(task, { action: 'schedule', at: res.at });
      case 'run-now': return this.runTaskNow(task);
      case 'clear': return task.held ? this.controlTask(task, { action: 'resume' }) : undefined;
      default: return undefined;
    }
  }

  /** 0103: "Executar agora" da sub-tarefa agendada — tira o agendamento e retoma o item. */
  async runTaskNow(task: Pick<WorkTask, 'number'>): Promise<WorkItem | undefined> {
    try {
      const it = await firstValueFrom(this.api.controlTask(task.number, { action: 'resume', execute: true, reason: 'executar agora' }));
      this.ok(`${formatWorkNumber(task.number)}: agendamento removido — ${it.status === 'queued' || it.status === 'running' ? 'executando agora' : 'segue no fluxo do item'}.`);
      return it;
    } catch (e) {
      this.fail(e);
      return undefined;
    }
  }

  private openSchedule(data: WorkScheduleDialogData): Promise<WorkScheduleDialogResult> {
    return firstValueFrom(this.dialog.open<WorkScheduleDialogComponent, WorkScheduleDialogData, WorkScheduleDialogResult>(
      WorkScheduleDialogComponent, workDialogConfig(data, '600px')).afterClosed());
  }

  /** Card 78680: cancela só a sub-tarefa (pergunta o motivo e, se outras dependem dela, se cancelam junto). */
  async cancelTask(item: Pick<WorkItem, 'tasks'>, task: WorkTask): Promise<WorkItem | undefined> {
    const dependents = (task.controls?.dependents ?? [])
      .map((n) => item.tasks.find((t) => t.number === n))
      .filter((t): t is WorkTask => !!t)
      .map((t) => ({ number: t.number, title: t.title }));
    const res = await firstValueFrom(this.dialog.open<CancelTaskDialogComponent, CancelTaskDialogData, CancelTaskDialogResult>(
      CancelTaskDialogComponent, workDialogConfig({ task: { number: task.number, title: task.title }, dependents }, '520px')).afterClosed());
    if (!res) return undefined;
    return this.controlTask(task, { action: 'cancel', reason: res.reason, dependents: res.dependents });
  }

  /** "Já resolvi": a sub-tarefa volta a andar e o Claude retoma o item — devolve o item atualizado (ou undefined se falhou). */
  async resolveTask(task: Pick<WorkTask, 'number'>, note?: string | null): Promise<WorkItem | undefined> {
    try {
      const it = await firstValueFrom(this.api.resolveTask(task.number, note));
      this.ok(`${formatWorkNumber(task.number)}: avisado — o Claude retoma o item.`);
      return it;
    } catch (e) {
      this.fail(e);
      return undefined;
    }
  }

  /** Chamado na Bancada: anexa o chamado à sub-tarefa — devolve o item atualizado (ou undefined se falhou). */
  async attachTicket(task: Pick<WorkTask, 'number'>, url: string, title?: string | null): Promise<WorkItem | undefined> {
    try {
      const it = await firstValueFrom(this.api.attachTicket(task.number, { url, title: title ?? null }));
      this.ok(`${formatWorkNumber(task.number)}: chamado anexado — a sub-tarefa aguarda o chamado ser resolvido.`);
      return it;
    } catch (e) {
      this.fail(e);
      return undefined;
    }
  }

  /** Chamado na Bancada: muda o status do chamado (resolvido conclui a sub-tarefa) — devolve o item atualizado. */
  async setTicketStatus(task: Pick<WorkTask, 'number'>, status: TicketStatus, linkId?: string | null): Promise<WorkItem | undefined> {
    try {
      const it = await firstValueFrom(this.api.setTicketStatus(task.number, { status, linkId: linkId ?? null }));
      this.ok(`${formatWorkNumber(task.number)}: ${TICKET_STATUS_DONE[status]}.`);
      return it;
    } catch (e) {
      this.fail(e);
      return undefined;
    }
  }

  openTask(card: string, item: WorkItem, taskNumber: number, catalog?: WorkItemCatalog | null, readOnly = false): MatDialogRef<WorkTaskDialogComponent> {
    const data: WorkTaskDialogData = { card, itemNumber: item.number, taskNumber, item, catalog: catalog ?? null, readOnly };
    return this.dialog.open(WorkTaskDialogComponent, workDialogConfig(data, '640px'));
  }

  /** Rodada 5: arquivos do item num modal (chip "Arquivos" da sessão de execução). */
  openFiles(card: string, number: number, title?: string | null, taskNumber?: number | null): MatDialogRef<WorkItemFilesDialogComponent> {
    const data: WorkItemFilesDialogData = { card, number, title: title ?? null, taskNumber: taskNumber ?? null };
    return this.dialog.open(WorkItemFilesDialogComponent, workDialogConfig(data, '680px'));
  }

  /** Materializa o item de um plano de correção (cards antigos). */
  async fromPlan(card: string, planId: string): Promise<WorkItem | undefined> {
    try {
      const it = await firstValueFrom(this.api.fromPlan(card, planId));
      this.ok(`Item ${formatWorkNumber(it.number)} gerado a partir do plano.`);
      return it;
    } catch (e) {
      this.fail(e);
      return undefined;
    }
  }

  /**
   * Card 77988: itens a partir da análise que terminou sem plano de implementação/correção ("só a análise por enquanto").
   * O Claude do tratamento monta o plano na máquina de quem pediu — com `start`, já executa; sem, deixa pausado.
   */
  async fromAnalysis(card: string, start: boolean, fix: string): Promise<boolean> {
    try {
      await firstValueFrom(this.queue.delivery(card, start));
      this.ok(start
        ? `Pedido enviado: o Claude monta o plano de ${fix} e já começa — o item aparece aqui em instantes.`
        : `Pedido enviado: o Claude monta o plano de ${fix} e deixa pausado — use Executar no item quando quiser.`);
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    }
  }

  /**
   * "Pedir ao especialista": manda uma mensagem na conversa do caso mencionando o especialista (`@especialista` faz o
   * servidor chamá-lo mesmo com várias pessoas na conversa), dizendo que é um pedido de item de trabalho.
   */
  async askSpecialist(card: string, cardType: WorkItemType): Promise<boolean> {
    const text = await this.prompt({
      title: 'Pedir ao especialista',
      icon: 'psychology',
      text: 'Descreva o que precisa ser feito. O especialista do caso monta o item de trabalho (com as sub-tarefas e os nomes de branch pelas regras do PRMake), sem repetir item que já existe.',
      input: { placeholder: 'Ex.: levar a correção para release-version (cherry-pick + PR)', required: true, rows: 4 },
      confirm: 'Enviar ao especialista',
      confirmIcon: 'send'
    });
    if (typeof text !== 'string' || !text.trim()) return false;
    // 0099: no épico (Mesa de gestão) o pedido é de tarefa de gestão — sem termos de bug/US.
    const body = cardType === 'epic'
      ? `@especialista Pedido de tarefa de gestão do épico: ${text.trim()}\n\n`
        + 'Crie o item de trabalho no PRMake (prmake_work_item_create) neste épico, pelas regras de gestão do PRMake — sem duplicar item existente. '
        + 'Use o tipo de item de gestão certo (report, duplicates, understanding, rca, devops, planning, task…).'
      : `@especialista Pedido de item de trabalho (${cardType === 'user-story' ? 'User Story' : 'Bug'}): ${text.trim()}\n\n`
        + 'Crie o item de trabalho no PRMake (prmake_work_item_create) seguindo as regras do PRMake para este card — sem duplicar item existente. '
        + 'Use o tipo de item certo (task, pull-request, review, adjustment, closing…), não Bug/User Story.';
    try {
      await firstValueFrom(this.chat.post(card, { text: body }));
      this.ok('Pedido enviado — o especialista responde na conversa do caso.');
      return true;
    } catch (e) {
      this.fail(e, 'Não foi possível enviar o pedido ao especialista.');
      return false;
    }
  }

  /** "Abrir plano": a Bancada abre a aba Execução já no plano do item (`?item=<n>&focus=plan`). */
  openPlan(itemNumber?: number | null): void {
    this.router.navigate([], { queryParams: { focus: 'plan', item: itemNumber ?? null }, queryParamsHandling: 'merge' });
  }

  // ── internos ─────────────────────────────────────────────────────────────────────────────────

  private async peekCatalog(card: string): Promise<WorkItemCatalog | null> {
    // Não segura o editor esperando: se o catálogo não vier logo, o editor busca sozinho.
    const hit = this.catalogs.get(card);
    if (!hit) { this.catalog(card).subscribe({ error: () => {} }); return null; }
    let value: WorkItemCatalog | null = null;
    hit.obs.subscribe({ next: (c) => (value = c), error: () => {} }).unsubscribe();
    return value;
  }

  private openEditor(data: WorkItemEditorDialogData): Promise<WorkItemEditorDialogResult> {
    const ref = this.dialog.open<WorkItemEditorDialogComponent, WorkItemEditorDialogData, WorkItemEditorDialogResult>(
      WorkItemEditorDialogComponent, workDialogConfig(data, '820px'));
    return firstValueFrom(ref.afterClosed());
  }

  private openCancel(data: CancelWorkDialogData): Promise<CancelWorkDialogResult> {
    const ref = this.dialog.open<CancelWorkDialogComponent, CancelWorkDialogData, CancelWorkDialogResult>(
      CancelWorkDialogComponent, workDialogConfig(data, '520px'));
    return firstValueFrom(ref.afterClosed());
  }

  private prompt(data: WorkPromptDialogData): Promise<WorkPromptDialogResult> {
    const ref = this.dialog.open<WorkPromptDialogComponent, WorkPromptDialogData, WorkPromptDialogResult>(
      WorkPromptDialogComponent, workDialogConfig(data, '520px'));
    return firstValueFrom(ref.afterClosed());
  }

  private ok(message: string): void {
    this.snack.open(message, 'Ok', { duration: 3500 });
  }

  private fail(e: unknown, fallback = 'Não foi possível concluir a ação.'): void {
    const body = (e as { error?: any })?.error;
    const msg = e instanceof WorkItemError ? e.message : (typeof body === 'string' && body) || body?.error || body?.message || fallback;
    this.snack.open(msg, 'Fechar', { duration: 8000 });
  }
}
