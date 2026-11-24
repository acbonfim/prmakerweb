import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { from, mergeMap, of, toArray, catchError, map } from 'rxjs';
import { ConfirmDialogComponent } from '../../../../components/confirmDialog/confirmDialog.component';
import { GlobalService } from '../../../../services/global.service';
import {
  EFFECT_HINT, EFFECT_LABEL, STANDARD_AREAS, STANDARD_AREA_LABEL, STANDARD_CHECK_KINDS, STANDARD_CHECK_KIND_HINT, STANDARD_CHECK_KIND_LABEL,
  STANDARD_CHECK_TARGETS, STANDARD_CHECK_TARGET_LABEL, STANDARD_EFFECTS, STANDARD_OBJECTS, STANDARD_OBJECT_LABEL, STANDARD_PLATFORMS,
  STANDARD_SOURCES, STANDARD_SOURCE_LABEL, STANDARD_STATUSES, STANDARD_STATUS_HINT, STANDARD_STATUS_LABEL, STANDARD_TOPICS,
  STANDARD_TOPIC_LABEL, Standard, StandardArea, StandardCheck, StandardCheckKind, StandardEffect, StandardObjectScope, StandardSourceKind,
  StandardStatus,
} from '../../../../services/governance/governance.model';
import { apiErrorMessage, slugify } from '../../../../services/governance/governance.logic';
import {
  StandardListFilter, effectiveEffect, filterStandards, groupStandards, inlineMd, joinExamples, newStandard, normalizeStandard, parseErRefs,
  splitExamples, standardFacets, switchCheckKind, validateStandard,
} from '../../../../services/governance/standards.logic';
import { formatDateTime } from '../../../../services/usage/usage.model';
import { GovernanceStore } from '../governance.store';
import { GovListInputComponent } from './gov-list-input.component';
import { GovStandardTesterComponent } from './gov-standard-tester.component';

/**
 * Catálogo de padrões (0101): lista por área e assunto com filtros, selo do código e de "proposto (aguarda DBA)",
 * detalhe com texto PT/EN, exemplos, a que se aplica, origem e conferência; edição (admin), mudança de efeito/estado em
 * lote e o teste da conferência (`POST standards/check`).
 */
@Component({
  selector: 'app-gov-standards-catalog',
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule, GovListInputComponent,
    GovStandardTesterComponent],
  templateUrl: './gov-standards-catalog.component.html',
  styleUrls: ['../governance-shared.css', './gov-editors.css', './gov-standards.css'],
})
export class GovStandardsCatalogComponent {
  readonly store = inject(GovernanceStore);
  private readonly dialog = inject(MatDialog);
  private readonly global = inject(GlobalService);
  private readonly tester = viewChild(GovStandardTesterComponent);
  private readonly testerBox = viewChild<ElementRef<HTMLElement>>('testerBox');

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly all = computed(() => this.store.standards() ?? []);

  // ---- filtros ----
  readonly area = signal<StandardArea | ''>('');
  readonly topic = signal('');
  readonly status = signal<StandardStatus | ''>('');
  readonly effect = signal<StandardEffect | ''>('');
  readonly source = signal<StandardSourceKind | ''>('');
  readonly repository = signal('');
  readonly module = signal('');
  readonly search = signal('');
  readonly filter = computed<StandardListFilter>(() => ({
    area: this.area(), topic: this.topic(), status: this.status(), effect: this.effect(), source: this.source(),
    repository: this.repository(), module: this.module(), search: this.search(),
  }));
  readonly hasFilters = computed(() => Object.values(this.filter()).some((v) => !!`${v ?? ''}`.trim()));
  readonly filtered = computed(() => filterStandards(this.all(), this.filter()));
  readonly groups = computed(() => groupStandards(this.filtered()));
  readonly facets = computed(() => standardFacets(this.all()));
  /** Assuntos da área escolhida (ou todos). */
  readonly topicOptions = computed(() => {
    const a = this.area();
    return standardFacets(a ? this.all().filter((s) => s.area === a) : this.all()).topics;
  });

  // ---- seleção em lote ----
  readonly selected = signal<Set<string>>(new Set());
  readonly selectedCount = computed(() => this.selected().size);
  readonly allVisibleSelected = computed(() => this.filtered().length > 0 && this.filtered().every((s) => this.selected().has(s.id)));
  readonly bulkEffect = signal<StandardEffect | ''>('');
  readonly bulkStatus = signal<StandardStatus | ''>('');
  readonly bulkRunning = signal(false);

  // ---- detalhe / edição ----
  readonly current = computed(() => {
    const k = this.store.selectedStandard();
    return k ? this.all().find((s) => s.key === k || s.id === k) ?? null : null;
  });
  readonly draft = signal<Standard | null>(null);
  private readonly original = signal('');
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  private keyTouched = false;
  /** Exemplos em edição (texto; um por bloco separado por linha em branco). */
  readonly goodText = signal('');
  readonly badText = signal('');

  readonly isNew = computed(() => !!this.draft() && !this.draft()!.id);
  readonly dirty = computed(() => !!this.draft() && JSON.stringify(this.draftOut()) !== this.original());
  readonly errors = computed(() => {
    const d = this.draftOut();
    return d ? validateStandard(d, this.all().filter((s) => s.id !== d.id).map((s) => s.key)) : {};
  });
  readonly errorCount = computed(() => Object.keys(this.errors()).length);
  /** Padrão em edição com os exemplos do texto (o que vai para a API). */
  readonly draftOut = computed<Standard | null>(() => {
    const d = this.draft();
    return d ? { ...d, examples: { good: splitExamples(this.goodText()), bad: splitExamples(this.badText()) } } : null;
  });
  readonly panelOpen = computed(() => !!this.draft() || !!this.current());

  readonly areas = STANDARD_AREAS;
  readonly areaLabel = STANDARD_AREA_LABEL;
  readonly topicLabel = STANDARD_TOPIC_LABEL;
  readonly allTopics = STANDARD_TOPICS;
  readonly statuses = STANDARD_STATUSES;
  readonly statusLabel = STANDARD_STATUS_LABEL;
  readonly statusHint = STANDARD_STATUS_HINT;
  readonly effects = STANDARD_EFFECTS;
  readonly effectLabel = EFFECT_LABEL;
  readonly effectHint = EFFECT_HINT;
  readonly sources = STANDARD_SOURCES;
  readonly sourceLabel = STANDARD_SOURCE_LABEL;
  readonly checkKinds = STANDARD_CHECK_KINDS;
  readonly checkKindLabel = STANDARD_CHECK_KIND_LABEL;
  readonly checkKindHint = STANDARD_CHECK_KIND_HINT;
  readonly checkTargets = STANDARD_CHECK_TARGETS;
  readonly checkTargetLabel = STANDARD_CHECK_TARGET_LABEL;
  readonly objects = STANDARD_OBJECTS;
  readonly objectLabel = STANDARD_OBJECT_LABEL;
  readonly platformSuggestions = STANDARD_PLATFORMS.map((p) => ({ value: p, label: p }));
  readonly repoSuggestions = computed(() => this.facets().repositories.map((r) => ({ value: r, label: r })));
  readonly moduleSuggestions = computed(() => this.facets().modules.map((m) => ({ value: m, label: m })));

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.store.api.standards().subscribe({
      next: (list) => {
        this.store.standards.set((list ?? []).map(normalizeStandard));
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Não consegui carregar os padrões.');
      },
    });
  }

  clearFilters(): void {
    this.area.set('');
    this.status.set('');
    this.effect.set('');
    this.source.set('');
    for (const s of [this.topic, this.repository, this.module, this.search]) s.set('');
  }

  setArea(a: StandardArea | ''): void {
    this.area.set(a);
    if (this.topic() && !this.topicOptions().includes(this.topic())) this.topic.set('');
  }

  // ---- lista ----

  open(s: Standard): void {
    if (this.store.selectedStandard() === s.key && !this.draft()) return;
    this.guard(() => {
      this.draft.set(null);
      this.store.select('padrao', s.key);
    });
  }

  openKey(key: string): void {
    const s = this.all().find((x) => x.key === key);
    if (s) this.open(s);
  }

  close(): void {
    this.guard(() => {
      this.draft.set(null);
      this.saveError.set(null);
      this.store.select('padrao', null);
    });
  }

  toggle(s: Standard): void {
    const next = new Set(this.selected());
    if (next.has(s.id)) next.delete(s.id);
    else next.add(s.id);
    this.selected.set(next);
  }

  toggleVisible(): void {
    const next = new Set(this.selected());
    const vis = this.filtered();
    if (this.allVisibleSelected()) vis.forEach((s) => next.delete(s.id));
    else vis.forEach((s) => next.add(s.id));
    this.selected.set(next);
  }

  toggleGroup(items: Standard[]): void {
    const next = new Set(this.selected());
    const all = items.every((s) => next.has(s.id));
    items.forEach((s) => (all ? next.delete(s.id) : next.add(s.id)));
    this.selected.set(next);
  }

  groupChecked(items: Standard[]): boolean {
    return items.length > 0 && items.every((s) => this.selected().has(s.id));
  }

  clearSelection(): void {
    this.selected.set(new Set());
  }

  /** Muda efeito e/ou estado dos selecionados (um PUT por padrão; a API não tem rota de lote). */
  applyBulk(): void {
    const eff = this.bulkEffect();
    const st = this.bulkStatus();
    if (!eff && !st) return;
    const ids = this.selected();
    const targets = this.all().filter((s) => ids.has(s.id) && ((eff && s.effect !== eff) || (st && s.status !== st)));
    if (!targets.length) {
      this.global.sendAlert('Os selecionados já estão assim.', 'OK');
      return;
    }
    const what = [eff ? `efeito "${EFFECT_LABEL[eff]}"` : '', st ? `estado "${STANDARD_STATUS_LABEL[st]}"` : ''].filter(Boolean).join(' e ');
    const blockNote = eff === 'block' ? ' Com o modo "Aplicando", o que tiver achado passa a ser barrado.' : '';
    this.dialog.open(ConfirmDialogComponent, {
      width: '460px',
      data: { title: `Mudar ${targets.length} padrão(ões)?`, description: `Aplicar ${what} em ${targets.length} padrão(ões).${blockNote}`, labelCancel: 'Cancelar', labelConfirm: 'Aplicar' },
    }).afterClosed().subscribe((ok) => {
      if (!ok) return;
      this.bulkRunning.set(true);
      from(targets).pipe(
        mergeMap((s) => this.store.api.updateStandard({ ...s, ...(eff ? { effect: eff } : {}), ...(st ? { status: st } : {}) }).pipe(
          map((saved) => ({ ok: true as const, s: normalizeStandard(saved ?? s) })),
          catchError(() => of({ ok: false as const, s })),
        ), 4),
        toArray(),
      ).subscribe((res) => {
        const saved = res.filter((r) => r.ok).map((r) => r.s);
        this.replaceMany(saved);
        this.bulkRunning.set(false);
        this.bulkEffect.set('');
        this.bulkStatus.set('');
        const failed = res.length - saved.length;
        if (failed) this.global.sendAlertError(`${saved.length} atualizado(s), ${failed} falharam.`, 'OK');
        else this.global.sendAlert(`${saved.length} padrão(ões) atualizado(s).`, 'OK');
      });
    });
  }

  /** Efeito direto na lista (grava na hora). */
  quickEffect(s: Standard, effect: string): void {
    const next = { ...s, effect: effect as StandardEffect };
    this.store.api.updateStandard(next).subscribe({
      next: (saved) => {
        this.replaceMany([normalizeStandard(saved ?? next)]);
        const note = s.status !== 'active' ? ' (só vale quando o padrão estiver vigente)' : '';
        this.global.sendAlert(`${s.code}: efeito ${EFFECT_LABEL[next.effect].toLowerCase()}${note}.`, 'OK');
      },
      error: (e) => this.global.sendAlertError(apiErrorMessage(e, 'Não consegui alterar o padrão.'), 'OK'),
    });
  }

  private replaceMany(list: Standard[]): void {
    const by = new Map(list.map((s) => [s.id, s]));
    this.store.standards.set(this.all().map((s) => by.get(s.id) ?? s));
  }

  // ---- edição ----

  /** Edição pendente: pergunta antes de trocar. */
  private guard(then: () => void): void {
    if (!this.dirty()) return then();
    this.dialog.open(ConfirmDialogComponent, {
      width: '420px',
      data: { title: 'Descartar alterações?', description: 'O padrão em edição tem alterações não salvas.', labelCancel: 'Continuar editando', labelConfirm: 'Descartar' },
    }).afterClosed().subscribe((ok) => ok && then());
  }

  edit(s: Standard): void {
    this.startEdit(structuredClone(s));
  }

  create(): void {
    this.guard(() => {
      this.store.select('padrao', null);
      this.startEdit(newStandard((this.area() || 'database') as StandardArea));
      this.keyTouched = false;
    });
  }

  private startEdit(s: Standard): void {
    this.keyTouched = !!s.id;
    const n = normalizeStandard(s);
    this.draft.set(n);
    this.goodText.set(joinExamples(n.examples.good));
    this.badText.set(joinExamples(n.examples.bad));
    this.original.set(JSON.stringify(this.draftOut()));
    this.saveError.set(null);
  }

  cancelEdit(): void {
    this.guard(() => {
      const wasNew = this.isNew();
      this.draft.set(null);
      this.saveError.set(null);
      if (wasNew) this.store.select('padrao', null);
    });
  }

  patch(p: Partial<Standard>): void {
    const d = this.draft();
    if (!d) return;
    const next = { ...d, ...p };
    if (!d.id && !this.keyTouched && (p.title !== undefined || p.code !== undefined || p.area !== undefined)) {
      next.key = slugify(`${next.area === 'database' ? 'db' : 'app'}-${next.code || next.title}`);
    }
    this.draft.set(next);
  }

  setKey(v: string): void {
    this.keyTouched = true;
    this.patch({ key: v.trim() });
  }

  setApplies<K extends keyof Standard['appliesTo']>(k: K, v: Standard['appliesTo'][K]): void {
    const d = this.draft();
    if (d) this.draft.set({ ...d, appliesTo: { ...d.appliesTo, [k]: v } });
  }

  toggleObject(o: StandardObjectScope): void {
    const d = this.draft();
    if (!d) return;
    const cur = d.appliesTo.objects;
    this.setApplies('objects', cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]);
  }

  setCheck(p: Partial<StandardCheck>): void {
    const d = this.draft();
    if (d) this.draft.set({ ...d, check: { ...d.check, ...p } });
  }

  setCheckKind(kind: string): void {
    const d = this.draft();
    if (d) this.draft.set({ ...d, check: switchCheckKind(d.check, kind as StandardCheckKind) });
  }

  save(): void {
    const d = this.draftOut();
    if (!d || this.errorCount()) return;
    this.saving.set(true);
    this.saveError.set(null);
    const call = d.id ? this.store.api.updateStandard(d) : this.store.api.createStandard(d);
    call.subscribe({
      next: (saved) => {
        const s = normalizeStandard(saved ?? d);
        if (d.id) this.replaceMany([s]);
        else this.store.standards.set([...this.all(), s]);
        this.saving.set(false);
        this.draft.set(null);
        this.store.select('padrao', s.key);
        this.global.sendAlert(`Padrão ${s.code} salvo.`, 'OK');
      },
      error: (e) => {
        this.saving.set(false);
        this.saveError.set(apiErrorMessage(e, 'Não consegui salvar o padrão.'));
      },
    });
  }

  remove(): void {
    const d = this.draft() ?? this.current();
    if (!d?.id || d.source.kind !== 'manual') return;
    this.dialog.open(ConfirmDialogComponent, {
      width: '420px',
      data: { title: 'Apagar o padrão?', description: `${d.code} · "${d.title}" deixa de valer. Isso não pode ser desfeito.`, labelCancel: 'Cancelar', labelConfirm: 'Apagar' },
    }).afterClosed().subscribe((ok) => {
      if (!ok) return;
      this.store.api.deleteStandard(d.id).subscribe({
        next: () => {
          this.store.standards.set(this.all().filter((s) => s.id !== d.id));
          this.draft.set(null);
          this.store.select('padrao', null);
          this.global.sendAlert('Padrão apagado.', 'OK');
        },
        error: (e) => this.saveError.set(apiErrorMessage(e, 'Não consegui apagar o padrão.')),
      });
    });
  }

  // ---- ações do detalhe ----

  /** Leva o exemplo errado (ou o certo) do padrão para o teste da conferência. */
  testWith(s: Standard): void {
    const text = s.examples.bad[0] ?? s.examples.good[0] ?? '';
    const target = s.check.target ?? (s.area === 'application' ? 'code' : 'sql');
    this.tester()?.prefill({ text: target === 'path' ? '' : text, target, path: target === 'path' ? (s.examples.bad[0] ?? '') : '', focus: s.key });
    this.testerBox()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  audit(s: Standard): void {
    this.store.openAudit({ category: 'standard', search: s.key });
  }

  adherence(): void {
    this.store.openStandards('aderencia');
  }

  copy(text: string | null): void {
    if (!text) return;
    void navigator.clipboard?.writeText(text);
    this.global.sendAlert('Copiado.', 'OK');
  }

  // ---- apresentação ----

  err(k: string): string | null {
    return this.errors()[k] ?? null;
  }

  topicName(t: string): string {
    return STANDARD_TOPIC_LABEL[t] ?? t;
  }

  md = inlineMd;
  erRefs = parseErRefs;
  effective = effectiveEffect;
  dt = formatDateTime;

  effectOf(v: string): StandardEffect {
    return v as StandardEffect;
  }

  statusBadge(s: Standard): string {
    if (s.status === 'proposed') return s.source.kind === 'wiki' ? 'proposto · aguarda DBA' : 'proposto';
    return STANDARD_STATUS_LABEL[s.status].toLowerCase();
  }

  objectsText(s: Standard): string {
    return s.appliesTo.objects.length ? s.appliesTo.objects.map((o) => STANDARD_OBJECT_LABEL[o] ?? o).join(', ') : 'todos';
  }

  appliesText(s: Standard): string {
    const a = s.appliesTo;
    const parts: string[] = [];
    if (a.repositories.length) parts.push(a.repositories.join(', '));
    if (a.modules.length) parts.push(`módulo ${a.modules.join(', ')}`);
    return parts.join(' · ');
  }

  checkText(c: StandardCheck): string {
    if (c.kind === 'none') return '';
    if (c.kind === 'sql') return 'consulta de validação';
    if (c.kind === 'path') return `caminho ${c.pattern ?? ''}`;
    if (c.kind === 'builtin') return `embutida: ${c.pattern ?? ''}`;
    return `regex em ${c.target ? STANDARD_CHECK_TARGET_LABEL[c.target] : 'texto'}`;
  }

  mustMatchText(c: StandardCheck): string {
    if (c.kind === 'path') return c.mustMatch ? 'O arquivo PRECISA ficar num caminho que case; fora dele é achado.' : 'Arquivo num caminho que case é achado.';
    return c.mustMatch ? 'O texto PRECISA conter a expressão; sem ela é achado.' : 'Cada linha que casa é um achado.';
  }
}
