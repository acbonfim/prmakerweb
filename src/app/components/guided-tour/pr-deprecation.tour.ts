import { TourDefinition } from './tour.model';

/**
 * 0087: tour do desligamento da tela de Pull Request. Abre sozinho (uma vez por versão) ao entrar na tela, antes de
 * qualquer outro tour, e pode ser aberto de novo pelo botão "Ver como funciona" do aviso fixo no topo. Os passos sem
 * `anchor` aparecem no centro da tela; o que aponta para elemento usa `data-tour` do aviso (register.component.html).
 * Mudou o destino de alguma função? Ajuste o passo e suba `version`.
 */
export const PR_DEPRECATION_TOUR: TourDefinition = {
  id: 'pr-deprecation',
  version: 1,
  title: 'A tela de Pull Request será desligada',
  doneText: 'Entendi',
  help: { subtitle: 'O tratamento do card passa para a Bancada.' },
  steps: [
    {
      id: 'welcome', group: 'Aviso', since: 1, phase: 'entry',
      title: 'Esta tela será desligada',
      body: 'Todo o tratamento do card passa a ser feito pela <b>Bancada</b>. Ela faz tudo o que esta tela faz e mais. ' +
        'Leva 1 minuto para ver onde fica cada coisa.',
      detail: 'A tela de Pull Request será desligada. O tratamento do card — plano, PRs, Especialista do caso, linha do tempo — ' +
        'continua, só que na Bancada, que ainda tem os itens de trabalho e os arquivos do card.'
    },
    {
      id: 'go', anchor: 'pr-deprecation-go', group: 'Aviso', since: 1, phase: 'entry', side: 'bottom', align: 'end',
      title: 'Seu card abre direto na Bancada',
      body: 'Este botão leva para a <b>Bancada</b> já com o card que você está vendo (ou em branco, se ainda não buscou nenhum).',
      detail: 'O botão do aviso abre a Bancada com o mesmo card. Também dá para abrir pelo menu lateral (ícone de ferramentas).'
    },
    {
      id: 'map', group: 'Onde fica cada coisa', since: 1, phase: 'entry',
      title: 'Onde fica cada coisa na Bancada',
      body: '<b>Itens de trabalho</b>: o que fazer no card, cada um com suas sub-tarefas.<br>' +
        '<b>Execução</b>: o que o Claude está fazendo agora.<br>' +
        '<b>Arquivos</b>: análises, chamados, scripts e anexos.<br>' +
        '<b>Card</b>: horas, dados e o texto do card.<br>' +
        '<b>PRs</b> (botão no topo): pull requests e ações do GitHub e do DevOps.<br>' +
        '<b>Especialista</b> (lateral) e <b>Linha do tempo</b> (botão).',
      detail: 'Itens de trabalho, Execução, Arquivos e Card são abas da coluna principal; o Especialista do caso fica na lateral; ' +
        'PRs e Linha do tempo são botões da barra do card.'
    },
    {
      id: 'execution', group: 'Onde fica cada coisa', since: 1, phase: 'entry',
      title: 'A aba Execução só acompanha',
      body: 'Ela <b>mostra ao vivo</b> o que o Claude está fazendo num item de trabalho, faz as <b>perguntas</b> dele e recebe as ' +
        '<b>suas respostas</b>. Não é onde o trabalho é organizado — isso é nos <b>itens</b>.',
      detail: 'A antiga tela de plano virou a aba Execução: um item de trabalho tem uma execução, e ela mostra os passos, as perguntas ' +
        'e respostas e a atividade do Claude em tempo real.'
    },
    {
      id: 'files', group: 'Onde fica cada coisa', since: 1, phase: 'entry',
      title: 'Todos os arquivos, em um lugar',
      body: 'Na aba <b>Arquivos</b> ficam as análises, os chamados, os scripts e os dados do card inteiro — com filtro por item de trabalho. ' +
        'Cada item também mostra só os seus.',
      detail: 'A aba Arquivos lista tudo o que foi gerado ou anexado no card, de qualquer item; os chips filtram por item. ' +
        'Dentro de um item, a seção Arquivos mostra só os dele.'
    }
  ]
};
