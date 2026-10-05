import { Component, ElementRef, OnInit, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PlanMarkdownPipe } from '../../../components/execution-plan/plan-markdown.pipe';
import { renderMermaidIn } from '../../../helpers/mermaid-loader';
import { StorageService } from '../../../services/storage.service';
import { KbAdminMode, KbAdminPanelComponent } from './kb-admin-panel.component';
import { EcosystemMapComponent } from './ecosystem-map.component';
import { KbFriendlyOverviewComponent } from './kb-friendly-overview.component';
import { KbConnectionsComponent } from './kb-connections.component';
import { KbGuideReviewComponent } from './kb-guide-review.component';
import { KbLearnCardComponent } from './kb-learn-card.component';
import { KbAskDeepComponent } from './kb-ask-deep.component';
import { KbQuestionsComponent } from './kb-questions.component';
import {
  KbViewMode, TocItem, areaGroups, cleanInline, articleMarkdown, friendlyKind, friendlyName, friendlyTagline, guideSections, headingsOf, projectArea, techSections
} from './kb-friendly';
import { ReverseEngineeringService, ReverseTrap, reverseDocOfItem } from '../../../services/reverse-engineering.service';
import {
  ARCHITECTURE_KINDS,
  ArchitectureAskResponse,
  ArchitectureProject,
  ArchitectureSearchHit,
  ArchitectureSection,
  ArchitectureSectionSummary,
  ArchitectureService,
  ArchitectureSuggestion,
  KnowledgeArticle,
  KnowledgeState,
  relationKind
} from '../../../services/architecture.service';
import { REVERSE_DOCS } from '../../../services/reverse-engineering.service';

type Selection =
  | { type: 'overview' }
  | { type: 'map'; focus?: string }
  | { type: 'project'; key: string; section?: string }
  | { type: 'article'; number: number }
  | { type: 'ask'; question: string };

/** Pergunta à base com IA em andamento/respondida (0037). */
interface AskState {
  question: string;
  loading: boolean;
  response: ArchitectureAskResponse | null;
  error?: string | null;
}

/** Palavras que indicam pergunta ("como saber se…?") — aí vale a busca com IA, não só a palavra exata. */
const QUESTION_START = /^(como|qual|quais|onde|quando|quem|por ?que|o que|existe|tem como|da pra|dá pra|posso|devo|what|how|where|why|which|is there)\b/i;

/** Ligações de um projeto agrupadas por outro projeto (painel "Integrações"). */
interface LinkGroup {
  key: string;
  name: string;
  mapped: boolean;
  items: { kind: string; detail?: string | null; evidence?: string | null }[];
}

interface TreeGroup {
  kind: string;
  label: string;
  icon: string;
  projects: ArchitectureProject[];
}

/**
 * Base Solvace (feature 0033): a engenharia reversa de todos os projetos (sessão por sessão) e as regras de negócio
 * do Knowledge Center, como a skill vê. Leitura para todos; edição e chat de melhoria (admin) vêm na fase F2.
 * Links diretos: ?p=<projeto>&s=<seção>, ?art=<n> e ?view=mapa[&n=<projeto>] (mapa do ecossistema, 0034).
 */
@Component({
  selector: 'app-architecture',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, PlanMarkdownPipe, KbAdminPanelComponent, EcosystemMapComponent,
    KbFriendlyOverviewComponent, KbConnectionsComponent, KbGuideReviewComponent, KbLearnCardComponent, KbAskDeepComponent, KbQuestionsComponent],
  templateUrl: './architecture.component.html',
  styleUrls: ['./architecture.component.css']
})
export class ArchitectureComponent implements OnInit {
  private api = inject(ArchitectureService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private storage = inject(StorageService);
  private reverse = inject(ReverseEngineeringService);
  /** 0056: armadilhas da engenharia reversa do projeto (aba "Armadilhas" no Técnico, só leitura). */
  readonly traps = signal<ReverseTrap[]>([]);
  readonly showTraps = signal(false);
  private trapsKey: string | null = null;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly projects = signal<ArchitectureProject[]>([]);
  readonly articles = signal<KnowledgeArticle[]>([]);
  readonly kcState = signal<KnowledgeState | null>(null);
  readonly filter = signal('');
  readonly selection = signal<Selection>({ type: 'overview' });
  readonly section = signal<ArchitectureSection | null>(null);
  readonly sectionLoading = signal(false);
  readonly article = signal<KnowledgeArticle | null>(null);
  readonly treeOpen = signal(false);
  readonly expanded = signal<Set<string>>(new Set());

  // ── 0038: modo Simples (padrão, para QA/gestores) × Técnico (a tela de sempre) ──
  readonly mode = signal<KbViewMode>(readMode());
  readonly simple = computed(() => this.mode() === 'simples');
  /** Detalhes técnicos abertos no modo Simples. */
  readonly techOpen = signal(false);
  readonly showLearn = signal(false);
  readonly learnCard = signal<string | null>(null);
  readonly guideOpen = signal(false);

  // ── Admin (0033 F2) ──
  readonly isAdmin = signal(this.readIsAdmin());
  readonly adminMode = signal<KbAdminMode | null>(null);
  readonly suggestions = signal<ArchitectureSuggestion[]>([]);
  readonly showSuggestions = signal(false);
  // 0040: perguntas sem resposta (fila do admin/skill)
  readonly showQuestions = signal(false);
  readonly openQuestions = signal(0);
  readonly activeSuggestion = signal<ArchitectureSuggestion | null>(null);

  // ── 0037: busca no conteúdo e pergunta com IA ──
  readonly contentHits = signal<ArchitectureSearchHit[]>([]);
  readonly contentLoading = signal(false);
  readonly ask = signal<AskState | null>(null);
  askText = '';
  readonly askExamples = [
    'Como saber se o usuário fez login com sucesso?',
    'Onde fica a planta atual do usuário?',
    'O que acontece quando um plano de ação é concluído?'
  ];
  /** Cabeçalho a mostrar quando a seção abrir (vem de um resultado de busca: ?h=). */
  private readonly pendingHeading = signal<string | null>(null);
  private searchTimer?: ReturnType<typeof setTimeout>;
  private searchSeq = 0;
  private askSeq = 0;

  /** A busca simples (nomes, palavras-chave, títulos) não achou nada. */
  readonly nothingLocal = computed(() => !!normalize(this.filter()) && !this.groups().length && !this.articleGroups().length);
  /** O texto parece uma pergunta — vale oferecer (e disparar) a busca com IA. */
  readonly filterIsQuestion = computed(() => isQuestion(this.filter()));

  @ViewChild('content') private contentRef?: ElementRef<HTMLElement>;

  readonly totals = computed(() => ({
    projects: this.projects().length,
    sections: this.projects().reduce((n, p) => n + p.sections.length, 0),
    articles: this.articles().length
  }));

  /** Projetos agrupados por tipo, filtrados pela busca (nome, chave, palavras-chave, resumo, seções). */
  readonly groups = computed<TreeGroup[]>(() => {
    const q = normalize(this.filter());
    const matches = (p: ArchitectureProject) => !q || normalize([p.name, p.key, p.summary ?? '', ...p.keywords,
      ...p.sections.map(s => s.title)].join(' ')).includes(q);
    return ARCHITECTURE_KINDS
      .map(k => ({ ...k, projects: this.projects().filter(p => p.kind === k.kind && matches(p)) }))
      .filter(g => g.projects.length > 0);
  });

  readonly articleGroups = computed(() => {
    const q = normalize(this.filter());
    const list = this.articles().filter(a => !q || normalize(`${a.reference} ${a.title} ${a.category ?? ''} ${a.subcategory ?? ''} ${a.tags.join(' ')}`).includes(q));
    const map = new Map<string, KnowledgeArticle[]>();
    for (const a of list) map.set(a.category || 'Sem categoria', [...(map.get(a.category || 'Sem categoria') ?? []), a]);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([category, items]) => ({ category, items }));
  });

  /** 0038: árvore do modo Simples — por área de negócio, com nomes amigáveis. */
  readonly areaTree = computed(() => {
    const q = normalize(this.filter());
    const matches = (p: ArchitectureProject) => !q || normalize([friendlyName(p), p.tagline ?? '', p.businessArea ?? '', p.name, p.key, p.summary ?? '',
      ...p.keywords, ...p.sections.map(s => s.title)].join(' ')).includes(q);
    return areaGroups(this.projects().filter(matches));
  });

  /** Nome amigável por chave (mapa no modo Simples). */
  readonly friendlyNames = computed(() => Object.fromEntries(this.projects().map(p => [p.key, friendlyName(p)])));

  readonly currentProject = computed(() => {
    const s = this.selection();
    return s.type === 'project' ? this.projects().find(p => p.key === s.key) ?? null : null;
  });

  readonly guideTabs = computed(() => guideSections(this.currentProject()));
  readonly techTabs = computed(() => techSections(this.currentProject()));
  /** A seção aberta é técnica (no modo Simples, abre o bloco de detalhes técnicos). */
  readonly sectionIsTech = computed(() => { const s = this.section(); return !!s && !this.guideTabs().some(g => g.key === s.key); });
  /** Sumário da seção aberta (## e ###) — só quando ajuda (seção longa). */
  readonly toc = computed<TocItem[]>(() => { const items = headingsOf(this.section()?.content); return items.length >= 3 ? items : []; });

  readonly mapFocus = computed(() => { const s = this.selection(); return s.type === 'map' ? s.focus ?? null : null; });

  /** Integrações do projeto aberto: "depende de" e "usado por", agrupadas pelo outro lado. */
  readonly dependsOn = computed(() => this.linkGroups((this.currentProject()?.relations ?? []).map(r => ({ other: r.target, ...r }))));
  readonly usedBy = computed(() => this.linkGroups((this.currentProject()?.usedBy ?? []).map(r => ({ other: r.source, ...r }))));
  readonly linksOpen = signal(true);

  /** Projetos de que mais gente depende (visão geral). */
  readonly hubs = computed(() => {
    const users = new Map<string, Set<string>>();
    for (const p of this.projects()) for (const r of p.relations ?? []) users.set(r.target, (users.get(r.target) ?? new Set()).add(p.key));
    return this.projects().map(p => ({ project: p, users: users.get(p.key)?.size ?? 0 }))
      .filter(h => h.users > 1).sort((a, b) => b.users - a.users).slice(0, 8);
  });

  readonly totalRelations = computed(() => this.projects().reduce((n, p) => n + (p.relations?.length ?? 0), 0));

  /** KC sem sincronizar há mais de 24 h (o sync roda nas máquinas com a credencial, pelas skills). */
  readonly kcStale = computed(() => {
    const last = this.kcState()?.lastSyncAt;
    if (!last) return true;
    return Date.now() - new Date(last).getTime() > 24 * 3600 * 1000;
  });

  constructor() {
    // 0056: armadilhas do projeto aberto (as novas, ligadas aos itens) — carregadas uma vez por projeto.
    effect(() => {
      const key = this.currentProject()?.key ?? null;
      if (key === this.trapsKey) return;
      this.trapsKey = key;
      this.traps.set([]);
      this.showTraps.set(false);
      if (key) this.reverse.traps(key).subscribe({ next: t => { if (this.trapsKey === key) this.traps.set(t); }, error: () => {} });
    });
    // Diagramas: depois que o conteúdo da seção/artigo aparece na tela.
    effect(() => {
      this.section();
      this.article();
      queueMicrotask(() => setTimeout(() => { renderMermaidIn(this.contentRef?.nativeElement); this.revealHeading(); }, 0));
    });
    // 0037: filtro com 3+ letras também procura no conteúdo das seções (debounce).
    effect(() => {
      const q = this.filter().trim();
      clearTimeout(this.searchTimer);
      if (q.length < 3) { this.contentHits.set([]); this.contentLoading.set(false); return; }
      this.contentLoading.set(true);
      const seq = ++this.searchSeq;
      this.searchTimer = setTimeout(() => this.api.search(q, 12).subscribe({
        next: hits => {
          if (seq !== this.searchSeq) return;
          this.contentHits.set(hits);
          this.contentLoading.set(false);
          // Nada pela busca simples nem no conteúdo e é uma pergunta: a IA entra sozinha.
          if (!hits.length && this.nothingLocal() && isQuestion(q)) this.askAi(q);
        },
        error: () => { if (seq === this.searchSeq) { this.contentHits.set([]); this.contentLoading.set(false); } }
      }), 350);
    });
  }

  /** 0052: projetos que são módulo na Engenharia reversa (legado/revamp/front/integração/login). */
  isModule(p: ArchitectureProject) { return ['legacy', 'revamp', 'frontend', 'integration', 'auth'].includes(p.kind); }
  /** Documentos da engenharia reversa publicados (seções re-*). */
  reverseCount(p: ArchitectureProject) { return p.sections.filter(s => s.key.startsWith('re-')).length; }
  /** Documentos da engenharia reversa (7 com a visão prática — 0054). */
  readonly reverseTotal = REVERSE_DOCS.length;
  openReverse(key: string, item?: string) {
    this.router.navigate(['/auth/reverse-engineering'], { queryParams: { m: key, d: item ? reverseDocOfItem(item) : null, i: item ?? null } });
  }
  trapDate(at: string) { return new Date(at).toLocaleDateString('pt-BR'); }

  ngOnInit(): void {
    this.load();
    this.route.queryParamMap.subscribe(q => {
      const modo = q.get('modo');
      if (modo === 'simples' || modo === 'tecnico') this.setMode(modo, false);
      if (q.get('aprender')) { this.learnCard.set(q.get('aprender')); this.showLearn.set(true); }
      const art = Number(q.get('art'));
      this.pendingHeading.set(q.get('h'));
      if (q.get('ask')) this.showAsk(q.get('ask')!);
      else if (art) this.openArticle(art);
      else if (q.get('view') === 'mapa') { this.adminMode.set(null); this.selection.set({ type: 'map', focus: q.get('n') ?? undefined }); }
      else if (q.get('p')) this.openProject(q.get('p')!, q.get('s') ?? undefined);
      else this.selection.set({ type: 'overview' });
    });
  }

  // ── 0038 ──
  setMode(mode: KbViewMode, remember = true): void {
    this.mode.set(mode);
    if (remember) { try { localStorage.setItem(MODE_KEY, mode); } catch { /* sem storage: só nesta visita */ } }
  }

  toggleLearn(): void {
    this.showLearn.set(!this.showLearn());
    if (!this.showLearn()) this.learnCard.set(null);
  }

  onLearnSent(): void {
    this.loadSuggestions();
  }

  onGuideApplied(sectionKey: string | null): void {
    this.guideOpen.set(false);
    const key = this.currentProject()?.key;
    this.api.projects().subscribe(list => {
      this.projects.set(list);
      if (key) this.router.navigate([], { queryParams: { p: key, s: sectionKey ?? this.selectionSection() ?? null } });
    });
  }

  /** Seção criada pelo "analisar a fundo": recarrega e abre. */
  onDeepCreated(e: { projectKey: string; sectionKey: string }): void {
    this.api.projects().subscribe(list => {
      this.projects.set(list);
      this.router.navigate([], { queryParams: { p: e.projectKey, s: e.sectionKey } });
    });
  }

  /** Abre a seção sugerida pelo "Pergunte" (rolando até o trecho). */
  openSuggested(s: { projectKey: string; sectionKey: string; heading?: string | null }): void {
    this.router.navigate([], { queryParams: { p: s.projectKey, s: s.sectionKey, h: s.heading ?? null } });
  }

  /** Rola até um título do sumário. */
  scrollToHeading(item: TocItem): void {
    const root = this.contentRef?.nativeElement;
    if (!root) return;
    const el = findHeading(Array.from(root.querySelectorAll<HTMLElement>('.kb__md h2, .kb__md h3, .kb__md h4')), item.text);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('kb-flash');
    setTimeout(() => el.classList.remove('kb-flash'), 2400);
  }

  private selectionSection(): string | undefined {
    const s = this.selection();
    return s.type === 'project' ? s.section : undefined;
  }

  friendly(p: ArchitectureProject): string { return friendlyName(p); }
  tagline(p: ArchitectureProject): string { return friendlyTagline(p); }
  area(p: ArchitectureProject): string { return projectArea(p); }
  friendlyKindLabel(kind: string): string { return friendlyKind(kind).label; }
  friendlyKindIcon(kind: string): string { return friendlyKind(kind).icon; }
  articleText(content: string): string { return articleMarkdown(content); }

  loadQuestionCount(): void {
    if (!this.isAdmin()) return;
    this.api.questions('open', true).subscribe({ next: list => this.openQuestions.set(list.length), error: () => this.openQuestions.set(0) });
  }

  /** Do painel de perguntas: abre o "Pergunte" com o texto (lá dá para analisar a fundo). */
  askFromQueue(text: string): void {
    this.showQuestions.set(false);
    this.ask.set(null);
    this.askAi(text);
  }

  loadSuggestions(): void {
    if (!this.isAdmin()) return;
    this.api.suggestions('pending').subscribe({ next: list => this.suggestions.set(list), error: () => this.suggestions.set([]) });
  }

  // ── Admin ──
  openAdmin(mode: KbAdminMode): void {
    this.activeSuggestion.set(null);
    this.adminMode.set(this.adminMode() === mode ? null : mode);
  }

  onSectionSaved(saved: ArchitectureSection): void {
    // 0037: a sugestão aplicada sai da lista (e confere com o servidor, que já a marcou como aplicada).
    const sg = this.activeSuggestion();
    if (sg) this.suggestions.update(list => list.filter(x => x.id !== sg.id));
    this.loadSuggestions();
    this.adminMode.set(null);
    this.activeSuggestion.set(null);
    const key = this.currentProject()?.key;
    this.api.projects().subscribe(list => {
      this.projects.set(list);
      if (key) this.router.navigate([], { queryParams: { p: key, s: saved.key } });
      this.section.set(saved);
    });
  }

  onProjectSaved(): void {
    this.adminMode.set(null);
    this.api.projects().subscribe(list => this.projects.set(list));
  }

  /** Abre o chat da seção indicada pela sugestão (ou a primeira seção do projeto). */
  workOnSuggestion(sg: ArchitectureSuggestion): void {
    const project = this.projects().find(p => p.key === sg.projectKey);
    if (!project) {
      this.snackBar.open(`O projeto "${sg.projectKey}" ainda não existe na base — mapeie com a skill base-solvace ou descarte.`, 'Ok', { duration: 7000 });
      return;
    }
    const sectionKey = project.sections.some(s => s.key === sg.sectionKey) ? sg.sectionKey! : project.sections[0]?.key;
    if (!sectionKey) {
      this.snackBar.open('O projeto ainda não tem seções — crie a seção primeiro.', 'Ok', { duration: 6000 });
      return;
    }
    this.showSuggestions.set(false);
    this.router.navigate([], { queryParams: { p: project.key, s: sectionKey } }).then(() => {
      this.activeSuggestion.set(sg);
      this.adminMode.set('chat');
    });
  }

  resolveSuggestion(sg: ArchitectureSuggestion, status: 'applied' | 'dismissed'): void {
    this.api.resolveSuggestion(sg.id, status, status === 'applied' ? 'marcada como aplicada' : 'descartada').subscribe({
      next: () => this.suggestions.update(list => list.filter(x => x.id !== sg.id)),
      error: () => this.snackBar.open('Não foi possível atualizar a sugestão.', 'Fechar', { duration: 6000 })
    });
  }

  onSuggestionApplied(sg: ArchitectureSuggestion): void {
    this.suggestions.update(list => list.filter(x => x.id !== sg.id));
  }

  private readIsAdmin(): boolean {
    try {
      const token = this.storage.getItem('apiKey');
      if (!token) return false;
      const payload = JSON.parse(atob(token.split('.')[1]));
      const raw = payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'] ?? payload['role'];
      return (Array.isArray(raw) ? raw : raw ? [raw] : []).includes('admin');
    } catch {
      return false;
    }
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.loadSuggestions();
    this.loadQuestionCount();
    let pending = 3;
    const done = () => { if (--pending === 0) this.loading.set(false); };
    this.api.projects().subscribe({
      next: list => {
        this.projects.set(list);
        const s = this.selection();
        if (s.type === 'project') this.openProject(s.key, s.section);
        done();
      },
      error: () => { this.error.set('Não foi possível carregar a Base Solvace.'); done(); }
    });
    this.api.articles(undefined, 50).subscribe({ next: a => { this.articles.set(a.sort((x, y) => x.articleNumber - y.articleNumber)); done(); }, error: () => done() });
    this.api.knowledgeState().subscribe({ next: s => { this.kcState.set(s); done(); }, error: () => done() });
  }

  // ── 0037: busca no conteúdo e pergunta com IA ─────────────────────────────────────────────────

  /** Enter no filtro: pergunta (ou nada achado) → IA; senão abre o primeiro trecho achado no conteúdo. */
  onSearchEnter(): void {
    const q = this.filter().trim();
    if (q.length < 3) return;
    if (this.nothingLocal() && (!this.contentHits().length || isQuestion(q))) { this.askAi(q); return; }
    if (isQuestion(q)) { this.askAi(q); return; }
    const first = this.contentHits()[0];
    if (first && this.nothingLocal()) this.openHit(first);
  }

  askAi(question?: string): void {
    const q = (question ?? this.askText).trim();
    if (q.length < 3) return;
    this.treeOpen.set(false);
    this.router.navigate([], { queryParams: { ask: q } });
  }

  private showAsk(question: string): void {
    this.adminMode.set(null);
    this.selection.set({ type: 'ask', question });
    this.askText = question;
    const current = this.ask();
    if (current && current.question === question && (current.loading || current.response)) return;
    const seq = ++this.askSeq;
    this.ask.set({ question, loading: true, response: null });
    this.api.ask(question).subscribe({
      next: r => { if (seq === this.askSeq) this.ask.set({ question, loading: false, response: r }); },
      error: err => {
        if (seq === this.askSeq)
          this.ask.set({ question, loading: false, response: null, error: err?.error?.error ?? 'Não foi possível consultar a base agora.' });
      }
    });
  }

  /** Abre o trecho: a seção do projeto rolando até o cabeçalho, ou o artigo do KC. */
  openHit(hit: ArchitectureSearchHit): void {
    this.treeOpen.set(false);
    if (hit.type === 'article' && hit.articleNumber) {
      this.router.navigate([], { queryParams: { art: hit.articleNumber } });
      return;
    }
    if (hit.projectKey) this.router.navigate([], { queryParams: { p: hit.projectKey, s: hit.sectionKey ?? null, h: hit.heading ?? null } });
  }

  /** Rola até o cabeçalho pedido (?h=) depois que a seção renderiza, com um destaque rápido. */
  private revealHeading(): void {
    const wanted = this.pendingHeading();
    const root = this.contentRef?.nativeElement;
    if (!wanted || !root || !this.section()) return;
    const headings = Array.from(root.querySelectorAll<HTMLElement>('.kb__md h1, .kb__md h2, .kb__md h3, .kb__md h4'));
    const el = findHeading(headings, wanted);
    if (!el) return;
    this.pendingHeading.set(null);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('kb-flash');
    setTimeout(() => el.classList.remove('kb-flash'), 2400);
  }

  // ── Navegação ─────────────────────────────────────────────────────────────────────────────────

  goOverview(): void {
    this.router.navigate([], { queryParams: {} });
  }

  openMap(focus?: string): void {
    this.router.navigate([], { queryParams: { view: 'mapa', n: focus ?? null } });
    this.treeOpen.set(false);
  }

  openProjectByKey(key: string): void {
    const p = this.projects().find(x => x.key === key);
    if (p) this.selectProject(p);
  }

  selectProject(p: ArchitectureProject, sectionKey?: string): void {
    this.router.navigate([], { queryParams: { p: p.key, s: sectionKey ?? this.defaultSection(p) ?? null } });
    this.treeOpen.set(false);
  }

  /** Seção que abre com o projeto: no Simples o Guia (sem Guia, nenhuma — mostra o resumo amigável); no Técnico a primeira. */
  private defaultSection(p: ArchitectureProject | undefined): string | undefined {
    if (!p) return undefined;
    return this.simple() ? guideSections(p)[0]?.key : p.sections[0]?.key;
  }

  selectArticle(a: KnowledgeArticle): void {
    this.router.navigate([], { queryParams: { art: a.articleNumber } });
    this.treeOpen.set(false);
  }

  /** 0056: árvore do Simples — o Guia que vale e, à parte, o antigo já substituído pela engenharia reversa (histórico). */
  guideOf(p: ArchitectureProject): ArchitectureSectionSummary[] { return guideSections(p); }
  oldGuideOf(p: ArchitectureProject): ArchitectureSectionSummary[] {
    const superseded = p.supersededSections ?? {};
    return p.sections.filter(s => (s.audience === 'human' || s.key.startsWith('guia-')) && !!superseded[s.key]);
  }

  toggle(key: string): void {
    this.expanded.update(set => {
      const next = new Set(set);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  /** Cartões da visão geral: até 8 projetos por tipo (o revamp tem ~50), o resto sob "ver mais". */
  readonly cardLimit = 8;
  cardProjects(g: TreeGroup): ArchitectureProject[] {
    return this.expanded().has('card:' + g.kind) ? g.projects : g.projects.slice(0, this.cardLimit);
  }

  isOpen(key: string): boolean {
    return this.expanded().has(key) || !!normalize(this.filter());
  }

  private openProject(key: string, sectionKey?: string): void {
    if (this.adminMode() !== 'chat' || !this.activeSuggestion()) this.adminMode.set(null);
    this.selection.set({ type: 'project', key, section: sectionKey });
    this.article.set(null);
    this.expanded.update(set => new Set(set).add(key));
    const project = this.projects().find(p => p.key === key);
    const target = sectionKey ?? this.defaultSection(project);
    if (target && project && techSections(project).some(t => t.key === target)) this.techOpen.set(true);
    if (!target) { this.section.set(null); return; }
    this.sectionLoading.set(true);
    this.api.section(key, target).subscribe({
      next: s => { this.section.set(s); this.sectionLoading.set(false); },
      error: () => { this.section.set(null); this.sectionLoading.set(false); }
    });
  }

  private openArticle(number: number): void {
    this.selection.set({ type: 'article', number });
    this.section.set(null);
    this.sectionLoading.set(true);
    this.api.article(number).subscribe({
      next: a => { this.article.set(a); this.sectionLoading.set(false); },
      error: () => { this.article.set(null); this.sectionLoading.set(false); }
    });
  }

  copyLink(): void {
    navigator.clipboard?.writeText(location.href).then(
      () => this.snackBar.open('Link copiado', 'Ok', { duration: 2500 }),
      () => this.snackBar.open('Não foi possível copiar', 'Ok', { duration: 2500 }));
  }

  // ── Formatação ────────────────────────────────────────────────────────────────────────────────

  rel(kind: string) { return relationKind(kind); }

  private linkGroups(list: { other: string; kind: string; detail?: string | null; evidence?: string | null }[]): LinkGroup[] {
    const map = new Map<string, LinkGroup>();
    for (const r of list) {
      const project = this.projects().find(p => p.key === r.other);
      const g = map.get(r.other) ?? { key: r.other, name: project?.name ?? externalName(r.other), mapped: !!project, items: [] };
      g.items.push({ kind: r.kind, detail: r.detail, evidence: r.evidence });
      map.set(r.other, g);
    }
    return [...map.values()].sort((a, b) => Number(b.mapped) - Number(a.mapped) || a.name.localeCompare(b.name));
  }

  sinceLabel(value?: string | null): string {
    if (!value) return 'nunca sincronizado';
    const h = Math.floor((Date.now() - new Date(value).getTime()) / 3600000);
    return h < 1 ? 'sincronizado há menos de 1 h' : h < 48 ? `sincronizado há ${h} h` : `sincronizado há ${Math.floor(h / 24)} dias`;
  }

  kindLabel(kind: string): string {
    return ARCHITECTURE_KINDS.find(k => k.kind === kind)?.label ?? kind;
  }

  kindIcon(kind: string): string {
    return ARCHITECTURE_KINDS.find(k => k.kind === kind)?.icon ?? 'folder';
  }

  sourceLabel(source: string): string {
    return ({ skill: 'gerada pela skill', admin: 'editada pelo admin', ai: 'sugestão da IA aplicada' } as Record<string, string>)[source] ?? source;
  }

  tokens(length: number): string {
    const t = Math.max(1, Math.round(length / 4));
    return t >= 1000 ? `~${(t / 1000).toFixed(1)} mil tokens` : `~${t} tokens`;
  }

  date(value?: string | null): string {
    if (!value) return '—';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '—';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  paragraphs(text: string): string[] {
    return text.split(/\n{2,}|(?<=[.!?])\s{2,}/).map(t => t.trim()).filter(Boolean);
  }
}

/** ext:microsoft-graph → Microsoft Graph (o backend manda o nome no grafo; aqui só para o painel do projeto). */
function externalName(key: string): string {
  if (!key.startsWith('ext:')) return key;
  const names: Record<string, string> = {
    'ext:microsoft-graph': 'Microsoft Graph / Teams', 'ext:azure-ad': 'Azure AD / Entra ID', 'ext:openai': 'OpenAI', 'ext:anthropic': 'Anthropic',
    'ext:gemini': 'Google Gemini', 'ext:hubspot': 'HubSpot', 'ext:azure-devops': 'Azure DevOps', 'ext:powerbi': 'Power BI',
    'ext:snowflake': 'Snowflake', 'ext:databricks': 'Databricks', 'ext:cognito': 'AWS Cognito', 'ext:s3': 'AWS S3', 'ext:sqs': 'AWS SQS',
    'ext:opensearch': 'OpenSearch', 'ext:onlyoffice': 'OnlyOffice'
  };
  return names[key] ?? key.slice(4);
}

const MODE_KEY = 'kb:modo';

/** Modo lembrado no navegador; Simples por padrão (0038). */
function readMode(): KbViewMode {
  try { return localStorage.getItem(MODE_KEY) === 'tecnico' ? 'tecnico' : 'simples'; } catch { return 'simples'; }
}

function isQuestion(value: string): boolean {
  const q = value.trim();
  return q.endsWith('?') || QUESTION_START.test(normalize(q)) || q.split(/\s+/).length >= 5;
}

/**
 * 0053: acha o título pelo texto do sumário com a MESMA limpeza dos dois lados (o sumário tira `_`, `*` e crases do
 * markdown — o título renderizado tem `TB_SA3_A3`); item com ID (RN-012 — …) casa pelo ID.
 */
function findHeading(headings: HTMLElement[], text: string): HTMLElement | undefined {
  const key = (v: string) => normalize(cleanInline(v));
  const target = key(text);
  const id = /^\s*([A-Z]{2,4}-\d{1,4})\b/.exec(cleanInline(text))?.[1];
  return (id ? headings.find(h => cleanInline(h.textContent ?? '').trim().startsWith(id)) : undefined)
    ?? headings.find(h => key(h.textContent ?? '') === target)
    ?? headings.find(h => key(h.textContent ?? '').includes(target));
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
