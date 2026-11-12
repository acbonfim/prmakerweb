import { ExecutionRequest } from '../execution-plan/execution-queue.model';

/** 0080: Especialista do caso — espelha `CaseChatResponse` da API (em sincronia com o backend). */
export type CaseAuthorKind = 'person' | 'specialist' | 'system';
export type CaseMessageKind = 'text' | 'voice' | 'proposal' | 'action' | 'system';

export interface CaseFile {
  id: string;
  number: number;
  messageId?: string | null;
  name: string;
  kind: 'image' | 'audio' | 'file';
  contentType: string;
  size: number;
  createdBy: string;
  fromSpecialist: boolean;
  createdAt: string;
}

export interface CaseMessage {
  id: string;
  number: number;
  authorKind: CaseAuthorKind;
  authorUserId?: string | null;
  authorName: string;
  kind: CaseMessageKind;
  text: string;
  transcript?: string | null;
  peopleOnly: boolean;
  deep: boolean;
  mentions: string[];
  steps: string[];
  replyToNumber?: number | null;
  proposalId?: string | null;
  actionId?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  durationMs?: number | null;
  createdAt: string;
  editedAt?: string | null;
  files: CaseFile[];
}

export interface CasePoint {
  id: string;
  text: string;
  status: 'agreed' | 'discussing' | 'dropped';
  messageNumber?: number | null;
  createdBy: string;
  fromSpecialist: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CaseProposalChange {
  kind: 'add' | 'change' | 'remove' | 'decision' | 'keep';
  title: string;
  detail?: string | null;
  fromMessage?: number | null;
}

export interface CaseProposal {
  id: string;
  number: number;
  title: string;
  summary?: string | null;
  phase: 'analysis' | 'correction';
  changes: CaseProposalChange[];
  status: 'pending' | 'accepted' | 'rejected' | 'superseded';
  execute: boolean;
  decidedBy?: string | null;
  decidedAt?: string | null;
  rejectReason?: string | null;
  planNoteNumber?: number | null;
  messageId?: string | null;
  createdAt: string;
}

export interface CaseAction {
  id: string;
  number: number;
  title: string;
  detail?: string | null;
  status: 'pending' | 'confirmed' | 'rejected' | 'done' | 'failed';
  decidedBy?: string | null;
  decidedAt?: string | null;
  result?: string | null;
  doneAt?: string | null;
  messageId?: string | null;
  createdAt: string;
}

export interface CaseParticipant {
  userId?: string | null;
  name: string;
  messages: number;
  lastAt: string;
}

export interface CasePlanNote {
  number: number;
  planPhase: 'analysis' | 'correction';
  stepKey?: string | null;
  text: string;
  authorUserId?: string | null;
  authorName: string;
  fromExecutor: boolean;
  createdAt: string;
  attachments: string[];
}

export interface CaseChat {
  cardNumber: string;
  messages: CaseMessage[];
  hasMore: boolean;
  points: CasePoint[];
  proposals: CaseProposal[];
  actions: CaseAction[];
  files: CaseFile[];
  participants: CaseParticipant[];
  planNotes: CasePlanNote[];
  knows: string[];
  run?: ExecutionRequest | null;
  sessionHost?: string | null;
  /** Acumulado desde que a conversa existe (a entrada soma o cache lido). */
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Consumo desde o último /clear, com a entrada separada (nova, cache lido, cache escrito). */
  usage?: CaseUsage | null;
  /** Última mensagem que o especialista leu (✓✓ nas mensagens para ele). */
  specialistReadNumber?: number;
  /** Até onde cada pessoa viu a conversa (✓✓ de quem escreveu). */
  readers?: CaseReader[];
  canDecide: boolean;
  hasPlan: boolean;
  serverTime: string;
}

export interface CaseUsage {
  since?: string | null;
  responses: number;
  inputTokens: number;
  outputTokens: number;
  freshInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export interface CaseReader {
  userId: string;
  name: string;
  number: number;
  at: string;
}

/**
 * Mensagem na tela: as do servidor e as que ainda estão saindo deste navegador (envio otimista, como no WhatsApp).
 * `key` é estável do rascunho até a mensagem gravada — a bolha não pisca nem anima de novo quando o servidor confirma.
 */
export type CaseViewMessage = CaseMessage & {
  key: string;
  /** Só nas que ainda não chegaram ao servidor. */
  outgoing?: 'sending' | 'failed';
  /** Prévia dos arquivos que estão subindo. */
  localFiles?: { name: string; preview: string | null }[];
};

/** Estado da entrega de uma mensagem minha: ⏱ enviando · ✓ o servidor recebeu · ✓✓ lida (especialista ou outra pessoa). */
export type CaseDelivery = 'sending' | 'failed' | 'sent' | 'read';

/** Sinal de tempo real da conversa (grupo do card `execplan:{card}`). */
export interface CaseChatRealtimePayload {
  cardNumber: string;
  action: 'message' | 'edited' | 'deleted' | 'typing' | 'seen' | 'run' | 'activity' | 'point' | 'proposal' | 'action' | 'cleared';
  number?: number;
  requestId?: string;
  status?: string;
  activity?: { label: string; tool?: string | null; at: string } | null;
  recent?: { label: string; tool?: string | null; at: string }[];
  by?: string;
  userId?: string | null;
  /** `seen` do especialista (leu até `number`). */
  specialist?: boolean;
}

export const CASE_CHAT_EVENT = 'caseChatUpdated';
export const SPECIALIST_NAME = 'Especialista do caso';

/** O especialista está trabalhando (na fila, pego ou rodando). */
export const isRunActive = (r?: ExecutionRequest | null) => !!r && (r.status === 'queued' || r.status === 'claimed' || r.status === 'running');
