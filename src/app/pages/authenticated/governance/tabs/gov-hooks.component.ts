import { Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
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
  CLAUDE_HOOK_EVENTS, GovHookAction, GovernanceHook, HOOK_ACTIONS, HOOK_ACTION_LABEL, HOOK_EVENT_LABEL,
} from '../../../../services/governance/governance.model';
import {
  HOOK_CONFIG_KEYS, MASKED_SECRET, apiErrorMessage, newHook, slugify, validateHook,
} from '../../../../services/governance/governance.logic';
import { formatDateTime } from '../../../../services/usage/usage.model';
import { GovernanceStore } from '../governance.store';

interface KvRow {
  key: string;
  value: string;
}

/**
 * Hooks (0098): os do Claude Code que o instalador registra (SessionStart, PreToolUse…) e os gatilhos do servidor
 * (evento da trilha → Timeline/webhook). Lista com liga/desliga e editor (evento, matcher, ação, configuração).
 * Segredos vêm mascarados (`***`): mandar `***` de volta mantém o valor guardado.
 */
@Component({
  selector: 'app-gov-hooks',
  standalone: true,
  imports: [NgTemplateOutlet, FormsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatSlideToggleModule, MatTooltipModule],
  templateUrl: './gov-hooks.component.html',
  styleUrls: ['../governance-shared.css', './gov-editors.css'],
})
export class GovHooksComponent {
  readonly store = inject(GovernanceStore);
  private readonly dialog = inject(MatDialog);
  private readonly global = inject(GlobalService);

  readonly hooks = signal<GovernanceHook[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly draft = signal<GovernanceHook | null>(null);
  readonly kv = signal<KvRow[]>([]);
  private readonly original = signal('');
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  private keyTouched = false;

  readonly claudeHooks = computed(() => this.sorted().filter((h) => h.event.startsWith('claude:')));
  readonly serverHooks = computed(() => this.sorted().filter((h) => !h.event.startsWith('claude:')));
  private readonly sorted = computed(() => [...this.hooks()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'pt-BR')));

  /** Hook com a configuração montada a partir das linhas chave/valor. */
  readonly composed = computed<GovernanceHook | null>(() => {
    const d = this.draft();
    if (!d) return null;
    const config: Record<string, string> = {};
    for (const r of this.kv()) if (r.key.trim() || r.value) config[r.key.trim()] = r.value;
    return { ...d, config };
  });
  readonly isNew = computed(() => !!this.draft() && !this.draft()!.id);
  readonly dirty = computed(() => !!this.composed() && JSON.stringify(this.composed()) !== this.original());
  readonly errors = computed(() => {
    const h = this.composed();
    if (!h) return {};
    return validateHook(h, this.hooks().filter((x) => x.id !== h.id).map((x) => x.key));
  });
  readonly errorCount = computed(() => Object.keys(this.errors()).length);
  readonly isServer = computed(() => !!this.draft()?.event.startsWith('server:'));
  readonly configHints = computed(() => HOOK_CONFIG_KEYS[this.draft()?.action ?? 'record'] ?? []);

  readonly claudeEvents = CLAUDE_HOOK_EVENTS;
  readonly eventLabel = HOOK_EVENT_LABEL;
  readonly actions = HOOK_ACTIONS;
  readonly actionLabel = HOOK_ACTION_LABEL;
  readonly masked = MASKED_SECRET;

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.store.api.hooks().subscribe({
      next: (h) => {
        this.hooks.set((h ?? []).map((x) => ({ ...x, config: x.config ?? {} })));
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Não consegui carregar os hooks.');
      },
    });
  }

  // ---- lista ----

  edit(h: GovernanceHook): void {
    if (this.draft()?.id === h.id) return;
    this.guard(() => this.startEdit(structuredClone(h)));
  }

  create(server: boolean): void {
    this.guard(() => {
      const h = newHook(Math.max(0, ...this.hooks().map((x) => x.order)) + 10);
      if (server) {
        h.event = 'server:*';
        h.action = 'timeline';
        h.config = { template: '{user} {action} no card {card}' };
      }
      this.startEdit(h);
      this.keyTouched = false;
    });
  }

  private guard(then: () => void): void {
    if (!this.dirty()) return then();
    this.dialog.open(ConfirmDialogComponent, {
      width: '420px',
      data: { title: 'Descartar alterações?', description: 'O hook em edição tem alterações não salvas.', labelCancel: 'Continuar editando', labelConfirm: 'Descartar' },
    }).afterClosed().subscribe((ok) => ok && then());
  }

  private startEdit(h: GovernanceHook): void {
    this.keyTouched = !!h.id;
    this.draft.set({ ...h, config: { ...(h.config ?? {}) } });
    this.kv.set(Object.entries(h.config ?? {}).map(([key, value]) => ({ key, value })));
    this.original.set(JSON.stringify(this.composed()));
    this.saveError.set(null);
  }

  cancel(): void {
    this.guard(() => {
      this.draft.set(null);
      this.saveError.set(null);
    });
  }

  toggle(h: GovernanceHook, enabled: boolean): void {
    const next = { ...h, enabled };
    this.store.api.updateHook(next).subscribe({
      next: (saved) => {
        this.replace(saved ?? next);
        const d = this.draft();
        if (d?.id === h.id) {
          this.draft.set({ ...d, enabled });
          this.original.set(JSON.stringify({ ...JSON.parse(this.original()), enabled }));
        }
        this.global.sendAlert(`Hook "${h.name}" ${enabled ? 'ligado' : 'desligado'}.`, 'OK');
      },
      error: (e) => this.global.sendAlertError(apiErrorMessage(e, 'Não consegui alterar o hook.'), 'OK'),
    });
  }

  // ---- editor ----

  patch(p: Partial<GovernanceHook>): void {
    const d = this.draft();
    if (!d) return;
    const next = { ...d, ...p };
    if (p.name !== undefined && !d.id && !this.keyTouched) next.key = slugify(p.name);
    if (p.action && p.action !== d.action) this.ensureKeys(p.action);
    this.draft.set(next);
  }

  setKey(v: string): void {
    this.keyTouched = true;
    this.patch({ key: v.trim() });
  }

  /** Tipo do evento: Claude Code (lista fixa) ou servidor (glob da ação). */
  setEventKind(kind: 'claude' | 'server'): void {
    const d = this.draft();
    if (!d) return;
    if (kind === 'server' && !d.event.startsWith('server:')) this.patch({ event: 'server:*', action: d.action === 'evaluate' ? 'record' : d.action });
    if (kind === 'claude' && !d.event.startsWith('claude:')) this.patch({ event: 'claude:PostToolUse', action: 'record' });
  }

  serverGlob(): string {
    return this.draft()?.event.replace(/^server:/, '') ?? '';
  }

  setServerGlob(v: string): void {
    this.patch({ event: `server:${v}` });
  }

  private ensureKeys(action: GovHookAction): void {
    const have = new Set(this.kv().map((r) => r.key));
    const add = (HOOK_CONFIG_KEYS[action] ?? []).filter((k) => !have.has(k.key)).map((k) => ({ key: k.key, value: '' }));
    if (add.length) this.kv.set([...this.kv(), ...add]);
  }

  setKv(i: number, p: Partial<KvRow>): void {
    this.kv.set(this.kv().map((r, k) => (k === i ? { ...r, ...p } : r)));
  }

  addKv(): void {
    this.kv.set([...this.kv(), { key: '', value: '' }]);
  }

  removeKv(i: number): void {
    this.kv.set(this.kv().filter((_, k) => k !== i));
  }

  isSecret(key: string): boolean {
    return /secret|token|password|senha|key$/i.test(key);
  }

  hintOf(key: string): string | null {
    return this.configHints().find((k) => k.key === key)?.hint ?? null;
  }

  save(): void {
    const h = this.composed();
    if (!h || this.errorCount()) return;
    this.saving.set(true);
    this.saveError.set(null);
    const call = h.id ? this.store.api.updateHook(h) : this.store.api.createHook(h);
    call.subscribe({
      next: (saved) => {
        const s = { ...(saved ?? h), config: (saved ?? h).config ?? {} };
        if (h.id) this.replace(s);
        else this.hooks.set([...this.hooks(), s]);
        this.startEdit(s);
        this.saving.set(false);
        this.global.sendAlert(`Hook "${s.name}" salvo.`, 'OK');
      },
      error: (e) => {
        this.saving.set(false);
        this.saveError.set(apiErrorMessage(e, 'Não consegui salvar o hook.'));
      },
    });
  }

  remove(): void {
    const d = this.draft();
    if (!d?.id || d.builtin) return;
    this.dialog.open(ConfirmDialogComponent, {
      width: '420px',
      data: { title: 'Apagar o hook?', description: `"${d.name}" (${d.key}) deixa de rodar. Isso não pode ser desfeito.`, labelCancel: 'Cancelar', labelConfirm: 'Apagar' },
    }).afterClosed().subscribe((ok) => {
      if (!ok) return;
      this.store.api.deleteHook(d.id).subscribe({
        next: () => {
          this.hooks.set(this.hooks().filter((x) => x.id !== d.id));
          this.draft.set(null);
          this.global.sendAlert('Hook apagado.', 'OK');
        },
        error: (e) => this.saveError.set(apiErrorMessage(e, 'Não consegui apagar o hook.')),
      });
    });
  }

  private replace(h: GovernanceHook): void {
    this.hooks.set(this.hooks().map((x) => (x.id === h.id ? { ...h, config: h.config ?? {} } : x)));
  }

  err(k: string): string | null {
    return this.errors()[k] ?? null;
  }

  eventText(h: GovernanceHook): string {
    return HOOK_EVENT_LABEL[h.event] ?? (h.event.startsWith('server:') ? `Servidor: ação ${h.event.slice(7)}` : h.event);
  }

  actionText(h: GovernanceHook): string {
    return HOOK_ACTION_LABEL[h.action] ?? h.action;
  }

  actionOf(v: string): GovHookAction {
    return v as GovHookAction;
  }

  dt = formatDateTime;
}
