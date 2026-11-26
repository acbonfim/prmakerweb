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

/** Sugestão em botão: `short` é o rótulo no modo compacto (painel estreito); `text` vai como mensagem. */
export interface CaseSuggestion {
  icon: string;
  label: string;
  short?: string;
  text: string;
}

/** Conversa vazia de um card: perguntas para começar (conversa grande e compacta). */
export const CASE_STARTERS: CaseSuggestion[] = [
  { icon: 'flag', label: 'Em que pé está este card?', short: 'Em que pé está?', text: 'Em que pé está este card? O que falta para fechar?' },
  { icon: 'history', label: 'O que deu errado na última versão?', short: 'O que deu errado?', text: 'O que deu errado na última versão do plano e o que você mudaria?' },
  { icon: 'lightbulb', label: 'Explique a causa raiz', text: 'Me explique a causa raiz como se eu não fosse desenvolvedor.' },
  { icon: 'arrow_forward', label: 'Qual o próximo passo?', short: 'Próximo passo', text: 'Qual é o próximo passo deste card e quem precisa agir agora?' },
  { icon: 'fact_check', label: 'Como eu valido a correção?', short: 'Como validar?', text: 'Como eu valido esta correção? Monte o passo a passo do teste: onde, com que dados e o que esperar.' },
  { icon: 'warning_amber', label: 'Quais os riscos da correção?', short: 'Riscos', text: 'Quais os riscos desta correção e o que mais pode ser afetado (telas, regras, clientes)?' },
  { icon: 'person', label: 'Resuma o pedido do cliente', short: 'Pedido do cliente', text: 'Resuma o pedido do cliente em poucas linhas: o que pediu, por quê e o que muda para ele.' }
];

/** Conversa vazia de um épico (Mesa de gestão). */
export const EPIC_STARTERS: CaseSuggestion[] = [
  { icon: 'summarize', label: 'Resumo do épico', text: 'Resuma a situação dos cards deste épico: o que está parado, o que avançou e o que precisa de atenção.' },
  { icon: 'content_copy', label: 'Achar duplicados', text: 'Procure cards duplicados entre os bugs abertos do board deste épico.' },
  { icon: 'picture_as_pdf', label: 'Relatório de bugs', text: 'Monte um relatório dos bugs abertos (por estado, área e responsável) e gere o PDF.' },
  { icon: 'hourglass_bottom', label: 'Cards parados', text: 'Quais cards deste épico estão parados há mais tempo, por quê e quem precisa agir?' },
  { icon: 'low_priority', label: 'Prioridades da semana', short: 'Prioridades', text: 'O que devo priorizar neste épico esta semana? Ordene os cards com o motivo de cada um.' }
];

/** Atalhos sobre o compositor (com a conversa em andamento): preenchem junto do texto digitado ou mandam direto. */
export const CASE_QUICK: CaseSuggestion[] = [
  { icon: 'summarize', label: 'Resumir a conversa', short: 'Resumir', text: 'Resuma a conversa até aqui: o que já combinamos e o que falta decidir.' },
  { icon: 'arrow_forward', label: 'Próximo passo', text: 'Qual é o próximo passo deste card e quem precisa agir agora?' },
  { icon: 'auto_awesome', label: 'Gerar nova versão do plano', short: 'Nova versão do plano', text: 'Pode gerar a nova versão do plano com o que combinamos?' },
  { icon: 'code', label: 'Mostrar o código', short: 'Código', text: 'Mostre o trecho de código envolvido (com caminho:linha e a branch).' },
  { icon: 'storage', label: 'Consultar o banco (só leitura)', short: 'Banco', text: 'Consulte no banco (só leitura) e me mostre os valores que importam aqui.' },
  { icon: 'fact_check', label: 'Roteiro de teste', short: 'Teste', text: 'Monte o roteiro de teste desta correção: onde, com que dados e o resultado esperado.' },
  { icon: 'image', label: 'Gerar imagem / mock', short: 'Mock', text: 'Gere um Antes × Depois (mock) do que muda para a pessoa usuária.' },
  { icon: 'note_add', label: 'Gerar arquivo', short: 'Arquivo', text: 'Gere o arquivo (script ou texto do chamado) para eu revisar.' }
];

/** Atalhos da conversa de um épico (sem plano: gestão dos cards). */
export const EPIC_QUICK: CaseSuggestion[] = [
  { icon: 'summarize', label: 'Resumir a conversa', short: 'Resumir', text: 'Resuma a conversa até aqui: o que já combinamos e o que falta decidir.' },
  { icon: 'dashboard', label: 'Resumo do épico', short: 'Resumo do épico', text: 'Resuma a situação dos cards deste épico: o que está parado, o que avançou e o que precisa de atenção.' },
  { icon: 'hourglass_bottom', label: 'Cards parados', short: 'Parados', text: 'Quais cards deste épico estão parados há mais tempo, por quê e quem precisa agir?' },
  { icon: 'content_copy', label: 'Achar duplicados', short: 'Duplicados', text: 'Procure cards duplicados entre os bugs abertos do board deste épico.' },
  { icon: 'picture_as_pdf', label: 'Relatório em PDF', short: 'Relatório', text: 'Monte um relatório dos bugs abertos (por estado, área e responsável) e gere o PDF.' }
];
