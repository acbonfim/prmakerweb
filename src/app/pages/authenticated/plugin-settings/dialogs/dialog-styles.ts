/** Estilo comum dos diálogos da tela de configurações (0086) — mesma linguagem do editor de plugin da 0032. */
export const dialogStyles = `
  :host { display: block; }
  .dl { display: flex; flex-direction: column; max-height: 86vh; color: var(--mat-sys-on-surface); }
  .dl__header { flex: none; display: flex; align-items: center; gap: 10px; padding: 12px 20px;
    background: var(--surface-2, #2e343f); border-bottom: 1px solid rgba(255, 255, 255, .06); }
  .dl__lead { color: var(--mat-sys-primary); }
  .dl__lead--warn { color: #d29922; }
  .dl__titles { display: flex; flex-direction: column; min-width: 0; }
  .dl__kicker { font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
    color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent); }
  .dl__title { font-weight: 600; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dl__body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 14px 20px; display: flex; flex-direction: column; gap: 12px; }
  .dl__item { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, .08); background: var(--surface-1, #262b33); }
  .dl__item-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; font-size: 13.5px; }
  .dl__key { font-size: 11.5px; font-family: 'JetBrains Mono', monospace; color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent); }
  .dl__label { font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent); }
  .dl__text { font-size: 13px; line-height: 1.5; }
  .dl__footer { flex: none; display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 10px 20px;
    border-top: 1px solid rgba(255, 255, 255, .06); background: var(--surface-2, #2e343f); }
  .dl__footer button mat-icon { margin-right: 4px; }
  .dl__spacer { flex: 1 1 auto; }
  .dl__note { font-size: 12px; color: color-mix(in srgb, var(--mat-sys-on-surface) 60%, transparent); }
  .dl__empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 28px; font-size: 13px;
    color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent); }
`;
