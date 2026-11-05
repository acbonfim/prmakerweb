import { TourDefinition } from './tour.model';

/**
 * 0085: tour da Bancada do card (`auth/workbench`). Os passos apontam para `data-tour` do template da página
 * (workbench.component.html) e, quando existir, dos botões da lista de itens (`wi-new`, `wi-run` — opcionais).
 * `prepare: 'tab:<aba>'` pede para a página abrir a aba certa (Itens | Plano | Especialista | Card) antes do passo.
 * Mudou o uso da tela? Ajuste o passo e suba `version` (e o `since` dos passos novos/alterados).
 */
export const WORKBENCH_TOUR: TourDefinition = {
  id: 'workbench',
  version: 1,
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
      id: 'card', anchor: 'wb-card', group: 'O card', since: 1, phase: 'card', side: 'bottom', align: 'start',
      title: 'Bug ou User Story',
      body: 'O ícone mostra o tipo: <b>joaninha</b> = Bug, <b>livrinho</b> = User Story. Ao lado, estado, área e responsável no DevOps.',
      detail: 'O tipo do card decide o texto mostrado (Repro Steps no Bug, critérios de aceite na US), o botão de análise e o tipo ' +
        'padrão dos itens novos. O ⓘ abre todos os campos, o histórico e os comentários; a seta abre o card no DevOps.'
    },
    {
      id: 'analyze', anchor: 'wb-analyze', group: 'O card', since: 1, phase: 'card', side: 'bottom', align: 'end', optional: true,
      title: 'Pedir a análise',
      body: '<b>Analisar bug</b> (ou <b>Analisar US</b>) manda o Claude analisar o card pela fila de execução.',
      detail: 'O pedido vai para a fila e roda no seu executor. O andamento aparece no plano; com um plano em andamento o botão ' +
        'fica desligado (continue pelo próprio plano).'
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
      id: 'run', anchor: 'wi-run', group: 'Itens de trabalho', since: 1, phase: 'card', side: 'bottom', optional: true, prepare: 'tab:items',
      title: 'Executar',
      body: '<b>Executar</b> manda o item para o Claude. As sub-tarefas atualizam ao vivo.',
      detail: 'O item vai para a fila e roda no executor. Sub-tarefas suas (ex.: validar) esperam você marcar como feitas.'
    },
    {
      id: 'plan', anchor: 'wb-plan', group: 'Plano', since: 1, phase: 'card', side: 'right', align: 'start', prepare: 'tab:plan',
      title: 'O plano do Claude',
      body: 'A análise e a correção do card, etapa por etapa, ao vivo. Perguntas do plano são respondidas na própria etapa.',
      detail: 'É o mesmo plano da tela de Pull Request. Em cards com itens, a aba Itens fica em evidência; em cards antigos (sem ' +
        'itens), o plano.'
    },
    {
      id: 'cancel', anchor: 'wb-cancel-plan', group: 'Plano', since: 1, phase: 'card', side: 'bottom', optional: true, prepare: 'tab:plan',
      title: 'Cancelar e desfazer',
      body: 'Para o plano e os itens dele — e, se você marcar, <b>desfaz</b> o que já foi feito (fecha PRs, apaga branches criadas…).',
      detail: 'O desfazer vira um pedido na fila e roda em ordem reversa. Para só mudar o rumo do plano, prefira conversar com ' +
        'o Especialista do caso.'
    },
    {
      id: 'chat', anchor: 'wb-chat', group: 'Conversa e histórico', since: 1, phase: 'card', side: 'left', align: 'start', prepare: 'tab:chat',
      title: 'Especialista do caso',
      body: 'Dúvidas, discordâncias e pedidos de itens novos vão para o especialista — ele conhece o card, o plano e as regras.',
      detail: 'O especialista responde com código, banco (só leitura) e a Base Solvace, e pode propor itens de trabalho ou uma ' +
        'nova versão do plano — nada muda sem você aceitar.'
    },
    {
      id: 'timeline', anchor: 'wb-timeline', group: 'Conversa e histórico', since: 1, phase: 'card', side: 'left', align: 'start', prepare: 'tab:card',
      title: 'Timeline',
      body: 'Tudo o que aconteceu no card. O botão do canto abre em tela cheia.',
      detail: 'Comentários, publicações e registros das skills. Dá para escrever direto na timeline pelo rodapé dela.'
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
      '<b>Errou o caminho?</b> "Cancelar e desfazer" fecha PRs e apaga branches criadas, sempre pelo PRMake.'
    ]
  }
};
