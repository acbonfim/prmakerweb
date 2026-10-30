/**
 * Movimento compartilhado das telas novas da 0074 (promoção e histórico de versões): skeleton com brilho que corre,
 * entrada escalonada, "pop" para o que acabou de chegar, giro de carregamento. Quem tem movimento reduzido no sistema
 * (`prefers-reduced-motion`) vê tudo parado — o skeleton continua aparecendo, só sem animar.
 */
export const MOTION_CSS = `
  @keyframes mo-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  @keyframes mo-fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes mo-pop { 0% { opacity: 0; transform: scale(.82); } 60% { opacity: 1; transform: scale(1.05); } 100% { transform: scale(1); } }
  @keyframes mo-shimmer { to { background-position: -200% 0; } }
  @keyframes mo-sweep { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
  @keyframes mo-spin { to { transform: rotate(360deg); } }
  @keyframes mo-shake { 0%, 100% { transform: none; } 20%, 60% { transform: translateX(-3px); } 40%, 80% { transform: translateX(3px); } }
  @keyframes mo-launch { 0%, 100% { transform: translateY(0) rotate(0); } 50% { transform: translateY(-3px) rotate(-8deg); } }
  @keyframes mo-flash { 0% { background: color-mix(in srgb, var(--mat-sys-primary) 22%, transparent); } 100% { background: transparent; } }

  /* Skeleton: bloco cinza com um brilho passando — o formato imita o conteúdo que vai chegar. */
  .sk {
    display: inline-block; vertical-align: middle; border-radius: 6px;
    background: linear-gradient(90deg,
      color-mix(in srgb, var(--mat-sys-on-surface) 8%, transparent) 25%,
      color-mix(in srgb, var(--mat-sys-on-surface) 20%, transparent) 37%,
      color-mix(in srgb, var(--mat-sys-on-surface) 8%, transparent) 63%);
    background-size: 200% 100%;
    animation: mo-shimmer 1.3s linear infinite;
  }
  .sk--line { height: 12px; }
  .sk--text { height: 14px; }
  .sk--pill { height: 24px; border-radius: 999px; }
  .sk--circle { border-radius: 50%; }

  /* Varredura sobre um bloco que está sendo atualizado (precisa de position: relative; overflow: hidden no pai). */
  .busy-sweep { position: relative; overflow: hidden; }
  .busy-sweep::after {
    content: ''; position: absolute; inset: 0; pointer-events: none;
    background: linear-gradient(100deg, transparent 30%, color-mix(in srgb, var(--mat-sys-primary) 14%, transparent) 50%, transparent 70%);
    animation: mo-sweep 1.2s ease-in-out infinite;
  }

  .spin { animation: mo-spin .9s linear infinite; }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; animation-delay: 0s !important; transition-duration: .001ms !important; }
  }
`;
