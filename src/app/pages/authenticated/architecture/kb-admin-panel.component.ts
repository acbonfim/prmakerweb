import { firstValueFrom } from 'rxjs';
import { Component, ElementRef, OnChanges, SimpleChanges, ViewChild, computed, effect, inject, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PlanMarkdownPipe } from '../../../components/execution-plan/plan-markdown.pipe';
import { renderMermaidIn } from '../../../helpers/mermaid-loader';
import {
  ARCHITECTURE_KINDS,
  ArchitectureProject,
  ArchitectureSection,
  ArchitectureSectionBody,
  ArchitectureSectionVersion,
  ArchitectureService,
  ArchitectureSuggestion,
  ChatMessage,
  ChatStatus,
  ECOSYSTEM_GUIDE_EXTRA,
  GUIDE_TEMPLATE,
  SECTION_TEMPLATE
} from '../../../services/architecture.service';

export type KbAdminMode = 'edit' | 'new' | 'history' | 'chat' | 'project';

/**
 * Ferramentas do admin na Base Solvace (0033 F2): editar a seção (markdown com prévia), histórico com restauração,
 * chat "Sugerir melhoria" com o especialista (plugin de IA) e aplicar/descartar a proposta, nova seção pelo template
 * e dados do projeto (resumo e palavras-chave vão para o índice). Toda gravação vira uma versão nova — nada se perde.
 */
@Component({
  selector: 'app-kb-admin-panel',
  standalone: true,
  imports: [NgTemplateOutlet, FormsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, PlanMarkdownPipe],
  template: `
    <div class="ap">
      <div class="ap__head">
        <mat-icon>{{ icon() }}</mat-icon>
        <strong>{{ heading() }}</strong>
        <span class="ap__spacer"></span>
        <button mat-icon-button (click)="closed.emit()" aria-label="Fechar" matTooltip="Fechar (sem salvar)"><mat-icon>close</mat-icon></button>
      </div>

      @switch (mode()) {
        <!-- ── Editar / nova seção ── -->
        @case ('edit') { <ng-container *ngTemplateOutlet="editor"></ng-container> }
        @case ('new') { <ng-container *ngTemplateOutlet="editor"></ng-container> }

        <!-- ── Histórico ── -->
        @case ('history') {
          @if (loading()) { <div class="ap__state"><mat-spinner diameter="22"></mat-spinner></div> }
          @else if (viewing(); as v) {
            <div class="ap__bar">
              <button mat-button (click)="viewing.set(null)"><mat-icon>arrow_back</mat-icon>Versões</button>
              <span class="ap__muted">versão {{ v.version }} · {{ v.createdBy }} · {{ date(v.createdAt) }}{{ v.note ? ' · ' + v.note : '' }}</span>
              <span class="ap__spacer"></span>
              @if (v.version !== section()?.version) {
                <button mat-flat-button color="primary" (click)="restore(v)" [disabled]="saving()"><mat-icon>restore</mat-icon>Restaurar esta versão</button>
              }
            </div>
            <div class="ap__preview" #preview [innerHTML]="(v.content || '') | planMarkdown"></div>
          } @else {
            <div class="ap__list">
              @for (v of versions(); track v.version) {
                <button type="button" class="ap__item" (click)="openVersion(v)">
                  <span class="ap__ver">v{{ v.version }}</span>
                  <span class="ap__item-text">
                    <span>{{ v.note || v.title }}</span>
                    <span class="ap__muted">{{ sourceLabel(v.source) }} · {{ v.createdBy }} · {{ date(v.createdAt) }}</span>
                  </span>
                  @if (v.version === section()?.version) { <span class="ap__chip">atual</span> }
                </button>
              } @empty { <div class="ap__state">Sem versões.</div> }
            </div>
          }
        }

        <!-- ── Chat com o especialista ── -->
        @case ('chat') {
          @if (chatStatus(); as st) {
            @if (!st.available) {
              <div class="ap__warn"><mat-icon>info</mat-icon>Chat indisponível: {{ st.reason }}</div>
            }
          }
          @if (fromSuggestion(); as sg) {
            <div class="ap__source"><mat-icon>lightbulb</mat-icon>Trabalhando a sugestão{{ sg.cardNumber ? ' do card ' + sg.cardNumber : '' }} de {{ sg.createdBy }} — ao aplicar, ela sai da fila.</div>
          }
          <div class="ap__chat" #chatBox>
            @for (m of messages(); track $index) {
              <div class="ap__msg ap__msg--{{ m.role }}">
                <mat-icon>{{ m.role === 'user' ? 'person' : 'smart_toy' }}</mat-icon>
                <div class="ap__bubble" [innerHTML]="m.content | planMarkdown"></div>
              </div>
            } @empty {
              <div class="ap__state ap__muted">Peça uma melhoria para esta seção — ex.: "acrescente o fluxo de aprovação com um diagrama", "revise a parte de dados com as tabelas do módulo".</div>
            }
            @if (thinking()) { <div class="ap__msg ap__msg--assistant"><mat-icon>smart_toy</mat-icon><mat-spinner diameter="18"></mat-spinner></div> }
          </div>
          @if (proposal(); as prop) {
            <div class="ap__proposal">
              <div class="ap__bar"><mat-icon>auto_fix_high</mat-icon><strong>Proposta de nova versão</strong><span class="ap__spacer"></span>
                <button mat-button (click)="proposal.set(null)">Descartar</button>
                <button mat-flat-button color="primary" (click)="applyProposal()" [disabled]="saving()"><mat-icon>check</mat-icon>Aplicar</button>
              </div>
              <div class="ap__preview" #preview [innerHTML]="prop | planMarkdown"></div>
            </div>
          }
          <div class="ap__composer">
            <textarea [(ngModel)]="draft" rows="2" placeholder="Escreva para o especialista… (Ctrl+Enter envia)"
                      [disabled]="thinking() || !chatStatus()?.available" (keydown)="onChatKey($event)"></textarea>
            <button mat-flat-button color="primary" (click)="send()" [disabled]="thinking() || !draft.trim() || !chatStatus()?.available">
              <mat-icon>send</mat-icon>
            </button>
          </div>
        }

        <!-- ── Projeto ── -->
        @case ('project') {
          <div class="ap__form">
            <label>Nome<input [(ngModel)]="pName" /></label>
            <label>Tipo
              <select [(ngModel)]="pKind">@for (k of kinds; track k.kind) { <option [value]="k.kind">{{ k.label }}</option> }</select>
            </label>
            <label>Repositório<input [(ngModel)]="pRepo" placeholder="https://github.com/…" /></label>
            <label>Resumo do índice <span class="ap__muted">({{ pSummary.length }}/2000 — vai inteiro para o índice que a skill lê primeiro)</span>
              <textarea [(ngModel)]="pSummary" rows="5" maxlength="2000"></textarea></label>
            <label>Palavras-chave <span class="ap__muted">(separadas por vírgula — como aparecem nos cards, PT e EN)</span>
              <input [(ngModel)]="pKeywords" /></label>
            <div class="ap__group"><mat-icon>auto_stories</mat-icon>Para pessoas <span class="ap__muted">(modo Simples — não vai para as skills)</span></div>
            <label>Nome amigável <span class="ap__muted">(como o usuário chama, ex.: Plano de Ação)</span>
              <input [(ngModel)]="pDisplayName" maxlength="120" /></label>
            <label>Frase <span class="ap__muted">(o que o sistema faz, em uma frase simples)</span>
              <input [(ngModel)]="pTagline" maxlength="300" /></label>
            <label>Área de negócio <span class="ap__muted">(agrupa legado, revamp e telas do mesmo módulo)</span>
              <input [(ngModel)]="pArea" maxlength="80" /></label>
            <div class="ap__bar"><span class="ap__spacer"></span>
              <button mat-button (click)="closed.emit()">Cancelar</button>
              <button mat-flat-button color="primary" (click)="saveProject()" [disabled]="saving() || !pName.trim()"><mat-icon>save</mat-icon>Salvar</button>
            </div>
          </div>
        }
      }
    </div>

    <ng-template #editor>
      <div class="ap__form">
        @if (mode() === 'new') {
          <label>Seção
            <select [(ngModel)]="newKey" (ngModelChange)="onTemplatePick($event)">
              <optgroup label="Técnicas — lidas pelo Claude nas análises">
                @for (t of availableTemplate(); track t.key) { <option [value]="t.key">{{ t.title }}</option> }
              </optgroup>
              <optgroup label="Guia — linguagem simples, só na tela">
                @for (t of availableGuide(); track t.key) { <option [value]="t.key">{{ t.title }}</option> }
              </optgroup>
              <option value="__custom">Outra (chave própria)…</option>
            </select>
          </label>
          @if (newKey === '__custom') {
            <label>Chave<input [(ngModel)]="customKey" placeholder="ex.: fluxo-aprovacao" /></label>
            <label>Público
              <select [(ngModel)]="customAudience">
                <option value="llm">Técnica — vai para as skills (análise de bugs)</option>
                <option value="human">Guia — linguagem simples, só na tela</option>
              </select>
            </label>
          }
        }
        <label>Título<input [(ngModel)]="title" /></label>
        <div class="ap__bar">
          <button mat-button (click)="showPreview.set(!showPreview())"><mat-icon>{{ showPreview() ? 'edit' : 'visibility' }}</mat-icon>{{ showPreview() ? 'Editar' : 'Prévia' }}</button>
          <span class="ap__muted">markdown · diagramas em \`\`\`mermaid · nunca credenciais</span>
        </div>
        @if (showPreview()) {
          <div class="ap__preview" #preview [innerHTML]="content | planMarkdown"></div>
        } @else {
          <textarea class="ap__md" [(ngModel)]="content" rows="22" spellcheck="false"></textarea>
        }
        <label>O que mudou <span class="ap__muted">(aparece no histórico)</span><input [(ngModel)]="note" placeholder="ex.: acrescentei o job de sincronização" /></label>
        <div class="ap__bar"><span class="ap__spacer"></span>
          <button mat-button (click)="closed.emit()">Cancelar</button>
          <button mat-flat-button color="primary" (click)="saveSection()" [disabled]="saving() || !content.trim() || (mode() === 'new' && !resolvedNewKey())">
            <mat-icon>save</mat-icon>Salvar nova versão
          </button>
        </div>
      </div>
    </ng-template>
  `,
  styles: [`
    :host { display: block; }
    .ap { border: 1px solid color-mix(in srgb, var(--mat-sys-primary) 35%, transparent); border-radius: 10px; padding: 12px 14px; margin: 12px 0;
      background: color-mix(in srgb, var(--mat-sys-primary) 4%, transparent); }
    .ap__head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .ap__head mat-icon { color: var(--mat-sys-primary); }
    .ap__spacer { flex: 1 1 auto; }
    .ap__muted { font-size: 12px; color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent); }
    .ap__bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 8px 0; }
    .ap__state { display: flex; justify-content: center; padding: 16px; font-size: 13px; }
    .ap__form { display: flex; flex-direction: column; gap: 10px; }
    .ap__form label { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; font-weight: 600; }
    .ap__form input, .ap__form select, .ap__form textarea, .ap__composer textarea {
      font: inherit; font-size: 13.5px; font-weight: 400; color: inherit; padding: 8px 10px; border-radius: 8px;
      border: 1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.25); outline: none; }
    .ap__form select option { background: #2a2a2a; }
    .ap__md { font-family: 'JetBrains Mono', 'Courier New', monospace !important; font-size: 12.5px !important; line-height: 1.5; resize: vertical; }
    .ap__preview { padding: 10px 14px; border-radius: 8px; background: rgba(0,0,0,.2); font-size: 14px; line-height: 1.6; max-height: 60vh; overflow: auto; }
    .ap__preview ::ng-deep pre { padding: 8px 10px; border-radius: 6px; background: rgba(0,0,0,.35); overflow-x: auto; }
    .ap__preview ::ng-deep table { border-collapse: collapse; } .ap__preview ::ng-deep th, .ap__preview ::ng-deep td { border: 1px solid rgba(255,255,255,.12); padding: 4px 8px; }
    .ap__list { display: flex; flex-direction: column; gap: 4px; max-height: 50vh; overflow: auto; }
    .ap__item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: none; border-radius: 8px; background: transparent;
      color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .ap__item:hover { background: rgba(255,255,255,.05); }
    .ap__item-text { display: flex; flex-direction: column; flex: 1; min-width: 0; font-size: 13px; }
    .ap__ver { font-weight: 700; font-size: 12px; color: var(--mat-sys-primary); min-width: 32px; }
    .ap__chip { font-size: 11px; padding: 0 8px; border-radius: 9px; background: color-mix(in srgb, var(--mat-sys-primary) 18%, transparent); }
    .ap__chat { display: flex; flex-direction: column; gap: 10px; max-height: 45vh; overflow-y: auto; padding: 4px 2px; }
    .ap__msg { display: flex; gap: 8px; align-items: flex-start; }
    .ap__msg mat-icon { flex: none; font-size: 18px; width: 18px; height: 18px; margin-top: 8px; opacity: .8; }
    .ap__msg--user { flex-direction: row-reverse; }
    .ap__bubble { max-width: 85%; padding: 8px 12px; border-radius: 10px; font-size: 13.5px; line-height: 1.55; background: rgba(255,255,255,.06); overflow-wrap: anywhere; }
    .ap__msg--user .ap__bubble { background: color-mix(in srgb, var(--mat-sys-primary) 16%, transparent); }
    .ap__bubble ::ng-deep p:first-child { margin-top: 0; } .ap__bubble ::ng-deep p:last-child { margin-bottom: 0; }
    .ap__proposal { margin-top: 10px; padding: 8px 10px; border-radius: 8px; border: 1px dashed var(--mat-sys-primary); }
    .ap__composer { display: flex; gap: 8px; align-items: flex-end; margin-top: 10px; }
    .ap__composer textarea { flex: 1; resize: vertical; }
    .ap__warn, .ap__source { display: flex; align-items: center; gap: 6px; font-size: 12.5px; padding: 6px 10px; border-radius: 8px; margin-bottom: 8px; }
    .ap__warn { background: rgba(210,153,34,.14); color: #d29922; }
    .ap__source { background: color-mix(in srgb, var(--mat-sys-primary) 10%, transparent); }
    .ap__warn mat-icon, .ap__source mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .ap__group { display: flex; align-items: center; gap: 6px; margin-top: 6px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,.08); font-size: 13px; font-weight: 700; }
    .ap__group mat-icon { font-size: 17px; width: 17px; height: 17px; color: var(--mat-sys-primary); }
  `]
})
export class KbAdminPanelComponent implements OnChanges {
  private api = inject(ArchitectureService);
  private snackBar = inject(MatSnackBar);

  readonly mode = input.required<KbAdminMode>();
  readonly project = input.required<ArchitectureProject>();
  readonly section = input<ArchitectureSection | null>(null);
  /** Sugestão da fila que abriu o chat (vira a primeira mensagem; resolvida ao aplicar). */
  readonly suggestion = input<ArchitectureSuggestion | null>(null);

  readonly closed = output<void>();
  readonly sectionSaved = output<ArchitectureSection>();
  readonly projectSaved = output<ArchitectureProject>();
  readonly suggestionApplied = output<ArchitectureSuggestion>();

  readonly kinds = ARCHITECTURE_KINDS;
  readonly saving = signal(false);
  readonly loading = signal(false);
  readonly showPreview = signal(false);
  readonly versions = signal<ArchitectureSectionVersion[]>([]);
  readonly viewing = signal<ArchitectureSectionVersion | null>(null);
  readonly messages = signal<ChatMessage[]>([]);
  readonly thinking = signal(false);
  readonly proposal = signal<string | null>(null);
  readonly chatStatus = signal<ChatStatus | null>(null);
  readonly fromSuggestion = signal<ArchitectureSuggestion | null>(null);

  title = '';
  content = '';
  note = '';
  draft = '';
  newKey = '';
  customKey = '';
  pName = '';
  pKind = 'other';
  pRepo = '';
  pSummary = '';
  pKeywords = '';
  pDisplayName = '';
  pTagline = '';
  pArea = '';
  customAudience: 'llm' | 'human' = 'llm';

  @ViewChild('preview') private previewRef?: ElementRef<HTMLElement>;
  @ViewChild('chatBox') private chatRef?: ElementRef<HTMLElement>;

  readonly heading = computed(() => ({
    edit: `Editar — ${this.section()?.title ?? ''}`,
    new: 'Nova seção',
    history: `Histórico — ${this.section()?.title ?? ''}`,
    chat: `Sugerir melhoria — ${this.section()?.title ?? ''}`,
    project: 'Dados do projeto'
  })[this.mode()]);

  readonly icon = computed(() => ({ edit: 'edit', new: 'note_add', history: 'history', chat: 'auto_fix_high', project: 'tune' })[this.mode()]);

  readonly availableTemplate = computed(() => SECTION_TEMPLATE.filter(t => !this.project().sections.some(s => s.key === t.key)));
  /** Seções do Guia que o projeto ainda não tem (0038). */
  readonly availableGuide = computed(() => [...GUIDE_TEMPLATE, ...(this.project().key === 'ecossistema' ? ECOSYSTEM_GUIDE_EXTRA : [])]
    .filter(t => !this.project().sections.some(s => s.key === t.key)));

  constructor() {
    effect(() => {
      this.proposal(); this.viewing(); this.showPreview();
      setTimeout(() => renderMermaidIn(this.previewRef?.nativeElement), 0);
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['mode'] && !changes['section'] && !changes['suggestion']) return;
    const s = this.section();
    const p = this.project();
    this.showPreview.set(false);
    this.viewing.set(null);
    this.proposal.set(null);
    this.note = '';
    switch (this.mode()) {
      case 'edit':
        this.title = s?.title ?? '';
        this.content = s?.content ?? '';
        break;
      case 'new': {
        const first = this.availableTemplate()[0];
        this.newKey = first?.key ?? '__custom';
        this.title = first?.title ?? '';
        this.content = '';
        break;
      }
      case 'history':
        this.loadVersions();
        break;
      case 'chat':
        this.messages.set([]);
        this.fromSuggestion.set(this.suggestion());
        this.draft = this.suggestion()
          ? `Incorpore nesta seção a sugestão abaixo (${this.suggestion()!.kind === 'divergence' ? 'divergência encontrada no código' : 'aprendizado de uma análise'}${this.suggestion()!.cardNumber ? ', card ' + this.suggestion()!.cardNumber : ''}), sem perder o que já está certo:\n\n${this.suggestion()!.content}`
          : '';
        this.api.chatStatus().subscribe({ next: st => this.chatStatus.set(st), error: () => this.chatStatus.set({ available: false, reason: 'não foi possível verificar o plugin de IA' }) });
        break;
      case 'project':
        this.pName = p.name;
        this.pKind = p.kind;
        this.pRepo = p.repository ?? '';
        this.pSummary = p.summary ?? '';
        this.pKeywords = p.keywords.join(', ');
        this.pDisplayName = p.displayName ?? '';
        this.pTagline = p.tagline ?? '';
        this.pArea = p.businessArea ?? '';
        break;
    }
  }

  // ── Editor ──
  onTemplatePick(key: string): void {
    const t = [...SECTION_TEMPLATE, ...GUIDE_TEMPLATE, ...ECOSYSTEM_GUIDE_EXTRA].find(x => x.key === key);
    if (t) this.title = t.title;
  }

  resolvedNewKey(): string | null {
    if (this.newKey !== '__custom') return this.newKey || null;
    const k = this.customKey.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return k || null;
  }

  saveSection(): void {
    const key = this.mode() === 'new' ? this.resolvedNewKey() : this.section()?.key;
    if (!key || !this.content.trim()) return;
    const template = [...SECTION_TEMPLATE, ...GUIDE_TEMPLATE, ...ECOSYSTEM_GUIDE_EXTRA].find(t => t.key === key);
    const order = this.mode() === 'new' ? (template?.order ?? null) : null;
    const audience = this.mode() === 'new'
      ? (this.newKey === '__custom' ? this.customAudience : key.startsWith('guia-') ? 'human' : 'llm')
      : null;
    this.write(key, { title: this.title.trim() || null, content: this.content, order, source: 'admin', audience,
      note: this.note.trim() || (this.mode() === 'new' ? 'seção criada na tela' : 'editada na tela') });
  }

  // ── Histórico ──
  private loadVersions(): void {
    const s = this.section();
    if (!s) return;
    this.loading.set(true);
    this.api.versions(this.project().key, s.key).subscribe({
      next: v => { this.versions.set(v); this.loading.set(false); },
      error: () => { this.versions.set([]); this.loading.set(false); }
    });
  }

  openVersion(v: ArchitectureSectionVersion): void {
    const s = this.section();
    if (!s) return;
    this.loading.set(true);
    this.api.version(this.project().key, s.key, v.version).subscribe({
      next: full => { this.viewing.set(full); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  restore(v: ArchitectureSectionVersion): void {
    const s = this.section();
    if (!s || !v.content) return;
    this.write(s.key, { title: v.title, content: v.content, source: 'admin', note: `restaurada da versão ${v.version}` });
  }

  // ── Chat ──
  onChatKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.send(); }
  }

  send(): void {
    const s = this.section();
    const text = this.draft.trim();
    if (!s || !text || this.thinking()) return;
    const history = [...this.messages(), { role: 'user' as const, content: text }];
    this.messages.set(history);
    this.draft = '';
    this.thinking.set(true);
    this.scrollChat();
    this.api.chat(this.project().key, s.key, history).subscribe({
      next: r => {
        this.thinking.set(false);
        this.messages.update(m => [...m, { role: 'assistant', content: r.reply }]);
        if (r.suggestion) this.proposal.set(r.suggestion);
        this.scrollChat();
      },
      error: err => {
        this.thinking.set(false);
        this.snackBar.open(err?.error?.error ?? 'O especialista não respondeu. Tente de novo.', 'Fechar', { duration: 8000 });
      }
    });
  }

  applyProposal(): void {
    const s = this.section();
    const prop = this.proposal();
    if (!s || !prop) return;
    const ask = this.messages().find(m => m.role === 'user')?.content ?? '';
    const sg = this.fromSuggestion();
    this.write(s.key, { title: s.title, content: prop, source: 'ai',
      note: (sg ? `sugestão ${sg.kind === 'divergence' ? 'de divergência' : 'de aprendizado'}${sg.cardNumber ? ' (card ' + sg.cardNumber + ')' : ''} aplicada com a IA` : `IA: ${ask.replace(/\s+/g, ' ').slice(0, 160)}`) },
      async () => {
        this.proposal.set(null);
        if (!sg) return;
        // 0037: resolve antes de avisar que salvou — ao salvar, a tela fecha este painel e o aviso se perderia.
        try {
          const resolved = await firstValueFrom(this.api.resolveSuggestion(sg.id, 'applied', 'aplicada pelo chat'));
          this.fromSuggestion.set(null);
          this.suggestionApplied.emit(resolved);
        } catch {
          this.snackBar.open('A seção foi salva, mas não consegui marcar a sugestão como aplicada — marque na lista.', 'Fechar', { duration: 8000 });
        }
      });
  }

  private scrollChat(): void {
    setTimeout(() => this.chatRef?.nativeElement.scrollTo({ top: this.chatRef.nativeElement.scrollHeight, behavior: 'smooth' }), 0);
  }

  // ── Projeto ──
  saveProject(): void {
    const p = this.project();
    this.saving.set(true);
    this.api.upsertProject(p.key, {
      name: this.pName.trim(), kind: this.pKind, repository: this.pRepo.trim() || null, summary: this.pSummary.trim() || null,
      keywords: this.pKeywords.split(',').map(k => k.trim()).filter(Boolean), order: p.order,
      displayName: this.pDisplayName.trim(), tagline: this.pTagline.trim(), businessArea: this.pArea.trim()
    }).subscribe({
      next: saved => { this.saving.set(false); this.snackBar.open('Projeto salvo', 'Ok', { duration: 3000 }); this.projectSaved.emit(saved); },
      error: err => { this.saving.set(false); this.snackBar.open(err?.error?.error ?? 'Não foi possível salvar.', 'Fechar', { duration: 8000 }); }
    });
  }

  // ── Comum ──
  private write(key: string, body: ArchitectureSectionBody, after?: () => void | Promise<void>): void {
    this.saving.set(true);
    this.api.writeSection(this.project().key, key, body).subscribe({
      next: saved => {
        this.saving.set(false);
        this.snackBar.open(`Seção salva — versão ${saved.version}`, 'Ok', { duration: 3500 });
        Promise.resolve(after?.()).finally(() => this.sectionSaved.emit(saved));
      },
      error: err => { this.saving.set(false); this.snackBar.open(err?.error?.error ?? 'Não foi possível salvar.', 'Fechar', { duration: 8000 }); }
    });
  }

  sourceLabel(source: string): string {
    return ({ skill: 'skill', admin: 'admin', ai: 'IA' } as Record<string, string>)[source] ?? source;
  }

  date(value?: string | null): string {
    if (!value) return '—';
    const d = new Date(value);
    const p = (n: number) => String(n).padStart(2, '0');
    return isNaN(d.getTime()) ? '—' : `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
}
