import { Component, ElementRef, effect, inject, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { itemStatusLook } from '../work-items/work-item.model';
import { ComposerSuggestion } from './composer-suggest';

/**
 * 0090: lista de sugestões do compositor do Especialista — comandos e ferramentas (`/`) ou itens de trabalho (`#`).
 * Fica sobre o campo (quem hospeda posiciona o `:host`); o teclado é do campo (↑/↓, Enter/Tab, Esc) e o mouse escolhe
 * com `mousedown` (o campo não perde o foco).
 */
@Component({
  selector: 'app-composer-suggest',
  standalone: true,
  imports: [MatIconModule],
  template: `
    <div class="cs" role="listbox" [attr.aria-label]="heading()">
      <div class="cs__head">{{ heading() }}@if (loading()) { <span class="cs__spin"></span> }</div>
      @for (s of suggestions(); track s.id; let i = $index) {
        <button type="button" role="option" class="cs__opt cs__opt--{{ s.kind }}" [class.cs__opt--on]="i === active()" [attr.aria-selected]="i === active()"
                [attr.data-i]="i" (mousedown)="$event.preventDefault(); picked.emit(s)" (mouseenter)="hovered.emit(i)">
          <mat-icon class="cs__ico" [style.color]="s.color || null">{{ s.icon }}</mat-icon>
          <span class="cs__main">
            <span class="cs__label">{{ s.label }}
              @if (s.title) { <small class="cs__title">{{ s.title }}</small> }
              @if (s.kind === 'item' && s.status) { <small class="cs__status" [style.color]="look(s.status).color">{{ look(s.status).label }}</small> }
              @if (s.otherCard) { <small class="cs__card">card {{ s.otherCard }}</small> }
            </span>
            <span class="cs__detail">{{ s.detail }}</span>
          </span>
        </button>
      }
      <div class="cs__foot">↑↓ navegar · Enter/Tab escolher · Esc fechar</div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .cs { max-height: var(--cs-max, min(46vh, 340px)); overflow: auto; background: #161b22; border: 1px solid #30363d; border-radius: 10px;
      box-shadow: 0 12px 32px rgba(0,0,0,.5); padding: 4px; font-size: 12.5px; color: #e6edf3; }
    .cs__head { display: flex; align-items: center; gap: 6px; padding: 4px 8px 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #8b949e; }
    .cs__opt { display: flex; align-items: flex-start; gap: 8px; width: 100%; padding: 6px 8px; border: 0; border-radius: 7px; background: none;
      color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .cs__opt--on { background: rgba(88,166,255,.14); }
    .cs__opt--info { cursor: default; color: #8b949e; }
    .cs__ico { flex: none; font-size: 18px; width: 18px; height: 18px; margin-top: 1px; color: #8b949e; }
    .cs__opt--command .cs__ico { color: #d2a8ff; }
    .cs__opt--item .cs__ico { color: #79c0ff; }
    .cs__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .cs__label { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; font-weight: 600; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
    .cs__title, .cs__status, .cs__card { font-family: var(--mat-sys-body-medium-font, inherit); font-weight: 500; font-size: 11px; color: #8b949e; }
    .cs__card { color: #d29922; }
    .cs__detail { color: #9aa4b2; font-size: 12px; line-height: 1.35; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .cs__opt--item .cs__detail { color: #e6edf3; }
    .cs__foot { padding: 6px 8px 2px; font-size: 10.5px; color: #6e7681; border-top: 1px solid #21262d; margin-top: 4px; }
    .cs__spin { width: 10px; height: 10px; border-radius: 50%; border: 2px solid #30363d; border-top-color: #58a6ff; animation: cs-spin .8s linear infinite; }
    @keyframes cs-spin { to { transform: rotate(360deg); } }
  `]
})
export class ComposerSuggestComponent {
  readonly suggestions = input<ComposerSuggestion[]>([]);
  readonly active = input(0);
  readonly heading = input('Sugestões');
  readonly loading = input(false);
  readonly picked = output<ComposerSuggestion>();
  readonly hovered = output<number>();

  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    // A opção ativa (teclado) fica visível na lista.
    effect(() => {
      const i = this.active();
      queueMicrotask(() => this.host.nativeElement.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' }));
    });
  }

  look(status: string) {
    return itemStatusLook(status);
  }
}
