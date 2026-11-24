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
  CARD_TYPES, EFFECTS, EFFECT_HINT, EFFECT_LABEL, GovEffect, GovSource, GovernanceRule, ROLES, ROLE_LABEL, RULE_CATEGORIES,
  RULE_CATEGORY_LABEL, SOURCES, SOURCE_LABEL,
} from '../../../../services/governance/governance.model';
import {
  RULE_MATCH_DIMS, RuleMatchDim, apiErrorMessage, groupRulesByCategory, newRule, normalizeRule, slugify, validateRule,
} from '../../../../services/governance/governance.logic';
import { formatDateTime } from '../../../../services/usage/usage.model';
import { GovernanceStore } from '../governance.store';
import { GovListInputComponent } from './gov-list-input.component';
import { GovRuleSimulatorComponent } from './gov-rule-simulator.component';

/**
 * Regras e guardrails (0098): lista por categoria (liga/desliga e efeito direto na lista), editor completo (escopo,
 * casamentos, mensagem) e o simulador. Embutidas: não apagam nem trocam a chave.
 */
@Component({
  selector: 'app-gov-rules',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatSlideToggleModule, MatTooltipModule,
    GovListInputComponent, GovRuleSimulatorComponent],
  templateUrl: './gov-rules.component.html',
  styleUrls: ['../governance-shared.css', './gov-editors.css'],
})
export class GovRulesComponent {
  readonly store = inject(GovernanceStore);
  private readonly dialog = inject(MatDialog);
  private readonly global = inject(GlobalService);

  readonly rules = signal<GovernanceRule[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly filter = signal('');

  /** Regra em edição (cópia) e a original (para saber se mudou). */
  readonly draft = signal<GovernanceRule | null>(null);
  private readonly original = signal<string>('');
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  /** Chave gerada do nome enquanto a pessoa não mexe nela (regra nova). */
  private keyTouched = false;

  readonly groups = computed(() => {
    const q = this.filter().trim().toLowerCase();
    const list = q ? this.rules().filter((r) => `${r.name} ${r.key} ${r.description}`.toLowerCase().includes(q)) : this.rules();
    return groupRulesByCategory(list);
  });
  readonly isNew = computed(() => !!this.draft() && !this.draft()!.id);
  readonly dirty = computed(() => !!this.draft() && JSON.stringify(this.draft()) !== this.original());
  readonly errors = computed(() => {
    const d = this.draft();
    if (!d) return {};
    return validateRule(d, this.rules().filter((r) => r.id !== d.id).map((r) => r.key));
  });
  readonly errorCount = computed(() => Object.keys(this.errors()).length);
  readonly activeCount = computed(() => this.rules().filter((r) => r.enabled).length);

  readonly effects = EFFECTS;
  readonly effectLabel = EFFECT_LABEL;
  readonly effectHint = EFFECT_HINT;
  readonly categories = RULE_CATEGORIES;
  readonly categoryLabel = RULE_CATEGORY_LABEL;
  readonly roles = ROLES;
  readonly roleLabel = ROLE_LABEL;
  readonly sources = SOURCES;
  readonly sourceLabel = SOURCE_LABEL;
  readonly dims = RULE_MATCH_DIMS;
  readonly cardTypeSuggestions = CARD_TYPES.map((c) => ({ value: c, label: c }));
  readonly userSuggestions = computed(() => this.store.userOptions().map((u) => ({ value: u.id, label: u.name })));

  constructor() {
    this.load();
    if (!this.store.userOptions().length) {
      this.store.api.users(this.store.range()).subscribe({ next: (u) => this.store.mergeUsers(u ?? []), error: () => undefined });
    }
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.store.api.rules().subscribe({
      next: (r) => {
        const list = (r ?? []).map(normalizeRule);
        this.rules.set(list);
        this.store.rules.set(list);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Não consegui carregar as regras.');
      },
    });
  }

  // ---- lista ----

  edit(r: GovernanceRule): void {
    if (this.draft()?.id === r.id) return;
    this.guard(() => this.startEdit(structuredClone(r)));
  }

  create(): void {
    this.guard(() => {
      const max = Math.max(0, ...this.rules().map((r) => r.order));
      this.startEdit(newRule(max + 10));
      this.keyTouched = false;
    });
  }

  /** Edição pendente: pergunta antes de trocar de regra. */
  private guard(then: () => void): void {
    if (!this.dirty()) return then();
    this.dialog.open(ConfirmDialogComponent, {
      width: '420px',
      data: { title: 'Descartar alterações?', description: 'A regra em edição tem alterações não salvas.', labelCancel: 'Continuar editando', labelConfirm: 'Descartar' },
    }).afterClosed().subscribe((ok) => ok && then());
  }

  private startEdit(r: GovernanceRule): void {
    this.keyTouched = !!r.id;
    this.draft.set(normalizeRule(r));
    this.original.set(JSON.stringify(this.draft()));
    this.saveError.set(null);
  }

  cancel(): void {
    this.guard(() => {
      this.draft.set(null);
      this.saveError.set(null);
    });
  }

  /** Liga/desliga ou troca o efeito direto na lista (grava na hora). */
  quick(r: GovernanceRule, patch: Partial<GovernanceRule>): void {
    const next = { ...r, ...patch };
    this.store.api.updateRule(next).subscribe({
      next: (saved) => {
        this.replace(normalizeRule(saved ?? next));
        const d = this.draft();
        if (d?.id === r.id) {
          this.draft.set({ ...d, ...patch });
          this.original.set(JSON.stringify({ ...JSON.parse(this.original()), ...patch }));
        }
        this.global.sendAlert(`Regra "${r.name}" ${patch.enabled === undefined ? `agora ${EFFECT_LABEL[next.effect].toLowerCase()}` : patch.enabled ? 'ligada' : 'desligada'}.`, 'OK');
      },
      error: (e) => this.global.sendAlertError(apiErrorMessage(e, 'Não consegui alterar a regra.'), 'OK'),
    });
  }

  // ---- editor ----

  patch(p: Partial<GovernanceRule>): void {
    const d = this.draft();
    if (!d) return;
    const next = { ...d, ...p };
    if (p.name !== undefined && !d.id && !this.keyTouched) next.key = slugify(p.name);
    this.draft.set(next);
  }

  setKey(v: string): void {
    this.keyTouched = true;
    this.patch({ key: v.trim() });
  }

  setScope<K extends keyof GovernanceRule['scope']>(k: K, v: GovernanceRule['scope'][K]): void {
    const d = this.draft();
    if (d) this.draft.set({ ...d, scope: { ...d.scope, [k]: v } });
  }

  toggleIn(k: 'roles' | 'exceptRoles' | 'sources', v: string): void {
    const d = this.draft();
    if (!d) return;
    const cur = d.scope[k] as string[];
    this.setScope(k, (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]) as never);
  }

  setMatch(k: RuleMatchDim, v: string[]): void {
    const d = this.draft();
    if (d) this.draft.set({ ...d, match: { ...d.match, [k]: v } });
  }

  save(): void {
    const d = this.draft();
    if (!d || this.errorCount()) return;
    this.saving.set(true);
    this.saveError.set(null);
    const call = d.id ? this.store.api.updateRule(d) : this.store.api.createRule(d);
    call.subscribe({
      next: (saved) => {
        const s = normalizeRule(saved ?? d);
        if (d.id) this.replace(s);
        else this.rules.set([...this.rules(), s]);
        this.store.rules.set(this.rules());
        this.startEdit(s);
        this.saving.set(false);
        this.global.sendAlert(`Regra "${s.name}" salva.`, 'OK');
      },
      error: (e) => {
        this.saving.set(false);
        this.saveError.set(apiErrorMessage(e, 'Não consegui salvar a regra.'));
      },
    });
  }

  remove(): void {
    const d = this.draft();
    if (!d?.id || d.builtin) return;
    this.dialog.open(ConfirmDialogComponent, {
      width: '420px',
      data: { title: 'Apagar a regra?', description: `"${d.name}" (${d.key}) deixa de valer para todos. Isso não pode ser desfeito.`, labelCancel: 'Cancelar', labelConfirm: 'Apagar' },
    }).afterClosed().subscribe((ok) => {
      if (!ok) return;
      this.store.api.deleteRule(d.id).subscribe({
        next: () => {
          this.rules.set(this.rules().filter((r) => r.id !== d.id));
          this.store.rules.set(this.rules());
          this.draft.set(null);
          this.global.sendAlert('Regra apagada.', 'OK');
        },
        error: (e) => this.saveError.set(apiErrorMessage(e, 'Não consegui apagar a regra.')),
      });
    });
  }

  private replace(r: GovernanceRule): void {
    this.rules.set(this.rules().map((x) => (x.id === r.id ? r : x)));
    this.store.rules.set(this.rules());
  }

  err(k: string): string | null {
    return this.errors()[k] ?? null;
  }

  dimCount(r: GovernanceRule): string {
    return RULE_MATCH_DIMS.filter((d) => r.match[d.key]?.length).map((d) => d.label.toLowerCase()).join(', ') || 'sem casamento';
  }

  scopeText(r: GovernanceRule): string {
    const s = r.scope;
    const parts: string[] = [];
    if (s.sources.length) parts.push(s.sources.map((x) => SOURCE_LABEL[x as GovSource] ?? x).join('/'));
    if (s.roles.length) parts.push(`papéis ${s.roles.join(', ')}`);
    if (s.users.length) parts.push(`${s.users.length} pessoa(s)`);
    if (s.cardTypes.length) parts.push(s.cardTypes.join(', '));
    if (s.exceptRoles.length) parts.push(`exceto ${s.exceptRoles.join(', ')}`);
    return parts.join(' · ') || 'todos';
  }

  effectOf(v: string): GovEffect {
    return v as GovEffect;
  }

  dt = formatDateTime;
}
