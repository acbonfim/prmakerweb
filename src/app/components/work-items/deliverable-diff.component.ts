import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { WorkItemsService } from '../../services/work-items.service';
import { DiffLine, parsePatch } from '../../helpers/unified-diff';
import { WorkDeliverableDiff, WorkDeliverableDiffFile } from './work-item.model';

/** Acima disso os arquivos começam recolhidos. */
const OPEN_ALL_UP_TO = 5;
/** Linhas mostradas por arquivo antes do "mostrar o restante" (diffs grandes não travam a tela). */
const MAX_LINES = 400;

const FILE_STATUS: Record<string, { icon: string; label: string; tone: 'add' | 'del' | 'mod' }> = {
  added: { icon: 'add_circle_outline', label: 'Arquivo novo', tone: 'add' },
  removed: { icon: 'remove_circle_outline', label: 'Arquivo removido', tone: 'del' },
  renamed: { icon: 'drive_file_rename_outline', label: 'Renomeado', tone: 'mod' },
  modified: { icon: 'edit', label: 'Alterado', tone: 'mod' }
};

/**
 * 0091: diff completo de uma entrega (`GET WorkItems/{n}/deliverables/{id}/diff`) — carregado quando o componente
 * nasce (o pai só o cria ao abrir "Ver alterações"/"Ver código alterado"). Cabeçalho base...head com os totais e o
 * compare no GitHub, aviso de diff cortado, um bloco por arquivo (recolhidos quando passam de 5) com o diff unificado
 * numerado. Segue o tema (tokens do Material) — diferente do `git-diff-viewer`, que é só escuro e largo; a rolagem
 * horizontal fica dentro do código, então cabe no modal de 640px e no celular.
 */
@Component({
  selector: 'app-deliverable-diff',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dd" [attr.aria-busy]="state() === 'loading'">
      @switch (state()) {
        @case ('loading') {
          <p class="dd__state" role="status"><mat-icon class="dd__spin">progress_activity</mat-icon>Carregando as alterações…</p>
        }
        @case ('error') {
          <div class="dd__state dd__state--bad" role="alert">
            <mat-icon>cloud_off</mat-icon>
            <span>Não foi possível mostrar as alterações agora — o GitHub não respondeu ou a branch já foi apagada.
              @if (errorText()) { <small class="dd__detail">{{ errorText() }}</small> }
            </span>
            @if (githubLink(); as g) { <a class="dd__gh" [href]="g" target="_blank" rel="noopener"><mat-icon>open_in_new</mat-icon>Ver no GitHub</a> }
            <button mat-button type="button" (click)="load()">Tentar de novo</button>
          </div>
        }
        @case ('empty') {
          <p class="dd__state"><mat-icon>difference</mat-icon><span>Nenhuma alteração registrada para esta entrega.</span>
            @if (githubLink(); as g) { <a class="dd__gh" [href]="g" target="_blank" rel="noopener"><mat-icon>open_in_new</mat-icon>Ver no GitHub</a> }
          </p>
        }
        @default {
          @if (diff(); as d) {
            <div class="dd__head">
              <mat-icon class="dd__head-ico">difference</mat-icon>
              <span class="dd__range">
                @if (d.base || d.head) { <code>{{ d.base || '?' }}...{{ d.head || '?' }}</code> }
                @if (d.repository) { <small class="dd__muted">{{ d.repository }}</small> }
              </span>
              <span class="dd__tot">
                {{ files().length }} arquivo{{ files().length === 1 ? '' : 's' }}
                <b class="dd__add">+{{ totals().additions }}</b><b class="dd__del">−{{ totals().deletions }}</b>
              </span>
              <span class="dd__src" [matTooltip]="d.source === 'github' ? 'Comparação feita agora no GitHub' : 'Fotografia gravada quando a sub-tarefa terminou'">
                {{ d.source === 'github' ? 'ao vivo' : 'fotografia' }}
              </span>
              <span class="dd__spacer"></span>
              @if (d.compareUrl) { <a class="dd__gh" [href]="d.compareUrl" target="_blank" rel="noopener"><mat-icon>open_in_new</mat-icon>Abrir compare no GitHub</a> }
            </div>
            @if (d.truncated) {
              <p class="dd__warn"><mat-icon>content_cut</mat-icon><span>Diff grande — mostrando só uma parte; veja o restante no GitHub.</span></p>
            }
            @if (files().length > 1) {
              <div class="dd__bulk">
                <button type="button" class="dd__linkbtn" (click)="setAll(true)">Expandir tudo</button>
                <button type="button" class="dd__linkbtn" (click)="setAll(false)">Recolher tudo</button>
              </div>
            }
            <ul class="dd__files">
              @for (f of files(); track $index; let i = $index) {
                <li class="dd-file">
                  <button type="button" class="dd-file__head" (click)="toggle(i)" [attr.aria-expanded]="isOpen(i)">
                    <mat-icon class="dd-file__chev">{{ isOpen(i) ? 'expand_more' : 'chevron_right' }}</mat-icon>
                    <mat-icon class="dd-file__st dd-file__st--{{ fileLook(f).tone }}" [matTooltip]="fileLook(f).label">{{ fileLook(f).icon }}</mat-icon>
                    <span class="dd-file__path">
                      @if (f.previousPath && f.previousPath !== f.path) { <span class="dd__muted">{{ f.previousPath }} → </span> }{{ f.path }}
                    </span>
                    <span class="dd-file__stat"><b class="dd__add">+{{ f.additions ?? 0 }}</b><b class="dd__del">−{{ f.deletions ?? 0 }}</b></span>
                  </button>
                  @if (isOpen(i)) {
                    @if (!f.patch) {
                      <p class="dd-file__none">Sem diff de texto para este arquivo (binário, renomeado sem mudança ou grande demais).</p>
                    } @else {
                      <div class="dd-code" role="table" [attr.aria-label]="'Alterações em ' + f.path">
                        <div class="dd-rows">
                          @for (l of visibleLines(i); track $index) {
                            <div class="dd-row dd-row--{{ l.type }}" role="row">
                              <span class="dd-row__num">{{ l.type === 'info' ? '' : (l.oldLineNumber ?? '') }}</span>
                              <span class="dd-row__num">{{ l.type === 'info' ? '' : (l.newLineNumber ?? '') }}</span>
                              <span class="dd-row__sign">{{ l.type === 'addition' ? '+' : l.type === 'deletion' ? '−' : '' }}</span>
                              <span class="dd-row__code">{{ l.content }}</span>
                            </div>
                          }
                        </div>
                      </div>
                      @if (hiddenLines(i); as n) {
                        <button type="button" class="dd__linkbtn dd-file__more" (click)="showAll(i)">Mostrar o restante ({{ n }} linha{{ n === 1 ? '' : 's' }})</button>
                      }
                    }
                  }
                </li>
              }
            </ul>
          }
        }
      }
    </div>
  `,
  styles: [`
    :host { display: block; min-width: 0; --dd-add: #2ea043; --dd-del: #e5534b; }
    .dd { display: flex; flex-direction: column; gap: 8px; min-width: 0; font-size: 12.5px; }
    .dd__state { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin: 0; padding: 8px 10px; border-radius: 8px; color: var(--cc-text-2);
      border: 1px dashed var(--cc-surface-border-strong, rgba(127,127,127,.3)); }
    .dd__state > mat-icon { font-size: 17px; width: 17px; height: 17px; flex: none; }
    .dd__state--bad { border-style: solid; border-color: color-mix(in srgb, var(--dd-del) 40%, transparent); }
    .dd__state--bad > mat-icon { color: var(--dd-del); }
    .dd__state > span { flex: 1 1 220px; min-width: 0; }
    .dd__detail { display: block; color: var(--cc-text-3); overflow-wrap: anywhere; }
    .dd__spin { animation: dd-spin 1.1s linear infinite; }
    @keyframes dd-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .dd__spin { animation: none; } }
    .dd__head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; min-width: 0; }
    .dd__head-ico { font-size: 17px; width: 17px; height: 17px; color: var(--cc-text-2); flex: none; }
    .dd__range { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; min-width: 0; }
    .dd__range code { font-size: 12px; overflow-wrap: anywhere; }
    .dd__tot, .dd-file__stat { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .dd__add { color: color-mix(in srgb, var(--dd-add) 80%, var(--mat-sys-on-surface)); font-weight: 600; }
    .dd__del { color: color-mix(in srgb, var(--dd-del) 80%, var(--mat-sys-on-surface)); font-weight: 600; }
    .dd__src { font-size: 11px; padding: 0 7px; line-height: 18px; border-radius: 999px; color: var(--cc-text-2);
      border: 1px solid var(--cc-surface-border-strong, rgba(127,127,127,.3)); }
    .dd__spacer { flex: 1; }
    .dd__muted { color: var(--cc-text-3); }
    .dd__gh { display: inline-flex; align-items: center; gap: 4px; color: var(--mat-sys-primary); text-decoration: none; font-size: 12px; white-space: nowrap; }
    .dd__gh:hover { text-decoration: underline; }
    .dd__gh mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .dd__warn { display: flex; align-items: center; gap: 6px; margin: 0; padding: 6px 10px; border-radius: 8px; font-size: 12px;
      background: color-mix(in srgb, #d29922 12%, transparent); border: 1px solid color-mix(in srgb, #d29922 35%, transparent); }
    .dd__warn mat-icon { font-size: 16px; width: 16px; height: 16px; flex: none; color: color-mix(in srgb, #d29922 85%, var(--mat-sys-on-surface)); }
    .dd__bulk { display: flex; gap: 12px; }
    .dd__linkbtn { background: none; border: 0; padding: 0; font: inherit; font-size: 12px; color: var(--mat-sys-primary); cursor: pointer; }
    .dd__linkbtn:hover { text-decoration: underline; }
    .dd__files { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .dd-file { min-width: 0; border: 1px solid var(--cc-surface-border-strong, rgba(127,127,127,.3)); border-radius: 8px; overflow: hidden; }
    .dd-file__head { width: 100%; display: flex; align-items: center; gap: 6px; padding: 5px 8px; border: 0; cursor: pointer; text-align: left; font: inherit;
      font-size: 12px; color: inherit; background: var(--mat-sys-surface-container, color-mix(in srgb, var(--mat-sys-on-surface) 5%, transparent)); }
    .dd-file__head:hover .dd-file__path { text-decoration: underline; }
    .dd-file__chev { font-size: 18px; width: 18px; height: 18px; flex: none; color: var(--cc-text-3); }
    .dd-file__st { font-size: 15px; width: 15px; height: 15px; flex: none; color: var(--cc-text-2); }
    .dd-file__st--add { color: color-mix(in srgb, var(--dd-add) 80%, var(--mat-sys-on-surface)); }
    .dd-file__st--del { color: color-mix(in srgb, var(--dd-del) 80%, var(--mat-sys-on-surface)); }
    .dd-file__path { flex: 1; min-width: 0; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; }
    .dd-file__none { margin: 0; padding: 8px 10px; font-size: 12px; color: var(--cc-text-3); }
    .dd-file__more { display: block; padding: 6px 10px; }
    .dd-code { overflow-x: auto; max-height: 520px; overflow-y: auto; background: var(--mat-sys-surface-container-lowest, transparent);
      border-top: 1px solid var(--cc-surface-border, rgba(127,127,127,.18)); }
    .dd-rows { display: inline-block; min-width: 100%; padding: 2px 0; font-family: ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo, Consolas, monospace;
      font-size: 11.5px; line-height: 18px; }
    .dd-row { display: flex; }
    .dd-row__num { flex: none; width: 40px; padding-right: 6px; text-align: right; color: var(--cc-text-3); font-variant-numeric: tabular-nums; user-select: none; }
    .dd-row__sign { flex: none; width: 14px; text-align: center; user-select: none; }
    .dd-row__code { flex: 1 0 auto; padding: 0 12px 0 4px; white-space: pre; color: var(--mat-sys-on-surface); }
    .dd-row--addition { background: color-mix(in srgb, var(--dd-add) 16%, transparent); }
    .dd-row--addition .dd-row__sign { color: color-mix(in srgb, var(--dd-add) 80%, var(--mat-sys-on-surface)); }
    .dd-row--deletion { background: color-mix(in srgb, var(--dd-del) 16%, transparent); }
    .dd-row--deletion .dd-row__sign { color: color-mix(in srgb, var(--dd-del) 80%, var(--mat-sys-on-surface)); }
    .dd-row--info { background: color-mix(in srgb, var(--mat-sys-primary) 9%, transparent); }
    .dd-row--info .dd-row__code { color: var(--cc-text-2); }
    @media (max-width: 576px) { .dd-row__num { width: 30px; padding-right: 4px; } }
  `]
})
export class DeliverableDiffComponent {
  readonly itemNumber = input.required<number>();
  readonly deliverableId = input.required<string>();
  /** Link do GitHub da entrega (PR/branch) para quando o diff não vem. */
  readonly fallbackUrl = input<string | null>(null);

  private api = inject(WorkItemsService);

  readonly state = signal<'loading' | 'ready' | 'empty' | 'error'>('loading');
  readonly diff = signal<WorkDeliverableDiff | null>(null);
  readonly errorText = signal('');
  private readonly opened = signal<ReadonlySet<number>>(new Set());
  private readonly expandedAll = signal<ReadonlySet<number>>(new Set());
  private parsed = new Map<number, DiffLine[]>();
  private seq = 0;

  readonly files = computed<WorkDeliverableDiffFile[]>(() => this.diff()?.files ?? []);
  readonly totals = computed(() => this.files().reduce(
    (acc, f) => ({ additions: acc.additions + (f.additions ?? 0), deletions: acc.deletions + (f.deletions ?? 0) }),
    { additions: 0, deletions: 0 }));
  readonly githubLink = computed(() => this.diff()?.compareUrl || this.fallbackUrl() || null);

  constructor() {
    effect(() => {
      this.itemNumber();
      this.deliverableId();
      untracked(() => void this.load());
    });
  }

  async load(): Promise<void> {
    const seq = ++this.seq;
    this.state.set('loading');
    this.errorText.set('');
    this.parsed.clear();
    try {
      const d = await firstValueFrom(this.api.deliverableDiff(this.itemNumber(), this.deliverableId()));
      if (seq !== this.seq) return;
      this.diff.set(d);
      if (d?.error) {
        this.errorText.set(d.error);
        this.state.set('error');
        return;
      }
      const files = d?.files ?? [];
      this.opened.set(files.length <= OPEN_ALL_UP_TO ? new Set(files.map((_, i) => i)) : new Set());
      this.expandedAll.set(new Set());
      this.state.set(files.length ? 'ready' : 'empty');
    } catch (e) {
      if (seq !== this.seq) return;
      this.errorText.set((e as Error)?.message ?? '');
      this.state.set('error');
    }
  }

  fileLook(f: WorkDeliverableDiffFile) {
    return FILE_STATUS[`${f.status ?? ''}`] ?? FILE_STATUS['modified'];
  }

  isOpen(i: number): boolean {
    return this.opened().has(i);
  }

  toggle(i: number): void {
    const next = new Set(this.opened());
    if (next.has(i)) next.delete(i); else next.add(i);
    this.opened.set(next);
  }

  setAll(open: boolean): void {
    this.opened.set(open ? new Set(this.files().map((_, i) => i)) : new Set());
  }

  private lines(i: number): DiffLine[] {
    let l = this.parsed.get(i);
    if (!l) {
      l = parsePatch(this.files()[i]?.patch);
      this.parsed.set(i, l);
    }
    return l;
  }

  visibleLines(i: number): DiffLine[] {
    const l = this.lines(i);
    return this.expandedAll().has(i) || l.length <= MAX_LINES ? l : l.slice(0, MAX_LINES);
  }

  hiddenLines(i: number): number {
    const l = this.lines(i);
    return this.expandedAll().has(i) ? 0 : Math.max(0, l.length - MAX_LINES);
  }

  showAll(i: number): void {
    this.expandedAll.set(new Set([...this.expandedAll(), i]));
  }
}
