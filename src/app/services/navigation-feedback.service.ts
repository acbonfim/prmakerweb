import { Injectable, inject, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router } from '@angular/router';

/**
 * Feedback da troca de tela (feature 0022). As rotas são lazy e passam pelo AuthGuard (que pode
 * renovar o token): sem isto, entre o clique e a tela nova não aparecia nada.
 * - barra no topo depois de BAR_DELAY_MS (navegação instantânea não pisca);
 * - aviso "Carregando…" / "Renovando sessão…" depois de SLOW_DELAY_MS;
 * - falha ao abrir a tela → mensagem com "Recarregar" (nunca em silêncio).
 */
@Injectable({ providedIn: 'root' })
export class NavigationFeedbackService {
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);

  readonly navigating = signal(false);
  readonly slow = signal(false);

  private static readonly BAR_DELAY_MS = 150;
  private static readonly SLOW_DELAY_MS = 1500;
  private barTimer?: ReturnType<typeof setTimeout>;
  private slowTimer?: ReturnType<typeof setTimeout>;

  start(): void {
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.clearTimers();
        this.barTimer = setTimeout(() => this.navigating.set(true), NavigationFeedbackService.BAR_DELAY_MS);
        this.slowTimer = setTimeout(() => this.slow.set(true), NavigationFeedbackService.SLOW_DELAY_MS);
      } else if (event instanceof NavigationEnd || event instanceof NavigationCancel || event instanceof NavigationError) {
        this.clearTimers();
        this.navigating.set(false);
        this.slow.set(false);
        if (event instanceof NavigationError) this.onError(event);
      }
    });
  }

  private onError(event: NavigationError): void {
    console.error('Falha ao abrir a tela', event.url, event.error);
    this.snack
      .open('Não foi possível abrir a tela. Verifique a conexão e tente de novo.', 'Recarregar', { duration: 15000 })
      .onAction()
      .subscribe(() => window.location.assign(event.url));
  }

  private clearTimers(): void {
    clearTimeout(this.barTimer);
    clearTimeout(this.slowTimer);
  }
}
