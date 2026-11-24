import { UserIntegration } from '../../services/user-integration.service';
import { ExecutionDoctorCheck, ExecutionWorker } from '../execution-plan/execution-queue.model';

/**
 * 0099 (ajustes 2): primeiros passos e diagnóstico (doctor) por perfil. Quem só tem o papel `management` (PO / gestor de
 * problemas: sem git, código nem banco do cliente) precisa de pouco: Claude Code (+ login), Azure DevOps (provedor de IA
 * opcional), skills do PRMake (+ api-key) e o executor online e atualizado. O resto do doctor aparece como "não necessário
 * para o seu perfil" — nunca como erro. O servidor manda na máquina (`GET ExecutionWorker/mine`) o `profile`, o
 * `doctorRequiredFor` (por nome do check, os perfis que precisam dele) e o `profileDoctorProblems`; quando vêm, valem mais
 * que a regra local (que é a mesma do servidor, para máquinas/respostas antigas). Lógica pura (sem Angular).
 */

export type SetupProfile = 'management' | 'dev';

export const NOT_NEEDED_TEXT = 'não necessário para o seu perfil';

/** Checks do doctor que só o perfil de dev precisa (repositórios, git, AWS, NuGet, bancos). */
const DEV_ONLY_CHECKS = [
  'Workspace', 'Mapa de repositórios', 'EDV_SOLVACE_DIR', 'REVAMP_DIR', 'Ferramenta git', 'CLI da AWS (aba AWS)',
  'Skill aws-deploy', 'NuGet CodeArtifact', 'Acesso aos bancos (SQL Server)'
];

/** Perfil efetivo: o que o servidor disse da máquina (sabe os papéis do dono) ou o dos papéis de quem está logado. */
export function effectiveProfile(worker: Pick<ExecutionWorker, 'profile'> | null | undefined, fromRoles: SetupProfile): SetupProfile {
  const p = `${worker?.profile ?? ''}`.toLowerCase();
  return p === 'management' || p === 'dev' ? p : fromRoles;
}

/** Exigências por check vindas do servidor (`doctorRequiredFor` da máquina). */
export type DoctorRequiredFor = Record<string, readonly string[]> | null | undefined;

function requiredList(raw: unknown): string[] {
  return (Array.isArray(raw) ? raw : raw != null ? `${raw}`.split(/[,;|\s]+/) : [])
    .map((v) => `${v ?? ''}`.trim().toLowerCase()).filter(Boolean);
}

/**
 * O check vale para o perfil? Ordem: `requiredFor` do próprio check, `doctorRequiredFor` da máquina (pelo nome) e, sem
 * nada do servidor, a regra local. `all`/`*` = todos.
 */
export function checkApplies(check: Pick<ExecutionDoctorCheck, 'name' | 'requiredFor'>, profile: SetupProfile,
                             requiredFor?: DoctorRequiredFor): boolean {
  const name = `${check.name ?? ''}`.trim();
  let list = requiredList(check.requiredFor);
  if (!list.length && requiredFor) {
    const key = Object.keys(requiredFor).find((k) => k.trim().toLowerCase() === name.toLowerCase());
    if (key) list = requiredList(requiredFor[key]);
  }
  if (list.length) return list.includes('all') || list.includes('*') || list.includes(profile);
  if (profile === 'dev') return true;
  return !DEV_ONLY_CHECKS.includes(name) && !name.startsWith('Banco ');
}

/** Problemas que contam para o perfil (erro de verdade; aviso não conta). */
export function profileErrors(checks: readonly ExecutionDoctorCheck[] | null | undefined, profile: SetupProfile,
                              requiredFor?: DoctorRequiredFor): ExecutionDoctorCheck[] {
  return (checks ?? []).filter((c) => !c.ok && c.severity !== 'warning' && checkApplies(c, profile, requiredFor));
}

/** Checks com falha, os do perfil primeiro (erros antes de avisos); os fora do perfil marcados. */
export function profileProblems(checks: readonly ExecutionDoctorCheck[] | null | undefined, profile: SetupProfile,
                                requiredFor?: DoctorRequiredFor): (ExecutionDoctorCheck & { notNeeded: boolean })[] {
  return (checks ?? [])
    .filter((c) => !c.ok)
    .map((c) => ({ ...c, notNeeded: !checkApplies(c, profile, requiredFor) }))
    .sort((a, b) => Number(a.notNeeded) - Number(b.notNeeded) || (a.severity === 'warning' ? 1 : 0) - (b.severity === 'warning' ? 1 : 0));
}

/**
 * Quantos problemas mostrar no resumo da máquina: o `profileDoctorProblems` do servidor quando o perfil é o dele; no
 * perfil Gestão sem a conta do servidor, os erros do perfil; nos demais, a conta antiga (`doctorProblems`).
 */
export function workerProblemCount(w: Pick<ExecutionWorker, 'doctor' | 'doctorProblems' | 'profile' | 'doctorRequiredFor' | 'profileDoctorProblems'>,
                                   profile: SetupProfile): number {
  if (w.profileDoctorProblems != null && `${w.profile ?? ''}`.toLowerCase() === profile) return w.profileDoctorProblems;
  return profile === 'management' ? profileErrors(w.doctor, profile, w.doctorRequiredFor).length : (w.doctorProblems ?? 0);
}

/** Versão publicada mais nova que a da máquina (1.0.10 > 1.0.9). */
export function agentOutdated(w: Pick<ExecutionWorker, 'agentVersion' | 'latestAgentVersion'> | null | undefined): boolean {
  if (!w?.latestAgentVersion || !w.agentVersion) return false;
  const a = w.latestAgentVersion.split('.').map(Number), b = w.agentVersion.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

const AZURE = 'AzureDevOps Configurations';

/** Integração de provedor de IA (configuração da IA ou a chave de um provedor). */
export function isAiIntegration(description: string | null | undefined): boolean {
  const name = `${description ?? ''}`.trim().toLowerCase();
  return name === 'ai configurations' || /^(claude|gemini|openai|copilot|anthropic)\b/.test(name);
}

/**
 * Integrações que o perfil vê. Dev: todas, como cadastradas. Management: só o Azure DevOps (obrigatório) e as de IA
 * (opcionais); GitHub, Teams e as demais ficam ocultas.
 */
export function integrationsForProfile(list: readonly UserIntegration[], profile: SetupProfile): UserIntegration[] {
  if (profile === 'dev') return [...list];
  return list
    .filter((i) => i.description === AZURE || isAiIntegration(i.description))
    .map((i) => (i.description === AZURE ? { ...i, optional: false } : { ...i, optional: true }));
}
