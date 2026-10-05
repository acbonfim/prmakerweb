import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PlanMarkdownPipe } from '../../../components/execution-plan/plan-markdown.pipe';
import { ReverseEngineeringService, ReverseRevision } from '../../../services/reverse-engineering.service';

/**
 * Revisão de um documento da engenharia reversa (0052): o que o Claude enviou — resumo, cobertura do inventário do
 * código, checagem (erros/avisos) e a diferença por item contra o publicado — e as ações do aprovador (aprovar e
 * publicar, pedir ajustes, descartar) e a edição do rascunho.
 */
@Component({
  selector: 'app-re-revision',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, PlanMarkdownPipe],
  template: `
    @if (loading()) { <div class="state"><mat-spinner diameter="24"></mat-spinner></div> }
    @if (rev(); as r) {
      <section class="rev">
        <header class="rev__head">
          <mat-icon>rate_review</mat-icon>
          <b>Revisão #{{ r.number }}</b>
          <span class="badge" [class]="'badge badge--' + r.status">{{ statusLabel(r.status) }}</span>
          <span class="muted">{{ modeLabel(r.mode) }} · {{ r.createdBy }} · {{ date(r.submittedAt || r.updatedAt) }}</span>
          <span class="spacer"></span>
          @if (r.coverageRatio != null) {
            <span class="cov" [class.cov--low]="r.coverageRatio < 0.9" matTooltip="Quanto do inventário do código (endpoints, validações, tabelas, telas...) o documento cita">
              cobertura {{ pct(r.coverageRatio) }}</span>
          }
          @if (r.lint) { <span class="muted">{{ r.lint.items }} itens</span> }
        </header>

        @if (r.summary) { <div class="rev__summary" [innerHTML]="r.summary | planMarkdown"></div> }
        @if (r.reviewNote) { <div class="note"><mat-icon>edit_note</mat-icon><span><b>Nota do revisor:</b> {{ r.reviewNote }}</span></div> }
        @if (r.publishedChangedSinceBase) {
          <div class="warn"><mat-icon>warning</mat-icon>A versão publicada mudou (v{{ r.currentPublishedVersion }}) depois que este rascunho começou (v{{ r.baseVersion ?? '—' }}).</div>
        }

        @if (r.lint; as l) {
          <div class="chips">
            @for (k of kindEntries(); track k[0]) { <span class="chip">{{ k[0] }} {{ k[1] }}</span> }
          </div>
          @if (l.errors.length) {
            <div class="block block--err"><b>Erros (barram a publicação)</b><ul>@for (e of l.errors; track $index) { <li>{{ e }}</li> }</ul></div>
          }
          @if (l.warnings.length) {
            <div class="block block--warn"><b>Avisos</b><ul>@for (w of l.warnings; track $index) { <li>{{ w }}</li> }</ul></div>
          }
        }

        @if (r.coverage?.byCategory; as cats) {
          <details class="block">
            <!-- 0054: na visão prática a cobertura é das perguntas reais do "Pergunte" sobre o módulo -->
            <summary>{{ cats['pergunta'] ? 'Perguntas reais respondidas' : 'Cobertura do inventário do código' }} — {{ r.coverage?.covered }}/{{ r.coverage?.total }}
              @if (r.coverage?.missingCount) { · {{ r.coverage?.missingCount }} sem menção }</summary>
            <div class="chips">@for (c of catEntries(); track c[0]) { <span class="chip">{{ c[0] }} {{ c[1].covered }}/{{ c[1].total }}</span> }</div>
            @if (r.coverage?.outsideGlossary?.length) {
              <!-- 0056: termos fora do domínio/de outro módulo registrados numa lacuna — contam, mas o revisor vê o motivo -->
              <div class="muted outside">Fora do glossário (em lacuna) — {{ r.coverage!.outsideGlossary!.length }}:
                @for (o of r.coverage!.outsideGlossary!.slice(0, 80); track $index) { <span class="chip">{{ o.name }} · {{ o.gap }}</span> }</div>
            }
            @if (r.coverage?.missing?.length) {
              <ul class="missing">
                @for (m of r.coverage!.missing!.slice(0, 120); track $index) {
                  <li><span class="chip">{{ m.cat }}</span> {{ m.name }} @if (m.file) { <span class="muted">{{ m.file }}:{{ m.line }}</span> }</li>
                }
              </ul>
            }
          </details>
        }

        @if (r.suggestionDecisions?.length) {
          <div class="block">
            <b>Sugestões tratadas nesta revisão</b> <span class="muted">(saem da fila ao publicar; o card de origem fica sabendo pela Timeline)</span>
            <ul class="decisions">
              @for (d of r.suggestionDecisions; track d.suggestionId) {
                <li [class.dec--ok]="d.decision === 'applied'" [class.dec--no]="d.decision !== 'applied'">
                  <span class="chip">{{ d.decision === 'applied' ? 'aplicada' : 'recusada' }}</span>
                  @if (d.items.length) { <span class="id">{{ d.items.join(', ') }}</span> }
                  {{ d.note }}
                  <div class="muted">{{ d.kind }}{{ d.cardNumber ? ' · card ' + d.cardNumber : '' }}{{ d.status && d.status !== 'pending' ? ' · já ' + d.status : '' }} — {{ d.content }}</div>
                </li>
              }
            </ul>
          </div>
        }

        @if (r.diff; as d) {
          <div class="diff">
            <div class="diff__head">
              <b>O que muda na Base Solvace</b>
              <span class="chip chip--add">+{{ d.added }} novos</span>
              <span class="chip chip--chg">~{{ d.changed }} alterados</span>
              <span class="chip chip--rem">−{{ d.removed }} removidos</span>
              <span class="muted">{{ d.unchanged }} iguais{{ d.otherTextChanged ? ' · texto fora dos itens mudou' : '' }}</span>
            </div>
            @for (i of d.items; track i.id) {
              <details class="diff__item" [class]="'diff__item diff__item--' + i.change">
                <summary><span class="id">{{ i.id }}</span> {{ i.title }} <span class="muted">({{ changeLabel(i.change) }})</span></summary>
                <div class="diff__cols">
                  @if (i.before) { <div><div class="muted">Publicado</div><pre>{{ i.before }}</pre></div> }
                  @if (i.after) { <div><div class="muted">{{ i.change === 'removed' ? 'Agora' : 'Revisão' }}</div><pre>{{ i.after }}</pre></div> }
                </div>
              </details>
            }
          </div>
        }

        <div class="actions">
          <button mat-stroked-button type="button" (click)="showDoc.set(!showDoc())"><mat-icon>article</mat-icon>{{ showDoc() ? 'Esconder' : 'Ver' }} o documento</button>
          @if (canEdit()) {
            <button mat-stroked-button type="button" (click)="startEdit()"><mat-icon>edit</mat-icon>Editar</button>
          }
          <span class="spacer"></span>
          @if (r.canApprove && (r.status === 'review' || r.status === 'approved')) {
            <button mat-stroked-button type="button" (click)="mode.set(mode() === 'changes' ? null : 'changes')"><mat-icon>edit_note</mat-icon>Pedir ajustes</button>
            <button mat-stroked-button type="button" color="warn" (click)="act('discard')" [disabled]="busy()"><mat-icon>delete</mat-icon>Descartar</button>
            @if (r.status === 'review') {
              <button mat-stroked-button type="button" (click)="act('approve')" [disabled]="busy()"><mat-icon>task_alt</mat-icon>Aprovar</button>
            }
            <button mat-flat-button type="button" color="primary" (click)="publish()" [disabled]="busy() || (r.lint?.errors?.length ?? 0) > 0"
                    matTooltip="Grava na Base Solvace (seção do documento + índice por item) e as análises passam a usar">
              <mat-icon>publish</mat-icon>{{ r.status === 'review' ? 'Aprovar e publicar' : 'Publicar' }}
            </button>
          }
          @if (r.canApprove && (r.status === 'draft' || r.status === 'changes')) {
            <button mat-stroked-button type="button" color="warn" (click)="act('discard')" [disabled]="busy()"><mat-icon>delete</mat-icon>Descartar rascunho</button>
          }
        </div>
        @if (!r.canApprove && (r.status === 'review' || r.status === 'approved')) {
          <div class="muted">Aguardando um aprovador revisar e publicar.</div>
        }

        @if (mode() === 'changes') {
          <div class="form">
            <textarea rows="4" [(ngModel)]="note" placeholder="O que precisa mudar? (vai para o Claude na próxima sessão: /engenharia-reversa melhorar …)"></textarea>
            <button mat-flat-button color="primary" type="button" (click)="act('changes')" [disabled]="busy() || !note.trim()">Enviar pedido de ajustes</button>
          </div>
        }
        @if (editing()) {
          <div class="form">
            <textarea class="mono" rows="24" [(ngModel)]="draft"></textarea>
            <div class="form__row">
              <button mat-flat-button color="primary" type="button" (click)="saveEdit()" [disabled]="busy()">Salvar</button>
              <button mat-button type="button" (click)="editing.set(false)">Cancelar</button>
              <span class="muted">Mantenha os IDs dos itens (### RN-012 — …). A checagem roda ao salvar.</span>
            </div>
          </div>
        }
        @if (showDoc() && !editing()) { <div class="md" [innerHTML]="r.content | planMarkdown"></div> }
      </section>
    }
  `,
  styles: [`
    .state { display: flex; justify-content: center; padding: 16px; }
    .rev { padding: 12px 16px; border-radius: 10px; background: rgba(163,113,247,.06); border: 1px solid rgba(163,113,247,.3); margin: 10px 0; }
    .rev__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13.5px; }
    .rev__head mat-icon { color: #a371f7; }
    .rev__summary { font-size: 13px; margin: 8px 0; }
    .spacer { flex: 1; }
    .muted { font-size: 12px; opacity: .65; }
    .badge { font-size: 11.5px; padding: 1px 8px; border-radius: 9px; background: rgba(255,255,255,.08); }
    .badge--review { color: #a371f7; } .badge--approved { color: #39c5cf; } .badge--published { color: #3fb950; } .badge--changes { color: #d29922; }
    .cov { font-size: 12px; padding: 1px 8px; border-radius: 9px; color: #3fb950; background: rgba(63,185,80,.12); }
    .cov--low { color: #d29922; background: rgba(210,153,34,.14); }
    .note, .warn { display: flex; gap: 6px; align-items: flex-start; font-size: 12.5px; margin: 6px 0; }
    .note { color: #d29922; } .warn { color: #d29922; }
    .note mat-icon, .warn mat-icon { font-size: 17px; width: 17px; height: 17px; flex: none; }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0; }
    .chip { font-size: 11.5px; padding: 1px 7px; border-radius: 8px; background: rgba(255,255,255,.07); }
    .chip--add { color: #3fb950; } .chip--chg { color: #d29922; } .chip--rem { color: #f85149; }
    .block { font-size: 12.5px; margin: 6px 0; padding: 6px 10px; border-radius: 8px; background: rgba(255,255,255,.03); }
    .block ul { margin: 4px 0 0; padding-left: 18px; }
    .block--err { border-left: 3px solid #f85149; } .block--warn { border-left: 3px solid #d29922; }
    .block summary { cursor: pointer; }
    .missing { list-style: none; padding: 0; max-height: 260px; overflow-y: auto; }
    .decisions { list-style: none; padding: 0; margin: 6px 0 0; display: flex; flex-direction: column; gap: 6px; }
    .decisions li { padding-left: 8px; border-left: 3px solid transparent; }
    .dec--ok { border-left-color: #3fb950 !important; } .dec--no { border-left-color: #d29922 !important; }
    .diff { margin: 10px 0; }
    .diff__head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 13px; margin-bottom: 6px; }
    .diff__item { font-size: 12.5px; border-left: 3px solid transparent; padding: 2px 8px; }
    .diff__item--added { border-left-color: #3fb950; } .diff__item--changed { border-left-color: #d29922; } .diff__item--removed { border-left-color: #f85149; }
    .diff__item summary { cursor: pointer; }
    .id { font-family: 'JetBrains Mono', monospace; font-weight: 600; }
    .diff__cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; margin: 6px 0; }
    pre { white-space: pre-wrap; font-size: 12px; padding: 8px; border-radius: 6px; background: rgba(0,0,0,.3); margin: 2px 0; max-height: 360px; overflow: auto; }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 10px; }
    .form { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
    .form textarea { width: 100%; box-sizing: border-box; padding: 8px; border-radius: 8px; background: rgba(0,0,0,.3); color: inherit;
      border: 1px solid rgba(255,255,255,.15); font: inherit; font-size: 13px; }
    .form textarea.mono { font-family: 'JetBrains Mono', monospace; font-size: 12px; }
    .form__row { display: flex; gap: 8px; align-items: center; }
    .md { margin-top: 10px; font-size: 13.5px; line-height: 1.6; max-height: 70vh; overflow-y: auto; padding-right: 8px; }
    /* 0056: tabelas no preview da revisão — mesmo tratamento do documento publicado (sem espremer coluna a 1 letra). */
    .md ::ng-deep table { border-collapse: collapse; margin: 10px 0; display: block; overflow-x: auto; max-width: 100%; }
    .md ::ng-deep th, .md ::ng-deep td { border: 1px solid rgba(255,255,255,.12); padding: 5px 9px; text-align: left;
      overflow-wrap: normal; word-break: normal; min-width: 9ch; vertical-align: top; }
    .md ::ng-deep th { white-space: nowrap; }
    .md ::ng-deep td code, .md ::ng-deep th code { white-space: nowrap; }
    .md ::ng-deep code { font-family: 'JetBrains Mono', 'Courier New', monospace; font-size: 12px; }
    .md ::ng-deep :not(pre) > code { padding: 1px 5px; border-radius: 4px; background: rgba(255,255,255,.07); }
  `]
})
export class ReRevisionComponent {
  private api = inject(ReverseEngineeringService);
  private snack = inject(MatSnackBar);
  revisionId = input.required<string>();
  /** Recarrega quando a revisão muda (tempo real). */
  stamp = input<string | null | undefined>(null);
  actor = input<string>('');
  changed = output<ReverseRevision>();
  /** Decisão tomada (aprovou, publicou, pediu ajustes, descartou) — a tela volta ao topo; salvar rascunho não conta. */
  decided = output<ReverseRevision>();

  rev = signal<ReverseRevision | null>(null);
  loading = signal(false);
  busy = signal(false);
  showDoc = signal(false);
  editing = signal(false);
  mode = signal<'changes' | null>(null);
  note = '';
  draft = '';

  kindEntries = computed(() => Object.entries(this.rev()?.lint?.byKind ?? {}));
  catEntries = computed(() => Object.entries(this.rev()?.coverage?.byCategory ?? {}));
  canEdit = computed(() => {
    const r = this.rev();
    return !!r && ['draft', 'changes', 'review', 'approved'].includes(r.status) && (r.canApprove || r.createdBy === this.actor());
  });

  constructor() {
    effect(() => {
      const id = this.revisionId();
      this.stamp();
      // load() lê e grava `rev`/`loading`: sem untracked o effect se re-executava a cada resposta (loop de GET, ~2/s)
      untracked(() => this.load(id));
    });
  }

  load(id: string) {
    this.loading.set(!this.rev());
    this.api.revision(id).subscribe({
      next: r => { this.rev.set(r); this.loading.set(false); },
      error: e => { this.loading.set(false); this.toast(e); }
    });
  }

  act(action: 'approve' | 'changes' | 'discard') {
    const r = this.rev(); if (!r) return;
    if (action === 'discard' && !confirm(`Descartar a revisão #${r.number}? O publicado continua como está.`)) return;
    this.busy.set(true);
    this.api.review(r.id, action, action === 'changes' ? this.note : null).subscribe({
      next: x => { this.busy.set(false); this.mode.set(null); this.note = ''; this.snack.open(this.actionDone(action), 'OK', { duration: 3000 }); this.load(x.id); this.changed.emit(x); this.decided.emit(x); },
      error: e => { this.busy.set(false); this.toast(e); }
    });
  }

  publish() {
    const r = this.rev(); if (!r) return;
    this.busy.set(true);
    this.api.publish(r.id, r.status === 'review').subscribe({
      next: x => { this.busy.set(false); this.snack.open('Publicado — já vale na Base Solvace e nas análises.', 'OK', { duration: 4000 }); this.load(x.id); this.changed.emit(x); this.decided.emit(x); },
      error: e => { this.busy.set(false); this.toast(e); }
    });
  }

  startEdit() { this.draft = this.rev()?.content ?? ''; this.editing.set(true); this.showDoc.set(false); }

  saveEdit() {
    const r = this.rev(); if (!r) return;
    this.busy.set(true);
    this.api.saveRevision(r.id, { content: this.draft }).subscribe({
      next: x => { this.busy.set(false); this.editing.set(false); this.snack.open('Rascunho salvo.', 'OK', { duration: 2500 }); this.load(x.id); this.changed.emit(x); },
      error: e => { this.busy.set(false); this.toast(e); }
    });
  }

  private actionDone(a: string) {
    return a === 'approve' ? 'Aprovado — falta publicar.' : a === 'changes' ? 'Pedido de ajustes enviado — vai para a próxima sessão do Claude.' : 'Revisão descartada.';
  }

  private toast(e: any) { this.snack.open(e?.error?.error ?? 'Não foi possível concluir.', 'OK', { duration: 6000 }); }

  statusLabel(s: string) {
    return ({ draft: 'rascunho', review: 'em revisão', changes: 'ajustes pedidos', approved: 'aprovada', published: 'publicada', discarded: 'descartada', superseded: 'substituída' } as any)[s] ?? s;
  }
  modeLabel(m: string) { return ({ new: 'novo', improve: 'melhorar', redo: 'refazer', manual: 'manual' } as any)[m] ?? m; }
  changeLabel(c: string) { return ({ added: 'novo', removed: 'removido', changed: 'alterado' } as any)[c] ?? c; }
  pct(v: number) { return `${Math.floor(v * 100)}%`; }
  date(at?: string | null) { return at ? new Date(at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''; }
}
