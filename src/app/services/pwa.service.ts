import { Injectable, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

export type PwaNotice = 'update' | 'broken';

/**
 * PWA (feature 0019): avisa quando há versão nova do PRMake (mesmo modelo do Listo/Comanda Certa).
 * Nunca recarrega sozinho — o usuário escolhe a hora (pode estar no meio de um PR). O aviso é uma
 * faixa própria no App, e não um MatSnackBar: qualquer snackbar aberto depois derrubaria o aviso.
 */
@Injectable({ providedIn: 'root' })
export class PwaService {
  private readonly updates = inject(SwUpdate);

  /** Aviso pendente: versão nova pronta ou service worker em estado irrecuperável. */
  readonly notice = signal<PwaNotice | null>(null);

  private static readonly CHECK_INTERVAL_MS = 30 * 60 * 1000;

  start(): void {
    if (!this.updates.isEnabled) return;

    this.updates.versionUpdates.subscribe((e) => {
      if (e.type === 'VERSION_READY' && this.notice() === null) this.notice.set('update');
    });
    this.updates.unrecoverable.subscribe(() => this.notice.set('broken'));

    // A aba fica aberta o dia todo: confere versão nova ao voltar para ela e periodicamente.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.check();
    });
    setInterval(() => {
      if (document.visibilityState === 'visible') this.check();
    }, PwaService.CHECK_INTERVAL_MS);
  }

  /** Botão do aviso: passa para a versão nova (ou recupera o SW) recarregando a página. */
  async reload(): Promise<void> {
    if (this.notice() === 'update') await this.updates.activateUpdate().catch(() => {});
    document.location.reload();
  }

  private check(): void {
    this.updates.checkForUpdate().catch(() => {});
  }
}
