import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface TeamsStatus {
  /** O plugin "Teams Configurations" existe. */
  available: boolean;
  /** O usuário salvou a URL do Workflow em Minhas integrações. */
  configured: boolean;
  pluginId: number | null;
  groupName: string;
}

export interface TeamsApprovalResult {
  sent: boolean;
  groupName: string;
}

/** Nome do plugin pessoal (e opcional) criado pela migração da feature 0007. */
export const TEAMS_PLUGIN_NAME = 'Teams Configurations';

/**
 * Pedido de aprovação de PR no Teams (feature 0007): o backend posta um cartão no grupo pelo
 * Workflow que cada usuário configura em Minhas integrações. O status é compartilhado pela tela
 * (botão habilitado só depois de configurar — regra 5).
 */
@Injectable({ providedIn: 'root' })
export class TeamsService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}Teams`;

  readonly status = signal<TeamsStatus | null>(null);
  readonly ready = computed(() => !!this.status()?.available && !!this.status()?.configured);

  async loadStatus(): Promise<TeamsStatus | null> {
    try {
      const status = await firstValueFrom(this.http.get<TeamsStatus>(`${this.baseUrl}/status`));
      this.status.set(status);
      return status;
    } catch (e) {
      // Best-effort: sem status o botão só fica desabilitado.
      console.error('Falha ao carregar o status da integração com o Teams', e);
      return null;
    }
  }

  requestApproval(cardNumber: string, pullRequestGithubId: number) {
    return this.http.post<TeamsApprovalResult>(`${this.baseUrl}/approval`, { cardNumber, pullRequestGithubId });
  }
}
