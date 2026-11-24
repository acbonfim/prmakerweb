import { AwsCardState } from './aws-deploy.model';

/**
 * 0100: retrato de exemplo (formato do `AwsCardSnapshot` do plan.md, card 77971 / edv-solvace-apps: em DEV e QA, não em
 * Sandboxefeso nem em produção) — para os testes e para desenvolver a aba sem a coleta. Não é importado pelo app.
 */
export const AWS_CARD_STATE_MOCK: AwsCardState = {
  collectedAt: '2026-11-24T19:30:00Z',
  collectedBy: 'alex.carlos',
  executorOnline: true,
  refresh: null,
  snapshot: {
    version: 1,
    card: 77971,
    requestId: null,
    collectedAt: '2026-11-24T19:30:00Z',
    collectedBy: 'alex.carlos',
    machine: 'MacBook-Alex',
    durationMs: 8123,
    account: '367983645102',
    region: 'us-east-1',
    index: { total: 1078, upserted: 3, removed: 0, updatedAt: '2026-11-24T19:29:50Z' },
    repositories: [{
      repository: 'electradv/edv-solvace-apps', localPath: true, fetchedAt: '2026-11-24T19:29:40Z', files: 12,
      branches: ['bugfix/77971-dev', 'bugfix/77971-qa'],
      commits: [
        { sha: '38f2a1a9c1d2e3f40000000000000000000000aa', title: 'Merge pull request #14929 from electradv/bugfix/77971-qa\n\nAB#77971 plano de ação: data de conclusão', date: '2026-11-21T14:02:00Z' },
        { sha: '9b1c0de1234567890000000000000000000000bb', title: 'AB#77971 fix: data de conclusão no plano de ação', date: '2026-11-20T18:40:00Z' }
      ]
    }],
    environments: [
      {
        key: 'dev', label: 'DEV', host: 'devsp.solvacelabs.com', tier: 'dev', verdict: 'deployed', message: 'Nosso código está em DEV',
        pipelines: [{
          name: 'edv-solvace-action-plan-dev', repository: 'electradv/edv-solvace-apps', branch: 'development', status: 'Succeeded',
          stage: 'Deploy', lastRunAt: '2026-11-21T13:10:00Z', lastRunEndedAt: '2026-11-21T13:16:00Z', durationSec: 360, trigger: 'WebhookV2',
          deployedSha: '7d0e11aa000000000000000000000000000000cc', deployedMessage: 'Merge pull request #14920 from electradv/bugfix/77971-dev',
          deployedAt: '2026-11-21T13:16:00Z', inBranch: true, deployed: true, verdict: 'deployed',
          consoleUrl: 'https://us-east-1.console.aws.amazon.com/codesuite/codepipeline/pipelines/edv-solvace-action-plan-dev/view',
          buildUrl: 'https://us-east-1.console.aws.amazon.com/codesuite/codebuild/projects/edv-solvace-action-plan-dev/history',
          primary: true
        }, {
          name: 'edv-solvace-rdc-dev', repository: 'electradv/edv-solvace-apps', branch: 'development', status: 'Succeeded',
          lastRunAt: '2026-11-19T09:00:00Z', durationSec: 120, deployedSha: '1122aabb000000000000000000000000000000ff',
          deployedMessage: 'Merge pull request #14890', inBranch: true, deployed: false, verdict: 'waiting', primary: false
        }],
        logs: [{ group: '/aws/devsp/actionplan', url: 'https://console.aws.amazon.com/cloudwatch/home#logsV2:log-groups', lastEventAt: '2026-11-24T19:00:00Z', errors: [] }],
        resources: { cloudfront: { id: 'E1ABCDEF', aliases: ['devsp.solvacelabs.com'] }, elasticBeanstalk: [] }
      },
      {
        key: 'qa', label: 'QA', host: 'qa.solvacelabs.com', tier: 'qa', verdict: 'deployed', message: 'Nosso código está em QA',
        pipelines: [{
          name: 'edv-solvace-action-plan-qa', repository: 'electradv/edv-solvace-apps', branch: 'qa', status: 'Succeeded', stage: 'Build',
          lastRunAt: '2026-11-21T14:05:00Z', lastRunEndedAt: '2026-11-21T14:10:54Z', durationSec: 354, trigger: 'WebhookV2',
          deployedSha: '38f2a1a9c1d2e3f40000000000000000000000aa', deployedMessage: 'Merge pull request #14929 from electradv/bugfix/77971-qa\n\nAB#77971',
          deployedAt: '2026-11-21T14:10:54Z', inBranch: true, deployed: true, verdict: 'deployed',
          consoleUrl: 'https://us-east-1.console.aws.amazon.com/codesuite/codepipeline/pipelines/edv-solvace-action-plan-qa/view',
          buildUrl: null, action: null, latest: { status: 'InProgress', sha: 'aa11bb22000000000000000000000000000000dd', startedAt: '2026-11-24T19:25:00Z' }
        }],
        logs: [{
          group: '/aws/qa/actionplan', url: null, lastEventAt: '2026-11-24T19:20:00Z',
          errors: [{ at: '2026-11-24T18:02:00Z', message: 'System.NullReferenceException: Object reference not set to an instance of an object.\n   at ActionPlan.Service.Close()' }]
        }],
        resources: { cloudfront: { id: 'E2QAQAQA', aliases: ['qa.solvacelabs.com'] }, elasticBeanstalk: ['Qa-Solvacelabs'] }
      },
      {
        key: 'sandboxefeso', label: 'Sandboxefeso', host: 'sandboxefeso.solvacelabs.com', tier: 'rc', verdict: 'absent',
        message: 'Ainda não está em Sandboxefeso',
        pipelines: [{
          name: 'edv-solvace-action-plan-rc', repository: 'electradv/edv-solvace-apps', branch: 'release-version', status: 'Failed',
          stage: 'Build', lastRunAt: '2026-11-22T10:00:00Z', durationSec: 95, trigger: 'WebhookV2',
          deployedSha: '55aa66bb000000000000000000000000000000ee', deployedMessage: 'Merge pull request #14800 from electradv/release-version',
          deployedAt: '2026-11-18T09:00:00Z', inBranch: false, deployed: false, verdict: 'absent',
          consoleUrl: 'https://us-east-1.console.aws.amazon.com/codesuite/codepipeline/pipelines/edv-solvace-action-plan-rc/view',
          failedLogTail: ['npm ERR! code ELIFECYCLE', 'npm ERR! errno 1', 'npm ERR! action-plan@1.0.0 build: `ng build`']
        }]
      },
      { key: 'sandboxrt', label: 'SandboxRT', host: 'sandboxrt.solvacelabs.com', tier: 'rt', verdict: 'not-applicable', pipelines: [] },
      { key: 'prod', label: 'Produção', host: 'efeso.solvacelabs.com', tier: 'prod', verdict: 'unknown', pipelines: [] }
    ],
    resources: {
      lambdas: [{ name: 'actionplan-notifier-qa', runtime: 'nodejs20.x', lastModified: '2026-11-10T12:00:00Z' }],
      alarms: [{ name: 'qa-actionplan-5xx', state: 'ALARM', since: '2026-11-24T18:00:00Z', reason: 'Threshold Crossed: 5 datapoints > 10' }]
    },
    denied: ['ecs', 'eks', 'ecr'],
    warnings: ['CloudFront: sem distribuição para efeso.solvacelabs.com']
  }
};
