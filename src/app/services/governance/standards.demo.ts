import { Standard, StandardCheck, StandardModuleOption, STANDARDS_WIKI_URL } from './governance.model';
import { normalizeStandard } from './standards.logic';

/**
 * Padrões de demonstração (0101, `?exemplo=1`): um recorte da wiki "Data Nomenclature and Rules" v2.0 (página 236,
 * cópia em `features/0101/wiki/`), com os textos reais EN/PT, mais padrões de aplicação gerados da engenharia reversa.
 * A "reimportação" da wiki traz itens que faltam aqui (novos), dois textos alterados e um item que saiu.
 */

const WIKI_PAGES: Record<string, number> = {
  general: 236, column: 236, query: 236, schema: 236, check: 1217, default: 1216, fk: 258, index: 263, pk: 261, procedure: 265,
  table: 267, 'unique-index': 1215, view: 264,
};
const wikiUrl = (topic: string) => STANDARDS_WIKI_URL.replace(/\/236$/, `/${WIKI_PAGES[topic] ?? 236}`);

/** Conferências por regex que dá para mostrar no navegador (a real roda no backend, com as embutidas). */
const CHECKS: Record<string, Partial<StandardCheck>> = {
  G4: { kind: 'regex', target: 'sql', pattern: '\\bDF__\\w+__', hint: 'Nome gerado pelo sistema: nomeie a constraint (DF_[schema]_[Tabela]_[Coluna]).' },
  G6: { kind: 'regex', target: 'sql', pattern: '\\bCREATE\\s+TABLE\\s+(?![\\[\\w]+\\]?\\.)\\[?\\w+', hint: 'Crie a tabela com o schema do módulo (ex.: language.Language).' },
  G7: { kind: 'regex', target: 'migration', pattern: 'DeleteBehavior\\.Cascade', hint: 'Use DeleteBehavior.NoAction/Restrict e nomeie constraints e índices (HasName/HasDatabaseName).' },
  N4: { kind: 'regex', target: 'sql', pattern: '\\bCREATE\\s+TABLE\\s+(\\[?\\w+\\]?\\.)?\\[?\\w*_\\w*', hint: 'Sem subscrito no nome da tabela (ActionPlan, não Action_Plan).' },
  N14: { kind: 'regex', target: 'sql', pattern: '\\bCREATE\\s+(OR\\s+ALTER\\s+)?PROC(EDURE)?\\s+(\\[?\\w+\\]?\\.)?\\[?sp_?', hint: 'Procedure com prefixo pr (language.prStandardLanguage), nunca sp/sp_.' },
  C1: { kind: 'regex', target: 'sql', pattern: '\\bSELECT\\s+(TOP\\s*\\(?\\d+\\)?\\s+)?\\*', hint: 'Liste só as colunas usadas.' },
  C2: { kind: 'regex', target: 'sql', pattern: '\\b(SMALL)?MONEY\\b', hint: 'Use DECIMAL(p, s) — ex.: Amount DECIMAL(19, 4).' },
  FK3: { kind: 'builtin', target: 'sql', pattern: 'fk-name', hint: 'Nome esperado: FK_[schema]_[Tabela]_[Coluna].' },
  FK5: { kind: 'regex', target: 'sql', pattern: '\\bON\\s+DELETE\\s+CASCADE\\b', hint: 'Sem ON DELETE CASCADE: exclua os filhos explicitamente.' },
  FK6: { kind: 'regex', target: 'sql', pattern: '\\bON\\s+UPDATE\\s+CASCADE\\b', hint: 'Sem ON UPDATE CASCADE.' },
  FK7: {
    kind: 'sql', target: 'sql', hint: 'Crie o índice de suporte IX_[schema]_[Tabela]_NN com as colunas da FK na frente.',
    sql: `-- FKs sem índice de suporte (as colunas da FK devem ser as colunas iniciais de algum índice)
SELECT SCHEMA_NAME(t.schema_id) AS SchemaName, t.name AS TableName, fk.name AS FkName
  FROM sys.foreign_keys AS fk
  JOIN sys.tables       AS t ON t.object_id = fk.parent_object_id
 WHERE SCHEMA_NAME(t.schema_id) <> 'dbo'
   AND NOT EXISTS (SELECT 1 FROM sys.index_columns AS ic
                    JOIN sys.foreign_key_columns AS fkc ON fkc.parent_object_id = ic.object_id AND fkc.parent_column_id = ic.column_id
                   WHERE fkc.constraint_object_id = fk.object_id AND ic.key_ordinal = 1)
 ORDER BY SchemaName, TableName, FkName;`,
  },
  IX3: { kind: 'regex', target: 'sql', pattern: '\\bCREATE\\s+(NONCLUSTERED\\s+|CLUSTERED\\s+)?INDEX\\s+(?!IX_\\w+_\\d{2}\\b)\\[?\\w+', hint: 'Nome esperado: IX_[schema]_[Tabela]_NN (sem colunas).' },
  PK10: { kind: 'regex', target: 'sql', pattern: '\\bPRIMARY\\s+KEY(?!\\s+(NONCLUSTERED|CLUSTERED)\\b)', hint: 'Declare nome e tipo: CONSTRAINT PK_[schema]_[Tabela] PRIMARY KEY CLUSTERED (…).' },
  IXU1: { kind: 'regex', target: 'sql', pattern: '\\bCREATE\\s+UNIQUE\\s+(NONCLUSTERED\\s+|CLUSTERED\\s+)?INDEX\\s+(?!IXU_)\\[?\\w+', hint: 'Nome esperado: IXU_[schema]_[Tabela]_NN.' },
  V2: { kind: 'regex', target: 'sql', pattern: '\\bCREATE\\s+(OR\\s+ALTER\\s+)?VIEW\\s+(\\[?\\w+\\]?\\.)?\\[?(?!vw)\\w', hint: 'View com prefixo vw (language.vwStandardLanguage).' },
};

/** Item (NEW) da wiki → proposto (aguarda o DBA); os demais vigentes. Tudo começa em monitorar. */
function w(code: string, topic: string, isNew: boolean, title: string, en: string, pt: string, good: string[], bad: string[]): Standard {
  return normalizeStandard({
    id: `st-db-${code.toLowerCase()}`, key: `db-${code.toLowerCase()}`, code, area: 'database', topic, title, textPt: pt, textEn: en,
    examples: { good, bad },
    appliesTo: { platforms: ['sqlserver'], repositories: [], modules: [], objects: ['new', 'migrated'] },
    source: { kind: 'wiki', ref: code, version: '2.0', url: wikiUrl(topic) },
    status: isNew ? 'proposed' : 'active', effect: 'monitor',
    check: { kind: 'none', target: null, pattern: null, mustMatch: false, sql: null, ...(CHECKS[code] ?? {}) },
    updatedAt: '2026-11-24T10:05:00', updatedBy: 'Importação da wiki',
  });
}

/** Exemplos de DDL certo/errado para os itens que a wiki mostra em bloco de código. */
const DDL: Record<string, { good: string[]; bad: string[] }> = {
  FK5: {
    good: ['ALTER TABLE language.StandardLanguage WITH CHECK\n  ADD CONSTRAINT FK_language_StandardLanguage_LanguageId\n      FOREIGN KEY (LanguageId) REFERENCES language.Language (LanguageId);'],
    bad: ['ALTER TABLE language.StandardLanguage\n  ADD CONSTRAINT FK_language_StandardLanguage_LanguageId\n      FOREIGN KEY (LanguageId) REFERENCES language.Language (LanguageId) ON DELETE CASCADE;'],
  },
  FK7: {
    good: ['CREATE NONCLUSTERED INDEX IX_language_StandardLanguage_01\n    ON language.StandardLanguage (LanguageId);'],
    bad: ['-- FK criada sem índice de suporte: DELETE na tabela pai varre a filha\nALTER TABLE language.StandardLanguage ADD CONSTRAINT FK_language_StandardLanguage_LanguageId\n  FOREIGN KEY (LanguageId) REFERENCES language.Language (LanguageId);'],
  },
  C2: { good: ['Amount DECIMAL(19, 4)'], bad: ['Amount MONEY'] },
  N14: { good: ['CREATE PROCEDURE language.prStandardLanguage'], bad: ['CREATE PROCEDURE language.spStandardLanguage', 'CREATE PROCEDURE actionPlan.sp_ListActionPlan'] },
  IX3: { good: ['CREATE NONCLUSTERED INDEX IX_alert_Alert_01 ON alert.Alert (SiteId, CreateDate);'], bad: ['CREATE INDEX IX_Alert_SiteId ON alert.Alert (SiteId);'] },
  PK10: { good: ['CONSTRAINT PK_language_Language PRIMARY KEY CLUSTERED (LanguageId)'], bad: ['PRIMARY KEY (LanguageId)', 'CONSTRAINT PK_Language_LanguageId PRIMARY KEY (LanguageId)'] },
  G7: { good: ['.OnDelete(DeleteBehavior.NoAction)', 'entity.HasIndex(x => x.LanguageId).HasDatabaseName("IX_language_StandardLanguage_01");'], bad: ['.OnDelete(DeleteBehavior.Cascade)'] },
};

const ALL: Standard[] = [
  w("G1", "general", false, "Nomes de objetos em PascalCase", "Object names use **PascalCase** (each word starts with an uppercase letter) and follow the naming rules in section 4.", "Nomes de objetos usam **PascalCase** (cada palavra começa com letra maiúscula) e seguem as regras de nomenclatura da seção 4.", [], []),
  w("G3", "general", false, "Constraints e índices com prefixo + separador _", "Constraint and index names use the prefix + `_` separator: `PREFIX_[schema]_[Table]_[...]`.", "Nomes de constraints e índices usam prefixo + separador `_`: `PREFIXO_[schema]_[Tabela]_[...]`.", [], []),
  w("G4", "general", true, "Sempre nomear as constraints explicitamente", "**Always name constraints explicitly.** System-generated names (e.g. `DF__Language__IsAct__3A81B327`) are forbidden: they differ between environments and break migration scripts.", "**Sempre nomear as constraints explicitamente.** Nomes gerados pelo sistema (ex.: `DF__Language__IsAct__3A81B327`) são proibidos: mudam entre ambientes e quebram os scripts de migração.", [], []),
  w("G6", "general", true, "Sempre referenciar os objetos com o schema (language.Language, nunca apenas Language)", "Always reference objects with the schema (`language.Language`, never just `Language`).", "Sempre referenciar os objetos com o schema (`language.Language`, nunca apenas `Language`).", [], []),
  w("G7", "general", true, "Migrations do EF Core devem seguir este padrão", "**EF Core migrations** must follow this standard: set constraint and index names explicitly (`HasName`, `HasDatabaseName`, `HasConstraintName`) and use `DeleteBehavior.NoAction`/`Restrict`. EF defaults generate names such as `IX_Table_Column`, unnamed defaults and `ON DELETE CASCADE`.", "**Migrations do EF Core** devem seguir este padrão: definir explicitamente os nomes de constraints e índices (`HasName`, `HasDatabaseName`, `HasConstraintName`) e usar `DeleteBehavior.NoAction`/`Restrict`. Os padrões do EF geram nomes como `IX_Tabela_Coluna`, defaults sem nome e `ON DELETE CASCADE`.", [], []),
  w("G8", "general", true, "Os scripts de validação ignoram o schema dbo (legado) e a tabela do EF __EFMigrationHistory", "Validation scripts ignore the `dbo` schema (legacy) and the EF table `__EFMigrationHistory`.", "Os scripts de validação ignoram o schema `dbo` (legado) e a tabela do EF `__EFMigrationHistory`.", [], []),
  w("N1", "column", false, "Não utilizar espaço em branco no meio do nome", "Do not use white space in the middle of the name.", "Não utilizar espaço em branco no meio do nome.", ["CreateDate"], ["Create Date"]),
  w("N2", "column", false, "Não utilizar caracteres com acentos", "Do not use characters with accents.", "Não utilizar caracteres com acentos.", ["Description"], ["Descrição"]),
  w("N4", "column", false, "Não utilizar subscrito (_)", "Do not use underscore (`_`). **Exception:** the separator in constraint and index names (`PK_`, `FK_`, `IX_`, `IXU_`, `DF_`, `CK_`).", "Não utilizar subscrito (`_`). **Exceção:** o separador nos nomes de constraints e índices (`PK_`, `FK_`, `IX_`, `IXU_`, `DF_`, `CK_`).", ["ActionPlan"], ["Action_Plan"]),
  w("N5", "column", false, "Não utilizar palavras reservadas do SQL Server", "Do not use SQL Server reserved words. If the word is needed, use a compound word.", "Não utilizar palavras reservadas do SQL Server. Se precisar utilizar a palavra, utilizar palavra composta.", ["SystemUser", "PurchaseOrder", "AccessKey"], ["User", "Order", "Key"]),
  w("N8", "column", false, "Utilizar palavras no singular", "Use words in the singular.", "Utilizar palavras no singular.", ["Language", "ActionPlan"], ["Languages", "ActionPlans"]),
  w("N10", "column", false, "Utilizar o idioma inglês", "Use the English language.", "Utilizar o idioma inglês.", ["Area", "Department"], ["Setor", "Departamento"]),
  w("N12", "column", false, "Não utilizar Id sozinho, sem significado", "Do not use `Id` alone, without meaning: the column name says which entity it identifies.", "Não utilizar `Id` sozinho, sem significado: o nome da coluna diz qual entidade ela identifica.", ["LanguageId", "ActionPlanId"], ["Id"]),
  w("N13", "column", false, "Não usar preposição gramatical (lista abaixo)", "Do not use grammatical prepositions (list below).", "Não usar preposição gramatical (lista abaixo).", ["CreateDate"], ["DateOfCreation", "DeleteUserId", "DeletedByUserId"]),
  w("N14", "column", false, "Não usar SP / sp_ para identificar procedures", "Do not use `SP` / `sp_` to identify procedures: this prefix is used by SQL Server system procedures. Use `pr` (see [Procedure (Procedure)](https://dev.azure.com/solvacelabs/Solvace%20Product%20Improvement/_wiki/wikis/Solvace-Product-Improvement.wiki/265)).", "Não usar `SP` / `sp_` para identificar procedures: esse prefixo é usado pelas procedures de sistema do SQL Server. Usar `pr` (ver [Procedure (Procedure)](https://dev.azure.com/solvacelabs/Solvace%20Product%20Improvement/_wiki/wikis/Solvace-Product-Improvement.wiki/265)).", ["language.prStandardLanguage"], ["spStandardLanguage"]),
  w("C1", "query", false, "Não utilizar SELECT * em consultas", "In queries, do not use `SELECT * FROM ...`: list only the columns that will be used.", "Em consultas, não utilizar `SELECT * FROM ...`: listar somente as colunas que serão utilizadas.", ["SELECT LanguageId, Name FROM language.Language;"], []),
  w("C2", "query", false, "Não utilizar os tipos monetários MONEY / SMALLMONEY em colunas", "Do not use the currency types `MONEY` / `SMALLMONEY` for columns. Use `DECIMAL(p, s)` with the precision the business needs.", "Não utilizar os tipos monetários `MONEY` / `SMALLMONEY` em colunas. Utilizar `DECIMAL(p, s)` com a precisão que o negócio exige.", ["Amount DECIMAL(19, 4)"], []),
  w("S1", "schema", false, "Schema de nome único todo em minúsculo", "**Single word:** always all lowercase. Ex.: `language`, `alert`, `rca`.", "**Nome único:** sempre todo em minúsculo. Ex.: `language`, `alert`, `rca`.", [], []),
  w("S2", "schema", false, "Schema composto em camelCase", "**Compound name:** the first word all lowercase; from the second word on, use PascalCase (each word starts with an uppercase letter). Ex.: `actionPlan`, `behaviorObservation`, `customField`.", "**Nome composto:** a primeira palavra toda em minúsculo; a partir da segunda palavra, usar PascalCase (cada palavra começa com letra maiúscula). Ex.: `actionPlan`, `behaviorObservation`, `customField`.", [], []),
  w("S5", "schema", false, "Objetos legados não migrados permanecem no dbo", "Legacy objects not yet migrated stay in `dbo`. Do not create new objects in `dbo`.", "Objetos legados não migrados permanecem no `dbo`. Não criar objetos novos no `dbo`.", [], []),
  w("R1", "general", true, "Toda tabela deve ter chave primária", "Every table must have a primary key.", "Toda tabela deve ter chave primária.", [], []),
  w("R5", "general", false, "Sem CASCADE nas chaves estrangeiras", "Do not use `ON DELETE CASCADE` on foreign keys (**(NEW)** also `ON UPDATE CASCADE`).", "Não utilizar `ON DELETE CASCADE` nas chaves estrangeiras (**(NOVO)** nem `ON UPDATE CASCADE`).", [], []),
  w("CK1", "check", false, "Nome do check: CK + schema + tabela + coluna", "The name is `CK` (uppercase) + schema + table name + column name, separated by underscore.", "O nome é composto por `CK` (maiúscula) + schema + nome da tabela + nome da coluna, separados por subscrito.", [], []),
  w("CK3", "check", false, "Sempre nomear a constraint explicitamente", "Always name the constraint explicitly: no system-generated names.", "Sempre nomear a constraint explicitamente: sem nomes gerados pelo sistema.", [], []),
  w("DF1", "default", false, "Nome do default: DF + schema + tabela + coluna", "The name is `DF` (uppercase) + schema + table name + column name, separated by underscore.", "O nome é composto por `DF` (maiúscula) + schema + nome da tabela + nome da coluna, separados por subscrito.", [], []),
  w("DF2", "default", false, "Sempre nomear o default explicitamente", "**Always name the default explicitly.** Without a name, SQL Server generates one (e.g. `DF__Language__IsAct__3A81B327`) that is different in each environment, so `DROP CONSTRAINT` scripts fail.", "**Sempre nomear o default explicitamente.** Sem nome, o SQL Server gera um (ex.: `DF__Language__IsAct__3A81B327`) diferente em cada ambiente, e os scripts de `DROP CONSTRAINT` falham.", [], []),
  w("DF5", "default", false, "Migrations do EF Core (HasDefaultValue / HasDefaultValueSql) criam defaults sem nome", "EF Core migrations (`HasDefaultValue` / `HasDefaultValueSql`) create defaults **without a name**. Name them in the migration (custom SQL) or rename them afterwards with the script below.", "Migrations do EF Core (`HasDefaultValue` / `HasDefaultValueSql`) criam defaults **sem nome**. Nomear na migration (SQL customizado) ou renomear depois com o script abaixo.", [], []),
  w("FK3", "fk", false, "Nome da FK: FK + schema + tabela de origem + coluna", "The name is `FK` + schema + table + column, using the **origin (child) table only**. The referenced table is not part of the name.", "O nome é composto por `FK` + schema + tabela + coluna, usando **somente a tabela de origem (filha)**. A tabela de referência não entra no nome.", [], []),
  w("FK5", "fk", false, "Não utilizar ON DELETE CASCADE", "Do not use `ON DELETE CASCADE`.", "Não utilizar `ON DELETE CASCADE`.", [], []),
  w("FK6", "fk", true, "Também não utilizar ON UPDATE CASCADE", "Do not use `ON UPDATE CASCADE` either. Deletes and updates of child rows are done explicitly by the application or the procedure.", "Também não utilizar `ON UPDATE CASCADE`. Exclusões e alterações nos registros filhos são feitas explicitamente pela aplicação ou pela procedure.", [], []),
  w("FK7", "fk", true, "Toda FK deve ter um índice de suporte", "Every FK must have a supporting index whose **leading key columns** are the FK columns. Without it, every DELETE/UPDATE on the parent table scans the child table and holds locks.", "Toda FK deve ter um índice de suporte cujas **colunas iniciais da chave** sejam as colunas da FK. Sem ele, todo DELETE/UPDATE na tabela pai varre a tabela filha e mantém bloqueios.", [], []),
  w("FK10", "fk", true, "A coluna da FK tem exatamente o mesmo tipo de dado da coluna referenciada", "The FK column has exactly the same data type as the referenced column.", "A coluna da FK tem exatamente o mesmo tipo de dado da coluna referenciada.", [], []),
  // ↓ fora do catálogo de exemplo: entram pela importação da wiki
  w("IX3", "index", false, "Nome do índice: IX + schema + tabela + sequencial de dois dígitos", "The name is `IX` + schema + table name + a two-digit sequence number, starting at `01` and adding 1 for each new index on the table.", "O nome é composto por `IX` + schema + nome da tabela + numeral sequencial de dois dígitos, iniciando em `01` e somando 1 a cada novo índice da tabela.", [], []),
  w("IX4", "index", false, "Não acrescentar o nome da(s) coluna(s) no nome do índice", "Do not add column names to the index name.", "Não acrescentar o nome da(s) coluna(s) no nome do índice.", [], []),
  w("IX9", "index", false, "Sem índices duplicados (mesmas colunas da chave, mesma ordem)", "No duplicate indexes (same key columns, same order). An index whose key is a left prefix of another index is redundant: review it.", "Sem índices duplicados (mesmas colunas da chave, mesma ordem). Um índice cuja chave é prefixo à esquerda de outro é redundante: revisar.", [], []),
  w("PK1", "pk", false, "O nome da primary key utiliza PascalCase, sem espaços ou caracteres especiais", "The PK name uses PascalCase, with no spaces or special characters.", "O nome da primary key utiliza PascalCase, sem espaços ou caracteres especiais.", [], []),
  w("PK6", "pk", false, "A PK é CLUSTERED por padrão", "The PK is **CLUSTERED** by default. The ideal clustered key is narrow, unique, stable and ever-increasing (`INT`/`BIGINT IDENTITY`).", "A PK é **CLUSTERED** por padrão. A chave clusterizada ideal é estreita, única, estável e crescente (`INT`/`BIGINT IDENTITY`).", [], []),
  w("PK10", "pk", false, "Sempre declarar a PK com nome e tipo explícitos (CLUSTERED / NONCLUSTERED)", "Always declare the PK with an explicit name and type (`CLUSTERED` / `NONCLUSTERED`).", "Sempre declarar a PK com nome e tipo explícitos (`CLUSTERED` / `NONCLUSTERED`).", [], []),
  w("P2", "procedure", false, "O nome inicia com a sigla pr (minúscula), seguida do nome em PascalCase", "The name starts with the prefix `pr` (lowercase), followed by the name in PascalCase.", "O nome inicia com a sigla `pr` (minúscula), seguida do nome em PascalCase.", [], []),
  w("T1", "table", false, "O nome da tabela utiliza PascalCase", "Table names use **PascalCase**: each word starts with an uppercase letter, with no spaces or special characters.", "O nome da tabela utiliza **PascalCase**: cada palavra começa com letra maiúscula, sem espaços ou caracteres especiais.", [], []),
  w("T2", "table", false, "Tabelas no schema do módulo (camelCase)", "Tables use the module schema (camelCase) for new projects and for tables migrated from the Local databases to the Global database.", "Tabelas usam o schema do módulo (camelCase) em projetos novos e nas tabelas migradas dos bancos Local para o Global.", [], []),
  w("IXU1", "unique-index", false, "Nome do índice único: IXU + schema + tabela + sequencial", "The name is `IXU` (uppercase) + schema + table name + a two-digit sequence number (`01`, `02`...), separated by underscore. No column names.", "O nome é composto por `IXU` (maiúscula) + schema + nome da tabela + numeral sequencial de dois dígitos (`01`, `02`...), separados por subscrito. Sem nome de coluna.", [], []),
  w("IXU3", "unique-index", false, "Criar com CREATE UNIQUE NONCLUSTERED INDEX em vez de constraint UNIQUE", "Create it with `CREATE UNIQUE NONCLUSTERED INDEX` instead of a `UNIQUE` constraint. The index allows `INCLUDE` and filters.", "Criar com `CREATE UNIQUE NONCLUSTERED INDEX` em vez de constraint `UNIQUE`. O índice permite `INCLUDE` e filtros.", [], []),
  w("V2", "view", false, "O nome inicia com a sigla vw (minúscula), seguida do nome em PascalCase", "The name starts with the prefix `vw` (lowercase), followed by the name in PascalCase.", "O nome inicia com a sigla `vw` (minúscula), seguida do nome em PascalCase.", [], []),
  w("V5", "view", false, "Módulos antigos e views não migradas continuam utilizando dbo como schema padrão", "Legacy modules and views not yet migrated keep `dbo` as the default schema.", "Módulos antigos e views não migradas continuam utilizando `dbo` como schema padrão.", [], []),
  w("G5", "general", true, "O tamanho máximo do nome é 128 caracteres (sysname)", "Maximum name length is 128 characters (`sysname`). If a name would exceed it, abbreviate the column part and document it.", "O tamanho máximo do nome é 128 caracteres (`sysname`). Se ultrapassar, abreviar a parte das colunas e documentar.", [], []),
  w("N6", "column", false, "Não usar números (0-9), exceto quando o número faz parte de uma sigla", "Do not use numbers (0-9), except when the number is part of an acronym. **Exception:** the sequence number of indexes (`IX_..._01`).", "Não usar números (0-9), exceto quando o número faz parte de uma sigla. **Exceção:** o sequencial dos índices (`IX_..._01`).", ["KeyS3", "RootCauseAnalysis5W2HId"], []),
  w("N7", "column", false, "Quando precisar de número, escrever por extenso", "When a number is needed, write it in words.", "Quando precisar de número, escrever por extenso.", ["ApproverOne", "ApproverTwo"], ["Approver1", "Approver2"]),
  w("IX10", "index", false, "Usar INCLUDE para índices de cobertura", "Use `INCLUDE` for covering indexes on critical queries instead of adding columns to the key.", "Usar `INCLUDE` para índices de cobertura em consultas críticas, em vez de adicionar colunas à chave.", [], []),
  w("PK8", "pk", false, "Se a PK for NONCLUSTERED, a tabela deve ter outro índice clusterizado", "If the PK is NONCLUSTERED, the table **must** have another clustered index. Heaps are not allowed.", "Se a PK for NONCLUSTERED, a tabela **deve** ter outro índice clusterizado. Heaps não são permitidos.", [], []),
  w("P5", "procedure", true, "Nunca utilizar o prefixo sp_", "Never use the `sp_` prefix: it is reserved for system procedures, and SQL Server looks for these procedures in `master` first.", "Nunca utilizar o prefixo `sp_`: ele é reservado para procedures de sistema, e o SQL Server procura essas procedures primeiro no `master`.", [], []),
  w("T5", "table", true, "Toda tabela deve ter chave primária, CLUSTERED por padrão", "Every table must have a primary key, CLUSTERED by default (see [Primary Key (Chave Primária)](https://dev.azure.com/solvacelabs/Solvace%20Product%20Improvement/_wiki/wikis/Solvace-Product-Improvement.wiki/261)).", "Toda tabela deve ter chave primária, CLUSTERED por padrão (ver [Primary Key (Chave Primária)](https://dev.azure.com/solvacelabs/Solvace%20Product%20Improvement/_wiki/wikis/Solvace-Product-Improvement.wiki/261)).", [], []),
  w("V6", "view", true, "Não utilizar SELECT * em views", "Do not use `SELECT *` in views: list the columns explicitly.", "Não utilizar `SELECT *` em views: listar as colunas explicitamente.", [], []),].map((s) => (DDL[s.code] ? { ...s, examples: { good: [...s.examples.good, ...DDL[s.code].good], bad: [...s.examples.bad, ...DDL[s.code].bad] } } : s));

/** Códigos que ficam de fora do catálogo de exemplo (a "reimportação" traz como novos). */
const MISSING = ['G5', 'N6', 'N7', 'IX10', 'PK8', 'P5', 'T5', 'V6'];

/** Padrões de aplicação gerados da engenharia reversa (referenciam os itens da ER, sem copiar o texto). */
function app(module: string, key: string, code: string, topic: string, title: string, textPt: string, refs: string, repos: string[],
  extra: Partial<Standard> = {}): Standard {
  return normalizeStandard({
    id: `st-app-${module}-${key}`, key: `app-${module}-${key}`, code, area: 'application', topic, title, textPt, textEn: null,
    examples: { good: [], bad: [] },
    appliesTo: { platforms: ['dotnet'], repositories: repos, modules: [module], objects: ['new', 'migrated'] },
    source: { kind: 'reverse-engineering', ref: refs, version: 'ER v3', url: null },
    status: 'active', effect: 'monitor', check: { kind: 'none', target: null, pattern: null, mustMatch: false, sql: null },
    updatedAt: '2026-11-24T10:20:00', updatedBy: 'Importação da ER',
    ...extra,
  });
}

export const DEMO_MODULES: StandardModuleOption[] = [
  { key: 'actionplan', name: 'Plano de ação (revamp)', published: true },
  { key: 'kpi', name: 'KPI (revamp)', published: true },
  { key: 'audit', name: 'Auditorias (revamp)', published: true },
  { key: 'loss-tree', name: 'Árvore de perdas', published: true },
  { key: 'integrations-api', name: 'API de integrações', published: true },
  { key: 'edv-solvace', name: 'Legado edv-solvace', published: false },
];

const MODULE_REPO: Record<string, string> = {
  actionplan: 'solvace-revamp-actionplan-api', kpi: 'solvace-revamp-kpi-api', audit: 'solvace-revamp-audit-api',
  'loss-tree': 'solvace-loss-tree-api', 'integrations-api': 'solvace-integrations-api', 'edv-solvace': 'edv-solvace-api',
};

/** Estrutura de aplicação proposta para um módulo (o que o gerador sem IA tiraria da arquitetura publicada). */
export function appStandardsFor(module: string, revision = 0): Standard[] {
  const repo = MODULE_REPO[module] ?? module;
  const up = module.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  return [
    app(module, 'layers', `${up}-ARQ1`, 'layers', 'Camadas domain → application → infra → api',
      `O módulo segue as camadas descritas na arquitetura: regras de negócio no domínio, casos de uso na aplicação, persistência na infra e controllers na api. ${revision ? 'Serviços de aplicação não acessam o DbContext diretamente.' : ''}`.trim(),
      `${module}#ARQ-001 ${module}#ARQ-004`, [repo]),
    app(module, 'folders', `${up}-ARQ2`, 'folders', 'Controllers só na camada api',
      'Controllers ficam no projeto *.api (pasta Controllers); um controller fora dele é achado.', `${module}#ARQ-002`, [repo],
      { check: { kind: 'path', target: 'path', pattern: '**/*.domain/**/*Controller.cs|**/*.application/**/*Controller.cs|**/*.infra/**/*Controller.cs', mustMatch: false, sql: null, hint: 'Mova o controller para o projeto *.api.' } }),
    app(module, 'api', `${up}-API1`, 'api', 'Rotas no padrão api/v{version}/[controller]',
      'Endpoints versionados: [Route("api/v{version:apiVersion}/[controller]")] em todo controller.', `${module}#API-001`, [repo],
      { check: { kind: 'regex', target: 'code', pattern: '\\[Route\\("(?!api/v\\{version:apiVersion\\}/)', mustMatch: false, sql: null, hint: 'Use [Route("api/v{version:apiVersion}/[controller]")].' } }),
    app(module, 'data-access', `${up}-DAT1`, 'data-access', 'Acesso a dados pelo repositório da infra',
      'Consultas ao banco passam pelos repositórios da camada infra (EF Core/Dapper); nada de SqlConnection solto em serviço ou controller.',
      `${module}#ARQ-006`, [repo],
      { check: { kind: 'regex', target: 'code', pattern: '\\bnew\\s+SqlConnection\\s*\\(', mustMatch: false, sql: null, hint: 'Use o repositório da infra.' } }),
  ];
}

export const DEMO_STANDARDS: Standard[] = [
  ...ALL.filter((s) => !MISSING.includes(s.code)),
  // Item da v1.0 que a v2.0 tirou (a "reimportação" mostra como removido).
  normalizeStandard({
    id: 'st-db-pk3', key: 'db-pk3', code: 'PK3', area: 'database', topic: 'pk', title: 'Nome da PK com a coluna (v1.0)',
    textPt: 'O nome é composto por PK + schema + tabela + coluna (PK_[schema]_[Tabela]_[Coluna]).',
    textEn: 'The name is PK + schema + table + column (PK_[schema]_[Table]_[Column]).',
    examples: { good: ['PK_language_Language_LanguageId'], bad: [] },
    appliesTo: { platforms: ['sqlserver'], repositories: [], modules: [], objects: ['new', 'migrated'] },
    source: { kind: 'wiki', ref: 'PK3', version: '1.1', url: wikiUrl('pk') }, status: 'deprecated', effect: 'monitor',
    check: { kind: 'none', target: null, pattern: null, mustMatch: false, sql: null }, updatedAt: '2026-06-12T09:00:00', updatedBy: 'Importação da wiki',
  }),
  ...appStandardsFor('actionplan'),
  ...appStandardsFor('kpi').slice(0, 2),
  normalizeStandard({
    id: 'st-manual-sql-file-name', key: 'manual-sql-script-name', code: 'SCR1', area: 'database', topic: 'general',
    title: 'Script de correção em Scripts/ com o número do card',
    textPt: 'Scripts de correção gravados pelo PRMake ficam em Scripts/, têm o número do card no nome (99_<card>_descricao.sql) e são idempotentes (IF NOT EXISTS).',
    textEn: null, examples: { good: ['99_78612_ajusta_indice.sql'], bad: ['script.sql'] },
    appliesTo: { platforms: ['sqlserver'], repositories: [], modules: [], objects: ['new', 'migrated', 'legacy'] },
    source: { kind: 'manual', ref: '', version: null, url: null }, status: 'active', effect: 'warn',
    check: { kind: 'path', target: 'path', pattern: '*.sql', mustMatch: false, sql: null, hint: 'Script SQL na raiz do repositório: grave em Scripts/ como 99_<card>_<descricao>.sql.' },
    updatedAt: '2026-11-24T11:40:00', updatedBy: 'Alex Carlos',
  }),
];

/** A wiki "de hoje" (v2.1): tudo de ALL, FK7 e C2 com texto/exemplo novos; PK3 não existe mais. */
export function demoWikiSnapshot(): Standard[] {
  return ALL.map((s) => {
    const v = { ...s, source: { ...s.source, version: '2.1' } };
    if (s.code === 'FK7') {
      return {
        ...v,
        textPt: `${s.textPt} Em tabelas multi-site, inclua o SiteId depois das colunas da FK.`,
        textEn: `${s.textEn} On multi-site tables, add SiteId after the FK columns.`,
      };
    }
    if (s.code === 'C2') return { ...v, examples: { good: ['Amount DECIMAL(19, 4)', 'UnitPrice DECIMAL(18, 6)'], bad: ['Amount MONEY', 'Fee SMALLMONEY'] } };
    return v;
  });
}
