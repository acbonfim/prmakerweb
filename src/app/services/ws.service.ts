import { Injectable, EventEmitter, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import * as signalR from '@microsoft/signalr';
import { BehaviorSubject, Observable, firstValueFrom, map, switchMap, takeWhile, timer } from 'rxjs';
import { environment } from '../../environments/environment';
import { StorageService } from './storage.service';

/** Resposta de `GET RealTime/connection` (feature 0013). */
interface RealTimeConnectionInfo {
  /** URL do hub (relay); nula => usar `environment.urlWs`. */
  url: string | null;
  /** Token de curta duração; nulo => a API não emite token (usa a chave legada). */
  accessToken: string | null;
  expiresAt: string | null;
}

/**
 * Serviço genérico de tempo real (SignalR).
 *
 * Espelha o hub RealTimeHub do backend: `AddToGroup`/`RemoveFromGroup` para inscrição em
 * canais e handlers arbitrários via `on()`/`off()`. Para adicionar um novo ponto de tempo
 * real, basta entrar em um grupo e registrar um handler — nenhuma mudança aqui é necessária.
 *
 * Conexão (features 0013/0016): a URL do hub e um token de curta duração vêm de
 * `GET RealTime/connection` (em produção o hub roda num relay fora da API). O token é renovado a cada
 * (re)conexão. Sem token (dev com o hub em processo aberto) conecta sem autenticação.
 */
@Injectable({
  providedIn: 'root',
})
export class WsService {
  private http = inject(HttpClient);
  private storage = inject(StorageService);

  private hubConnection?: signalR.HubConnection;
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;
  /** Já houve conexão nesta sessão: a próxima que abrir é uma volta (dispara `_resynced`). */
  private wasConnected = false;
  /** Uma tentativa de conexão (com retentativas) em curso: evita cadeias paralelas. */
  private starting = false;
  private hubConnectionPromise?: Promise<signalR.HubConnection>;

  /** Status online/offline da conexão. */
  _wsOn = new EventEmitter<boolean>();
  /** Emitido quando a conexão é (re)estabelecida — grupos são reinscritos automaticamente. */
  _reconnected = new EventEmitter<void>();
  /**
   * Emitido só quando a conexão VOLTA depois de ter caído (não na primeira conexão). Os eventos
   * enviados durante a queda se perderam: quem escuta deve recarregar os dados em tela.
   */
  _resynced = new EventEmitter<void>();

  _maxRetries = 10;
  _retryCount = 0;
  private _newRetrySubject = new BehaviorSubject<Date | null>(null);
  public wsStatusOn = false;
  wsIsOn = false;

  // Grupos e handlers guardados para reaplicar após (re)conexão.
  private joinedGroups = new Set<string>();
  private handlers: { event: string; handler: (...args: any[]) => void }[] = [];

  public newRetry$: Observable<string> = this._newRetrySubject.asObservable().pipe(
    switchMap((newRetry) =>
      newRetry
        ? timer(0, 1000).pipe(
            map(() => {
              const secondsLeft = Math.ceil((newRetry.getTime() - new Date().getTime()) / 1000);
              return secondsLeft > 0 ? `Retentativa em ${secondsLeft}s` : 'Tentando novamente...';
            }),
            takeWhile((value) => value !== 'Tentando novamente...')
          )
        : []
    )
  );

  public startConnection = (maxRetries: number = this._maxRetries, retryDelay: number = 10000) => {
    // Idempotente: evita múltiplas conexões quando chamado de mais de um ponto (a criação da
    // conexão é assíncrona, então o estado sozinho não basta — daí o `starting`).
    if (
      this.starting ||
      (this.hubConnection &&
        this.hubConnection.state !== signalR.HubConnectionState.Disconnected)
    ) {
      return;
    }
    this.starting = true;

    const tryStartConnection = (retryCount: number) => {
      if (retryCount > 0) retryDelay = retryDelay + (retryDelay * 70) / 100;

      this._newRetrySubject.next(new Date(new Date().getTime() + retryDelay));

      this.ensureHubConnection()
        .then((connection) => connection.start())
        .then(() => {
          console.log('O WS está funcionando online neste momento');
          this.starting = false;
          this._newRetrySubject.next(null);
          this.updateWsStatus(true);
          this.rejoinGroups();
          this._reconnected.emit();
          this.emitResyncedIfReturning();
        })
        .catch((err) => {
          console.log('Error while starting connection: ' + err);
          this.updateWsStatus(false);

          if (retryCount < maxRetries) {
            this._retryCount = retryCount;
            setTimeout(() => tryStartConnection(retryCount + 1), retryDelay);
          } else {
            console.log('Número máximo de tentativas alcançado.');
            this.starting = false;
            this._retryCount = retryCount;
            this._newRetrySubject.next(null);
          }
        });
    };

    tryStartConnection(0);
  };

  public endConnection = () => {
    if (this.hubConnection && this.hubConnection.state === signalR.HubConnectionState.Connected) {
      this.hubConnection
        .stop()
        .then(() => {
          console.log('Conexão SignalR encerrada com sucesso.');
          this.updateWsStatus(false);
          // Logout: a próxima conexão é uma sessão nova, não uma volta; e o token não vale mais.
          this.wasConnected = false;
          this.accessToken = null;
          this.accessTokenExpiresAt = 0;
        })
        .catch((err) => {
          console.log('Error while stopping connection: ' + err);
          this.updateWsStatus(true);
        });
    }
  };

  public isConnected(): boolean {
    return this.hubConnection?.state === signalR.HubConnectionState.Connected;
  }

  /** Inscreve a conexão em um grupo (canal). Reingressa automaticamente após reconexão. */
  public addToGroup(group: string): void {
    if (!group) return;
    this.joinedGroups.add(group);
    if (this.isConnected()) {
      this.hubConnection!.invoke('AddToGroup', group).catch((err) => console.error(err));
    }
  }

  /** Remove a conexão de um grupo. */
  public removeFromGroup(group: string): void {
    if (!group) return;
    this.joinedGroups.delete(group);
    if (this.isConnected()) {
      this.hubConnection!.invoke('RemoveFromGroup', group).catch((err) => console.error(err));
    }
  }

  /** Registra um handler para um evento do servidor. Persiste através de reconexões. */
  public on(event: string, handler: (...args: any[]) => void): void {
    this.handlers.push({ event, handler });
    this.hubConnection?.on(event, handler);
  }

  /** Remove um handler (ou todos, se `handler` for omitido) de um evento. */
  public off(event: string, handler?: (...args: any[]) => void): void {
    this.handlers = this.handlers.filter((h) =>
      handler ? !(h.event === event && h.handler === handler) : h.event !== event
    );
    if (!this.hubConnection) return;
    if (handler) this.hubConnection.off(event, handler);
    else this.hubConnection.off(event);
  }

  /**
   * Cria a conexão na primeira vez. A URL (e o modo token/legado) é decidida aqui e mantida; o token
   * em si é pedido pelo `accessTokenFactory` a cada (re)conexão. Falha ao buscar os dados de conexão
   * (fora 404) propaga para o fluxo de retentativa.
   */
  private ensureHubConnection(): Promise<signalR.HubConnection> {
    this.hubConnectionPromise ??= this.createHubConnection().catch((err) => {
      this.hubConnectionPromise = undefined; // permite nova tentativa
      throw err;
    });
    return this.hubConnectionPromise;
  }

  private async createHubConnection(): Promise<signalR.HubConnection> {

    // Falha ao buscar os dados de conexão propaga para o fluxo de retentativa.
    const info = await this.fetchConnectionInfo();
    const url = info.url || environment.urlWs;
    this.cacheToken(info);

    this.hubConnection = new signalR.HubConnectionBuilder()
      // withCredentials: false — a autenticação é pelo token de conexão (não cookies), então não
      // enviamos credenciais. Isso evita o erro de CORS "credentials include + '*'".
      // Sem token (dev), o factory devolve vazio e o SignalR não envia autenticação.
      .withUrl(url, { accessTokenFactory: () => this.getAccessToken(), withCredentials: false })
      // Sem desistir: o relay pode ser reciclado pela hospedagem e a conexão não custa nada parada.
      .withAutomaticReconnect({
        nextRetryDelayInMilliseconds: (ctx) => [0, 2000, 10000, 30000][ctx.previousRetryCount] ?? 60000,
      })
      .build();

    // Handlers registrados antes da conexão existir são aplicados agora.
    this.applyHandlers();

    this.hubConnection.onreconnecting(() => {
      this.updateWsStatus(false);
    });

    this.hubConnection.onreconnected((connectionId: any) => {
      console.log('Reconnected with connectionId: ' + connectionId);
      this.updateWsStatus(true);
      this.rejoinGroups();
      this._reconnected.emit();
      this.emitResyncedIfReturning();
    });

    this.hubConnection.onclose((error: any) => {
      console.log('Connection closed with error: ' + error);
      this.updateWsStatus(false);
    });

    return this.hubConnection;
  }

  private fetchConnectionInfo(): Promise<RealTimeConnectionInfo> {
    // A api-key vai explícita: logo após o login a rota ainda não é auth/* e o interceptor não a põe.
    const apiKey = this.storage.getItem('apiKey');
    const headers = apiKey ? new HttpHeaders({ 'x-api-key': `${apiKey}` }) : undefined;
    return firstValueFrom(
      this.http.get<RealTimeConnectionInfo>(`${environment.apiUrl}RealTime/connection`, { headers })
    );
  }

  /** Token em cache até 1 min antes de expirar; senão pede outro à API. */
  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - 60_000) return this.accessToken;
    const info = await this.fetchConnectionInfo();
    this.cacheToken(info);
    return this.accessToken ?? '';
  }

  private cacheToken(info: RealTimeConnectionInfo): void {
    this.accessToken = info.accessToken;
    this.accessTokenExpiresAt = info.expiresAt ? new Date(info.expiresAt).getTime() : 0;
  }

  private emitResyncedIfReturning(): void {
    if (this.wasConnected) this._resynced.emit();
    this.wasConnected = true;
  }


  private applyHandlers(): void {
    if (!this.hubConnection) return;
    for (const { event, handler } of this.handlers) {
      this.hubConnection.on(event, handler);
    }
  }

  private rejoinGroups(): void {
    if (!this.isConnected()) return;
    for (const group of this.joinedGroups) {
      this.hubConnection!.invoke('AddToGroup', group).catch((err) => console.error(err));
    }
  }

  private updateWsStatus(status: boolean) {
    this._wsOn.emit(status);
    this.wsIsOn = status;
    this.wsStatusOn = status;
  }
}
