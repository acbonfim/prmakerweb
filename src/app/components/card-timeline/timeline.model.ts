export interface TimelineEntry {
  id: number;
  cardNumber: string;
  description: string;
  userId?: string | null;
  userName: string;
  createdAt: string;
  updatedAt?: string | null;
}

export interface CreateTimelineEntry {
  cardNumber: string;
  description: string;
  /** Obrigatório apenas para registros externos (sem usuário logado). */
  userName?: string;
}

export interface UpdateTimelineEntry {
  description: string;
}
