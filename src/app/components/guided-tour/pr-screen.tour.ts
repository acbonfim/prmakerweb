import { TourDefinition } from './tour.model';

/**
 * 0081: tour da tela do card (Gerenciamento de tratamento do card). Os passos apontam para `data-tour` nos templates
 * (register, execution-plan, case-compact); a ordem aqui é a ordem do tour e das seções do guia.
 * Mudou a tela de um jeito que muda o uso? Ajuste o passo e suba `version` (e o `since` dos passos novos/alterados).
 */
export const PR_SCREEN_TOUR: TourDefinition = {
  id: 'pr-screen',
  version: 1,
  title: 'Como usar a tela do card',
  steps: [
    {
      id: 'welcome', group: 'Começo', since: 1, phase: 'entry',
      title: 'Nova tela de tratamento do card',
      body: 'O plano do Claude ao vivo, o <b>Especialista do caso</b> para tirar dúvidas e a linha do tempo no topo. ' +
        'Leva 1 minuto — dá para pular a qualquer momento.',
      detail: 'Esta tela concentra o tratamento do card: o <b>plano de execução</b> (o que o Claude vai fazer e já fez), o ' +
        '<b>Especialista do caso</b> (conversa sobre o card, sem mexer no plano), os <b>PRs</b> do card e as ações de GitHub e DevOps.'
    },
    {
      id: 'card-search', anchor: 'card-search', group: 'Começo', since: 1, phase: 'entry', side: 'bottom', align: 'start', interactive: true,
      title: 'Comece pelo número do card',
      body: 'Digite o número e aperte <b>Enter</b>. Abrindo pela Home, o card já vem preenchido.',
      detail: 'Digite o número do card e aperte Enter (ou a lupa). Pela Home, clicar num card abre esta tela já com ele. ' +
        'O endereço da página guarda o card: dá para mandar o link para alguém.'
    },
    {
      id: 'plan', anchor: 'plan-header', group: 'Plano de execução', since: 1, phase: 'card', side: 'bottom', mobileTab: 'plan',
      title: 'O plano do Claude, ao vivo',
      body: 'Aqui o Claude mostra o que vai fazer e o que já fez, etapa por etapa. Ao lado do título, o status: rodando, pausado, concluído…',
      detail: 'O plano é montado pela skill de análise e atualizado em tempo real — não precisa recarregar a página. ' +
        'Cada etapa mostra o que foi feito, os arquivos gerados e, quando for o caso, uma pergunta para você.'
    },
    {
      id: 'journey', anchor: 'plan-journey', group: 'Plano de execução', since: 1, phase: 'card', side: 'bottom', mobileTab: 'plan', optional: true,
      title: 'Em que fase o card está',
      body: 'Análise → Decisões → Correção → QA → Fechamento. Cada card tem a sua jornada; clique numa fase para ver aquele plano.',
      detail: 'A jornada é montada do histórico do próprio card. Uma versão nova do plano aparece como v2, v3…; uma correção ' +
        'cancelada fica marcada como cancelada. Clique numa fase para ver o plano dela.'
    },
    {
      id: 'headline', anchor: 'plan-headline', group: 'Plano de execução', since: 1, phase: 'card', side: 'bottom', mobileTab: 'plan', optional: true,
      title: 'Em que pé está',
      body: 'O resumo em uma frase: o que está acontecendo agora e se alguma coisa <b>espera por você</b>.',
      detail: 'Se o resumo disser que algo espera por você (uma pergunta, uma decisão, um teste), responda na etapa indicada: ' +
        'é isso que faz o plano andar.'
    },
    {
      id: 'decisions', anchor: 'plan-decisions', group: 'Plano de execução', since: 1, phase: 'card', side: 'top', mobileTab: 'plan', optional: true,
      title: 'Decisões tomadas',
      body: 'O que já foi decidido neste card. Para mudar uma decisão, converse com o especialista — não cancele o plano.',
      detail: 'As respostas às perguntas da análise viram decisões. Mudar uma delas é uma conversa com o Especialista do caso: ' +
        'ele propõe a nova versão do plano e você aceita.'
    },
    {
      id: 'steps', anchor: 'plan-steps', group: 'Plano de execução', since: 1, phase: 'card', side: 'left', align: 'start', mobileTab: 'plan',
      title: 'Etapas e perguntas',
      body: 'Quando uma etapa pergunta algo, <b>responda nela</b>. Dúvidas e discordâncias vão para o especialista, não para comentários soltos.',
      detail: 'Etapas concluídas ficam agrupadas no começo. Uma etapa "aguardando você" traz a pergunta e as opções: responda ali ' +
        'mesmo. Comentários no plano viram instrução para o Claude (ele retoma na hora) — para perguntar ou discutir, use o especialista.'
    },
    {
      id: 'run', anchor: 'plan-run', group: 'Plano de execução', since: 1, phase: 'card', side: 'bottom', mobileTab: 'plan',
      title: 'O Claude está trabalhando?',
      body: 'Este ícone <b>se mexe</b> enquanto o Claude trabalha. Clique para ver a máquina, o que ele faz agora e as últimas atividades.',
      detail: 'Parado, o ícone fica discreto; na fila, ampulheta; rodando, ele se mexe. O popover mostra a máquina, desde quando, ' +
        'quem pediu, a atividade ao vivo e as últimas atividades, com o botão <b>Parar</b>. Se aparecer o ícone de <b>sem sinal</b> ' +
        'ao lado, a sessão pode ter caído: clique nele para retomar.'
    },
    {
      id: 'controls', anchor: 'plan-control', group: 'Plano de execução', since: 1, phase: 'card', side: 'bottom', mobileTab: 'plan', optional: true,
      title: 'Pausar, continuar, pedir ao Claude',
      body: '<b>Pausar</b> para na próxima checagem; <b>Continuar</b> retoma de onde parou; <b>Analisar/Continuar com Claude</b> roda na sua máquina, sem terminal.',
      detail: 'O executor (prmake-agent) da sua máquina roda o Claude sem abrir o terminal. Sem executor instalado, use ' +
        '"Retomar no Claude" no menu ⋯ para copiar o comando do terminal.'
    },
    {
      id: 'specialist', anchor: 'plan-spec', group: 'Especialista do caso', since: 1, phase: 'card', side: 'bottom', mobileTab: 'plan',
      title: 'Dúvida? Fale com o Especialista do caso',
      body: 'Perguntas, discordâncias e "por que fez isso?" vão para ele. Conhece o caso inteiro e <b>não muda o plano sozinho</b>.',
      detail: 'O especialista é um agente separado do tratamento: lê o card, os planos, as decisões, o código e o banco (só leitura), ' +
        'gera imagens e arquivos e responde em segundos. Ele nunca altera o plano por conta própria.'
    },
    {
      id: 'compact', anchor: 'case-compact', group: 'Especialista do caso', since: 1, phase: 'card', side: 'left', align: 'start', mobileTab: 'timeline',
      title: 'A conversa fica sempre à vista',
      body: 'As mensagens chegam ao vivo, mesmo com a conversa grande fechada. Veja o que ele está fazendo e quem está digitando.',
      detail: 'Outras pessoas do caso podem participar da mesma conversa. Com mais de uma pessoa, chame o especialista com ' +
        '<b>@Especialista</b> ou termine com "?". O botão ⤢ abre a conversa grande, com voz, contexto, pontos combinados e arquivos — ' +
        'fechar e abrir de novo não perde nada.'
    },
    {
      id: 'composer', anchor: 'case-composer', group: 'Especialista do caso', since: 1, phase: 'card', side: 'top', mobileTab: 'timeline',
      title: 'Escreva, cole um print, anexe',
      body: '<b>Enter</b> envia. Cole imagens (Ctrl+V) ou arraste arquivos. Para mandar áudio, abra a conversa grande.',
      detail: 'O rascunho é o mesmo na versão compacta e na conversa grande. Na grande dá para gravar áudio (é transcrito), marcar ' +
        '"só entre pessoas" e pedir uma investigação a fundo.'
    },
    {
      id: 'proposal', anchor: ['case-proposal', 'case-compact'], group: 'Especialista do caso', since: 1, phase: 'card', side: 'left', mobileTab: 'timeline',
      title: 'Nada muda no plano sem você',
      body: 'Chegando a uma conclusão, o especialista <b>propõe uma nova versão</b> do plano. Veja o que muda e aceite — só então ela é montada.',
      detail: '"Ver o que muda" compara a versão atual com a proposta. Aceitar vira uma instrução para o Claude do tratamento, que ' +
        'monta a nova versão (a anterior fica no histórico). Quem aceita: o dono do plano, um admin ou um gestor. Ações com efeito ' +
        'fora da conversa (subir arquivo, publicar no DevOps) também só rodam depois que você confirma.'
    },
    {
      id: 'files', anchor: 'plan-files', group: 'Plano de execução', since: 1, phase: 'card', side: 'bottom', mobileTab: 'plan', optional: true,
      title: 'Arquivos e textos',
      body: 'Scripts, análises, textos do chamado e anexos. Dá para editar, gerar de novo e baixar tudo em .zip.',
      detail: 'Os arquivos são separados por fase (análise e correção). Os textos do card (root cause, resumo, chamado) podem ser ' +
        'editados, gerados de novo e enviados por aqui.'
    },
    {
      id: 'more', anchor: 'plan-more', group: 'Plano de execução', since: 1, phase: 'card', side: 'bottom', align: 'end', mobileTab: 'plan', optional: true,
      title: 'Histórico e cancelar',
      body: 'Versões anteriores, retomar no terminal e cancelar. Antes de cancelar, diga o motivo — ou <b>converse com o especialista</b>.',
      detail: 'Cancelar pede o motivo (vai para a próxima versão e para o especialista) e oferece "Conversar primeiro": muitas vezes ' +
        'o problema se resolve com uma nova versão, sem perder o trabalho. PRs abertos continuam abertos.'
    },
    {
      id: 'timeline', anchor: 'timeline', group: 'Card e ações', since: 1, phase: 'card', side: 'bottom',
      title: 'Linha do tempo, agora aqui',
      body: 'Comentários, mensagens do Teams e publicações do card. Abre em tela cheia.',
      detail: 'A linha do tempo saiu da coluna da direita (que agora é do especialista). O que você estiver escrevendo nela continua ' +
        'lá quando fechar.'
    },
    {
      id: 'root-cause', anchor: 'root-cause', group: 'Card e ações', since: 1, phase: 'card', side: 'bottom', optional: true,
      title: 'Root Cause',
      body: 'Escreva ou revise a causa raiz — uma só para todos os repositórios.',
    },
    {
      id: 'actions', anchor: 'footer-actions', group: 'Card e ações', since: 1, phase: 'card', side: 'top',
      title: 'Ações do card',
      body: 'Abrir PR, Salvar, Ações DevOps (mover o card, publicar o root cause) e Ações inteligentes.',
      detail: 'No celular, o que não cabe vai para o ⋯. Mover o card no DevOps e publicar textos também passam por aqui.'
    },
    {
      id: 'help', anchor: 'tour-help', group: 'Começo', since: 1, phase: 'card', side: 'bottom', align: 'start', guide: false,
      title: 'Pronto! A ajuda fica aqui',
      body: 'Reveja o tour ou leia o guia completo em <b>Como usar esta tela</b>.',
    }
  ]
};
