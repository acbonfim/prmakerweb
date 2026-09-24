import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface UserIntegrationField {
  key: string;
  /** Valor do usuário (ou sugestão do admin, ver suggested). Sempre null para campo sensível. */
  value: string | null;
  hasValue: boolean;
  sensitive: boolean;
  suggested: boolean;
}

export interface UserIntegration {
  pluginId: number;
  description: string;
  configured: boolean;
  fields: UserIntegrationField[];
  updatedAt: string | null;
}

export interface UserIntegrationStatus {
  ready: boolean;
  pending: { pluginId: number; description: string }[];
}

/**
 * "Minhas integrações" (feature 0002): plugins de uso pessoal que cada usuário configura com os
 * próprios valores (ex.: token do GitHub/Azure DevOps). O status é compartilhado pela aplicação
 * (menu do usuário, bloqueio da tela de PR).
 */
@Injectable({ providedIn: 'root' })
export class UserIntegrationService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}UserIntegration`;

  readonly integrations = signal<UserIntegration[]>([]);
  readonly status = signal<UserIntegrationStatus | null>(null);
  readonly loading = signal(false);

  /** true enquanto houver plugin de uso pessoal sem configuração (ou status ainda desconhecido = false). */
  readonly hasPending = computed(() => (this.status()?.pending.length ?? 0) > 0);

  async loadStatus(): Promise<UserIntegrationStatus | null> {
    try {
      const status = await firstValueFrom(this.http.get<UserIntegrationStatus>(`${this.baseUrl}/status`));
      this.status.set(status);
      return status;
    } catch (e) {
      console.error('Falha ao carregar o status das integrações pessoais', e);
      return this.status();
    }
  }

  async loadIntegrations(): Promise<UserIntegration[]> {
    this.loading.set(true);
    try {
      const list = await firstValueFrom(this.http.get<UserIntegration[]>(this.baseUrl));
      this.integrations.set(list ?? []);
      this.updateStatusFrom(list ?? []);
      return list ?? [];
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Salva os valores de um plugin. Segredo omitido (ou null) mantém o valor salvo; "" limpa.
   */
  async save(pluginId: number, values: Record<string, string | null>): Promise<UserIntegration> {
    const saved = await firstValueFrom(this.http.put<UserIntegration>(`${this.baseUrl}/${pluginId}`, { values }));
    const list = this.integrations().map(i => (i.pluginId === saved.pluginId ? saved : i));
    this.integrations.set(list);
    this.updateStatusFrom(list);
    return saved;
  }

  private updateStatusFrom(list: UserIntegration[]): void {
    const pending = list.filter(i => !i.configured).map(i => ({ pluginId: i.pluginId, description: i.description }));
    this.status.set({ ready: pending.length === 0, pending });
  }
}
