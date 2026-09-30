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
import {
  ARCHITECTURE_KINDS,
  ArchitectureProject,
  ArchitectureSection,
  ArchitectureService,
  ArchitectureSuggestion,
  KnowledgeArticle,
  KnowledgeState
} from '../../../services/architecture.service';

type Selection =
  | { type: 'overview' }
  | { type: 'project'; key: string; section?: string }
  | { type: 'article'; number: number };

interface TreeGroup {
  kind: string;
  label: string;
  icon: string;
  projects: ArchitectureProject[];
}

/**
 * Base Solvace (feature 0033): a engenharia reversa de todos os projetos (sessão por sessão) e as regras de negócio
 * do Knowledge Center, como a skill vê. Leitura para todos; edição e chat de melhoria (admin) vêm na fase F2.
 * Links diretos: ?p=<projeto>&s=<seção> e ?art=<n>.
 */
@Component({
  selector: 'app-architecture',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, PlanMarkdownPipe, KbAdminPanelComponent],
  templateUrl: './architecture.component.html',
  styleUrls: ['./architecture.component.css']
})
export class ArchitectureComponent implements OnInit {
  private api = inject(ArchitectureService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private storage = inject(StorageService);

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

  // ── Admin (0033 F2) ──
  readonly isAdmin = signal(this.readIsAdmin());
  readonly adminMode = signal<KbAdminMode | null>(null);
  readonly suggestions = signal<ArchitectureSuggestion[]>([]);
  readonly showSuggestions = signal(false);
  readonly activeSuggestion = signal<ArchitectureSuggestion | null>(null);

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

  readonly currentProject = computed(() => {
    const s = this.selection();
    return s.type === 'project' ? this.projects().find(p => p.key === s.key) ?? null : null;
  });

  constructor() {
    // Diagramas: depois que o conteúdo da seção/artigo aparece na tela.
    effect(() => {
      this.section();
      this.article();
      queueMicrotask(() => setTimeout(() => renderMermaidIn(this.contentRef?.nativeElement), 0));
    });
  }

  ngOnInit(): void {
    this.load();
    this.route.queryParamMap.subscribe(q => {
      const art = Number(q.get('art'));
      if (art) this.openArticle(art);
      else if (q.get('p')) this.openProject(q.get('p')!, q.get('s') ?? undefined);
      else this.selection.set({ type: 'overview' });
    });
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

  // ── Navegação ─────────────────────────────────────────────────────────────────────────────────

  goOverview(): void {
    this.router.navigate([], { queryParams: {} });
  }

  selectProject(p: ArchitectureProject, sectionKey?: string): void {
    this.router.navigate([], { queryParams: { p: p.key, s: sectionKey ?? p.sections[0]?.key ?? null } });
    this.treeOpen.set(false);
  }

  selectArticle(a: KnowledgeArticle): void {
    this.router.navigate([], { queryParams: { art: a.articleNumber } });
    this.treeOpen.set(false);
  }

  toggle(key: string): void {
    this.expanded.update(set => {
      const next = new Set(set);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
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
    const target = sectionKey ?? project?.sections[0]?.key;
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

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
