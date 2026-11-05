import { UserIntegration } from '../../services/user-integration.service';

/**
 * 0083: passo a passo de cada integração de uso pessoal ("Como obter"), usado no guia "Primeiros passos" e em
 * "Minhas integrações". Os links e nomes vêm dos campos fixos do plugin (organização do DevOps, owner do GitHub, grupo
 * do Teams) — nada fixo aqui além do caminho das telas de cada serviço. Textos em HTML simples.
 */
export interface GuideLink {
  label: string;
  url: string;
}

export interface IntegrationGuide {
  /** Descrição do plugin (como cadastrado pelo admin). */
  plugin: string;
  title: string;
  icon: string;
  /** Para que serve, em uma frase. */
  why: string;
  steps: string[];
  links: GuideLink[];
  /** Aviso curto em destaque (custo, validade, segurança). */
  note?: string;
}

/** Valor de um campo fixo (do admin) ou do usuário, sem diferenciar maiúsculas na chave. */
export function fieldValue(integration: UserIntegration | undefined, key: string): string {
  const field = integration?.fields.find((f) => f.key.toLowerCase() === key.toLowerCase());
  return field && !field.sensitive ? (field.value ?? '').trim() : '';
}

const esc = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const enc = encodeURIComponent;
const link = (url: string, label: string) => `<a href="${esc(url)}" target="_blank" rel="noopener">${label}</a>`;

/** Organização e projeto do Azure DevOps (campos fixos do "AzureDevOps Configurations"). */
export function devOpsContext(list: UserIntegration[]): { org: string; project: string } {
  const azure = list.find((i) => i.description === 'AzureDevOps Configurations');
  return { org: fieldValue(azure, 'Organization'), project: fieldValue(azure, 'Project') };
}

function azureGuide(i: UserIntegration): IntegrationGuide {
  const org = fieldValue(i, 'Organization');
  const base = org ? `https://dev.azure.com/${enc(org)}` : 'https://dev.azure.com';
  const orgText = org ? `<b>${esc(org)}</b>` : 'da empresa';
  return {
    plugin: i.description,
    title: 'Azure DevOps — Personal Access Token (PAT)',
    icon: 'assignment',
    why: 'O PRMake lê o card, comenta, publica o Root Cause e move o card no Azure DevOps com o <b>seu</b> usuário.',
    steps: [
      `Abra ${link(`${base}/_usersSettings/tokens`, 'Personal access tokens')} na organização ${orgText} ` +
        '(ou, no DevOps: ícone <b>User settings</b> ao lado da sua foto → <b>Personal access tokens</b>).',
      `<b>+ New Token</b>: nome <code>PRMake</code>, Organization ${orgText} e a validade (<b>Expiration</b>) mais longa permitida — anote a data: quando vencer, gere outro e troque aqui.`,
      '<b>Scopes</b>: <b>Custom defined</b> → <b>Work Items: Read &amp; write</b>. Não precisa de mais nada.',
      '<b>Create</b> e copie o token na hora (ele não aparece de novo). Cole em <b>Personal Access Token</b>.',
      'Os campos do título, Root Cause e Repro Steps já vêm sugeridos: confira e <b>Salvar</b>.'
    ],
    links: [
      { label: 'Personal access tokens', url: `${base}/_usersSettings/tokens` },
      { label: 'Como usar PAT (Microsoft)', url: 'https://learn.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate' }
    ],
    note: 'O token é seu: nunca cole em chat, comentário ou arquivo do git. Venceu ou vazou? Revogue na mesma tela e gere outro.'
  };
}

function githubGuide(i: UserIntegration): IntegrationGuide {
  const owner = fieldValue(i, 'Owner');
  const ownerText = owner ? `<b>${esc(owner)}</b>` : 'da empresa';
  const newToken = 'https://github.com/settings/tokens/new?scopes=repo&description=PRMake';
  return {
    plugin: i.description,
    title: 'GitHub — token pessoal',
    icon: 'merge',
    why: `Abrir, acompanhar e atualizar os PRs dos cards nos repositórios da organização ${ownerText}.`,
    steps: [
      `Abra ${link(newToken, 'Novo token (classic)')} — o link já vem com o escopo <b>repo</b> e o nome PRMake. ` +
        '(Caminho: sua foto → <b>Settings</b> → <b>Developer settings</b> → <b>Personal access tokens</b> → <b>Tokens (classic)</b> → <b>Generate new token (classic)</b>.)',
      '<b>Expiration</b>: a mais longa que a organização permite (quando vencer, gere outro e troque aqui). Escopo: só <b>repo</b>.',
      '<b>Generate token</b> e copie (começa com <code>ghp_</code>; aparece uma vez só).',
      `Se a organização ${ownerText} usa SSO: na lista de tokens, <b>Configure SSO</b> → <b>Authorize</b> em ${ownerText}. Sem isso o GitHub responde 403/404 nos repositórios.`,
      'Cole em <b>Token</b> e <b>Salvar</b>.'
    ],
    links: [
      { label: 'Novo token (classic)', url: newToken },
      { label: 'Seus tokens', url: 'https://github.com/settings/tokens' },
      { label: 'Tokens (GitHub Docs)', url: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens' },
      { label: 'Autorizar no SSO', url: 'https://docs.github.com/en/enterprise-cloud@latest/authentication/authenticating-with-single-sign-on/authorizing-a-personal-access-token-for-use-with-single-sign-on' }
    ],
    note: owner ? `Sua conta do GitHub precisa ser membro de ${esc(owner)} com acesso aos repositórios — se não for, peça ao administrador.` : undefined
  };
}

function aiConfigGuide(i: UserIntegration, list: UserIntegration[]): IntegrationGuide {
  const { org, project } = devOpsContext(list);
  const workItems = org && project ? `https://dev.azure.com/${enc(org)}/${enc(project)}/_workitems` : '';
  return {
    plugin: i.description,
    title: 'Provedor de IA e estados do seu board',
    icon: 'tune',
    why: 'Qual IA o PRMake usa nas ações de IA da tela (descrição do PR, Root Cause, resumos, Pergunte, assistente) e os estados/áreas do board do seu time.',
    steps: [
      'Em <b>Provedor de IA</b>, escolha <b>Claude</b> ou <b>Gemini</b> — e preencha a chave do provedor escolhido na integração dele (Claude Plugin ou Gemini Plugin).',
      'Estados, áreas e estimativas iniciais já vêm com o padrão. Só mude se o board do seu time usa outros nomes: ' +
        (workItems ? `abra um Bug do seu time em ${link(workItems, 'Work items')}` : 'abra um Bug do seu time no Azure DevOps') +
        ' e copie o valor exato dos campos <b>State</b> e <b>Area</b>.',
      '<b>Salvar</b>. Vazio = vale o padrão da configuração geral.'
    ],
    links: workItems ? [{ label: 'Work items do projeto', url: workItems }] : [],
    note: 'As ações de IA da tela são cobradas na <b>sua</b> chave do provedor — acompanhe em <b>Meu consumo de IA</b>.'
  };
}

function claudeGuide(i: UserIntegration): IntegrationGuide {
  return {
    plugin: i.description,
    title: 'Claude (Anthropic) — chave da API',
    icon: 'auto_awesome',
    why: 'Chave usada quando o provedor de IA é Claude. Não é a assinatura do Claude Code: é a API da Anthropic (cobrada por uso).',
    steps: [
      `Entre em ${link('https://platform.claude.com/settings/keys', 'platform.claude.com → API keys')} com a conta da Anthropic da empresa (sem acesso? peça um convite ao administrador).`,
      '<b>Create key</b>: escolha o <b>workspace</b>, nome <code>PRMake</code>, e copie a chave (<code>sk-ant-…</code>; aparece uma vez só).',
      'Cole em <b>ApiKey</b>. O modelo já vem sugerido (o mais barato) — deixe assim, salvo orientação do administrador.',
      `<b>WorkspaceId</b>: só se a chave for de organização (fora de um workspace). O ID (<code>wrkspc_…</code>) está em ${link('https://platform.claude.com/settings/workspaces', 'Workspaces')}.`,
      '<b>Salvar</b>.'
    ],
    links: [
      { label: 'API keys', url: 'https://platform.claude.com/settings/keys' },
      { label: 'Workspaces', url: 'https://platform.claude.com/settings/workspaces' }
    ],
    note: 'Cada ação de IA da tela gasta desta chave — veja tokens e custo em <b>Meu consumo de IA</b>.'
  };
}

function geminiGuide(i: UserIntegration): IntegrationGuide {
  return {
    plugin: i.description,
    title: 'Gemini (Google) — chave da API',
    icon: 'auto_awesome',
    why: 'Chave usada quando o provedor de IA é Gemini.',
    steps: [
      `Abra ${link('https://aistudio.google.com/app/apikey', 'Google AI Studio → API keys')} com a sua conta Google da empresa.`,
      '<b>Create API key</b>: escolha (ou crie) um projeto do Google Cloud e copie a chave.',
      'Cole em <b>ApiKey</b> e <b>Salvar</b>. Modelo e endereço são definidos pelo administrador.'
    ],
    links: [{ label: 'Google AI Studio — API keys', url: 'https://aistudio.google.com/app/apikey' }],
    note: 'O uso é cobrado no projeto do Google Cloud da chave (o nível gratuito tem limite por minuto/dia).'
  };
}

function teamsGuide(i: UserIntegration): IntegrationGuide {
  const group = fieldValue(i, 'GroupName');
  const groupText = group ? `<b>${esc(group)}</b>` : 'de aprovações';
  return {
    plugin: i.description,
    title: 'Teams — URL do Workflow',
    icon: 'groups',
    why: `Pedir aprovação de PR no grupo ${groupText} do Teams com um clique (botão "Pedir aprovação"). A mensagem sai em seu nome.`,
    steps: [
      `No Teams, abra o grupo ${groupText} → <b>⋯</b> (Mais opções) → <b>Workflows</b>.`,
      'Escolha o modelo <b>"Enviar alertas de webhook para um chat"</b> (em inglês: <i>Send webhook alerts to a chat</i>).',
      `Dê um nome, confirme a sua conta e o chat de destino (${groupText}) e conclua (<b>Adicionar fluxo de trabalho</b>).`,
      'Copie a <b>URL</b> mostrada no fim do assistente (endereço longo de <code>…logic.azure.com</code> ou <code>…powerplatform.com</code>).',
      'Cole em <b>URL do Workflow</b> e <b>Salvar</b>. Perdeu a URL? Em <b>Workflows</b> abra o fluxo e copie de novo o gatilho.'
    ],
    links: [{ label: 'Webhooks com Workflows (Microsoft)', url: 'https://support.microsoft.com/en-us/office/create-incoming-webhooks-with-workflows-for-microsoft-teams-8ae491c7-0394-4861-ba59-055e33f75498' }],
    note: 'Quem tem a URL posta no grupo: trate como senha.'
  };
}

function genericGuide(i: UserIntegration): IntegrationGuide {
  return {
    plugin: i.description,
    title: i.description,
    icon: 'extension',
    why: i.optional ? 'Integração opcional: sem ela, só o recurso que depende dela fica indisponível.' : 'Integração obrigatória definida pelo administrador.',
    steps: ['Preencha os campos com os seus dados (cada campo tem a ajuda do administrador) e <b>Salvar</b>.'],
    links: []
  };
}

/** Passo a passo da integração (o da lista completa ajuda a montar links que dependem de outra integração). */
export function guideFor(integration: UserIntegration, list: UserIntegration[] = []): IntegrationGuide {
  switch (integration.description) {
    case 'AzureDevOps Configurations': return azureGuide(integration);
    case 'Github Configurations': return githubGuide(integration);
    case 'AI Configurations': return aiConfigGuide(integration, list);
    case 'Claude Plugin': return claudeGuide(integration);
    case 'Gemini Plugin': return geminiGuide(integration);
    case 'Teams Configurations': return teamsGuide(integration);
    default: return genericGuide(integration);
  }
}

/** "Seus dados no Azure DevOps": e-mail/nome (regra automática do executor), acesso ao projeto. */
export function devOpsProfileGuide(list: UserIntegration[]): IntegrationGuide {
  const { org, project } = devOpsContext(list);
  const base = org ? `https://dev.azure.com/${enc(org)}` : 'https://dev.azure.com';
  const workItems = org && project ? `${base}/${enc(project)}/_workitems` : '';
  return {
    plugin: '',
    title: 'Seus dados no Azure DevOps',
    icon: 'badge',
    why: 'O que o PRMake usa do seu usuário do DevOps além do token.',
    steps: [
      `Seu <b>e-mail/nome no DevOps</b>: em ${link(`${base}/_usersSettings/about`, 'User settings → Profile')}. É o que vai em ` +
        '<b>Atribuído a</b> na regra automática de <b>Meus executores</b> (ou use <code>@Me</code> = o dono do PAT).',
      (workItems ? `Confira se abre ${link(workItems, `os work items do projeto ${esc(project)}`)}` : 'Confira se você abre os work items do projeto no DevOps') +
        ' — se não abrir, peça acesso ao administrador do DevOps antes de gerar o token.',
      'Estados e áreas do board do seu time (Ready for QA, Test in production): abra um Bug do seu time e veja os campos <b>State</b> e <b>Area</b>. ' +
        'Só precisa informar em <b>AI Configurations</b> se forem diferentes do padrão.'
    ],
    links: [
      { label: 'Profile', url: `${base}/_usersSettings/about` },
      ...(workItems ? [{ label: 'Work items', url: workItems }] : [])
    ]
  };
}
