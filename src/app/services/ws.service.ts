import { Injectable, EventEmitter } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { BehaviorSubject, Observable, map, switchMap, takeWhile, timer } from 'rxjs';
import {environment} from '../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class WsService {
  private hubConnection!: signalR.HubConnection;

  _orderConfirmed = new EventEmitter<any>();
  _orderCanceled = new EventEmitter<any>();
  _paymentConfirmed = new EventEmitter<any>();
  _wsOn = new EventEmitter<any>();
  _maxRetries = 10;
  _retryCount = 0;
  private _newRetrySubject = new BehaviorSubject<Date | null>(null);
  public wsStatusOn = false;
  wsIsOn=false;

  public newRetry$: Observable<string> = this._newRetrySubject.asObservable().pipe(
    switchMap((newRetry) =>
      newRetry
        ? timer(0, 1000).pipe(
            map((value) => {
              const secondsLeft = Math.ceil((newRetry.getTime() - new Date().getTime()) / 1000);
              return secondsLeft > 0 ? `Retentativa em ${secondsLeft}s` : 'Tentando novamente...';
            }),
            takeWhile((value) => value !== 'Tentando novamente...')
          )
        : []
    )
  );

  public startConnection = (maxRetries: number = this._maxRetries, retryDelay: number = 10000) => {
    if (!this.hubConnection) {
      const headers = {
        'x-api-key': environment.apiKeyWS,
      };

      this.hubConnection = new signalR.HubConnectionBuilder()
        .withUrl(`${environment.urlWs}`, { headers })
        .withAutomaticReconnect()
        .build();

      this.hubConnection.onreconnecting((error: any) => {
        this.updateWsStatus(false);
      });

      this.hubConnection.onreconnected((connectionId: any) => {
        console.log('Reconnected with connectionId: ' + connectionId);
        this.updateWsStatus(true);
      });

      this.hubConnection.onclose((error: any) => {
        console.log('Connection closed with error: ' + error);
        this.updateWsStatus(false);
      });
    }

    const tryStartConnection = (retryCount: number) => {
      if(retryCount > 0)
        retryDelay = retryDelay + (retryDelay * 70) / 100

      this._newRetrySubject.next(new Date(new Date().getTime() + retryDelay));

      this.hubConnection
        .start()
        .then(() => {
          console.log('O WS  está funcionando online neste momento');
          this.updateWsStatus(true);
          this.orderConfirmed();
          this.paymentConfirmed();
          this.orderCanceled();
        })
        .catch((err) => {
          console.log('Error while starting connection: ' + err);
          this.updateWsStatus(false);

          if (retryCount < maxRetries) {
            this._retryCount = retryCount;

            console.log("DELAY ",retryDelay)
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

  public addToGroup(orderId: string) {
    this.hubConnection
      .invoke('AddToGroup', orderId)
      .catch((err) => console.error(err));

    console.log('Listerning orderId: ', orderId);
  }

  public removeFromGroup(orderId: string) {
    this.hubConnection
      .invoke('RemoveFromGroup', orderId)
      .catch((err) => console.error(err));
  }

  public orderConfirmed() {
    this.hubConnection.on('orderConfirmed', (data : any) => {
      this._orderConfirmed.emit(data);
    });
  }

  public paymentConfirmed() {
    this.hubConnection.on('paymentConfirmed', (data: any) => {
      this._paymentConfirmed.emit(data);
    });
  }

  public orderCanceled() {
    this.hubConnection.on('orderCanceled', (data: any) => {
      this._orderCanceled.emit(data);
    });
  }

  private updateWsStatus(status: boolean) {
    this._wsOn.emit(status);
    this.wsIsOn = status;
    this.wsStatusOn = status;
  }
}
