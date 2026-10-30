/** Contratos da promoção de PRs em lote (0074) — espelham `PromotionModels.cs` no backend. */

export type PromotionMode = 'cherry-pick' | 'direct';
export type TargetStatus = 'resolved' | 'missing' | 'ambiguous';

export interface PromotionTargetDto {
  branch: string;
  draft: boolean;
  mode?: PromotionMode | null;
}

export interface PromotionCommit {
  sha: string;
  title: string;
}

export interface PromotionPreviewTarget {
  template: string;
  branch: string | null;
  status: TargetStatus;
  candidates: string[];
  draft: boolean;
  mode: PromotionMode;
  alreadyOpen: boolean;
  existingUrl?: string | null;
  note?: string | null;
}

export interface PromotionPreviewRow {
  card: string;
  title: string;
  workItemType?: string | null;
  assignedTo?: string | null;
  state?: string | null;
  repository?: string | null;
  repositoryOptions: string[];
  kind?: string | null;
  profileLabel?: string | null;
  sourceBranch?: string | null;
  sourceFound: boolean;
  sourceBase?: string | null;
  commitCount: number;
  commitsTruncated: boolean;
  commits: PromotionCommit[];
  targets: PromotionPreviewTarget[];
  errors: string[];
  warnings: string[];
}

export interface PromotionProfile {
  kind: string;
  label: string;
  targets: PromotionTargetDto[];
}

export interface PromotionPreview {
  version: string;
  executorOnline: boolean;
  profiles: PromotionProfile[];
  rows: PromotionPreviewRow[];
}

export interface PromotionPreviewRequest {
  version: string;
  kind?: string | null;
  cards: { card: string; repository?: string | null }[];
  profiles?: Record<string, PromotionTargetDto[]> | null;
}

export interface PromotionCreateItem {
  card: string;
  title: string;
  repository: string;
  sourceBranch: string;
  sourceBase?: string | null;
  targets: PromotionTargetDto[];
}

export type ItemStatus =
  | 'queued' | 'running' | 'opened' | 'already_open' | 'conflict' | 'missing_target' | 'no_changes' | 'error' | 'cancelled';

export interface PromotionItem {
  id: string;
  position: number;
  card: string;
  title: string;
  repository: string;
  sourceBranch: string;
  sourceBase?: string | null;
  target: string;
  draft: boolean;
  mode: PromotionMode;
  status: ItemStatus;
  message?: string | null;
  newBranch?: string | null;
  conflictFiles: string[];
  commitCount: number;
  pullRequestNumber?: number | null;
  pullRequestUrl?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface PromotionSummary {
  total: number;
  queued: number;
  running: number;
  opened: number;
  alreadyOpen: number;
  conflict: number;
  missingTarget: number;
  noChanges: number;
  error: number;
  cancelled: number;
}

export interface PromotionBatch {
  id: string;
  version: string;
  kind?: string | null;
  ownerUserId: string;
  ownerName: string;
  createdAt: string;
  finishedAt?: string | null;
  active: boolean;
  summary: PromotionSummary;
  items: PromotionItem[];
}

export interface PromotionParsedCard {
  card: string;
  workItemType: string;
  title: string;
  assignedTo?: string | null;
}

export interface PromotionParsedRule {
  ticketType: string;
  kind?: string | null;
  targets: PromotionTargetDto[];
  source: 'ai' | 'text';
}

export interface PromotionParse {
  version?: string | null;
  kind?: string | null;
  cards: PromotionParsedCard[];
  rules: PromotionParsedRule[];
  profiles: Record<string, PromotionTargetDto[]>;
  warnings: string[];
  aiUsed: boolean;
  provider?: string | null;
  model?: string | null;
}

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  queued: 'Na fila',
  running: 'Em andamento',
  opened: 'PR aberto',
  already_open: 'Já existia',
  conflict: 'Conflito',
  missing_target: 'Destino inexistente',
  no_changes: 'Sem mudanças',
  error: 'Erro',
  cancelled: 'Cancelado'
};

/** Situações que ainda vão mudar sozinhas. */
export const isItemActive = (s: ItemStatus) => s === 'queued' || s === 'running';
/** Itens com PR do card para o destino. */
export const itemHasPr = (i: PromotionItem) => (i.status === 'opened' || i.status === 'already_open') && !!i.pullRequestUrl;
/** O que o usuário pode reenviar. */
export const isItemRetryable = (s: ItemStatus) => s === 'conflict' || s === 'missing_target' || s === 'error' || s === 'cancelled';
