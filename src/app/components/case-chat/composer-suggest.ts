import { fold } from '../specialist-tools/specialist-tools.logic';

/**
 * 0090 — lógica pura do compositor do Especialista (sem Angular, testada em composer-suggest.spec.ts):
 * - `/` no começo da mensagem → comandos do compositor (`/clear`, `/cancelar-item-de-trabalho`) e as ferramentas do
 *   especialista que se aplicam ao card (nome + o que faz);
 * - `#` + número (ou palavra) no cursor → itens de trabalho (os do card; número de fora busca o item direto);
 * - ao enviar, `parseCommand` reconhece o comando digitado inteiro.
 */

/** O que está sendo digitado no cursor e abre a lista. `start..end` = o trecho que a escolha substitui. */
export type ComposerTrigger =
  | { kind: 'slash'; query: string; start: number; end: number }
  | { kind: 'hash'; query: string; start: number; end: number; command: 'cancel' | null };

export const CANCEL_COMMAND = 'cancelar-item-de-trabalho';

export interface ComposerCommand {
  key: 'clear' | typeof CANCEL_COMMAND;
  label: string;
  detail: string;
  icon: string;
}

export const COMPOSER_COMMANDS: readonly ComposerCommand[] = [
  { key: 'clear', label: '/clear', icon: 'delete_sweep', detail: 'Limpa toda a conversa (para todos) — o especialista recomeça do zero. O plano e os itens não mudam.' },
  { key: CANCEL_COMMAND, label: `/${CANCEL_COMMAND} #nº`, icon: 'stop_circle', detail: 'Cancela um item de trabalho deste card e desfaz o que ele já fez, se precisar.' }
];

/** Ferramenta como a lista do `/` mostra (vem das ToolView aplicáveis). */
export interface ComposerTool {
  key: string;
  title: string;
  description: string;
  icon: string;
  color?: string | null;
}

/** Item de trabalho como a lista do `#` precisa. */
export interface ComposerItem {
  number: number;
  title: string;
  status: string;
  cardNumber: string;
  /** Tem sub-tarefa concluída (o cancelar oferece desfazer). */
  done?: boolean;
}

export interface ComposerSuggestion {
  id: string;
  kind: 'command' | 'tool' | 'item' | 'info';
  icon: string;
  label: string;
  detail: string;
  color?: string | null;
  command?: ComposerCommand['key'];
  tool?: string;
  /** Nome da ferramenta (ao lado da chave). */
  title?: string;
  number?: number;
  /** Estado do item (selo). */
  status?: string;
  /** Item de outro card (só informativo). */
  otherCard?: string | null;
}

/** O que a escolha faz no compositor. */
export type ComposerAction =
  | { kind: 'insert'; text: string; caret: number }
  | { kind: 'clear' }
  | { kind: 'tool'; key: string };

/** Comando reconhecido na mensagem inteira (ao enviar). */
export type ParsedCommand =
  | { kind: 'clear' }
  | { kind: 'cancel'; number: number | null; reason: string | null }
  | { kind: 'tool'; key: string }
  | { kind: 'unknown'; name: string };

const SLASH_AT_START = /^\/([\p{L}\p{N}_-]*)$/u;
const HASH_AT_CARET = /(^|[\s(\[,;:])#([\p{L}\p{N}_-]*)$/u;
const CANCEL_PREFIX = new RegExp(`^\\/${CANCEL_COMMAND}(?=\\s|$)`, 'iu');
const MAX_TOOLS = 30;
const MAX_ITEMS = 8;

/** Gatilho no cursor: `/` só no começo da mensagem (sem espaço ainda); `#` no começo de uma palavra. */
export function detectTrigger(text: string, caret: number): ComposerTrigger | null {
  const before = (text ?? '').slice(0, Math.max(0, Math.min(caret, (text ?? '').length)));
  const slash = SLASH_AT_START.exec(before);
  if (slash) return { kind: 'slash', query: slash[1], start: 0, end: before.length };
  const hash = HASH_AT_CARET.exec(before);
  if (hash) {
    const start = before.length - hash[2].length - 1;
    return { kind: 'hash', query: hash[2], start, end: before.length, command: CANCEL_PREFIX.test(text) ? 'cancel' : null };
  }
  return null;
}

/** Lista do `/`: comandos primeiro, depois as ferramentas (chave ou título contendo o que foi digitado). */
export function slashSuggestions(query: string, tools: readonly ComposerTool[]): ComposerSuggestion[] {
  const q = fold(query);
  const commands = COMPOSER_COMMANDS
    .filter((c) => !q || fold(c.key).includes(q) || fold(c.label).includes(q))
    .map<ComposerSuggestion>((c) => ({ id: `cmd:${c.key}`, kind: 'command', icon: c.icon, label: c.label, detail: c.detail, command: c.key }));
  const scored = tools
    .map((t) => ({ t, score: toolScore(t, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.t.title.localeCompare(b.t.title))
    .slice(0, MAX_TOOLS)
    .map<ComposerSuggestion>(({ t }) => ({ id: `tool:${t.key}`, kind: 'tool', icon: t.icon, label: `/${t.key}`, detail: t.description || t.title,
      color: t.color ?? null, tool: t.key, title: t.title }));
  return [...commands, ...scored];
}

function toolScore(t: ComposerTool, q: string): number {
  if (!q) return 1;
  const key = fold(t.key);
  const title = fold(t.title);
  if (key.startsWith(q)) return 4;
  if (title.startsWith(q)) return 3;
  if (key.includes(q) || title.includes(q)) return 2;
  return fold(t.description).includes(q) ? 1 : 0;
}

/**
 * Lista do `#`: itens do card cujo número começa com o digitado (ou cujo título contém a palavra), mais recentes
 * primeiro. `lookup` = o item buscado direto pelo número (quando não é do card; `'loading'` enquanto busca, `null` = não
 * existe). No `/cancelar-item-de-trabalho` só entram itens do card que dá para cancelar ou desfazer.
 */
export function hashSuggestions(trigger: Extract<ComposerTrigger, { kind: 'hash' }>, card: string, items: readonly ComposerItem[] | null,
  lookup?: ComposerItem | 'loading' | null): ComposerSuggestion[] {
  const q = fold(trigger.query);
  const digits = /^\d+$/.test(q);
  const cancel = trigger.command === 'cancel';
  const pool = (items ?? []).filter((i) => !cancel || isCancelable(i));
  const hits = pool
    .filter((i) => !q || (digits ? `${i.number}`.startsWith(q) : fold(i.title).includes(q)))
    .sort((a, b) => b.number - a.number)
    .slice(0, MAX_ITEMS)
    .map((i) => itemSuggestion(i, card));
  if (digits && !hits.some((h) => `${h.number}` === `${Number(q)}`)) {
    // Com itens do card batendo pelo começo do número, "buscando"/"não existe" do número exato só atrapalham.
    const quiet = hits.length > 0;
    if (lookup === 'loading') {
      if (!quiet) hits.push({ id: `info:${q}`, kind: 'info', icon: 'hourglass_top', label: `#${Number(q)}`, detail: 'Buscando o item…' });
    } else if (lookup && lookup.number === Number(q)) {
      const other = `${lookup.cardNumber}`.trim() !== `${card}`.trim();
      if (!cancel || (!other && isCancelable(lookup))) hits.push(itemSuggestion(lookup, card));
      else hits.push({ id: `info:${q}`, kind: 'info', icon: 'block', label: `#${lookup.number}`,
        detail: other ? `É do card ${lookup.cardNumber} — cancele pela conversa daquele card.` : 'Este item não tem o que cancelar nem desfazer.' });
    } else if (lookup === null && items !== null && !quiet) {
      hits.push({ id: `info:${q}`, kind: 'info', icon: 'search_off', label: `#${Number(q)}`, detail: 'Nenhum item de trabalho com este número.' });
    }
  }
  if (!hits.length && items === null) hits.push({ id: 'info:loading', kind: 'info', icon: 'hourglass_top', label: '#', detail: 'Carregando os itens do card…' });
  if (!hits.length && cancel) hits.push({ id: 'info:none', kind: 'info', icon: 'info', label: '#', detail: 'Nenhum item deste card para cancelar ou desfazer.' });
  return hits;
}

function itemSuggestion(i: ComposerItem, card: string): ComposerSuggestion {
  const other = `${i.cardNumber}`.trim() !== `${card}`.trim();
  return { id: `item:${i.number}`, kind: 'item', icon: 'task_alt', label: `#${i.number}`, detail: i.title || '(sem título)', number: i.number,
    status: i.status, otherCard: other ? i.cardNumber : null };
}

/** Dá para cancelar (ainda aberto) ou desfazer (concluído/cancelado com algo feito). */
export function isCancelable(i: Pick<ComposerItem, 'status' | 'done'>): boolean {
  if (i.status === 'reverting' || i.status === 'reverted') return false;
  if (i.status === 'completed' || i.status === 'cancelled') return !!i.done;
  return true;
}

/** Aplica a escolha: troca o trecho do gatilho e devolve o novo texto + cursor (ou a ação do comando/ferramenta). */
export function applySuggestion(text: string, trigger: ComposerTrigger, s: ComposerSuggestion): ComposerAction | null {
  if (s.kind === 'info') return null;
  if (s.kind === 'tool' && s.tool) return { kind: 'tool', key: s.tool };
  if (s.kind === 'command' && s.command === 'clear') return { kind: 'clear' };
  const before = text.slice(0, trigger.start) + (s.kind === 'command' ? `/${CANCEL_COMMAND} #` : `#${s.number} `);
  const after = text.slice(trigger.end).replace(/^\s+/, '');
  // `/cancelar… #` termina no `#` (a lista dos itens abre em seguida); o resto da mensagem, se houver, vem depois de um espaço.
  return { kind: 'insert', text: s.kind === 'command' && after ? `${before} ${after}` : before + after, caret: before.length };
}

/**
 * Comando na mensagem inteira (ao enviar): `/clear`, `/cancelar-item-de-trabalho #12 motivo opcional`, `/<ferramenta>`.
 * Texto que só começa com barra (ex.: um caminho `/etc/hosts está errado`) não é comando: segue como mensagem.
 */
export function parseCommand(text: string, toolKeys: readonly string[] = []): ParsedCommand | null {
  const t = (text ?? '').trim();
  if (!t.startsWith('/')) return null;
  if (/^\/clear$/i.test(t)) return { kind: 'clear' };
  if (CANCEL_PREFIX.test(t)) {
    const m = new RegExp(`^\\/${CANCEL_COMMAND}\\s*#?(\\d{1,7})?\\s*([\\s\\S]*)$`, 'iu').exec(t);
    const n = m?.[1] ? Number(m[1]) : null;
    const reason = (m?.[2] ?? '').trim();
    return { kind: 'cancel', number: n && n > 0 ? n : null, reason: reason || null };
  }
  const one = /^\/([\p{L}\p{N}_-]+)$/u.exec(t);
  if (!one) return null;
  const key = toolKeys.find((k) => k.toLowerCase() === one[1].toLowerCase());
  return key ? { kind: 'tool', key } : { kind: 'unknown', name: one[1] };
}

/** Próximo índice ativo da lista (↑/↓ dão a volta). */
export function moveActive(current: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return (((current + delta) % length) + length) % length;
}
