import { RepoCommitSelection } from '../services/card-pr-state.service';
import { getCommitAuthor, getCommitDescription, getCommitSha, getCommitTitle } from './commit';

/** Patches maiores que isto (por arquivo) são truncados para não estourar o limite do provedor de IA. */
export const MAX_PATCH_CHARS = 15000;

/**
 * Monta o contexto de alterações para o prompt da IA com os diffs de todos os repositórios
 * escolhidos (spec 4.1). Só vai o essencial de cada arquivo — nome, status, +/- e patch —
 * em markdown, em vez do JSON completo do GitHub (URLs, blobs etc. só gastam tokens).
 */
export function buildMultiRepoDiffContext(selections: RepoCommitSelection[]): string {
  return selections
    .filter(s => !!s.diff)
    .map(s => {
      const sha = getCommitSha(s.commit);
      const body = getCommitDescription(s.commit);
      const header = [
        `## Repository: ${s.repository}`,
        `Branch: ${s.branch} | Commit: ${sha.substring(0, 12)} | Author: ${getCommitAuthor(s.commit)}`,
        `Commit message: ${getCommitTitle(s.commit)}${body ? `\n${body}` : ''}`,
      ].join('\n');

      const files = (s.diff?.files ?? []).map((f: any) => {
        const title = `### ${f.filename} (${f.status}, +${f.additions ?? 0} -${f.deletions ?? 0})`;
        if (!f.patch) return `${title}\n(sem patch — arquivo binário ou grande demais no GitHub)`;
        const patch = f.patch.length > MAX_PATCH_CHARS
          ? `${f.patch.substring(0, MAX_PATCH_CHARS)}\n... [patch truncado: ${f.patch.length - MAX_PATCH_CHARS} caracteres omitidos]`
          : f.patch;
        return `${title}\n\`\`\`diff\n${patch}\n\`\`\``;
      });

      return `${header}\n\n${files.join('\n\n')}`;
    })
    .join('\n\n---\n\n');
}
