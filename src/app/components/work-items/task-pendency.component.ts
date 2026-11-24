import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ExecutionPlanService, planApiError } from '../../services/execution-plan.service';
import { openCaseChat } from '../case-chat/open-case-chat';
import { PlanMarkdownPipe } from '../execution-plan/plan-markdown.pipe';
import { TaskPendency } from './task-pendency';
import { CaseCardType } from '../../helpers/work-item-type-icons';

/**
 * A pendência da sub-tarefa parada (card 78655), resolvida ali mesmo: `full` (modal da sub-tarefa) mostra a divergência
 * com "Confirmar e seguir"/"Revisar com o especialista", o pedido do Claude e como destravar; `compact` (sessão de
 * execução) mostra uma linha do problema e, com divergência, os mesmos dois botões. O "Já resolvi — continuar" e a nota
 * ficam com quem usa o componente.
 */
@Component({
  selector: 'app-task-pendency',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, PlanMarkdownPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let p = pendency();
    @if (variant() === 'compact') {
      <div class="tp-c" [class.tp-c--div]="!!p.divergence">
        <mat-icon class="tp-c__ico">{{ p.divergence ? 'difference' : 'report' }}</mat-icon>
        <span class="tp-c__text"><b>{{ p.divergence ? 'A base real difere da análise:' : 'O que falta:' }}</b> {{ p.summary }}</span>
      </div>
      @if (p.divergence && !readOnly()) {
        <div class="tp-acts tp-acts--compact">
          <button mat-button type="button" (click)="talk()"><mat-icon>psychology</mat-icon>Revisar com o especialista</button>
          <button mat-stroked-button type="button" (click)="confirm()" [disabled]="busy()"
                  matTooltip="O Claude segue com a etapa do jeito que ele propõe"><mat-icon>check</mat-icon>Confirmar e seguir</button>
        </div>
      }
    } @else {
      <div class="tp">
        @if (p.divergence) {
          <div class="tp__box tp__box--div" role="alert">
            <div class="tp__head"><mat-icon>difference</mat-icon>A base real difere da análise</div>
            <div class="tp__md" [innerHTML]="p.divergence | planMarkdown:'card'"></div>
            @if (!readOnly()) {
              <div class="tp-acts">
                <button mat-stroked-button type="button" (click)="talk()"><mat-icon>psychology</mat-icon>Revisar com o especialista</button>
                <button mat-flat-button color="primary" type="button" (click)="confirm()" [disabled]="busy()"><mat-icon>check</mat-icon>Confirmar e seguir</button>
              </div>
            }
          </div>
        }
        @if (p.reason) {
          <div class="tp__box">
            <div class="tp__head"><mat-icon>front_hand</mat-icon>O que o Claude precisa de você</div>
            <div class="tp__md" [innerHTML]="p.reason | planMarkdown:'card'"></div>
          </div>
        }
        <div class="tp__how">
          <mat-icon>lightbulb</mat-icon>
          <div>
            <b>Como resolver</b>
            <div class="tp__md" [innerHTML]="p.how | planMarkdown:'card'"></div>
            @if (!p.divergence && !readOnly()) {
              <button mat-button type="button" class="tp__talk" (click)="talk()"><mat-icon>psychology</mat-icon>Conversar com o especialista</button>
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .tp { display: flex; flex-direction: column; gap: 10px; }
    .tp__box { padding: 10px 12px; border-radius: 10px; border: 1px solid color-mix(in srgb, #e3b341 35%, transparent);
      background: color-mix(in srgb, #e3b341 8%, transparent); }
    .tp__box--div { border-color: color-mix(in srgb, #f0883e 45%, transparent); background: color-mix(in srgb, #f0883e 9%, transparent); }
    .tp__head { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 13px; color: #e3b341; margin-bottom: 6px; }
    .tp__box--div .tp__head { color: #f0883e; }
    .tp__head mat-icon, .tp__how > mat-icon { font-size: 18px; width: 18px; height: 18px; flex: none; }
    .tp__md { font-size: 13px; line-height: 1.5; max-height: 260px; overflow: auto; scrollbar-width: thin; }
    .tp__md ::ng-deep p { margin: 0 0 6px; }
    .tp__md ::ng-deep ul, .tp__md ::ng-deep ol { margin: 0 0 6px; padding-left: 18px; }
    .tp__how { display: flex; gap: 8px; font-size: 13px; line-height: 1.5; color: var(--cc-text-2, inherit); }
    .tp__how > mat-icon { color: #58a6ff; margin-top: 1px; }
    .tp__how .tp__md { max-height: none; }
    .tp__talk { margin-left: -8px; }
    .tp-acts { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 8px; }
    .tp-acts mat-icon { margin-right: 4px; }
    .tp-acts--compact { margin-top: 0; }
    .tp-c { display: flex; align-items: flex-start; gap: 8px; padding: 6px 10px; border-radius: 8px; font-size: 12.5px; line-height: 1.45;
      background: color-mix(in srgb, #e3b341 8%, transparent); }
    .tp-c--div { background: color-mix(in srgb, #f0883e 10%, transparent); }
    .tp-c__ico { font-size: 16px; width: 16px; height: 16px; flex: none; margin-top: 1px; color: #e3b341; }
    .tp-c--div .tp-c__ico { color: #f0883e; }
    .tp-c__text { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  `],
})
export class TaskPendencyComponent {
  readonly pendency = input.required<TaskPendency>();
  readonly planId = input<string | null | undefined>(null);
  readonly card = input<string | null | undefined>(null);
  readonly cardType = input<CaseCardType>('bug');
  readonly variant = input<'full' | 'compact'>('full');
  readonly readOnly = input(false);
  /** Divergência confirmada (o Claude retoma): quem usa recarrega o item/plano. */
  readonly confirmed = output<void>();

  private plans = inject(ExecutionPlanService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  readonly busy = signal(false);

  talk(): void {
    const card = `${this.card() ?? ''}`.trim();
    if (!card) return;
    openCaseChat(this.dialog, card, document.querySelector<HTMLElement>('app-case-compact .ck'), this.cardType());
  }

  confirm(): void {
    const planId = this.planId();
    if (!planId || this.busy()) return;
    this.busy.set(true);
    this.plans.confirmDivergence(planId).subscribe({
      next: () => {
        this.busy.set(false);
        this.snackBar.open('Divergência confirmada — o Claude segue com a etapa.', 'Ok', { duration: 5000 });
        this.confirmed.emit();
      },
      error: (err) => {
        this.busy.set(false);
        this.snackBar.open(planApiError(err, 'Não foi possível confirmar.'), 'Fechar', { duration: 8000 });
      }
    });
  }
}
