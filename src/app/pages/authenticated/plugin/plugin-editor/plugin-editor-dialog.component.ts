import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PluginData, PluginFieldSetting } from '../../../../interfaces/Plugin';
import { GdsService } from '../../../../services/gds.service';
import { GlobalService } from '../../../../services/global.service';

/** Mesma regra do backend (SensitiveFieldPolicy): segredo por palavra do nome — gravado criptografado para o usuário. */
const SENSITIVE_WORDS = new Set(['token', 'secret', 'password', 'passwd', 'pwd', 'apikey', 'pat', 'webhook']);
export function isSensitiveKey(key: string): boolean {
  const words = (key.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+/g) ?? []).map(w => w.toLowerCase());
  if (!words.length) return false;
  if (words.some(w => SENSITIVE_WORDS.has(w))) return true;
  if (words.some((w, i) => i < words.length - 1 && w + words[i + 1] === 'apikey')) return true;
  return words.length > 1 && words[words.length - 1] === 'key';
}

/** Um campo (chave) da configuração em edição. */
interface FieldEdit {
  key: string;
  value: string;
  /** Plugin pessoal: cada usuário preenche (true) ou fixo, com o valor daqui (false). */
  userFills: boolean;
  label: string;
  /** Campo do usuário obrigatório (o inverso de `optional` do modelo). */
  required: boolean;
  useGlobalDefault: boolean;
  hidden: boolean;
  /** Sugestões, uma por linha. */
  suggestions: string;
  help: string;
  /** Propriedades desconhecidas da configuração do campo — preservadas ao salvar. */
  extra: Record<string, unknown>;
  /** Editado em área de texto (valor longo/JSON na abertura, ou escolhido pelo admin). */
  multiline: boolean;
  open: boolean;
  isNew: boolean;
}

/**
 * Editor único de plugin (0032) — substitui os diálogos soltos (editar/URLs/autenticação/configurações). Aba Geral:
 * nome e comportamento; aba Campos: o valor de cada chave e, em plugin de uso pessoal, quem preenche, se é
 * obrigatório, padrão, oculto, sugestões (lista de escolha em Minhas integrações) e ajuda. Salva no mesmo modelo de
 * sempre (`configurations`, `personalFields`, `fieldSettings`) — nada muda para quem lê a configuração.
 */
@Component({
  selector: 'app-plugin-editor-dialog',
  standalone: true,
  imports: [FormsModule, TextFieldModule, MatDialogModule, MatButtonModule, MatButtonToggleModule, MatFormFieldModule,
    MatIconModule, MatInputModule, MatProgressBarModule, MatSlideToggleModule, MatTabsModule, MatTooltipModule],
  templateUrl: './plugin-editor-dialog.component.html',
  styleUrls: ['./plugin-editor-dialog.component.css'],
})
export class PluginEditorDialogComponent {
  private readonly data = inject<PluginData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<PluginEditorDialogComponent>);
  private readonly gds = inject(GdsService);
  private readonly global = inject(GlobalService);

  description = this.data.description ?? '';
  adminOnly = !!this.data.adminOnly;
  isPersonal = !!this.data.isPersonal;
  isOptional = !!this.data.isOptional;

  readonly fields = signal<FieldEdit[]>(this.buildFields());
  readonly filter = signal('');
  readonly saving = signal(false);
  newKey = '';

  /** Chaves removidas nesta edição (a configuração delas sai junto). */
  private removed = new Set<string>();

  readonly visible = computed(() => {
    const q = this.filter().trim().toLowerCase();
    const list = this.fields();
    return q ? list.filter(f => f.key.toLowerCase().includes(q) || f.label.toLowerCase().includes(q)) : list;
  });

  readonly userFieldCount = computed(() => this.fields().filter(f => f.userFills).length);

  touch(): void {
    // Zoneless: reavalia o template após editar um campo.
    this.fields.update(f => [...f]);
  }

  // ── Campos ──────────────────────────────────────────────────────────────────────────────────

  isSensitive(f: FieldEdit): boolean {
    return isSensitiveKey(f.key);
  }

  /** Valor longo, com quebra de linha ou JSON (ex.: regras das skills — 0030) é editado em área de texto. */
  private isMultilineValue(value: string): boolean {
    return value.length > 80 || value.includes('\n') || this.looksLikeJson(value);
  }

  toggleMultiline(f: FieldEdit): void {
    f.multiline = !f.multiline;
    this.touch();
  }

  jsonError(f: FieldEdit): string | null {
    if (!this.looksLikeJson(f.value)) return null;
    try {
      JSON.parse(f.value);
      return null;
    } catch (e: any) {
      return e?.message ?? 'formato inválido';
    }
  }

  hasErrors(): boolean {
    return !this.description.trim() || this.fields().some(f => this.jsonError(f) !== null);
  }

  newKeyError(): string | null {
    const k = this.newKey.trim();
    if (!k) return null;
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(k)) return 'Use só letras e números, começando por letra (ex.: ApiToken).';
    if (this.fields().some(f => f.key.toLowerCase() === k.toLowerCase())) return 'Já existe um campo com esse nome.';
    return null;
  }

  addField(): void {
    const key = this.newKey.trim();
    if (!key || this.newKeyError()) return;
    this.removed.delete(key.toLowerCase());
    this.fields.update(list => [...list, this.emptyField(key)]);
    this.newKey = '';
    this.filter.set('');
  }

  removeField(f: FieldEdit): void {
    this.removed.add(f.key.toLowerCase());
    this.fields.update(list => list.filter(x => x !== f));
  }

  valueLabel(f: FieldEdit): string {
    if (!this.isPersonal || !f.userFills) return 'Valor';
    if (this.isSensitive(f)) return 'Valor (não é mostrado ao usuário)';
    return !f.required && f.useGlobalDefault ? 'Valor padrão' : 'Valor sugerido ao usuário';
  }

  /** Resumo em uma linha (fechado): quem preenche, obrigatoriedade e extras. */
  badges(f: FieldEdit): string[] {
    const out: string[] = [];
    if (this.isPersonal) {
      if (f.userFills) {
        out.push(f.required ? 'Usuário · obrigatório' : 'Usuário · opcional');
        if (!f.required && f.useGlobalDefault) out.push('usa o valor como padrão');
        const n = this.suggestionList(f).length;
        if (n) out.push(n === 1 ? '1 sugestão' : `${n} sugestões`);
      } else {
        out.push(f.hidden ? 'Fixo · oculto' : 'Fixo');
      }
    }
    if (f.help.trim()) out.push('com ajuda');
    return out;
  }

  /** Prévia do que o usuário verá na lista de escolha: o valor daqui primeiro, depois as sugestões. */
  preview(f: FieldEdit): string[] {
    const all = [f.value.trim(), ...this.suggestionList(f)].filter(Boolean);
    return all.filter((s, i) => all.findIndex(x => x.toLowerCase() === s.toLowerCase()) === i);
  }

  private suggestionList(f: FieldEdit): string[] {
    return f.suggestions.split('\n').map(s => s.trim()).filter(Boolean);
  }

  // ── Salvar ──────────────────────────────────────────────────────────────────────────────────

  save(): void {
    if (this.hasErrors() || this.saving()) return;
    const list = this.fields();

    const configurations: Record<string, string> = {};
    for (const f of list) configurations[f.key] = f.value;

    // null = todos os campos são do usuário (modelo original) — mantido quando nada foi desmarcado.
    const allUser = list.every(f => f.userFills);
    const personalFields = !this.isPersonal
      ? (this.data.personalFields ?? null)
      : allUser && this.data.personalFields == null ? null : list.filter(f => f.userFills).map(f => f.key);

    this.saving.set(true);
    this.gds.putUpdatePluginConfiguration({
      ...this.data,
      description: this.description.trim(),
      adminOnly: this.adminOnly,
      isPersonal: this.isPersonal,
      isOptional: this.isPersonal && this.isOptional,
      configurations,
      personalFields,
      fieldSettings: this.buildFieldSettings(list),
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.global.sendAlert('Plugin salvo', 'Ok');
        this.dialogRef.close(true);
      },
      error: (e: any) => {
        this.saving.set(false);
        this.global.sendAlertError(e?.error?.error ?? 'Erro ao salvar o plugin', 'Ok');
      },
    });
  }

  close(): void {
    this.dialogRef.close(false);
  }

  /**
   * Configuração por campo: preserva o que já existia (inclusive chaves sem campo e propriedades desconhecidas) e
   * grava só o que tem conteúdo. Sem nada configurado e sem configuração anterior → null (mantém o modelo antigo).
   */
  private buildFieldSettings(list: FieldEdit[]): Record<string, PluginFieldSetting> | null {
    const original = this.data.fieldSettings ?? {};
    const result: Record<string, PluginFieldSetting> = {};
    for (const [key, value] of Object.entries(original)) {
      const inList = list.some(f => f.key.toLowerCase() === key.toLowerCase());
      if (!inList && !this.removed.has(key.toLowerCase())) result[key] = value;
    }
    for (const f of list) {
      const suggestions = this.suggestionList(f);
      const setting: PluginFieldSetting & Record<string, unknown> = {
        ...f.extra,
        label: f.label.trim() || null,
        optional: f.userFills && !f.required,
        useGlobalDefault: f.userFills && !f.required && f.useGlobalDefault,
        hidden: !f.userFills && f.hidden,
        suggestions: f.userFills && suggestions.length ? suggestions : null,
        help: f.help.trim() || null,
      };
      const meaningful = setting.label || setting.optional || setting.useGlobalDefault || setting.hidden
        || setting.suggestions || setting.help || Object.keys(f.extra).length;
      const existingKey = Object.keys(original).find(k => k.toLowerCase() === f.key.toLowerCase());
      if (meaningful || existingKey) result[existingKey ?? f.key] = setting;
    }
    return Object.keys(result).length || this.data.fieldSettings ? result : null;
  }

  private buildFields(): FieldEdit[] {
    const config = (this.data.configurations ?? {}) as unknown as Record<string, string>;
    const settings = this.data.fieldSettings ?? {};
    const personal = this.data.personalFields;
    return Object.keys(config).map(key => {
      const settingKey = Object.keys(settings).find(k => k.toLowerCase() === key.toLowerCase());
      const s = (settingKey ? settings[settingKey] : {}) as PluginFieldSetting & Record<string, unknown>;
      const { label, optional, useGlobalDefault, hidden, suggestions, help, ...extra } = s ?? {};
      return {
        key,
        value: `${config[key] ?? ''}`,
        userFills: !personal || personal.some(k => k.toLowerCase() === key.toLowerCase()),
        label: label ?? '',
        required: !optional,
        useGlobalDefault: !!useGlobalDefault,
        hidden: !!hidden,
        suggestions: (suggestions ?? []).join('\n'),
        help: help ?? '',
        extra,
        multiline: this.isMultilineValue(`${config[key] ?? ''}`),
        open: false,
        isNew: false,
      };
    });
  }

  private emptyField(key: string): FieldEdit {
    return {
      key, value: '', userFills: true, label: '', required: true, useGlobalDefault: false, hidden: false,
      suggestions: '', help: '', extra: {}, multiline: false, open: true, isNew: true,
    };
  }

  private looksLikeJson(value: string): boolean {
    const t = value.trim();
    return t.startsWith('{') || t.startsWith('[');
  }
}
