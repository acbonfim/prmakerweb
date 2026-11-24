/**
 * 0099 (Mesa de gestão): estilos dos controles do DevOps (campos, painel e diálogo de criar). Entram com
 * `ViewEncapsulation.None` e todos os seletores começam por `.dv-`. Ajustes 1: listas e tags usam o `app-pm-combo`
 * (painel com estilo global `.pm-combo-panel`).
 */
export const DV_FORM_STYLES = `
.dv-input, .dv-select, .dv-textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18));
  border-radius: 8px; background: var(--surface-input, #1a1f28); color: inherit; font: inherit; font-size: 13px; padding: 6px 9px; min-height: 32px; }
.dv-textarea { resize: vertical; min-height: 72px; line-height: 1.45; }
.dv-input:focus, .dv-select:focus, .dv-textarea:focus { outline: none; border-color: color-mix(in srgb, var(--mat-sys-primary) 70%, transparent); }
.dv-input:disabled, .dv-select:disabled, .dv-textarea:disabled { opacity: .6; cursor: not-allowed; }
.dv-input--warn { border-color: rgba(210,153,34,.6); }
.dv-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dv-field__label { font-size: 11.5px; color: var(--cc-text-2); display: flex; align-items: center; gap: 4px; min-width: 0; }
.dv-field__label b { color: #f85149; font-weight: 600; }
.dv-field__label .dv-changed { width: 6px; height: 6px; border-radius: 50%; background: var(--mat-sys-primary); flex: none; }
.dv-field__help { font-size: 11px; color: var(--cc-text-3); }
.dv-hint { font-size: 11px; color: var(--cc-text-3); }
.dv-hint--warn { color: #d29922; }
.dv-err { color: #f85149; font-size: 12.5px; }
.dv-ro { font-size: 13px; color: var(--cc-text-2); padding: 4px 0; overflow-wrap: anywhere; }
.dv-line { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dv-line > .dv-input { flex: 1; min-width: 0; }
.dv-check { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; }
.dv-linkbtn { background: none; border: 0; padding: 0; color: var(--mat-sys-primary); font: inherit; font-size: 12px; cursor: pointer; }
.dv-linkbtn:hover { text-decoration: underline; }
.dv-linkbtn:disabled { color: var(--cc-text-3); cursor: default; text-decoration: none; }
.dv-html { font-size: 13px; line-height: 1.5; padding: 6px 9px; border-radius: 8px; max-height: 260px; overflow: auto;
  border: 1px solid var(--cc-surface-border, rgba(255,255,255,.08)); background: color-mix(in srgb, var(--surface-input, #1a1f28) 60%, transparent); }
.dv-html:empty::before { content: 'Vazio'; color: var(--cc-text-3); }
.dv-html img { max-width: 100%; height: auto; }
.dv-html p { margin: 0 0 6px; }
.dv-html table { border-collapse: collapse; }
.dv-html td, .dv-html th { border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18)); padding: 2px 6px; }
.dv-type-dot { width: 4px; height: 16px; border-radius: 2px; flex: none; }
`;
