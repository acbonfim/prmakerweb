import { GithubPullRequest } from '../../services/pull-request.service';
import { defaultTarget, parseActiveBranches, parseActiveRepositories, prCountsLabel, splitBranch } from './workbench-prs.logic';

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
});
