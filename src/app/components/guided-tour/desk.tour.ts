import { TourDefinition } from './tour.model';

/**
 * 0099: tour da Mesa de gestão (`auth/desk`). Os passos apontam para `data-tour` do template da página
 * (desk.component.html). A fase "card" aqui é **um épico aberto** (o `TourHost.hasCard` da Mesa). `prepare: 'tab:<aba>'`
 * pede para a página abrir a aba (Board | Itens | Cards | Arquivos | Relatado | Especialista) antes do passo.
 * Mudou o uso da tela? Ajuste o passo e suba `version` (e o `since` dos passos novos/alterados).
 */
export const DESK_TOUR: TourDefinition = {
  id: 'desk',
  version: 1,
  title: 'Como usar a Mesa de gestão',
  steps: [
    {
      id: 'welcome', group: 'Começo', since: 1, phase: 'entry',
      title: 'Mesa de gestão',
      body: 'Aqui se <b>gere</b>: relatórios de bugs, duplicados, entendimento de cards, RCAs em PDF e os cards do DevOps — ' +
        'organizados em <b>épicos</b>. A Bancada continua sendo onde um card é trabalhado.',
      detail: 'A Mesa é o par da Bancada. Cada épico é um tema de trabalho com as suas tarefas de gestão (itens com sub-tarefas ' +
        'que o Claude executa), os cards do DevOps que fazem parte dele, os arquivos gerados (relatórios, PDFs) e a conversa com o ' +
        'Especialista de gestão.'
    },
    {
      id: 'rail', anchor: 'dk-rail', group: 'Começo', since: 1, phase: 'entry', side: 'right', align: 'start',
      title: 'Seus épicos',
      body: 'A lista de épicos: busque por título, tag ou <b>#número</b>, filtre <b>meus/todos</b> e por status. A cor ajuda a achar.',
      detail: 'O filtro "Meus" mostra os épicos que você criou. Os status são Ativo, Pausado, Concluído e Arquivado ("Abertos" = ' +
        'ativos + pausados). A seta recolhe a lista para sobrar espaço.'
    },
    {
      id: 'new', anchor: 'dk-new', group: 'Começo', since: 1, phase: 'entry', side: 'right', align: 'start',
      title: 'Novo épico',
      body: 'Dê um título, uma descrição, a cor, as tags e o <b>time/board</b> do DevOps que o épico usa.',
      detail: 'O número do épico é da mesma sequência dos itens de trabalho: <code>#n</code> numa conversa (aqui ou na Bancada) ' +
        'identifica sem ambiguidade um épico, um item ou uma sub-tarefa — e o popover mostra o que é.'
    },
    {
      id: 'search', anchor: 'dk-search', group: 'Começo', since: 1, phase: 'entry', side: 'bottom', align: 'end', interactive: true,
      title: 'Trabalhar direto num card',
      body: 'Digite o número de um card do DevOps e aperte <b>Enter</b>: o painel do card abre com campos, tags, coluna e comentário — com ou sem épico.',
      detail: 'No painel do card dá para editar os campos (listas com autocompletar), as tags (inclusive criar tag nova), mover de ' +
        'coluna/raia, comentar, adicionar ao épico aberto ou abrir o card na Bancada.'
    },
    {
      id: 'epic', anchor: 'dk-epic', group: 'O épico', since: 1, phase: 'card', side: 'bottom', align: 'start',
      title: 'O épico aberto',
      body: 'Número com a cor, título, <b>status</b> (clique para mudar), tags e as contagens de cards e tarefas. O lápis edita.',
      detail: 'O status muda pelo menu: Ativo, Pausado, Concluído ou Arquivado. Se o épico tiver um card do DevOps que o representa ' +
        '(Epic/Feature), o link aparece aqui.'
    },
    {
      id: 'board', anchor: 'dk-board', group: 'O épico', since: 1, phase: 'card', side: 'top', align: 'center', prepare: 'tab:board',
      title: 'Board do DevOps',
      body: 'As colunas e raias do board do time, como no DevOps: <b>arraste</b> os cards para mudar de coluna, raia ou ordem.',
      detail: 'Por padrão o board mostra só os cards do épico; a alternância mostra o board inteiro do time. Colunas e estados novos ' +
        'no DevOps aparecem sozinhos. Clique num cartão para abrir o painel do card.'
    },
    {
      id: 'items', anchor: 'dk-items', group: 'O épico', since: 1, phase: 'card', side: 'top', align: 'center', prepare: 'tab:items',
      title: 'Tarefas de gestão',
      body: 'Os itens de trabalho do épico: <b>relatório</b>, <b>duplicados</b>, <b>entendimento</b>, <b>RCA</b>, gestão de cards, planejamento — cada um com sub-tarefas.',
      detail: 'Use os modelos prontos (relatório de bugs, itens duplicados, entendimento de card, RCA em PDF, criar histórias) ou peça ' +
        'ao especialista. O Claude executa as sub-tarefas e grava os arquivos (markdown e PDF) na aba Arquivos.'
    },
    {
      id: 'cards', anchor: 'dk-cards', group: 'O épico', since: 1, phase: 'card', side: 'top', align: 'center', prepare: 'tab:cards',
      title: 'Cards do épico',
      body: 'Os cards do DevOps que fazem parte do épico: criados aqui, adicionados à mão ou que mencionaram o épico (<code>#n</code>).',
      detail: 'Adicione um card pelo número, remova os que não fazem mais parte, abra o painel do card ou leve o card para a Bancada.'
    },
    {
      id: 'files', anchor: 'dk-files-tab', group: 'O épico', since: 1, phase: 'card', side: 'bottom', align: 'start', prepare: 'tab:files',
      title: 'Arquivos e relatados',
      body: '<b>Arquivos</b>: relatórios, PDFs e anexos das tarefas. <b>Relatado</b>: itens de outros cards/épicos ligados a este por menção.',
      detail: 'Os arquivos têm filtro por tarefa e o visualizador de sempre. Os relatados são somente leitura — servem de contexto ' +
        'para o especialista.'
    },
    {
      id: 'chat', anchor: 'dk-chat', group: 'Conversa', since: 1, phase: 'card', side: 'left', align: 'start', prepare: 'tab:chat',
      title: 'Especialista de gestão',
      body: 'Peça em português: relatórios, duplicados, criar/editar/mover cards, quebrar o épico em histórias, resumo semanal…',
      detail: 'O especialista conhece o épico, os cards, o board e as regras de gestão. Ele grava tudo pelo PRMake com a sua ' +
        'integração do DevOps e confirma antes de mexer em muitos cards de uma vez.'
    },
    {
      id: 'help', anchor: 'dk-help', group: 'Começo', since: 1, phase: 'card', side: 'bottom', align: 'end', guide: false,
      title: 'Pronto! A ajuda fica aqui',
      body: 'Reveja o tour ou leia o guia completo em <b>Como usar esta tela</b>.'
    }
  ],
  help: {
    subtitle: 'Épicos, tarefas de gestão, cards e board do DevOps e o Especialista de gestão numa tela só',
    tips: [
      '<b>Um tema = um épico.</b> Relatório do mês, limpeza de duplicados, planejamento de uma entrega…',
      '<b>Números compartilhados.</b> <code>#n</code> funciona aqui e na Bancada — épico, item ou sub-tarefa.',
      '<b>Sem épico?</b> Busque o card pelo número no topo e trabalhe nele direto.',
      '<b>Tudo pelo PRMake.</b> As gravações no DevOps usam a sua integração pessoal — o próprio DevOps limita o que cada um pode fazer.'
    ]
  }
};
