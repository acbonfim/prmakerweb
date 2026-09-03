import { Injectable } from '@angular/core';
import {
  PublicClientApplication,
  InteractionRequiredAuthError,
  AccountInfo
} from '@azure/msal-browser';
import { environment } from '../../environments/environment';

export interface TeamsChat {
  id: string;
  topic: string | null;
  chatType: string;
}

export interface TeamsMessage {
  id: string;
  messageType: string;
  createdDateTime: string;
  deletedDateTime: string | null;
  fromDisplayName: string | null;
  text: string; // já convertido de HTML para texto
}

/**
 * Autenticação do próprio usuário no Teams (MSAL, Authorization Code + PKCE) e leitura das
 * mensagens direto do Microsoft Graph pelo navegador. Nenhum segredo trafega pelo backend:
 * o front lê as mensagens e as envia ao endpoint de ingestão.
 *
 * Fica inerte enquanto environment.teamsGraph.clientId estiver vazio (aguardando o app SPA
 * registrado e o consentimento do admin para o escopo Chat.Read).
 */
@Injectable({ providedIn: 'root' })
export class TeamsGraphService {
  private static readonly Scopes = ['Chat.Read'];
  private static readonly GraphBase = 'https://graph.microsoft.com/v1.0';

  private pca: PublicClientApplication | null = null;
  private initPromise: Promise<void> | null = null;

  get isConfigured(): boolean {
    return !!environment.teamsGraph?.clientId;
  }

  private getPca(): PublicClientApplication {
    if (!this.isConfigured) {
      throw new Error('Integração com o Teams não configurada (clientId ausente).');
    }
    if (!this.pca) {
      const cfg = environment.teamsGraph;
      this.pca = new PublicClientApplication({
        auth: {
          clientId: cfg.clientId,
          authority: `https://login.microsoftonline.com/${cfg.tenantId || 'common'}`,
          redirectUri: cfg.redirectUri || window.location.origin
        },
        cache: { cacheLocation: 'sessionStorage' }
      });
    }
    return this.pca;
  }

  private async ensureReady(): Promise<PublicClientApplication> {
    const pca = this.getPca();
    if (!this.initPromise) {
      this.initPromise = pca.initialize();
    }
    await this.initPromise;
    return pca;
  }

  /** Faz o login interativo do usuário no Teams. Retorna o nome da conta conectada. */
  async login(): Promise<string> {
    const pca = await this.ensureReady();
    const result = await pca.loginPopup({ scopes: TeamsGraphService.Scopes });
    if (result.account) {
      pca.setActiveAccount(result.account);
    }
    return result.account?.name ?? result.account?.username ?? 'Conta Teams';
  }

  private getAccount(): AccountInfo | null {
    const pca = this.pca;
    if (!pca) return null;
    return pca.getActiveAccount() ?? pca.getAllAccounts()[0] ?? null;
  }

  private async getToken(): Promise<string> {
    const pca = await this.ensureReady();
    const account = this.getAccount();

    try {
      const result = await pca.acquireTokenSilent({ scopes: TeamsGraphService.Scopes, account: account ?? undefined });
      return result.accessToken;
    } catch (err) {
      if (err instanceof InteractionRequiredAuthError) {
        const result = await pca.acquireTokenPopup({ scopes: TeamsGraphService.Scopes });
        return result.accessToken;
      }
      throw err;
    }
  }

  private async graphGet(url: string): Promise<any> {
    const token = await this.getToken();
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Graph ${response.status}: ${detail}`);
    }
    return response.json();
  }

  /** Lista os chats/grupos aos quais o usuário logado tem acesso. */
  async listChats(): Promise<TeamsChat[]> {
    const chats: TeamsChat[] = [];
    let url: string | null =
      `${TeamsGraphService.GraphBase}/me/chats?$select=id,topic,chatType,lastUpdatedDateTime&$top=50`;

    while (url) {
      const page: any = await this.graphGet(url);
      for (const c of page.value ?? []) {
        chats.push({ id: c.id, topic: c.topic ?? null, chatType: c.chatType ?? '' });
      }
      url = page['@odata.nextLink'] ?? null;
    }

    return chats;
  }

  /** Lê todas as mensagens de um chat/grupo, já com o corpo convertido para texto. */
  async listMessages(chatId: string): Promise<TeamsMessage[]> {
    const messages: TeamsMessage[] = [];
    let url: string | null =
      `${TeamsGraphService.GraphBase}/chats/${encodeURIComponent(chatId)}/messages?$top=50`;

    while (url) {
      const page: any = await this.graphGet(url);
      for (const m of page.value ?? []) {
        messages.push({
          id: m.id,
          messageType: m.messageType ?? '',
          createdDateTime: m.createdDateTime,
          deletedDateTime: m.deletedDateTime ?? null,
          fromDisplayName: m.from?.user?.displayName ?? null,
          text: this.htmlToText(m.body?.content ?? '')
        });
      }
      url = page['@odata.nextLink'] ?? null;
    }

    return messages;
  }

  private htmlToText(html: string): string {
    if (!html) return '';
    const div = document.createElement('div');
    div.innerHTML = html;
    return (div.textContent ?? '').replace(/\s+/g, ' ').trim();
  }
}
