import { Component, ViewEncapsulation, computed, effect, input, output, signal, untracked, inject } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DevOpsService } from '../../services/devops.service';
import { UserAvatarComponent } from '../user-avatar/user-avatar.component';
import { DevOpsAttachmentImagesDirective } from './devops-attachment-images.directive';
import { artifactLabel, relLabel } from './devops-card-related.component';
import { DevOpsHistoryEntry, DevOpsHistoryLink, devOpsErrorMessage } from './devops.model';

/** Nomes dos campos do sistema que o tipo nem sempre lista (o resto vem das definições do tipo). */
const KNOWN_LABELS: Record<string, string> = {
  'System.Title': 'Título', 'System.State': 'Estado', 'System.Reason': 'Motivo', 'System.AssignedTo': 'Responsável',
  'System.AreaPath': 'Área', 'System.IterationPath': 'Iteração', 'System.Tags': 'Tags', 'System.BoardColumn': 'Coluna do board',
  'System.BoardColumnDone': 'Coluna: Done', 'System.BoardLane': 'Lane', 'System.Description': 'Descrição', 'System.WorkItemType': 'Tipo',
  'System.CreatedBy': 'Criado por', 'System.CreatedDate': 'Criado em', 'System.Parent': 'Pai',
};
/** Texto longo (HTML) no histórico: corta aqui; "ver tudo" mostra o resto. */
const LONG = 320;

/** Nome legível de um campo: o do tipo, o conhecido ou a última parte da referência ("RemainingWork" → "Remaining Work"). */
export function historyFieldLabel(ref: string, labels: Record<string, string>): string {
  if (labels[ref]) return labels[ref];
  if (KNOWN_LABELS[ref]) return KNOWN_LABELS[ref];
  return (ref.split('.').pop() ?? ref).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim();
}

/** Valor de uma revisão como texto (HTML vira texto, datas ISO viram data local, booleano vira Sim/Não). */
export function historyValue(v: string | null | undefined): string {
  if (v == null || v === '') return '';
  if (/^(true|false)$/i.test(v)) return /^true$/i.test(v) ? 'Sim' : 'Não';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }
  if (/<[a-z][\s\S]*>/i.test(v)) {
    return v.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
  }
  return v;
}

/** Resumo de uma revisão numa linha ("Estado: New → Test QA · +2 campos"), para a lista recolhida. */
export function historySummary(e: Pick<DevOpsHistoryEntry, 'created' | 'changes' | 'linksAdded' | 'linksRemoved' | 'comment'>,
  labels: Record<string, string>): string {
  if (e.created) return 'Criou o card';
  const parts: string[] = [];
  const state = e.changes.find((c) => c.field === 'System.State');
  if (state) parts.push(`Estado: ${historyValue(state.oldValue) || '—'} → ${historyValue(state.newValue) || '—'}`);
  const others = e.changes.filter((c) => c !== state);
  if (others.length) parts.push(others.length <= 2 ? others.map((c) => historyFieldLabel(c.field, labels)).join(', ') : `${others.length} campos`);
  if (e.linksAdded.length) parts.push(`+${e.linksAdded.length} ${e.linksAdded.length === 1 ? 'link' : 'links'}`);
  if (e.linksRemoved.length) parts.push(`−${e.linksRemoved.length} ${e.linksRemoved.length === 1 ? 'link' : 'links'}`);
  if (e.comment) parts.push('comentou');
  return parts.join(' · ');
}

/**
 * 0099 (modal único do card): aba "Histórico" — as revisões do card no DevOps, mais novas primeiro, como a aba History do
 * DevOps: quem, quando, cada campo antes → depois (texto longo recolhido), links incluídos/removidos e o comentário feito junto.
 * A criação (revisão 1) mostra os campos iniciais recolhidos.
 */
@Component({
  selector: 'app-devops-card-history',
  standalone: true,
  imports: [DatePipe, NgTemplateOutlet, MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule, UserAvatarComponent, DevOpsAttachmentImagesDirective],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="dvh">
      <div class="dvh__head">
        <span class="dv-hint">Tudo o que mudou no card, mais recente primeiro — como a aba History do DevOps.</span>
        <span class="dvh__spacer"></span>
        <label class="dv-check"><input type="checkbox" [checked]="onlyFields()" (change)="onlyFields.set(!onlyFields())"> Esconder comentários</label>
        <button mat-icon-button type="button" (click)="load()" [disabled]="loading()" matTooltip="Recarregar" aria-label="Recarregar histórico"><mat-icon>refresh</mat-icon></button>
      </div>
      @if (loading()) { <mat-progress-bar mode="indeterminate" class="dvh__progress" /> }
      @if (error(); as e) {
        <div class="dvh__err"><mat-icon>error_outline</mat-icon><span>{{ e }}</span><button type="button" class="dv-linkbtn" (click)="load()">Tentar de novo</button></div>
      }
      @if (!loading() && !error() && !shown().length) { <div class="dv-hint dvh__empty">Sem histórico para mostrar.</div> }

      <ol class="dvh__list" [dvAttachmentImages]="card()">
        @for (e of shown(); track e.rev) {
          <li class="dvh__item">
            <app-user-avatar [name]="e.by?.displayName || '?'" [imageUrl]="e.by?.imageUrl" [size]="30" />
            <div class="dvh__body">
              <div class="dvh__meta">
                <b>{{ e.by?.displayName || 'Sistema' }}</b>
                <span class="dvh__sum">{{ summary(e) }}</span>
                <span class="dvh__spacer"></span>
                <span class="dvh__when" [title]="(e.date | date: 'dd/MM/yyyy HH:mm') ?? ''">{{ ago(e.date) }}</span>
                <span class="dvh__rev" matTooltip="Revisão no DevOps">rev {{ e.rev }}</span>
              </div>

              @if (e.created) {
                <button type="button" class="dv-linkbtn dvh__toggle" (click)="toggle(e.rev)">
                  {{ open().has(e.rev) ? 'Esconder os campos iniciais' : 'Ver os campos iniciais (' + e.changes.length + ')' }}
                </button>
              }
              @if (!e.created || open().has(e.rev)) {
                @if (e.changes.length) {
                  <table class="dvh__changes">
                    <tbody>
                      @for (c of e.changes; track c.field) {
                        @let before = value(c.oldValue);
                        @let after = value(c.newValue);
                        @let key = e.rev + '|' + c.field;
                        <tr>
                          <th [title]="c.field">{{ label(c.field) }}</th>
                          <td>
                            @if (!e.created && before) {
                              <span class="dvh__old">{{ expanded().has(key) ? before : cut(before) }}</span>
                              <mat-icon class="dvh__arrow">arrow_forward</mat-icon>
                            }
                            <span class="dvh__new" [class.dvh__new--empty]="!after">{{ after ? (expanded().has(key) ? after : cut(after)) : '(vazio)' }}</span>
                            @if (before.length > long || after.length > long) {
                              <button type="button" class="dv-linkbtn dvh__more" (click)="expand(key)">{{ expanded().has(key) ? 'menos' : 'ver tudo' }}</button>
                            }
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                }
              }

              @if (e.linksAdded.length || e.linksRemoved.length) {
                <ul class="dvh__links">
                  @for (l of e.linksAdded; track l.url) {
                    <li class="dvh__link dvh__link--add"><mat-icon>add_link</mat-icon><span class="dvh__rel">{{ rel(l.rel) }}</span>
                      <ng-container [ngTemplateOutlet]="linkTpl" [ngTemplateOutletContext]="{ $implicit: l }" /></li>
                  }
                  @for (l of e.linksRemoved; track l.url) {
                    <li class="dvh__link dvh__link--del"><mat-icon>link_off</mat-icon><span class="dvh__rel">{{ rel(l.rel) }}</span>
                      <ng-container [ngTemplateOutlet]="linkTpl" [ngTemplateOutletContext]="{ $implicit: l }" /></li>
                  }
                </ul>
              }

              @if (e.comment && !onlyFields()) {
                <div class="dvh__comment"><mat-icon>chat_bubble_outline</mat-icon><div class="dv-html" [innerHTML]="e.comment"></div></div>
              }
            </div>
          </li>
        }
      </ol>
    </div>

    <ng-template #linkTpl let-l>
      @if (l.id) {
        <button type="button" class="dv-linkbtn" (click)="openCard.emit(l.id)" [matTooltip]="'Abrir o card ' + l.id + ' aqui'">#{{ l.id }}</button>
      } @else if (l.rel === 'Hyperlink') {
        <a [href]="l.url" target="_blank" rel="noopener">{{ l.name || l.url }}</a>
      } @else {
        <span>{{ artifact(l) }}</span>
      }
    </ng-template>
  `,
  styles: [`
    app-devops-card-history { display: block; }
    .dvh { display: flex; flex-direction: column; gap: 10px; max-width: 1080px; }
    .dvh__head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .dvh__head .dv-hint { flex: 1 1 320px; }
    .dvh__spacer { flex: 1; }
    .dvh__progress { height: 2px; }
    .dvh__err { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 10px; font-size: 12.5px;
      background: rgba(248,81,73,.08); border: 1px solid rgba(248,81,73,.35); }
    .dvh__empty { padding: 8px 2px; }
    .dvh__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .dvh__item { display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--cc-surface-border, rgba(255,255,255,.06)); min-width: 0; }
    .dvh__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
    .dvh__meta { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; font-size: 13px; min-width: 0; }
    .dvh__sum { color: var(--cc-text-2); min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .dvh__when { font-size: 12px; color: var(--cc-text-3); white-space: nowrap; }
    .dvh__rev { font-size: 11px; color: var(--cc-text-3); padding: 0 6px; border-radius: 8px; background: color-mix(in srgb, var(--cc-text-2) 14%, transparent); }
    .dvh__toggle { align-self: flex-start; font-size: 12.5px; }
    .dvh__changes { border-collapse: collapse; width: 100%; font-size: 12.5px; }
    .dvh__changes th { text-align: left; font-weight: 500; color: var(--cc-text-2); padding: 4px 12px 4px 0; vertical-align: top; white-space: nowrap; width: 1%; }
    .dvh__changes td { padding: 4px 0; vertical-align: top; overflow-wrap: anywhere; white-space: pre-line; }
    .dvh__old { color: #f85149; text-decoration: line-through; text-decoration-color: rgba(248,81,73,.5); }
    .dvh__new { color: #3fb950; }
    .dvh__new--empty { color: var(--cc-text-3); font-style: italic; }
    .dvh__arrow { font-size: 14px; width: 14px; height: 14px; vertical-align: -2px; margin: 0 6px; color: var(--cc-text-3); }
    .dvh__more { margin-left: 6px; font-size: 12px; }
    .dvh__links { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; font-size: 12.5px; }
    .dvh__link { display: flex; align-items: center; gap: 6px; min-width: 0; overflow-wrap: anywhere; }
    .dvh__link mat-icon { font-size: 16px; width: 16px; height: 16px; flex: none; }
    .dvh__link--add mat-icon { color: #3fb950; }
    .dvh__link--del mat-icon { color: #f85149; }
    .dvh__rel { color: var(--cc-text-2); }
    .dvh__comment { display: flex; gap: 8px; padding: 8px 10px; border-radius: 10px; background: color-mix(in srgb, var(--surface-2, #2e343f) 70%, transparent);
      border: 1px solid var(--cc-surface-border, rgba(255,255,255,.08)); font-size: 13px; min-width: 0; }
    .dvh__comment > mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--cc-text-3); flex: none; margin-top: 2px; }
    .dvh__comment .dv-html { min-width: 0; overflow-wrap: anywhere; }
    .dvh__comment .dv-html img { max-width: 100%; height: auto; }
  `]
})
export class DevOpsCardHistoryComponent {
  private api = inject(DevOpsService);

  readonly card = input<string | null>(null);
  /** Nome de cada campo pelo tipo do card (referenceName → nome). */
  readonly labels = input<Record<string, string>>({});
  readonly openCard = output<number>();
  readonly countChange = output<number>();

  readonly entries = signal<DevOpsHistoryEntry[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly onlyFields = signal(false);
  /** Revisões de criação abertas; valores longos abertos (`rev|campo`). */
  readonly open = signal<ReadonlySet<number>>(new Set());
  readonly expanded = signal<ReadonlySet<string>>(new Set());
  readonly long = LONG;

  /** Com "Esconder comentários", some a revisão que só tinha o comentário. */
  readonly shown = computed(() => this.onlyFields()
    ? this.entries().filter((e) => e.changes.length || e.linksAdded.length || e.linksRemoved.length)
    : this.entries());
  private seq = 0;

  constructor() {
    effect(() => {
      const card = this.card();
      untracked(() => {
        this.entries.set([]);
        this.open.set(new Set());
        this.expanded.set(new Set());
        if (card) this.load();
      });
    });
  }

  load(): void {
    const card = this.card();
    if (!card) return;
    const seq = ++this.seq;
    this.loading.set(true);
    this.error.set(null);
    this.api.history(card).subscribe({
      next: (list) => {
        if (seq !== this.seq) return;
        this.entries.set(list);
        this.countChange.emit(list.length);
        this.loading.set(false);
      },
      error: (e) => {
        if (seq !== this.seq) return;
        this.error.set(devOpsErrorMessage(e, 'Não foi possível ler o histórico do card.'));
        this.loading.set(false);
      }
    });
  }

  label(ref: string): string { return historyFieldLabel(ref, this.labels()); }
  value(v: string | null): string { return historyValue(v); }
  summary(e: DevOpsHistoryEntry): string { return historySummary(e, this.labels()); }
  rel(r: string): string { return relLabel(r); }
  artifact(l: DevOpsHistoryLink): string { return artifactLabel(l.url, l.name); }
  cut(text: string): string { return text.length > LONG ? `${text.slice(0, LONG - 1)}…` : text; }

  toggle(rev: number): void {
    this.open.update((s) => { const n = new Set(s); if (n.has(rev)) n.delete(rev); else n.add(rev); return n; });
  }

  expand(key: string): void {
    this.expanded.update((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }

  /** "há 5 min", "há 3 h", "ontem", "12/11". */
  ago(date: string | null): string {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    const min = Math.round((Date.now() - d.getTime()) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `há ${h} h`;
    const days = Math.round(h / 24);
    if (days === 1) return 'ontem';
    if (days < 7) return `há ${days} dias`;
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: d.getFullYear() === new Date().getFullYear() ? undefined : '2-digit' });
  }
}

