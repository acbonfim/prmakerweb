import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

/** Valores efetivos do usuário para o menu "Ações DevOps" (plugin AI Configurations — feature 0011). */
export interface DevOpsActionsConfig {
  available: boolean;
  bug: {
    summaryPrompt: string | null;
    testInProduction: { requiredArea: string | null; area: string | null; state: string | null; comment: string | null };
    readyForQa: { state: string | null };
    initialEstimate: {
      configured: boolean;
      originalEstimate: number | null;
      remainingWork: number | null;
      completedWork: number | null;
    };
  };
}

export interface DevOpsActionResult {
  rev: number;
  message: string;
}

/** Ações que alteram o card no DevOps (rotas `Azure/card/{id}/actions/*`). */
export type DevOpsCardAction = 'test-in-production' | 'ready-for-qa' | 'initial-estimate' | 'zero-remaining';

/**
 * Menu "Ações DevOps" da tela do card (feature 0011). O backend revalida as regras com o card relido
 * do DevOps: 409 = regra não atendida, 404 = card não encontrado, 502 = o DevOps recusou —
 * sempre com `{ error }` legível.
 */
@Injectable({ providedIn: 'root' })
export class DevOpsActionsService {
  private http = inject(HttpClient);
  private baseUrl = environment.apiUrl;

  getConfig(): Promise<DevOpsActionsConfig> {
    return firstValueFrom(this.http.get<DevOpsActionsConfig>(`${this.baseUrl}Azure/actions/config`));
  }

  run(cardNumber: string, action: DevOpsCardAction): Promise<DevOpsActionResult> {
    return firstValueFrom(this.http.post<DevOpsActionResult>(
      `${this.baseUrl}Azure/card/${encodeURIComponent(cardNumber)}/actions/${action}`, {}));
  }

  /** Publica o resumo na discussion (cria ou atualiza o mesmo comentário) e grava no card. */
  saveSummary(cardNumber: string, summary: string, html: string): Promise<any> {
    return firstValueFrom(this.http.post<any>(
      `${this.baseUrl}PullRequest/${encodeURIComponent(cardNumber)}/summary`, { summary, html }));
  }

  /** Gera texto com a IA configurada (mesmo endpoint da descrição/handover). */
  async generate(prompt: string): Promise<string> {
    const res: any = await firstValueFrom(this.http.post(`${this.baseUrl}AI/generate`, JSON.stringify(prompt), {
      headers: { 'Content-Type': 'application/json' },
    }));
    let content = res?.content || res?.text || res;
    if (typeof content === 'object' && content?.content) content = content.content;
    return (content ?? '').toString()
      .replace(/^\s*```(?:markdown|md)?\s*\n/i, '')
      .replace(/\n\s*```\s*$/, '')
      .trim();
  }
}

/** Mesma regra do resto da tela (dialog-prompt): só "User Story" é US; o resto é tratado como Bug. */
export function isUserStoryCard(card: { fields?: Record<string, any> } | null | undefined): boolean {
  return card?.fields?.['System.WorkItemType'] === 'User Story';
}

/** Mensagem de erro do backend (`{ error }`) ou um texto padrão. */
export function apiErrorMessage(e: any, fallback: string): string {
  return e?.error?.error || (typeof e?.error === 'string' ? e.error : null) || fallback;
}
