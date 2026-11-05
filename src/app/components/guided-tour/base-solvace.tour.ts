import { TourDefinition } from './tour.model';

/**
 * 0084: tour da Base Solvace (pages/authenticated/architecture). Uma fase só: o próprio tour abre o que precisa mostrar
 * (`prepare`: `overview` = visão geral, `tree` = lista de sistemas — no celular é uma gaveta —, `map` = mapa,
 * `project` = um sistema). Passos de administrador têm `requires: 'admin'`.
 * Mudou a tela de um jeito que muda o uso? Ajuste o passo e suba `version` (e o `since` dos passos novos/alterados).
 */
export const BASE_SOLVACE_TOUR: TourDefinition = {
  id: 'base-solvace',
  version: 1,
  title: 'Como usar a Base Solvace',
  help: {
    subtitle: 'Configuração inicial, como achar respostas e como ajudar a base a aprender',
    tips: [
      '<b>Primeira vez?</b> Configure a IA em <b>Minhas integrações</b> (botão de IA no topo desta tela): o Pergunte usa a <b>sua</b> chave.',
      '<b>Não sabe onde procurar?</b> Escreva a pergunta com as suas palavras no <b>Pergunte</b> — não precisa saber o nome do sistema.',
      '<b>Achou o trecho certo?</b> Copie o link (ícone de corrente) e mande para quem precisa: abre no mesmo ponto.',
      '<b>A base não sabia?</b> A pergunta entra sozinha na fila para a base aprender. Viu algo num card que vale guardar? <b>Aprender com um card</b>.'
    ]
  },
  steps: [
    {
      id: 'welcome', group: 'Começo', since: 1, phase: 'entry',
      title: 'Bem-vindo à Base Solvace',
      body: 'Tudo o que sabemos sobre os sistemas Solvace: <b>o que cada um faz</b>, as <b>regras de negócio</b> e <b>com quem conversa</b>. ' +
        'É o mesmo conteúdo que o Claude consulta nas análises. O tour leva 2 minutos — dá para pular a qualquer momento.',
      detail: 'A Base Solvace junta a <b>engenharia reversa</b> de cada sistema (legado, revamp, apps, integrações, login, AWS) e as ' +
        '<b>regras de negócio do Knowledge Center</b> (ART-n). Serve para QA, suporte, gestores e desenvolvedores entenderem um ' +
        'sistema sem abrir o código — e é a mesma base que o Claude lê antes de analisar um card.'
    },
    {
      id: 'ai-setup', anchor: 'kb-ai-setup', group: 'Configuração inicial', since: 1, phase: 'entry', side: 'bottom', align: 'end',
      title: '1. Configure a sua IA',
      body: 'O <b>Pergunte</b> e o <b>Aprender com um card</b> usam a IA com a <b>sua chave de API</b>. Aqui você vê se ela está pronta; ' +
        'clicando, abre <b>Minhas integrações</b> para configurar.',
      detail: 'Em <b>Minhas integrações</b>, configure o plugin <b>AI Configurations</b> (o provedor: Claude, Gemini ou OpenAI) e o plugin ' +
        'do provedor com a sua <b>ApiKey</b>. Com o <b>Claude</b>, o Pergunte também aceita <b>prints, PDFs e logs</b> anexados. ' +
        'O custo sai dos seus créditos — acompanhe em <b>Meu consumo de IA</b>. Sem IA, a busca por palavra continua funcionando.'
    },
    {
      id: 'user-menu', anchor: 'user-menu', group: 'Configuração inicial', since: 1, phase: 'entry', side: 'bottom', align: 'end',
      title: '2. O seu menu',
      body: 'Pela sua foto: <b>Minhas integrações</b> (a chave da IA), <b>Meu consumo de IA</b> e <b>Skills do Claude</b> — para usar esta ' +
        'mesma base de dentro do Claude Code.',
      detail: '<b>Minhas integrações</b>: as credenciais pessoais (IA, DevOps, GitHub, Teams). <b>Meu consumo de IA</b>: quanto as ações ' +
        'de IA custaram, por tipo. <b>Skills do Claude</b>: instala as skills do PRMake no Claude Code (uma vez; se atualizam sozinhas) — ' +
        'a skill <code>base-solvace</code> e as ferramentas <code>prmake_base_*</code> consultam esta base nas análises.'
    },
    {
      id: 'mode', anchor: 'kb-mode', group: 'Configuração inicial', since: 1, phase: 'entry', side: 'bottom', align: 'end',
      title: '3. Escolha como ler',
      body: '<b>Simples</b>: guia em linguagem do dia a dia, por área de negócio (QA, suporte, gestores). <b>Técnico</b>: a engenharia ' +
        'reversa completa, como o Claude lê. A escolha fica guardada neste navegador.',
      detail: 'No <b>Simples</b> os sistemas aparecem com nomes amigáveis e agrupados por área; cada um abre no guia, e os detalhes ' +
        'técnicos ficam recolhidos. No <b>Técnico</b> aparecem todas as seções (módulos e fluxos, dados, integrações, infra), as ' +
        'armadilhas conhecidas, os números (projetos, seções, ligações) e a situação do Knowledge Center. Dá para trocar a qualquer momento.'
    },
    {
      id: 'ask', anchor: 'kb-ask', group: 'Encontrar respostas', since: 1, phase: 'entry', side: 'bottom', prepare: 'overview',
      title: 'Pergunte com as suas palavras',
      body: 'Escreva o que precisa saber — a IA entende a pergunta, responde e leva ao trecho da base que confirma. ' +
        'Dá para <b>colar um print</b>, arrastar um arquivo ou usar o <b>microfone</b>.',
      detail: 'A resposta vem com o <b>Leia a seção</b> (abre no ponto certo) e os trechos encontrados. Resposta parcial ou nada ' +
        'encontrado? A pergunta entra na <b>fila para a base aprender</b> e aparece o <b>Analisar a fundo e propor uma seção</b>. Os exemplos embaixo da ' +
        'caixa são clicáveis. Usa a sua chave de IA (ver Configuração inicial).'
    },
    {
      id: 'search', anchor: 'kb-search', group: 'Encontrar respostas', since: 1, phase: 'entry', side: 'right', align: 'start', prepare: 'tree',
      title: 'Filtrar e procurar',
      body: 'Digite um nome ou palavra: a lista filtra na hora e, com 3 letras, procura também <b>dentro</b> do conteúdo. ' +
        '<b>Enter</b> numa pergunta chama a IA.',
      detail: 'O filtro procura no nome, nas palavras-chave e nos títulos; os achados no texto aparecem em <b>No conteúdo</b> ' +
        '(passe o mouse para ver o trecho). Quando nada bate pela palavra, aparece <b>Perguntar à IA</b> com o que você digitou.'
    },
    {
      id: 'tree', anchor: 'kb-tree', group: 'Encontrar respostas', since: 1, phase: 'entry', side: 'right', align: 'start', prepare: 'tree',
      title: 'Todos os sistemas',
      body: 'A <b>Visão geral</b>, o <b>mapa</b> e os sistemas — por área no Simples, por tipo no Técnico. Clique num sistema para abrir ' +
        'e na seta para ver as seções.',
      detail: 'No Simples, cada sistema mostra o guia (e, recolhido em <b>Histórico</b>, o que já foi substituído). No Técnico, o número ' +
        'ao lado é a quantidade de seções. No celular, a lista abre pelo botão de menu no topo.'
    },
    {
      id: 'kc', anchor: 'kb-kc', group: 'Encontrar respostas', since: 1, phase: 'entry', side: 'right', align: 'start', prepare: 'tree', optional: true,
      title: 'Regras de negócio (Knowledge Center)',
      body: 'Os artigos do Knowledge Center por categoria, com o número <b>ART-n</b> — o mesmo que as análises citam.',
      detail: 'Os artigos chegam pela sincronização das skills (o selo no topo, no modo Técnico, mostra quando foi a última). ' +
        'Cada artigo abre com as tags, a data no Knowledge Center e o link para copiar.'
    },
    {
      id: 'catalog', anchor: 'kb-catalog', group: 'Encontrar respostas', since: 1, phase: 'entry', side: 'top', prepare: 'overview', optional: true,
      title: 'O catálogo',
      body: 'Os sistemas em cartões, com uma frase do que cada um faz. O ícone de livro indica que o sistema tem <b>guia em linguagem simples</b>.',
      detail: 'No Simples, há também <b>Como o Solvace funciona</b> e o <b>Glossário</b> dos termos técnicos. No Técnico, os ' +
        '<b>hubs</b> — sistemas de que muitos outros dependem (mexer neles costuma afetar vários).'
    },
    {
      id: 'map', anchor: 'kb-map', group: 'Como os sistemas se conectam', since: 1, phase: 'entry', side: 'left', align: 'start', prepare: 'map',
      title: 'O mapa do ecossistema',
      body: 'Quem conversa com quem: eventos, filas, banco, chamadas HTTP e serviços externos. Clique num sistema para ver as ligações dele.',
      detail: 'As ligações são extraídas do código. Pelo mapa você descobre o que pode ser afetado por uma mudança. Dentro de um sistema, ' +
        '<b>ver no mapa</b> abre o mapa já focado nele.'
    },
    {
      id: 'project', anchor: 'kb-project', group: 'Um sistema por dentro', since: 1, phase: 'entry', side: 'bottom', align: 'start', prepare: 'project',
      title: 'Um sistema aberto',
      body: 'O nome, o que ele faz, a área de negócio e se já tem guia em linguagem simples. Acima, o caminho: Base Solvace › área › sistema › seção.',
      detail: 'No Simples, o sistema abre direto no guia. No Técnico aparecem também a chave, o repositório e o commit de onde a ' +
        'engenharia reversa foi gerada, o resumo técnico e as palavras-chave.'
    },
    {
      id: 'link', anchor: 'kb-link', group: 'Um sistema por dentro', since: 1, phase: 'entry', side: 'left', prepare: 'project',
      title: 'Compartilhe o ponto exato',
      body: 'Copia o link desta página: quem abrir cai no mesmo sistema e na mesma seção.',
      detail: 'Todo ponto da base tem endereço próprio — sistema, seção, artigo do Knowledge Center e até o trecho vindo de uma busca. ' +
        'Mande o link num card, no Teams ou num e-mail.'
    },
    {
      id: 'connections', anchor: 'kb-connections', group: 'Um sistema por dentro', since: 1, phase: 'entry', side: 'bottom', prepare: 'project', optional: true,
      title: 'Com quem ele conversa',
      body: 'O que este sistema usa e quem depende dele, em frases. <b>ver no mapa</b> mostra tudo no desenho.',
      detail: 'No Simples: "O que ele faz" e "Quem conversa com ele". No Técnico: <b>Depende de</b> e <b>Usado por</b>, com o tipo de ' +
        'ligação e a evidência no código. Clique num sistema da lista para ir até ele.'
    },
    {
      id: 'tabs', anchor: 'kb-tabs', group: 'Um sistema por dentro', since: 1, phase: 'entry', side: 'bottom', prepare: 'project', optional: true,
      title: 'As seções',
      body: 'Cada aba é uma parte do conteúdo: o guia, como funciona, as regras, as telas… Seção longa ganha um <b>Nesta seção</b> para ' +
        'pular direto ao assunto.',
      detail: 'Os diagramas são desenhados na própria página. No Técnico, a aba <b>Armadilhas</b> lista o que já deu errado neste ' +
        'sistema, ligado aos itens da engenharia reversa; as abas riscadas são histórico (já substituídas pela engenharia reversa).'
    },
    {
      id: 'tech', anchor: 'kb-tech', group: 'Um sistema por dentro', since: 1, phase: 'entry', side: 'top', prepare: 'project', optional: true,
      title: 'Detalhes técnicos',
      body: 'Para quem vai mexer no código: as seções técnicas ficam recolhidas aqui, sem atrapalhar a leitura do guia.',
      detail: 'Abra para ver módulos e fluxos, dados, integrações e infra do sistema — o mesmo que aparece no modo Técnico.'
    },
    {
      id: 'learn', anchor: 'kb-learn', group: 'Ajudar a base a aprender', since: 1, phase: 'entry', side: 'bottom', align: 'end',
      title: 'Aprender com um card',
      body: 'Resolveu um card que ensinou algo? Informe o número e clique em <b>Ler o card</b>: o PRMake lê tudo o que foi feito nele e <b>propõe o que guardar</b> na base.',
      detail: 'Você revisa e edita cada aprendizado (ou escreve um à mão) e envia para a fila de <b>Sugestões</b>: um administrador incorpora — nada é gravado direto na base. Usa a sua chave de IA. ' +
        'As perguntas do Pergunte que a base não soube responder também viram aprendizado.'
    },
    {
      id: 'suggestions', anchor: 'kb-suggestions', group: 'Administração', since: 1, phase: 'entry', side: 'bottom', align: 'end', requires: 'admin',
      title: 'Sugestões (administrador)',
      body: 'O que as análises e o Aprender com um card propuseram. Nada entra sem você: <b>Incorporar com a IA</b>, marcar como aplicada ou descartar.',
      detail: 'Divergências (a base disse uma coisa, o código mostrou outra), aprendizados e sugestões, cada uma com o card de origem. ' +
        '<b>Incorporar com a IA</b> abre a seção com a proposta para você revisar e gravar.'
    },
    {
      id: 'questions', anchor: 'kb-questions', group: 'Administração', since: 1, phase: 'entry', side: 'bottom', align: 'end', requires: 'admin',
      title: 'Perguntas sem resposta (administrador)',
      body: 'A fila do que as pessoas perguntaram e a base ainda não responde — o que falta documentar.',
      detail: 'Cada pergunta pode ser <b>perguntada de novo</b> (e, sem resposta, analisada a fundo para propor a seção), marcada como ' +
        'respondida ou descartada. A skill <code>base-solvace</code> no Claude Code resolve a fila em lote (código → seção certa → publicar).'
    },
    {
      id: 'admin', anchor: 'kb-admin', group: 'Administração', since: 1, phase: 'entry', side: 'top', prepare: 'project', requires: 'admin',
      title: 'Ferramentas da seção (administrador)',
      body: '<b>Editar</b>, ver o <b>Histórico</b>, <b>Sugerir melhoria</b> conversando com a IA, criar <b>Nova seção</b>, ajustar os ' +
        '<b>Dados do projeto</b> e <b>Gerar guia com a IA</b> em linguagem simples.',
      detail: 'Toda edição gera uma versão nova (o histórico guarda as anteriores). <b>Sugerir melhoria</b> conversa com o especialista ' +
        'sobre a seção e aplica a versão proposta só se você aceitar. <b>Gerar guia</b> escreve o guia a partir das seções técnicas — ' +
        'você revisa antes de gravar.'
    },
    {
      id: 'reverse', anchor: 'kb-reverse', group: 'Administração', since: 1, phase: 'entry', side: 'bottom', align: 'start', prepare: 'project',
      requires: 'admin', optional: true,
      title: 'Engenharia reversa (administrador)',
      body: 'Os documentos completos do módulo — cada regra (RN), caso de uso (UC), tela, endpoint e integração com ID — e quantos já foram publicados.',
      detail: 'A engenharia reversa é gerada no Claude Code com a skill <code>/engenharia-reversa</code>, aprovada documento a documento ' +
        'e, publicada, passa a ser a fonte das análises. O link leva à tela de Engenharia reversa do módulo.'
    },
    {
      id: 'done', anchor: 'kb-help', group: 'Começo', since: 1, phase: 'entry', side: 'bottom', align: 'end', prepare: 'overview', guide: false,
      title: 'Pronto! A ajuda fica aqui',
      body: 'Reveja o tour ou leia o guia completo em <b>Como usar esta tela</b>. Comece pelo Pergunte: escreva a sua primeira dúvida.'
    }
  ]
};
