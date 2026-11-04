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
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  canDecide: boolean;
  hasPlan: boolean;
  serverTime: string;
}

/** Sinal de tempo real da conversa (grupo do card `execplan:{card}`). */
export interface CaseChatRealtimePayload {
  cardNumber: string;
  action: 'message' | 'edited' | 'deleted' | 'typing' | 'run' | 'activity' | 'point' | 'proposal' | 'action';
  number?: number;
  requestId?: string;
  status?: string;
  activity?: { label: string; tool?: string | null; at: string } | null;
  recent?: { label: string; tool?: string | null; at: string }[];
  by?: string;
  userId?: string | null;
}

export const CASE_CHAT_EVENT = 'caseChatUpdated';
export const SPECIALIST_NAME = 'Especialista do caso';

/** O especialista está trabalhando (na fila, pego ou rodando). */
export const isRunActive = (r?: ExecutionRequest | null) => !!r && (r.status === 'queued' || r.status === 'claimed' || r.status === 'running');
