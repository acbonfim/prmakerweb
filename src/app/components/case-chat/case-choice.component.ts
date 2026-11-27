import { Component, computed, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { CaseChoice, CaseChoiceOption, CaseChoicePick } from './case-chat.model';
import { canSendChoice, choicePick } from './case-choice.logic';

/**
 * 0107: escolha clicável do especialista dentro da bolha — botões (cada um responde na hora), escolha única, checklist
 * ou lista suspensa, com "outra resposta" quando ele permite. Respondida, fica travada mostrando o que foi escolhido.
 */
@Component({
  selector: 'app-case-choice',
  standalone: true,
  imports: [DatePipe, FormsModule, MatIconModule],
  template: `
    @let c = choice();
    <div class="chx" [class.chx--done]="!open()" [class.chx--compact]="compact()" role="group" [attr.aria-label]="c.question || 'Escolha do especialista'">
      @if (c.question) { <div class="chx__q">{{ c.question }}</div> }

      @if (open()) {
        @switch (c.mode) {
          @case ('buttons') {
            <div class="chx__btns">
              @for (o of c.options; track o.id) {
                <button type="button" class="chx__btn chx__btn--{{ o.style }}" [disabled]="busy()" (click)="send([o.id])" [attr.title]="o.detail || null">
                  @if (o.recommended) { <mat-icon>star</mat-icon> }{{ o.label }}
                </button>
              }
            </div>
          }
          @case ('select') {
            <select class="chx__select" [ngModel]="picked()[0] || ''" (ngModelChange)="pickOne($event)" [disabled]="busy()" aria-label="Escolha uma opção">
              <option value="" disabled>Escolha…</option>
              @for (o of c.options; track o.id) { <option [value]="o.id">{{ o.label }}{{ o.recommended ? ' (recomendada)' : '' }}</option> }
            </select>
            @if (detailOf(picked()[0]); as d) { <div class="chx__detail">{{ d }}</div> }
          }
          @default {
            <div class="chx__list" [attr.role]="c.mode === 'single' ? 'radiogroup' : null">
              @for (o of c.options; track o.id) {
                <button type="button" class="chx__opt" [class.chx__opt--on]="isPicked(o)" [disabled]="busy()"
                        [attr.role]="c.mode === 'single' ? 'radio' : 'checkbox'" [attr.aria-checked]="isPicked(o)" (click)="toggle(o)">
                  <mat-icon class="chx__mark">{{ markIcon(o) }}</mat-icon>
                  <span class="chx__txt">
                    <b>{{ o.label }}@if (o.recommended) { <i class="chx__rec">recomendada</i> }</b>
                    @if (o.detail) { <small>{{ o.detail }}</small> }
                  </span>
                </button>
              }
            </div>
          }
        }
        @if (c.allowOther) {
          <input class="chx__other" type="text" [ngModel]="other()" (ngModelChange)="typeOther($event)" [disabled]="busy()"
                 [placeholder]="c.otherLabel || 'Outra resposta'" (keydown.enter)="submit()" [attr.aria-label]="c.otherLabel || 'Outra resposta'">
        }
        @if (c.mode !== 'buttons' || other().trim()) {
          <div class="chx__foot">
            <button type="button" class="chx__btn chx__btn--primary" [disabled]="busy() || !canSend()" (click)="submit()">
              <mat-icon>send</mat-icon>{{ busy() ? 'Enviando…' : 'Enviar' }}
            </button>
          </div>
        }
      } @else {
        <div class="chx__chosen">
          @for (o of shown(); track o.id) {
            <span class="chx__pill" [class.chx__pill--on]="chosen(o)"><mat-icon>{{ chosen(o) ? 'check_circle' : 'radio_button_unchecked' }}</mat-icon>{{ o.label }}</span>
          }
          @if (c.answer?.other; as t) { <span class="chx__pill chx__pill--on"><mat-icon>edit_note</mat-icon>{{ t }}</span> }
        </div>
        <div class="chx__by">
          @if (c.answer; as a) { Respondido por {{ a.by }} · {{ a.at | date: 'dd/MM HH:mm' }} }
          @else { Substituída por uma escolha mais nova — sem resposta }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; margin-top: 8px; }
    .chx { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 10px; border: 1px solid rgba(196,167,255,.35);
      background: rgba(142,108,240,.08); font-size: 13px; }
    .chx--compact { padding: 8px; gap: 6px; font-size: 12.5px; }
    .chx--done { background: transparent; border-style: dashed; border-color: rgba(127,127,127,.35); }
    .chx__q { font-weight: 600; }
    .chx__btns { display: flex; flex-wrap: wrap; gap: 6px; }
    .chx__btn { display: inline-flex; align-items: center; gap: 5px; min-height: 32px; padding: 5px 12px; border-radius: 8px; cursor: pointer;
      font: inherit; font-weight: 600; border: 1px solid rgba(127,127,127,.45); background: transparent; color: inherit; text-align: left; }
    .chx__btn mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .chx__btn:hover:not(:disabled) { background: rgba(127,127,127,.12); }
    .chx__btn--primary { background: #8e6cf0; border-color: #8e6cf0; color: #fff; }
    .chx__btn--primary:hover:not(:disabled) { background: #7b58e6; }
    .chx__btn--danger { border-color: rgba(248,81,73,.6); color: #f85149; }
    .chx__btn--danger:hover:not(:disabled) { background: rgba(248,81,73,.1); }
    .chx__btn:disabled { opacity: .5; cursor: default; }
    .chx__list { display: flex; flex-direction: column; gap: 4px; }
    .chx__opt { display: flex; align-items: flex-start; gap: 8px; width: 100%; padding: 7px 9px; border-radius: 8px; cursor: pointer; font: inherit;
      color: inherit; text-align: left; border: 1px solid rgba(127,127,127,.3); background: transparent; }
    .chx__opt:hover:not(:disabled) { border-color: rgba(196,167,255,.7); }
    .chx__opt--on { border-color: #8e6cf0; background: rgba(142,108,240,.16); }
    .chx__mark { flex: none; font-size: 18px; width: 18px; height: 18px; color: #a98bf5; }
    .chx__txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; overflow-wrap: anywhere; }
    .chx__txt small, .chx__detail { opacity: .7; font-size: 11.5px; }
    .chx__rec { margin-left: 6px; font-style: normal; font-weight: 600; font-size: 10.5px; padding: 1px 6px; border-radius: 9px;
      background: rgba(63,185,80,.18); color: #3fb950; }
    .chx__select, .chx__other { width: 100%; box-sizing: border-box; min-height: 34px; padding: 6px 9px; border-radius: 8px; font: inherit;
      color: inherit; background: var(--surface-input, rgba(127,127,127,.08)); border: 1px solid rgba(127,127,127,.4); }
    .chx__select option { color: initial; }
    .chx__foot { display: flex; justify-content: flex-end; }
    .chx__chosen { display: flex; flex-wrap: wrap; gap: 5px; }
    .chx__pill { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 12px; font-size: 12px; opacity: .5;
      border: 1px solid rgba(127,127,127,.35); overflow-wrap: anywhere; }
    .chx__pill mat-icon { font-size: 15px; width: 15px; height: 15px; flex: none; }
    .chx__pill--on { opacity: 1; border-color: #8e6cf0; background: rgba(142,108,240,.16); font-weight: 600; }
    .chx__pill--on mat-icon { color: #a98bf5; }
    .chx__by { font-size: 11px; opacity: .65; }
  `]
})
export class CaseChoiceComponent {
  readonly choice = input.required<CaseChoice>();
  readonly busy = input(false);
  readonly compact = input(false);
  readonly answer = output<CaseChoicePick>();

  readonly picked = signal<string[]>([]);
  readonly other = signal('');

  readonly open = computed(() => !this.choice().answer && !this.choice().closedAt);
  readonly canSend = computed(() => canSendChoice(this.choice(), this.picked(), this.other()));
  /** Respondida: nos botões e na lista só o escolhido; na escolha única e no checklist, todas (o escolhido marcado). */
  readonly shown = computed(() => {
    const c = this.choice();
    return c.mode === 'buttons' || c.mode === 'select' ? c.options.filter((o) => this.chosen(o)) : c.options;
  });

  isPicked(o: CaseChoiceOption): boolean {
    return this.picked().includes(o.id);
  }

  chosen(o: CaseChoiceOption): boolean {
    return !!this.choice().answer?.selected.includes(o.id);
  }

  markIcon(o: CaseChoiceOption): string {
    const on = this.isPicked(o);
    return this.choice().mode === 'multi' ? (on ? 'check_box' : 'check_box_outline_blank') : (on ? 'radio_button_checked' : 'radio_button_unchecked');
  }

  detailOf(id: string | undefined): string | null {
    return id ? this.choice().options.find((o) => o.id === id)?.detail ?? null : null;
  }

  toggle(o: CaseChoiceOption): void {
    if (this.choice().mode === 'multi') {
      this.picked.update((p) => (p.includes(o.id) ? p.filter((x) => x !== o.id) : [...p, o.id]));
      return;
    }
    this.picked.set([o.id]);
    this.other.set('');
  }

  pickOne(id: string): void {
    this.picked.set(id ? [id] : []);
    this.other.set('');
  }

  /** Escreveu outra resposta: na escolha única/lista ela toma o lugar da opção marcada. */
  typeOther(text: string): void {
    this.other.set(text);
    if (text.trim() && this.choice().mode !== 'multi') this.picked.set([]);
  }

  send(selected: string[]): void {
    if (this.busy()) return;
    this.answer.emit({ selected, other: null });
  }

  submit(): void {
    if (this.busy() || !this.canSend()) return;
    this.answer.emit(choicePick(this.choice(), this.picked(), this.other()));
  }
}
