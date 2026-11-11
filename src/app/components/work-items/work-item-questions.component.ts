import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ExecutionQuestion } from '../execution-plan/execution-plan.model';
import { PlanMarkdownPipe } from '../execution-plan/plan-markdown.pipe';
import { ExecutionPlanService, planApiError } from '../../services/execution-plan.service';

/**
 * Perguntas do PRMake na sessão de execução do item (aba Itens de trabalho da Bancada): a sub-tarefa do Claude parou
 * esperando as respostas do plano do item — responder aqui é o mesmo que na aba Execução (opções ou texto livre, resposta
 * otimista). Abertas + as respondidas nesta tela (até o Claude seguir), para a pessoa ver o que mandou.
 *
 * API: `[planId]`, `[questions]` (as do plano a mostrar), `[taskLabel]` (ex.: "#753"), `(answered)` (pergunta confirmada).
 */
@Component({
  selector: 'app-work-item-questions',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, PlanMarkdownPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="wiq" role="region" aria-label="Perguntas do Claude">
      <div class="wiq__head">
        <mat-icon>front_hand</mat-icon>
        @if (openCount()) {
          <span>O Claude parou@if (taskLabel()) { em <b>{{ taskLabel() }}</b>} e precisa {{ openCount() === 1 ? 'da sua resposta' : 'das suas ' + openCount() + ' respostas' }} para seguir.</span>
        } @else {
          <span>Respostas enviadas — o Claude segue com elas.</span>
        }
      </div>
      @for (q of questions(); track q.id; let i = $index) {
        <div class="wiq__q" [class.wiq__q--done]="q.status !== 'open'">
          <div class="wiq__text wiq__md">
            @if (questions().length > 1) { <span class="wiq__n">{{ i + 1 }}.</span> }
            <div [innerHTML]="q.text | planMarkdown:'card'"></div>
          </div>
          @if (sending()[q.id]; as sent) {
            <div class="wiq__answer wiq__answer--sending" role="status" aria-live="polite">
              <mat-icon class="wiq__spin">sync</mat-icon><span><b>{{ sent }}</b><span class="wiq__who"> — enviando…</span></span>
            </div>
          } @else if (q.status === 'open') {
            @if (q.options.length) {
              <div class="wiq__options">
                @for (o of q.options; track o.label) {
                  <button type="button" class="wiq__option" [class.wiq__option--rec]="o.recommended" (click)="answer(q, o.label)">
                    <span class="wiq__option-head">
                      @if (o.recommended) { <mat-icon>star</mat-icon> }
                      <span>{{ o.label }}</span>
                      @if (o.recommended) { <span class="wiq__tag">recomendada</span> }
                    </span>
                    @if (o.description) { <span class="wiq__option-desc">{{ o.description }}</span> }
                  </button>
                }
              </div>
            }
            @if (q.allowFreeText) {
              <div class="wiq__free">
                <input class="wiq__input" [value]="drafts()[q.id] || ''" (input)="setDraft(q.id, $any($event.target).value)"
                       (keydown.enter)="answer(q, drafts()[q.id] || '')"
                       [placeholder]="q.options.length ? 'Ou escreva outra resposta…' : 'Sua resposta…'" [attr.aria-label]="'Resposta da pergunta ' + (i + 1)" />
                <button mat-flat-button color="primary" [disabled]="!(drafts()[q.id] || '').trim()" (click)="answer(q, drafts()[q.id] || '')">Responder</button>
              </div>
            }
          } @else {
            <div class="wiq__answer">
              <mat-icon>check_circle</mat-icon>
              <span><b>{{ q.answer }}</b>@if (q.answeredBy) { <span class="wiq__who"> — {{ q.answeredBy }}</span> }</span>
            </div>
          }
        </div>
      }
    </section>
  `,
  styles: [`
    :host { display: block; flex: none; }
    .wiq { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: 10px;
      background: rgba(210,153,34,.08); border: 1px solid rgba(210,153,34,.4); }
    .wiq__head { display: flex; align-items: flex-start; gap: 8px; color: #e3b341; font-size: 13px; line-height: 1.4; }
    .wiq__head mat-icon { font-size: 18px; width: 18px; height: 18px; flex: none; }
    .wiq__q { padding: 8px 0 4px; border-top: 1px solid rgba(255,255,255,.07); }
    .wiq__q:first-of-type { border-top: none; }
    .wiq__text { display: flex; gap: 6px; font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; }
    .wiq__n { flex: none; font-weight: 700; color: #e3b341; }
    .wiq__md ::ng-deep p { margin: 0 0 6px; }
    .wiq__md ::ng-deep p:last-child { margin-bottom: 0; }
    .wiq__md ::ng-deep ul, .wiq__md ::ng-deep ol { margin: 0 0 6px; padding-left: 18px; }
    .wiq__q--done .wiq__text { color: color-mix(in srgb, var(--mat-sys-on-surface) 70%, transparent); }
    .wiq__options { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
    .wiq__option { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; padding: 7px 11px; border-radius: 8px;
      border: 1px solid rgba(255,255,255,.16); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer;
      transition: border-color .15s, background .15s; }
    .wiq__option:hover { border-color: var(--mat-sys-primary); background: color-mix(in srgb, var(--mat-sys-primary) 8%, transparent); }
    .wiq__option:focus-visible { outline: 2px solid var(--mat-sys-primary); outline-offset: 1px; }
    .wiq__option--rec { border-color: color-mix(in srgb, var(--mat-sys-primary) 70%, transparent); }
    .wiq__option-head { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; }
    .wiq__option--rec .wiq__option-head { color: var(--mat-sys-primary); }
    .wiq__option mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .wiq__tag { font-size: 10.5px; font-weight: 600; padding: 0 6px; border-radius: 9px; background: color-mix(in srgb, var(--mat-sys-primary) 18%, transparent); }
    .wiq__option-desc { font-size: 12.5px; line-height: 1.45; white-space: pre-line; overflow-wrap: anywhere;
      color: color-mix(in srgb, var(--mat-sys-on-surface) 78%, transparent); }
    .wiq__free { display: flex; gap: 6px; margin-top: 8px; align-items: center; }
    .wiq__input { flex: 1 1 160px; min-width: 0; box-sizing: border-box; border: 1px solid var(--cc-surface-border-strong, rgba(255,255,255,.18));
      border-radius: 8px; background: var(--surface-input, #1a1f28); color: inherit; font: inherit; font-size: 12.5px; padding: 7px 10px; }
    .wiq__input:focus { outline: none; border-color: color-mix(in srgb, var(--mat-sys-primary) 70%, transparent); }
    .wiq__answer { display: flex; gap: 6px; align-items: flex-start; margin-top: 6px; font-size: 12.5px; }
    .wiq__answer mat-icon { font-size: 16px; width: 16px; height: 16px; flex: none; color: #3fb950; }
    .wiq__answer--sending { padding: 6px 8px; border-radius: 8px; background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent); }
    .wiq__answer--sending mat-icon { color: var(--mat-sys-primary); }
    .wiq__who { color: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent); }
    .wiq__spin { animation: wiq-spin 1s linear infinite; }
    @keyframes wiq-spin { to { transform: rotate(360deg); } }
  `]
})
export class WorkItemQuestionsComponent {
  readonly planId = input.required<string>();
  readonly questions = input<ExecutionQuestion[]>([]);
  readonly taskLabel = input<string | null>(null);
  readonly answered = output<ExecutionQuestion>();

  private api = inject(ExecutionPlanService);
  private snack = inject(MatSnackBar);

  readonly drafts = signal<Record<string, string>>({});
  /** Resposta enviada e ainda sem confirmação (id → texto): a escolha aparece na hora. */
  readonly sending = signal<Record<string, string>>({});
  readonly openCount = computed(() => this.questions().filter((q) => q.status === 'open' && !this.sending()[q.id]).length);

  setDraft(id: string, text: string): void {
    this.drafts.update((d) => ({ ...d, [id]: text }));
  }

  answer(q: ExecutionQuestion, text: string): void {
    const value = (text ?? '').trim();
    if (!value || q.status !== 'open' || this.sending()[q.id]) return;
    this.sending.update((s) => ({ ...s, [q.id]: value }));
    this.api.answer(this.planId(), q.id, value).subscribe({
      next: (saved) => {
        this.clear(q.id);
        this.drafts.update((d) => { const { [q.id]: _, ...rest } = d; return rest; });
        this.answered.emit(saved ?? { ...q, status: 'answered', answer: value, answeredVia: 'prmake', answeredAt: new Date().toISOString() });
      },
      error: (err) => {
        this.clear(q.id);
        this.snack.open(planApiError(err, 'Não foi possível enviar a resposta — escolha de novo.'), 'Fechar', { duration: 8000 });
      }
    });
  }

  private clear(id: string): void {
    this.sending.update((s) => { const { [id]: _, ...rest } = s; return rest; });
  }
}
