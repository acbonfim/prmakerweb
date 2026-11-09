import {
  SpecialistTool,
  ToolContext,
  askOptions,
  askToParam,
  buildToolViews,
  displayTitle,
  filterTools,
  groupTools,
  initialAnswers,
  missingAnswers,
  previewTasks,
  renderMarkers,
  specialistToolMessage,
  suffixFor,
  toolApplicability,
  toolGroup,
  toolIcon,
  repeatValues
} from './specialist-tools.logic';

const ctx: ToolContext = {
  card: '77434',
  mainBranch: 'hotfix/77434',
  branchesByTarget: { 'release-version': 'hotfix/77434-rv', development: 'hotfix/77434-dev' },
  defaultRepository: 'edv-solvace-api',
  flowTargets: 'development, qa'
};

const F1: SpecialistTool = {
  key: 'pr-para-branch',
  title: 'Abrir PR para uma branch',
  description: 'Branch {branch}{suffix:@target} criada a partir do destino escolhido. Destinos sugeridos: {promotionTargets}.',
  type: 'pull-request',
  when: { type: ['bug', 'user-story'] },
  ask: [
    { key: 'repository', label: 'Repositório', input: 'repository', default: '{repository}' },
    { key: 'target', label: 'Branch de destino', input: 'target-branch', options: ['release-version', 'hotfix-version', 'edge'] }
  ],
  tasks: [
    { title: 'Criar {branch}{suffix:@target} a partir de {ask:target}', kind: 'branch',
      params: { repository: '{ask:repository}', branch: '{branch}{suffix:@target}', source: '{ask:target}' } },
    { title: 'Cherry-pick dos commits do card', kind: 'cherry-pick', params: { commits: 'card' } },
    { title: 'Abrir PR {branch}{suffix:@target} → {ask:target}', kind: 'pr', params: { draft: 'false' } }
  ]
};

describe('0085 r4 — ferramentas do especialista (lógica)', () => {
  describe('toolGroup', () => {
    it('usa o group do catálogo quando é conhecido', () => {
      expect(toolGroup({ key: 'x', title: 'X', group: 'Textos', tasks: [] })).toBe('textos');
      expect(toolGroup({ key: 'x', title: 'X', group: 'Dados/Chamado', tasks: [] })).toBe('dados');
    });
    it('ferramentas conhecidas F1–F15 caem no grupo certo', () => {
      const g = (key: string) => toolGroup({ key, title: key, tasks: [] });
      expect(g('pr-para-branch')).toBe('prs');
      expect(g('promover-revamp')).toBe('prs');
      expect(g('revisar-pr')).toBe('prs');
      expect(g('ajuste-pos-qa')).toBe('ajustes');
      expect(g('corrigir-sonar')).toBe('ajustes');
      expect(g('fechamento-code-fix')).toBe('qa');
      expect(g('validar-em-qa')).toBe('qa');
      expect(g('script-com-chamado')).toBe('dados');
      expect(g('diagnostico-usuario')).toBe('dados');
      expect(g('novo-resumo')).toBe('textos');
    });
    it('desconhecida: palavras da chave/título e depois os kinds', () => {
      expect(toolGroup({ key: 'pr-para-edge', title: 'PR para edge', tasks: [] })).toBe('prs');
      expect(toolGroup({ key: 'x1', title: 'Novo comentário', tasks: [] })).toBe('textos');
      expect(toolGroup({ key: 'x2', title: 'Algo', tasks: [{ title: 't', kind: 'ticket' }] })).toBe('dados');
      expect(toolGroup({ key: 'x3', title: 'Algo', tasks: [{ title: 't', kind: 'code' }] })).toBe('ajustes');
      expect(toolGroup({ key: 'x4', title: 'Algo', tasks: [{ title: 't', kind: 'pr' }] })).toBe('prs');
      expect(toolGroup({ key: 'x5', title: 'Algo', tasks: [{ title: 't', kind: 'devops-action' }] })).toBe('qa');
      expect(toolGroup({ key: 'x6', title: 'Algo', tasks: [] })).toBe('outras');
    });
  });

  it('toolIcon: o do catálogo, o conhecido ou o do grupo', () => {
    expect(toolIcon({ key: 'x', icon: 'rocket' }, 'prs')).toBe('rocket');
    expect(toolIcon({ key: 'promover-revamp' }, 'prs')).toBe('rocket_launch');
    expect(toolIcon({ key: 'nova' }, 'dados')).toBe('storage');
  });

  describe('toolApplicability', () => {
    it('applicable do servidor manda (com o motivo)', () => {
      expect(toolApplicability({ applicable: false, reason: 'Só no revamp' }, 'bug')).toEqual({ applicable: false, reason: 'Só no revamp' });
      expect(toolApplicability({ applicable: false }, 'bug').reason).toBe('Não se aplica a este card.');
      expect(toolApplicability({ applicable: true, when: { type: ['user-story'] } }, 'bug').applicable).toBeTrue();
    });
    it('sem applicable: reserva pelo when.type (tipo do card), não pelo tipo do item', () => {
      expect(toolApplicability({ when: { type: ['bug'] } }, 'user-story')).toEqual({ applicable: false, reason: 'Só para Bug.' });
      expect(toolApplicability({ when: { type: ['bug', 'user-story'] } }, 'user-story').applicable).toBeTrue();
      expect(toolApplicability({ when: null }, 'bug').applicable).toBeTrue();
    });
  });

  describe('buildToolViews / filterTools / groupTools', () => {
    const catalog = {
      templates: [
        F1,
        { key: 'fechamento-code-fix', title: 'Fechamento: PRMake e code-fix', description: 'Gera a descrição/RCA.', type: 'closing', when: { type: ['bug'] }, tasks: [] },
        { key: 'promover-revamp', title: 'Promover para release-version, edge e master', applicable: false, reason: 'Só para repositórios revamp.', tasks: [] },
        { key: 'novo-resumo', title: 'Novo resumo PT/EN no card', tasks: [] }
      ] as SpecialistTool[]
    };

    it('monta as views (aplicáveis primeiro) com tipo do item e cor', () => {
      const v = buildToolViews(catalog, 'bug');
      expect(v.map((x) => x.key)).toEqual(['pr-para-branch', 'fechamento-code-fix', 'novo-resumo', 'promover-revamp']);
      expect(v[0].itemType).toBe('pull-request');
      expect(v[0].color).toBeTruthy();
      expect(v[2].itemType).toBe('task');
      expect(v[3].applicable).toBeFalse();
      expect(v[3].reason).toBe('Só para repositórios revamp.');
    });

    it('US: fechamento de bug vira não aplicável pela reserva', () => {
      const v = buildToolViews(catalog, 'user-story');
      expect(v.find((x) => x.key === 'fechamento-code-fix')?.applicable).toBeFalse();
    });

    it('busca sem acento e por todas as palavras (inclui o nome do grupo)', () => {
      const v = buildToolViews(catalog, 'bug');
      expect(filterTools(v, 'promocao').map((x) => x.key)).toEqual(['pr-para-branch', 'promover-revamp']);
      expect(filterTools(v, 'resumo pt').map((x) => x.key)).toEqual(['novo-resumo']);
      expect(filterTools(v, '').length).toBe(4);
    });

    it('agrupa na ordem fixa e tira grupos vazios', () => {
      const groups = groupTools(buildToolViews(catalog, 'bug'));
      expect(groups.map((g) => g.key)).toEqual(['prs', 'qa', 'textos']);
      expect(groups[0].label).toBe('PRs e promoção');
      expect(groups[0].tools.length).toBe(2);
    });

    it('catálogo vazio/nulo → nada', () => {
      expect(buildToolViews(null, 'bug')).toEqual([]);
      expect(groupTools([])).toEqual([]);
    });
  });

  describe('asks', () => {
    it('askOptions ignora marcador não resolvido', () => {
      expect(askOptions({ options: ['release-version', '{promotionTargets}'] })).toEqual(['release-version']);
      expect(askOptions({ options: '{promotionTargets}' })).toEqual([]);
      expect(askOptions({ options: [{ value: 'a', label: 'A' }] })).toEqual(['a']);
    });
    it('askToParam: destino com opções continua branch picker; select fica com as opções', () => {
      const p = askToParam(F1.ask![1]);
      expect(p.input).toBe('target-branch');
      expect(p.options).toBeNull();
      const s = askToParam({ key: 'classification', label: 'Classificação', input: 'select', options: ['configuration', 'duplicated'] });
      expect(s.input).toBe('select');
      expect(s.options).toEqual(['configuration', 'duplicated']);
      expect(askToParam({ key: 'c', options: ['a', 'b'] }).input).toBe('select');
    });
    it('initialAnswers resolve o default marcador no cliente', () => {
      expect(initialAnswers(F1.ask!, ctx)).toEqual({ repository: 'edv-solvace-api', target: '' });
      expect(initialAnswers([{ key: 'r', default: '{repository}' }], { ...ctx, defaultRepository: null })).toEqual({ r: '' });
    });
    it('missingAnswers: obrigatório a não ser required:false', () => {
      expect(missingAnswers(F1.ask!, { repository: 'x', target: '' })).toEqual(['Branch de destino']);
      expect(missingAnswers([{ key: 'n', label: 'Nota', required: false }], {})).toEqual([]);
    });
  });

  describe('prévia', () => {
    it('suffixFor: da branch por destino, senão o sufixo usual', () => {
      expect(suffixFor('release-version', ctx)).toBe('-rv');
      expect(suffixFor('hotfix-version', ctx)).toBe('-hv');
      expect(suffixFor('edge', ctx)).toBe('-edge');
      expect(suffixFor('master', ctx)).toBe('');
      expect(suffixFor('feature/x', ctx)).toBe('-feature-x');
    });

    it('renderMarkers troca ask, branch+sufixo, repositório e destinos', () => {
      const a = { target: 'release-version', repository: 'edv-solvace' };
      expect(renderMarkers('Criar {branch}{suffix:@target} a partir de {ask:target}', a, ctx)).toBe('Criar hotfix/77434-rv a partir de release-version');
      expect(renderMarkers('{branch}{suffix:@target}', { target: 'edge' }, ctx)).toBe('hotfix/77434-edge');
      expect(renderMarkers('{branch}{suffix:development}', {}, ctx)).toBe('hotfix/77434-dev');
      expect(renderMarkers('Destinos: {flowTargets}', {}, ctx)).toBe('Destinos: development, qa');
      expect(renderMarkers('{repository} {card} {ticketSystem}', {}, ctx)).toBe('edv-solvace-api 77434 {ticketSystem}');
      expect(renderMarkers('{ticketSystem}', {}, ctx, { keepUnknown: false })).toBe('');
    });

    it('catálogo já renderizou {branch}: o sufixo cola na branch do card', () => {
      expect(renderMarkers('Criar hotfix/77434{suffix:@target}', { target: 'release-version' }, ctx)).toBe('Criar hotfix/77434-rv');
      // Padrão de produção com prefixo: a branch por destino inteira.
      const prod = { ...ctx, branchesByTarget: { 'release-version': '_hotfix/77434-rv' } };
      expect(renderMarkers('{branch}{suffix:@target}', { target: 'release-version' }, prod)).toBe('_hotfix/77434-rv');
    });

    it('sem resposta: "…" no lugar do ask', () => {
      expect(renderMarkers('PR → {ask:target}', {}, ctx)).toBe('PR → …');
      expect(renderMarkers('{branch}{suffix:@target}', {}, ctx)).toBe('hotfix/77434-…');
      expect(displayTitle('Resolver conflito do PR para {ask:target}', [])).toBe('Resolver conflito do PR para …');
      expect(displayTitle('Resolver conflito do PR para {ask:target}', [], { target: 'edge' })).toBe('Resolver conflito do PR para edge');
    });

    it('previewTasks: títulos e parâmetros com valor', () => {
      const p = previewTasks(F1, { repository: 'edv-solvace-api', target: 'release-version' }, ctx);
      expect(p.map((t) => t.title)).toEqual([
        'Criar hotfix/77434-rv a partir de release-version',
        'Cherry-pick dos commits do card',
        'Abrir PR hotfix/77434-rv → release-version'
      ]);
      expect(p[0].params).toEqual([
        { key: 'repository', value: 'edv-solvace-api' },
        { key: 'branch', value: 'hotfix/77434-rv' },
        { key: 'source', value: 'release-version' }
      ]);
      expect(p[0].kind).toBe('branch');
    });

    it('{promotionTargets} usa as opções do ask', () => {
      const d = previewTasks({ tasks: [{ title: F1.description!, kind: 'manual' }], ask: F1.ask }, {}, ctx)[0].title;
      expect(d).toContain('Destinos sugeridos: release-version, hotfix-version, edge.');
    });
  });

  it('specialistToolMessage: @especialista, título, chave, respostas, tipo e observação', () => {
    const msg = specialistToolMessage({ key: 'pr-para-branch', title: 'Abrir PR para uma branch' }, F1.ask!,
      { repository: 'edv-solvace-api', target: 'release-version' }, 'PR antigo fechado', 'pull-request');
    expect(msg.startsWith('@especialista Use a ferramenta "Abrir PR para uma branch" (pr-para-branch) com: Repositório: edv-solvace-api; Branch de destino: release-version.')).toBeTrue();
    expect(msg).toContain('Tipo do item: pull-request.');
    expect(msg).toContain('Observação: PR antigo fechado');
    expect(msg).toContain('prmake_tool_run');
    const bare = specialistToolMessage({ key: 'novo-resumo', title: 'Novo resumo' }, [], {});
    expect(bare.split('\n')[0]).toBe('@especialista Use a ferramenta "Novo resumo" (novo-resumo).');
  });
  describe('0092 — validar em ambiente', () => {
    const VAL: SpecialistTool = {
      key: 'validar-em-ambiente',
      title: 'Validar em ambiente',
      type: 'validation',
      ask: [
        { key: 'environments', label: 'Ambientes', input: 'environments', default: 'dev, qa',
          options: [{ value: 'dev', label: 'Desenvolvimento · devsp.solvacelabs.com' }, { value: 'qa', label: 'QA · qa.solvacelabs.com' }] },
        { key: 'plant', label: 'Planta', required: false }
      ],
      tasks: [
        { title: 'Validar em {eachLabel}', kind: 'env-validation', repeat: '{ask:environments}', params: { environment: '{each}', plant: '{ask:plant}' } },
        { title: 'Avisar no card', kind: 'notify' }
      ]
    };

    it('grupo QA e ícone próprio', () => {
      expect(toolGroup(VAL)).toBe('qa');
      expect(toolIcon(VAL, 'qa')).toBe('screenshot_monitor');
    });

    it('input environments mantém as opções (não vira select)', () => {
      const p = askToParam(VAL.ask![0]);
      expect(p.input).toBe('environments');
      expect(p.options?.length).toBe(2);
    });

    it('repeat: uma sub-tarefa por ambiente, com {each} e {eachLabel}', () => {
      const p = previewTasks(VAL, { environments: 'dev, https://gerdau.solvacelabs.com/', plant: 'COR' }, ctx);
      expect(p.map((t) => t.title)).toEqual([
        'Validar em Desenvolvimento · devsp.solvacelabs.com',
        'Validar em https://gerdau.solvacelabs.com/',
        'Avisar no card'
      ]);
      expect(p[1].params).toEqual([{ key: 'environment', value: 'https://gerdau.solvacelabs.com/' }, { key: 'plant', value: 'COR' }]);
    });

    it('repeat sem valor não gera a sub-tarefa; sem repeat gera uma', () => {
      expect(previewTasks(VAL, { environments: '' }, ctx).map((t) => t.kind)).toEqual(['notify']);
      expect(repeatValues({ repeat: null }, [], {}, ctx)).toEqual([null]);
      expect(repeatValues({ repeat: '{ask:environments}' }, VAL.ask!, { environments: 'qa;dev;qa' }, ctx).map((x) => x?.label))
        .toEqual(['QA · qa.solvacelabs.com', 'Desenvolvimento · devsp.solvacelabs.com']);
    });
  });
});
