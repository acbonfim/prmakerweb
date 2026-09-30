import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { UserIntegration, UserIntegrationService } from '../../services/user-integration.service';
import { TEAMS_PLUGIN_NAME, TeamsService } from '../../services/teams.service';

/** Placeholder de um campo não sensível editável (0011: opcionais com padrão ou sugestão). */
export function fieldPlaceholder(field: { optional: boolean; defaultValue: string | null; hint: string | null }): string {
  if (!field.optional) return 'Obrigatório';
  if (field.defaultValue) return `Padrão: ${field.defaultValue}`;
  if (field.hint) return `Opcional — sugestão: ${field.hint}`;
  return 'Opcional';
}

/** Estado de edição de um campo no modal. */
interface FieldDraft {
  key: string;
  /** Nome amigável (0011) ou a própria chave. */
  label: string;
  /** Não obrigatório (0011). */
  optional: boolean;
  /** Valor global que vale enquanto o usuário não salvar (0011); null = sem padrão. */
  defaultValue: string | null;
  /** Sugestão do admin para campo opcional sem padrão (0011): mostrada, não preenchida. */
  hint: string | null;
  sensitive: boolean;
  /** Texto digitado (para sensível: vazio = manter o salvo). */
  value: string;
  /** Valor ao abrir/salvar — para saber se há alteração não salva (0032). */
  initial: string;
  hasSavedValue: boolean;
  suggested: boolean;
  /** Sensível marcado para limpar (envia ""). */
  clear: boolean;
  reveal: boolean;
  /** false = fixo, definido pelo administrador: somente leitura e nunca enviado. */
  editable: boolean;
  /** Lista de escolha (0032): valor global + sugestões do administrador. */
  suggestions: string[];
  /** Ajuda definida pelo administrador (0032). */
  help: string | null;
}

interface PluginDraft {
  integration: UserIntegration;
  /** Campos que o usuário preenche. */
  fields: FieldDraft[];
  /** Campos fixos, definidos pelo administrador (somente leitura). */
  fixed: FieldDraft[];
  saving: boolean;
  error: string | null;
  expanded: boolean;
  showFixed: boolean;
}

type IntegrationState = 'ok' | 'pending' | 'optional';

/**
 * "Minhas integrações" (spec 2; reorganizado na 0032): lista os plugins de uso pessoal com os mesmos campos
 * cadastrados pelo admin; o usuário preenche os próprios valores. Pendentes aparecem primeiro e abertas; os campos
 * fixos ficam recolhidos; cada campo pode ter ajuda e uma lista de escolha com as sugestões do admin (0032).
 * Segredos nunca voltam do backend: mostram "salvo" e só são enviados quando o usuário digita um novo valor
 * (ou pede para limpar).
 */
@Component({
  selector: 'app-my-integrations-dialog',
  standalone: true,
  imports: [FormsModule, MatAutocompleteModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule,
    MatInputModule, MatProgressSpinnerModule, MatTooltipModule],
  templateUrl: './my-integrations-dialog.component.html',
  styleUrls: ['./my-integrations-dialog.component.css'],
})
export class MyIntegrationsDialogComponent implements OnInit {
  private service = inject(UserIntegrationService);
  private snackBar = inject(MatSnackBar);
  private teams = inject(TeamsService);
  readonly dialogRef = inject(MatDialogRef<MyIntegrationsDialogComponent>);

  readonly drafts = signal<PluginDraft[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

  /** Resumo do topo: obrigatórias configuradas / total de obrigatórias, e opcionais configuradas. */
  readonly summary = computed(() => {
    const list = this.drafts().map(d => d.integration);
    const required = list.filter(i => !i.optional);
    const optional = list.filter(i => i.optional);
    return {
      required: required.length,
      requiredDone: required.filter(i => i.configured).length,
      optional: optional.length,
      optionalDone: optional.filter(i => i.configured).length,
    };
  });

  readonly progress = computed(() => {
    const s = this.summary();
    const total = s.required + s.optional;
    return total ? Math.round(((s.requiredDone + s.optionalDone) / total) * 100) : 100;
  });

  async ngOnInit(): Promise<void> {
    try {
      const list = await this.service.loadIntegrations();
      const drafts = list.map(i => this.toDraft(i));
      // Pendentes (obrigatórias) primeiro, depois opcionais sem configurar, depois as prontas.
      const rank = (d: PluginDraft) => ({ pending: 0, optional: 1, ok: 2 }[this.state(d)]);
      drafts.sort((a, b) => rank(a) - rank(b));
      // Abre as que pedem ação; com uma só integração, abre sempre.
      drafts.forEach(d => (d.expanded = drafts.length === 1 || this.state(d) === 'pending'));
      if (!drafts.some(d => d.expanded) && drafts.length) drafts[0].expanded = true;
      this.drafts.set(drafts);
    } catch (e: any) {
      this.loadError.set(e?.error?.error ?? 'Não foi possível carregar suas integrações.');
    } finally {
      this.loading.set(false);
    }
  }

  state(draft: PluginDraft): IntegrationState {
    if (draft.integration.configured) return 'ok';
    return draft.integration.optional ? 'optional' : 'pending';
  }

  toggle(draft: PluginDraft): void {
    draft.expanded = !draft.expanded;
    this.touch();
  }

  toggleFixed(draft: PluginDraft): void {
    draft.showFixed = !draft.showFixed;
    this.touch();
  }

  /** Campos do usuário ainda vazios e obrigatórios (para o resumo do cabeçalho). */
  missing(draft: PluginDraft): number {
    return draft.fields.filter(f => !f.optional && !(f.value.trim() || (f.sensitive && f.hasSavedValue && !f.clear))).length;
  }

  isDirty(draft: PluginDraft): boolean {
    return draft.fields.some(f => f.clear || f.value !== f.initial);
  }

  readonly anyDirty = computed(() => this.drafts().some(d => this.isDirty(d)));

  /** Pode salvar parcialmente; o status (Configurado/Pendente) mostra se ainda falta algo. */
  canSave(draft: PluginDraft): boolean {
    return !draft.saving;
  }

  toggleClear(field: FieldDraft): void {
    field.clear = !field.clear;
    if (field.clear) field.value = '';
    this.touch();
  }

  /** Opções da lista de escolha: todas quando vazio ou igual a uma delas; senão, as que contêm o texto. */
  options(field: FieldDraft): string[] {
    const q = field.value.trim().toLowerCase();
    if (!q || field.suggestions.some(s => s.toLowerCase() === q)) return field.suggestions;
    return field.suggestions.filter(s => s.toLowerCase().includes(q));
  }

  touch(): void {
    // Zoneless: força a reavaliação do template após editar um campo do rascunho.
    this.drafts.update(d => [...d]);
  }

  discard(draft: PluginDraft): void {
    for (const f of draft.fields) {
      f.value = f.initial;
      f.clear = false;
    }
    draft.error = null;
    this.touch();
  }

  async save(draft: PluginDraft): Promise<void> {
    if (!this.canSave(draft)) return;

    const values: Record<string, string | null> = {};
    for (const f of draft.fields) {
      if (f.sensitive) {
        if (f.clear) values[f.key] = '';
        else if (f.value.trim()) values[f.key] = f.value.trim();
        // senão: omitido = mantém o valor salvo
      } else {
        values[f.key] = f.value.trim();
      }
    }

    draft.saving = true;
    draft.error = null;
    this.touch();
    try {
      const saved = await this.service.save(draft.integration.pluginId, values);
      this.drafts.update(list => list.map(d => (d === draft
        ? { ...this.toDraft(saved), expanded: !saved.configured || draft.expanded, showFixed: draft.showFixed }
        : d)));
      this.snackBar.open(`${saved.description}: integração salva`, 'Ok',
        { horizontalPosition: 'right', verticalPosition: 'top', duration: 4000 });
      // Habilita/desabilita o "Pedir aprovação" na hora (0007).
      if (saved.description === TEAMS_PLUGIN_NAME) void this.teams.loadStatus();
    } catch (e: any) {
      draft.saving = false;
      draft.error = e?.error?.error ?? 'Não foi possível salvar. Tente novamente.';
      this.touch();
    }
  }

  readonly placeholder = fieldPlaceholder;

  close(): void {
    this.dialogRef.close();
  }

  /** Plugin do Teams (0007): mostra o passo a passo para gerar a URL do Workflow. */
  isTeams(draft: PluginDraft): boolean {
    return draft.integration.description === TEAMS_PLUGIN_NAME;
  }

  /** Nome do grupo definido pelo admin (campo fixo GroupName). */
  teamsGroup(draft: PluginDraft): string {
    return draft.integration.fields.find(f => f.key === 'GroupName')?.value?.trim() ?? '';
  }

  private toDraft(integration: UserIntegration): PluginDraft {
    // Campos fixos ocultos (0011, ex.: prompts longos) não aparecem para o usuário.
    const all = integration.fields.filter(f => !f.hidden).map(f => {
      // Opcionais (0011) não vêm preenchidos com a sugestão: com padrão, vale o global enquanto
      // o campo estiver vazio; sem padrão (ex.: estimativa inicial), só vale o que o usuário salvar.
      const optionalUnsaved = !!f.optional && !f.hasValue && !f.sensitive;
      const value = f.sensitive || optionalUnsaved ? '' : (f.value ?? '');
      return {
        key: f.key,
        label: f.label?.trim() || f.key,
        optional: !!f.optional,
        defaultValue: optionalUnsaved && f.usesGlobalDefault ? (f.value ?? null) : null,
        hint: optionalUnsaved && !f.usesGlobalDefault ? (f.value ?? null) : null,
        sensitive: f.sensitive,
        value,
        // Sugestão pré-preenchida (obrigatório não salvo) conta como alteração: ainda precisa salvar.
        initial: f.suggested && !f.hasValue ? '' : value,
        hasSavedValue: f.hasValue,
        suggested: f.suggested,
        clear: false,
        reveal: false,
        editable: f.editable !== false,
        suggestions: f.sensitive ? [] : (f.suggestions ?? []),
        help: f.help?.trim() || null,
      } satisfies FieldDraft;
    });
    return {
      integration,
      saving: false,
      error: null,
      expanded: false,
      showFixed: false,
      fields: all.filter(f => f.editable),
      fixed: all.filter(f => !f.editable),
    };
  }
}
