import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PlanMarkdownPipe } from '../../../components/execution-plan/plan-markdown.pipe';
import {
  REVERSE_DOCS, ReverseEngineeringService, ReverseIndexHit, ReverseItem, ReverseKind, ReverseModuleSummary
} from '../../../services/reverse-engineering.service';

/**
 * Índice da engenharia reversa (0052): busca por item em um ou vários módulos (regras, casos de uso, telas, endpoints,
 * tabelas, integrações...), filtros por tipo/módulo/documento e o modo Impacto (quem usa uma tabela, um item ou um
 * módulo). O mesmo índice que as análises consultam pelo MCP.
 */
@Component({
  selector: 'app-re-index',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, PlanMarkdownPipe],
  template: `
    <section class="idx">
      <div class="bar">
        <div class="mode">
          <button type="button" [class.on]="mode() === 'search'" (click)="mode.set('search')"><mat-icon>search</mat-icon>Buscar</button>
          <button type="button" [class.on]="mode() === 'impact'" (click)="mode.set('impact')"
                  matTooltip="Quem (em qualquer módulo) cita uma tabela TB_…, um item módulo#ID, um módulo ou uma tag"><mat-icon>hub</mat-icon>Impacto</button>
        </div>
        <input type="search" [placeholder]="mode() === 'search' ? 'Regra, tela, mensagem, tabela, RN-012…' : 'TB_MLH_MELHORIAS, revamp-users#API-004, revamp-users…'"
               [(ngModel)]="query" (keydown.enter)="run()">
        <button mat-flat-button color="primary" type="button" (click)="run()" [disabled]="loading()">Ir</button>
      </div>
      @if (mode() === 'search') {
        <div class="filters">
          <select [(ngModel)]="module" (change)="run()">
            <option value="">Todos os módulos</option>
            @for (m of modules(); track m.key) { @if (m.items) { <option [value]="m.key">{{ m.displayName || m.name }} ({{ m.world }})</option> } }
          </select>
          <select [(ngModel)]="doc" (change)="run()">
            <option value="">Todos os documentos</option>
            @for (d of docs; track d.key) { <option [value]="d.key">{{ d.short }}</option> }
          </select>
          <div class="kinds">
            @for (k of kinds(); track k.prefix) {
              <button type="button" class="kind" [class.on]="selectedKinds().includes(k.prefix)" (click)="toggleKind(k.prefix)" [matTooltip]="k.plural">{{ k.prefix }}</button>
            }
          </div>
        </div>
      }
      @if (loading()) { <div class="state"><mat-spinner diameter="22"></mat-spinner></div> }
      @if (!loading() && searched()) {
        <div class="muted">{{ hits().length }} itens{{ hits().length >= limit ? ' (refine a busca)' : '' }}</div>
        <div class="results">
          @for (g of grouped(); track g.module) {
            <div class="group">
              <div class="group__title">{{ g.name }} <span class="muted">{{ g.module }}</span></div>
              @for (h of g.hits; track h.ref) {
                <button type="button" class="hit" [class.hit--on]="openRef() === h.ref" (click)="openItem(h)">
                  <span class="id">{{ h.itemId }}</span>
                  <span class="hit__title">{{ h.title }}</span>
                  <span class="chip">{{ h.kindLabel }}</span>
                  @if (h.tables.length) { <span class="muted">{{ h.tables.slice(0, 3).join(', ') }}</span> }
                </button>
                @if (openRef() === h.ref) {
                  <div class="item">
                    @if (item(); as it) {
                      <div class="item__meta">
                        <a (click)="goTo.emit({ module: it.moduleKey, doc: it.docType, item: it.itemId })">Abrir no documento ({{ it.docType }})</a>
                        @if (it.referencedBy.length) { <span class="muted">citado por: {{ it.referencedBy.join(', ') }}</span> }
                      </div>
                      <div class="md" [innerHTML]="it.body | planMarkdown"></div>
                    } @else { <mat-spinner diameter="18"></mat-spinner> }
                  </div>
                }
              }
            </div>
          } @empty { <div class="muted">Nada encontrado. Tente sinônimos, o nome da tela ou da tabela.</div> }
        </div>
      }
    </section>
  `,
  styles: [`
    .idx { display: flex; flex-direction: column; gap: 8px; }
    .bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .bar input { flex: 1 1 260px; padding: 8px 10px; border-radius: 8px; background: rgba(0,0,0,.3); color: inherit; border: 1px solid rgba(255,255,255,.15); font: inherit; }
    .mode { display: inline-flex; border-radius: 8px; overflow: hidden; border: 1px solid rgba(255,255,255,.15); }
    .mode button { display: inline-flex; align-items: center; gap: 4px; padding: 6px 10px; border: none; background: transparent; color: inherit; cursor: pointer; font: inherit; font-size: 13px; }
    .mode button.on { background: color-mix(in srgb, var(--mat-sys-primary) 20%, transparent); color: var(--mat-sys-primary); }
    .mode mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .filters select { padding: 5px 8px; border-radius: 6px; background: rgba(0,0,0,.3); color: inherit; border: 1px solid rgba(255,255,255,.15); font: inherit; font-size: 12.5px; }
    .kinds { display: flex; flex-wrap: wrap; gap: 3px; }
    .kind { font-size: 11px; padding: 2px 6px; border-radius: 6px; border: 1px solid rgba(255,255,255,.15); background: transparent; color: inherit; cursor: pointer; }
    .kind.on { background: color-mix(in srgb, var(--mat-sys-primary) 25%, transparent); border-color: var(--mat-sys-primary); }
    .state { display: flex; justify-content: center; padding: 12px; }
    .muted { font-size: 12px; opacity: .65; }
    .group { margin: 8px 0; }
    .group__title { font-size: 13px; font-weight: 600; margin-bottom: 4px; }
    .hit { display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 8px; border: none; border-radius: 6px; background: transparent; color: inherit;
      text-align: left; cursor: pointer; font: inherit; font-size: 13px; }
    .hit:hover, .hit--on { background: rgba(255,255,255,.05); }
    .id { font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 600; min-width: 64px; }
    .hit__title { flex: 1; min-width: 0; }
    .chip { font-size: 11px; padding: 0 6px; border-radius: 8px; background: rgba(255,255,255,.07); white-space: nowrap; }
    .item { margin: 4px 0 10px 72px; padding: 8px 12px; border-left: 2px solid var(--mat-sys-primary); }
    .item__meta { display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; margin-bottom: 4px; }
    .item__meta a { color: var(--mat-sys-primary); cursor: pointer; }
    .md { font-size: 13px; line-height: 1.55; }
  `]
})
export class ReIndexComponent {
  private api = inject(ReverseEngineeringService);
  modules = input<ReverseModuleSummary[]>([]);
  kinds = input<ReverseKind[]>([]);
  goTo = output<{ module: string; doc: string; item?: string }>();
  readonly docs = REVERSE_DOCS;
  readonly limit = 80;

  mode = signal<'search' | 'impact'>('search');
  query = '';
  module = '';
  doc = '';
  selectedKinds = signal<string[]>([]);
  loading = signal(false);
  searched = signal(false);
  hits = signal<ReverseIndexHit[]>([]);
  openRef = signal<string | null>(null);
  item = signal<ReverseItem | null>(null);

  grouped = computed(() => {
    const names = new Map(this.modules().map(m => [m.key, m.displayName || m.name]));
    const groups = new Map<string, ReverseIndexHit[]>();
    for (const h of this.hits()) groups.set(h.moduleKey, [...(groups.get(h.moduleKey) ?? []), h]);
    return [...groups.entries()].map(([module, hits]) => ({ module, name: names.get(module) ?? module, hits }));
  });

  toggleKind(prefix: string) {
    this.selectedKinds.update(k => k.includes(prefix) ? k.filter(x => x !== prefix) : [...k, prefix]);
    this.run();
  }

  /** Busca externa (ex.: a página abre o índice com um termo). */
  searchFor(term: string, mode: 'search' | 'impact' = 'search') {
    this.mode.set(mode);
    this.query = term;
    this.run();
  }

  run() {
    const q = this.query.trim();
    if (this.mode() === 'impact' && !q) return;
    if (this.mode() === 'search' && !q && !this.module && !this.selectedKinds().length) return;
    this.loading.set(true);
    this.openRef.set(null);
    const req = this.mode() === 'impact'
      ? this.api.impact(q)
      : this.api.search(q, { module: this.module, doc: this.doc, kind: this.selectedKinds().join(','), limit: this.limit });
    req.subscribe({
      next: h => { this.hits.set(h); this.loading.set(false); this.searched.set(true); },
      error: () => { this.hits.set([]); this.loading.set(false); this.searched.set(true); }
    });
  }

  openItem(h: ReverseIndexHit) {
    if (this.openRef() === h.ref) { this.openRef.set(null); return; }
    this.openRef.set(h.ref);
    this.item.set(null);
    this.api.items([h.ref]).subscribe({ next: i => this.item.set(i[0] ?? null) });
  }
}
