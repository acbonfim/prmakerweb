import { Component, inject, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';

/** 0056: comando para rodar no Claude Code, com o botão de copiar (todo comando que a tela mostra usa este componente). */
@Component({
  selector: 'app-copy-command',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule],
  template: `
    <span class="cc" [class.cc--block]="block()">
      @if (icon()) { <mat-icon class="cc__icon">{{ icon() }}</mat-icon> }
      @if (label()) { <span class="cc__label">{{ label() }}</span> }
      <code>{{ command() }}</code>
      <button type="button" (click)="copy()" matTooltip="Copiar" aria-label="Copiar comando"><mat-icon>content_copy</mat-icon></button>
    </span>
  `,
  styles: [`
    .cc { display: inline-flex; align-items: center; gap: 6px; padding: 2px 4px 2px 8px; border-radius: 6px; background: rgba(0,0,0,.3);
      max-width: 100%; vertical-align: middle; }
    .cc--block { display: flex; margin: 4px 0; max-width: 760px; }
    .cc code { flex: 1; min-width: 0; overflow-x: auto; white-space: nowrap; font-family: 'JetBrains Mono', monospace; font-size: 12.5px; }
    .cc button { border: none; background: transparent; color: inherit; cursor: pointer; opacity: .7; display: inline-flex; padding: 2px; }
    .cc button:hover { opacity: 1; }
    .cc mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .cc__label { font-size: 12px; opacity: .75; white-space: nowrap; }
  `]
})
export class ReCopyCommandComponent {
  private snack = inject(MatSnackBar);
  command = input.required<string>();
  label = input<string>('');
  icon = input<string>('');
  /** Em linha própria (lista de comandos) em vez de dentro do texto. */
  block = input(false);

  copy() {
    const text = this.command();
    navigator.clipboard?.writeText(text).then(
      () => this.snack.open('Copiado — cole no Claude Code aberto na pasta do módulo', 'OK', { duration: 2500 }),
      () => this.snack.open(text, 'OK', { duration: 6000 }));
  }
}
