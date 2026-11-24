import { Injectable, Injector } from '@angular/core';
import { HttpErrorResponse, HttpEvent, HttpHandler, HttpInterceptor, HttpRequest, HttpResponse } from '@angular/common/http';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable, tap } from 'rxjs';
import { GOVERNANCE_WARNING_HEADER } from '../services/governance/governance.model';
import { BlockedNotice, decodeWarningHeader, parseBlockedBody } from '../services/governance/governance.logic';
import { GovernanceBlockedDialogComponent } from '../components/governance-blocked-dialog/governance-blocked-dialog.component';

/**
 * Governança (0098) nas telas: 403 `governance_blocked` → aviso claro com o motivo e a regra (um por vez; o 403 segue
 * para a tela, que trata o erro como já fazia); cabeçalho `X-Governance-Warning` → aviso que não bloqueia.
 * Outros 403 (ex.: PERSONAL_INTEGRATION_REQUIRED) passam direto para os interceptores de sempre.
 */
@Injectable({ providedIn: 'root' })
export class GovernanceInterceptor implements HttpInterceptor {
  private blockedOpen = false;
  private lastWarning = { text: '', at: 0 };

  // Injector: diálogos/snackbar resolvidos na hora (evita ciclo com o HttpClient).
  constructor(private injector: Injector) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    return next.handle(req).pipe(
      tap({
        next: (event) => {
          if (event instanceof HttpResponse) this.warn(event.headers.get(GOVERNANCE_WARNING_HEADER));
        },
        error: (err: unknown) => {
          if (!(err instanceof HttpErrorResponse) || err.status !== 403) return;
          const body = err.error;
          if (body instanceof Blob) {
            void body.text().then((t) => this.blocked(parseBlockedBody(t))).catch(() => undefined);
          } else {
            this.blocked(parseBlockedBody(body));
          }
        },
      }),
    );
  }

  private blocked(notice: BlockedNotice | null): void {
    if (!notice || this.blockedOpen) return;
    this.blockedOpen = true;
    // Depois do tratamento de erro da própria tela (que costuma abrir um aviso genérico): o motivo real fica por cima.
    setTimeout(() => {
      this.injector.get(MatDialog)
        .open(GovernanceBlockedDialogComponent, { width: '480px', maxWidth: '94vw', autoFocus: 'dialog', data: notice, panelClass: 'custom-dialog-container' })
        .afterClosed()
        .subscribe(() => (this.blockedOpen = false));
    });
  }

  private warn(raw: string | null): void {
    const text = decodeWarningHeader(raw);
    if (!text) return;
    const now = Date.now();
    if (text === this.lastWarning.text && now - this.lastWarning.at < 5000) return;
    this.lastWarning = { text, at: now };
    this.injector.get(MatSnackBar).open(`Aviso da governança: ${text}`, 'OK', {
      horizontalPosition: 'right', verticalPosition: 'top', duration: 10000,
    });
  }
}
