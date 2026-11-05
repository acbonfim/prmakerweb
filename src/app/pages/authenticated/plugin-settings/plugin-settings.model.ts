/**
 * Configurações por seção (0086) — tipos do contrato `GET/PATCH api/v1/PluginConfiguration/settings`
 * (features/0086/plan.md). O valor de toda chave trafega como a STRING gravada no plugin (JSON como texto).
 */

/** Tipo de editor de uma chave. */
export type SettingFieldType =
  | 'text' | 'textarea' | 'secret' | 'bool' | 'number' | 'enum' | 'list' | 'steps'
  | 'map' | 'table' | 'pattern' | 'prompt' | 'json';

/** Quem lê a chave. */
export type SettingReader = 'api' | 'skills' | 'front' | 'executor';

export interface SettingOption {
  value: string;
  label: string;
}

/** Variável aceita por um `pattern`/`prompt` (`{name}`), com o exemplo usado na prévia. */
export interface SettingVariable {
  name: string;
  description?: string | null;
  example?: string | null;
}

/** Tipo de uma coluna de `table`. */
export type SettingColumnType = 'text' | 'textarea' | 'number' | 'bool' | 'enum' | 'list';

export interface SettingColumn {
  key: string;
  label: string;
  type: SettingColumnType;
  required?: boolean;
  options?: SettingOption[] | null;
  /** enum: aceita valor fora da lista (acréscimo do FB ao contrato; ausente = só a lista + o valor atual). */
  allowCustom?: boolean;
  /** Largura sugerida da coluna. */
  width?: 'sm' | 'md' | 'lg' | string | null;
}

export interface SettingPersonal {
  userFills: boolean;
  required: boolean;
  useGlobalDefault: boolean;
}

export interface SettingField {
  /** `<pluginId>:<key>`; plugin inexistente → `<pluginName>:<key>`. */
  id: string;
  /** null = plugin não cadastrado (campo desabilitado). */
  pluginId: number | null;
  pluginName: string;
  key: string;
  label: string;
  help?: string | null;
  type: SettingFieldType;
  /** String gravada; null quando segredo ou chave inexistente. */
  value: string | null;
  hasValue: boolean;
  exists: boolean;
  /** Padrão de reserva do código (null = sem padrão). */
  default?: string | null;
  isDefault: boolean;
  options?: SettingOption[] | null;
  allowCustom?: boolean;
  min?: number | null;
  max?: number | null;
  unit?: string | null;
  listFormat?: 'csv' | 'json' | null;
  stepSources?: string[] | null;
  variables?: SettingVariable[] | null;
  columns?: SettingColumn[] | null;
  /** `table` cujo valor é OBJETO `{chave: {…}}`: nome da coluna que vira a chave. */
  rowKey?: string | null;
  mapKeyLabel?: string | null;
  mapValueLabel?: string | null;
  mapValueType?: 'text' | 'textarea' | 'list' | null;
  readBy?: SettingReader[];
  personal?: SettingPersonal | null;
  obsolete?: boolean;
  advanced?: boolean;
  multilineHint?: boolean;
  /** Só do front: chave fora do catálogo (área "Plugins (avançado)") — editada como texto, com "remover". */
  uncataloged?: boolean;
}

export interface SettingGroup {
  key: string;
  title: string;
  description?: string | null;
  fields: SettingField[];
}

export interface SettingSection {
  key: string;
  title: string;
  icon?: string | null;
  description?: string | null;
  groups: SettingGroup[];
}

export interface SettingPluginInfo {
  id: number;
  name: string;
  exists: boolean;
  isPersonal: boolean;
  isOptional: boolean;
  adminOnly: boolean;
  version: string;
}

export interface UncatalogedSetting {
  pluginId: number;
  pluginName: string;
  key: string;
  value: string | null;
  secret: boolean;
}

export interface SettingsCatalog {
  sections: SettingSection[];
  plugins: SettingPluginInfo[];
  uncataloged: UncatalogedSetting[];
  missingPlugins: string[];
}

/** Resposta do `GET settings` (mesmo que `SettingsCatalog`). */
export type SettingsResponse = SettingsCatalog;

export interface SettingChange {
  pluginId: number;
  key: string;
  value: string | null;
  /** Valor que a tela leu (null = a chave não existia). */
  expected: string | null;
  remove?: boolean;
}

export interface SettingsPatchRequest {
  changes: SettingChange[];
}

export interface SettingsPatchResponse {
  plugins: { id: number; version: string }[];
  fields: SettingField[];
}

export interface SettingConflict {
  id: string;
  key: string;
  pluginId: number;
  current: string | null;
  expected: string | null;
}

export interface SettingError {
  id: string;
  message: string;
}

/** Corpo do 409 do `PATCH settings` (nada foi gravado). */
export interface SettingsConflictResponse {
  conflicts: SettingConflict[];
}

/** Corpo do 400 do `PATCH settings` (validação por tipo). */
export interface SettingsErrorResponse {
  errors: SettingError[];
}

/** Resultado do salvar de uma seção (o serviço traduz 200/409/400). */
export type SettingsSaveResult =
  | { kind: 'ok'; response: SettingsPatchResponse }
  | { kind: 'conflict'; conflicts: SettingConflict[] }
  | { kind: 'invalid'; errors: SettingError[] };

/** Rótulo/ícone/explicação de quem lê a chave (ícones "lido por"). */
export const SETTING_READERS: Record<SettingReader, { label: string; icon: string; tooltip: string }> = {
  api: { label: 'API', icon: 'dns', tooltip: 'Lido pela API do PRMake' },
  skills: { label: 'Skills', icon: 'auto_awesome', tooltip: 'Lido pelas skills do Claude (via /Skills/config)' },
  front: { label: 'Front', icon: 'web', tooltip: 'Lido pelas telas do PRMake' },
  executor: { label: 'Executor', icon: 'smart_toy', tooltip: 'Lido pelo executor (prmake-agent)' },
};

export interface SettingHistoryEntry {
  pluginId: number;
  pluginName: string;
  key: string;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string | null;
  changedByName: string | null;
  changedAt: string;
}
