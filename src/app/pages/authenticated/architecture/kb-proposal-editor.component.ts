import { Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PlanMarkdownPipe } from '../../../components/execution-plan/plan-markdown.pipe';
import { ArchitectureProject, GUIDE_TEMPLATE, isGuideSection } from '../../../services/architecture.service';
import { friendlyName } from './kb-friendly';

/** Proposta editável (aprender com um card, pergunte a fundo — 0038): para onde vai, para quem e o texto. */
export interface EditableProposal {
  projectKey: string;
  /** Chave da seção (existente ou nova); null = o admin decide. */
  sectionKey: string | null;
  audience: 'llm' | 'human';
  title: string;
  content: string;
  reason?: string | null;
  /** O usuário escolheu "Nova seção" (a chave é digitada). */
  newSection?: boolean;
  selected: boolean;
  preview: boolean;
  status?: 'sending' | 'ok' | 'error';
  error?: string;
}

export function toEditable(p: { projectKey: string; sectionKey?: string | null; audience?: string | null; title?: string | null; content?: string | null; reason?: string | null }): EditableProposal {
  return {
    projectKey: p.projectKey ?? '', sectionKey: p.sectionKey || null, audience: p.audience === 'human' ? 'human' : 'llm',
    title: p.title ?? '', content: p.content ?? '', reason: p.reason ?? null, selected: true, preview: false
  };
}

/**
 * Editor de uma proposta para a base: projeto (select dos projetos), seção (as do projeto, "nova" com chave própria ou
 * "o admin decide"), público (Técnica — vai para as skills / Guia — só na tela), título e texto com prévia.
 */
@Component({
  selector: 'app-kb-proposal-editor',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatTooltipModule, PlanMarkdownPipe],
  template: `
    @let p = proposal();
    <div class="pe" [class.pe--off]="selectable() && !p.selected">
      <div class="pe__row">
        @if (selectable()) {
          <input type="checkbox" class="pe__check" [(ngModel)]="p.selected" (ngModelChange)="changed.emit()" [disabled]="p.status === 'ok'" aria-label="Enviar esta proposta" />
        }
        <input class="pe__title" [(ngModel)]="p.title" (ngModelChange)="changed.emit()" [placeholder]="titleLabel()" [attr.aria-label]="titleLabel()" [disabled]="p.status === 'ok'" />
        @switch (p.status) {
          @case ('sending') { <span class="pe__st">enviando…</span> }
          @case ('ok') { <span class="pe__st pe__st--ok"><mat-icon>check_circle</mat-icon>{{ doneLabel() }}</span> }
          @case ('error') { <span class="pe__st pe__st--bad" [matTooltip]="p.error || ''"><mat-icon>error</mat-icon>falhou</span> }
        }
      </div>
      @if (p.reason) { <div class="pe__reason"><mat-icon>lightbulb</mat-icon><span><strong>Por quê:</strong> {{ p.reason }}</span></div> }
      <div class="pe__grid">
        <label>Sistema
          <select [ngModel]="p.projectKey" (ngModelChange)="setProject($event)" [disabled]="p.status === 'ok'">
            @if (!projectExists()) { <option [value]="p.projectKey">{{ p.projectKey || '(escolha)' }} — ainda não está na base</option> }
            @for (x of sortedProjects(); track x.key) { <option [value]="x.key">{{ label(x) }}</option> }
          </select>
        </label>
        <label>Seção
          <select [ngModel]="sectionChoice()" (ngModelChange)="setSection($event)" [disabled]="p.status === 'ok'">
            @if (allowNoSection()) { <option value="">O administrador decide</option> }
            @if (techOptions().length) {
              <optgroup label="Técnicas">@for (s of techOptions(); track s.key) { <option [value]="s.key">{{ s.title }}</option> }</optgroup>
            }
            @if (guideOptions().length) {
              <optgroup label="Guia">@for (s of guideOptions(); track s.key) { <option [value]="s.key">{{ s.title }}{{ s.exists ? '' : ' (nova)' }}</option> }</optgroup>
            }
            <option value="__new">Nova seção (chave própria)…</option>
          </select>
        </label>
        @if (sectionChoice() === '__new') {
          <label>Chave da nova seção
            <input [ngModel]="p.sectionKey ?? ''" (ngModelChange)="setNewKey($event)" placeholder="ex.: fluxo-aprovacao ou guia-login" [disabled]="p.status === 'ok'" />
          </label>
        }
        <div class="pe__aud" role="radiogroup" aria-label="Público">
          <span>Público</span>
          <button type="button" role="radio" [attr.aria-checked]="p.audience === 'llm'" [class.on]="p.audience === 'llm'" (click)="setAudience('llm')" [disabled]="p.status === 'ok'"
                  matTooltip="Técnica: vai para as skills (o Claude lê nas análises)"><mat-icon>code</mat-icon>Técnica</button>
          <button type="button" role="radio" [attr.aria-checked]="p.audience === 'human'" [class.on]="p.audience === 'human'" (click)="setAudience('human')" [disabled]="p.status === 'ok'"
                  matTooltip="Guia: linguagem simples, só na tela (QA, gestores, suporte)"><mat-icon>menu_book</mat-icon>Guia</button>
        </div>
      </div>
      <div class="pe__bar">
        <span class="pe__muted">markdown</span>
        <span class="pe__spacer"></span>
        <button mat-button type="button" (click)="p.preview = !p.preview; changed.emit()"><mat-icon>{{ p.preview ? 'edit' : 'visibility' }}</mat-icon>{{ p.preview ? 'Editar' : 'Prévia' }}</button>
      </div>
      @if (p.preview) {
        <div class="pe__preview" [innerHTML]="p.content | planMarkdown"></div>
      } @else {
        <textarea class="pe__md" [(ngModel)]="p.content" (ngModelChange)="changed.emit()" [rows]="rows()" aria-label="Texto" [disabled]="p.status === 'ok'"></textarea>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .pe { border: 1px solid rgba(255,255,255,.1); border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; background: rgba(255,255,255,.02); transition: opacity .15s; }
    .pe--off { opacity: .55; }
    .pe__row { display: flex; align-items: center; gap: 8px; }
    .pe__check { width: 17px; height: 17px; flex: none; accent-color: var(--mat-sys-primary); }
    .pe__title { flex: 1; min-width: 0; font-weight: 600 !important; }
    input, select, textarea { font: inherit; font-size: 13.5px; color: inherit; padding: 7px 10px; border-radius: 8px;
      border: 1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.25); outline: none; min-width: 0; }
    input:focus, select:focus, textarea:focus { border-color: color-mix(in srgb, var(--mat-sys-primary) 70%, transparent); }
    select option, select optgroup { background: #2a2a2a; }
    .pe__st { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; opacity: .8; white-space: nowrap; }
    .pe__st mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .pe__st--ok { color: #3fb950; opacity: 1; } .pe__st--bad { color: var(--mat-sys-error, #f2b8b5); opacity: 1; cursor: help; }
    .pe__reason { display: flex; align-items: flex-start; gap: 6px; margin: 8px 0 0; font-size: 12.5px; line-height: 1.45; color: color-mix(in srgb, var(--mat-sys-on-surface) 75%, transparent); }
    .pe__reason mat-icon { flex: none; font-size: 16px; width: 16px; height: 16px; color: #e3b341; }
    .pe__grid { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: flex-end; margin-top: 10px; }
    .pe__grid label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; font-weight: 600; flex: 1 1 200px; min-width: 0; }
    .pe__aud { display: flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; flex-wrap: wrap; }
    .pe__aud span { margin-right: 4px; }
    .pe__aud button { display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,.14);
      background: transparent; color: inherit; font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer; }
    .pe__aud button mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .pe__aud button.on { border-color: var(--mat-sys-primary); color: var(--mat-sys-primary); background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent); }
    .pe__bar { display: flex; align-items: center; gap: 6px; margin: 6px 0 2px; }
    .pe__spacer { flex: 1 1 auto; }
    .pe__muted { font-size: 11.5px; opacity: .55; }
    .pe__md { width: 100%; box-sizing: border-box; resize: vertical; line-height: 1.5; }
    .pe__preview { padding: 8px 12px; border-radius: 8px; background: rgba(0,0,0,.2); font-size: 14px; line-height: 1.6; max-height: 45vh; overflow: auto; overflow-wrap: anywhere; }
    .pe__preview ::ng-deep table { border-collapse: collapse; } .pe__preview ::ng-deep th, .pe__preview ::ng-deep td { border: 1px solid rgba(255,255,255,.12); padding: 4px 8px; }
    @media (prefers-reduced-motion: reduce) { .pe { transition: none; } }
  `]
})
export class KbProposalEditorComponent {
  readonly proposal = input.required<EditableProposal>();
  readonly projects = input<ArchitectureProject[]>([]);
  readonly titleLabel = input('Título');
  readonly selectable = input(true);
  readonly allowNoSection = input(true);
  readonly doneLabel = input('enviada');
  readonly rows = input(7);
  readonly changed = output<void>();

  readonly sortedProjects = computed(() => [...this.projects()].sort((a, b) => this.label(a).localeCompare(this.label(b))));

  label(p: ArchitectureProject): string {
    const friendly = friendlyName(p);
    return friendly === p.name ? p.name : `${friendly} (${p.name})`;
  }

  projectExists(): boolean {
    return this.projects().some(x => x.key === this.proposal().projectKey);
  }

  private current(): ArchitectureProject | undefined {
    return this.projects().find(x => x.key === this.proposal().projectKey);
  }

  techOptions() {
    return (this.current()?.sections ?? []).filter(s => !isGuideSection(s)).map(s => ({ key: s.key, title: s.title }));
  }

  /** Seções do Guia que existem + as do template que ainda não existem (podem ser criadas pela sugestão). */
  guideOptions() {
    const sections = this.current()?.sections ?? [];
    const existing = sections.filter(isGuideSection).map(s => ({ key: s.key, title: s.title, exists: true }));
    const missing = GUIDE_TEMPLATE.filter(t => !sections.some(s => s.key === t.key)).map(t => ({ key: t.key, title: t.title, exists: false }));
    return [...existing, ...missing];
  }

  sectionChoice(): string {
    const key = this.proposal().sectionKey;
    if (this.proposal().newSection) return '__new';
    if (!key) return this.allowNoSection() ? '' : '__new';
    const known = this.techOptions().some(s => s.key === key) || this.guideOptions().some(s => s.key === key);
    return known ? key : '__new';
  }

  setProject(key: string): void {
    const p = this.proposal();
    p.projectKey = key;
    // A seção escolhida pode não existir no outro projeto: mantém só se existir lá (ou é do Guia/nova).
    if (!p.newSection && p.sectionKey && !p.sectionKey.startsWith('guia-') && !this.techOptions().some(s => s.key === p.sectionKey)) p.sectionKey = this.allowNoSection() ? null : p.sectionKey;
    this.changed.emit();
  }

  setSection(value: string): void {
    const p = this.proposal();
    const wasUnknown = this.sectionChoice() === '__new';
    p.newSection = value === '__new';
    if (value === '__new') p.sectionKey = wasUnknown ? p.sectionKey : '';
    else p.sectionKey = value || null;
    if (p.sectionKey?.startsWith('guia-')) p.audience = 'human';
    else if (value && value !== '__new' && this.techOptions().some(s => s.key === value)) p.audience = 'llm';
    this.changed.emit();
  }

  setNewKey(value: string): void {
    const p = this.proposal();
    p.sectionKey = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+/, '');
    if (p.sectionKey.startsWith('guia-')) p.audience = 'human';
    this.changed.emit();
  }

  setAudience(a: 'llm' | 'human'): void {
    this.proposal().audience = a;
    this.changed.emit();
  }
}
