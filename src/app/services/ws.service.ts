import { Injectable, EventEmitter } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { BehaviorSubject, Observable, map, switchMap, takeWhile, timer } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * Serviço genérico de tempo real (SignalR).
 *
 * Espelha o hub RealTimeHub do backend: `AddToGroup`/`RemoveFromGroup` para inscrição em
 * canais e handlers arbitrários via `on()`/`off()`. Para adicionar um novo ponto de tempo
 * real, basta entrar em um grupo e registrar um handler — nenhuma mudança aqui é necessária.
 */
@Injectable({
  providedIn: 'root',
})
export class WsService {
  private hubConnection?: signalR.HubConnection;

  /** Status online/offline da conexão. */
  _wsOn = new EventEmitter<boolean>();
  /** Emitido quando a conexão é (re)estabelecida — grupos são reinscritos automaticamente. */
  _reconnected = new EventEmitter<void>();

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
    // Idempotente: evita múltiplas conexões quando chamado de mais de um ponto.
    if (
      this.hubConnection &&
      (this.hubConnection.state === signalR.HubConnectionState.Connected ||
        this.hubConnection.state === signalR.HubConnectionState.Connecting)
    ) {
      return;
    }

    if (!this.hubConnection) {
      const headers = {
        'x-api-key': environment.apiKeyWS,
      };

      this.hubConnection = new signalR.HubConnectionBuilder()
        // withCredentials: false — a autenticação é via api-key na query string (não cookies),
        // então não enviamos credenciais. Isso evita o erro de CORS "credentials include + '*'"
        // e permite que qualquer policy de CORS (inclusive AllowAnyOrigin) atenda o hub.
        .withUrl(this.buildUrl(), { headers, withCredentials: false })
        .withAutomaticReconnect()
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
      });

      this.hubConnection.onclose((error: any) => {
        console.log('Connection closed with error: ' + error);
        this.updateWsStatus(false);
      });
    }

    const tryStartConnection = (retryCount: number) => {
      if (retryCount > 0) retryDelay = retryDelay + (retryDelay * 70) / 100;

      this._newRetrySubject.next(new Date(new Date().getTime() + retryDelay));

      this.hubConnection!.start()
        .then(() => {
          console.log('O WS está funcionando online neste momento');
          this._newRetrySubject.next(null);
          this.updateWsStatus(true);
          this.rejoinGroups();
          this._reconnected.emit();
        })
        .catch((err) => {
          console.log('Error while starting connection: ' + err);
          this.updateWsStatus(false);

          if (retryCount < maxRetries) {
            this._retryCount = retryCount;
            setTimeout(() => tryStartConnection(retryCount + 1), retryDelay);
          } else {
            console.log('Número máximo de tentativas alcançado.');
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

  private buildUrl(): string {
    // Remove barras finais e injeta a api-key na query string — necessária no upgrade
    // WebSocket, onde o browser não envia headers customizados.
    const base = (environment.urlWs || '').replace(/\/+$/, '');
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}x-api-key=${encodeURIComponent(environment.apiKeyWS)}`;
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
