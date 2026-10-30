/**
 * The logic behind the Create branch dialog, free of React: `validateBranchName` (the live, pure check of the
 * short name after the fixed gonq/ prefix) and `runCreateBranch`, which creates gonq/<name> from a source
 * branch and, for a dirty GitHub tab, commits that tab's file to it (conflict check first, via the same blob-sha
 * comparison the commit path makes). Its outcome says exactly how far it got, so the dialog can name a branch
 * left behind. Exports BRANCH_PREFIX, validateBranchName, runCreateBranch and the CreateOutcome/PendingCommit types.
 */
import { GitHubError, commitFile, createBranch, readFile, toGitHubError } from '../../platform/github';

/** Every branch made here starts with this; the dialog shows it as fixed text. */
export const BRANCH_PREFIX = 'gonq/';

const FORBIDDEN = /[~^:?*[\\]/;

/** Why `name` (the part after gonq/) cannot be a branch name, in a few words; null when it can. */
export function validateBranchName(name: string): string | null {
  if (name === '') return 'Enter a name';
  if (/\s/.test(name)) return 'No spaces';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return 'No control characters';
  if (name.includes('..')) return 'No “..”';
  if (name.includes('@{')) return 'No “@{”';
  if (name === '@') return 'Not just “@”';
  const bad = name.match(FORBIDDEN);
  if (bad) return `No “${bad[0]}”`;
  if (name.startsWith('/') || name.endsWith('/')) return 'Cannot start or end with “/”';
  if (name.startsWith('.') || name.endsWith('.')) return 'Cannot start or end with “.”';
  if (name.includes('//')) return 'No “//”';
  for (const part of name.split('/')) {
    if (part.endsWith('.lock')) return 'A part cannot end with “.lock”';
    if (part.startsWith('.')) return 'A part cannot start with “.”';
  }
  return null;
}

/** The dirty GitHub tab's file that Create also commits: its path, the text to write and the blob sha it was read at. */
export interface PendingCommit {
  path: string;
  text: string;
  sha: string;
}

export type CreateOutcome =
  /** Created; `commit` is set when the tab's file was committed to it too. */
  | { status: 'done'; branch: string; commit: { sha: string; commitSha: string } | null }
  /** GitHub says gonq/<name> exists; nothing was written. */
  | { status: 'exists' }
  /** The file changed on GitHub since the tab read it; nothing was created. */
  | { status: 'conflict' }
  /** Nothing was created. */
  | { status: 'failed'; message: string }
  /** The branch exists but the commit did not happen; it is never deleted. */
  | { status: 'partial'; branch: string; message: string };

const messageOf = (e: unknown) => toGitHubError(e).message;

/**
 * Creates gonq/<name> from `source`; with `commit`, first checks the file still has the recorded blob sha on
 * `source` (creating nothing otherwise), then creates the branch, then commits the file to it. Never throws.
 * `onCreated` runs as soon as the branch exists, before any commit.
 */
export async function runCreateBranch(args: {
  owner: string;
  repo: string;
  source: string;
  name: string;
  commit: PendingCommit | null;
  onCreated: (branch: string) => void;
}): Promise<CreateOutcome> {
  const { owner, repo, source, name, commit, onCreated } = args;
  const branch = BRANCH_PREFIX + name;
  if (commit !== null) {
    try {
      const current = await readFile(owner, repo, source, commit.path);
      if (current.sha !== commit.sha) return { status: 'conflict' };
    } catch (e) {
      return { status: 'failed', message: `Could not check ${commit.path} on ${source}, so no branch was created. ${messageOf(e)}` };
    }
  }
  try {
    await createBranch(owner, repo, source, name);
  } catch (e) {
    if (e instanceof GitHubError && e.kind === 'already_exists') return { status: 'exists' };
    return { status: 'failed', message: messageOf(e) };
  }
  onCreated(branch);
  if (commit === null) return { status: 'done', branch, commit: null };
  try {
    const result = await commitFile({ owner, repo, branch, path: commit.path, text: commit.text, sha: commit.sha });
    if (result.status === 'conflict') {
      return { status: 'partial', branch, message: `The branch ${branch} was created, but committing ${commit.path} to it failed: the file changed on GitHub. The branch was left in place.` };
    }
    return { status: 'done', branch, commit: { sha: result.sha, commitSha: result.commitSha } };
  } catch (e) {
    return { status: 'partial', branch, message: `The branch ${branch} was created, but committing ${commit.path} to it failed: ${messageOf(e)} The branch was left in place.` };
  }
}
