import { Injectable, WritableSignal, computed, inject, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { CaseChatService } from '../../services/case-chat.service';
import { WorkItemSearchHit, WorkItemsService } from '../../services/work-items.service';
import { planApiError } from '../../services/execution-plan.service';
import { WorkItemActionsService } from '../work-items/work-item-actions.service';
import { WorkItem, WorkItemError, canCancel, canUndo, formatWorkNumber } from '../work-items/work-item.model';
import { workDialogConfig } from '../work-items/work-dialog-config';
import { CancelWorkDialogComponent, CancelWorkDialogData, CancelWorkDialogResult } from '../work-items/cancel-work-dialog.component';
import { WorkPromptDialogComponent, WorkPromptDialogData, WorkPromptDialogResult } from '../work-items/work-prompt-dialog.component';
import { buildToolViews, initialAnswers, previewTasks, toolContext } from '../specialist-tools/specialist-tools.logic';
import {
  ComposerAction,
  ComposerItem,
  ComposerSuggestion,
  ComposerTool,
  ComposerTrigger,
  ParsedCommand,
  applySuggestion,
  crossCardSuggestions,
  detectTrigger,
  hashSuggestions,
  moveActive,
  parseCommand,
  slashSuggestions
} from './composer-suggest';

/** Itens do card ficam guardados por pouco tempo (o `#` abre várias vezes enquanto a pessoa digita). */
const ITEMS_TTL_MS = 20_000;
const LOOKUP_DELAY_MS = 250;
const SEARCH_DELAY_MS = 250;
const SEARCH_TTL_MS = 30_000;

type Lookup = ComposerItem | 'loading' | null;
type Search = ComposerItem[] | 'loading';

function toComposerItem(i: WorkItem): ComposerItem {
  return { number: i.number, title: i.title, status: i.status, cardNumber: `${i.cardNumber}`, done: (i.tasks ?? []).some((t) => t.status === 'completed'),
    tasks: (i.tasks ?? []).map((t) => ({ number: t.number, title: t.title, status: t.status })) };
}

/** O que `#n` aponta: o item ou, se o número era de uma sub-tarefa (`matchedTaskNumber`), a sub-tarefa com o item dono. */
function citedItem(i: WorkItem): ComposerItem {
  const item = toComposerItem(i);
  const task = i.matchedTaskNumber ? (i.tasks ?? []).find((t) => t.number === i.matchedTaskNumber) : undefined;
  return task ? { number: task.number, title: task.title, status: task.status, cardNumber: item.cardNumber, parentNumber: i.number, parentTitle: i.title } : item;
}

function searchHitItem(h: WorkItemSearchHit): ComposerItem {
  return h.kind === 'task'
    ? { number: h.number, title: h.title, status: h.status, cardNumber: `${h.cardNumber}`, parentNumber: h.itemNumber, parentTitle: h.itemTitle }
    : { number: h.number, title: h.title, status: h.status, cardNumber: `${h.cardNumber}` };
}

/**
 * 0090: dados e ações do compositor do Especialista (conversa grande e compacta) — ferramentas que se aplicam ao card
 * (lista do `/`), itens do card e busca de um item pelo número (lista do `#`), `/clear` (com confirmação) e
 * `/cancelar-item-de-trabalho #n` (diálogo de cancelar da 0085, com "desfazer" marcado quando o item já fez algo).
 */
@Injectable({ providedIn: 'root' })
export class CaseComposerService {
  private actions = inject(WorkItemActionsService);
  private items = inject(WorkItemsService);
  private chat = inject(CaseChatService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);

  private toolsByCard = new Map<string, WritableSignal<ComposerTool[] | null>>();
  private itemsByCard = new Map<string, { at: number; value: WritableSignal<ComposerItem[] | null>; loading: boolean }>();
  private lookups = signal<Record<number, Lookup>>({});
  private lookupTimer?: ReturnType<typeof setTimeout>;
  private searches = signal<Record<string, Search>>({});
  private searchedAt = new Map<string, number>();
  private searchTimer?: ReturnType<typeof setTimeout>;

  /** Ferramentas que se aplicam ao card (null = carregando ou ainda não pedidas — chame {@link ensureTools} antes). */
  toolsOf(card: string, cardType: 'bug' | 'user-story'): ComposerTool[] | null {
    return this.toolsByCard.get(`${card}|${cardType}`)?.() ?? null;
  }

  /** Carrega (uma vez) as ferramentas que se aplicam ao card. Fora de `computed`: o catálogo em cache emite na hora. */
  ensureTools(card: string, cardType: 'bug' | 'user-story'): void {
    const key = `${card}|${cardType}`;
    let s = this.toolsByCard.get(key);
    if (!s) {
      s = signal<ComposerTool[] | null>(null);
      this.toolsByCard.set(key, s);
      const target = s;
      this.actions.catalog(card).subscribe({
        next: (catalog) => {
          const ctx = toolContext(catalog, card);
          target.set(buildToolViews(catalog, cardType).filter((v) => v.applicable).map((v) => ({
            key: v.key,
            title: v.title,
            icon: v.icon,
            color: v.color,
            description: previewTasks({ tasks: [{ title: v.description, kind: 'manual' }] as never, ask: v.ask }, initialAnswers(v.ask, ctx), ctx)[0]?.title
              ?? v.description
          })));
        },
        error: () => { target.set([]); this.toolsByCard.delete(key); }
      });
    }
  }

  /** Itens do card (null = carregando ou ainda não pedidos — chame {@link ensureItems} antes). */
  itemsOf(card: string): ComposerItem[] | null {
    return this.itemsByCard.get(card)?.value() ?? null;
  }

  /** Carrega os itens do card (recarrega se a cópia passou do prazo). Fora de `computed`. */
  ensureItems(card: string): void {
    let entry = this.itemsByCard.get(card);
    if (!entry) {
      entry = { at: 0, value: signal<ComposerItem[] | null>(null), loading: false };
      this.itemsByCard.set(card, entry);
    }
    if (!entry.loading && Date.now() - entry.at > ITEMS_TTL_MS) {
      const e = entry;
      e.loading = true;
      this.items.list(card).subscribe({
        next: (list) => { e.value.set(list.map(toComposerItem)); e.at = Date.now(); e.loading = false; },
        error: () => { if (e.value() === null) e.value.set([]); e.loading = false; }
      });
    }
  }

  /** Item buscado pelo número (fora da lista do card). */
  lookup(n: number): Lookup | undefined {
    return this.lookups()[n];
  }

  /** Pede (com um pequeno atraso, para não buscar a cada tecla) o item `n`. */
  requestLookup(n: number): void {
    if (!(n > 0) || this.lookups()[n] !== undefined) return;
    clearTimeout(this.lookupTimer);
    this.lookupTimer = setTimeout(() => {
      if (this.lookups()[n] !== undefined) return;
      this.lookups.update((m) => ({ ...m, [n]: 'loading' }));
      this.items.get(n).subscribe({
        next: (i) => this.lookups.update((m) => ({ ...m, [n]: citedItem(i) })),
        error: (e) => this.lookups.update((m) => {
          const next = { ...m };
          if (e instanceof WorkItemError && e.code === 'notFound') next[n] = null; else delete next[n];
          return next;
        })
      });
    }, LOOKUP_DELAY_MS);
  }

  /** `##`: itens e sub-tarefas de outros cards que batem com `query` (undefined = ainda não pedida). */
  searchOf(card: string, query: string): Search | undefined {
    return this.searches()[`${card}|${query.trim()}`];
  }

  /** Pede (com atraso, para não buscar a cada tecla) a busca do `##` fora do card. Fora de `computed`. */
  requestSearch(card: string, query: string): void {
    const q = query.trim();
    const key = `${card}|${q}`;
    const fresh = Date.now() - (this.searchedAt.get(key) ?? 0) < SEARCH_TTL_MS;
    if (this.searches()[key] === 'loading' || (this.searches()[key] !== undefined && fresh)) return;
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.searches.update((m) => ({ ...m, [key]: m[key] && m[key] !== 'loading' ? m[key] : 'loading' }));
      this.items.search(q, card).subscribe({
        next: (hits) => { this.searchedAt.set(key, Date.now()); this.searches.update((m) => ({ ...m, [key]: hits.map(searchHitItem) })); },
        error: () => this.searches.update((m) => ({ ...m, [key]: [] }))
      });
    }, q ? SEARCH_DELAY_MS : 0);
  }

  /** `/clear`: confirma e limpa a conversa para todos. */
  async clear(card: string): Promise<boolean> {
    const go = await this.prompt({
      title: 'Limpar toda a conversa?',
      icon: 'delete_sweep',
      text: 'As mensagens, os arquivos, os pontos combinados e as propostas desta conversa saem da tela de todos que estão no caso, ' +
        'a resposta em andamento para e o especialista recomeça do zero.\nO plano, os itens de trabalho e o card não mudam.',
      confirm: 'Limpar a conversa',
      confirmIcon: 'delete_sweep',
      danger: true
    });
    if (!go) return false;
    try {
      await firstValueFrom(this.chat.clear(card));
      this.snack.open('Conversa limpa — o especialista recomeça do zero.', 'Ok', { duration: 4000 });
      this.invalidateItems(card);
      return true;
    } catch (e) {
      this.snack.open(planApiError(e, 'Não foi possível limpar a conversa.'), 'Fechar', { duration: 8000 });
      return false;
    }
  }

  /**
   * `/cancelar-item-de-trabalho #n`: item aberto → diálogo de cancelar (desfazer já marcado se o item fez algo); concluído
   * ou cancelado com algo feito → confirma o desfazer; o resto avisa. Só item deste card.
   */
  async cancelItem(card: string, n: number, reason?: string | null): Promise<boolean> {
    let item: WorkItem;
    try {
      item = await firstValueFrom(this.items.get(n));
    } catch (e) {
      this.snack.open(e instanceof Error ? e.message : `Não foi possível carregar o item ${formatWorkNumber(n)}.`, 'Fechar', { duration: 6000 });
      return false;
    }
    if (item.matchedTaskNumber) {
      this.snack.open(`${formatWorkNumber(n)} é uma sub-tarefa do item ${formatWorkNumber(item.number)} — cancele o item.`, 'Ok', { duration: 6000 });
      return false;
    }
    if (`${item.cardNumber}`.trim() !== `${card}`.trim()) {
      this.snack.open(`O item ${formatWorkNumber(n)} é do card ${item.cardNumber} — cancele pela conversa daquele card.`, 'Ok', { duration: 6000 });
      return false;
    }
    const done = (item.tasks ?? []).some((t) => t.status === 'completed');
    let undo: boolean;
    let why = reason ?? null;
    if (canCancel(item)) {
      const res = await this.openCancel({ kind: 'item', title: item.title, number: item.number, planId: item.planId ?? undefined, undoDefault: done });
      if (!res) return false;
      undo = res.undo;
      why = res.reason ?? why;
    } else if (canUndo(item)) {
      const go = await this.prompt({
        title: `Desfazer ${formatWorkNumber(item.number)}?`,
        icon: 'undo',
        text: `${item.title}\n\nO item já está ${item.status === 'completed' ? 'concluído' : 'cancelado'}. As sub-tarefas concluídas são desfeitas em ordem reversa ` +
          '(fechar PRs, apagar branches criadas, reverter commits, voltar o estado do card), pelo executor.',
        confirm: 'Desfazer',
        confirmIcon: 'undo',
        danger: true
      });
      if (!go) return false;
      undo = true;
    } else {
      this.snack.open(`${formatWorkNumber(n)} já está ${item.status === 'reverted' ? 'desfeito' : item.status === 'reverting' ? 'sendo desfeito' : 'cancelado, sem nada para desfazer'}.`,
        'Ok', { duration: 5000 });
      return false;
    }
    try {
      await firstValueFrom(this.chat.cancelWorkItem(card, n, undo, why));
      this.snack.open(undo && done ? `${formatWorkNumber(n)} cancelado — desfazendo o que já foi feito.` : `${formatWorkNumber(n)} cancelado.`, 'Ok', { duration: 4000 });
      this.invalidateItems(card);
      return true;
    } catch (e) {
      this.snack.open(planApiError(e, `Não foi possível cancelar o item ${formatWorkNumber(n)}.`), 'Fechar', { duration: 8000 });
      return false;
    }
  }

  private invalidateItems(card: string): void {
    const e = this.itemsByCard.get(card);
    if (e) e.at = 0;
  }

  private openCancel(data: CancelWorkDialogData): Promise<CancelWorkDialogResult> {
    return firstValueFrom(this.dialog.open<CancelWorkDialogComponent, CancelWorkDialogData, CancelWorkDialogResult>(
      CancelWorkDialogComponent, workDialogConfig(data, '520px')).afterClosed());
  }

  private prompt(data: WorkPromptDialogData): Promise<WorkPromptDialogResult> {
    return firstValueFrom(this.dialog.open<WorkPromptDialogComponent, WorkPromptDialogData, WorkPromptDialogResult>(
      WorkPromptDialogComponent, workDialogConfig(data, '520px')).afterClosed());
  }
}

/**
 * 0090: estado da lista de sugestões de UM compositor (cada conversa cria o seu): o gatilho no cursor, a opção ativa,
 * as sugestões (das listas do {@link CaseComposerService}) e o que fazer com a tecla/escolha. Quem hospeda aplica a
 * ação devolvida (inserir no texto, limpar, abrir a ferramenta).
 */
export class CaseComposer {
  readonly trigger = signal<ComposerTrigger | null>(null);
  readonly active = signal(0);
  private dismissedAt: string | null = null;

  readonly suggestions = computed<ComposerSuggestion[]>(() => {
    const t = this.trigger();
    const card = this.card();
    if (!t || !card) return [];
    if (t.kind === 'slash') return slashSuggestions(t.query, this.svc.toolsOf(card, this.cardType()) ?? []);
    if (t.scope === 'all') return crossCardSuggestions(t, card, this.svc.searchOf(card, t.query));
    const n = /^\d+$/.test(t.query) ? Number(t.query) : 0;
    return hashSuggestions(t, card, this.svc.itemsOf(card), n ? this.svc.lookup(n) : undefined);
  });
  readonly open = computed(() => this.suggestions().length > 0);
  /** Título da lista. */
  readonly heading = computed(() => {
    const t = this.trigger();
    if (t?.kind === 'slash') return null;
    return t?.scope === 'all' ? 'Itens de outros cards (referência)' : 'Itens de trabalho e sub-tarefas';
  });
  /** Carregando a lista do `/` (ferramentas ainda não chegaram). */
  readonly loadingTools = computed(() => {
    const t = this.trigger();
    const card = this.card();
    return t?.kind === 'slash' && !!card && this.svc.toolsOf(card, this.cardType()) === null;
  });

  constructor(private svc: CaseComposerService, private card: () => string | null, private cardType: () => 'bug' | 'user-story') {}

  /** Texto/cursor mudaram: recalcula o gatilho (e busca o item pelo número, se não for do card). */
  update(text: string, caret: number): void {
    const t = detectTrigger(text, caret);
    const sig = t ? `${t.kind}:${t.start}` : null;
    if (sig && sig === this.dismissedAt) { this.trigger.set(null); return; }
    this.dismissedAt = null;
    const card = this.card();
    // Antes de ligar o gatilho: as listas precisam existir quando a lista de sugestões for calculada.
    if (t?.kind === 'slash' && card) this.svc.ensureTools(card, this.cardType());
    if (t?.kind === 'hash' && t.scope === 'card' && card) this.svc.ensureItems(card);
    if (t?.kind === 'hash' && t.scope === 'all' && t.command !== 'cancel' && card) this.svc.requestSearch(card, t.query);
    const prev = this.trigger();
    this.trigger.set(t);
    if (!prev || !t || prev.kind !== t.kind || prev.query !== t.query) this.active.set(0);
    if (t?.kind === 'hash' && t.scope === 'card' && card) {
      const items = this.svc.itemsOf(card);
      const n = Number(t.query);
      const known = (items ?? []).some((i) => i.number === n || (i.tasks ?? []).some((x) => x.number === n));
      if (/^\d+$/.test(t.query) && !known) this.svc.requestLookup(n);
    }
  }

  /** Some a lista sem "dispensar" o gatilho (o campo perdeu o foco; volta ao digitar/clicar). */
  hide(): void {
    this.trigger.set(null);
  }

  /** Esc: some e não volta para o mesmo gatilho até a pessoa mudar de lugar. */
  close(): void {
    const t = this.trigger();
    this.dismissedAt = t ? `${t.kind}:${t.start}` : null;
    this.trigger.set(null);
  }

  /**
   * Teclado com a lista aberta: ↑/↓ navegam, Enter/Tab escolhem, Esc fecha. `undefined` = não era com a lista (segue o
   * fluxo normal); `null` = tratado sem ação; ação = aplicar.
   */
  key(event: KeyboardEvent, text: string): ComposerAction | null | undefined {
    if (!this.open() || event.isComposing) return undefined;
    const list = this.suggestions();
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        this.active.set(moveActive(this.active(), event.key === 'ArrowDown' ? 1 : -1, list.length));
        return null;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.close();
        return null;
      case 'Enter':
      case 'Tab': {
        if (event.shiftKey) return undefined;
        const s = list[Math.min(this.active(), list.length - 1)];
        // Linha só informativa: Enter segue o envio normal; Tab não faz nada.
        if (!s || s.kind === 'info') { if (event.key === 'Tab') { event.preventDefault(); return null; } this.close(); return undefined; }
        event.preventDefault();
        return this.pick(s, text);
      }
      default:
        return undefined;
    }
  }

  pick(s: ComposerSuggestion, text: string): ComposerAction | null {
    const t = this.trigger();
    if (!t) return null;
    const action = applySuggestion(text, t, s);
    if (action && action.kind !== 'insert') this.trigger.set(null);
    return action;
  }

  /** Comando na mensagem inteira (ao enviar). */
  command(text: string): ParsedCommand | null {
    const card = this.card();
    if (card) this.svc.ensureTools(card, this.cardType());
    const keys = card ? (this.svc.toolsOf(card, this.cardType()) ?? []).map((t) => t.key) : [];
    return parseCommand(text, keys);
  }
}
