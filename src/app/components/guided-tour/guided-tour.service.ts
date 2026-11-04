import { Injectable, inject, isDevMode, signal } from '@angular/core';
import { DriveStep, Driver, driver } from 'driver.js';
import { StorageService } from '../../services/storage.service';
import { TourDefinition, TourHost, TourStep } from './tour.model';

/** O que já foi visto, por usuário e tour. `entryDone` = viu a parte de entrada e espera um card para continuar. */
interface TourProgress {
  version: number;
  entryDone?: number;
}

type TourMode = 'entry' | 'card' | 'full' | 'manual';

const NARROW = '(max-width: 900px)';
const WAIT_FOR_ELEMENT_MS = 1500;

/**
 * 0081: tour guiado (driver.js: máscara escura com recorte no elemento + balão). Os passos apontam para `data-tour` nos
 * templates e são resolvidos na hora de mostrar — a tela muda e o tour acompanha; passo sem elemento é pulado.
 * Abre sozinho só na primeira vez (por usuário, no navegador) e, quando o tour ganha passos novos, mostra só as novidades.
 */
@Injectable({ providedIn: 'root' })
export class GuidedTourService {
  private readonly userId = (inject(StorageService).getAccess()?.user?.externalId ?? 'anon').toLowerCase();
  private active?: { driver: Driver; tour: TourDefinition; mode: TourMode; finished: boolean; skipped: boolean };
  readonly running = signal(false);

  /** Primeira vez na tela (ou tour com novidades): abre sozinho. Sem card aberto, só os passos de entrada. */
  autoStart(tour: TourDefinition, host: TourHost): void {
    if (this.active || this.dialogOpen()) return;
    const progress = this.read(tour);
    if (progress.version >= tour.version) return;
    const news = tour.steps.filter((s) => s.since > progress.version);
    if (host.hasCard()) {
      this.run(tour, host, news, progress.entryDone === tour.version ? 'card' : 'full');
    } else if (progress.entryDone !== tour.version) {
      this.run(tour, host, news.filter((s) => s.phase === 'entry'), 'entry');
    }
  }

  /**
   * O card abriu (buscado ou vindo da Home): quem viu só a entrada continua de onde parou; quem chegou direto num card
   * (primeira vez) faz o tour inteiro.
   */
  cardReady(tour: TourDefinition, host: TourHost): void {
    const progress = this.read(tour);
    if (progress.version >= tour.version) return;
    if (this.active?.mode === 'entry' && this.active.tour.id === tour.id) {
      // Buscou o card com o balão de entrada aberto: segue direto para o card.
      this.write(tour, { ...progress, entryDone: tour.version });
      this.stop();
    } else if (this.active || this.dialogOpen()) {
      return;
    }
    const mode: TourMode = this.read(tour).entryDone === tour.version ? 'card' : 'full';
    const news = tour.steps.filter((s) => s.since > progress.version && (mode === 'full' || s.phase === 'card'));
    // Espera o plano e a conversa aparecerem na tela.
    setTimeout(() => {
      if (!this.active && host.hasCard()) this.run(tour, host, news, mode);
    }, 1200);
  }

  /** Pela ajuda: o tour inteiro (ou a partir de um passo). Sem card, só o que existe na tela. */
  start(tour: TourDefinition, host: TourHost, fromId?: string): void {
    this.stop();
    const steps = tour.steps.filter((s) => host.hasCard() || s.phase === 'entry');
    const from = fromId ? Math.max(0, steps.findIndex((s) => s.id === fromId)) : 0;
    this.run(tour, host, steps.slice(from), 'manual');
  }

  /** O passo tem elemento na tela agora? (para o guia dizer "abra um card para ver"). */
  available(step: TourStep): boolean {
    return !step.anchor || !!this.find(step, true);
  }

  stop(): void {
    const a = this.active;
    if (!a) return;
    a.finished = true;
    a.driver.destroy();
  }

  // ── Interno ────────────────────────────────────────────────────────────────────────────────────

  private run(tour: TourDefinition, host: TourHost, candidates: TourStep[], mode: TourMode): void {
    if (this.active) return;
    const narrow = window.matchMedia(NARROW).matches;
    // Só o que existe agora (no celular, o que está numa aba fechada também vale: o tour abre a aba).
    const steps = candidates.filter((s) => {
      if (!s.anchor || this.find(s, narrow)) return true;
      if (!s.optional && isDevMode()) console.warn(`[tour ${tour.id}] passo "${s.id}" sem elemento data-tour="${[s.anchor].flat().join('|')}" na tela`);
      return false;
    });
    if (!steps.length) return;
    const offset = mode === 'card' ? tour.steps.filter((s) => s.phase === 'entry' && s.since > this.read(tour).version).length : 0;
    const totalShown = offset + steps.length;

    const go = (d: Driver, index: number) => {
      const target = steps[index];
      if (!target) {
        state.finished = true;
        d.destroy();
        return;
      }
      if (target.mobileTab && window.matchMedia(NARROW).matches && host.showMobileTab) {
        host.showMobileTab(target.mobileTab);
        // A aba renderiza no próximo ciclo; o balão vem depois, já no lugar certo.
        setTimeout(() => d.moveTo(index), 120);
      } else {
        d.moveTo(index);
      }
    };

    const driveSteps: DriveStep[] = steps.map((s, i) => ({
      element: s.anchor ? () => this.find(s, true) as Element : undefined,
      disableActiveInteraction: !s.interactive,
      waitForElement: WAIT_FOR_ELEMENT_MS,
      data: { id: s.id },
      popover: {
        title: s.title,
        description: s.body + (mode === 'entry' && s.id === 'card-search' ? '<br><small>O tour continua sozinho quando o card abrir.</small>' : ''),
        side: s.side,
        align: s.align,
        // O botão "próximo" do último passo encerra (o driver só troca o texto quando não há onNextClick próprio).
        nextBtnText: i < steps.length - 1 ? 'Próximo' : mode === 'entry' ? 'Ok, vou buscar' : 'Concluir tour',
        prevBtnText: 'Voltar',
        showButtons: i === 0 ? ['next', 'close'] : ['next', 'previous', 'close']
      }
    }));

    const d = driver({
      steps: driveSteps,
      animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      overlayColor: '#05060a',
      overlayOpacity: 0.72,
      stagePadding: 6,
      stageRadius: 10,
      popoverOffset: 12,
      smoothScroll: true,
      allowClose: true,
      allowKeyboardControl: true,
      overlayClickBehavior: 'none',
      skipMissingElement: true,
      popoverClass: 'prmake-tour',
      closeBtnLabel: 'Pular tour',
      onPopoverRender: (popover, { state: st }) => {
        const index = st.activeIndex ?? 0;
        popover.progress.textContent = `${offset + index + 1} de ${totalShown}`;
        popover.progress.style.display = 'block';
        // "Pular tour" em todos os passos (o X também pula; Esc também).
        const skip = document.createElement('button');
        skip.type = 'button';
        skip.className = 'prmake-tour__skip';
        skip.textContent = 'Pular tour';
        skip.addEventListener('click', () => {
          state.skipped = true;
          d.destroy();
        });
        popover.footer.insertBefore(skip, popover.footer.firstChild);
      },
      onNextClick: (_el, _step, { driver: dr }) => go(dr, (dr.getActiveIndex() ?? 0) + 1),
      onPrevClick: (_el, _step, { driver: dr }) => go(dr, Math.max(0, (dr.getActiveIndex() ?? 0) - 1)),
      onCloseClick: (_el, _step, { driver: dr }) => {
        state.skipped = true;
        dr.destroy();
      },
      onDestroyed: (_el, _step, { reason }) => {
        const progress = this.read(tour);
        const finished = state.finished && !state.skipped && reason !== 'escape';
        if (state.mode === 'entry' && finished) {
          // Viu a entrada: o resto vem quando um card abrir.
          this.write(tour, { ...progress, entryDone: tour.version });
        } else if (reason !== 'replaced') {
          // Concluiu, pulou ou fechou: não abre mais sozinho (até a próxima versão do tour).
          this.write(tour, { version: tour.version });
        }
        if (this.active === state) this.active = undefined;
        this.running.set(false);
      }
    });

    const state = { driver: d, tour, mode, finished: false, skipped: false };
    this.active = state;
    this.running.set(true);
    const first = steps[0];
    if (first.mobileTab && narrow && host.showMobileTab) {
      host.showMobileTab(first.mobileTab);
      setTimeout(() => d.drive(0), 120);
    } else {
      d.drive(0);
    }
  }

  private find(step: TourStep, includeHidden: boolean): HTMLElement | null {
    for (const anchor of [step.anchor ?? []].flat()) {
      const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${anchor}"]`));
      const visible = all.find((el) => el.getClientRects().length > 0);
      if (visible) return visible;
      if (includeHidden && step.mobileTab && all[0]) return all[0];
    }
    return null;
  }

  private dialogOpen(): boolean {
    return !!document.querySelector('.cdk-overlay-container .mat-mdc-dialog-container');
  }

  private key(tour: TourDefinition): string {
    return `prmake.tour.${tour.id}.${this.userId}`;
  }

  private read(tour: TourDefinition): TourProgress {
    try {
      const raw = JSON.parse(localStorage.getItem(this.key(tour)) ?? 'null');
      return raw && typeof raw.version === 'number' ? raw : { version: 0 };
    } catch {
      return { version: 0 };
    }
  }

  private write(tour: TourDefinition, progress: TourProgress): void {
    try { localStorage.setItem(this.key(tour), JSON.stringify(progress)); } catch { /* sem storage: só não lembra */ }
  }
}
