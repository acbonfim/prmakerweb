/**
 * 0085 rodada 3: estilos dos controles dos parâmetros (autocompletes do editor de itens). Entram com
 * `ViewEncapsulation.None` e todos os seletores começam por `.wip-` (o painel do autocomplete fica no overlay).
 * Os campos usam as classes `.wi-input`/`.wi-select`/`.wi-textarea` do modal.
 */
export const PICKER_STYLES = `
.wip { position: relative; display: flex; flex-direction: column; gap: 4px; min-width: 0; width: 100%; }
.wip__line { display: flex; align-items: center; gap: 6px; min-width: 0; }
.wip__line > .wi-input, .wip__line > .wi-select { flex: 1; min-width: 0; }
.wip__ico { font-size: 17px; width: 17px; height: 17px; color: var(--cc-text-3); flex: none; }
.wip__link { display: inline-flex; color: var(--cc-text-3); flex: none; }
.wip__link:hover { color: var(--mat-sys-primary); }
.wip__link mat-icon { font-size: 16px; width: 16px; height: 16px; }
.wip__hint { font-size: 11px; color: var(--cc-text-3); }
.wip__hint--warn { color: #d29922; }
.wip-panel.mat-mdc-autocomplete-panel { max-height: 300px; }
.wip-panel .mat-mdc-option { min-height: 34px; font-size: 13px; }
.wip-panel .mdc-list-item__primary-text { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; }
.wip-opt__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wip-opt__hint { font-size: 11px; color: var(--cc-text-3); white-space: nowrap; }
.wip-tag { font-size: 10px; line-height: 16px; padding: 0 6px; border-radius: 999px; white-space: nowrap; flex: none;
  border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); color: var(--cc-text-2); }
.wip-tag--fluxo, .wip-tag--sugerido { color: #3fb950; border-color: rgba(63,185,80,.45); }
.wip-tag--regra, .wip-tag--card { color: var(--mat-sys-primary); border-color: color-mix(in srgb, var(--mat-sys-primary) 50%, transparent); }
.wip-tag--atual { color: #d29922; border-color: rgba(210,153,34,.45); }
.wip-panel .wip-opt--status { opacity: .75; font-size: 12px; }
.wip-commits { display: flex; flex-direction: column; gap: 6px; }
.wip-commits__mode { display: flex; flex-wrap: wrap; gap: 12px; font-size: 12.5px; }
.wip-commits__mode label { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
.wip-commits__list { max-height: 210px; overflow: auto; display: flex; flex-direction: column; border-radius: 8px;
  border: 1px solid var(--cc-surface-border, rgba(255,255,255,.08)); }
.wip-commit { display: flex; align-items: flex-start; gap: 8px; padding: 5px 8px; cursor: pointer; font-size: 12.5px;
  border-bottom: 1px solid var(--cc-surface-border, rgba(255,255,255,.06)); }
.wip-commit:last-child { border-bottom: 0; }
.wip-commit:hover { background: color-mix(in srgb, var(--mat-sys-primary) 6%, transparent); }
.wip-commit input { margin-top: 2px; }
.wip-commit__main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.wip-commit__title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wip-commit__meta { font-size: 11px; color: var(--cc-text-3); }
.wip-commit__sha { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--cc-text-2); }
`;
