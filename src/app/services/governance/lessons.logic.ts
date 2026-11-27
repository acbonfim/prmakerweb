/** 0106: lição aprendida (o que o agente não deve repetir) e sinal de erro que o PRMake registrou sozinho. */
export interface LessonSource {
  card?: string | null;
  ref?: string | null;
  at?: string | null;
  by?: string | null;
}

export interface Lesson {
  id: number;
  code: string;
  scope: string[];
  trigger: string;
  text: string;
  why: string;
  sources: LessonSource[];
  status: 'active' | 'retired';
  origin: 'agent' | 'signal' | 'seed' | 'admin';
  hits: number;
  createdAt: string;
  createdBy: string;
  lastSeenAt: string;
  updatedAt?: string | null;
  updatedBy?: string | null;
  retiredReason?: string | null;
}

export interface LessonData {
  scope: string[];
  trigger: string;
  text: string;
  why: string;
}

export interface LessonSignal {
  id: number;
  code: string;
  card: string;
  kind: string;
  text: string;
  ref?: string | null;
  status: 'open' | 'learned' | 'dismissed';
  lessonId?: number | null;
  resolution?: string | null;
  createdAt: string;
}

export type LessonStatusFilter = 'active' | 'retired' | 'all';

export const ORIGIN_LABEL: Record<Lesson['origin'], string> = {
  agent: 'gravada pelo agente',
  signal: 'de um sinal de erro',
  seed: 'semeada (card 79047)',
  admin: 'escrita na tela',
};

export const SIGNAL_LABEL: Record<string, string> = {
  'item-cancelled': 'Item cancelado logo depois',
  'task-redo': 'Entrega refeita',
  'item-redo': 'Item reaberto para refazer',
  'pr-changes-requested': 'Pedido de mudanças no PR',
  other: 'Outro',
};

/** Escopo legível: vazio = todas as skills. */
export function scopeText(scope: string[] | null | undefined): string {
  return scope && scope.length ? scope.join(', ') : 'todas as skills';
}

/** "a, b , c" → ["a","b","c"] (minúsculas, sem repetição; "todas"/"all" = vazio). */
export function parseScope(text: string): string[] {
  const parts = (text ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => s && s !== 'all' && s !== 'todas');
  return [...new Set(parts)];
}

/** Filtra por busca (código, situação, lição, por quê, card de origem) e escopo, mais reincidentes primeiro. */
export function filterLessons(list: Lesson[], search: string, skill: string | null): Lesson[] {
  const q = fold(search.trim());
  return list
    .filter((l) => !skill || !l.scope.length || l.scope.includes(skill))
    .filter((l) => !q || fold(`${l.code} ${l.trigger} ${l.text} ${l.why} ${l.sources.map((s) => s.card ?? '').join(' ')}`).includes(q))
    .sort((a, b) => b.hits - a.hits || (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''));
}

/** Skills citadas nos escopos (para o filtro). */
export function skillsOf(list: Lesson[]): string[] {
  return [...new Set(list.flatMap((l) => l.scope))].sort();
}

/** Cards de origem (sem repetir, os mais recentes primeiro). */
export function sourceCards(l: Lesson): string[] {
  return [...new Set([...l.sources].reverse().map((s) => s.card).filter((c): c is string => !!c))];
}

export function validateLesson(d: LessonData): string | null {
  if (!d.trigger?.trim()) return 'Diga quando a lição vale (a situação).';
  if (!d.text?.trim()) return 'Escreva a lição (o que fazer ou nunca fazer).';
  if (d.trigger.length > 300) return 'A situação passa de 300 caracteres.';
  if (d.text.length > 600) return 'A lição passa de 600 caracteres.';
  return null;
}

function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
