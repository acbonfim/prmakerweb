import { Injectable, computed, inject, signal } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';

/** Algo aberto por cima da tela que o Voltar fecha antes de trocar de tela (gaveta, tela cheia, diálogo). */
interface OverlayEntry {
  id: number;
  close: () => void;
}

/** Entrada atual do histórico: `id` é a camada dona dela (entrada criada por `push`). */
interface HistoryPos {
  id?: number;
  href: string;
}

const HOME = '/auth/dashboard';

/**
 * Botão Voltar do app (feature 0043). Instalado (PWA standalone) não há botão do navegador, então:
 * 1. fecha o que estiver aberto por cima — gaveta do menu, diálogo, tela cheia (o mais recente primeiro);
 * 2. volta para a tela anterior *dentro do app*;
 * 3. sem tela anterior (abriu por um link), vai para a tela pai/Dashboard — nunca sai do app nem volta ao login.
 *
 * O voltar do sistema (Android, Alt+←, gesto) tem o mesmo efeito sobre o que está aberto: cada camada
 * empilha uma entrada no histórico com a mesma URL, e o `popstate` que sai dela fecha só a camada do
 * topo (o Router ignora a navegação para a mesma URL). Fechar pela tela NÃO chama `history.back()` (ele é
 * assíncrono e brigaria com uma navegação logo em seguida): a entrada fica "vencida", é reaproveitada pela
 * próxima camada e, se o voltar cair nela sem trocar de tela, o serviço continua o voltar sozinho.
 */
@Injectable({ providedIn: 'root' })
export class BackNavigationService {
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);

  /** URLs autenticadas visitadas nesta aba, na ordem do histórico. */
  private readonly stack = signal<string[]>([]);
  private readonly overlays = signal<OverlayEntry[]>([]);
  private nextId = 1;
  private pos: HistoryPos = { href: '' };
  private trigger: NavigationStart['navigationTrigger'] = 'imperative';
  private replace = false;
  private started = false;

  readonly url = signal('');
  /** Há o que fechar ou para onde voltar (no Dashboard sem histórico, não). */
  readonly canGoBack = computed(
    () => this.overlays().length > 0 || this.stack().length > 1 || (this.url() !== '' && !this.url().startsWith(HOME))
  );

  start(): void {
    if (this.started) return;
    this.started = true;

    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.trigger = event.navigationTrigger;
        this.replace = !!this.router.getCurrentNavigation()?.extras.replaceUrl;
      } else if (event instanceof NavigationEnd) {
        this.record(event.urlAfterRedirects);
        this.pos = this.readPos();
      }
    });

    // Diálogos do Material entram na pilha sozinhos (o Voltar e o voltar do sistema fecham o do topo).
    this.dialog.afterOpened.subscribe((ref) => this.trackDialog(ref));

    window.addEventListener('popstate', this.onPopState);
  }

  /**
   * Registra uma camada aberta por cima da tela. Devolve a função a chamar quando ela fechar pela
   * própria tela (botão fechar, Esc, fundo) — pode ser chamada mais de uma vez.
   */
  push(close: () => void): () => void {
    const id = this.nextId++;
    this.overlays.update((list) => [...list, { id, close }]);
    const state = { ...(history.state ?? {}), cimeOverlay: id };
    // Entrada vencida (camada já fechada) na mesma tela: reaproveita em vez de empilhar outra.
    if (this.isStale(this.pos) && this.pos.href === location.href) history.replaceState(state, '');
    else history.pushState(state, '');
    this.pos = this.readPos();
    return () => this.overlays.update((list) => list.filter((o) => o.id !== id));
  }

  back(): void {
    const top = this.overlays().at(-1);
    if (top) {
      top.close();
      return;
    }
    if (this.stack().length > 1) {
      history.back();
      return;
    }
    this.router.navigateByUrl(this.parentOf(this.url()), { replaceUrl: true });
  }

  private onPopState = (): void => {
    const prev = this.pos;
    this.pos = this.readPos();
    const top = this.overlays().at(-1);
    if (top) {
      if (this.pos.id === top.id) return;
      // Voltar do sistema com algo aberto: fecha só a camada do topo.
      this.overlays.update((list) => list.slice(0, -1));
      top.close();
      return;
    }
    // Saiu de uma entrada vencida sem trocar de tela: para o usuário nada aconteceu — continua o voltar.
    if (this.isStale(prev) && prev.href === this.pos.href) history.back();
  };

  private trackDialog(ref: MatDialogRef<unknown>): void {
    const release = this.push(() => ref.close());
    ref.afterClosed().subscribe(() => release());
  }

  private isStale(pos: HistoryPos): boolean {
    return pos.id !== undefined && !this.overlays().some((o) => o.id === pos.id);
  }

  private readPos(): HistoryPos {
    const id = history.state?.cimeOverlay;
    return { id: typeof id === 'number' ? id : undefined, href: location.href };
  }

  private record(url: string): void {
    this.url.set(url);
    if (!url.startsWith('/auth/')) {
      // Login, primeiro acesso, handover público: o Voltar nunca leva para lá.
      this.stack.set([]);
      this.overlays.set([]);
      return;
    }
    const list = this.stack();
    if (this.trigger === 'popstate') {
      this.stack.set(list.at(-2) === url ? list.slice(0, -1) : [...list, url]);
    } else if (this.replace && list.length) {
      this.stack.set([...list.slice(0, -1), url]);
    } else if (list.at(-1) !== url) {
      this.stack.set([...list, url]);
    }
  }

  /** Tela "pai" quando não há histórico no app. */
  private parentOf(url: string): string {
    const path = url.split(/[?#]/)[0];
    return path.startsWith('/auth/vacation-') ? '/auth/vacations' : HOME;
  }
}
