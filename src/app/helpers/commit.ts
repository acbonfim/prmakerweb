/**
 * Leitura tolerante dos campos de commit: o backend devolve BranchCommitResponse
 * (sha/title/description/author/date), mas mantemos os formatos da API do GitHub como fallback.
 */
export function getCommitTitle(commit: any): string {
  const fullMsg: string =
    commit?.commit?.message ||
    commit?.message ||
    commit?.title ||
    commit?.subject ||
    commit?.commitMessage ||
    '';
  return fullMsg.split('\n')[0].trim();
}

export function getCommitDescription(commit: any): string {
  const fullMsg: string =
    commit?.commit?.message ||
    commit?.message ||
    commit?.description ||
    commit?.body ||
    '';
  // Quando vem só "description" (sem a mensagem completa), ela já é o corpo.
  if (!commit?.commit?.message && !commit?.message && (commit?.description || commit?.body)) {
    return fullMsg.trim();
  }
  return fullMsg.split('\n').slice(1).join('\n').trim();
}

export function getCommitAuthor(commit: any): string {
  return (
    commit?.commit?.author?.name ||
    commit?.commit?.committer?.name ||
    commit?.author?.login ||
    commit?.author?.name ||
    commit?.authorName ||
    commit?.committer?.name ||
    commit?.author ||
    ''
  );
}

export function getCommitDate(commit: any): string {
  const date =
    commit?.commit?.author?.date ||
    commit?.commit?.committer?.date ||
    commit?.authorDate ||
    commit?.date ||
    commit?.createdAt ||
    commit?.timestamp ||
    '';
  return date ? new Date(date).toLocaleString('pt-BR') : '';
}

export function getCommitSha(commit: any): string {
  return commit?.sha || commit?.id || commit?.commitId || commit?.hash || '';
}

export function displayCommit(commit: any): string {
  if (!commit || typeof commit === 'string') return commit ?? '';
  const title = getCommitTitle(commit);
  const desc = getCommitDescription(commit);
  return desc ? `${title} - ${desc.split('\n')[0]}` : title;
}
