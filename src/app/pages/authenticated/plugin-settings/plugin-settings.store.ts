import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, of, tap } from 'rxjs';
import {
  SettingChange, SettingConflict, SettingError, SettingField, SettingGroup, SettingSection, SettingsResponse,
  SettingsSaveResult, UncatalogedSetting,
} from './plugin-settings.model';
import {
  PendingChange, StepOption, baselineOf, buildChanges, currentValue, matchesSearch, sameValue, stepsFrom,
} from './plugin-settings.logic';
import { PluginSettingsService } from './plugin-settings.service';

/** Seção do front que fecha a navegação: grade de plugins, plugins faltando e chaves fora do catálogo. */
export const ADVANCED_SECTION = 'avancado';

/** Um campo com a seção e o grupo onde aparece. */
export interface FieldRef {
  field: SettingField;
  section: SettingSection;
  group: SettingGroup;
}

/** Resultado da busca: seção → grupos → campos que casaram. */
export interface SearchSection {
  section: SettingSection;
  groups: { group: SettingGroup; fields: SettingField[] }[];
}

/**
 * Estado da tela de configurações (0086): catálogo lido, edições pendentes por `field.id`, erros por campo, busca e
 * seção ativa. Uma instância por tela (providers do componente).
 */
@Injectable()
export class PluginSettingsStore {
  private readonly api = inject(PluginSettingsService);

  readonly catalog = signal<SettingsResponse | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal<string | null>(null);
  /** Dados de exemplo (`?exemplo=1` em desenvolvimento): salvar só aplica localmente. */
  readonly demo = signal(false);

  readonly pending = signal<Record<string, PendingChange>>({});
  /** Erro do editor (formato inválido enquanto digita). */
  readonly editorErrors = signal<Record<string, string>>({});
  /** Erro devolvido pelo servidor (400) — some quando o campo é editado. */
  readonly serverErrors = signal<Record<string, string>>({});

  readonly search = signal('');
  readonly activeSection = signal<string>('');
  readonly showObsolete = signal(false);

  /** Seções do catálogo + a seção avançada do front (chaves fora do catálogo como campos de texto). */
  readonly sections = computed<SettingSection[]>(() => {
    const c = this.catalog();
    if (!c) return [];
    return [...c.sections, this.advancedSection(c.uncataloged ?? [])];
  });

  readonly refs = computed<FieldRef[]>(() =>
    this.sections().flatMap(section => section.groups.flatMap(group => group.fields.map(field => ({ field, section, group })))));

  readonly fieldById = computed(() => {
    const m = new Map<string, SettingField>();
    for (const r of this.refs()) if (!m.has(r.field.id)) m.set(r.field.id, r.field);
    return m;
  });

  readonly pendingCount = computed(() => Object.keys(this.pending()).length);

  /** Alterações não salvas por seção. */
  readonly pendingBySection = computed(() => this.countBySection(id => !!this.pending()[id]));

  /** Campos com erro (editor ou servidor) por seção. */
  readonly errorsBySection = computed(() => this.countBySection(id => !!this.errorOf(id)));

  /** Chaves que o código lê e não existem no banco (usando o padrão). */
  readonly missingCount = computed(() =>
    [...this.fieldById().values()].filter(f => !f.exists && !f.obsolete && f.pluginId != null && !f.uncataloged).length);

  readonly obsoleteCount = computed(() => [...this.fieldById().values()].filter(f => f.obsolete && f.exists).length);

  readonly errorCount = computed(() => {
    const ids = new Set([...Object.keys(this.editorErrors()), ...Object.keys(this.serverErrors())]);
    return ids.size;
  });

  readonly current = computed<SettingSection | null>(() =>
    this.sections().find(s => s.key === this.activeSection()) ?? this.sections().at(0) ?? null);

  /** Busca única: todas as seções, agrupado por seção e grupo (valor em edição conta). */
  readonly searchResults = computed<SearchSection[]>(() => {
    const q = this.search().trim();
    if (!q) return [];
    const pending = this.pending();
    const out: SearchSection[] = [];
    for (const section of this.sections()) {
      const groups = section.groups
        .map(group => ({
          group,
          fields: group.fields.filter(f => this.isVisible(f) && matchesSearch(f, currentValue(f, pending[f.id]), q)),
        }))
        .filter(g => g.fields.length);
      if (groups.length) out.push({ section, groups });
    }
    return out;
  });

  readonly searchCount = computed(() => this.searchResults().reduce((n, s) => n + s.groups.reduce((m, g) => m + g.fields.length, 0), 0));

  // ── Leitura ─────────────────────────────────────────────────────────────────────────────────

  load(): Observable<SettingsResponse> {
    this.loading.set(true);
    this.loadError.set(null);
    return this.api.getSettings().pipe(
      tap({
        next: c => { this.setCatalog(c); this.loading.set(false); },
        error: (e) => {
          this.loading.set(false);
          this.loadError.set(e?.status === 403 ? 'Só administradores veem as configurações.' : 'Não foi possível carregar as configurações.');
        },
      }),
    );
  }

  /** Troca o catálogo mantendo as edições pendentes (as que ficaram iguais ao gravado saem). */
  setCatalog(c: SettingsResponse): void {
    this.catalog.set(c);
    if (!this.activeSection() || !this.sections().some(s => s.key === this.activeSection())) {
      this.activeSection.set(this.sections()[0]?.key ?? '');
    }
    const byId = this.fieldById();
    this.pending.update(p => {
      const next: Record<string, PendingChange> = {};
      for (const [id, change] of Object.entries(p)) {
        const f = byId.get(id);
        if (!f || f.pluginId == null) continue;
        if (!change.remove && !change.create && change.value === baselineOf(f)) continue;
        next[id] = change;
      }
      return next;
    });
  }

  // ── Edição ──────────────────────────────────────────────────────────────────────────────────

  valueOf(field: SettingField): string {
    return currentValue(field, this.pending()[field.id]);
  }

  isDirty(id: string): boolean {
    return !!this.pending()[id];
  }

  pendingOf(id: string): PendingChange | undefined {
    return this.pending()[id];
  }

  errorOf(id: string): string | null {
    return this.serverErrors()[id] ?? this.editorErrors()[id] ?? null;
  }

  /** Valor novo do editor; igual ao de base = sem pendência (segredo vazio = não muda). */
  setValue(field: SettingField, value: string): void {
    if (field.pluginId == null) return;
    const id = field.id;
    const unchanged = value === baselineOf(field) && !this.pending()[id]?.create;
    this.pending.update(p => {
      const next = { ...p };
      if (unchanged) delete next[id];
      else next[id] = { value };
      return next;
    });
    this.clearServerError(id);
  }

  setInvalid(id: string, message: string | null): void {
    const current = this.editorErrors()[id] ?? null;
    if (current === message) return;
    this.editorErrors.update(e => {
      const next = { ...e };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  }

  /** "Restaurar padrão": o valor de reserva do código. */
  restoreDefault(field: SettingField): void {
    if (field.default == null) return;
    this.setValue(field, field.default);
  }

  /** Chave inexistente ("usando o padrão") → gravar o padrão no banco. */
  writeDefault(field: SettingField): void {
    if (field.pluginId == null) return;
    this.pending.update(p => ({ ...p, [field.id]: { value: field.default ?? '', create: true } }));
  }

  /** Obsoleta / fora do catálogo → apagar a chave ao salvar a seção. */
  markRemove(field: SettingField, remove = true): void {
    if (field.pluginId == null) return;
    this.pending.update(p => {
      const next = { ...p };
      if (remove) next[field.id] = { value: '', remove: true };
      else delete next[field.id];
      return next;
    });
    if (remove) this.setInvalid(field.id, null);
  }

  discard(id: string): void {
    this.pending.update(p => { const n = { ...p }; delete n[id]; return n; });
    this.setInvalid(id, null);
    this.clearServerError(id);
  }

  discardSection(sectionKey: string): void {
    for (const f of this.sectionFields(sectionKey)) this.discard(f.id);
  }

  // ── Seções ──────────────────────────────────────────────────────────────────────────────────

  sectionFields(sectionKey: string): SettingField[] {
    return this.refs().filter(r => r.section.key === sectionKey).map(r => r.field);
  }

  /** Alterações da seção para o PATCH (`expected` = valor lido). */
  sectionChanges(sectionKey: string): SettingChange[] {
    return buildChanges(this.sectionFields(sectionKey), this.pending());
  }

  /** Campos da seção com pendência (para a revisão). */
  sectionPendingFields(sectionKey: string): SettingField[] {
    const p = this.pending();
    const seen = new Set<string>();
    return this.sectionFields(sectionKey).filter(f => p[f.id] && !seen.has(f.id) && seen.add(f.id));
  }

  sectionHasErrors(sectionKey: string): boolean {
    return (this.errorsBySection()[sectionKey] ?? 0) > 0;
  }

  /** Campo aparece (obsoletas só com "mostrar obsoletas" — ou se já marcadas para remover). */
  isVisible(f: SettingField): boolean {
    return !f.obsolete || this.showObsolete() || !!this.pending()[f.id];
  }

  /** Etapas conhecidas para um campo `steps`: as das listas em `stepSources`, com o valor EDITADO atual. */
  stepOptionsFor(field: SettingField): StepOption[] {
    const sources = field.stepSources ?? [];
    if (!sources.length) return [];
    const out: StepOption[] = [];
    for (const src of sources) {
      const i = src.lastIndexOf(':');
      const pluginName = i >= 0 ? src.slice(0, i) : '';
      const key = i >= 0 ? src.slice(i + 1) : src;
      const source = [...this.fieldById().values()].find(f => f.key === key && (!pluginName || f.pluginName === pluginName));
      if (!source) continue;
      for (const s of stepsFrom(this.valueOf(source))) if (!out.some(o => o.key === s.key)) out.push(s);
    }
    return out;
  }

  // ── Gravação ────────────────────────────────────────────────────────────────────────────────

  /** Envia as alterações; 200 aplica os campos devolvidos, 400 marca os campos, 409 volta para a tela decidir. */
  save(sectionKey: string, changes: SettingChange[]): Observable<SettingsSaveResult> {
    if (!changes.length) return of({ kind: 'ok', response: { plugins: [], fields: [] } } as SettingsSaveResult);
    this.saving.set(sectionKey);
    const call = this.demo() ? of(this.demoPatch(changes)) : this.api.patch(changes);
    return call.pipe(
      tap({
        next: r => {
          this.saving.set(null);
          if (r.kind === 'ok') this.applySaved(changes, r.response.fields, r.response.plugins);
          if (r.kind === 'invalid') this.applyErrors(r.errors);
        },
        error: () => this.saving.set(null),
      }),
    );
  }

  /** Conflito → "sobrescrever": refaz com `expected` = valor atual do servidor nos campos em conflito. */
  overwriteChanges(changes: SettingChange[], conflicts: SettingConflict[]): SettingChange[] {
    return changes.map(c => {
      const hit = conflicts.find(x => x.pluginId === c.pluginId && x.key === c.key);
      return hit ? { ...c, expected: hit.current } : c;
    });
  }

  /** Conflito → "recarregar": as minhas alterações nos campos em conflito saem (vale o do servidor); as outras ficam. */
  dropConflicting(conflicts: SettingConflict[]): void {
    const ids = new Set(conflicts.map(c => c.id));
    for (const c of conflicts) {
      const f = [...this.fieldById().values()].find(x => x.pluginId === c.pluginId && x.key === c.key);
      if (f) ids.add(f.id);
    }
    for (const id of ids) this.discard(id);
  }

  reload(): Observable<SettingsResponse> {
    return this.demo() ? of(this.catalog()!) : this.load();
  }

  private applySaved(changes: SettingChange[], fields: SettingField[], plugins: { id: number; version: string }[]): void {
    const c = this.catalog();
    if (!c) return;
    const byId = new Map(fields.map(f => [f.id, f]));
    const savedIds = new Set<string>(fields.map(f => f.id));
    const removed = changes.filter(x => x.remove);
    const next: SettingsResponse = {
      ...c,
      sections: c.sections.map(s => ({
        ...s,
        groups: s.groups.map(g => ({ ...g, fields: g.fields.map(f => byId.get(f.id) ?? f) })),
      })),
      plugins: c.plugins.map(p => ({ ...p, version: plugins.find(x => x.id === p.id)?.version ?? p.version })),
      uncataloged: (c.uncataloged ?? [])
        .filter(u => !removed.some(r => r.pluginId === u.pluginId && r.key === u.key))
        .map(u => {
          const ch = changes.find(x => x.pluginId === u.pluginId && x.key === u.key && !x.remove);
          return ch ? { ...u, value: u.secret ? null : ch.value } : u;
        }),
    };
    // Os ids enviados saem das pendências (inclusive os que o servidor não devolveu, ex.: chave removida).
    for (const ch of changes) {
      const f = this.refs().find(r => r.field.pluginId === ch.pluginId && r.field.key === ch.key)?.field;
      if (f) savedIds.add(f.id);
    }
    this.catalog.set(next);
    this.pending.update(p => { const n = { ...p }; for (const id of savedIds) delete n[id]; return n; });
    this.serverErrors.update(e => { const n = { ...e }; for (const id of savedIds) delete n[id]; return n; });
  }

  private applyErrors(errors: SettingError[]): void {
    this.serverErrors.update(e => {
      const next = { ...e };
      for (const err of errors) next[err.id] = err.message;
      return next;
    });
  }

  private clearServerError(id: string): void {
    if (!this.serverErrors()[id]) return;
    this.serverErrors.update(e => { const n = { ...e }; delete n[id]; return n; });
  }

  private countBySection(test: (id: string) => boolean): Record<string, number> {
    const out: Record<string, number> = {};
    const seen = new Set<string>();
    for (const r of this.refs()) {
      const k = `${r.section.key}|${r.field.id}`;
      if (seen.has(k) || !test(r.field.id)) continue;
      seen.add(k);
      out[r.section.key] = (out[r.section.key] ?? 0) + 1;
    }
    return out;
  }

  private advancedSection(uncataloged: UncatalogedSetting[]): SettingSection {
    const fields = uncataloged.map<SettingField>(u => {
      const long = (u.value ?? '').length > 80 || (u.value ?? '').includes('\n');
      return {
        id: `${u.pluginId}:${u.key}`,
        pluginId: u.pluginId,
        pluginName: u.pluginName,
        key: u.key,
        label: u.key,
        help: 'Chave gravada no plugin que nenhuma parte do código descreve no catálogo — editada como texto.',
        type: u.secret ? 'secret' : long ? 'textarea' : 'text',
        value: u.secret ? null : u.value,
        hasValue: u.secret || (u.value ?? '') !== '',
        exists: true,
        default: null,
        isDefault: false,
        readBy: [],
        personal: null,
        uncataloged: true,
      };
    });
    return {
      key: ADVANCED_SECTION,
      title: 'Plugins (avançado)',
      icon: 'extension',
      description: 'Lista técnica dos plugins (nome, só admin, uso pessoal, quem preenche cada campo) e chaves fora do catálogo.',
      groups: fields.length ? [{ key: 'fora-do-catalogo', title: 'Chaves fora do catálogo', fields,
        description: 'Gravadas nos plugins, mas sem descrição no catálogo (podem ser de uso manual ou sobras). Remova as que não servem mais.' }] : [],
    };
  }

  /** `?exemplo=1`: aplica localmente, como o servidor faria (sem checar conflito). */
  private demoPatch(changes: SettingChange[]): SettingsSaveResult {
    const fields: SettingField[] = [];
    for (const ch of changes) {
      const f = [...this.fieldById().values()].find(x => x.pluginId === ch.pluginId && x.key === ch.key);
      if (!f || f.uncataloged) continue;
      const value = ch.remove ? null : ch.value;
      fields.push({
        ...f,
        value: f.type === 'secret' ? null : value,
        hasValue: !ch.remove && (value ?? '') !== '',
        exists: !ch.remove,
        isDefault: f.default != null && sameValue(value, f.default),
      });
    }
    return { kind: 'ok', response: { plugins: [], fields } };
  }
}

