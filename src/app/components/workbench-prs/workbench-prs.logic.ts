import { GithubPullRequest } from '../../services/pull-request.service';
import { TargetBranchOption } from '../target-branch-toggle/target-branch-toggle.component';

/** "hotfix/77434-rv" → { prefix: "hotfix/", name: "77434-rv" } (sem "/" → prefixo padrão). */
export function splitBranch(branch: string | null | undefined, fallbackPrefix = 'hotfix/'): { prefix: string; name: string } {
  const b = (branch ?? '').trim();
  const i = b.lastIndexOf('/');
  if (i < 0) return { prefix: fallbackPrefix, name: b };
  return { prefix: b.slice(0, i + 1), name: b.slice(i + 1) };
}

/** Destinos do plugin (`ActiveBranchs`, JSON ou literal JS de array) → opções do "Abrir PR". */
export function parseActiveBranches(raw: unknown): TargetBranchOption[] {
  if (!raw) return [];
  let list: any = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      try {
        // Mesmo formato que a tela de PR aceita (literal JS: aspas simples, chaves sem aspas).
        list = new Function(`return (${raw});`)();
      } catch {
        return [];
      }
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((b: any) => ({ label: `${b?.label ?? b?.branchName ?? ''}`, value: `${b?.branchName ?? b?.value ?? ''}` }))
    .filter((o: TargetBranchOption) => !!o.value);
}

/** Repositórios do plugin (`ActiveRepositories`, JSON `[{label,value}]`). */
export function parseActiveRepositories(raw: unknown): { label: string; value: string }[] {
  if (!raw) return [];
  try {
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(list) ? list.filter((r: any) => r?.value).map((r: any) => ({ label: `${r.label ?? r.value}`, value: `${r.value}` })) : [];
  } catch {
    return [];
  }
}

/** Contagem por status para o chip "PRs (n)". */
export function prCounts(prs: GithubPullRequest[]): { total: number; open: number; merged: number; closed: number; legacy: number } {
  const c = { total: prs.length, open: 0, merged: 0, closed: 0, legacy: 0 };
  for (const pr of prs) {
    if (pr.status === 'OPEN') c.open++;
    else if (pr.status === 'MERGED') c.merged++;
    else if (pr.status === 'CLOSED') c.closed++;
    else if (pr.status === 'LEGACY') c.legacy++;
  }
  return c;
}

/** "1 aberto · 2 mesclados" (vazio → "nenhum PR"). */
export function prCountsLabel(prs: GithubPullRequest[]): string {
  const c = prCounts(prs);
  if (!c.total) return 'nenhum PR';
  const parts: string[] = [];
  if (c.open) parts.push(`${c.open} ${c.open === 1 ? 'aberto' : 'abertos'}`);
  if (c.merged) parts.push(`${c.merged} ${c.merged === 1 ? 'mesclado' : 'mesclados'}`);
  if (c.closed) parts.push(`${c.closed} ${c.closed === 1 ? 'fechado' : 'fechados'}`);
  if (c.legacy) parts.push(`${c.legacy} ${c.legacy === 1 ? 'legado' : 'legados'}`);
  return parts.join(' · ');
}

/** Destino padrão do "Abrir PR": o último usado, senão "development" (se configurado), senão o primeiro. */
export function defaultTarget(options: TargetBranchOption[], last: string | null | undefined): string {
  if (last && options.some(o => o.value === last)) return last;
  if (options.some(o => o.value === 'development')) return 'development';
  return options[0]?.value ?? last ?? 'development';
}

/** Sugestão de branch pelas regras do card: o rótulo do destino e a branch. */
export interface BranchSuggestion {
  key: string;
  label: string;
  branch: string;
  target: string | null;
  hint: string;
}

/** Subconjunto das regras do card (`GET Skills/rules`) que as sugestões de branch usam. */
export interface BranchSuggestionRules {
  mainBranch: string;
  branchesByTarget?: Record<string, string> | null;
  repository?: string | null;
  repoKind?: string | null;
  repositoryTargets?: { target: string; branch: string }[] | null;
}

/**
 * Branch principal do card (User Story = feature/, Bug = hotfix/ — vem pronta das regras) e a branch de cada destino **do
 * repositório em tratamento**: só os destinos do fluxo desse tipo de repositório (revamp-backend não tem QA). Repositório
 * fora das regras (sem `repositoryTargets`) → os destinos do plugin de PR que têm branch por destino.
 */
export function buildBranchSuggestions(rules: BranchSuggestionRules | null, targetOptions: TargetBranchOption[]): BranchSuggestion[] {
  if (!rules) return [];
  const list: BranchSuggestion[] = [{
    key: 'main', label: 'Principal', branch: rules.mainBranch, target: null,
    hint: 'Branch principal do card (BranchNamePattern; User Story usa feature/) — abre o PR com ela',
  }];
  const labels = new Map(targetOptions.map(t => [t.value, t.label || t.value]));
  const forRepo = rules.repositoryTargets ?? [];
  const targets = forRepo.length
    ? forRepo.map(t => ({ value: t.target, branch: t.branch }))
    : targetOptions.map(t => ({ value: t.value, branch: rules.branchesByTarget?.[t.value] }));
  const where = forRepo.length && rules.repoKind ? ` (${rules.repository ?? 'repositório'} · ${rules.repoKind})` : '';
  for (const t of targets) {
    if (!t.branch || t.branch === rules.mainBranch) continue;
    list.push({
      key: t.value, label: labels.get(t.value) ?? t.value, branch: t.branch, target: t.value,
      hint: `Branch para o destino ${t.value} (BranchSuffixByTarget) — abre o PR ${t.branch} → ${t.value}${where}`,
    });
  }
  return list;
}
