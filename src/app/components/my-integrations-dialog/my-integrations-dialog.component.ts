import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
  hasSavedValue: boolean;
  suggested: boolean;
  /** Sensível marcado para limpar (envia ""). */
  clear: boolean;
  reveal: boolean;
  /** false = fixo, definido pelo administrador: somente leitura e nunca enviado. */
  editable: boolean;
}

interface PluginDraft {
  integration: UserIntegration;
  fields: FieldDraft[];
  saving: boolean;
  error: string | null;
}

/**
 * "Minhas integrações" (spec 2): lista os plugins de uso pessoal com os mesmos campos cadastrados
 * pelo admin; o usuário preenche os próprios valores. Segredos nunca voltam do backend: mostram
 * "salvo" e só são enviados quando o usuário digita um novo valor (ou pede para limpar).
 */
@Component({
  selector: 'app-my-integrations-dialog',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule,
    MatProgressSpinnerModule, MatTooltipModule],
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

  async ngOnInit(): Promise<void> {
    try {
      const list = await this.service.loadIntegrations();
      this.drafts.set(list.map(i => this.toDraft(i)));
    } catch (e: any) {
      this.loadError.set(e?.error?.error ?? 'Não foi possível carregar suas integrações.');
    } finally {
      this.loading.set(false);
    }
  }

  /** Pode salvar parcialmente; o status (Configurado/Pendente) mostra se ainda falta algo. */
  canSave(draft: PluginDraft): boolean {
    return !draft.saving;
  }

  toggleClear(field: FieldDraft): void {
    field.clear = !field.clear;
    if (field.clear) field.value = '';
    this.touch();
  }

  touch(): void {
    // Zoneless: força a reavaliação do template após editar um campo do rascunho.
    this.drafts.update(d => [...d]);
  }

  async save(draft: PluginDraft): Promise<void> {
    if (!this.canSave(draft)) return;

    const values: Record<string, string | null> = {};
    for (const f of draft.fields) {
      if (!f.editable) continue; // fixo: definido pelo administrador
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
      this.drafts.update(list => list.map(d => (d === draft ? this.toDraft(saved) : d)));
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
    return {
      integration,
      saving: false,
      error: null,
      // Campos fixos ocultos (0011, ex.: prompts longos) não aparecem para o usuário.
      fields: integration.fields.filter(f => !f.hidden).map(f => {
        // Opcionais (0011) não vêm preenchidos com a sugestão: com padrão, vale o global enquanto
        // o campo estiver vazio; sem padrão (ex.: estimativa inicial), só vale o que o usuário salvar.
        const optionalUnsaved = !!f.optional && !f.hasValue && !f.sensitive;
        return {
          key: f.key,
          label: f.label?.trim() || f.key,
          optional: !!f.optional,
          defaultValue: optionalUnsaved && f.usesGlobalDefault ? (f.value ?? null) : null,
          hint: optionalUnsaved && !f.usesGlobalDefault ? (f.value ?? null) : null,
          sensitive: f.sensitive,
          value: f.sensitive || optionalUnsaved ? '' : (f.value ?? ''),
          hasSavedValue: f.hasValue,
          suggested: f.suggested,
          clear: false,
          reveal: false,
          editable: f.editable !== false,
        };
      }),
    };
  }
}
