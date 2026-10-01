import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ArchitectureProject, ArchitectureQuestion, ArchitectureService } from '../../../services/architecture.service';
import { friendlyName } from './kb-friendly';

type Tab = 'open' | 'answered' | 'dismissed';

/**
 * Perguntas sem resposta (0040, admin): o que as pessoas perguntaram no "Pergunte" e a base não respondeu (ou
 * respondeu em parte), as mais perguntadas primeiro. Daqui o admin analisa a fundo, marca como respondida (com a
 * seção que passou a responder) ou descarta. A skill base-solvace resolve a mesma fila lendo o código
 * (`arch.sh perguntas`).
 */
@Component({
  selector: 'app-kb-questions',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  template: `
    <section class="qs" aria-label="Perguntas sem resposta">
      <div class="qs__head">
        <mat-icon>help_center</mat-icon>
        <strong>Perguntas que a base ainda não responde</strong>
        <span class="qs__muted">feitas no "Pergunte" — a skill base-solvace resolve lendo o código (<code>arch.sh perguntas</code>)</span>
        <span class="qs__spacer"></span>
        <button mat-icon-button (click)="closed.emit()" aria-label="Fechar"><mat-icon>close</mat-icon></button>
      </div>
      <div class="qs__tabs" role="tablist">
        @for (t of tabs; track t.key) {
          <button type="button" role="tab" class="qs__tab" [class.qs__tab--on]="tab() === t.key" (click)="load(t.key)">{{ t.label }}</button>
        }
      </div>
      @if (loading()) {
        <div class="qs__state"><mat-spinner diameter="22"></mat-spinner></div>
      } @else {
        @for (q of list(); track q.id) {
          <div class="qs__item">
            <div class="qs__line">
              <span class="qs__times" matTooltip="vezes que foi perguntada">{{ q.times }}×</span>
              <span class="qs__text">{{ q.text }}</span>
            </div>
            <div class="qs__meta">
              <span class="qs__chip qs__chip--{{ q.coverage }}">{{ coverageLabel(q.coverage) }}</span>
              @if (q.kind && q.kind !== 'outra') { <span class="qs__chip">{{ kindLabel(q.kind) }}</span> }
              <span>última: {{ q.lastAskedBy }} · {{ date(q.lastAskedAt) }}</span>
              @if (q.answeredProject) { <span>respondida por <strong>{{ projectName(q.answeredProject) }}</strong>{{ q.answeredSection ? ' › ' + q.answeredSection : '' }}</span> }
              @if (q.note) { <span class="qs__note">{{ q.note }}</span> }
            </div>
            @if (editing() === q.id) {
              <div class="qs__resolve">
                <select [(ngModel)]="projectKey" (ngModelChange)="sectionKey = ''" aria-label="Projeto">
                  <option value="">Sistema que responde…</option>
                  @for (p of sortedProjects(); track p.key) { <option [value]="p.key">{{ name(p) }}</option> }
                </select>
                <select [(ngModel)]="sectionKey" [disabled]="!projectKey" aria-label="Seção">
                  <option value="">Seção…</option>
                  @for (s of sectionsOf(projectKey); track s.key) { <option [value]="s.key">{{ s.title }}</option> }
                </select>
                <input [(ngModel)]="note" placeholder="o que foi publicado (opcional)" />
                <button mat-flat-button color="primary" [disabled]="!projectKey || busy()" (click)="resolve(q, 'answered')">Salvar</button>
                <button mat-button (click)="editing.set(null)">Cancelar</button>
              </div>
            } @else {
              <div class="qs__actions">
                <button mat-stroked-button (click)="ask.emit(q.text)" matTooltip="Pergunta de novo; se ainda não houver resposta, analise a fundo e proponha a seção">
                  <mat-icon>travel_explore</mat-icon>Perguntar / analisar a fundo</button>
                @if (q.status !== 'answered') {
                  <button mat-button (click)="startResolve(q)"><mat-icon>check</mat-icon>Marcar respondida</button>
                }
                @if (q.status === 'open') {
                  <button mat-button (click)="resolve(q, 'dismissed')"><mat-icon>block</mat-icon>Descartar</button>
                } @else {
                  <button mat-button (click)="resolve(q, 'open')"><mat-icon>undo</mat-icon>Reabrir</button>
                }
              </div>
            }
          </div>
        } @empty {
          <div class="qs__state"><mat-icon>check_circle</mat-icon>{{ tab() === 'open' ? 'Nenhuma pergunta sem resposta.' : 'Nada por aqui.' }}</div>
        }
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .qs { margin: 0 0 16px; padding: 12px 14px; border-radius: 12px; border: 1px solid color-mix(in srgb, #e3b341 45%, transparent);
      background: color-mix(in srgb, #e3b341 5%, transparent); }
    .qs__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .qs__head > mat-icon { color: #e3b341; }
    .qs__muted { font-size: 12px; opacity: .65; }
    .qs__muted code { font-size: 11.5px; }
    .qs__spacer { flex: 1 1 auto; }
    .qs__tabs { display: flex; gap: 4px; margin: 8px 0; }
    .qs__tab { border: none; border-radius: 999px; padding: 4px 12px; background: rgba(255,255,255,.05); color: inherit; font: inherit; font-size: 12.5px; cursor: pointer; }
    .qs__tab--on { background: var(--mat-sys-primary); color: var(--mat-sys-on-primary); }
    .qs__state { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 16px; font-size: 13px; opacity: .8; }
    .qs__item { padding: 10px 2px; border-top: 1px solid rgba(255,255,255,.06); }
    .qs__line { display: flex; align-items: baseline; gap: 10px; }
    .qs__times { flex: none; font-size: 12px; font-weight: 700; padding: 1px 8px; border-radius: 9px; background: rgba(255,255,255,.08); }
    .qs__text { font-size: 14px; font-weight: 600; }
    .qs__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin: 6px 0 4px; font-size: 12px; opacity: .85; }
    .qs__chip { font-size: 11px; padding: 0 8px; border-radius: 9px; background: rgba(255,255,255,.08); }
    .qs__chip--not-found { background: rgba(240,113,106,.18); color: #f0716a; }
    .qs__chip--partial { background: rgba(210,153,34,.18); color: #d29922; }
    .qs__chip--answered { background: rgba(63,185,80,.18); color: #3fb950; }
    .qs__note { font-style: italic; }
    .qs__actions, .qs__resolve { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .qs__actions button mat-icon { font-size: 17px; width: 17px; height: 17px; margin-right: 4px; }
    .qs__resolve select, .qs__resolve input { font: inherit; font-size: 13px; color: inherit; padding: 6px 8px; border-radius: 8px;
      border: 1px solid rgba(255,255,255,.14); background: rgba(0,0,0,.25); }
    .qs__resolve select option { background: #2a2a2a; }
    .qs__resolve input { flex: 1 1 200px; }
  `]
})
export class KbQuestionsComponent implements OnInit {
  private api = inject(ArchitectureService);
  private snackBar = inject(MatSnackBar);

  readonly projects = input<ArchitectureProject[]>([]);
  readonly closed = output<void>();
  /** Perguntar de novo (a tela abre o "Pergunte" com o texto). */
  readonly ask = output<string>();
  /** Quantas sem resposta em aberto (contador do botão). */
  readonly openCount = output<number>();

  readonly tabs: { key: Tab; label: string }[] = [
    { key: 'open', label: 'Sem resposta' }, { key: 'answered', label: 'Respondidas' }, { key: 'dismissed', label: 'Descartadas' }
  ];
  readonly tab = signal<Tab>('open');
  readonly list = signal<ArchitectureQuestion[]>([]);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly editing = signal<string | null>(null);
  readonly sortedProjects = computed(() => [...this.projects()].sort((a, b) => friendlyName(a).localeCompare(friendlyName(b))));
  projectKey = '';
  sectionKey = '';
  note = '';

  ngOnInit(): void { this.load('open'); }

  load(tab: Tab): void {
    this.tab.set(tab);
    this.loading.set(true);
    this.editing.set(null);
    this.api.questions(tab, tab === 'open').subscribe({
      next: list => { this.list.set(list); this.loading.set(false); if (tab === 'open') this.openCount.emit(list.length); },
      error: () => { this.list.set([]); this.loading.set(false); }
    });
  }

  startResolve(q: ArchitectureQuestion): void {
    this.editing.set(q.id);
    this.projectKey = q.suggestedProject && this.projects().some(p => p.key === q.suggestedProject) ? q.suggestedProject : '';
    this.sectionKey = this.projectKey ? (q.suggestedSection ?? '') : '';
    this.note = '';
  }

  resolve(q: ArchitectureQuestion, status: 'answered' | 'dismissed' | 'open'): void {
    this.busy.set(true);
    this.api.resolveQuestion(q.id, {
      status, projectKey: status === 'answered' ? this.projectKey || null : null, sectionKey: status === 'answered' ? this.sectionKey || null : null,
      note: status === 'answered' ? this.note.trim() || null : null
    }).subscribe({
      next: () => { this.busy.set(false); this.load(this.tab()); },
      error: err => { this.busy.set(false); this.snackBar.open(err?.error?.error ?? 'Não foi possível atualizar a pergunta.', 'Fechar', { duration: 6000 }); }
    });
  }

  sectionsOf(key: string) { return this.projects().find(p => p.key === key)?.sections ?? []; }
  name(p: ArchitectureProject): string { return friendlyName(p); }
  projectName(key: string): string { const p = this.projects().find(x => x.key === key); return p ? friendlyName(p) : key; }
  coverageLabel(c: string): string { return ({ 'not-found': 'sem resposta', partial: 'resposta parcial', answered: 'respondida', unknown: 'sem IA' } as Record<string, string>)[c] ?? c; }
  kindLabel(k: string): string { return ({ operacao: 'operação', regra: 'regra de negócio', tecnica: 'técnica' } as Record<string, string>)[k] ?? k; }
  date(v: string): string { const d = new Date(v); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
}
