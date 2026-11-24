import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ConfirmDialogComponent } from '../../../../components/confirmDialog/confirmDialog.component';
import { GlobalService } from '../../../../services/global.service';
import {
  GovMode, GovSource, GovernanceEvent, GovernanceSettings, MILESTONE_ATS, MILESTONE_AT_LABEL, MILESTONE_FROMS, MILESTONE_FROM_LABEL,
  MODES, MODE_HINT, MODE_LABEL, Milestone, ROLES, ROLE_LABEL, SOURCES, SOURCE_LABEL,
} from '../../../../services/governance/governance.model';
import { apiErrorMessage, moveItem, renumber, slugify, validateMilestones } from '../../../../services/governance/governance.logic';
import { formatDateTime } from '../../../../services/usage/usage.model';
import { GovernanceStore } from '../governance.store';

/**
 * Configurações da governança (0098): modo global (com explicação e confirmação ao aplicar), retenção, hooks
 * (fail-open, tempo máximo, cache), papéis isentos, origens gravadas, marcos do card e o histórico de alterações.
 */
@Component({
  selector: 'app-gov-settings',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatSlideToggleModule, MatTooltipModule],
  templateUrl: './gov-settings.component.html',
  styleUrls: ['../governance-shared.css', './gov-editors.css', './gov-settings.component.css'],
})
export class GovSettingsComponent {
  readonly store = inject(GovernanceStore);
  private readonly dialog = inject(MatDialog);
  private readonly global = inject(GlobalService);

  readonly draft = signal<GovernanceSettings | null>(null);
  private readonly original = signal('');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);

  readonly changes = signal<GovernanceEvent[]>([]);
  readonly changesLoading = signal(false);

  readonly dirty = computed(() => !!this.draft() && JSON.stringify(this.draft()) !== this.original());
  readonly savedMode = computed<GovMode | null>(() => (this.original() ? (JSON.parse(this.original()) as GovernanceSettings).mode : null));
  readonly msErrors = computed(() => validateMilestones(this.draft()?.milestones ?? []));
  readonly errors = computed(() => {
    const d = this.draft();
    const e: Record<string, string> = {};
    if (!d) return e;
    if (!Number.isInteger(d.retentionDays) || d.retentionDays < 7 || d.retentionDays > 3650) e['retentionDays'] = 'Entre 7 e 3650 dias.';
    if (!Number.isInteger(d.hookTimeoutMs) || d.hookTimeoutMs < 100 || d.hookTimeoutMs > 10000) e['hookTimeoutMs'] = 'Entre 100 e 10000 ms.';
    if (!Number.isInteger(d.hookCacheSeconds) || d.hookCacheSeconds < 0 || d.hookCacheSeconds > 3600) e['hookCacheSeconds'] = 'Entre 0 e 3600 s.';
    if (Object.keys(this.msErrors()).length) e['milestones'] = 'Corrija os marcos destacados.';
    return e;
  });
  readonly errorCount = computed(() => Object.keys(this.errors()).length);

  readonly modes = MODES;
  readonly modeLabel = MODE_LABEL;
  readonly modeHint = MODE_HINT;
  readonly roles = ROLES;
  readonly roleLabel = ROLE_LABEL;
  readonly sources = SOURCES;
  readonly sourceLabel = SOURCE_LABEL;
  readonly froms = MILESTONE_FROMS;
  readonly fromLabel = MILESTONE_FROM_LABEL;
  readonly ats = MILESTONE_ATS;
  readonly atLabel = MILESTONE_AT_LABEL;

  constructor() {
    this.load();
    this.loadChanges();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.store.api.settings().subscribe({
      next: (s) => {
        this.reset(s);
        this.store.settings.set(s);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Não consegui carregar as configurações.');
      },
    });
  }

  loadChanges(): void {
    this.changesLoading.set(true);
    this.store.api.changes(50).subscribe({
      next: (c) => {
        this.changes.set(c ?? []);
        this.changesLoading.set(false);
      },
      error: () => this.changesLoading.set(false),
    });
  }

  private reset(s: GovernanceSettings): void {
    const copy: GovernanceSettings = {
      ...s,
      exemptRoles: [...(s.exemptRoles ?? [])],
      recordSources: [...(s.recordSources ?? [])],
      milestones: [...(s.milestones ?? [])].sort((a, b) => a.order - b.order).map((m) => ({ ...m })),
    };
    this.draft.set(copy);
    this.original.set(JSON.stringify(copy));
  }

  discard(): void {
    if (this.original()) this.draft.set(JSON.parse(this.original()));
    this.saveError.set(null);
  }

  patch(p: Partial<GovernanceSettings>): void {
    const d = this.draft();
    if (d) this.draft.set({ ...d, ...p });
  }

  num(v: unknown): number {
    const n = Number(`${v}`.replace(',', '.'));
    return Number.isFinite(n) ? Math.round(n) : NaN;
  }

  toggleRole(r: string): void {
    const d = this.draft();
    if (!d) return;
    this.patch({ exemptRoles: d.exemptRoles.includes(r) ? d.exemptRoles.filter((x) => x !== r) : [...d.exemptRoles, r] });
  }

  toggleSource(s: GovSource): void {
    const d = this.draft();
    if (!d) return;
    this.patch({ recordSources: d.recordSources.includes(s) ? d.recordSources.filter((x) => x !== s) : [...d.recordSources, s] });
  }

  // ---- marcos ----

  setMs(i: number, p: Partial<Milestone>): void {
    const d = this.draft();
    if (!d) return;
    const list = d.milestones.map((m, k) => {
      if (k !== i) return m;
      const next: Milestone = { ...m, ...p };
      if (p.label !== undefined && (!m.key || m.key === slugify(m.label))) next.key = slugify(p.label);
      if (next.from !== 'plan' && next.from !== 'step') delete next.phase;
      if (next.from === 'plan') delete next.match;
      return next;
    });
    this.patch({ milestones: list });
  }

  setPhase(i: number, v: string): void {
    this.setMs(i, { phase: v === 'analysis' || v === 'correction' ? v : undefined });
  }

  moveMs(i: number, delta: number): void {
    const d = this.draft();
    if (d) this.patch({ milestones: renumber(moveItem(d.milestones, i, i + delta)) });
  }

  addMs(): void {
    const d = this.draft();
    if (!d) return;
    this.patch({ milestones: renumber([...d.milestones, { key: '', label: '', order: 0, from: 'event', match: '', at: 'finished' }]) });
  }

  removeMs(i: number): void {
    const d = this.draft();
    if (d) this.patch({ milestones: renumber(d.milestones.filter((_, k) => k !== i)) });
  }

  // ---- salvar ----

  save(): void {
    const d = this.draft();
    if (!d || this.errorCount()) return;
    const from = this.savedMode();
    if (d.mode !== from && (d.mode === 'enforce' || d.mode === 'off')) {
      const enforce = d.mode === 'enforce';
      this.dialog.open(ConfirmDialogComponent, {
        width: '480px',
        data: enforce
          ? {
            title: 'Aplicar as regras de verdade?',
            description: 'No modo "Aplicando", as regras com efeito "bloquear" passam a barrar ações nas telas, no MCP e nos hooks do Claude Code (terminal e executor), e as de "avisar" mostram o aviso. Confira antes, na Auditoria, o que apareceu como "teria barrado".',
            labelCancel: 'Cancelar', labelConfirm: 'Aplicar',
          }
          : {
            title: 'Desligar a governança?',
            description: 'Com a governança desligada nada é avaliado nem registrado na trilha (as métricas param de receber eventos). As regras ficam guardadas.',
            labelCancel: 'Cancelar', labelConfirm: 'Desligar',
          },
      }).afterClosed().subscribe((ok) => ok && this.doSave());
      return;
    }
    this.doSave();
  }

  private doSave(): void {
    const d = this.draft();
    if (!d) return;
    const body: GovernanceSettings = { ...d, milestones: renumber(d.milestones) };
    this.saving.set(true);
    this.saveError.set(null);
    this.store.api.saveSettings(body).subscribe({
      next: (saved) => {
        const s = saved ?? body;
        this.reset(s);
        this.store.settings.set(s);
        this.saving.set(false);
        this.global.sendAlert('Configurações da governança salvas.', 'OK');
        this.loadChanges();
      },
      error: (e) => {
        this.saving.set(false);
        this.saveError.set(apiErrorMessage(e, 'Não consegui salvar as configurações.'));
      },
    });
  }

  modeOf(v: string): GovMode {
    return v as GovMode;
  }

  dt = formatDateTime;
}
