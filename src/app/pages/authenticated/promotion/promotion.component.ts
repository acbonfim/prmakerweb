import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription, timer } from 'rxjs';
import { PromotionService } from '../../../services/promotion.service';
import { PromotionPasteDialogComponent } from './promotion-paste-dialog.component';
import { PromotionResultComponent } from './promotion-result.component';
import {
  PromotionBatch, PromotionCreateItem, PromotionParse, PromotionPreviewRow, PromotionPreviewTarget, PromotionProfile, PromotionTargetDto
} from './promotion.model';

/** Linha da grade: o que a prévia trouxe, editável (destinos, repositório) antes de disparar. */
interface Row extends PromotionPreviewRow {
  key: string;
  busy?: boolean;
  adding?: boolean;
  newTarget?: string;
}

const POLL_MS = 3000;
const VERSION_SHAPE = /^[vV]?\d+(\.\d+){1,3}([-.][0-9A-Za-z]+)*$/;

/**
 * Promoção de PRs em lote (0074): o Release Manager pede o PR dos cards para release/hotfix/edge/master; aqui se informa
 * a versão e os cards, o PRMake sugere repositório, branch principal, commits e destinos por tipo de repositório, o
 * usuário ajusta e dispara. O cherry-pick roda no executor dele; no fim, a tabela com os PRs (copiar como texto/tabela).
 */
@Component({
  selector: 'app-promotion',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatTooltipModule, PromotionResultComponent],
  template: `
    <div class="pm">
      <header class="pm__head">
        <div>
          <h1>Promoção de PRs</h1>
          <p>Abra em lote o PR dos cards para as branches que o Release Manager pediu (release, hotfix, edge, master), com cherry-pick da branch do card.</p>
        </div>
        @if (executorOnline() !== null) {
          <span class="pm__exec" [class.pm__exec--off]="!executorOnline()"
                [matTooltip]="executorOnline() ? 'O cherry-pick roda na sua máquina' : 'Ligue o executor (prmake-agent) para o cherry-pick; PR direto não precisa dele'">
            <span class="pm__dot"></span>{{ executorOnline() ? 'Executor online' : 'Sem executor online' }}
          </span>
        }
      </header>

      @if (batch(); as b) {
        <app-promotion-result [batch]="b" [busy]="busy()" (retry)="retry($event)" (cancel)="cancelQueue()" (newBatch)="newBatch()" />
      } @else {
        <section class="pm__form" aria-label="Lote">
          <label class="pm__field">
            <span>Versão</span>
            <input type="text" [ngModel]="version()" (ngModelChange)="version.set($event)" placeholder="3.274.10" [class.pm__invalid]="!!version() && !versionOk()" aria-label="Versão do lote" />
          </label>
          <label class="pm__field pm__field--sm">
            <span>Tipo</span>
            <select [ngModel]="kind()" (ngModelChange)="kind.set($event)" aria-label="Tipo do lote">
              <option value="hotfix">Hotfix</option>
              <option value="release">Release</option>
            </select>
          </label>
          <label class="pm__field pm__field--grow">
            <span>Cards</span>
            <input type="text" [ngModel]="cardsInput()" (ngModelChange)="cardsInput.set($event)" (keydown.enter)="addCards()"
                   placeholder="77317, 76607 76462 (separados por vírgula, espaço ou linha)" aria-label="Números dos cards" />
          </label>
          <button mat-flat-button color="primary" (click)="addCards()" [disabled]="loading() || !versionOk() || !pendingCards().length">
            <mat-icon>add</mat-icon> Adicionar{{ pendingCards().length > 1 ? ' ' + pendingCards().length + ' cards' : '' }}
          </button>
          <button mat-stroked-button (click)="paste()" matTooltip="Preenche versão, regras de destino e cards a partir da mensagem do Release Manager (usa a IA da sua conta)">
            <mat-icon>auto_awesome</mat-icon> Colar mensagem do Release Manager
          </button>
        </section>

        @if (overrideKinds().length) {
          <div class="pm__note"><mat-icon>tune</mat-icon>
            Destinos desta mensagem valem só para este lote: {{ overrideSummary() }}.
            <button mat-button (click)="clearOverrides()">Voltar aos padrões</button>
          </div>
        }
        @if (error()) { <div class="pm__error" role="alert"><mat-icon>error_outline</mat-icon> {{ error() }}</div> }
        @if (loading()) { <div class="pm__loading"><span class="pm__spin"></span> Consultando o GitHub e o Azure DevOps…</div> }

        @if (rows().length === 0 && !loading()) {
          <div class="pm__empty">
            <mat-icon>merge_type</mat-icon>
            <p>Informe a versão e os cards — ou cole a mensagem do Release Manager.</p>
          </div>
        }

        @for (row of rows(); track row.key) {
          <article class="row" [class.row--bad]="!rowOk(row)" [class.row--busy]="row.busy">
            <header class="row__head">
              <div class="row__id">
                <strong>AB#{{ row.card }}</strong>
                @if (row.workItemType) { <span class="tag">{{ row.workItemType }}</span> }
                <span class="row__title" [title]="row.title">{{ row.title || 'Sem título (Azure DevOps indisponível)' }}</span>
              </div>
              <div class="row__meta">
                @if (row.assignedTo) { <span class="row__muted"><mat-icon>person</mat-icon> {{ row.assignedTo }}</span> }
                <button mat-icon-button (click)="removeRow(row)" matTooltip="Tirar do lote" aria-label="Tirar do lote"><mat-icon>close</mat-icon></button>
              </div>
            </header>

            <div class="row__grid">
              <div class="row__cell">
                <span class="lbl">Repositório</span>
                @if (row.repositoryOptions.length > 1) {
                  <select [ngModel]="row.repository" (ngModelChange)="changeRepository(row, $event)" aria-label="Repositório">
                    @for (o of row.repositoryOptions; track o) { <option [value]="o">{{ o }}</option> }
                  </select>
                } @else if (row.repository) {
                  <span class="val">{{ row.repository }}</span>
                } @else {
                  <input type="text" placeholder="owner/repositório" (keydown.enter)="changeRepository(row, $any($event.target).value)"
                         (blur)="$any($event.target).value && changeRepository(row, $any($event.target).value)" aria-label="Repositório" />
                }
                @if (row.profileLabel) { <span class="row__muted">{{ row.profileLabel }}</span> }
              </div>

              <div class="row__cell">
                <span class="lbl">Branch principal</span>
                @if (row.sourceBranch) {
                  <span class="val"><code>{{ row.sourceBranch }}</code>
                    @if (row.sourceBase) { <span class="row__muted"> cortada de <code>{{ row.sourceBase }}</code></span> }
                  </span>
                }
                @if (row.sourceFound) {
                  <span class="commits" [class.commits--zero]="row.commitCount === 0" [matTooltip]="commitsTip(row)" matTooltipClass="pm-tip">
                    <mat-icon>commit</mat-icon>{{ row.commitCount }} commit{{ row.commitCount === 1 ? '' : 's' }}{{ row.commitsTruncated ? '+' : '' }}
                  </span>
                }
              </div>

              <div class="row__cell row__cell--targets">
                <span class="lbl">Destinos</span>
                <div class="targets">
                  @for (t of row.targets; track $index) {
                    <span class="target" [class.target--bad]="t.status !== 'resolved'" [class.target--open]="t.alreadyOpen">
                      @if (t.status === 'ambiguous') {
                        <select [ngModel]="t.branch" (ngModelChange)="pickCandidate(t, $event)" aria-label="Escolha a branch de {{ t.template }}">
                          <option [ngValue]="null">escolha: {{ t.template }}</option>
                          @for (c of t.candidates; track c) { <option [value]="c">{{ c }}</option> }
                        </select>
                      } @else if (t.status === 'missing') {
                        <span class="target__name" [matTooltip]="'Não existe no remoto: ' + t.template">{{ t.template }}</span>
                        <mat-icon class="target__warn">error_outline</mat-icon>
                      } @else {
                        <span class="target__name">{{ t.branch }}</span>
                      }
                      @if (t.alreadyOpen) { <a class="target__open" [href]="t.existingUrl" target="_blank" rel="noopener" matTooltip="Já existe PR aberto deste card para este destino">já aberto</a> }
                      <button type="button" class="target__btn" [class.on]="t.draft" (click)="t.draft = !t.draft" [attr.aria-pressed]="t.draft"
                              matTooltip="Abrir como rascunho">rascunho</button>
                      <button type="button" class="target__btn" [class.on]="t.mode === 'direct'" (click)="toggleMode(t)" [attr.aria-pressed]="t.mode === 'direct'"
                              [matTooltip]="t.note || 'PR direto da branch principal, sem cherry-pick'">direto</button>
                      <button type="button" class="target__x" (click)="removeTarget(row, $index)" aria-label="Remover destino"><mat-icon>close</mat-icon></button>
                    </span>
                  }
                  @if (row.adding) {
                    <input class="target__input" type="text" [(ngModel)]="row.newTarget" placeholder="release-{version}, edge…"
                           (keydown.enter)="addTarget(row)" (keydown.escape)="row.adding = false" aria-label="Novo destino" autofocus />
                    <button mat-icon-button (click)="addTarget(row)" aria-label="Confirmar destino"><mat-icon>check</mat-icon></button>
                  } @else {
                    <button type="button" class="target__add" (click)="row.adding = true; row.newTarget = ''"><mat-icon>add</mat-icon> destino</button>
                  }
                </div>
              </div>
            </div>

            @for (e of row.errors; track e) { <div class="msg msg--err"><mat-icon>error_outline</mat-icon> {{ e }}</div> }
            @for (w of row.warnings; track w) { <div class="msg msg--warn"><mat-icon>warning_amber</mat-icon> {{ w }}</div> }
            @for (t of row.targets; track $index) {
              @if (t.note) { <div class="msg msg--info"><mat-icon>info_outline</mat-icon> {{ t.note }}</div> }
            }
          </article>
        }

        @if (rows().length) {
          <footer class="pm__bar">
            <div class="pm__count">
              <strong>{{ totalPrs() }}</strong> PR{{ totalPrs() === 1 ? '' : 's' }} em <strong>{{ rows().length }}</strong> linha{{ rows().length === 1 ? '' : 's' }}
              @if (blocker()) { <span class="pm__blocker"><mat-icon>block</mat-icon> {{ blocker() }}</span> }
            </div>
            <button mat-button (click)="refreshAll()" [disabled]="loading()"><mat-icon>refresh</mat-icon> Atualizar</button>
            <button mat-flat-button color="primary" (click)="dispatch()" [disabled]="!!blocker() || creating()">
              <mat-icon>rocket_launch</mat-icon> {{ creating() ? 'Disparando…' : 'Disparar lote' }}
            </button>
          </footer>
        }

        @if (history().length) {
          <section class="hist">
            <h3>Lotes anteriores</h3>
            @for (h of history(); track h.id) {
              <button type="button" class="hist__row" (click)="open(h)">
                <strong>{{ h.version }}</strong>
                <span class="row__muted">{{ formatDateTime(h.createdAt) }} · {{ h.ownerName }}</span>
                <span class="hist__sum">{{ h.summary.opened + h.summary.alreadyOpen }}/{{ h.summary.total }} PRs
                  @if (h.summary.conflict + h.summary.error + h.summary.missingTarget > 0) { · <span class="hist__bad">{{ h.summary.conflict + h.summary.error + h.summary.missingTarget }} com problema</span> }
                  @if (h.active) { · em andamento }
                </span>
              </button>
            }
          </section>
        }
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .pm { --ok: #3fb950; --warn: #d29922; --err: #f0716a; --run: var(--mat-sys-primary);
          --muted: color-mix(in srgb, var(--mat-sys-on-surface) 55%, transparent);
          --line: color-mix(in srgb, var(--mat-sys-on-surface) 14%, transparent);
          max-width: 1180px; margin: 0 auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
    .pm__head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
    .pm__head h1 { margin: 0; font-size: 22px; }
    .pm__head p { margin: 4px 0 0; color: var(--muted); font-size: 13px; max-width: 720px; }
    .pm__exec { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 4px 10px; border-radius: 999px; background: color-mix(in srgb, var(--ok) 16%, transparent); color: var(--ok); }
    .pm__exec--off { background: color-mix(in srgb, var(--warn) 18%, transparent); color: var(--warn); }
    .pm__dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
    .pm__form { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; padding: 14px; border: 1px solid var(--line); border-radius: 12px; }
    .pm__field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); min-width: 120px; }
    .pm__field--sm { min-width: 100px; } .pm__field--grow { flex: 1; min-width: 220px; }
    input[type=text], select { font: inherit; font-size: 14px; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: var(--mat-sys-on-surface); }
    select option { color: #000; }
    input:focus, select:focus { outline: 2px solid var(--run); outline-offset: 1px; }
    .pm__invalid { border-color: var(--err) !important; }
    .pm__note, .pm__error, .pm__loading { display: flex; gap: 8px; align-items: center; font-size: 13px; padding: 8px 12px; border-radius: 8px; }
    .pm__note { background: color-mix(in srgb, var(--run) 10%, transparent); }
    .pm__error { background: color-mix(in srgb, var(--err) 12%, transparent); color: var(--err); }
    .pm__loading { color: var(--muted); }
    .pm__spin { width: 14px; height: 14px; border: 2px solid var(--line); border-top-color: var(--run); border-radius: 50%; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .pm__empty { text-align: center; padding: 40px 12px; color: var(--muted); }
    .pm__empty mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: .5; }
    .row { border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
    .row--bad { border-color: color-mix(in srgb, var(--err) 55%, transparent); }
    .row--busy { opacity: .6; pointer-events: none; }
    .row__head { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
    .row__id { display: flex; gap: 8px; align-items: center; min-width: 0; }
    .row__title { color: var(--muted); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row__meta { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; }
    .row__muted { color: var(--muted); font-size: 12px; display: inline-flex; align-items: center; gap: 3px; }
    .row__muted mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .tag { font-size: 11px; padding: 1px 8px; border-radius: 999px; background: color-mix(in srgb, var(--mat-sys-on-surface) 10%, transparent); }
    .row__grid { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(200px, 1fr) minmax(280px, 2fr); gap: 14px; }
    @media (max-width: 900px) { .row__grid { grid-template-columns: 1fr; } }
    .row__cell { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .lbl { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
    .val { font-size: 13px; word-break: break-all; }
    code { font-size: 12px; background: color-mix(in srgb, var(--mat-sys-on-surface) 8%, transparent); padding: 1px 6px; border-radius: 4px; }
    .commits { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--ok); cursor: help; width: fit-content; }
    .commits--zero { color: var(--warn); }
    .commits mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .targets { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .target { display: inline-flex; align-items: center; gap: 4px; padding: 3px 4px 3px 10px; border-radius: 999px; border: 1px solid var(--line); font-size: 13px; }
    .target--bad { border-color: var(--err); }
    .target--open { border-color: var(--ok); }
    .target__name { font-weight: 600; }
    .target__warn { font-size: 16px; width: 16px; height: 16px; color: var(--err); }
    .target__open { font-size: 11px; color: var(--ok); text-decoration: none; }
    .target__btn { font: inherit; font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--line); background: transparent; color: var(--muted); cursor: pointer; }
    .target__btn.on { background: color-mix(in srgb, var(--run) 20%, transparent); color: var(--run); border-color: transparent; }
    .target__x { display: inline-flex; border: 0; background: transparent; color: var(--muted); cursor: pointer; padding: 2px; border-radius: 50%; }
    .target__x mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .target__x:hover { color: var(--err); }
    .target__add { display: inline-flex; align-items: center; gap: 2px; font: inherit; font-size: 12px; border: 1px dashed var(--line); background: transparent; color: var(--muted); border-radius: 999px; padding: 3px 10px 3px 6px; cursor: pointer; }
    .target__add mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .target__input { width: 180px; padding: 4px 8px; }
    .msg { display: flex; gap: 6px; align-items: flex-start; font-size: 12.5px; }
    .msg mat-icon { font-size: 16px; width: 16px; height: 16px; flex: 0 0 auto; }
    .msg--err { color: var(--err); } .msg--warn { color: var(--warn); } .msg--info { color: var(--muted); }
    .pm__bar { position: sticky; bottom: 0; display: flex; align-items: center; gap: 10px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px;
               background: var(--mat-sys-surface-container, var(--mat-sys-surface)); box-shadow: 0 -6px 18px rgba(0,0,0,.18); }
    .pm__count { flex: 1; font-size: 14px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .pm__blocker { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--warn); }
    .pm__blocker mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .hist { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
    .hist h3 { margin: 0 0 4px; font-size: 14px; color: var(--muted); font-weight: 600; }
    .hist__row { display: flex; gap: 12px; align-items: center; text-align: left; font: inherit; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: inherit; cursor: pointer; }
    .hist__row:hover { background: color-mix(in srgb, var(--mat-sys-on-surface) 6%, transparent); }
    .hist__sum { margin-left: auto; font-size: 12px; }
    .hist__bad { color: var(--err); }
    ::ng-deep .pm-tip { white-space: pre-line; max-width: 420px; }
  `]
})
export class PromotionComponent implements OnInit, OnDestroy {
  private api = inject(PromotionService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);

  readonly version = signal('');
  readonly kind = signal<'hotfix' | 'release'>('hotfix');
  readonly cardsInput = signal('');
  readonly rows = signal<Row[]>([]);
  readonly profiles = signal<PromotionProfile[]>([]);
  readonly overrides = signal<Record<string, PromotionTargetDto[]> | null>(null);
  readonly executorOnline = signal<boolean | null>(null);
  readonly loading = signal(false);
  readonly creating = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly batch = signal<PromotionBatch | null>(null);
  readonly history = signal<PromotionBatch[]>([]);

  private poll?: Subscription;
  private keySeq = 0;

  readonly versionOk = computed(() => VERSION_SHAPE.test(this.version().trim()));
  readonly pendingCards = computed(() => this.parseCards(this.cardsInput()));
  readonly overrideKinds = computed(() => Object.keys(this.overrides() ?? {}));
  readonly overrideSummary = computed(() =>
    this.overrideKinds().map(k => `${this.profileLabel(k)}: ${(this.overrides()![k] ?? []).map(t => t.branch).join(', ')}`).join(' · '));
  readonly totalPrs = computed(() => this.rows().reduce((n, r) => n + r.targets.length, 0));

  /** Por que o lote não pode ser disparado (vazio = pode). */
  readonly blocker = computed(() => {
    const rows = this.rows();
    if (!this.versionOk()) return 'Informe a versão.';
    if (rows.length === 0) return 'Adicione cards.';
    const bad = rows.find(r => !this.rowOk(r));
    if (bad) return `Corrija a linha do card ${bad.card}.`;
    const seen = new Set<string>();
    for (const r of rows)
      for (const t of r.targets) {
        const k = `${r.card}|${(r.repository ?? '').toLowerCase()}|${t.branch}`;
        if (seen.has(k)) return `O card ${r.card} aparece duas vezes para ${t.branch}.`;
        seen.add(k);
      }
    const needsExecutor = rows.some(r => r.targets.some(t => t.mode !== 'direct'));
    if (needsExecutor && this.executorOnline() === false) return 'O cherry-pick precisa do executor online (ou marque "direto").';
    return '';
  });

  ngOnInit(): void {
    this.loadHistory();
  }

  ngOnDestroy(): void {
    this.poll?.unsubscribe();
  }

  // ── Entrada ────────────────────────────────────────────────────────────────────────────────

  private parseCards(text: string): string[] {
    const existing = new Set(this.rows().map(r => r.card));
    return Array.from(new Set(
      text.split(/[\s,;]+/).map(t => t.replace(/^AB#/i, '').trim()).filter(t => /^\d{3,8}$/.test(t))
    )).filter(c => !existing.has(c));
  }

  addCards(): void {
    const cards = this.pendingCards();
    if (!cards.length || !this.versionOk()) return;
    this.cardsInput.set('');
    this.runPreview(cards.map(card => ({ card })), false);
  }

  refreshAll(): void {
    this.runPreview(this.rows().map(r => ({ card: r.card, repository: r.repository })), true, true);
  }

  changeRepository(row: Row, repository: string): void {
    const repo = (repository ?? '').trim();
    if (!repo || repo === row.repository) return;
    row.busy = true;
    this.rows.update(r => [...r]);
    this.api.preview(this.previewRequest([{ card: row.card, repository: repo }])).subscribe({
      next: p => {
        this.executorOnline.set(p.executorOnline);
        const fresh = p.rows[0];
        if (fresh) this.rows.update(rows => rows.map(r => (r.key === row.key ? this.toRow(fresh, r.key) : r)));
      },
      error: e => { row.busy = false; this.rows.update(r => [...r]); this.fail(e); }
    });
  }

  private runPreview(cards: { card: string; repository?: string | null }[], replaceAll: boolean, refresh = false): void {
    if (!cards.length) return;
    this.error.set(null);
    this.loading.set(true);
    this.api.preview({ ...this.previewRequest(cards), refresh }).subscribe({
      next: p => {
        this.loading.set(false);
        this.executorOnline.set(p.executorOnline);
        this.profiles.set(p.profiles);
        const incoming = p.rows.map(r => this.toRow(r));
        const touched = new Set(incoming.map(r => r.card));
        this.rows.update(rows => replaceAll ? incoming : [...rows.filter(r => !touched.has(r.card)), ...incoming]);
      },
      error: e => { this.loading.set(false); this.fail(e); }
    });
  }

  private previewRequest(cards: { card: string; repository?: string | null }[]) {
    return { version: this.version().trim(), kind: this.kind(), cards, profiles: this.overrides() };
  }

  private toRow(r: PromotionPreviewRow, key?: string): Row {
    return { ...r, key: key ?? `r${++this.keySeq}`, targets: r.targets.map(t => ({ ...t })) };
  }

  // ── Edição da linha ────────────────────────────────────────────────────────────────────────

  removeRow(row: Row): void {
    this.rows.update(rows => rows.filter(r => r.key !== row.key));
  }

  removeTarget(row: Row, index: number): void {
    row.targets.splice(index, 1);
    this.rows.update(r => [...r]);
  }

  toggleMode(t: PromotionPreviewTarget): void {
    t.mode = t.mode === 'direct' ? 'cherry-pick' : 'direct';
    this.rows.update(r => [...r]);
  }

  pickCandidate(t: PromotionPreviewTarget, name: string | null): void {
    t.branch = name;
    t.status = name ? 'resolved' : 'ambiguous';
    this.rows.update(r => [...r]);
  }

  addTarget(row: Row): void {
    const text = (row.newTarget ?? '').trim();
    if (!text || !row.repository) return;
    row.busy = true;
    this.rows.update(r => [...r]);
    this.api.resolve({
      version: this.version().trim(), card: row.card, repository: row.repository,
      sourceBranch: row.sourceBranch, sourceBase: row.sourceBase, targets: [{ branch: text, draft: false }]
    }).subscribe({
      next: ts => {
        row.targets.push(...ts);
        row.adding = false;
        row.newTarget = '';
        row.busy = false;
        this.rows.update(r => [...r]);
      },
      error: e => { row.busy = false; this.rows.update(r => [...r]); this.fail(e); }
    });
  }

  rowOk(row: Row): boolean {
    return !!row.repository && row.sourceFound && row.targets.length > 0 && row.targets.every(t => !!t.branch && t.status === 'resolved')
      && !row.errors.length && !row.busy;
  }

  commitsTip(row: Row): string {
    if (!row.commits.length) return 'Nenhum commit da branch principal em relação à base.';
    const lines = row.commits.map(c => `${c.sha.slice(0, 7)}  ${c.title}`);
    if (row.commitCount > row.commits.length) lines.push(`… e mais ${row.commitCount - row.commits.length}`);
    return lines.join('\n');
  }

  // ── Colar a mensagem do Release Manager ────────────────────────────────────────────────────

  paste(): void {
    this.dialog.open<PromotionPasteDialogComponent, void, PromotionParse | null>(PromotionPasteDialogComponent, { width: '720px', maxWidth: '94vw' })
      .afterClosed().subscribe(parse => { if (parse) this.applyParse(parse); });
  }

  private applyParse(parse: PromotionParse): void {
    if (parse.version) this.version.set(parse.version);
    if (parse.kind === 'hotfix' || parse.kind === 'release') this.kind.set(parse.kind);
    this.overrides.set(Object.keys(parse.profiles).length ? parse.profiles : null);
    this.rows.set([]);
    const cards = parse.cards.map(c => ({ card: c.card }));
    if (!cards.length) {
      this.snack.open('A mensagem não trouxe cards — adicione pelos números.', 'Ok', { duration: 5000 });
      return;
    }
    if (!this.versionOk()) {
      this.cardsInput.set(cards.map(c => c.card).join(' '));
      this.snack.open('Não identifiquei a versão: informe e clique em Adicionar.', 'Ok', { duration: 6000 });
      return;
    }
    this.runPreview(cards, true);
  }

  clearOverrides(): void {
    this.overrides.set(null);
    if (this.rows().length) this.refreshAll();
  }

  private profileLabel(kind: string): string {
    return this.profiles().find(p => p.kind === kind)?.label ?? kind;
  }

  // ── Disparo e acompanhamento ───────────────────────────────────────────────────────────────

  dispatch(): void {
    if (this.blocker() || this.creating()) return;
    const items: PromotionCreateItem[] = this.rows().map(r => ({
      card: r.card,
      title: r.title,
      repository: r.repository!,
      sourceBranch: r.sourceBranch!,
      sourceBase: r.sourceBase ?? null,
      targets: r.targets.map(t => ({ branch: t.branch!, draft: t.draft, mode: t.mode }))
    }));
    this.creating.set(true);
    this.error.set(null);
    this.api.create(this.version().trim(), this.kind(), items).subscribe({
      next: b => { this.creating.set(false); this.show(b); },
      error: e => { this.creating.set(false); this.fail(e); }
    });
  }

  open(b: PromotionBatch): void {
    this.show(b);
    this.api.get(b.id).subscribe({ next: fresh => this.show(fresh), error: () => {} });
  }

  newBatch(): void {
    this.poll?.unsubscribe();
    this.batch.set(null);
    this.rows.set([]);
    this.loadHistory();
  }

  private show(b: PromotionBatch): void {
    this.batch.set(b);
    this.poll?.unsubscribe();
    if (!b.active) return;
    this.poll = timer(POLL_MS, POLL_MS).subscribe(() => {
      this.api.get(b.id).subscribe({
        next: fresh => {
          this.batch.set(fresh);
          if (!fresh.active) this.poll?.unsubscribe();
        },
        error: () => {}
      });
    });
  }

  retry(itemIds: string[]): void {
    const b = this.batch();
    if (!b) return;
    this.busy.set(true);
    this.api.retry(b.id, itemIds).subscribe({
      next: fresh => { this.busy.set(false); this.show(fresh); },
      error: e => { this.busy.set(false); this.fail(e); }
    });
  }

  cancelQueue(): void {
    const b = this.batch();
    if (!b) return;
    this.busy.set(true);
    this.api.cancel(b.id).subscribe({
      next: fresh => { this.busy.set(false); this.show(fresh); },
      error: e => { this.busy.set(false); this.fail(e); }
    });
  }

  private loadHistory(): void {
    this.api.mine(8).subscribe({ next: h => this.history.set(h), error: () => {} });
  }

  private fail(e: any): void {
    this.error.set(e?.error?.error || e?.error?.message || e?.message || 'Não consegui concluir a operação.');
  }

  formatDateTime(value?: string | null): string {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
}
