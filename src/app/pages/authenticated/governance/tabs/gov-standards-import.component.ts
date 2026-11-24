import { Component, computed, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ConfirmDialogComponent } from '../../../../components/confirmDialog/confirmDialog.component';
import { GlobalService } from '../../../../services/global.service';
import {
  EFFECT_LABEL, GovernanceEvent, STANDARD_AREA_LABEL, STANDARD_CHECK_KIND_LABEL, STANDARD_SOURCE_LABEL, STANDARD_STATUS_LABEL, STANDARD_TOPIC_LABEL,
  STANDARDS_WIKI_URL, Standard, StandardDraft, StandardModuleOption,
} from '../../../../services/governance/governance.model';
import { apiErrorMessage } from '../../../../services/governance/governance.logic';
import {
  DiffSegment, DraftKind, DraftRow, draftSummary, inlineMd, normalizeDraft, normalizeStandard, wordDiff,
} from '../../../../services/governance/standards.logic';
import { formatDateTime } from '../../../../services/usage/usage.model';
import { GovernanceStore } from '../governance.store';

const KIND_LABEL: Record<DraftKind, string> = { added: 'novo', changed: 'alterado', removed: 'saiu' };

/**
 * Importar padrões (0101): lê a wiki "Data Nomenclature and Rules" (pela integração DevOps de quem pede) ou a engenharia
 * reversa publicada (estrutura de aplicação por módulo) e mostra o rascunho com a diferença por item — novos, alterados
 * (diff do texto) e os que saíram. O admin aceita/recusa por item ou em lote e aplica.
 */
@Component({
  selector: 'app-gov-standards-import',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  templateUrl: './gov-standards-import.component.html',
  styleUrls: ['../governance-shared.css', './gov-editors.css', './gov-standards.css'],
  styles: [`
    .sources { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; }
    .sources .panel { display: flex; flex-direction: column; gap: 10px; }
    .url { width: 100%; }
    .mods { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 13px; max-height: 180px; overflow: auto; }
    .mods label { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
    .mods .unpub { color: var(--cc-text-3); }
    .row { border: 1px solid var(--cc-surface-border); border-radius: 8px; padding: 6px 10px; margin-bottom: 6px; }
    .row--off { opacity: 0.55; }
    .row__head { display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto; align-items: center; gap: 8px; }
    .row__title { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .row__title b { font-size: 13px; font-weight: 500; }
    .row__body { margin: 8px 0 4px 26px; display: flex; flex-direction: column; gap: 8px; }
    .kind { font-size: 11px; padding: 1px 7px; border-radius: 9px; white-space: nowrap; }
    .kind--added { background: color-mix(in srgb, #3fb950 24%, transparent); }
    .kind--changed { background: color-mix(in srgb, #3987e5 26%, transparent); }
    .kind--removed { background: color-mix(in srgb, #d03b3b 26%, transparent); }
    .fields { display: flex; gap: 4px; flex-wrap: wrap; }
    .fld h5 { margin: 0 0 2px; font-size: 11.5px; color: var(--cc-text-3); font-weight: 500; }
    .ba { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12.5px; }
    .tile--btn.on { border-color: var(--mat-sys-primary); }
    .hist { margin: 0; padding-left: 18px; font-size: 12.5px; display: flex; flex-direction: column; gap: 4px; }
  `],
})
export class GovStandardsImportComponent {
  readonly store = inject(GovernanceStore);
  private readonly dialog = inject(MatDialog);
  private readonly global = inject(GlobalService);

  readonly wikiUrl = signal(STANDARDS_WIKI_URL);
  readonly modules = signal<StandardModuleOption[]>([]);
  readonly modulesError = signal<string | null>(null);
  /** Vazio = todos os módulos com engenharia reversa publicada. */
  readonly pickedModules = signal<Set<string>>(new Set());
  readonly reading = signal<'wiki' | 'reverse-engineering' | null>(null);
  readonly readError = signal<string | null>(null);

  readonly draft = signal<StandardDraft | null>(null);
  readonly rows = computed<DraftRow[]>(() => {
    const d = this.draft();
    return d ? normalizeDraft(d, this.store.standards() ?? []) : [];
  });
  readonly summary = computed(() => draftSummary(this.rows()));
  /** Decisão por chave (aceito = true). Novos e alterados começam aceitos; os que saíram, recusados. */
  readonly accepted = signal<Map<string, boolean>>(new Map());
  readonly acceptedCount = computed(() => this.rows().filter((r) => this.isAccepted(r)).length);
  readonly kindFilter = signal<DraftKind | ''>('');
  readonly search = signal('');
  readonly visible = computed(() => {
    const k = this.kindFilter();
    const q = this.search().trim().toLowerCase();
    return this.rows().filter((r) => (!k || r.kind === k) && (!q || `${r.code} ${r.title} ${r.key}`.toLowerCase().includes(q)));
  });
  readonly expanded = signal<Set<string>>(new Set());
  readonly applying = signal(false);

  readonly history = signal<GovernanceEvent[]>([]);

  readonly kindLabel = KIND_LABEL;
  readonly areaLabel = STANDARD_AREA_LABEL;
  readonly topicLabel = STANDARD_TOPIC_LABEL;
  readonly statusLabel = STANDARD_STATUS_LABEL;
  readonly effectLabel = EFFECT_LABEL;
  readonly sourceLabel = STANDARD_SOURCE_LABEL;
  readonly checkKindLabel = STANDARD_CHECK_KIND_LABEL;

  constructor() {
    this.store.ensureStandards();
    this.store.api.standardModules().subscribe({
      next: (m) => this.modules.set((m ?? []).sort((a, b) => Number(b.published) - Number(a.published) || a.name.localeCompare(b.name, 'pt-BR'))),
      error: () => this.modulesError.set('Não consegui listar os módulos da engenharia reversa.'),
    });
    this.loadHistory();
  }

  private loadHistory(): void {
    this.store.api.changes(200).subscribe({
      next: (list) => this.history.set((list ?? []).filter((e) => /standards\/import/i.test(e.action)).slice(0, 10)),
      error: () => undefined,
    });
  }

  // ---- ler a origem ----

  toggleModule(key: string): void {
    const next = new Set(this.pickedModules());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.pickedModules.set(next);
  }

  readWiki(): void {
    const url = this.wikiUrl().trim();
    if (!url) return;
    this.read('wiki', this.store.api.importStandardsWiki(url));
  }

  readReverse(): void {
    const picked = [...this.pickedModules()];
    this.read('reverse-engineering', this.store.api.importStandardsReverse(picked.length ? picked : null));
  }

  clearModules(): void {
    this.pickedModules.set(new Set());
  }

  private read(kind: 'wiki' | 'reverse-engineering', call: Observable<StandardDraft>): void {
    this.guard(() => {
      this.reading.set(kind);
      this.readError.set(null);
      call.subscribe({
        next: (d) => {
          this.reading.set(null);
          const draft = { ...d, source: d.source ?? kind };
          this.draft.set(draft);
          this.kindFilter.set('');
          this.search.set('');
          this.expanded.set(new Set());
          const m = new Map<string, boolean>();
          for (const r of normalizeDraft(draft, this.store.standards() ?? [])) m.set(r.key, r.kind !== 'removed');
          this.accepted.set(m);
        },
        error: (e) => {
          this.reading.set(null);
          this.readError.set(apiErrorMessage(e, kind === 'wiki'
            ? 'Não consegui ler a wiki. Confira o endereço e se a sua integração com o Azure DevOps está configurada.'
            : 'Não consegui ler a engenharia reversa.'));
        },
      });
    });
  }

  /** Rascunho com decisões: pergunta antes de trocar por outro. */
  private guard(then: () => void): void {
    if (!this.draft()) return then();
    this.dialog.open(ConfirmDialogComponent, {
      width: '420px',
      data: { title: 'Descartar o rascunho atual?', description: 'O rascunho aberto ainda não foi aplicado.', labelCancel: 'Manter', labelConfirm: 'Descartar' },
    }).afterClosed().subscribe((ok) => ok && then());
  }

  discard(): void {
    this.guard(() => this.draft.set(null));
  }

  // ---- decisões ----

  isAccepted(r: DraftRow): boolean {
    return this.accepted().get(r.key) ?? false;
  }

  setAccepted(r: DraftRow, v: boolean): void {
    const m = new Map(this.accepted());
    m.set(r.key, v);
    this.accepted.set(m);
  }

  setAll(v: boolean, onlyVisible = false): void {
    const m = new Map(this.accepted());
    for (const r of onlyVisible ? this.visible() : this.rows()) m.set(r.key, v);
    this.accepted.set(m);
  }

  toggleKind(k: DraftKind): void {
    this.kindFilter.set(this.kindFilter() === k ? '' : k);
  }

  toggleExpand(r: DraftRow): void {
    const next = new Set(this.expanded());
    if (next.has(r.key)) next.delete(r.key);
    else next.add(r.key);
    this.expanded.set(next);
  }

  apply(): void {
    const d = this.draft();
    if (!d) return;
    const keys = this.rows().filter((r) => this.isAccepted(r)).map((r) => r.key);
    if (!keys.length) {
      this.global.sendAlert('Nenhum item aceito.', 'OK');
      return;
    }
    const by = (k: DraftKind) => this.rows().filter((r) => r.kind === k && this.isAccepted(r)).length;
    this.dialog.open(ConfirmDialogComponent, {
      width: '460px',
      data: {
        title: 'Aplicar a importação?',
        description: `${by('added')} novo(s), ${by('changed')} alterado(s) e ${by('removed')} saída(s) entram no catálogo. Novos entram em Monitorar` +
          ` (os (NEW) da wiki como propostos); efeito e estado dos alterados não mudam.`,
        labelCancel: 'Cancelar', labelConfirm: 'Aplicar',
      },
    }).afterClosed().subscribe((ok) => {
      if (!ok) return;
      this.applying.set(true);
      this.store.api.applyStandardsImport(d.id, keys).subscribe({
        next: (res) => {
          this.applying.set(false);
          this.draft.set(null);
          const n = res?.applied ?? keys.length;
          this.global.sendAlert(`Importação aplicada: ${n} item(ns).`, 'OK');
          this.store.api.standards().subscribe({ next: (l) => this.store.standards.set((l ?? []).map(normalizeStandard)), error: () => undefined });
          this.loadHistory();
        },
        error: (e) => {
          this.applying.set(false);
          this.global.sendAlertError(apiErrorMessage(e, 'Não consegui aplicar a importação.'), 'OK');
        },
      });
    });
  }

  // ---- apresentação ----

  diff(a: string | null | undefined, b: string | null | undefined): DiffSegment[] {
    return wordDiff(a, b);
  }

  examplesText(s: Standard | null): string {
    return s ? [...s.examples.good.map((x) => `✓ ${x}`), ...s.examples.bad.map((x) => `✗ ${x}`)].join('\n') : '';
  }

  checkText(s: Standard | null): string {
    if (!s) return '—';
    const c = s.check;
    return c.kind === 'none' ? 'sem conferência' : `${STANDARD_CHECK_KIND_LABEL[c.kind]}${c.pattern ? `: ${c.pattern}` : ''}`;
  }

  appliesText(s: Standard | null): string {
    if (!s) return '—';
    const a = s.appliesTo;
    return [a.platforms.join(', '), a.repositories.join(', ') || 'todos os repositórios', a.modules.length ? `módulos ${a.modules.join(', ')}` : '', a.objects.join('/')]
      .filter(Boolean).join(' · ');
  }

  topicName(t: string): string {
    return STANDARD_TOPIC_LABEL[t] ?? t;
  }

  md = inlineMd;
  dt = formatDateTime;
}
