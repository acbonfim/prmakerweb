import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { LessonsService } from '../../../../services/governance/lessons.service';
import {
  Lesson, LessonSignal, LessonStatusFilter, ORIGIN_LABEL, SIGNAL_LABEL, filterLessons, parseScope, scopeText, skillsOf, sourceCards,
  validateLesson,
} from '../../../../services/governance/lessons.logic';
import { formatDateTime } from '../../../../services/usage/usage.model';
import { apiErrorMessage } from '../../../../services/governance/governance.logic';
import { GovernanceStore } from '../governance.store';

interface Draft {
  id: number;
  scope: string;
  trigger: string;
  text: string;
  why: string;
}

/**
 * 0106: lições aprendidas — o que os agentes aprenderam com os próprios erros (gravadas por eles ao serem corrigidos ou a
 * partir dos sinais que o PRMake registra sozinho). As ativas entram sozinhas no que todo agente lê no início, as mais
 * reincidentes primeiro; nada aqui precisa de ação para funcionar. Aqui se confere, corrige o texto, aposenta e reativa.
 */
@Component({
  selector: 'app-gov-lessons',
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  template: `
    <div class="notice notice--info">
      Lições que os agentes aprenderam com erros. As <b>ativas</b> entram sozinhas nas regras do card e no contexto do especialista
      (as mais reincidentes primeiro) — o agente que erra e é corrigido grava a lição na hora, e a parecida reforça a existente.
      Os <b>sinais de erro</b> são acontecimentos que o PRMake percebeu sozinho; o próximo agente no card os transforma em lição.
    </div>
    @if (error()) { <div class="notice">{{ error() }}</div> }

    @if (signals().length) {
      <section class="panel">
        <div class="panel__head">
          <h2>Sinais de erro em aberto</h2>
          <span class="muted">{{ signals().length }}</span>
        </div>
        @for (s of signals(); track s.id) {
          <div class="lsn-signal">
            <span class="badge badge--warn">{{ signalLabel(s.kind) }}</span>
            <a class="mono" [routerLink]="['/auth/workbench']" [queryParams]="{ card: s.card }">{{ s.card }}</a>
            <span class="lsn-signal__text">{{ s.text }}</span>
            <span class="muted">{{ when(s.createdAt) }}</span>
            @if (dismissing() === s.id) {
              <input class="f-search" placeholder="Por que não é erro de agente?" [ngModel]="reason()" (ngModelChange)="reason.set($event)"
                     (keydown.enter)="dismiss(s)" aria-label="Motivo do descarte">
              <button mat-button type="button" (click)="dismiss(s)" [disabled]="!reason().trim()">Descartar</button>
              <button mat-icon-button type="button" (click)="dismissing.set(null)" aria-label="Cancelar"><mat-icon>close</mat-icon></button>
            } @else {
              <button mat-button type="button" class="ms-auto" (click)="startDismiss(s.id)" matTooltip="Não foi erro de agente">Descartar</button>
            }
          </div>
        }
      </section>
    }

    <section class="panel">
      <div class="panel__head">
        <h2>Lições aprendidas</h2>
        <span class="muted">{{ visible().length }} de {{ lessons().length }}</span>
        <span class="ms-auto"></span>
        <div class="seg" role="radiogroup" aria-label="Situação">
          @for (o of statuses; track o.key) {
            <button type="button" class="seg__item" [class.on]="status() === o.key" role="radio" [attr.aria-checked]="status() === o.key"
                    (click)="setStatus(o.key)">{{ o.label }}</button>
          }
        </div>
        <select class="f-search" [ngModel]="skill()" (ngModelChange)="skill.set($event || null)" aria-label="Skill">
          <option value="">Todas as skills</option>
          @for (k of skills(); track k) { <option [value]="k">{{ k }}</option> }
        </select>
        <input class="f-search" type="search" placeholder="Buscar (L12, card, texto)" [ngModel]="search()" (ngModelChange)="search.set($event)"
               data-usage-ignore>
        @if (loading()) { <mat-spinner diameter="18"></mat-spinner> }
      </div>

      @for (l of visible(); track l.id) {
        <article class="lsn" [class.lsn--retired]="l.status === 'retired'">
          <div class="lsn__head">
            <span class="mono lsn__code">{{ l.code }}</span>
            @if (l.hits > 1) {
              <span class="badge badge--block" [matTooltip]="'O mesmo erro aconteceu ' + l.hits + ' vezes'">{{ l.hits }}× reincidente</span>
            }
            <span class="pill">{{ scope(l.scope) }}</span>
            @if (l.status === 'retired') { <span class="badge badge--off">aposentada</span> }
            <span class="muted">{{ origin(l) }} · visto {{ when(l.lastSeenAt) }}</span>
            <span class="ms-auto"></span>
            @if (draft()?.id !== l.id) {
              <button mat-icon-button type="button" (click)="edit(l)" matTooltip="Editar" aria-label="Editar"><mat-icon>edit</mat-icon></button>
              @if (l.status === 'active') {
                <button mat-icon-button type="button" (click)="startRetire(l.id)" matTooltip="Aposentar (deixa de entrar no que os agentes leem)"
                        aria-label="Aposentar"><mat-icon>archive</mat-icon></button>
              } @else {
                <button mat-icon-button type="button" (click)="reactivate(l)" matTooltip="Reativar" aria-label="Reativar"><mat-icon>unarchive</mat-icon></button>
              }
            }
          </div>

          @if (draft()?.id === l.id) {
            <div class="form-grid lsn__form">
              <label class="f-field"><span>Quando (a situação)</span>
                <textarea rows="2" [ngModel]="draft()!.trigger" (ngModelChange)="patch({ trigger: $event })"></textarea></label>
              <label class="f-field"><span>Lição (o que fazer ou nunca fazer)</span>
                <textarea rows="3" [ngModel]="draft()!.text" (ngModelChange)="patch({ text: $event })"></textarea></label>
              <label class="f-field"><span>Por quê (o que aconteceu)</span>
                <textarea rows="2" [ngModel]="draft()!.why" (ngModelChange)="patch({ why: $event })"></textarea></label>
              <label class="f-field"><span>Skills (separadas por vírgula; vazio = todas)</span>
                <input [ngModel]="draft()!.scope" (ngModelChange)="patch({ scope: $event })"></label>
              @if (draftError() || validation(); as msg) { <span class="f-error">{{ msg }}</span> }
              <div class="actions-row">
                <button mat-button type="button" (click)="draft.set(null)">Cancelar</button>
                <button mat-flat-button type="button" (click)="save()" [disabled]="saving() || !!validation()">Salvar</button>
              </div>
            </div>
          } @else {
            <p class="lsn__rule"><span class="muted">Quando</span> {{ l.trigger }} <mat-icon class="lsn__arrow">arrow_forward</mat-icon> <b>{{ l.text }}</b></p>
            @if (l.why) { <p class="muted lsn__why">{{ l.why }}</p> }
            <div class="lsn__sources">
              @for (c of cards(l); track c) {
                <a class="pill" [routerLink]="['/auth/workbench']" [queryParams]="{ card: c }">{{ c }}</a>
              }
              @if (l.retiredReason) { <span class="muted">— {{ l.retiredReason }}</span> }
            </div>
          }

          @if (retiring() === l.id) {
            <div class="actions-row">
              <input class="f-search" placeholder="Por que aposentar?" [ngModel]="reason()" (ngModelChange)="reason.set($event)"
                     (keydown.enter)="retire(l)" aria-label="Motivo">
              <button mat-button type="button" (click)="retiring.set(null)">Cancelar</button>
              <button mat-flat-button type="button" (click)="retire(l)">Aposentar</button>
            </div>
          }
        </article>
      } @empty {
        <p class="muted">{{ loading() ? 'Carregando…' : 'Nenhuma lição.' }}</p>
      }
    </section>
  `,
  styleUrls: ['../governance-shared.css'],
  styles: [`
    .lsn { border-top: 1px solid var(--cc-border, rgba(255,255,255,.08)); padding: 10px 0; display: flex; flex-direction: column; gap: 6px; }
    .lsn--retired { opacity: .6; }
    .lsn__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .lsn__code { font-weight: 600; }
    .lsn__rule { margin: 0; line-height: 1.5; }
    .lsn__arrow { font-size: 16px; width: 16px; height: 16px; vertical-align: -3px; opacity: .6; }
    .lsn__why { margin: 0; font-size: 12px; }
    .lsn__sources { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .lsn__form textarea, .lsn__form input { width: 100%; }
    .lsn-signal { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 0;
      border-top: 1px solid var(--cc-border, rgba(255,255,255,.08)); }
    .lsn-signal__text { flex: 1 1 320px; }
  `],
})
export class GovLessonsComponent {
  readonly store = inject(GovernanceStore);
  private readonly api = inject(LessonsService);

  readonly statuses: { key: LessonStatusFilter; label: string }[] = [
    { key: 'active', label: 'Ativas' }, { key: 'retired', label: 'Aposentadas' }, { key: 'all', label: 'Todas' },
  ];

  readonly lessons = signal<Lesson[]>([]);
  readonly signals = signal<LessonSignal[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly status = signal<LessonStatusFilter>('active');
  readonly skill = signal<string | null>(null);
  readonly search = signal('');
  readonly draft = signal<Draft | null>(null);
  readonly draftError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly retiring = signal<number | null>(null);
  readonly dismissing = signal<number | null>(null);
  readonly reason = signal('');

  readonly visible = computed(() => filterLessons(this.lessons(), this.search(), this.skill()));
  readonly skills = computed(() => skillsOf(this.lessons()));
  readonly validation = computed(() => {
    const d = this.draft();
    return d ? validateLesson({ ...d, scope: parseScope(d.scope) }) : null;
  });

  readonly scope = scopeText;
  readonly cards = sourceCards;
  readonly when = formatDateTime;

  constructor() {
    this.load();
  }

  load(): void {
    if (this.store.demo) return;
    this.loading.set(true);
    this.error.set(null);
    const status = this.status() === 'all' ? null : this.status();
    this.api.list(status).subscribe({
      next: (l) => { this.lessons.set(l ?? []); this.loading.set(false); },
      error: (e) => { this.error.set(apiErrorMessage(e, 'Não foi possível ler as lições.')); this.loading.set(false); },
    });
    this.api.signals('open').subscribe({ next: (s) => this.signals.set(s ?? []), error: () => this.signals.set([]) });
  }

  setStatus(s: LessonStatusFilter): void {
    if (s === this.status()) return;
    this.status.set(s);
    this.load();
  }

  origin(l: Lesson): string {
    return ORIGIN_LABEL[l.origin] ?? l.origin;
  }

  signalLabel(kind: string): string {
    return SIGNAL_LABEL[kind] ?? kind;
  }

  edit(l: Lesson): void {
    this.retiring.set(null);
    this.draftError.set(null);
    this.draft.set({ id: l.id, scope: l.scope.join(', '), trigger: l.trigger, text: l.text, why: l.why });
  }

  patch(p: Partial<Draft>): void {
    const d = this.draft();
    if (d) this.draft.set({ ...d, ...p });
  }

  save(): void {
    const d = this.draft();
    if (!d || this.validation()) return;
    this.saving.set(true);
    this.api.edit(d.id, { scope: parseScope(d.scope), trigger: d.trigger.trim(), text: d.text.trim(), why: d.why.trim() }).subscribe({
      next: (l) => { this.replace(l); this.draft.set(null); this.saving.set(false); },
      error: (e) => { this.draftError.set(apiErrorMessage(e, 'Não foi possível salvar.')); this.saving.set(false); },
    });
  }

  startRetire(id: number): void {
    this.draft.set(null);
    this.reason.set('');
    this.retiring.set(id);
  }

  retire(l: Lesson): void {
    this.api.retire(l.id, this.reason().trim() || 'Aposentada na tela.').subscribe({
      next: (x) => { this.retiring.set(null); this.status() === 'active' ? this.remove(x.id) : this.replace(x); },
      error: (e) => this.error.set(apiErrorMessage(e, 'Não foi possível aposentar.')),
    });
  }

  reactivate(l: Lesson): void {
    this.api.reactivate(l.id).subscribe({
      next: (x) => (this.status() === 'retired' ? this.remove(x.id) : this.replace(x)),
      error: (e) => this.error.set(apiErrorMessage(e, 'Não foi possível reativar.')),
    });
  }

  startDismiss(id: number): void {
    this.reason.set('');
    this.dismissing.set(id);
  }

  dismiss(s: LessonSignal): void {
    const reason = this.reason().trim();
    if (!reason) return;
    this.api.dismiss(s.id, reason).subscribe({
      next: () => { this.dismissing.set(null); this.signals.set(this.signals().filter((x) => x.id !== s.id)); },
      error: (e) => this.error.set(apiErrorMessage(e, 'Não foi possível descartar o sinal.')),
    });
  }

  private replace(l: Lesson): void {
    this.lessons.set(this.lessons().map((x) => (x.id === l.id ? l : x)));
  }

  private remove(id: number): void {
    this.lessons.set(this.lessons().filter((x) => x.id !== id));
  }
}
