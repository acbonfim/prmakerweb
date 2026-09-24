import { ChangeDetectorRef, Component, effect, inject, input, model, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EditorModule } from 'primeng/editor';
import { htmlToMd, mdToHtml } from '../../helpers/markdown';

/**
 * Editor WYSIWYG (p-editor/Quill) cujo valor é markdown. O HTML só existe para exibição:
 * mudanças externas no `value` (IA, carga do card, outro editor aberto) re-renderizam o
 * editor; a digitação local converte o HTML de volta para markdown sem re-renderizar
 * (não reposiciona o cursor).
 */
@Component({
  selector: 'app-markdown-editor',
  standalone: true,
  imports: [EditorModule, FormsModule],
  template: `
    @if (loading()) {
      <div class="editor-skeleton" aria-hidden="true">
        <div class="cime-skeleton sk-toolbar"></div>
        @for (w of skeletonLines(); track $index) {
          <div class="cime-skeleton sk-line" [style.width.%]="w"></div>
        }
      </div>
    } @else {
      <p-editor class="panel-editor"
                [(ngModel)]="html"
                (onTextChange)="onTextChange($event)"
                [placeholder]="placeholder()">
        <ng-template pTemplate="header">
          <span class="ql-formats">
            <select class="ql-header">
              <option value="1"></option>
              <option value="2"></option>
              <option value="3"></option>
              <option selected></option>
            </select>
          </span>
          <span class="ql-formats">
            <button class="ql-bold" aria-label="Negrito" type="button"></button>
            <button class="ql-italic" aria-label="Itálico" type="button"></button>
            <button class="ql-strike" aria-label="Tachado" type="button"></button>
          </span>
          <span class="ql-formats">
            <button class="ql-list" value="ordered" aria-label="Lista ordenada" type="button"></button>
            <button class="ql-list" value="bullet" aria-label="Lista" type="button"></button>
            <button class="ql-blockquote" aria-label="Citação" type="button"></button>
            <button class="ql-code-block" aria-label="Código" type="button"></button>
          </span>
          <span class="ql-formats">
            <button class="ql-link" aria-label="Link" type="button"></button>
            <button class="ql-clean" aria-label="Limpar formatação" type="button"></button>
          </span>
        </ng-template>
      </p-editor>
    }
  `,
  styles: [`
    :host {
      flex: 1 1 auto;
      min-height: 0;
      /* Sem isto, a largura mínima de conteúdo do editor impede o painel de encolher
         (lado a lado), o texto transborda à direita e fica inacessível para edição. */
      min-width: 0;
      display: flex;
      flex-direction: column;
    }

    .panel-editor {
      flex: 1 1 auto;
      width: auto;
      min-height: 0;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }

    .editor-skeleton {
      flex: 1 1 auto;
      min-height: 0;
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 10px 12px;
    }

    .editor-skeleton .sk-toolbar { height: 30px; border-radius: 6px; margin-bottom: 6px; }
    .editor-skeleton .sk-line { height: 12px; border-radius: 6px; }

    /* Toolbar no tema escuro do painel */
    :host ::ng-deep .panel-editor .ql-toolbar.ql-snow {
      border: none;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      background: var(--surface-2, #323232);
      border-radius: 0;
    }

    /* Área de conteúdo cresce e rola dentro do painel — mesmo fundo do corpo do painel */
    :host ::ng-deep .panel-editor .p-editor-content {
      flex: 1 1 auto;
      min-height: 0;
      min-width: 0;
      display: flex;
      flex-direction: column;
      background: var(--surface-1, #2a2a2a);
    }

    :host ::ng-deep .panel-editor .ql-container.ql-snow {
      flex: 1 1 auto;
      min-height: 0;
      min-width: 0;
      border: none;
      background: var(--surface-1, #2a2a2a);
      font-family: Roboto, "Helvetica Neue", sans-serif;
      font-size: 13px;
    }

    :host ::ng-deep .panel-editor .ql-editor {
      flex: 1 1 auto;
      overflow-y: auto;
      overflow-x: hidden;
      background: var(--surface-1, #2a2a2a);
      color: var(--mat-sys-on-surface);
      line-height: 1.5;
      /* Quebra o texto/URLs longos para caber na largura do painel (sem scroll lateral) */
      overflow-wrap: anywhere;
      word-break: break-word;
      counter-reset: list-0 list-1 list-2 list-3 list-4 list-5 list-6 list-7 list-8 list-9;
    }

    :host ::ng-deep .panel-editor .ql-editor.ql-blank::before {
      color: color-mix(in srgb, var(--mat-sys-on-surface) 45%, transparent);
      font-style: normal;
    }

    /* Ícones/labels da toolbar visíveis sobre o fundo escuro */
    :host ::ng-deep .panel-editor .ql-snow .ql-stroke { stroke: #cfcfcf; }
    :host ::ng-deep .panel-editor .ql-snow .ql-fill { fill: #cfcfcf; }
    :host ::ng-deep .panel-editor .ql-snow .ql-picker { color: #cfcfcf; }

    :host ::ng-deep .panel-editor .ql-snow.ql-toolbar button:hover .ql-stroke,
    :host ::ng-deep .panel-editor .ql-snow.ql-toolbar button.ql-active .ql-stroke {
      stroke: var(--mat-sys-primary);
    }
    :host ::ng-deep .panel-editor .ql-snow.ql-toolbar button:hover .ql-fill,
    :host ::ng-deep .panel-editor .ql-snow.ql-toolbar button.ql-active .ql-fill {
      fill: var(--mat-sys-primary);
    }
    :host ::ng-deep .panel-editor .ql-snow.ql-toolbar button:hover,
    :host ::ng-deep .panel-editor .ql-snow.ql-toolbar button.ql-active,
    :host ::ng-deep .panel-editor .ql-snow.ql-toolbar .ql-picker-label:hover {
      color: var(--mat-sys-primary);
    }

    /* Dropdown de cabeçalho (picker) no tema escuro */
    :host ::ng-deep .panel-editor .ql-snow .ql-picker-options {
      background: var(--surface-1, #2a2a2a);
      border-color: rgba(255, 255, 255, 0.12);
    }

    /* Marcadores de lista — o Quill 2 renderiza toda lista dentro de <ol> e desenha o
       marcador no .ql-ui::before. Resets globais (Bootstrap) podem deixar a numeração
       nativa do <ol> vazar; desenhamos o marcador no li::before a partir do data-list
       (que o Quill sempre grava) e desligamos o do .ql-ui para não duplicar. */
    :host ::ng-deep .panel-editor .ql-editor ol,
    :host ::ng-deep .panel-editor .ql-editor ul {
      padding-left: 1.5em;
      list-style: none;
    }

    :host ::ng-deep .panel-editor .ql-editor li {
      list-style-type: none;
      padding-left: 1.5em;
      position: relative;
    }

    :host ::ng-deep .panel-editor .ql-editor li > .ql-ui::before { content: none; }

    :host ::ng-deep .panel-editor .ql-editor li::before {
      position: absolute;
      left: 0;
      width: 1.2em;
      margin-left: 0.1em;
      text-align: left;
      white-space: nowrap;
    }

    :host ::ng-deep .panel-editor .ql-editor li[data-list='bullet']::before { content: '\\2022'; }
    :host ::ng-deep .panel-editor .ql-editor li[data-list='ordered'] { counter-increment: list-0; }
    :host ::ng-deep .panel-editor .ql-editor li[data-list='ordered']::before {
      content: counter(list-0, decimal) '. ';
    }
  `]
})
export class MarkdownEditorComponent {
  private cdr = inject(ChangeDetectorRef);

  /** Conteúdo em markdown (null = vazio). */
  readonly value = model<string | null>(null);
  readonly loading = input(false);
  readonly placeholder = input('Ex. It makes me feel...');
  readonly skeletonLines = input<number[]>([94, 82, 88, 70, 90, 58]);

  html = '';

  /** Último markdown produzido pela digitação local — evita re-renderizar o próprio eco. */
  private lastEmitted: string | null | undefined = undefined;

  constructor() {
    effect(() => {
      const markdown = this.value();
      if (markdown === this.lastEmitted) return;
      untracked(() => {
        this.lastEmitted = undefined;
        this.html = mdToHtml(markdown);
        this.cdr.markForCheck();
      });
    });
  }

  onTextChange(event: any): void {
    // Só a digitação do usuário vira markdown; mudanças programáticas (source 'api')
    // já vieram do `value` e reconvertê-las causaria eco entre editores abertos.
    if (event?.source && event.source !== 'user') return;

    const markdown = htmlToMd(event?.htmlValue ?? '');
    this.lastEmitted = markdown;
    this.value.set(markdown);
  }
}
