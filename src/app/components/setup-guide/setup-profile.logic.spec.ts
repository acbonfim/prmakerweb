import { UserIntegration } from '../../services/user-integration.service';
import { ExecutionDoctorCheck } from '../execution-plan/execution-queue.model';
import {
  agentOutdated, checkApplies, effectiveProfile, integrationsForProfile, isAiIntegration, profileErrors, profileProblems,
  workerProblemCount
} from './setup-profile.logic';

const check = (name: string, ok = false, extra: Partial<ExecutionDoctorCheck> = {}): ExecutionDoctorCheck => ({ name, ok, ...extra });
const integ = (description: string, extra: Partial<UserIntegration> = {}): UserIntegration =>
  ({ pluginId: description.length, description, configured: false, fields: [], updatedAt: null, ...extra });

describe('setup-profile.logic (0099 ajustes 2 — primeiros passos por papel)', () => {
  it('perfil: o do servidor vence o dos papéis', () => {
    expect(effectiveProfile({ profile: 'management' }, 'dev')).toBe('management');
    expect(effectiveProfile({ profile: 'dev' }, 'management')).toBe('dev');
    expect(effectiveProfile({ profile: null }, 'management')).toBe('management');
    expect(effectiveProfile(null, 'dev')).toBe('dev');
    expect(effectiveProfile({ profile: 'outro' }, 'dev')).toBe('dev');
  });

  it('dev: todo check vale', () => {
    for (const n of ['Workspace', 'Banco prod', 'Ferramenta git', 'Claude Code']) expect(checkApplies(check(n), 'dev')).toBeTrue();
  });

  it('management: repositórios, bancos, git, AWS e NuGet não são do perfil', () => {
    for (const n of ['Workspace', 'Mapa de repositórios', 'Ferramenta git', 'CLI da AWS (aba AWS)', 'Skill aws-deploy',
      'NuGet CodeArtifact', 'Acesso aos bancos (SQL Server)', 'Banco prod3', 'REVAMP_DIR']) {
      expect(checkApplies(check(n), 'management')).withContext(n).toBeFalse();
    }
    for (const n of ['Claude Code', 'Login do Claude Code', 'Skills do PRMake', 'api-key do usuário', 'Credencial do executor',
      'MCP do PRMake', 'Ferramenta bash', 'Ferramenta jq']) {
      expect(checkApplies(check(n), 'management')).withContext(n).toBeTrue();
    }
  });

  it('requiredFor do servidor vence a regra local (lista ou texto)', () => {
    expect(checkApplies(check('Workspace', false, { requiredFor: ['management', 'dev'] }), 'management')).toBeTrue();
    expect(checkApplies(check('Claude Code', false, { requiredFor: 'dev' }), 'management')).toBeFalse();
    expect(checkApplies(check('X', false, { requiredFor: 'all' }), 'management')).toBeTrue();
    expect(checkApplies(check('X', false, { requiredFor: [] }), 'management')).toBeTrue();
  });

  it('doctorRequiredFor da máquina (formato do servidor) vale pelo nome do check', () => {
    const map = { 'Workspace': ['dev', 'management'], 'Claude Code': ['dev'] };
    expect(checkApplies(check('Workspace'), 'management', map)).toBeTrue();
    expect(checkApplies(check('claude code'), 'management', map)).toBeFalse();
    expect(checkApplies(check('Banco prod'), 'management', map)).toBeFalse(); // fora do mapa: regra local
    expect(checkApplies(check('Claude Code', false, { requiredFor: 'all' }), 'management', map)).toBeTrue(); // o do check vence
  });

  it('contagem de problemas: profileDoctorProblems do servidor quando o perfil bate', () => {
    const doctor = [check('Workspace'), check('Skills do PRMake'), check('Login do Claude Code', false, { severity: 'warning' })];
    const base = { doctor, doctorProblems: 3 };
    expect(workerProblemCount({ ...base, profile: 'management', profileDoctorProblems: 2 }, 'management')).toBe(2);
    expect(workerProblemCount({ ...base, profile: null, profileDoctorProblems: null }, 'management')).toBe(1);
    expect(workerProblemCount({ ...base, profile: null }, 'dev')).toBe(3);
  });

  it('erros do perfil ignoram avisos e checks fora do perfil', () => {
    const doctor = [
      check('Claude Code', true), check('Login do Claude Code', false, { severity: 'warning' }),
      check('Workspace', false, { severity: 'error' }), check('Ferramenta git', false), check('Skills do PRMake', false)
    ];
    expect(profileErrors(doctor, 'management').map(c => c.name)).toEqual(['Skills do PRMake']);
    expect(profileErrors(doctor, 'dev').map(c => c.name)).toEqual(['Workspace', 'Ferramenta git', 'Skills do PRMake']);
    const problems = profileProblems(doctor, 'management');
    expect(problems.map(p => [p.name, p.notNeeded])).toEqual([
      ['Skills do PRMake', false], ['Login do Claude Code', false], ['Workspace', true], ['Ferramenta git', true]
    ]);
  });

  it('executor desatualizado só quando a versão publicada é mais nova', () => {
    expect(agentOutdated({ agentVersion: '1.0.9', latestAgentVersion: '1.0.10' })).toBeTrue();
    expect(agentOutdated({ agentVersion: '1.2.0', latestAgentVersion: '1.2.0' })).toBeFalse();
    expect(agentOutdated({ agentVersion: '1.3.0', latestAgentVersion: '1.2.9' })).toBeFalse();
    expect(agentOutdated({ agentVersion: null, latestAgentVersion: '1.0.0' })).toBeFalse();
  });

  it('integrações: management vê Azure DevOps (obrigatório) e IA (opcional); o resto some', () => {
    const list = [
      integ('AzureDevOps Configurations', { optional: true }), integ('Github Configurations'), integ('AI Configurations'),
      integ('Claude Plugin'), integ('Gemini Plugin', { optional: false }), integ('Teams Configurations')
    ];
    expect(integrationsForProfile(list, 'dev').length).toBe(6);
    const m = integrationsForProfile(list, 'management');
    expect(m.map(i => [i.description, !!i.optional])).toEqual([
      ['AzureDevOps Configurations', false], ['AI Configurations', true], ['Claude Plugin', true], ['Gemini Plugin', true]
    ]);
    expect(list[0].optional).toBeTrue(); // não altera a lista original
    expect(isAiIntegration('OpenAI Plugin')).toBeTrue();
    expect(isAiIntegration('Teams Configurations')).toBeFalse();
  });
});
