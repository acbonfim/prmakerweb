import { firstValueFrom, Subscription } from 'rxjs';
import { Component, ElementRef, OnChanges, OnDestroy, SimpleChanges, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PlanMarkdownPipe } from '../../../components/execution-plan/plan-markdown.pipe';
import { renderMermaidIn } from '../../../helpers/mermaid-loader';
import {
  ArchitectureCoverage,
  ArchitectureDeepAnswerResponse,
  ArchitectureProject,
  ArchitectureService,
  ArchitectureSuggestedSection,
  GUIDE_TEMPLATE,
  SECTION_TEMPLATE
} from '../../../services/architecture.service';
import { EditableProposal, KbProposalEditorComponent, toEditable } from './kb-proposal-editor.component';

/**
 * "A base ainda não cobre bem isso" (0038 F5): quando o Pergunte responde só em parte (ou não acha), oferece analisar a
 * fundo (POST ask/deep — lê tudo e propõe uma seção). Qualquer pessoa envia a proposta como sugestão (lacuna, se precisar
 * confirmar no código); o admin pode criar a seção na hora. Nada é gravado sem alguém pedir.
 */
@Component({
  selector: 'app-kb-ask-deep',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatTooltipModule, PlanMarkdownPipe, KbProposalEditorComponent],
  template: `
    <section class="dp" aria-live="polite">
      @if (state() === 'idle') {
        <div class="dp__head"><mat-icon>travel_explore</mat-icon>
          <div>
            <strong>A base ainda não cobre bem isso</strong>
            <span>{{ coverage() === 'not-found' ? 'Não achei uma seção que responda.' : 'A resposta acima é parcial.' }}
              Posso analisar tudo o que a base tem (seções, regras do Knowledge Center, ligações) e propor uma seção nova.</span>
          </div>
        </div>
        <button mat-flat-button color="primary" (click)="run()"><mat-icon>auto_awesome</mat-icon>Analisar a fundo e propor uma seção</button>
      } @else if (state() === 'loading') {
        <div class="dp__thinking">
          <span class="dp__dots"><i></i><i></i><i></i></span>
          <div><strong>{{ loadingMessage() }}</strong><span>{{ elapsed() }} s — pode levar até um minuto e meio</span></div>
          <span class="dp__spacer"></span>
          <button mat-button (click)="cancel()">Cancelar</button>
        </div>
      } @else if (state() === 'error') {
        <div class="dp__error"><mat-icon>error_outline</mat-icon>{{ error() }}
          <span class="dp__spacer"></span><button mat-stroked-button (click)="run()">Tentar de novo</button></div>
      } @else if (deep(); as d) {
        <div class="dp__head"><mat-icon>travel_explore</mat-icon>
          <div><strong>Análise aprofundada</strong>
            @if (d.provider) { <span class="dp__badge">{{ d.provider }}{{ d.model ? ' · ' + d.model : '' }}</span> }
          </div>
        </div>
        @if (d.aiUnavailableReason) { <div class="dp__warn"><mat-icon>info</mat-icon>IA indisponível: {{ d.aiUnavailableReason }}</div> }
        @if (d.answer) { <div class="dp__md" [innerHTML]="d.answer | planMarkdown"></div> }
        @if (d.sourcesRead.length) {
          <div class="dp__sources">Li: @for (s of d.sourcesRead; track s) { <span class="dp__tag">{{ s }}</span> }</div>
        }
        @if (d.needsCodeAnalysis) {
          <div class="dp__warn"><mat-icon>code</mat-icon>
            <span>A documentação não basta — a sugestão vai como <strong>lacuna</strong> para o admin analisar o código com a skill base-solvace.
              @if (d.codeHints) { <br /><em>O que conferir no código:</em> {{ d.codeHints }} }</span>
          </div>
        }
        @if (proposal(); as p) {
          <div class="dp__label"><mat-icon>note_add</mat-icon>{{ d.proposal ? 'Seção proposta' : 'Escreva a seção (ou só envie a pergunta como lacuna)' }}</div>
          <app-kb-proposal-editor [proposal]="p" [projects]="projects()" [selectable]="false" [allowNoSection]="false" titleLabel="Título da seção"
                                  [doneLabel]="done() === 'created' ? 'seção criada' : 'sugestão enviada'" [rows]="12" (changed)="touch()"></app-kb-proposal-editor>
          @if (done() !== 'created') {
            <div class="dp__actions">
              @if (done() === 'sent') { <span class="dp__ok"><mat-icon>check_circle</mat-icon>Enviada para a fila — um administrador revisa.</span> }
              <span class="dp__spacer"></span>
              <button mat-stroked-button (click)="sendSuggestion()" [disabled]="busy() || done() === 'sent' || !p.projectKey"
                      [matTooltip]="d.needsCodeAnalysis ? 'Vai para a fila como lacuna (precisa confirmar no código)' : 'Vai para a fila de sugestões do admin'">
                <mat-icon>lightbulb</mat-icon>Enviar como sugestão</button>
              @if (isAdmin()) {
                <button mat-flat-button color="primary" (click)="createNow()" [disabled]="busy() || !canCreate()"
                        [matTooltip]="canCreate() ? 'Grava a seção agora (vira a versão 1, com histórico)' : 'Escolha um sistema da base, a chave, o título e o texto'">
                  <mat-icon>add_task</mat-icon>Criar a seção agora</button>
              }
            </div>
          }
        }
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .dp { margin: 4px 0 14px; padding: 12px 14px; border-radius: 12px; border: 1px dashed color-mix(in srgb, #e3b341 60%, transparent);
      background: color-mix(in srgb, #e3b341 6%, transparent); animation: dp-in .3s ease-out; }
    .dp__head { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
    .dp__head > mat-icon { color: #e3b341; flex: none; margin-top: 1px; }
    .dp__head div { display: flex; flex-direction: column; gap: 2px; font-size: 13.5px; }
    .dp__head div span { font-size: 12.5px; opacity: .8; line-height: 1.45; }
    .dp button mat-icon { font-size: 17px; width: 17px; height: 17px; margin-right: 4px; }
    .dp__spacer { flex: 1 1 auto; }
    .dp__badge { align-self: flex-start; font-size: 10.5px; padding: 0 8px; border-radius: 9px; background: rgba(255,255,255,.08); opacity: 1 !important; }
    .dp__thinking { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .dp__thinking div { display: flex; flex-direction: column; font-size: 13px; }
    .dp__thinking div span { font-size: 12px; opacity: .7; }
    .dp__dots { display: inline-flex; gap: 4px; color: #e3b341; }
    .dp__dots i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: .35; animation: dp-dot 1.2s infinite ease-in-out; }
    .dp__dots i:nth-child(2) { animation-delay: .15s; } .dp__dots i:nth-child(3) { animation-delay: .3s; }
    .dp__error, .dp__warn { display: flex; align-items: flex-start; gap: 6px; font-size: 13px; padding: 6px 10px; border-radius: 8px; margin-bottom: 10px; flex-wrap: wrap; }
    .dp__error { color: var(--mat-sys-error, #f2b8b5); }
    .dp__warn { color: #d29922; background: rgba(210,153,34,.12); line-height: 1.45; }
    .dp__error mat-icon, .dp__warn mat-icon { flex: none; font-size: 18px; width: 18px; height: 18px; }
    .dp__md { font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; margin-bottom: 10px; }
    .dp__md ::ng-deep p:first-child { margin-top: 0; }
    .dp__sources { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; opacity: .75; margin-bottom: 10px; }
    .dp__tag { font-size: 11.5px; padding: 1px 8px; border-radius: 999px; border: 1px solid rgba(255,255,255,.14); }
    .dp__label { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; margin: 4px 0 6px; opacity: .85; }
    .dp__label mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--mat-sys-primary); }
    .dp__actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .dp__ok { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: #3fb950; }
    .dp__ok mat-icon { font-size: 18px; width: 18px; height: 18px; }
    @keyframes dp-dot { 0%, 80%, 100% { opacity: .3; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }
    @keyframes dp-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .dp, .dp__dots i { animation: none; } }
  `]
})
export class KbAskDeepComponent implements OnChanges, OnDestroy {
  private api = inject(ArchitectureService);
  private snackBar = inject(MatSnackBar);
  private el = inject(ElementRef<HTMLElement>);

  readonly question = input.required<string>();
  readonly coverage = input<ArchitectureCoverage | null>(null);
  readonly suggested = input<ArchitectureSuggestedSection | null>(null);
  readonly projects = input<ArchitectureProject[]>([]);
  readonly isAdmin = input(false);
  /** Seção criada pelo admin: a tela recarrega os projetos e abre a seção. */
  readonly created = output<{ projectKey: string; sectionKey: string }>();
  readonly suggestionSent = output<void>();

  readonly state = signal<'idle' | 'loading' | 'done' | 'error'>('idle');
  readonly deep = signal<ArchitectureDeepAnswerResponse | null>(null);
  readonly proposal = signal<EditableProposal | null>(null);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly done = signal<'sent' | 'created' | null>(null);
  readonly elapsed = signal(0);
  private readonly tick = signal(0);
  private sub?: Subscription;
  private timer?: ReturnType<typeof setInterval>;

  private readonly messages = [
    'Lendo as seções que falam do assunto…',
    'Conferindo as regras do Knowledge Center…',
    'Seguindo as ligações entre os sistemas…',
    'Montando a resposta e a proposta de seção…'
  ];
  readonly loadingMessage = computed(() => this.messages[Math.min(this.messages.length - 1, Math.floor(this.elapsed() / 15))]);

  readonly canCreate = computed(() => {
    this.tick();
    const p = this.proposal();
    return !!p && this.projects().some(x => x.key === p.projectKey) && !!p.sectionKey?.trim() && !!p.title.trim() && !!p.content.trim();
  });

  constructor() {
    effect(() => { this.deep(); setTimeout(() => renderMermaidIn(this.el.nativeElement), 0); });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['question'] && !changes['question'].firstChange) {
      this.cancel();
      this.state.set('idle'); this.deep.set(null); this.proposal.set(null); this.done.set(null);
    }
  }

  ngOnDestroy(): void { this.cancel(); }

  touch(): void { this.tick.update(n => n + 1); }

  run(): void {
    this.cancel();
    this.state.set('loading');
    this.elapsed.set(0);
    this.done.set(null);
    this.timer = setInterval(() => this.elapsed.update(n => n + 1), 1000);
    this.sub = this.api.askDeep(this.question()).subscribe({
      next: d => {
        this.stop();
        this.deep.set({ ...d, sourcesRead: d.sourcesRead ?? [] });
        const fallbackProject = this.suggested()?.projectKey ?? '';
        const p = d.proposal
          ? toEditable(d.proposal)
          : toEditable({ projectKey: fallbackProject, sectionKey: null, audience: 'human', title: this.question(), content: '' });
        p.preview = !!d.proposal;
        this.proposal.set(p);
        this.state.set('done');
      },
      error: err => {
        this.stop();
        this.error.set(err?.error?.error ?? (err?.status === 502 ? 'A IA não conseguiu analisar agora — tente de novo.' : 'Não foi possível analisar a fundo agora.'));
        this.state.set('error');
      }
    });
  }

  cancel(): void {
    this.sub?.unsubscribe();
    this.sub = undefined;
    this.stop();
    if (this.state() === 'loading') this.state.set('idle');
  }

  async sendSuggestion(): Promise<void> {
    const d = this.deep(), p = this.proposal();
    if (!d || !p || !p.projectKey) return;
    const aud = p.audience === 'human' ? 'Guia' : 'Técnica';
    const parts = [`**Pergunta:** ${this.question()}`];
    if (p.title.trim() || p.content.trim()) parts.push(`**Proposta de seção:** ${p.title.trim() || '(sem título)'} (${p.sectionKey || 'chave a definir'}, público ${aud})`);
    if (p.content.trim()) parts.push(p.content.trim());
    if (d.needsCodeAnalysis) parts.push(`**Precisa confirmar no código:** ${d.codeHints?.trim() || 'sim'}`);
    this.busy.set(true);
    p.status = 'sending'; this.touch();
    try {
      await firstValueFrom(this.api.suggest({
        projectKey: p.projectKey, sectionKey: p.sectionKey || null, kind: d.needsCodeAnalysis ? 'gap' : 'learning', content: parts.join('\n\n'), cardNumber: null
      }));
      p.status = 'ok';
      this.done.set('sent');
      this.snackBar.open('Sugestão enviada para a fila.', 'Ok', { duration: 3500 });
      this.suggestionSent.emit();
    } catch (err: any) {
      p.status = 'error'; p.error = err?.error?.error ?? 'não foi possível enviar';
      this.snackBar.open(p.error!, 'Fechar', { duration: 7000 });
    }
    this.busy.set(false);
    this.touch();
  }

  async createNow(): Promise<void> {
    const p = this.proposal();
    if (!p || !this.canCreate()) return;
    const key = p.sectionKey!.trim();
    const order = [...GUIDE_TEMPLATE, ...SECTION_TEMPLATE].find(t => t.key === key)?.order ?? null;
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.writeSection(p.projectKey, key, {
        title: p.title.trim(), content: p.content, order, audience: p.audience, source: 'ai',
        note: `Pergunte à Base Solvace: ${this.question()}`.slice(0, 300)
      }));
      p.status = 'ok';
      this.done.set('created');
      this.snackBar.open('Seção criada.', 'Ok', { duration: 3500 });
      this.created.emit({ projectKey: p.projectKey, sectionKey: key });
    } catch (err: any) {
      this.snackBar.open(err?.error?.error ?? 'Não foi possível criar a seção.', 'Fechar', { duration: 8000 });
    }
    this.busy.set(false);
    this.touch();
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
