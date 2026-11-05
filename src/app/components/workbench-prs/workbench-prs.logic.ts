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
