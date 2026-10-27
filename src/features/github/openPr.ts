/**
 * The logic behind File > Open PR…, free of React: which repositories the dialog offers (`repoOptions`), which
 * branches can be merged from in one of them (`sourceCandidates`: the session list and the open GitHub tabs'
 * branches, deduplicated), and the words for a changed file's status (`describeFile`). Nothing here is stored.
 */
import type { ComparedFile } from '../../platform/github';
import type { SessionBranch } from './sessionBranches';

export interface RepoRef {
  owner: string;
  repo: string;
}

export const repoKey = (r: RepoRef): string => `${r.owner}/${r.repo}`;
export const sameRepo = (a: RepoRef, b: RepoRef): boolean => a.owner === b.owner && a.repo === b.repo;

export const NO_SOURCES = 'No branches to merge from this session.';
export const NO_CHANGES = 'No changes between these branches.';

/** The repositories to choose from: the navigator's, those of open GitHub tabs and those in the session list, once each. */
export function repoOptions(navigator: RepoRef | null, tabs: RepoRef[], session: RepoRef[]): RepoRef[] {
  const out: RepoRef[] = [];
  for (const r of [...(navigator ? [navigator] : []), ...tabs, ...session]) {
    if (!out.some((o) => sameRepo(o, r))) out.push({ owner: r.owner, repo: r.repo });
  }
  return out;
}

/** The branches of `repo` to offer as "Branch to merge": session branches then open tabs' branches, each once. */
export function sourceCandidates(repo: RepoRef, session: SessionBranch[], tabs: SessionBranch[]): string[] {
  const out: string[] = [];
  for (const b of [...session, ...tabs]) if (sameRepo(b, repo) && !out.includes(b.branch)) out.push(b.branch);
  return out;
}

/** "added", "modified", "removed" or "renamed from <old>" (other GitHub statuses are shown as given). */
export function describeFile(f: ComparedFile): string {
  return f.status === 'renamed' && f.previousFilename !== null ? `renamed from ${f.previousFilename}` : f.status;
}
