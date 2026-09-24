import { Injectable, Injector } from '@angular/core';
import { HttpErrorResponse, HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable, tap } from 'rxjs';
import { UserIntegrationService } from '../services/user-integration.service';
import { MyIntegrationsDialogComponent } from '../components/my-integrations-dialog/my-integrations-dialog.component';

/** Código do backend quando falta configurar uma integração de uso pessoal (feature 0002). */
export const PERSONAL_INTEGRATION_REQUIRED = 'PERSONAL_INTEGRATION_REQUIRED';

/**
 * 403 PERSONAL_INTEGRATION_REQUIRED em qualquer chamada → avisa (uma vez por rajada) com ação
 * "Configurar" que abre "Minhas integrações", e atualiza o status (bloqueio da tela de PR).
 */
@Injectable({ providedIn: 'root' })
export class PersonalIntegrationInterceptor implements HttpInterceptor {
  private noticeOpen = false;

  // Injector (e não o service direto): o service usa HttpClient, que depende deste interceptor.
  constructor(private injector: Injector) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    return next.handle(req).pipe(
      tap({
        error: (err: unknown) => {
          if (err instanceof HttpErrorResponse && err.status === 403 && err.error?.code === PERSONAL_INTEGRATION_REQUIRED) {
            this.notify(err.error?.plugins ?? []);
          }
        },
      })
    );
  }

  private notify(plugins: string[]): void {
    this.injector.get(UserIntegrationService).loadStatus();
    if (this.noticeOpen) return;
    this.noticeOpen = true;

    const names = plugins.length ? `: ${plugins.join(', ')}` : '';
    const ref = this.injector.get(MatSnackBar).open(
      `Configure suas integrações pessoais para usar esta função${names}`, 'Configurar',
      { horizontalPosition: 'right', verticalPosition: 'top', duration: 10000 });
    ref.onAction().subscribe(() => this.injector.get(MatDialog).open(MyIntegrationsDialogComponent, {
      width: '640px', maxWidth: '94vw', maxHeight: '90vh', panelClass: 'custom-dialog-container'
    }));
    ref.afterDismissed().subscribe(() => (this.noticeOpen = false));
  }
}
