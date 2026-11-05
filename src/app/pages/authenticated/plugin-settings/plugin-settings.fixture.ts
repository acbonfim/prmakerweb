/**
 * Resposta de exemplo do `GET PluginConfiguration/settings` (0086) — usada pelos specs e, em desenvolvimento, pela
 * tela com `?exemplo=1` (sem backend). Valores parecidos com os de produção, com um pouco de cada tipo.
 */
import { SettingField, SettingsResponse } from './plugin-settings.model';

const SKILLS = 'Skills Configurations';
const AI = 'AI Configurations';
const DEVOPS = 'AzureDevOps Configurations';

function field(partial: Partial<SettingField> & Pick<SettingField, 'pluginId' | 'pluginName' | 'key' | 'label' | 'type'>): SettingField {
  const value = partial.value === undefined ? null : partial.value;
  const exists = partial.exists ?? value !== null;
  return {
    id: `${partial.pluginId ?? partial.pluginName}:${partial.key}`,
    help: null,
    value,
    hasValue: partial.hasValue ?? (value !== null && value !== ''),
    exists,
    default: null,
    isDefault: false,
    readBy: ['api'],
    personal: null,
    obsolete: false,
    advanced: false,
    multilineHint: false,
    ...partial,
  };
}

const ANALYSIS_STEPS = JSON.stringify([
  { key: 'entender-card', title: 'Entender o card', description: 'Lê descrição, evidências e comentários.' },
  { key: 'consultar-base', title: 'Consultar a Base Solvace', description: 'Itens da engenharia reversa.' },
  { key: 'investigar-codigo', title: 'Investigar o código', description: 'Confirma o "Onde:" dos itens.' },
  { key: 'montar-analise', title: 'Montar a análise', description: 'Causa raiz e evidências.' },
  { key: 'propor-solucoes', title: 'Propor soluções', description: 'Pergunta ao usuário.', kind: 'question' },
  { key: 'corrigir-back', title: 'Corrigir (back)', description: '' },
  { key: 'corrigir-front', title: 'Corrigir (front)', description: '' },
  { key: 'validar-qa', title: 'Validar em QA', description: '' },
]);

const US_STEPS = JSON.stringify([
  { key: 'entender-us', title: 'Entender a US', description: 'Descrição e critérios de aceite.' },
  { key: 'consultar-base', title: 'Consultar a Base Solvace', description: '' },
  { key: 'mapear-solucao', title: 'Mapear onde a US entra', description: '' },
  { key: 'propor-solucoes', title: 'Propor a solução', description: '', kind: 'question' },
]);

export const SETTINGS_FIXTURE: SettingsResponse = {
  sections: [
    {
      key: 'devops', title: 'Azure DevOps', icon: 'view_kanban',
      description: 'Conexão com o Azure DevOps, campos do card e movimentos automáticos.',
      groups: [
        {
          key: 'conexao', title: 'Conexão', description: 'Organização e projeto onde os cards ficam.',
          fields: [
            field({ pluginId: 8, pluginName: DEVOPS, key: 'Organization', label: 'Organização', type: 'text', value: 'solvace',
              help: 'Nome da organização no dev.azure.com.', readBy: ['api', 'skills'] }),
            field({ pluginId: 8, pluginName: DEVOPS, key: 'Project', label: 'Projeto', type: 'text', value: 'Solvace',
              readBy: ['api', 'skills'] }),
            field({ pluginId: 8, pluginName: DEVOPS, key: 'ApiVersion', label: 'Versão da API', type: 'enum', value: '7.1',
              default: '7.1', isDefault: true, options: [{ value: '7.0', label: '7.0' }, { value: '7.1', label: '7.1' }],
              allowCustom: true, advanced: true }),
            field({ pluginId: 8, pluginName: DEVOPS, key: 'PersonalAccessToken', label: 'Token de acesso (PAT)', type: 'secret',
              value: null, hasValue: true, exists: true, help: 'Cada usuário informa o próprio PAT em Minhas integrações.',
              readBy: ['api', 'skills', 'executor'], personal: { userFills: true, required: true, useGlobalDefault: false } }),
          ],
        },
        {
          key: 'estados', title: 'Estados e movimentos',
          fields: [
            field({ pluginId: 3, pluginName: AI, key: 'BugReadyForQaState', label: 'Estado "pronto para QA"', type: 'text',
              value: 'In Development (done)', default: 'In Development (done)', isDefault: true }),
            field({ pluginId: 10, pluginName: SKILLS, key: 'AutoDevTestInQa', label: 'Mover para Dev Test in QA automaticamente',
              type: 'bool', value: 'true', default: 'true', isDefault: true, readBy: ['api'] }),
            field({ pluginId: 10, pluginName: SKILLS, key: 'QaBranchPattern', label: 'Branches de QA', type: 'list', listFormat: 'csv',
              value: 'qa,qa-*', default: 'qa', help: 'Branches que contam como QA (`qa*` = prefixo).', readBy: ['api'] }),
            field({ pluginId: 10, pluginName: SKILLS, key: 'SituationPostToDevOps', label: 'Publicar a situação no card', type: 'bool',
              value: null, exists: false, default: 'true' }),
          ],
        },
        {
          key: 'classificacao', title: 'Classificação',
          fields: [
            field({ pluginId: 3, pluginName: AI, key: 'BugClassificationPresets', label: 'Classificações prontas', type: 'table',
              value: JSON.stringify([{ key: 'codigo', label: 'Erro de código', resolutionType: 'Code', generalClassification: 'Bug',
                classification: 'Code error', pattern: '' }]),
              columns: [
                { key: 'key', label: 'Chave', type: 'text', required: true, width: 'sm' },
                { key: 'label', label: 'Rótulo', type: 'text', required: true, width: 'md' },
                { key: 'resolutionType', label: 'Tipo de resolução', type: 'text', width: 'md' },
                { key: 'generalClassification', label: 'Classificação geral', type: 'text', width: 'md' },
                { key: 'classification', label: 'Classificação', type: 'text', width: 'md' },
                { key: 'pattern', label: 'Padrão', type: 'text', width: 'md' },
              ] }),
          ],
        },
      ],
    },
    {
      key: 'branches', title: 'Branches e PRs', icon: 'merge',
      description: 'Nomes de branch, commit e PR, fluxo por área e promoção em lote.',
      groups: [
        {
          key: 'padroes', title: 'Padrões de nome',
          fields: [
            field({ pluginId: 10, pluginName: SKILLS, key: 'BranchNamePattern', label: 'Nome da branch', type: 'pattern',
              value: 'hotfix/{card}', default: 'hotfix/{card}', isDefault: true, readBy: ['api', 'skills'],
              variables: [{ name: 'card', description: 'número do card', example: '77434' }] }),
            field({ pluginId: 10, pluginName: SKILLS, key: 'CommitMessagePattern', label: 'Mensagem de commit', type: 'pattern',
              value: 'AB#{card} {summary}', default: 'AB#{card} {summary}', isDefault: true, readBy: ['api', 'skills'],
              variables: [{ name: 'card', description: 'número do card', example: '77434' },
                { name: 'summary', description: 'resumo da correção', example: 'corrige o filtro de datas' }] }),
            field({ pluginId: 10, pluginName: SKILLS, key: 'BranchSuffixByTarget', label: 'Sufixo por destino', type: 'map',
              value: JSON.stringify({ development: '-dev', qa: '-qa', 'release-version': '-rv' }),
              default: JSON.stringify({ development: '-dev', qa: '-qa', 'release-version': '-rv', 'hotfix-version': '-hv', edge: '-edge' }),
              mapKeyLabel: 'Destino', mapValueLabel: 'Sufixo', mapValueType: 'text', readBy: ['api', 'skills'] }),
            field({ pluginId: 10, pluginName: SKILLS, key: 'DefaultRepository', label: 'Repositório padrão', type: 'text',
              value: 'edv-solvace', default: 'edv-solvace', isDefault: true,
              options: [{ value: 'edv-solvace', label: 'edv-solvace' }, { value: 'edv-solvace-api', label: 'edv-solvace-api' }] }),
          ],
        },
        {
          key: 'fluxo', title: 'Fluxo por área e repositório',
          fields: [
            field({ pluginId: 10, pluginName: SKILLS, key: 'BranchFlowByArea', label: 'Fluxo por área', type: 'table',
              value: JSON.stringify([{ areaContains: 'Release Management', flow: 'release' }, { areaContains: 'Product Development Team', flow: 'producao' }]),
              columns: [
                { key: 'areaContains', label: 'Área contém', type: 'text', required: true, width: 'md' },
                { key: 'flow', label: 'Fluxo', type: 'enum', options: [{ value: 'producao', label: 'Produção' }, { value: 'release', label: 'Release' }], width: 'sm' },
              ], readBy: ['api', 'skills'] }),
            field({ pluginId: 10, pluginName: SKILLS, key: 'BranchStrategy', label: 'Estratégia de branches', type: 'json',
              value: '{"repositories":[{"match":"edv-solvace","kind":"legacy"}],"flows":{}}', readBy: ['api', 'skills', 'executor'],
              help: '`repositories` (match → kind) e `flows` (fluxo → kind → base e PRs).' }),
          ],
        },
        {
          key: 'tela-pr', title: 'Tela de PR',
          fields: [
            field({ pluginId: 9, pluginName: 'PullRequest', key: 'ActiveBranchs', label: 'Branches de destino', type: 'table',
              value: "[{label:'Development', branchName:'development'},{label:'QA', branchName:'qa'}]",
              columns: [{ key: 'label', label: 'Rótulo', type: 'text', required: true }, { key: 'branchName', label: 'Branch', type: 'text', required: true }],
              readBy: ['front'] }),
          ],
        },
      ],
    },
    {
      key: 'analise', title: 'Análise e correção', icon: 'troubleshoot',
      description: 'Etapas padrão dos planos, travas e testes locais da correção.',
      groups: [
        {
          key: 'etapas', title: 'Etapas padrão',
          fields: [
            field({ pluginId: 10, pluginName: SKILLS, key: 'AnalysisDefaultSteps', label: 'Etapas da análise de bug', type: 'table',
              value: ANALYSIS_STEPS, readBy: ['skills'],
              columns: [
                { key: 'key', label: 'Chave', type: 'text', required: true, width: 'sm' },
                { key: 'title', label: 'Título', type: 'text', required: true, width: 'md' },
                { key: 'description', label: 'Descrição', type: 'textarea', width: 'lg' },
                { key: 'kind', label: 'Tipo', type: 'enum', options: [{ value: '', label: 'Etapa' }, { value: 'question', label: 'Pergunta' }], width: 'sm' },
              ] }),
            field({ pluginId: 10, pluginName: SKILLS, key: 'UsAnalysisDefaultSteps', label: 'Etapas da análise de US', type: 'table',
              value: US_STEPS, readBy: ['skills'],
              columns: [
                { key: 'key', label: 'Chave', type: 'text', required: true, width: 'sm' },
                { key: 'title', label: 'Título', type: 'text', required: true, width: 'md' },
              ] }),
          ],
        },
        {
          key: 'travas', title: 'Travas', description: 'Etapas que só concluem com citação de código, evidências ou consulta à Base.',
          fields: [
            field({ pluginId: 10, pluginName: SKILLS, key: 'CodeRefGateSteps', label: 'Exigem citação de código', type: 'steps',
              listFormat: 'csv', value: 'montar-analise,propor-solucoes', default: 'montar-analise,propor-solucoes', isDefault: true,
              stepSources: [`${SKILLS}:AnalysisDefaultSteps`, `${SKILLS}:UsAnalysisDefaultSteps`] }),
            field({ pluginId: 10, pluginName: SKILLS, key: 'EvidenceGateSteps', label: 'Exigem evidências abertas', type: 'steps',
              listFormat: 'csv', value: 'montar-analise', default: 'montar-analise', isDefault: true,
              stepSources: [`${SKILLS}:AnalysisDefaultSteps`, `${SKILLS}:UsAnalysisDefaultSteps`] }),
            field({ pluginId: 10, pluginName: SKILLS, key: 'CodeRefContextLines', label: 'Linhas de contexto da citação', type: 'number',
              value: '30', default: '30', isDefault: true, min: 0, max: 200, unit: 'linhas', advanced: true, readBy: ['skills'] }),
          ],
        },
        {
          key: 'testes', title: 'Testes locais',
          fields: [
            field({ pluginId: 10, pluginName: SKILLS, key: 'CorrectionLocalTests', label: 'Testes locais na correção', type: 'enum',
              value: 'changed', default: 'changed', isDefault: true, readBy: ['skills'],
              options: [{ value: 'changed', label: 'Só o que mudou' }, { value: 'off', label: 'Desligado' }] }),
            field({ pluginId: 10, pluginName: SKILLS, key: 'CorrectionTestMaxSeconds', label: 'Tempo máximo dos testes', type: 'number',
              value: '420', default: '420', isDefault: true, min: 30, max: 3600, unit: 's', readBy: ['skills'] }),
          ],
        },
      ],
    },
    {
      key: 'executor', title: 'Executor e modelos', icon: 'smart_toy',
      description: 'Modelos do Claude usados pelo executor e pelo especialista.',
      groups: [
        {
          key: 'modelos', title: 'Modelos',
          fields: [
            field({ pluginId: 10, pluginName: SKILLS, key: 'ExecutorAnalysisModel', label: 'Modelo da análise', type: 'enum',
              value: 'opus', default: 'opus', isDefault: true, allowCustom: true, readBy: ['api', 'executor'],
              options: [{ value: 'opus', label: 'Opus' }, { value: 'sonnet', label: 'Sonnet' }, { value: 'haiku', label: 'Haiku' }] }),
            field({ pluginId: null, pluginName: 'OpenAI Plugin', key: 'Model', label: 'Modelo (OpenAI)', type: 'text',
              value: null, exists: false, readBy: ['api'] }),
            field({ pluginId: 10, pluginName: SKILLS, key: 'ExecutorNoteDelaySeconds', label: 'Atraso das notas (obsoleta)', type: 'number',
              value: '120', obsolete: true, readBy: [] }),
          ],
        },
        {
          key: 'execucao', title: 'Execução',
          fields: [
            field({ pluginId: 10, pluginName: SKILLS, key: 'ExecutorCorrectionNewSession', label: 'Correção em sessão nova', type: 'bool',
              value: 'true', default: 'true', isDefault: true, readBy: ['api', 'executor'] }),
            field({ pluginId: 10, pluginName: SKILLS, key: 'WorkItemSlots', label: 'Itens em paralelo', type: 'number',
              value: '2', default: '2', isDefault: true, min: 1, max: 10, readBy: ['api', 'executor'] }),
            field({ pluginId: 10, pluginName: SKILLS, key: 'AssistantHoursSteps', label: 'Etapas que contam horas', type: 'steps',
              listFormat: 'csv', value: 'montar-analise,propor-solucoes,corrigir-*,validar-qa',
              stepSources: [`${SKILLS}:AnalysisDefaultSteps`] }),
            field({ pluginId: 10, pluginName: SKILLS, key: 'ReverseEngineeringGlossaryExclusions', label: 'Palavras fora do glossário', type: 'list',
              listFormat: 'json', value: '["id","nome","data"]', advanced: true }),
            field({ pluginId: 3, pluginName: AI, key: 'PromptBug', label: 'Prompt do PR (bug)', type: 'prompt',
              value: 'Gere a descrição do PR do card {card}.\nUse os commits.', readBy: ['api', 'front', 'skills'],
              variables: [{ name: 'card', description: 'número do card', example: '77434' }] }),
            field({ pluginId: 3, pluginName: AI, key: 'TemplatePassagemConhecimento', label: 'Modelo da passagem de conhecimento', type: 'textarea',
              value: '## Contexto\n\n## O que foi feito\n', readBy: ['front', 'skills'] }),
          ],
        },
      ],
    },
  ],
  plugins: [
    { id: 3, name: AI, exists: true, isPersonal: true, isOptional: true, adminOnly: false, version: '1001' },
    { id: 8, name: DEVOPS, exists: true, isPersonal: true, isOptional: false, adminOnly: false, version: '4711' },
    { id: 9, name: 'PullRequest', exists: true, isPersonal: false, isOptional: false, adminOnly: false, version: '88' },
    { id: 10, name: SKILLS, exists: true, isPersonal: false, isOptional: false, adminOnly: false, version: '9120' },
  ],
  uncataloged: [
    { pluginId: 10, pluginName: SKILLS, key: 'TicketSystem', value: 'Freshservice', secret: false },
    { pluginId: 8, pluginName: DEVOPS, key: 'LegacyToken', value: null, secret: true },
  ],
  missingPlugins: ['OpenAI Plugin'],
};

/** Cópia profunda (cada spec/tela mexe na sua). */
export function settingsFixture(): SettingsResponse {
  return JSON.parse(JSON.stringify(SETTINGS_FIXTURE));
}
