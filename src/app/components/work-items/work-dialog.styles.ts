/**
 * 0085: estilos compartilhados dos modais dos itens de trabalho. Entram nos componentes com `ViewEncapsulation.None`
 * (todos os seletores começam por `.wi-` — não vazam para outras telas) — assim o painel do Material também é alcançado
 * sem mexer no `styles.scss` global.
 */
export const WORK_DIALOG_STYLES = `
.wi-dialog-panel .mat-mdc-dialog-surface { border-radius: 14px !important; overflow: hidden; }
.wi-dialog-panel--full .mat-mdc-dialog-surface { border-radius: 0 !important; }
.wi-dlg { display: flex; flex-direction: column; max-height: inherit; height: 100%; min-height: 0; color: var(--mat-sys-on-surface); background: var(--surface-1, #262b33); font-size: 13px; }
.wi-dlg__head { display: flex; align-items: center; gap: 10px; padding: 10px 8px 10px 16px; background: var(--surface-2, #2e343f); flex: none; }
.wi-dlg__head-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.wi-dlg__title { font-weight: 600; font-size: 15px; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; }
.wi-dlg__sub { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: 11.5px; color: var(--cc-text-2); }
.wi-dlg__body { flex: 1; min-height: 0; overflow: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; }
.wi-dlg__foot { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 12px; background: var(--surface-2, #2e343f); }
.wi-dlg__spacer { flex: 1; }
.wi-dlg__foot .mat-mdc-button-base mat-icon { margin-right: 4px; }
.wi-num { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--cc-text-2); }
.wi-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 999px; font-size: 11px; line-height: 18px;
  border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); color: var(--cc-text-2); white-space: nowrap; }
.wi-chip mat-icon { font-size: 13px; width: 13px; height: 13px; }
.wi-status { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; white-space: nowrap; }
.wi-status mat-icon { font-size: 15px; width: 15px; height: 15px; }
.wi-spin { animation: wi-spin 1.1s linear infinite; }
@keyframes wi-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .wi-spin { animation: none; } }
.wi-type { width: 16px; height: 16px; flex: none; }
.wi-sec { display: flex; flex-direction: column; gap: 6px; }
.wi-sec__title { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--cc-text-3); margin: 0; }
.wi-muted { color: var(--cc-text-3); }
.wi-md { font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.wi-md p { margin: 0 0 8px; } .wi-md > :last-child { margin-bottom: 0; }
.wi-md a { color: var(--mat-sys-primary); }
.wi-md img { max-width: 100%; }
.wi-md pre { overflow: auto; padding: 8px 10px; border-radius: 8px; background: var(--surface-input, #1a1f28); }
.wi-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.wi-table td { padding: 4px 8px; border-bottom: 1px solid var(--cc-surface-border, rgba(255,255,255,.08)); vertical-align: top; overflow-wrap: anywhere; }
.wi-table td:first-child { width: 30%; color: var(--cc-text-2); white-space: nowrap; }
.wi-links { display: flex; flex-direction: column; gap: 4px; }
.wi-link { display: inline-flex; align-items: center; gap: 6px; color: var(--mat-sys-primary); text-decoration: none; font-size: 12.5px; overflow-wrap: anywhere; }
.wi-link:hover { text-decoration: underline; }
.wi-link mat-icon { font-size: 16px; width: 16px; height: 16px; flex: none; }
.wi-note { display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border-radius: 10px; font-size: 12.5px;
  background: color-mix(in srgb, var(--mat-sys-primary) 8%, transparent); border: 1px solid color-mix(in srgb, var(--mat-sys-primary) 25%, transparent); }
.wi-note mat-icon { font-size: 17px; width: 17px; height: 17px; flex: none; }
.wi-note--warn { background: rgba(210,153,34,.08); border-color: rgba(210,153,34,.3); }
.wi-input, .wi-select, .wi-textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); border-radius: 8px;
  background: var(--surface-input, #1a1f28); color: inherit; font: inherit; font-size: 13px; padding: 7px 9px; }
.wi-textarea { resize: vertical; min-height: 60px; }
.wi-input:focus, .wi-select:focus, .wi-textarea:focus { outline: none; border-color: color-mix(in srgb, var(--mat-sys-primary) 70%, transparent); }
.wi-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.wi-field > span { font-size: 11.5px; color: var(--cc-text-2); }
.wi-tabs { display: flex; gap: 2px; padding: 0 12px; background: var(--surface-2, #2e343f); border-top: 1px solid var(--cc-surface-border, rgba(255,255,255,.08)); flex: none; overflow-x: auto; }
.wi-tab { background: none; border: 0; border-bottom: 2px solid transparent; color: var(--cc-text-2); font: inherit; font-size: 12.5px; padding: 8px 12px; cursor: pointer; white-space: nowrap; }
.wi-tab--on { color: var(--mat-sys-on-surface); border-bottom-color: var(--mat-sys-primary); }
.wi-tab small { opacity: .7; margin-left: 4px; }
.wi-err { color: #f85149; font-size: 12.5px; }
`;
