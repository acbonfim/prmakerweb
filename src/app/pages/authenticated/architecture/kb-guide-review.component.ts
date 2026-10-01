import { firstValueFrom } from 'rxjs';
import { Component, ElementRef, OnDestroy, OnInit, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription } from 'rxjs';
import { PlanMarkdownPipe } from '../../../components/execution-plan/plan-markdown.pipe';
import { renderMermaidIn } from '../../../helpers/mermaid-loader';
import { ArchitectureProject, ArchitectureService, ChatStatus, isGuideSection } from '../../../services/architecture.service';
import { friendlyName } from './kb-friendly';

interface ReviewSection {
  key: string;
  title: string;
  order: number;
  content: string;
  selected: boolean;
  preview: boolean;
  /** Já existe no projeto (a aplicação vira uma versão nova). */
  existingVersion?: number | null;
  existingIsTech?: boolean;
  status?: 'saving' | 'ok' | 'error';
  error?: string;
}

/**
 * "Gerar guia com a IA" (0038 F3, admin): a IA lê as seções técnicas, as ligações e os artigos do KC e propõe o Guia
 * (seções em linguagem simples) e os dados amigáveis do projeto. Nada é gravado sem o admin revisar: cada seção pode
 * ser editada e marcada; "Aplicar selecionadas" grava com público Guia (source ai) e o projeto com os dados aceitos.
 */
@Component({
  selector: 'app-kb-guide-review',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, PlanMarkdownPipe],
  template: `
    <div class="gr">
      <div class="gr__head">
        <mat-icon>auto_stories</mat-icon>
        <strong>Gerar guia com a IA — {{ name() }}</strong>
        <span class="gr__spacer"></span>
        <button mat-icon-button (click)="close()" aria-label="Fechar" matTooltip="Fechar (sem gravar)"><mat-icon>close</mat-icon></button>
      </div>

      @if (step() === 'form') {
        <p class="gr__muted">A IA lê as seções técnicas, as ligações e as regras do Knowledge Center deste sistema e escreve o
          <strong>Guia</strong> em linguagem simples (para QA, gestores e suporte). Nada é gravado sem você revisar — e o Guia
          não vai para as skills.</p>
        @if (status(); as st) {
          @if (!st.available) { <div class="gr__warn"><mat-icon>info</mat-icon>IA indisponível: {{ st.reason }}</div> }
        }
        <label class="gr__label">Instruções para a IA <span class="gr__muted">(opcional)</span>
          <textarea [(ngModel)]="instructions" rows="3" placeholder="Ex.: dê mais exemplos do fluxo de aprovação; explique o que acontece quando o e-mail falha"></textarea>
        </label>
        <div class="gr__bar"><span class="gr__spacer"></span>
          <button mat-button (click)="close()">Cancelar</button>
          <button mat-flat-button color="primary" (click)="generate()" [disabled]="status()?.available === false"><mat-icon>auto_awesome</mat-icon>Gerar guia</button>
        </div>
      } @else if (step() === 'loading') {
        <div class="gr__thinking" aria-live="polite">
          <span class="gr__dots"><i></i><i></i><i></i></span>
          <div><strong>{{ loadingMessage() }}</strong><span>{{ elapsed() }} s — costuma levar de 20 a 60 segundos</span></div>
          <span class="gr__spacer"></span>
          <button mat-button (click)="cancel()">Cancelar</button>
        </div>
      } @else if (step() === 'error') {
        <div class="gr__error"><mat-icon>error_outline</mat-icon>{{ error() }}</div>
        <div class="gr__bar"><span class="gr__spacer"></span>
          <button mat-button (click)="close()">Fechar</button>
          <button mat-stroked-button (click)="step.set('form')"><mat-icon>refresh</mat-icon>Tentar de novo</button>
        </div>
      } @else {
        <div class="gr__meta">
          @if (provider()) { <span class="gr__badge">{{ provider() }}</span> }
          <span>{{ selectedCount() }} de {{ sections().length }} seções marcadas</span>
          <span class="gr__spacer"></span>
          <button mat-button (click)="step.set('form')"><mat-icon>refresh</mat-icon>Gerar de novo</button>
        </div>
        @if (notes()) { <div class="gr__note"><mat-icon>sticky_note_2</mat-icon><span>{{ notes() }}</span></div> }

        <fieldset class="gr__friendly">
          <legend><label><input type="checkbox" [(ngModel)]="applyFriendly" /> Dados amigáveis do projeto</label></legend>
          <label class="gr__label">Nome amigável <span class="gr__muted">(atual: {{ project().displayName || '—' }})</span>
            <input [(ngModel)]="displayName" maxlength="120" [disabled]="!applyFriendly" /></label>
          <label class="gr__label">Frase para leigos <span class="gr__muted">({{ tagline.length }}/300)</span>
            <textarea [(ngModel)]="tagline" rows="2" maxlength="300" [disabled]="!applyFriendly"></textarea></label>
          <label class="gr__label">Área de negócio <span class="gr__muted">(atual: {{ project().businessArea || '—' }})</span>
            <input [(ngModel)]="businessArea" maxlength="80" list="gr-areas" [disabled]="!applyFriendly" />
            <datalist id="gr-areas">@for (a of areas(); track a) { <option [value]="a"></option> }</datalist></label>
        </fieldset>

        @for (s of sections(); track s.key) {
          <div class="gr__sec" [class.gr__sec--off]="!s.selected">
            <div class="gr__sec-head">
              <label class="gr__check"><input type="checkbox" [(ngModel)]="s.selected" (ngModelChange)="refresh()" [attr.aria-label]="'Aplicar ' + s.title" /></label>
              <input class="gr__title" [(ngModel)]="s.title" aria-label="Título da seção" />
              <code>{{ s.key }}</code>
              @if (s.existingVersion) {
                <span class="gr__chip gr__chip--warn" [matTooltip]="s.existingIsTech ? 'Já existe uma seção TÉCNICA com esta chave — aplicar troca o conteúdo dela' : 'Já existe — aplicar cria a versão ' + (s.existingVersion + 1)">
                  substitui v{{ s.existingVersion }}</span>
              } @else { <span class="gr__chip">nova</span> }
              @switch (s.status) {
                @case ('saving') { <mat-spinner diameter="16"></mat-spinner> }
                @case ('ok') { <mat-icon class="gr__ok">check_circle</mat-icon> }
                @case ('error') { <mat-icon class="gr__bad" [matTooltip]="s.error || ''">error</mat-icon> }
              }
              <span class="gr__spacer"></span>
              <button mat-button (click)="s.preview = !s.preview; refresh()"><mat-icon>{{ s.preview ? 'edit' : 'visibility' }}</mat-icon>{{ s.preview ? 'Editar' : 'Prévia' }}</button>
            </div>
            @if (s.preview) {
              <div class="gr__preview" [innerHTML]="s.content | planMarkdown"></div>
            } @else {
              <textarea class="gr__md" [(ngModel)]="s.content" rows="10" spellcheck="true" [attr.aria-label]="'Texto de ' + s.title"></textarea>
            }
          </div>
        } @empty {
          <div class="gr__muted">A IA não propôs seções.</div>
        }

        <div class="gr__bar"><span class="gr__spacer"></span>
          <button mat-button (click)="close()" [disabled]="saving()">Cancelar</button>
          <button mat-flat-button color="primary" (click)="apply()" [disabled]="saving() || (!selectedCount() && !applyFriendly)">
            <mat-icon>done_all</mat-icon>Aplicar selecionadas
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .gr { border: 1px solid color-mix(in srgb, var(--mat-sys-primary) 40%, transparent); border-radius: 10px; padding: 12px 14px; margin: 12px 0;
      background: color-mix(in srgb, var(--mat-sys-primary) 5%, transparent); }
    .gr__head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .gr__head mat-icon { color: var(--mat-sys-primary); }
    .gr__spacer { flex: 1 1 auto; }
    .gr__muted { font-size: 12.5px; color: color-mix(in srgb, var(--mat-sys-on-surface) 60%, transparent); font-weight: 400; }
    p.gr__muted { font-size: 13px; line-height: 1.5; margin: 0 0 10px; }
    .gr__bar, .gr__meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 10px 0 0; }
    .gr__meta { margin: 0 0 8px; font-size: 12.5px; }
    .gr__label { display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; font-weight: 600; margin-bottom: 8px; }
    input, textarea { font: inherit; font-size: 13.5px; font-weight: 400; color: inherit; padding: 8px 10px; border-radius: 8px;
      border: 1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.25); outline: none; }
    input:focus, textarea:focus { border-color: color-mix(in srgb, var(--mat-sys-primary) 70%, transparent); }
    input[type=checkbox] { padding: 0; width: 16px; height: 16px; accent-color: var(--mat-sys-primary); }
    input:disabled, textarea:disabled { opacity: .5; }
    .gr__warn, .gr__note, .gr__error { display: flex; align-items: flex-start; gap: 6px; font-size: 12.5px; padding: 6px 10px; border-radius: 8px; margin-bottom: 8px; }
    .gr__warn { background: rgba(210,153,34,.14); color: #d29922; }
    .gr__note { background: rgba(255,255,255,.05); }
    .gr__error { color: var(--mat-sys-error, #f2b8b5); background: rgba(242,184,181,.08); }
    .gr__warn mat-icon, .gr__note mat-icon, .gr__error mat-icon { font-size: 17px; width: 17px; height: 17px; flex: none; }
    .gr__badge { font-size: 11px; padding: 0 8px; border-radius: 9px; background: rgba(255,255,255,.08); }
    .gr__friendly { border: 1px solid rgba(255,255,255,.1); border-radius: 8px; padding: 8px 12px 2px; margin: 0 0 12px; }
    .gr__friendly legend label { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; padding: 0 4px; }
    .gr__sec { border: 1px solid rgba(255,255,255,.1); border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; transition: opacity .15s; }
    .gr__sec--off { opacity: .55; }
    .gr__sec-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
    .gr__sec-head code { font-size: 11.5px; opacity: .7; }
    .gr__check { display: inline-flex; }
    .gr__title { flex: 1 1 220px; min-width: 0; font-weight: 600; }
    .gr__chip { font-size: 11px; padding: 0 8px; border-radius: 9px; background: color-mix(in srgb, var(--mat-sys-primary) 18%, transparent); }
    .gr__chip--warn { background: rgba(210,153,34,.16); color: #d29922; cursor: help; }
    .gr__ok { color: #3fb950; } .gr__bad { color: var(--mat-sys-error, #f2b8b5); cursor: help; }
    .gr__md { width: 100%; box-sizing: border-box; resize: vertical; line-height: 1.5; }
    .gr__preview { padding: 8px 12px; border-radius: 8px; background: rgba(0,0,0,.2); font-size: 14px; line-height: 1.6; max-height: 50vh; overflow: auto; overflow-wrap: anywhere; }
    .gr__preview ::ng-deep table { border-collapse: collapse; } .gr__preview ::ng-deep th, .gr__preview ::ng-deep td { border: 1px solid rgba(255,255,255,.12); padding: 4px 8px; }
    .gr__thinking { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 14px; border-radius: 10px; background: color-mix(in srgb, var(--mat-sys-primary) 10%, transparent); }
    .gr__thinking div { display: flex; flex-direction: column; font-size: 13px; }
    .gr__thinking div span { font-size: 12px; opacity: .7; }
    .gr__dots { display: inline-flex; gap: 4px; color: var(--mat-sys-primary); }
    .gr__dots i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: .35; animation: gr-dot 1.2s infinite ease-in-out; }
    .gr__dots i:nth-child(2) { animation-delay: .15s; } .gr__dots i:nth-child(3) { animation-delay: .3s; }
    @keyframes gr-dot { 0%, 80%, 100% { opacity: .3; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }
    @media (prefers-reduced-motion: reduce) { .gr__dots i { animation: none; opacity: .8; } .gr__sec { transition: none; } }
  `]
})
export class KbGuideReviewComponent implements OnInit, OnDestroy {
  private api = inject(ArchitectureService);
  private snackBar = inject(MatSnackBar);

  readonly project = input.required<ArchitectureProject>();
  readonly projects = input<ArchitectureProject[]>([]);
  readonly closed = output<void>();
  /** Gravou: chave da primeira seção do Guia aplicada (ou null se só os dados do projeto). */
  readonly applied = output<string | null>();

  readonly step = signal<'form' | 'loading' | 'review' | 'error'>('form');
  readonly status = signal<ChatStatus | null>(null);
  readonly error = signal<string | null>(null);
  readonly sections = signal<ReviewSection[]>([]);
  readonly provider = signal<string | null>(null);
  readonly notes = signal<string | null>(null);
  readonly saving = signal(false);
  readonly elapsed = signal(0);
  private readonly tick = signal(0);

  instructions = '';
  displayName = '';
  tagline = '';
  businessArea = '';
  applyFriendly = true;

  private sub?: Subscription;
  private timer?: ReturnType<typeof setInterval>;
  private el = inject(ElementRef<HTMLElement>);

  readonly name = computed(() => friendlyName(this.project()));
  readonly areas = computed(() => [...new Set(this.projects().map(p => p.businessArea?.trim()).filter((a): a is string => !!a))].sort());
  readonly selectedCount = computed(() => { this.tick(); return this.sections().filter(s => s.selected).length; });

  private readonly messages = [
    'Lendo as seções técnicas do sistema…',
    'Juntando as ligações com outros sistemas…',
    'Conferindo as regras do Knowledge Center…',
    'Escrevendo o guia em linguagem simples…',
    'Revisando os textos…'
  ];
  readonly loadingMessage = computed(() => this.messages[Math.min(this.messages.length - 1, Math.floor(this.elapsed() / 9))]);

  constructor() {
    effect(() => { this.tick(); this.sections(); setTimeout(() => renderMermaidIn(this.el.nativeElement), 0); });
  }

  ngOnInit(): void {
    this.api.chatStatus().subscribe({ next: st => this.status.set(st), error: () => this.status.set(null) });
  }

  ngOnDestroy(): void {
    this.cancel();
  }

  refresh(): void { this.tick.update(n => n + 1); }

  generate(): void {
    this.cancel();
    this.step.set('loading');
    this.elapsed.set(0);
    this.timer = setInterval(() => this.elapsed.update(n => n + 1), 1000);
    this.sub = this.api.generateGuide(this.project().key, this.instructions.trim() || null).subscribe({
      next: r => {
        this.stopTimer();
        const p = this.project();
        this.provider.set([r.provider, r.model].filter(Boolean).join(' · ') || null);
        this.notes.set(r.notes ?? null);
        this.displayName = r.displayName ?? p.displayName ?? '';
        this.tagline = r.tagline ?? p.tagline ?? '';
        this.businessArea = r.businessArea ?? p.businessArea ?? '';
        this.applyFriendly = !!(r.displayName || r.tagline || r.businessArea);
        this.sections.set([...(r.sections ?? [])].sort((a, b) => a.order - b.order).map(s => {
          const existing = p.sections.find(x => x.key === s.key);
          return { ...s, selected: true, preview: true, existingVersion: existing?.version ?? null, existingIsTech: !!existing && !isGuideSection(existing) };
        }));
        this.step.set('review');
      },
      error: err => {
        this.stopTimer();
        const msg = err?.error?.error;
        this.error.set(err?.status === 409 ? `A IA não está configurada: ${msg ?? 'cadastre o plugin de IA nas configurações do PRMake.'}`
          : err?.status === 502 ? `A IA não conseguiu gerar o guia agora: ${msg ?? 'tente de novo em instantes.'}`
          : err?.status === 404 ? 'Projeto não encontrado na base.'
          : msg ?? 'Não foi possível gerar o guia.');
        this.step.set('error');
      }
    });
  }

  cancel(): void {
    this.sub?.unsubscribe();
    this.sub = undefined;
    this.stopTimer();
    if (this.step() === 'loading') this.step.set('form');
  }

  close(): void {
    this.cancel();
    this.closed.emit();
  }

  async apply(): Promise<void> {
    const p = this.project();
    const chosen = this.sections().filter(s => s.selected && s.content.trim());
    this.saving.set(true);
    let ok = 0, failed = 0;
    for (const s of chosen) {
      s.status = 'saving'; this.refresh();
      try {
        await firstValueFrom(this.api.writeSection(p.key, s.key, {
          title: s.title.trim() || null, content: s.content, order: s.order, source: 'ai', audience: 'human', note: 'guia gerado com a IA (revisado na tela)'
        }));
        s.status = 'ok'; ok++;
      } catch (err: any) {
        s.status = 'error'; s.error = err?.error?.error ?? 'falhou'; failed++;
      }
      this.refresh();
    }
    let projectOk = true;
    if (this.applyFriendly) {
      try {
        await firstValueFrom(this.api.upsertProject(p.key, {
          name: p.name, kind: p.kind, repository: p.repository ?? null, summary: p.summary ?? null, keywords: p.keywords, order: p.order,
          relations: null, displayName: this.displayName.trim(), tagline: this.tagline.trim(), businessArea: this.businessArea.trim()
        }));
      } catch (err: any) {
        projectOk = false;
        this.snackBar.open(`Os dados amigáveis não foram salvos: ${err?.error?.error ?? 'erro'}`, 'Fechar', { duration: 8000 });
      }
    }
    this.saving.set(false);
    if (failed) {
      this.snackBar.open(`${ok} seção(ões) gravadas, ${failed} com erro — veja os ícones em vermelho.`, 'Fechar', { duration: 9000 });
      return;
    }
    this.snackBar.open(`Guia aplicado: ${ok} seção(ões)${this.applyFriendly && projectOk ? ' e os dados amigáveis' : ''}.`, 'Ok', { duration: 4000 });
    this.applied.emit(chosen[0]?.key ?? null);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
