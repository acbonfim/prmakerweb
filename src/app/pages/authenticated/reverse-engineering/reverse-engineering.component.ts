import { Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PlanMarkdownPipe } from '../../../components/execution-plan/plan-markdown.pipe';
import { renderMermaidIn } from '../../../helpers/mermaid-loader';
import { WsService } from '../../../services/ws.service';
import {
  REVERSE_DOCS, REVERSE_EVENT, ReverseDoc, ReverseDocStatus, ReverseDocType, ReverseEngineeringService, ReverseModule, ReverseModuleSummary,
  ReverseRevisionHead, ReverseSettings, ReverseSource, reverseGroup, reverseState
} from '../../../services/reverse-engineering.service';
import { ReHowToComponent } from './re-how-to.component';
import { ReProgressComponent } from './re-progress.component';
import { ReRevisionComponent } from './re-revision.component';
import { ReAssetsComponent } from './re-assets.component';
import { ReIndexComponent } from './re-index.component';
import { ReGlossaryComponent } from './re-glossary.component';
import { ReTrapsComponent } from './re-traps.component';
import { ReCopyCommandComponent } from './re-copy-command.component';

type View = 'modulos' | 'revisoes' | 'indice' | 'glossario';

/**
 * Engenharia reversa (feature 0052): cada módulo (legado ou revamp) com os seis documentos — levantamento funcional,
 * levantamento de arquitetura, UI/UX, especificação de visão, de arquitetura e de design. Mostra como gerar (comando
 * para o Claude Code na máquina do usuário), o andamento ao vivo de cada sessão, a revisão com aprovação e o publicado
 * (que vale na Base Solvace e nas análises). Links: ?m=<módulo>&d=<doc>&i=<item>, ?v=revisoes|indice&q=<termo>.
 */
@Component({
  selector: 'app-reverse-engineering',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, PlanMarkdownPipe,
    ReHowToComponent, ReProgressComponent, ReRevisionComponent, ReAssetsComponent, ReIndexComponent, ReGlossaryComponent, ReTrapsComponent, ReCopyCommandComponent],
  templateUrl: './reverse-engineering.component.html',
  styleUrls: ['./reverse-engineering.component.css']
})
export class ReverseEngineeringComponent implements OnInit, OnDestroy {
  private api = inject(ReverseEngineeringService);
  private ws = inject(WsService);
  private route = inject(ActivatedRoute);
  readonly router = inject(Router);
  private snack = inject(MatSnackBar);
  /**
   * 0053: o conteúdo do documento pode ser redesenhado a qualquer momento (app zoneless, tempo real, volta do Índice) —
   * as âncoras dos itens são postas a cada mudança no DOM (MutationObserver), não uma vez só depois da carga.
   */
  @ViewChild('docContent') set docContentRef(ref: ElementRef<HTMLElement> | undefined) { this.observeDoc(ref?.nativeElement); }
  private docEl?: HTMLElement;
  private docObserver?: MutationObserver;
  private mermaidFor?: string;
  private pendingScroll: { id: string; until: number } | null = null;
  @ViewChild(ReIndexComponent) indexRef?: ReIndexComponent;

  readonly docs = REVERSE_DOCS;
  readonly state = reverseState;

  view = signal<View>('modulos');
  settings = signal<ReverseSettings | null>(null);
  docTypes = signal<ReverseDocType[]>([]);
  modules = signal<ReverseModuleSummary[]>([]);
  loading = signal(true);
  filter = signal('');
  world = signal<string>('');
  treeOpen = signal(false);

  moduleKey = signal<string | null>(null);
  module = signal<ReverseModule | null>(null);
  moduleLoading = signal(false);
  docKey = signal<string>('funcional');
  doc = signal<ReverseDoc | null>(null);
  docLoading = signal(false);
  showHowTo = signal(false);
  showSources = signal(false);
  showHistory = signal(false);
  tocFilter = signal('');
  pending = signal<ReverseRevisionHead[]>([]);
  /** 0054: divergências Knowledge Center × código (para o time de produto). */
  kc = signal<{ id: string; projectKey: string; content: string; cardNumber?: string | null; createdBy: string; itemId?: string | null }[]>([]);
  /** Muda a cada evento da revisão aberta — o painel de revisão recarrega. */
  revisionStamp = signal<string | null>(null);

  sourcesDraft: ReverseSource[] = [];
  aliasesDraft = '';

  private currentGroup: string | null = null;
  private listReload: ReturnType<typeof setTimeout> | null = null;

  totals = computed(() => {
    const ms = this.modules();
    const recent = (h?: ReverseRevisionHead | null) => !!h?.progressAt && Date.now() - new Date(h.progressAt).getTime() < 3 * 60000
      && ['draft', 'changes'].includes(h.status);
    return {
      modules: ms.length,
      complete: ms.filter(m => m.complete).length,
      started: ms.filter(m => m.docs.some(d => d.published || d.open)).length,
      review: ms.reduce((n, m) => n + m.inReview, 0),
      live: ms.reduce((n, m) => n + m.docs.filter(d => recent(d.open)).length, 0),
      items: ms.reduce((n, m) => n + m.items, 0)
    };
  });

  groups = computed(() => {
    const f = this.normalize(this.filter());
    const w = this.world();
    const map = new Map<string, ReverseModuleSummary[]>();
    for (const m of this.modules()) {
      if (w && m.world !== w) continue;
      if (f && !this.normalize(`${m.key} ${m.name} ${m.displayName ?? ''} ${m.businessArea ?? ''} ${m.aliases.join(' ')}`).includes(f)) continue;
      const area = m.businessArea || m.displayName || m.name;
      map.set(area, [...(map.get(area) ?? []), m]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR')).map(([area, modules]) => ({ area, modules }));
  });

  docStatus = computed<ReverseDocStatus | null>(() => this.module()?.docs.find(d => d.type === this.docKey()) ?? null);
  docType = computed(() => this.docTypes().find(t => t.key === this.docKey()) ?? null);
  openRevision = computed(() => this.docStatus()?.open ?? null);
  /** 0056: grupos do sumário que vêm recolhidos (o glossário tem centenas de termos) — abertos por clique ou ao ir a um item. */
  private static readonly COLLAPSED_KINDS = ['GLO'];
  readonly tocOpened = signal<Set<string>>(new Set());
  tocCollapsed(kind: string) {
    return ReverseEngineeringComponent.COLLAPSED_KINDS.includes(kind) && !this.tocOpened().has(kind) && !this.tocFilter().trim();
  }
  isTocCollapsible(kind: string) { return ReverseEngineeringComponent.COLLAPSED_KINDS.includes(kind); }
  toggleTocGroup(kind: string) {
    if (!this.isTocCollapsible(kind)) return;
    this.tocOpened.update(s => { const n = new Set(s); n.has(kind) ? n.delete(kind) : n.add(kind); return n; });
  }

  /** 0056: painel de termos sugeridos do glossário — sempre recolhido; quem abre fica lembrado (só neste navegador). */
  readonly termsOpen = signal(ReverseEngineeringComponent.readTermsOpen());
  private static readonly TERMS_KEY = 're.termsOpen';
  private static readTermsOpen(): boolean {
    try { return localStorage.getItem(ReverseEngineeringComponent.TERMS_KEY) === '1'; } catch { return false; }
  }
  onTermsToggle(ev: Event) {
    const open = (ev.target as HTMLDetailsElement).open;
    this.termsOpen.set(open);
    try { localStorage.setItem(ReverseEngineeringComponent.TERMS_KEY, open ? '1' : '0'); } catch { /* sem storage: só nesta tela */ }
  }

  toc = computed(() => {
    const f = this.normalize(this.tocFilter());
    const items = (this.doc()?.items ?? []).filter(i => !f || this.normalize(`${i.id} ${i.title}`).includes(f));
    const kinds = this.settings()?.kinds ?? [];
    const map = new Map<string, typeof items>();
    for (const i of items) map.set(i.kind, [...(map.get(i.kind) ?? []), i]);
    return [...map.entries()].map(([kind, list]) => ({ kind, label: kinds.find(k => k.prefix === kind)?.plural ?? kind, items: list }));
  });

  private onRealtime = (head: ReverseRevisionHead) => {
    if (!head?.moduleKey) return;
    // lista: recarrega no máximo a cada 4 s (vários eventos de andamento seguidos)
    if (!this.listReload) this.listReload = setTimeout(() => { this.listReload = null; this.loadModules(false); if (this.view() === 'revisoes') this.loadPending(); }, 4000);
    const m = this.module();
    if (!m || m.key !== head.moduleKey || !head.progress && !head.status) return;
    const doc = m.docs.find(d => d.type === head.docType);
    if (!doc) return;
    const before = doc.open?.status;
    const open = ['draft', 'review', 'changes', 'approved'].includes(head.status);
    this.module.set({ ...m, docs: m.docs.map(d => d.type === head.docType ? { ...d, open: open ? { ...d.open, ...head } as ReverseRevisionHead : null, state: open ? head.status : d.state } : d) });
    if (head.docType === this.docKey()) this.revisionStamp.set(`${head.id}:${head.status}:${head.updatedAt}`);
    if (before !== head.status) {
      this.loadModule(head.moduleKey, false);
      if (head.docType === this.docKey()) this.loadDoc();
    }
  };

  ngOnInit() {
    this.api.settings().subscribe({ next: s => this.settings.set(s) });
    this.api.docTypes().subscribe({ next: t => this.docTypes.set(t) });
    this.loadModules(true);
    this.ws.startConnection();
    this.ws.on(REVERSE_EVENT, this.onRealtime);
    this.ws.addToGroup(reverseGroup(null));
    this.route.queryParamMap.subscribe(q => {
      const v = (q.get('v') as View) || 'modulos';
      this.view.set(v);
      const m = q.get('m');
      const d = q.get('d') || 'funcional';
      if (v === 'revisoes') this.loadPending();
      if (v === 'indice' && q.get('q')) setTimeout(() => this.indexRef?.searchFor(q.get('q')!, (q.get('mode') as any) || 'search'));
      if (m && (m !== this.moduleKey() || d !== this.docKey())) {
        const moduleChanged = m !== this.moduleKey();
        this.moduleKey.set(m);
        this.docKey.set(d);
        if (moduleChanged) this.loadModule(m, true);
        this.loadDoc(q.get('i'));
      }
      if (!m && v === 'modulos') { this.moduleKey.set(null); this.module.set(null); this.joinModuleGroup(null); }
    });
  }

  ngOnDestroy() {
    this.docObserver?.disconnect();
    this.ws.off(REVERSE_EVENT, this.onRealtime);
    this.ws.removeFromGroup(reverseGroup(null));
    this.joinModuleGroup(null);
    if (this.listReload) clearTimeout(this.listReload);
  }

  // ── Navegação ──────────────────────────────────────────────────────────────────────────────

  setView(v: View) { this.router.navigate([], { relativeTo: this.route, queryParams: { v: v === 'modulos' ? null : v, m: null, d: null, i: null, q: null } }); }

  openModule(key: string, doc?: string, item?: string) {
    this.treeOpen.set(false);
    this.router.navigate([], { relativeTo: this.route, queryParams: { v: null, m: key, d: doc ?? this.defaultDoc(key), i: item ?? null } });
  }

  selectDoc(doc: string) { this.router.navigate([], { relativeTo: this.route, queryParams: { d: doc, i: null }, queryParamsHandling: 'merge' }); }

  private defaultDoc(key: string) {
    const m = this.modules().find(x => x.key === key);
    return m?.docs.find(d => d.open && ['review', 'approved', 'draft', 'changes'].includes(d.open.status))?.type ?? 'funcional';
  }

  // ── Carga ──────────────────────────────────────────────────────────────────────────────────

  loadModules(spinner: boolean) {
    if (spinner) this.loading.set(true);
    this.api.modules().subscribe({
      next: m => { this.modules.set(m); this.loading.set(false); },
      error: e => { this.loading.set(false); this.toast(e); }
    });
  }

  loadModule(key: string, spinner: boolean) {
    if (spinner) { this.moduleLoading.set(true); this.module.set(null); }
    this.joinModuleGroup(key);
    this.api.module(key).subscribe({
      next: m => {
        this.module.set(m);
        this.moduleLoading.set(false);
        if (spinner) this.showHowTo.set(!m.docs.some(d => d.published || d.open));
      },
      error: e => { this.moduleLoading.set(false); this.toast(e); }
    });
  }

  loadDoc(item?: string | null) {
    const key = this.moduleKey(); if (!key) return;
    this.docLoading.set(true);
    this.api.doc(key, this.docKey()).subscribe({
      next: d => {
        this.doc.set(d);
        this.docLoading.set(false);
        if (item) this.scrollTo(item);
      },
      error: e => { this.docLoading.set(false); this.doc.set(null); this.toast(e); }
    });
  }

  loadPending() {
    this.api.revisions({ status: 'open' }).subscribe({ next: r => this.pending.set(r) });
    this.api.kcDivergences().subscribe({ next: k => this.kc.set(k as any) });
  }

  /** 0054: sugestão que é "o que deu errado" vira armadilha ligada ao item (aprovador). */
  suggestionToTrap(id: string) {
    this.api.suggestionToTrap(id).subscribe({
      next: () => { this.snack.open('Virou armadilha do módulo.', 'OK', { duration: 2500 }); this.loadDoc(); const k = this.moduleKey(); if (k) this.loadModule(k, false); },
      error: e => this.toast(e)
    });
  }

  objectEntriesS(o: Record<string, string> | undefined | null) { return Object.entries(o ?? {}); }
  supersededKeys(o: Record<string, string> | undefined | null) { return Object.keys(o ?? {}).join(', '); }

  private joinModuleGroup(key: string | null) {
    const group = key ? reverseGroup(key) : null;
    if (group === this.currentGroup) return;
    if (this.currentGroup) this.ws.removeFromGroup(this.currentGroup);
    this.currentGroup = group;
    if (group) this.ws.addToGroup(group);
  }

  /** Liga o observador no conteúdo do documento (o @ViewChild muda quando o bloco é redesenhado). */
  private observeDoc(el: HTMLElement | undefined) {
    if (el === this.docEl) return;
    this.docObserver?.disconnect();
    this.docEl = el;
    if (!el) return;
    this.decorate();
    this.docObserver = new MutationObserver(() => this.decorate());
    this.docObserver.observe(el, { childList: true, subtree: true });
  }

  /** Âncoras nos itens (### RN-012 — …) para o sumário e os links ?i=; diagramas mermaid uma vez por conteúdo. */
  private decorate() {
    const root = this.docEl; if (!root) return;
    root.querySelectorAll('h2, h3, h4').forEach(h => {
      if (h.id) return;
      const m = /^\s*([A-Z]{2,4}-\d{1,4})\b/.exec(h.textContent ?? '');
      if (m) h.id = `item-${m[1]}`;
    });
    const key = `${this.moduleKey()}|${this.docKey()}|${this.doc()?.published?.version}`;
    if (this.mermaidFor !== key) {
      this.mermaidFor = key;
      // o diagrama muda a altura da página: depois de desenhar, rola de novo até o item pedido
      renderMermaidIn(root).then(() => { const p = this.pendingScroll; if (p && Date.now() < p.until) this.reveal(p.id, false); });
    }
    const p = this.pendingScroll;
    if (p && Date.now() < p.until && !document.getElementById(`item-${p.id}`)?.dataset['revealed']) this.reveal(p.id, true);
  }

  scrollTo(id: string) {
    const kind = /^([A-Z]{2,4})-/.exec(id)?.[1];
    if (kind && this.isTocCollapsible(kind)) this.tocOpened.update(s => new Set(s).add(kind));
    this.pendingScroll = { id, until: Date.now() + 4000 };
    if (!document.getElementById(`item-${id}`)) this.decorate();
    this.reveal(id, true);
  }

  private reveal(id: string, flash: boolean) {
    const el = document.getElementById(`item-${id}`);
    if (!el) return; // ainda não desenhado: o observador tenta de novo quando o conteúdo aparecer
    el.dataset['revealed'] = '1';
    el.scrollIntoView({ behavior: flash ? 'smooth' : 'auto', block: 'start' });
    if (flash) {
      el.classList.add('flash');
      setTimeout(() => { el.classList.remove('flash'); delete el.dataset['revealed']; }, 1800);
    }
  }

  // ── Fontes e apelidos (aprovadores) ────────────────────────────────────────────────────────

  editSources() {
    const m = this.module(); if (!m) return;
    this.sourcesDraft = m.sources.map(s => ({ ...s }));
    if (!this.sourcesDraft.length) this.sourcesDraft.push({ repository: '', path: '', role: 'backend' });
    this.aliasesDraft = m.aliases.join(', ');
    this.showSources.set(true);
  }

  addSource() { this.sourcesDraft.push({ repository: '', path: '', role: 'frontend' }); }
  removeSource(i: number) { this.sourcesDraft.splice(i, 1); }

  saveSources() {
    const m = this.module(); if (!m) return;
    this.api.saveModule(m.key, {
      sources: this.sourcesDraft.filter(s => s.repository.trim()),
      aliases: this.aliasesDraft.split(',').map(a => a.trim()).filter(Boolean)
    }).subscribe({
      next: x => { this.module.set(x); this.showSources.set(false); this.snack.open('Fontes e apelidos salvos.', 'OK', { duration: 2500 }); },
      error: e => this.toast(e)
    });
  }

  /** 0053: termo sugerido pelo glossário → apelido, palavra-chave ou dispensado. */
  resolveTerm(term: string, action: 'alias' | 'keyword' | 'dismiss') {
    const m = this.module(); if (!m) return;
    this.api.resolveTerm(m.key, term, action).subscribe({
      next: x => { this.module.set(x); this.snack.open(action === 'dismiss' ? `"${term}" dispensado.` : `"${term}" virou ${action === 'alias' ? 'apelido do módulo' : 'palavra-chave'}.`, 'OK', { duration: 2500 }); },
      error: e => this.toast(e)
    });
  }

  onRevisionChanged() { const k = this.moduleKey(); if (k) { this.loadModule(k, false); this.loadDoc(); } this.loadModules(false); }

  goToItem(e: { module: string; doc: string; item?: string }) { this.openModule(e.module, e.doc, e.item); }

  // ── Helpers ────────────────────────────────────────────────────────────────────────────────

  objectEntries(o: Record<string, number>) { return Object.entries(o ?? {}); }
  docState(m: ReverseModuleSummary, key: string) { return m.docs.find(d => d.type === key)?.state ?? 'none'; }
  isLive(h?: ReverseRevisionHead | null) {
    return !!h?.progressAt && ['draft', 'changes'].includes(h.status) && Date.now() - new Date(h.progressAt).getTime() < 3 * 60000;
  }
  moduleLive(m: ReverseModuleSummary) { return m.docs.some(d => this.isLive(d.open)); }
  docTitle(key: string) { return this.docs.find(d => d.key === key)?.short ?? key; }
  date(at?: string | null) { return at ? new Date(at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''; }
  pct(v?: number | null) { return v == null ? '—' : `${Math.floor(v * 100)}%`; }
  worldIcon(w: string) { return ({ legado: 'history', revamp: 'auto_awesome', front: 'web', 'integração': 'sync_alt', login: 'lock' } as any)[w] ?? 'widgets'; }
  statusLabel(s: string) { return ({ draft: 'rascunho', review: 'em revisão', changes: 'ajustes pedidos', approved: 'aprovada', published: 'publicada', discarded: 'descartada', superseded: 'substituída' } as any)[s] ?? s; }
  private normalize(v: string) { return (v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
  private toast(e: any) { this.snack.open(e?.error?.error ?? 'Não foi possível carregar.', 'OK', { duration: 6000 }); }
}
