import { TourDefinition } from './tour.model';

/**
 * 0085: tour da Bancada do card (`auth/workbench`). Os passos apontam para `data-tour` do template da página
 * (workbench.component.html) e, quando existir, dos botões da lista de itens (`wi-new`, `wi-run` — opcionais).
 * `prepare: 'tab:<aba>'` pede para a página abrir a aba certa (Itens | Plano | Especialista | Card) antes do passo.
 * Mudou o uso da tela? Ajuste o passo e suba `version` (e o `since` dos passos novos/alterados).
 * v2 (ajustes da 0085): etiquetas do card, robô/conexão, botão Card (horas + texto), timeline num botão, especialista
 * na lateral inteira, sugestões (situação/assistente) e a sugestão de análise inicial.
 * v3: o popover do botão Card virou a aba **Card** da coluna principal (horas, lançar +1h/+2h/+4h/outro, dados e texto
 * do card) e a linha de horas fica ao lado das abas Itens | Plano | Card.
 * v4 (rodada 3): a aba Plano virou **Execução** — o plano é por item de trabalho (seletor dos itens com plano, sem
 * "Análise v1 / Correção v2"); item fechado = criar outro item (na tela ou pelo especialista).
 * v5 (rodada 4): **Ferramentas do especialista** — botão no topo da coluna do especialista (e ao lado de "+ Novo item")
 * com os atalhos do dia a dia que criam o item já montado.
 * v6 (rodada 5): botão **Card** abre o card num modal (mesma animação da timeline); aba Card sem espaços vazios; na
 * Execução, Pausar/Continuar no menu ⋮ do plano e a faixa fixa **Arquivos do plano** + "Ver o plano completo"; na barra,
 * quem iniciou o card no PRMake.
 * v7 (0087): a **Execução** é só acompanhamento (o que o Claude faz num item, perguntas/respostas, ao vivo) e a nova aba
 * **Arquivos** mostra todos os arquivos do card com filtro por item; itens e sub-tarefas trazem código/linha com popover.
 */
export const WORKBENCH_TOUR: TourDefinition = {
  id: 'workbench',
  version: 7,
  title: 'Como usar a Bancada do card',
  steps: [
    {
      id: 'welcome', group: 'Começo', since: 1, phase: 'entry',
      title: 'Bancada do card',
      body: 'Aqui o card é trabalhado: <b>itens de trabalho</b>, o <b>plano</b> do Claude, o <b>Especialista do caso</b> e a ' +
        '<b>timeline</b>, tudo numa tela. Leva 1 minuto.',
      detail: 'A Bancada junta o que se faz num card: os itens de trabalho (cada um com sub-tarefas), o plano de execução da ' +
        'análise/correção, a conversa com o Especialista do caso, o texto do card e a timeline. A tela de Pull Request continua ' +
        'igual para salvar descrição, root cause e PRs.'
    },
    {
      id: 'search', anchor: 'wb-search', group: 'Começo', since: 1, phase: 'entry', side: 'bottom', align: 'start', interactive: true,
      title: 'Comece pelo número do card',
      body: 'Digite o número e aperte <b>Enter</b>. O endereço da página guarda o card — dá para mandar o link.',
      detail: 'Digite o número do card e aperte Enter (ou a lupa). O link da página leva o card (<code>?card=</code>) e pode levar ' +
        'um item (<code>&item=</code>) ou a parte da tela (<code>&focus=plan|items|timeline|chat</code>).'
    },
    {
      id: 'card', anchor: 'wb-card', group: 'O card', since: 2, phase: 'card', side: 'bottom', align: 'start',
      title: 'Bug ou User Story',
      body: 'O ícone mostra o tipo: <b>joaninha</b> = Bug, <b>livrinho</b> = User Story. À direita, os avisos do card no DevOps.',
      detail: 'O tipo do card decide o texto mostrado (Repro Steps no Bug, critérios de aceite na US), o botão de análise e o tipo ' +
        'padrão dos itens novos. O ⓘ abre todos os campos, o histórico e os comentários; a seta abre o card no DevOps.'
    },
    {
      id: 'facts', anchor: 'wb-facts', group: 'O card', since: 6, phase: 'card', side: 'bottom', align: 'start',
      title: 'Etiquetas do card',
      body: 'A mesma barra da tela de PR: quem abriu no DevOps, quem <b>iniciou no PRMake</b>, <b>estado</b>, ambiente, módulo, produção/release, prioridade, responsável, ' +
        'horas restantes, <b>plano</b> e <b>situação atual</b>.',
      detail: 'Passe o mouse numa etiqueta para ver o detalhe (coluna e raia do board, etapa da situação…). As cores avisam: verde ' +
        'concluído, âmbar pedindo atenção, azul em andamento.'
    },
    {
      id: 'status', anchor: 'wb-status', group: 'O card', since: 2, phase: 'card', side: 'bottom', align: 'end', optional: true,
      title: 'O Claude está trabalhando?',
      body: 'O <b>robô</b> se mexe quando o Claude está rodando (ampulheta = na fila). <b>Wi-fi cortado</b> = sem sinal do Claude; ' +
        '<b>nuvem cortada</b> = a tela perdeu o tempo real.',
      detail: 'Vale em qualquer aba. Clique no robô para ver o que o Claude está fazendo agora (máquina, atividade ao vivo) ou ir ' +
        'aos itens em execução. Sem sinal do Claude, o menu do ícone retoma a sessão; sem tempo real, o clique reconecta e recarrega a Bancada.'
    },
    {
      id: 'analyze', anchor: 'wb-analyze', group: 'O card', since: 1, phase: 'card', side: 'bottom', align: 'end', optional: true,
      title: 'Pedir a análise',
      body: '<b>Analisar bug</b> (ou <b>Analisar US</b>) manda o Claude analisar o card pela fila de execução.',
      detail: 'O pedido vai para a fila e roda no seu executor. A análise vira um item de trabalho e o andamento aparece na aba ' +
        'Execução; com um plano em andamento o botão fica desligado (continue pelo próprio item). Feita a análise, o botão some — ' +
        'ele volta só se a análise for cancelada, falhar ou for desfeita.'
    },
    {
      id: 'prs', anchor: 'wb-prs', group: 'O card', since: 1, phase: 'card', side: 'bottom', align: 'end', optional: true,
      title: 'PRs e Ações DevOps',
      body: '<b>PRs</b> mostra os pull requests do card e abre o modal com a lista, o "Abrir PR" e as ações do GitHub. ' +
        '<b>Ações DevOps</b> mexe no card: mover o estado, publicar o Root Cause e o resumo, ver os detalhes.',
      detail: 'O número ao lado de PRs conta os PRs do card. As Ações DevOps ficam na barra do card (e não no modal de PRs) ' +
        'porque valem para o card inteiro — as mesmas da tela de Pull Request, com as regras do seu usuário.'
    },
    {
      id: 'hours', anchor: 'wb-card-pane', group: 'O card', since: 6, phase: 'card', side: 'left', align: 'start', optional: true,
      prepare: 'tab:card',
      title: 'Aba Card: horas e texto',
      body: 'A aba <b>Card</b> reúne as horas (lance <b>+1h</b>, <b>+2h</b>, <b>+4h</b> ou outro valor), os dados principais e o texto ' +
        'do card. O botão <b>Card</b> da barra abre o mesmo conteúdo num modal; a linha de horas fica sempre ao lado das abas.',
      detail: 'No Bug, as horas lançadas comparadas com a média dos bugs (acima ou abaixo); na US, o planejado × o realizado. ' +
        'Lançar horas pede uma confirmação curta e grava no DevOps (soma em Completed e tira do Remaining). Também ficam aqui ' +
        'estado, área, iteração, responsável, prioridade, datas, anexos/links e o texto (Repro Steps no Bug; descrição e ' +
        'critérios de aceite na US). No celular, é a aba "Card".'
    },
    {
      id: 'timeline', anchor: 'wb-timeline-btn', group: 'O card', since: 2, phase: 'card', side: 'bottom', align: 'end',
      title: 'Linha do tempo',
      body: 'Tudo o que aconteceu no card, num botão — abre em tela cheia, como na tela de PR.',
      detail: 'Comentários, publicações, Teams e registros das skills. O número conta as entradas; dá para escrever direto na ' +
        'timeline pelo rodapé dela. O espaço da lateral agora é todo do Especialista do caso.'
    },
    {
      id: 'first-analysis', anchor: 'wb-first-analysis', group: 'Itens de trabalho', since: 2, phase: 'card', side: 'bottom', align: 'start',
      optional: true, prepare: 'tab:items',
      title: 'Comece pela análise inicial',
      body: 'Card sem plano e sem itens? <b>Começar a análise inicial</b> manda o Claude analisar o bug (ou a US).',
      detail: 'A análise cria sozinha o item "Análise inicial…" com uma sub-tarefa por etapa e, ao final, os itens de trabalho da ' +
        'entrega com as sub-tarefas. Tudo aparece na lista, ao vivo.'
    },
    {
      id: 'suggest', anchor: 'wb-suggest', group: 'Itens de trabalho', since: 2, phase: 'card', side: 'bottom', align: 'start',
      optional: true, prepare: 'tab:items',
      title: 'Situação e sugestões',
      body: 'Como na tela de PR: a <b>situação atual</b> do card (o que é aguardado e desde quando) e as <b>sugestões do PRMake</b>.',
      detail: 'A situação pode ser copiada ou publicada no DevOps; as sugestões (estimativa, publicação, horas) não travam nada. ' +
        'Na aba Plano elas ficam no próprio plano.'
    },
    {
      id: 'items', anchor: 'wb-items', group: 'Itens de trabalho', since: 1, phase: 'card', side: 'right', align: 'start', prepare: 'tab:items',
      title: 'Itens de trabalho',
      body: 'Cada item é uma entrega do card (ex.: <i>PR para release-version</i>) com sub-tarefas em ordem. Clique para expandir.',
      detail: 'Um card pode ter vários itens; cada um roda em paralelo aos outros, e as sub-tarefas de um item rodam na ordem. ' +
        'Expanda o item para ver as sub-tarefas e o status de cada uma; clique no número para abrir o item completo.'
    },
    {
      id: 'new-item', anchor: 'wi-new', group: 'Itens de trabalho', since: 1, phase: 'card', side: 'bottom', optional: true, prepare: 'tab:items',
      title: 'Novo item',
      body: 'Crie um item a partir de um modelo pronto ou do zero. O PRMake avisa se já existe um item igual.',
      detail: 'Modelos prontos já trazem as sub-tarefas (branch, cherry-pick, PR…) preenchidas para o card. Só itens que ainda ' +
        'não começaram podem ser editados; um item iniciado pode servir de base para um novo.'
    },
    {
      id: 'run', anchor: 'wi-run', group: 'Itens de trabalho', since: 2, phase: 'card', side: 'bottom', optional: true, prepare: 'tab:items',
      title: 'Executar (▶)',
      body: 'O <b>▶</b> manda o item para o Claude. A <b>sessão de execução</b> abre ao lado, ao vivo: o item fica "trabalhando" e ' +
        'cada sub-tarefa passa para em andamento / concluída na hora.',
      detail: 'O item vai para a fila e roda no executor. A sessão de execução mostra tudo o que o Claude está fazendo naquele ' +
        'item (atividade, sub-tarefas e o registro em tempo real); com vários itens rodando, cada um tem a sua aba e o botão ' +
        '"Sessão de execução (n)" volta para ela. Sub-tarefas suas (ex.: validar) esperam você marcar como feitas.'
    },
    {
      id: 'plan', anchor: 'wb-plan', group: 'Execução', since: 7, phase: 'card', side: 'right', align: 'start', prepare: 'tab:plan',
      title: 'Execução: só acompanha',
      body: 'Esta aba <b>mostra ao vivo</b> o que o Claude está fazendo num item de trabalho — os passos, as <b>perguntas</b> dele e as ' +
        '<b>suas respostas</b>. Escolha o item no seletor. Organizar o trabalho é nos <b>itens</b>; os arquivos, na aba <b>Arquivos</b>.',
      detail: 'A Execução não organiza nada: ela exibe a execução de um item de trabalho (etapas, perguntas e respostas, atividade do ' +
        'Claude em tempo real). Não há mais "Análise v1 / Correção v2": a versão é o próprio item, analisado e refinado. O seletor abre ' +
        'no item em andamento (ou no mais recente); o "Abrir plano" de um item leva direto a ele. Item concluído ou cancelado é uma ' +
        'versão fechada — para mudar, cancele o item ou crie outro (+ Novo item, ou peça ao especialista).'
    },
    {
      id: 'files', anchor: 'wb-files-tab', group: 'Arquivos', since: 7, phase: 'card', side: 'bottom', align: 'start',
      title: 'Todos os arquivos do card',
      body: 'Como nos <b>Textos do card</b>: a lista de arquivos à esquerda e a visualização à direita. As <b>abas</b> separam textos, análises, ' +
        'chamados, scripts, dados e anexos, e o filtro mostra só os de um <b>item de trabalho</b>. Cada item também mostra só os seus.',
      detail: 'A aba Arquivos lista tudo o que foi gerado ou anexado no card, inclusive os arquivos de versões antigas do plano ' +
        '(filtro "Sem item"). Escolha um arquivo na lista para ver o conteúdo ao lado (código, markdown, imagem), baixe ou copie; ' +
        'o chamado tem o botão "Copiar chamado". Na Execução, "Arquivos do item" abre esta aba já filtrada.'
    },
    {
      id: 'rich-items', anchor: 'wb-items', group: 'Itens de trabalho', since: 7, phase: 'card', side: 'right', align: 'start', prepare: 'tab:items',
      title: 'Cada item diz o que será feito',
      body: 'Abra um item para ver <b>cada passo e cada alteração</b>: o arquivo e a linha (clique no link para ver o código e o diff), ' +
        'as regras da Base Solvace e os arquivos e imagens do item.',
      detail: 'Itens e sub-tarefas de código trazem a descrição do que muda, o link <code>caminho:linhas</code> que abre o popover com o ' +
        'código atual e o diff, os itens da engenharia reversa (<code>modulo#RN-012</code>) e os arquivos do item na visão geral.'
    },
    {
      id: 'plan-files', anchor: 'plan-files-bar', group: 'Execução', since: 6, phase: 'card', side: 'bottom', align: 'start',
      optional: true, prepare: 'tab:plan',
      title: 'Arquivos do plano',
      body: 'Os arquivos do plano (análise, scripts, chamados) ficam sempre aqui — abra ou baixe — com o <b>Ver o plano completo</b> ao lado.',
      detail: 'Clique no nome para abrir no visualizador; a seta baixa o arquivo; ".zip" baixa todos. <b>Pausar</b>, ' +
        '<b>Continuar</b> e <b>Continuar com Claude</b> ficam no menu <b>⋮</b> do cabeçalho do plano. Em User Story o plano ' +
        'se chama <b>Plano de implementação</b>.'
    },
    {
      id: 'cancel', anchor: 'wb-cancel-plan', group: 'Execução', since: 1, phase: 'card', side: 'bottom', optional: true, prepare: 'tab:plan',
      title: 'Cancelar e desfazer',
      body: 'Para o item em execução (o plano e os itens dele) — e, se você marcar, <b>desfaz</b> o que já foi feito (fecha PRs, apaga branches criadas…).',
      detail: 'O desfazer vira um pedido na fila e roda em ordem reversa. Para só mudar o rumo do plano, prefira conversar com ' +
        'o Especialista do caso.'
    },
    {
      id: 'chat', anchor: 'wb-chat', group: 'Conversa e histórico', since: 2, phase: 'card', side: 'left', align: 'start', prepare: 'tab:chat',
      title: 'Especialista do caso',
      body: 'A lateral é do especialista: dúvidas, discordâncias e pedidos de itens novos — ele conhece o card, o plano e as regras.',
      detail: 'O especialista responde com código, banco (só leitura) e a Base Solvace, e pode criar itens de trabalho (sem ' +
        'repetir os que existem) — é assim que um item fechado ganha a sua continuação. Nada muda sem você aceitar. Na conversa ' +
        'grande (ícone de expandir) ficam as <b>Ferramentas</b>: atalhos do dia a dia que criam o item já montado (PR para uma ' +
        'branch, promoção para release-version/edge, ajuste pós-QA, fechamento, script com chamado…).'
    },
    {
      id: 'help', anchor: 'wb-help', group: 'Começo', since: 1, phase: 'card', side: 'bottom', align: 'end', guide: false,
      title: 'Pronto! A ajuda fica aqui',
      body: 'Reveja o tour ou leia o guia completo em <b>Como usar esta tela</b>.'
    }
  ],
  help: {
    subtitle: 'Itens de trabalho, plano, especialista e timeline do card numa tela só',
    tips: [
      '<b>Uma entrega = um item.</b> Cada item tem sub-tarefas em ordem e roda em paralelo aos outros itens do card.',
      '<b>Dúvida ou pedido novo?</b> Fale com o <b>Especialista do caso</b> — ele cria itens sem repetir os que já existem.',
      '<b>Tarefa do dia a dia?</b> Abra a conversa grande do especialista e use as <b>Ferramentas</b> (PR para uma branch, promoção, fechamento…): o item sai pronto.',
      '<b>A versão é o item.</b> Precisa mudar algo de um item fechado? Crie outro item (na tela ou pelo especialista).',
      '<b>Errou o caminho?</b> "Cancelar e desfazer" fecha PRs e apaga branches criadas, sempre pelo PRMake.'
    ]
  }
};
