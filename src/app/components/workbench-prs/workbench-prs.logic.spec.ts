import { GithubPullRequest } from '../../services/pull-request.service';
import { buildBranchSuggestions, defaultTarget, parseActiveBranches, parseActiveRepositories, prCountsLabel, splitBranch } from './workbench-prs.logic';

const pr = (status: GithubPullRequest['status']) => ({ status } as GithubPullRequest);

describe('workbench-prs.logic (0085)', () => {
  it('splitBranch separa prefixo e nome pela última barra', () => {
    expect(splitBranch('hotfix/77434-rv')).toEqual({ prefix: 'hotfix/', name: '77434-rv' });
    expect(splitBranch('feature/team/123')).toEqual({ prefix: 'feature/team/', name: '123' });
    expect(splitBranch('77434', 'feature/')).toEqual({ prefix: 'feature/', name: '77434' });
  });

  it('parseActiveBranches aceita JSON e o literal JS do plugin', () => {
    expect(parseActiveBranches('[{"label":"QA","branchName":"qa"}]')).toEqual([{ label: 'QA', value: 'qa' }]);
    expect(parseActiveBranches("[{label:'RV', branchName:'release-version'}]")).toEqual([{ label: 'RV', value: 'release-version' }]);
    expect(parseActiveBranches('lixo{')).toEqual([]);
    expect(parseActiveBranches(null)).toEqual([]);
  });

  it('parseActiveRepositories lê [{label,value}]', () => {
    expect(parseActiveRepositories('[{"label":"API","value":"api"}]')).toEqual([{ label: 'API', value: 'api' }]);
    expect(parseActiveRepositories('x')).toEqual([]);
  });

  it('defaultTarget: último usado, senão development, senão o primeiro', () => {
    const opts = [{ label: 'QA', value: 'qa' }, { label: 'DEV', value: 'development' }];
    expect(defaultTarget(opts, 'qa')).toBe('qa');
    expect(defaultTarget(opts, 'edge')).toBe('development');
    expect(defaultTarget([{ label: 'QA', value: 'qa' }], null)).toBe('qa');
  });

  it('prCountsLabel resume por status', () => {
    expect(prCountsLabel([])).toBe('nenhum PR');
    expect(prCountsLabel([pr('OPEN'), pr('MERGED'), pr('MERGED')])).toBe('1 aberto · 2 mesclados');
  });

  describe('buildBranchSuggestions (rodada 6)', () => {
    const options = [{ label: 'DEV', value: 'development' }, { label: 'QA', value: 'qa' }, { label: 'RV', value: 'release-version' }];
    const byTarget = { development: 'feature/77988-dev', qa: 'feature/77988-qa', 'release-version': 'feature/77988-rv' };

    it('sem regras, nada a sugerir', () => {
      expect(buildBranchSuggestions(null, options)).toEqual([]);
    });

    it('revamp-backend: só os destinos do fluxo do repositório — sem QA', () => {
      const list = buildBranchSuggestions({
        mainBranch: 'feature/77988', branchesByTarget: byTarget, repository: 'revamp-Users', repoKind: 'revamp-backend',
        repositoryTargets: [{ target: 'development', branch: 'feature/77988-dev' }],
      }, options);
      expect(list.map(s => s.branch)).toEqual(['feature/77988', 'feature/77988-dev']);
      expect(list.some(s => s.target === 'qa')).toBeFalse();
    });

    it('repositório fora das regras: todos os destinos do plugin que têm branch', () => {
      const list = buildBranchSuggestions({ mainBranch: 'hotfix/77434', branchesByTarget: { development: 'hotfix/77434-dev', qa: 'hotfix/77434-qa' }, repositoryTargets: [] }, options);
      expect(list.map(s => s.target)).toEqual([null, 'development', 'qa']);
    });

    it('destino do fluxo fora do plugin (release-version) usa o próprio nome como rótulo', () => {
      const list = buildBranchSuggestions({
        mainBranch: 'feature/77988', repositoryTargets: [{ target: 'edge', branch: 'feature/77988-edge' }],
      }, options);
      expect(list[1]).toEqual(jasmine.objectContaining({ label: 'edge', branch: 'feature/77988-edge', target: 'edge' }));
    });

    it('a principal não se repete como destino', () => {
      const list = buildBranchSuggestions({ mainBranch: 'hotfix/1', repositoryTargets: [{ target: 'master', branch: 'hotfix/1' }] }, options);
      expect(list.length).toBe(1);
    });
  });
});
