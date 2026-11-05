import { Component, DestroyRef, ElementRef, HostListener, computed, effect, inject, isDevMode, signal, untracked, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SettingConflict, SettingChange, SettingField, SettingGroup, SettingSection } from './plugin-settings.model';
import { ADVANCED_SECTION, PluginSettingsStore } from './plugin-settings.store';
import { settingsFixture } from './plugin-settings.fixture';
import { SettingFieldComponent } from './setting-field.component';
import { ReviewItem, SettingsReviewDialogComponent } from './dialogs/review-dialog.component';
import { ConflictChoice, ConflictItem, SettingsConflictDialogComponent } from './dialogs/conflict-dialog.component';
import { PluginComponent } from '../plugin/plugin.component';
import { GlobalService } from '../../../services/global.service';
import { TabsService } from '../../../services/tabs.service';

/** Abaixo disso a navegação lateral vira um seletor no topo. */
const COMPACT_QUERY = '(max-width: 1023px)';

/**
 * Configurações por seção (0086) — substitui a grade de plugins em `auth/plugin-manager`. Navegação por assunto
 * (as seções juntam chaves de vários plugins), busca única, editor por tipo, salvar por seção com revisão
 * antes → depois e conflito (409). A grade antiga e o editor da 0032 ficam em "Plugins (avançado)".
 */
@Component({
  selector: 'app-plugin-settings-page',
  standalone: true,
  imports: [NgTemplateOutlet, FormsModule, MatButtonModule, MatIconModule, MatProgressBarModule, MatSelectModule, MatSlideToggleModule,
    MatTooltipModule, SettingFieldComponent, PluginComponent],
  providers: [PluginSettingsStore],
  templateUrl: './plugin-settings-page.component.html',
  styleUrls: ['./plugin-settings-page.component.css'],
})
export class PluginSettingsPageComponent {
  readonly store = inject(PluginSettingsStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly global = inject(GlobalService);
  private readonly tabs = inject(TabsService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly media = window.matchMedia(COMPACT_QUERY);
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  readonly advancedKey = ADVANCED_SECTION;
  readonly compact = signal(this.media.matches);
  /** Grupos com "Mais opções" aberto (`seção|grupo`). */
  readonly expanded = signal<Set<string>>(new Set());
  /** Campo destacado pelo deep link (`?field=`). */
  readonly highlightId = signal<string | null>(null);

  readonly searching = computed(() => !!this.store.search().trim());
  readonly section = computed(() => this.store.current());
  readonly missingPlugins = computed(() => this.store.catalog()?.missingPlugins ?? []);

  constructor() {
    const destroyRef = inject(DestroyRef);
    const onMedia = (e: MediaQueryListEvent) => this.compact.set(e.matches);
    this.media.addEventListener('change', onMedia);
    destroyRef.onDestroy(() => this.media.removeEventListener('change', onMedia));

    // Abas internas (0065): edição pendente = aba "suja" (não congela e pede confirmação ao fechar).
    const screen = this.tabs.bindScreen(destroyRef);
    effect(() => {
      const dirty = this.store.pendingCount() > 0;
      if (!screen.active()) return;
      untracked(() => this.tabs.setDirty(screen.tabId(), dirty));
    });
    destroyRef.onDestroy(() => this.tabs.setDirty(screen.tabId(), false));

    const params = this.route.snapshot.queryParamMap;
    const wantSection = params.get('section');
    const wantField = params.get('field');

    if (isDevMode() && params.get('exemplo') === '1') {
      // Desenvolvimento sem backend: resposta de exemplo; salvar só aplica localmente.
      this.store.demo.set(true);
      this.store.setCatalog(settingsFixture());
      this.applyDeepLink(wantSection, wantField);
      return;
    }
    this.store.load().subscribe({
      next: () => this.applyDeepLink(wantSection, wantField),
      error: () => undefined,
    });
  }

  // ── Navegação ───────────────────────────────────────────────────────────────────────────────

  selectSection(key: string): void {
    this.store.search.set('');
    this.store.activeSection.set(key);
    this.syncUrl(key);
    this.host.nativeElement.querySelector('.ps__content')?.scrollIntoView({ block: 'start' });
  }

  clearSearch(): void {
    this.store.search.set('');
    this.searchInput()?.nativeElement.focus();
  }

  pendingIn(key: string): number {
    return this.store.pendingBySection()[key] ?? 0;
  }

  errorsIn(key: string): number {
    return this.store.errorsBySection()[key] ?? 0;
  }

  // ── Grupos ──────────────────────────────────────────────────────────────────────────────────

  /** Campos visíveis do grupo, separados em principais e "Mais opções" (avançados). */
  groupFields(group: SettingGroup): { main: SettingField[]; more: SettingField[] } {
    const visible = group.fields.filter(f => this.store.isVisible(f));
    return { main: visible.filter(f => !f.advanced), more: visible.filter(f => f.advanced) };
  }

  groupVisible(group: SettingGroup): boolean {
    return group.fields.some(f => this.store.isVisible(f));
  }

  isExpanded(section: SettingSection, group: SettingGroup): boolean {
    return this.expanded().has(`${section.key}|${group.key}`);
  }

  toggleMore(section: SettingSection, group: SettingGroup): void {
    const k = `${section.key}|${group.key}`;
    this.expanded.update(s => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  /** "Mais opções" com alteração ou erro abre sozinho (não esconder o que precisa de atenção). */
  moreNeedsAttention(more: SettingField[]): boolean {
    return more.some(f => this.store.isDirty(f.id) || !!this.store.errorOf(f.id));
  }

  // ── Salvar ──────────────────────────────────────────────────────────────────────────────────

  canSave(section: SettingSection): boolean {
    return this.pendingIn(section.key) > 0 && !this.blocking(section) && !this.store.saving();
  }

  /** Erros que impedem salvar: de campos alterados (editor) ou devolvidos pelo servidor. */
  blocking(section: SettingSection): number {
    return this.store.sectionFields(section.key)
      .filter(f => (this.store.isDirty(f.id) && !!this.store.editorErrors()[f.id] && !this.store.pendingOf(f.id)?.remove)
        || !!this.store.serverErrors()[f.id]).length;
  }

  discardSection(section: SettingSection): void {
    const n = this.pendingIn(section.key);
    this.store.discardSection(section.key);
    if (n) this.global.sendAlert(`${n} alteração(ões) descartada(s) em ${section.title}`, 'Ok');
  }

  save(section: SettingSection): void {
    if (!this.canSave(section)) return;
    const changes = this.store.sectionChanges(section.key);
    if (!changes.length) return;
    const items: ReviewItem[] = this.store.sectionPendingFields(section.key).map(f => {
      const p = this.store.pendingOf(f.id)!;
      return {
        id: f.id, label: f.label || f.key, pluginName: f.pluginName, key: f.key, type: f.type,
        secret: f.type === 'secret',
        before: f.exists ? f.value ?? (f.type === 'secret' ? '' : null) : null,
        after: p.remove ? null : p.value,
        remove: !!p.remove,
      };
    });
    this.dialog.open(SettingsReviewDialogComponent, {
      data: { sectionTitle: section.title, items },
      width: '860px', maxWidth: '96vw', panelClass: 'custom-dialog-container', autoFocus: false,
    }).afterClosed().subscribe(ok => {
      if (ok) this.send(section, changes);
    });
  }

  private send(section: SettingSection, changes: SettingChange[]): void {
    this.store.save(section.key, changes).subscribe({
      next: r => {
        if (r.kind === 'ok') {
          this.global.sendAlert(`${section.title}: ${changes.length} alteração(ões) salva(s)`, 'Ok');
        } else if (r.kind === 'invalid') {
          this.global.sendAlertError(`${r.errors.length} campo(s) com valor inválido — nada foi gravado`, 'Ok');
        } else {
          this.openConflict(section, changes, r.conflicts);
        }
      },
      error: (e) => this.global.sendAlertError(e?.error?.error ?? 'Erro ao salvar as configurações', 'Ok'),
    });
  }

  private openConflict(section: SettingSection, changes: SettingChange[], conflicts: SettingConflict[]): void {
    const fields = [...this.store.fieldById().values()];
    const items: ConflictItem[] = conflicts.map(c => {
      const f = fields.find(x => x.pluginId === c.pluginId && x.key === c.key);
      const mine = changes.find(x => x.pluginId === c.pluginId && x.key === c.key);
      return {
        id: c.id, label: f?.label || c.key, pluginName: f?.pluginName ?? '', key: c.key, type: f?.type ?? 'text',
        secret: f?.type === 'secret', expected: c.expected, current: c.current,
        mine: mine?.remove ? null : mine?.value ?? null,
      };
    });
    this.dialog.open(SettingsConflictDialogComponent, {
      data: { sectionTitle: section.title, items },
      width: '900px', maxWidth: '96vw', panelClass: 'custom-dialog-container', autoFocus: false,
    }).afterClosed().subscribe((choice: ConflictChoice | null) => {
      if (choice === 'overwrite') {
        this.send(section, this.store.overwriteChanges(changes, conflicts));
      } else if (choice === 'reload') {
        this.store.dropConflicting(conflicts);
        this.store.reload().subscribe({
          next: () => this.global.sendAlert('Recarregado: os campos em conflito ficaram com o valor do servidor', 'Ok'),
          error: () => this.global.sendAlertError('Erro ao recarregar as configurações', 'Ok'),
        });
      }
    });
  }

  /** A grade/editor da 0032 gravou um plugin: o catálogo (valores, plugins faltando, fora do catálogo) muda. */
  reloadCatalog(): void {
    this.store.reload().subscribe({ error: () => undefined });
  }

  // ── Sair com alterações ────────────────────────────────────────────────────────────────────

  hasPendingChanges(): boolean {
    return this.store.pendingCount() > 0;
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(e: BeforeUnloadEvent): void {
    if (!this.hasPendingChanges()) return;
    e.preventDefault();
    e.returnValue = '';
  }

  // ── Deep link ───────────────────────────────────────────────────────────────────────────────

  private applyDeepLink(section: string | null, fieldId: string | null): void {
    const ref = fieldId ? this.store.refs().find(r => r.field.id === fieldId || r.field.key === fieldId) : undefined;
    const key = ref?.section.key ?? section;
    if (key && this.store.sections().some(s => s.key === key)) this.store.activeSection.set(key);
    if (!ref) return;
    if (ref.field.obsolete) this.store.showObsolete.set(true);
    if (ref.field.advanced) this.expanded.update(s => new Set(s).add(`${ref.section.key}|${ref.group.key}`));
    this.highlightId.set(ref.field.id);
    setTimeout(() => {
      const el = document.getElementById(`sf-${ref.field.id}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    setTimeout(() => this.highlightId.set(null), 4000);
  }

  private syncUrl(section: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { section, field: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
