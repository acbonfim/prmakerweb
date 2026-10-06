import { Component, ElementRef, OnDestroy, ViewChild, computed, effect, inject, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { loadCytoscape } from '../../../helpers/cytoscape-loader';
import {
  ARCHITECTURE_KINDS,
  ArchitectureGraph,
  ArchitectureGraphEdge,
  ArchitectureGraphNode,
  ArchitectureService,
  RELATION_KINDS,
  relationKind
} from '../../../services/architecture.service';
import { friendlyEdge } from './kb-friendly';

/** Cor do nó por tipo de projeto (serviços externos em amarelo, igual à aresta "externo"). */
const NODE_COLORS: Record<string, string> = {
  ecosystem: '#f778ba', legacy: '#ff7b72', frontend: '#39c5cf', integration: '#3fb950', revamp: '#58a6ff',
  infra: '#8b949e', auth: '#a371f7', 'third-party': '#d29922', 'business-rules': '#e3b341', external: '#d29922', other: '#6e7681'
};

interface Neighbor { key: string; name: string; kind: string; mapped: boolean; edges: ArchitectureGraphEdge[]; }

/**
 * Mapa do ecossistema (0034): todos os projetos da Base Solvace e as interdependências extraídas do código (eventos SNS,
 * filas SQS, tabelas de outro módulo, HTTP, serviços externos). Filtros por tipo de relação e de projeto; clique num nó
 * destaca os vizinhos e lista "depende de / usado por" com o detalhe de cada ligação.
 */
@Component({
  selector: 'app-ecosystem-map',
  standalone: true,
  imports: [NgTemplateOutlet, FormsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  template: `
    <div class="map__head">
      @if (simple()) {
        <div>
          <h2>Como os sistemas se conectam</h2>
          <p class="map__hint">Escolha um sistema para ver com quem ele conversa: quem ele avisa, quem ele chama e quem depende dele.
            Passe o mouse nas ligações da lista para ver o detalhe técnico.</p>
        </div>
      } @else {
      <div>
        <h2>Mapa do ecossistema</h2>
        <p class="map__hint">Ligações extraídas do código de cada repositório (evidência na ficha do projeto). Clique num projeto para ver
          quem ele usa e quem depende dele; arraste para reorganizar, role para dar zoom.</p>
      </div>
      }
      <span class="spacer"></span>
      @if (graph(); as g) {
        @if (!simple() || selected()) { <span class="map__stat">{{ visibleCount().nodes }} {{ simple() ? 'sistemas' : 'projetos' }} · {{ visibleCount().edges }} ligações</span> }
      }
    </div>

    <div class="map__filters" role="group" aria-label="Filtros do mapa">
      <div class="map__search">
        <mat-icon>search</mat-icon>
        <input type="search" [placeholder]="simple() ? 'Achar sistema… (Enter)' : 'Achar projeto…'" [ngModel]="search()" (ngModelChange)="search.set($event)" (keydown.enter)="focusSearch()" />
      </div>
      @for (k of relationKinds(); track k.kind) {
        <button type="button" class="chip" [class.chip--off]="!relFilter().has(k.kind)" (click)="toggleRel(k.kind)"
                [matTooltip]="simple() ? k.label : k.count + ' ligações'">
          <span class="dot" [style.background]="k.color"></span>{{ simple() ? edgeText(k.kind) : k.label }}
        </button>
      }
      @if (!simple()) {
      <span class="sep"></span>
      @for (k of projectKinds(); track k.kind) {
        <button type="button" class="chip" [class.chip--off]="!kindFilter().has(k.kind)" (click)="toggleKind(k.kind)">
          <span class="dot dot--node" [style.background]="k.color"></span>{{ k.label }}
        </button>
      }
      <label class="chk"><input type="checkbox" [ngModel]="hideIsolated()" (ngModelChange)="hideIsolated.set($event)" /> esconder sem ligação</label>
      }
    </div>

    <div class="map__body">
      <div class="map__canvas-wrap">
        @if (loading()) { <div class="map__state"><mat-spinner diameter="28"></mat-spinner></div> }
        @if (error()) { <div class="map__state map__state--error"><mat-icon>error_outline</mat-icon>{{ error() }}</div> }
        @if (cyFailed()) {
          <div class="map__state"><mat-icon>cloud_off</mat-icon>Não foi possível carregar o desenho do mapa (sem acesso ao CDN) — use a lista ao lado.</div>
        }
        @if (simple() && !selected() && !loading() && !error()) {
          <div class="map__state map__pick"><mat-icon>touch_app</mat-icon>
            <span>Escolha um sistema na lista ao lado (ou pela busca) para ver a vizinhança dele.</span></div>
        }
        <div #canvas class="map__canvas" [class.map__canvas--hidden]="cyFailed() || !!error()"></div>
        <div class="map__zoom">
          <button mat-icon-button (click)="fit()" matTooltip="Enquadrar"><mat-icon>fit_screen</mat-icon></button>
          <button mat-icon-button (click)="relayout()" matTooltip="Reorganizar"><mat-icon>auto_awesome_mosaic</mat-icon></button>
        </div>
      </div>

      <aside class="map__panel">
        @if (selectedNode(); as n) {
          <div class="panel__head">
            <span class="dot dot--node" [style.background]="nodeColor(n.kind)"></span>
            <strong>{{ label(n) }}</strong>
            <span class="spacer"></span>
            <button mat-icon-button (click)="select(null)" aria-label="Limpar seleção"><mat-icon>close</mat-icon></button>
          </div>
          @if (!simple()) { <code class="panel__key">{{ n.key }}</code> }
          @if (n.mapped) {
            <button mat-stroked-button class="panel__open" (click)="openProject.emit(n.key)"><mat-icon>open_in_new</mat-icon>{{ simple() ? 'Abrir o sistema' : 'Abrir o projeto' }}</button>
          } @else {
            <div class="panel__muted">{{ n.kind === 'external' ? 'Serviço externo' : 'Ainda não mapeado na base' }}</div>
          }
          <h4>{{ simple() ? 'Ele conversa com' : 'Depende de' }} ({{ outgoing().length }})</h4>
          @for (x of outgoing(); track x.key) { <ng-container *ngTemplateOutlet="neighbor; context: { $implicit: x }"></ng-container> }
          @empty { <div class="panel__muted">nada encontrado no código</div> }
          <h4>{{ simple() ? 'Conversam com ele' : 'Usado por' }} ({{ incoming().length }})</h4>
          @for (x of incoming(); track x.key) { <ng-container *ngTemplateOutlet="neighbor; context: { $implicit: x }"></ng-container> }
          @empty { <div class="panel__muted">ninguém depende dele (no que foi mapeado)</div> }
        } @else {
          @if (simple()) {
            <div class="panel__head"><mat-icon>touch_app</mat-icon><strong>Escolha um sistema</strong></div>
            <div class="panel__muted">Os mais conectados primeiro — mudança neles costuma afetar muitos outros.</div>
          } @else {
          <div class="panel__head"><mat-icon>hub</mat-icon><strong>Hubs — mais usados</strong></div>
          <div class="panel__muted">Mudança nestes projetos costuma afetar muitos outros.</div>
          }
          @for (h of (simple() ? pickList() : hubs()); track h.key) {
            <button type="button" class="hub" (click)="select(h.key)">
              <span class="dot dot--node" [style.background]="nodeColor(h.kind)"></span>
              <span class="hub__name">{{ label(h) }}</span>
              <span class="hub__count" matTooltip="projetos que dependem dele">{{ h.users }}</span>
            </button>
          }
        }
      </aside>
    </div>

    <ng-template #neighbor let-x>
      <div class="nb">
        <button type="button" class="nb__name" (click)="select(x.key)">
          <span class="dot dot--node" [style.background]="nodeColor(x.kind)"></span>{{ label(x) }}
        </button>
        @for (e of x.edges; track e.kind) {
          @if (simple()) {
            <div class="nb__edge" [matTooltip]="rel(e.kind).label + (e.details.length ? '\n' + e.details.slice(0, 6).join('\n') : '')" matTooltipClass="kb-gloss-tip">
              <span class="nb__kind" [style.color]="rel(e.kind).color"><mat-icon>{{ rel(e.kind).icon }}</mat-icon>{{ edgePanel(e.kind) }}</span>
            </div>
          } @else {
          <div class="nb__edge">
            <span class="nb__kind" [style.color]="rel(e.kind).color"><mat-icon>{{ rel(e.kind).icon }}</mat-icon>{{ rel(e.kind).label }}
              @if (e.origin === 'engenharia' || e.origin === 'ambos') {
                <span class="nb__origin" matTooltip="Confirmada na engenharia reversa publicada (clique no item para ler)">engenharia reversa</span>
              }
            </span>
            @if (e.origin !== 'engenharia') {
              @for (d of e.details.slice(0, 3); track d) { <div class="nb__detail">{{ d }}</div> }
              @if (e.details.length > 3) { <div class="nb__detail nb__detail--more">+{{ e.details.length - 3 }}</div> }
            }
          </div>
          }
          <!-- 0066: os itens INT por trás da ligação — abrem o item na engenharia reversa -->
          @if (e.items?.length) {
            <div class="nb__items">
              @for (it of e.items!.slice(0, 6); track it.ref) {
                <button type="button" class="nb__item" (click)="openItem.emit(it.ref)" matTooltipClass="kb-gloss-tip"
                        [matTooltip]="(it.mechanism ? 'Como: ' + it.mechanism : '') + (it.contract ? '\nContrato: ' + it.contract : '') + (it.toConfirm ? '\n(a confirmar)' : '')">
                  <span class="nb__ref">{{ itemId(it.ref) }}</span><span class="nb__item-title">{{ it.title }}</span>
                  @if (it.toConfirm) { <mat-icon class="nb__warn">help_outline</mat-icon> }
                </button>
              }
              @if (e.items!.length > 6) { <div class="nb__detail nb__detail--more">+{{ e.items!.length - 6 }}</div> }
            </div>
          }
        }
      </div>
    </ng-template>
  `,
  styles: [`
    :host { display: block; }
    .map__head { display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
    .map__head h2 { font-size: 18px; margin: 0 0 4px; }
    .map__hint { font-size: 12.5px; margin: 0; max-width: 820px; color: color-mix(in srgb, var(--mat-sys-on-surface) 65%, transparent); }
    .map__stat { font-size: 12px; padding: 3px 10px; border-radius: 999px; background: rgba(255,255,255,.06); }
    .spacer { flex: 1 1 auto; }
    .map__filters { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 12px 0; }
    .map__search { display: flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 8px; background: rgba(0,0,0,.25);
      border: 1px solid rgba(255,255,255,.08); }
    .map__search mat-icon { font-size: 17px; width: 17px; height: 17px; opacity: .6; }
    .map__search input { width: 150px; border: none; outline: none; background: transparent; color: inherit; font: inherit; font-size: 12.5px; }
    .chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; font: inherit; font-size: 12px;
      cursor: pointer; color: inherit; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.12); }
    .chip--off { opacity: .4; text-decoration: line-through; }
    .dot { width: 10px; height: 3px; border-radius: 2px; display: inline-block; flex: none; }
    .dot--node { width: 9px; height: 9px; border-radius: 50%; }
    .sep { width: 1px; height: 18px; background: rgba(255,255,255,.12); margin: 0 4px; }
    .nb__origin { margin-left: 6px; font-size: 10.5px; padding: 0 6px; border-radius: 8px; background: rgba(63,185,80,.15); color: #3fb950; }
    .nb__items { display: flex; flex-direction: column; gap: 2px; margin: 2px 0 4px 22px; }
    .nb__item { display: flex; align-items: center; gap: 6px; border: none; background: transparent; padding: 1px 0; color: inherit; font: inherit;
      font-size: 12px; text-align: left; cursor: pointer; opacity: .9; }
    .nb__item:hover .nb__item-title { text-decoration: underline; }
    .nb__ref { flex: none; font-family: ui-monospace, monospace; font-size: 11px; padding: 0 5px; border-radius: 6px; background: rgba(255,255,255,.08);
      color: var(--mat-sys-primary); }
    .nb__item-title { overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .nb__warn { font-size: 14px; width: 14px; height: 14px; opacity: .6; flex: none; }
    .chk { font-size: 12px; display: inline-flex; align-items: center; gap: 4px; margin-left: 6px; opacity: .8; }
    .map__body { display: grid; grid-template-columns: 1fr 320px; gap: 12px; }
    .map__canvas-wrap { position: relative; min-height: max(560px, calc(100vh - 360px)); border-radius: 10px; background: rgba(0,0,0,.18); border: 1px solid rgba(255,255,255,.06); }
    .map__canvas { position: absolute; inset: 0; }
    .map__canvas--hidden { visibility: hidden; }
    .map__zoom { position: absolute; right: 6px; top: 6px; display: flex; flex-direction: column; }
    .map__state { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 24px;
      text-align: center; font-size: 13px; opacity: .8; z-index: 1; }
    .map__state--error { color: var(--mat-sys-error, #f2b8b5); }
    .map__pick { flex-direction: column; font-size: 14px; opacity: .75; }
    .map__pick mat-icon { font-size: 32px; width: 32px; height: 32px; color: var(--mat-sys-primary); }
    .nb__edge[mattooltip], .nb__edge.mat-mdc-tooltip-trigger { cursor: help; }
    .map__panel { max-height: max(560px, calc(100vh - 360px)); overflow-y: auto; padding: 10px 12px; border-radius: 10px; background: rgba(255,255,255,.03);
      border: 1px solid rgba(255,255,255,.06); }
    .panel__head { display: flex; align-items: center; gap: 8px; min-height: 36px; }
    .panel__head mat-icon { color: var(--mat-sys-primary); }
    .panel__key { display: block; margin: 0 0 2px 17px; font-size: 11.5px; opacity: .7; }
    .panel__open { display: flex; margin: 8px 0 4px; font-size: 12.5px; }
    .panel__open mat-icon { font-size: 17px; width: 17px; height: 17px; margin-right: 4px; }
    .panel__muted { font-size: 12px; opacity: .6; margin: 4px 0; }
    h4 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; margin: 14px 0 6px; opacity: .7; }
    .hub { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 6px; border: none; border-radius: 6px; background: transparent;
      color: inherit; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
    .hub:hover { background: rgba(255,255,255,.05); }
    .hub__name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hub__count { font-size: 11px; font-weight: 700; padding: 0 7px; border-radius: 9px; background: color-mix(in srgb, var(--mat-sys-primary) 20%, transparent); }
    .nb { padding: 6px 0; border-top: 1px solid rgba(255,255,255,.06); }
    .nb__name { display: flex; align-items: center; gap: 6px; border: none; background: transparent; color: inherit; font: inherit;
      font-size: 13px; font-weight: 600; cursor: pointer; padding: 2px 0; text-align: left; }
    .nb__name:hover { color: var(--mat-sys-primary); }
    .nb__edge { margin: 2px 0 2px 15px; }
    .nb__kind { display: inline-flex; align-items: center; gap: 3px; font-size: 11.5px; font-weight: 600; }
    .nb__kind mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .nb__detail { font-size: 11.5px; line-height: 1.4; opacity: .75; overflow-wrap: anywhere; }
    .nb__detail--more { opacity: .5; }
    @media (max-width: 1100px) {
      .map__body { grid-template-columns: 1fr; }
      .map__canvas-wrap { min-height: 440px; }
      .map__panel { max-height: none; }
    }
  `]
})
export class EcosystemMapComponent implements OnDestroy {
  private api = inject(ArchitectureService);

  /** Projeto a destacar ao abrir (?view=mapa&n=<chave>). */
  readonly focus = input<string | null>(null);
  /** 0038: modo Simples — só a vizinhança do sistema escolhido, nomes amigáveis e ligações em português. */
  readonly simple = input(false);
  /** Nome amigável por chave de projeto (displayName / sem prefixo técnico). */
  readonly names = input<Record<string, string>>({});
  readonly openProject = output<string>();
  /** 0066: abre um item da engenharia reversa (modulo#INT-001). */
  readonly openItem = output<string>();

  readonly graph = signal<ArchitectureGraph | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly cyFailed = signal(false);
  readonly search = signal('');
  readonly selected = signal<string | null>(null);
  readonly hideIsolated = signal(true);
  readonly relFilter = signal<Set<string>>(new Set(RELATION_KINDS.map(k => k.kind).filter(k => k !== 'package')));
  readonly kindFilter = signal<Set<string>>(new Set([...ARCHITECTURE_KINDS.map(k => k.kind), 'external']));

  @ViewChild('canvas', { static: true }) private canvas!: ElementRef<HTMLDivElement>;
  private cy: any = null;
  private readonly onResize = () => this.cy?.resize();

  readonly relationKinds = computed(() => {
    const edges = this.graph()?.edges ?? [];
    return RELATION_KINDS.map(k => ({ ...k, count: edges.filter(e => e.kind === k.kind).reduce((n, e) => n + e.count, 0) })).filter(k => k.count > 0);
  });

  readonly projectKinds = computed(() => {
    const present = new Set((this.graph()?.nodes ?? []).map(n => n.kind));
    const kinds = [...ARCHITECTURE_KINDS.map(k => ({ kind: k.kind, label: k.label })), { kind: 'external', label: 'Serviços externos' }];
    return kinds.filter(k => present.has(k.kind)).map(k => ({ ...k, color: this.nodeColor(k.kind) }));
  });

  /** Arestas e nós que passam nos filtros. */
  readonly visible = computed(() => {
    const g = this.graph();
    if (!g) return { nodes: [] as ArchitectureGraphNode[], edges: [] as ArchitectureGraphEdge[] };
    const kinds = this.kindFilter(), rels = this.relFilter();
    if (this.simple()) {
      const sel = this.selected();
      if (!sel) return { nodes: [] as ArchitectureGraphNode[], edges: [] as ArchitectureGraphEdge[] };
      const edges = g.edges.filter(e => rels.has(e.kind) && (e.source === sel || e.target === sel));
      const keys = new Set([sel, ...edges.flatMap(e => [e.source, e.target])]);
      return { nodes: g.nodes.filter(n => keys.has(n.key)), edges };
    }
    const nodeOk = new Set(g.nodes.filter(n => kinds.has(n.kind)).map(n => n.key));
    const edges = g.edges.filter(e => rels.has(e.kind) && nodeOk.has(e.source) && nodeOk.has(e.target));
    const linked = new Set(edges.flatMap(e => [e.source, e.target]));
    const nodes = g.nodes.filter(n => nodeOk.has(n.key) && (!this.hideIsolated() || linked.has(n.key) || n.key === this.selected()));
    return { nodes, edges };
  });

  readonly visibleCount = computed(() => ({ nodes: this.visible().nodes.length, edges: this.visible().edges.length }));

  readonly selectedNode = computed(() => this.graph()?.nodes.find(n => n.key === this.selected()) ?? null);
  readonly outgoing = computed(() => this.neighbors(e => e.source === this.selected(), e => e.target));
  readonly incoming = computed(() => this.neighbors(e => e.target === this.selected(), e => e.source));

  readonly hubs = computed(() => {
    const g = this.graph();
    if (!g) return [];
    const users = new Map<string, Set<string>>();
    for (const e of g.edges) users.set(e.target, (users.get(e.target) ?? new Set()).add(e.source));
    return g.nodes.map(n => ({ ...n, users: users.get(n.key)?.size ?? 0 }))
      .filter(n => n.users > 1).sort((a, b) => b.users - a.users || a.name.localeCompare(b.name)).slice(0, 12);
  });

  /** Modo Simples sem seleção: os sistemas mais conectados (e os que casam com a busca) para escolher. */
  readonly pickList = computed(() => {
    const g = this.graph();
    if (!g) return [];
    const degree = new Map<string, number>();
    for (const e of g.edges) { degree.set(e.source, (degree.get(e.source) ?? 0) + 1); degree.set(e.target, (degree.get(e.target) ?? 0) + 1); }
    const q = normalize(this.search());
    return g.nodes.filter(n => n.mapped && (degree.get(n.key) ?? 0) > 0 && (!q || normalize(`${this.label(n)} ${n.name} ${n.key}`).includes(q)))
      .map(n => ({ ...n, users: degree.get(n.key) ?? 0 }))
      .sort((a, b) => b.users - a.users || this.label(a).localeCompare(this.label(b))).slice(0, q ? 30 : 20);
  });

  constructor() {
    this.api.graph().subscribe({
      next: g => { this.graph.set(g); this.loading.set(false); },
      error: () => { this.error.set('Não foi possível carregar o mapa.'); this.loading.set(false); }
    });
    loadCytoscape().catch(() => this.cyFailed.set(true));
    // Redesenha quando os dados/filtros mudam; a seleção só troca as classes (sem refazer o layout).
    effect(() => {
      const v = this.visible();
      if (!this.graph()) return;
      loadCytoscape().then(cytoscape => this.draw(cytoscape, v)).catch(() => this.cyFailed.set(true));
    });
    effect(() => { const sel = this.selected(); if (!this.simple()) this.highlight(sel); });
    effect(() => {
      const f = this.focus();
      if (f && this.graph()?.nodes.some(n => n.key === f)) this.selected.set(f);
    });
    window.addEventListener('resize', this.onResize);
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.onResize);
    this.cy?.destroy();
  }

  select(key: string | null): void {
    this.selected.set(key);
    if (key && this.cy) {
      const node = this.cy.getElementById(key);
      if (node?.nonempty?.()) this.cy.animate({ center: { eles: node }, duration: 250 });
    }
  }

  focusSearch(): void {
    const q = normalize(this.search());
    if (!q) return;
    const pool = this.simple() ? (this.graph()?.nodes ?? []) : this.visible().nodes;
    const hit = pool.find(n => normalize(`${this.label(n)} ${n.name} ${n.key}`).includes(q));
    if (hit) this.select(hit.key);
  }

  toggleRel(kind: string): void { this.relFilter.update(s => toggled(s, kind)); }
  toggleKind(kind: string): void { this.kindFilter.update(s => toggled(s, kind)); }
  fit(): void { this.cy?.fit(undefined, 30); }
  relayout(): void { this.runLayout(true); }

  rel(kind: string) { return relationKind(kind); }
  itemId(ref: string): string { return ref.includes('#') ? ref.split('#')[1] : ref; }
  edgeText(kind: string): string { return friendlyEdge(kind).label; }
  edgePanel(kind: string): string { return friendlyEdge(kind).panel; }
  label(n: { key: string; name: string }): string { return this.names()[n.key] || shortName(n.name); }
  nodeColor(kind: string): string { return NODE_COLORS[kind] ?? NODE_COLORS['other']; }

  private neighbors(match: (e: ArchitectureGraphEdge) => boolean, other: (e: ArchitectureGraphEdge) => string): Neighbor[] {
    const g = this.graph();
    if (!g || !this.selected()) return [];
    const map = new Map<string, Neighbor>();
    for (const e of g.edges.filter(match)) {
      const key = other(e);
      const node = g.nodes.find(n => n.key === key);
      const item = map.get(key) ?? { key, name: node?.name ?? key, kind: node?.kind ?? 'other', mapped: node?.mapped ?? false, edges: [] };
      item.edges.push(e);
      map.set(key, item);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private draw(cytoscape: any, v: { nodes: ArchitectureGraphNode[]; edges: ArchitectureGraphEdge[] }): void {
    const degree = new Map<string, number>();
    for (const e of v.edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    const elements = [
      ...v.nodes.map(n => ({
        data: { id: n.key, label: this.label(n), color: this.nodeColor(n.kind), size: 16 + Math.min(40, Math.sqrt(degree.get(n.key) ?? 0) * 7) },
        classes: n.mapped ? '' : 'unmapped'
      })),
      ...v.edges.map(e => ({
        data: { id: `${e.source}>${e.target}>${e.kind}`, source: e.source, target: e.target, color: relationKind(e.kind).color, width: 1 + Math.min(4, e.count),
          label: this.simple() ? friendlyEdge(e.kind).label : '' }
      }))
    ];
    const text = getComputedStyle(this.canvas.nativeElement).color || '#e6edf3';
    if (!this.cy) {
      this.cy = cytoscape({
        container: this.canvas.nativeElement,
        elements,
        minZoom: 0.15,
        maxZoom: 3,
        wheelSensitivity: 0.25,
        style: [
          { selector: 'node', style: {
            'background-color': 'data(color)', width: 'data(size)', height: 'data(size)', label: 'data(label)', color: text,
            'font-size': 'mapData(size, 16, 56, 11, 20)', 'text-valign': 'bottom', 'text-margin-y': 3, 'text-outline-width': 2,
            'text-outline-color': '#161b22', 'min-zoomed-font-size': 5 } },
          { selector: 'node.unmapped', style: { shape: 'round-rectangle', 'border-width': 1, 'border-color': text, 'border-style': 'dashed' } },
          { selector: 'edge', style: {
            'line-color': 'data(color)', 'target-arrow-color': 'data(color)', 'target-arrow-shape': 'triangle', 'arrow-scale': 0.8,
            width: 'data(width)', 'curve-style': 'bezier', opacity: 0.55, label: 'data(label)', 'font-size': 10, color: text,
            'text-rotation': 'autorotate', 'text-outline-width': 2, 'text-outline-color': '#161b22', 'min-zoomed-font-size': 7 } },
          { selector: '.faded', style: { opacity: 0.08, 'text-opacity': 0.15 } },
          { selector: 'node.focus', style: { 'border-width': 3, 'border-color': '#ffffff' } },
          { selector: 'edge.near', style: { opacity: 1 } }
        ]
      });
      this.cy.on('tap', 'node', (evt: any) => this.selected.set(evt.target.id()));
      this.cy.on('tap', (evt: any) => { if (evt.target === this.cy) this.selected.set(null); });
    } else {
      this.cy.elements().remove();
      this.cy.add(elements);
    }
    this.runLayout(false);
    this.highlight(this.selected());
  }

  private runLayout(animate: boolean): void {
    if (!this.cy) return;
    if (this.simple()) {
      const sel = this.selected();
      this.cy.layout({ name: 'concentric', animate, animationDuration: 300, concentric: (n: any) => (n.id() === sel ? 2 : 1), levelWidth: () => 1,
        minNodeSpacing: 70, padding: 40, nodeDimensionsIncludeLabels: true }).run();
      return;
    }
    this.cy.layout({
      name: 'cose', animate, animationDuration: 400, randomize: !animate, nodeRepulsion: () => 22000, idealEdgeLength: () => 130,
      edgeElasticity: () => 60, gravity: 0.2, nestingFactor: 1.2, componentSpacing: 80, numIter: 1500, padding: 30, nodeDimensionsIncludeLabels: true
    }).run();
  }

  private highlight(key: string | null): void {
    const cy = this.cy;
    if (!cy) return;
    cy.elements().removeClass('faded focus near');
    if (!key) return;
    const node = cy.getElementById(key);
    if (!node || node.empty()) return;
    const hood = node.closedNeighborhood();
    cy.elements().not(hood).addClass('faded');
    node.addClass('focus');
    hood.edges().addClass('near');
  }
}

function toggled(set: Set<string>, value: string): Set<string> {
  const next = new Set(set);
  next.has(value) ? next.delete(value) : next.add(value);
  return next;
}

function shortName(name: string): string {
  return name.replace(/^Revamp( infra)? — /, '').replace(/^Serviço externo — /, '');
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
