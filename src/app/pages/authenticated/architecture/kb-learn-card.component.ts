import { firstValueFrom, Subscription } from 'rxjs';
import { Component, OnDestroy, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PlanMarkdownPipe } from '../../../components/execution-plan/plan-markdown.pipe';
import { ArchitectureProject, ArchitectureService, LearnFromCardResponse } from '../../../services/architecture.service';
import { suggestionContent } from './kb-friendly';
import { EditableProposal, KbProposalEditorComponent, toEditable } from './kb-proposal-editor.component';

const SOURCE_ICONS: Record<string, string> = { devops: 'assignment', pr: 'merge', timeline: 'timeline', plan: 'checklist', suggestions: 'lightbulb' };

/**
 * "Aprender com um card" (0038 F4, qualquer logado): o PRMake junta o card do DevOps, o PR/RCA, a Timeline, os planos e
 * as sugestões que já existem, e a IA propõe aprendizados para a base. A pessoa revisa/edita e envia para a fila de
 * sugestões (com o número do card) — quem incorpora é o admin. Nada é gravado na base por aqui.
 */
@Component({
  selector: 'app-kb-learn-card',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, PlanMarkdownPipe, KbProposalEditorComponent],
  template: `
    <section class="lc" aria-label="Aprender com um card">
      <div class="lc__head">
        <mat-icon>school</mat-icon>
        <strong>Aprender com um card</strong>
        <span class="lc__muted">o PRMake lê tudo o que foi feito no card e propõe o que vale guardar na Base Solvace</span>
        <span class="lc__spacer"></span>
        <button mat-icon-button (click)="close()" aria-label="Fechar" matTooltip="Fechar"><mat-icon>close</mat-icon></button>
      </div>

      <form class="lc__form" (submit)="$event.preventDefault(); run()">
        <label class="lc__card">Número do card
          <input [(ngModel)]="cardNumber" name="card" inputmode="numeric" placeholder="ex.: 74519" [disabled]="loading()" autocomplete="off" />
        </label>
        <label class="lc__instr">O que observar <span class="lc__muted">(opcional)</span>
          <input [(ngModel)]="instructions" name="instr" placeholder="ex.: foque na regra de cálculo das metas" [disabled]="loading()" />
        </label>
        <button mat-flat-button color="primary" type="submit" [disabled]="loading() || !validNumber()"><mat-icon>auto_awesome</mat-icon>Ler o card</button>
      </form>
      @if (cardNumber.trim() && !validNumber()) { <div class="lc__hint">Use só o número do card (ex.: 74519).</div> }

      @if (loading()) {
        <div class="lc__thinking" aria-live="polite">
          <span class="lc__dots"><i></i><i></i><i></i></span>
          <div><strong>{{ loadingMessage() }}</strong><span>{{ elapsed() }} s — pode levar até um minuto</span></div>
          <span class="lc__spacer"></span>
          <button mat-button type="button" (click)="cancel()">Cancelar</button>
        </div>
        <ol class="lc__steps">
          @for (m of messages; track m; let i = $index) {
            <li [class.done]="i < step()" [class.now]="i === step()"><mat-icon>{{ i < step() ? 'check' : i === step() ? 'more_horiz' : 'radio_button_unchecked' }}</mat-icon>{{ m }}</li>
          }
        </ol>
      } @else if (error()) {
        <div class="lc__error"><mat-icon>error_outline</mat-icon>{{ error() }}</div>
      } @else if (result(); as r) {
        <div class="lc__result">
          <h3>Card {{ r.cardNumber }}{{ r.cardTitle ? ' — ' + r.cardTitle : '' }}</h3>
          <div class="lc__sources" aria-label="O que o PRMake leu">
            @for (s of r.sources; track s.kind + s.label) {
              <span class="lc__src" [class.lc__src--ok]="s.ok" [matTooltip]="s.detail || (s.ok ? 'lido' : 'não encontrado')">
                <mat-icon>{{ s.ok ? 'check_circle' : 'cancel' }}</mat-icon>{{ s.label }}
              </span>
            }
          </div>
          @if (r.summary) {
            <div class="lc__summary">
              <div class="lc__label"><mat-icon>summarize</mat-icon>O que foi feito no card</div>
              <div class="lc__md" [innerHTML]="r.summary | planMarkdown"></div>
            </div>
          }
          @if (r.existing.length) {
            <div class="lc__existing">
              <div class="lc__label lc__label--warn"><mat-icon>warning</mat-icon>Este card já tem {{ r.existing.length }} {{ r.existing.length === 1 ? 'sugestão' : 'sugestões' }} — veja abaixo antes de enviar outra</div>
              @for (e of r.existing; track e.id) {
                <div class="lc__ex">
                  <span class="lc__chip">{{ kindLabel(e.kind) }}</span>
                  <span class="lc__chip lc__chip--{{ e.status }}">{{ statusLabel(e.status) }}</span>
                  <code>{{ e.projectKey }}{{ e.sectionKey ? ' / ' + e.sectionKey : '' }}</code>
                  <span class="lc__muted">{{ e.createdBy }}</span>
                  <div class="lc__ex-text">{{ excerpt(e.content) }}</div>
                </div>
              }
            </div>
          }
          @if (r.aiUnavailableReason) {
            <div class="lc__warn"><mat-icon>info</mat-icon><span>A IA não pôde propor aprendizados ({{ r.aiUnavailableReason }}). Você pode escrever a sugestão à mão abaixo.</span></div>
          }

          <div class="lc__props-head">
            <strong>Propostas para a base</strong>
            @if (r.provider) { <span class="lc__badge">{{ r.provider }}{{ r.model ? ' · ' + r.model : '' }}</span> }
            <span class="lc__spacer"></span>
            <button mat-stroked-button type="button" (click)="addManual()"><mat-icon>add</mat-icon>Escrever sugestão manual</button>
          </div>
          @for (p of proposals(); track $index) {
            <app-kb-proposal-editor [proposal]="p" [projects]="projects()" titleLabel="Título do aprendizado" (changed)="touch()"></app-kb-proposal-editor>
          } @empty {
            <div class="lc__empty">Nenhuma proposta{{ r.aiUnavailableReason ? '' : ' — a IA não achou nada novo para guardar' }}.</div>
          }

          @if (proposals().length) {
            <div class="lc__send">
              @if (sentCount()) { <span class="lc__ok"><mat-icon>check_circle</mat-icon>{{ sentCount() }} enviada(s) para a fila — um administrador revisa e incorpora.</span> }
              <span class="lc__spacer"></span>
              <button mat-flat-button color="primary" type="button" (click)="send()" [disabled]="sending() || !toSend().length">
                <mat-icon>send</mat-icon>Enviar {{ toSend().length || '' }} para a fila
              </button>
            </div>
          }
        </div>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .lc { margin-bottom: 18px; padding: 12px 14px; border-radius: 10px; border: 1px solid color-mix(in srgb, var(--mat-sys-primary) 35%, transparent);
      background: color-mix(in srgb, var(--mat-sys-primary) 4%, transparent); }
    .lc__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
    .lc__head mat-icon { color: var(--mat-sys-primary); }
    .lc__spacer { flex: 1 1 auto; }
    .lc__muted { font-size: 12px; color: color-mix(in srgb, var(--mat-sys-on-surface) 58%, transparent); font-weight: 400; }
    .lc__form { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px 12px; }
    .lc__form label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; font-weight: 600; }
    .lc__card { flex: 0 1 160px; } .lc__instr { flex: 1 1 260px; }
    .lc__form button mat-icon, .lc__props-head button mat-icon, .lc__send button mat-icon { font-size: 17px; width: 17px; height: 17px; margin-right: 4px; }
    input { font: inherit; font-size: 13.5px; font-weight: 400; color: inherit; padding: 8px 10px; border-radius: 8px; min-width: 0;
      border: 1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.25); outline: none; }
    input:focus { border-color: color-mix(in srgb, var(--mat-sys-primary) 70%, transparent); }
    .lc__hint { margin-top: 4px; font-size: 12px; color: #d29922; }
    .lc__thinking { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 12px; padding: 12px 14px; border-radius: 10px;
      background: color-mix(in srgb, var(--mat-sys-primary) 10%, transparent); }
    .lc__thinking div { display: flex; flex-direction: column; font-size: 13px; }
    .lc__thinking div span { font-size: 12px; opacity: .7; }
    .lc__dots { display: inline-flex; gap: 4px; color: var(--mat-sys-primary); }
    .lc__dots i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: .35; animation: lc-dot 1.2s infinite ease-in-out; }
    .lc__dots i:nth-child(2) { animation-delay: .15s; } .lc__dots i:nth-child(3) { animation-delay: .3s; }
    .lc__steps { list-style: none; padding: 0; margin: 10px 0 0; display: flex; flex-direction: column; gap: 4px; }
    .lc__steps li { display: flex; align-items: center; gap: 6px; font-size: 12.5px; opacity: .45; transition: opacity .2s; }
    .lc__steps li mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .lc__steps li.done { opacity: .8; } .lc__steps li.done mat-icon { color: #3fb950; }
    .lc__steps li.now { opacity: 1; font-weight: 600; } .lc__steps li.now mat-icon { color: var(--mat-sys-primary); }
    .lc__error, .lc__warn { display: flex; align-items: flex-start; gap: 6px; margin-top: 12px; padding: 8px 10px; border-radius: 8px; font-size: 13px; }
    .lc__error { color: var(--mat-sys-error, #f2b8b5); background: rgba(242,184,181,.08); }
    .lc__warn { color: #d29922; background: rgba(210,153,34,.12); }
    .lc__error mat-icon, .lc__warn mat-icon { flex: none; font-size: 18px; width: 18px; height: 18px; }
    .lc__result { margin-top: 12px; animation: lc-in .25s ease-out; }
    .lc__result h3 { font-size: 16px; margin: 0 0 8px; }
    .lc__sources { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .lc__src { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 2px 9px 2px 5px; border-radius: 999px;
      border: 1px solid rgba(255,255,255,.12); opacity: .7; cursor: help; }
    .lc__src mat-icon { font-size: 15px; width: 15px; height: 15px; color: var(--mat-sys-error, #f2b8b5); }
    .lc__src--ok { opacity: 1; } .lc__src--ok mat-icon { color: #3fb950; }
    .lc__label { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px; opacity: .85; }
    .lc__label mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--mat-sys-primary); }
    .lc__label--warn { color: #d29922; opacity: 1; text-transform: none; letter-spacing: 0; font-size: 13px; }
    .lc__label--warn mat-icon { color: #d29922; }
    .lc__summary { padding: 10px 12px; border-radius: 8px; background: rgba(255,255,255,.03); margin-bottom: 10px; }
    .lc__md { font-size: 13.5px; line-height: 1.6; overflow-wrap: anywhere; }
    .lc__md ::ng-deep p:first-child { margin-top: 0; } .lc__md ::ng-deep p:last-child { margin-bottom: 0; }
    .lc__existing { padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(210,153,34,.45); background: rgba(210,153,34,.07); margin-bottom: 10px; }
    .lc__ex { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 6px 0; border-top: 1px solid rgba(255,255,255,.06); font-size: 12px; }
    .lc__ex code { font-size: 11.5px; }
    .lc__ex-text { flex-basis: 100%; font-size: 12.5px; line-height: 1.45; opacity: .85; }
    .lc__chip { font-size: 11px; font-weight: 700; padding: 0 8px; border-radius: 9px; background: rgba(255,255,255,.08); }
    .lc__chip--pending { color: #58a6ff; } .lc__chip--applied { color: #3fb950; } .lc__chip--dismissed { opacity: .6; }
    .lc__props-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 12px 0 8px; }
    .lc__badge { font-size: 10.5px; padding: 0 8px; border-radius: 9px; background: rgba(255,255,255,.08); }
    .lc__empty { font-size: 13px; opacity: .65; padding: 8px 0; }
    .lc__send { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 4px; }
    .lc__ok { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: #3fb950; }
    .lc__ok mat-icon { font-size: 18px; width: 18px; height: 18px; }
    @keyframes lc-dot { 0%, 80%, 100% { opacity: .3; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }
    @keyframes lc-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .lc__dots i, .lc__result { animation: none; } .lc__steps li { transition: none; } }
  `]
})
export class KbLearnCardComponent implements OnInit, OnDestroy {
  private api = inject(ArchitectureService);
  private snackBar = inject(MatSnackBar);

  readonly projects = input<ArchitectureProject[]>([]);
  /** Número inicial (ex.: link ?aprender=<card>). */
  readonly initialCard = input<string | null>(null);
  readonly closed = output<void>();
  /** Enviou sugestões para a fila (o admin recarrega a lista). */
  readonly sent = output<number>();

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<LearnFromCardResponse | null>(null);
  readonly proposals = signal<EditableProposal[]>([]);
  readonly sending = signal(false);
  readonly elapsed = signal(0);
  private readonly tick = signal(0);

  cardNumber = '';
  instructions = '';
  private sub?: Subscription;
  private timer?: ReturnType<typeof setInterval>;

  readonly messages = [
    'Lendo o card no Azure DevOps (campos, passos, comentários)',
    'Buscando o PR e o RCA salvos no PRMake',
    'Lendo a linha do tempo e os planos de execução',
    'Conferindo as sugestões que já existem para o card',
    'Pedindo à IA para propor o que vale guardar na base'
  ];
  readonly step = computed(() => Math.min(this.messages.length - 1, Math.floor(this.elapsed() / 7)));
  readonly loadingMessage = computed(() => this.messages[this.step()] + '…');
  readonly toSend = computed(() => { this.tick(); return this.proposals().filter(p => p.selected && p.status !== 'ok' && p.projectKey && p.content.trim()); });
  readonly sentCount = computed(() => { this.tick(); return this.proposals().filter(p => p.status === 'ok').length; });

  ngOnInit(): void {
    const c = this.initialCard();
    if (c) { this.cardNumber = c; if (this.validNumber()) this.run(); }
  }

  ngOnDestroy(): void {
    this.cancel();
  }

  validNumber(): boolean {
    return /^\d{1,10}$/.test(this.cardNumber.trim().replace(/^#/, ''));
  }

  touch(): void { this.tick.update(n => n + 1); }

  run(): void {
    if (!this.validNumber() || this.loading()) return;
    const card = this.cardNumber.trim().replace(/^#/, '');
    this.cancel();
    this.error.set(null);
    this.result.set(null);
    this.proposals.set([]);
    this.loading.set(true);
    this.elapsed.set(0);
    this.timer = setInterval(() => this.elapsed.update(n => n + 1), 1000);
    this.sub = this.api.learnFromCard(card, this.instructions.trim() || null).subscribe({
      next: r => {
        this.stop();
        this.result.set({ ...r, sources: r.sources ?? [], existing: r.existing ?? [], proposals: r.proposals ?? [] });
        this.proposals.set((r.proposals ?? []).map(p => toEditable(p)));
        if (!r.proposals?.length && r.aiUnavailableReason) this.addManual();
      },
      error: err => {
        this.stop();
        const msg = err?.error?.error;
        this.error.set(err?.status === 404 ? (msg ?? `Não encontrei nada sobre o card ${card} — nem no Azure DevOps nem no PRMake.`)
          : err?.status === 400 ? (msg ?? 'Número de card inválido.')
          : msg ?? 'Não foi possível ler o card agora. Tente de novo.');
      }
    });
  }

  cancel(): void {
    this.sub?.unsubscribe();
    this.sub = undefined;
    this.stop();
  }

  close(): void {
    this.cancel();
    this.closed.emit();
  }

  addManual(): void {
    const first = this.proposals()[0];
    this.proposals.update(list => [...list, toEditable({ projectKey: first?.projectKey ?? this.projects()[0]?.key ?? '', sectionKey: null, audience: 'llm', title: '', content: '' })]);
  }

  async send(): Promise<void> {
    const r = this.result();
    const list = this.toSend();
    if (!r || !list.length) return;
    this.sending.set(true);
    let ok = 0;
    for (const p of list) {
      p.status = 'sending'; this.touch();
      try {
        await firstValueFrom(this.api.suggest({
          projectKey: p.projectKey, sectionKey: p.sectionKey || null, kind: 'learning',
          content: suggestionContent(p.title, p.audience, p.content), cardNumber: r.cardNumber
        }));
        p.status = 'ok'; ok++;
      } catch (err: any) {
        p.status = 'error'; p.error = err?.error?.error ?? 'não foi possível enviar';
      }
      this.touch();
    }
    this.sending.set(false);
    if (ok) {
      this.snackBar.open(`${ok} sugestão(ões) do card ${r.cardNumber} enviada(s) para a fila.`, 'Ok', { duration: 4000 });
      this.sent.emit(ok);
    }
  }

  kindLabel(kind: string): string {
    return ({ learning: 'aprendizado', divergence: 'divergência', gap: 'lacuna', other: 'sugestão' } as Record<string, string>)[kind] ?? kind;
  }

  statusLabel(status: string): string {
    return ({ pending: 'na fila', applied: 'aplicada', dismissed: 'descartada' } as Record<string, string>)[status] ?? status;
  }

  excerpt(text: string): string {
    const t = text.replace(/[*`#>]/g, '').replace(/\s+/g, ' ').trim();
    return t.length > 240 ? t.slice(0, 239) + '…' : t;
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.loading.set(false);
  }
}
