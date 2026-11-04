import { Component, computed, inject, input } from '@angular/core';
import { PresenceService, UserPresence } from '../../services/usage/presence.service';
import { PRESENCE_LABEL, formatAgo } from '../../services/usage/usage.model';

/**
 * Selo de presença (0079): ponto (forma + cor) e texto — o estado nunca fica só na cor. Offline mostra "visto há X".
 */
@Component({
  selector: 'app-presence-badge',
  standalone: true,
  template: `
    <span class="pb" [class]="'pb pb--' + stateKey()" [class.pb--compact]="compact()" [attr.title]="text()">
      <span class="pb__dot" aria-hidden="true"></span>
      @if (!compact()) {
        <span class="pb__text">{{ text() }}</span>
      } @else {
        <span class="pb__text">{{ label() }}</span>
      }
    </span>
  `,
  styles: [`
    :host { display: inline-flex; min-width: 0; max-width: 100%; }
    .pb { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; font-size: 12px;
      color: var(--cc-text-2); line-height: 1.3; }
    .pb__text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pb__dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; background: var(--pb-c); box-shadow: 0 0 0 2px var(--surface-1, #262b33); }
    .pb--active { --pb-c: #3fb950; color: var(--cc-text-1); }
    .pb--busy { --pb-c: #58a6ff; color: var(--cc-text-1); }
    .pb--busy .pb__dot { animation: pb-pulse 1.6s ease-in-out infinite; }
    .pb--background { --pb-c: #8b949e; }
    .pb--away { --pb-c: #d29922; }
    .pb--away .pb__dot { border-radius: 2px; }
    .pb--offline { --pb-c: transparent; color: var(--cc-text-3); }
    .pb--offline .pb__dot { border: 1.5px solid #6e7681; width: 8px; height: 8px; box-sizing: border-box; }
    @keyframes pb-pulse { 0%, 100% { box-shadow: 0 0 0 2px var(--surface-1, #262b33), 0 0 0 2px rgba(88,166,255,.0); }
      50% { box-shadow: 0 0 0 2px var(--surface-1, #262b33), 0 0 0 5px rgba(88,166,255,.35); } }
    @media (prefers-reduced-motion: reduce) { .pb--busy .pb__dot { animation: none; } }
  `],
})
export class PresenceBadgeComponent {
  private readonly presenceService = inject(PresenceService);

  readonly presence = input<UserPresence | null>(null);
  /** Último registro conhecido (lote/login) para o "visto há". */
  readonly lastSeen = input<string | null>(null);
  /** De onde veio o "visto há" (ex.: "linha do tempo · card 75349"). */
  readonly lastSeenWhat = input<string | null>(null);
  readonly compact = input(false);

  readonly stateKey = computed(() => this.presence()?.state ?? 'offline');
  readonly label = computed(() => PRESENCE_LABEL[this.stateKey()]);
  readonly text = computed(() => {
    const p = this.presence();
    if (p) return this.presenceService.describe(p);
    const seen = this.lastSeen();
    if (!seen) return 'Offline';
    const what = this.lastSeenWhat();
    return `Offline · visto ${formatAgo(seen, this.presenceService.now())}${what ? ' · ' + what : ''}`;
  });
}
