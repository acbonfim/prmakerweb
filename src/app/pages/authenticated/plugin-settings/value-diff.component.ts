import { Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { JSON_TYPES, collapseDiff, isShortValue, lineDiff, prettyJson } from './plugin-settings.logic';

/**
 * Antes → depois de um valor (0086): curto numa linha; longo/JSON em diff por linhas (linhas incluídas/removidas
 * destacadas, trechos iguais recolhidos). Segredo mostra só "alterado".
 */
@Component({
  selector: 'app-setting-value-diff',
  standalone: true,
  imports: [MatIconModule],
  template: `
    @if (secret()) {
      <span class="vd__secret"><mat-icon>lock</mat-icon>{{ removed() ? 'removido' : 'alterado (o valor não é mostrado)' }}</span>
    } @else if (removed()) {
      <span class="vd__inline"><span class="vd__old">{{ show(before()) }}</span><mat-icon>arrow_forward</mat-icon><em>chave removida</em></span>
    } @else if (short()) {
      <span class="vd__inline">
        <span class="vd__old">{{ show(before()) }}</span>
        <mat-icon>arrow_forward</mat-icon>
        <span class="vd__new">{{ show(after()) }}</span>
      </span>
    } @else {
      <div class="vd__stats">{{ stats().add }} linha(s) incluída(s) · {{ stats().del }} removida(s)
        @if (before() === null) { · a chave não existia }</div>
      <pre class="vd__diff">@for (l of lines(); track $index) {<div [class]="'vd__line vd__line--' + l.type">@if (l.type === 'skip') {⋯ {{ l.text }} ⋯} @else {<span class="vd__sign">{{ l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' ' }}</span>{{ l.text }}}</div>}</pre>
    }
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .vd__inline { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 6px; font-family: 'JetBrains Mono', monospace; font-size: 12.5px; }
    .vd__inline mat-icon { font-size: 16px; width: 16px; height: 16px; opacity: .6; }
    .vd__old { padding: 1px 6px; border-radius: 4px; background: rgba(248, 81, 73, .14); text-decoration: line-through; text-decoration-color: rgba(248, 81, 73, .6); }
    .vd__new { padding: 1px 6px; border-radius: 4px; background: rgba(63, 185, 80, .16); }
    .vd__secret { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: #d29922; }
    .vd__secret mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .vd__stats { font-size: 11.5px; margin-bottom: 4px; color: color-mix(in srgb, var(--mat-sys-on-surface) 60%, transparent); }
    .vd__diff { margin: 0; max-height: 320px; overflow: auto; padding: 6px 0; border-radius: 8px; font-family: 'JetBrains Mono', monospace;
      font-size: 12px; line-height: 1.5; border: 1px solid rgba(255, 255, 255, .08); background: var(--surface-input, #1a1f28); }
    .vd__line { white-space: pre; padding: 0 10px 0 4px; }
    .vd__sign { display: inline-block; width: 16px; user-select: none; }
    .vd__line--add { background: rgba(63, 185, 80, .14); }
    .vd__line--add .vd__sign { color: #3fb950; }
    .vd__line--del { background: rgba(248, 81, 73, .14); }
    .vd__line--del .vd__sign { color: #f85149; }
    .vd__line--skip { text-align: center; font-style: italic; color: color-mix(in srgb, var(--mat-sys-on-surface) 45%, transparent); }
  `],
})
export class SettingValueDiffComponent {
  readonly before = input<string | null>(null);
  readonly after = input<string | null>(null);
  readonly type = input<string>('text');
  readonly secret = input(false);
  readonly removed = input(false);

  readonly short = computed(() => isShortValue(this.before()) && isShortValue(this.after()) && !JSON_TYPES.has(this.type()));

  readonly full = computed(() => {
    const json = JSON_TYPES.has(this.type());
    const b = this.before();
    const a = this.after();
    return lineDiff(json ? prettyJson(b) : b, json ? prettyJson(a) : a);
  });

  readonly lines = computed(() => collapseDiff(this.full(), 3));
  readonly stats = computed(() => ({
    add: this.full().filter(l => l.type === 'add').length,
    del: this.full().filter(l => l.type === 'del').length,
  }));

  show(v: string | null): string {
    if (v === null) return '(não existia)';
    return v === '' ? '(vazio)' : v;
  }
}
