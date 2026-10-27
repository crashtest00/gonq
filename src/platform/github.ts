// The only place the frontend invokes the GitHub commands (OAuth device flow, repository list, branches and
// folder listings, file reads with worded errors, committing a file, open pull requests per branch, creating a branch, comparing two branches, opening a pull request), and the home of the github:// path format (a repository file is a document identity). The token and the device code stay in
// Rust: JS gets the user code to show, the login and whether a token exists. Desktop only; on the web every
// call throws a GitHubError of kind unavailable_on_web, which the caller shows in the error banner.
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './tauri';

export type GitHubErrorKind =
  | 'denied'
  | 'expired'
  | 'keychain'
  | 'network'
  | 'not_signed_in'
  | 'rate_limited'
  | 'branch_not_found'
  | 'path_not_found'
  | 'not_a_folder'
  | 'empty_repo'
  | 'no_access'
  | 'not_a_file'
  | 'symlink'
  | 'submodule'
  | 'file_too_large'
  | 'already_exists'
  | 'unavailable_on_web'
  | 'cancelled'
  | 'other';

export class GitHubError extends Error {
  constructor(
    readonly kind: GitHubErrorKind,
    message: string,
    /** For rate_limited: when the limit resets, in Unix seconds, if GitHub said. */
    readonly resetAt: number | null = null,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

export const GITHUB_UNAVAILABLE = 'Signing in to GitHub needs the Gonq desktop app';
export const GITHUB_BRANCH_UNAVAILABLE = 'Creating a GitHub branch needs the Gonq desktop app';
export const GITHUB_COMMIT_UNAVAILABLE = 'Committing to GitHub needs the Gonq desktop app';

/** What `startSignIn` gives: the code to type at the verification address. */
export interface DeviceStart {
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface GitHubStatus {
  signed_in: boolean;
  login: string | null;
  /** `session_only` when no keychain could hold the token. */
  storage: 'keychain' | 'session_only' | null;
}

const CAUSES: Record<string, GitHubErrorKind> = {
  access_denied: 'denied',
  expired: 'expired',
  keychain: 'keychain',
  network: 'network',
  not_signed_in: 'not_signed_in',
  cancelled: 'cancelled',
  rate_limited: 'rate_limited',
  branch_not_found: 'branch_not_found',
  path_not_found: 'path_not_found',
  not_a_folder: 'not_a_folder',
  empty_repo: 'empty_repo',
  no_access: 'no_access',
  not_a_file: 'not_a_file',
  symlink: 'symlink',
  submodule: 'submodule',
  file_too_large: 'file_too_large',
  already_exists: 'already_exists',
};

const FALLBACK: Record<string, string> = {
  access_denied: 'GitHub sign-in was denied',
  expired: 'The GitHub sign-in code expired',
  keychain: 'The OS keychain failed',
  network: 'Could not reach GitHub',
  not_signed_in: 'Not signed in to GitHub',
  cancelled: 'The GitHub sign-in was cancelled',
  device_flow_disabled: 'Device sign-in is switched off for this GitHub app',
  incorrect_device_code: 'GitHub did not recognise the sign-in code',
  no_sign_in_in_progress: 'No GitHub sign-in is in progress',
  rate_limited: 'GitHub rate limit reached',
  branch_not_found: 'That branch was not found',
  path_not_found: 'That path was not found on the branch',
  not_a_folder: 'That path is a file, not a folder',
  empty_repo: 'The repository is empty',
  no_access: 'GitHub refused access to that repository or path',
  not_a_file: 'That path is not a file',
  symlink: 'That path is a symbolic link, not a file',
  submodule: 'That path is a submodule, not a file',
  file_too_large: 'That file is over 1 MB',
  already_exists: 'That branch already exists',
};

/** Turns what a command rejected with (`{kind, message?}`, or a string) into a GitHubError. */
export function toGitHubError(e: unknown): GitHubError {
  if (e instanceof GitHubError) return e;
  if (typeof e === 'object' && e !== null && typeof (e as { kind?: unknown }).kind === 'string') {
    const { kind, message, status, reset_at } = e as { kind: string; message?: unknown; status?: unknown; reset_at?: unknown };
    const text =
      typeof message === 'string' && message !== ''
        ? kind === 'keychain' || kind === 'network'
          ? `${FALLBACK[kind]}: ${message}`
          : kind === 'http' && typeof status === 'number'
            ? `GitHub returned ${status}: ${message}`
            : message
        : (FALLBACK[kind] ?? 'GitHub sign-in failed');
    return new GitHubError(CAUSES[kind] ?? 'other', text, typeof reset_at === 'number' ? reset_at : null);
  }
  return new GitHubError('other', typeof e === 'string' ? e : e instanceof Error ? e.message : String(e));
}

async function call<T>(cmd: string, args?: Record<string, unknown>, unavailable = GITHUB_UNAVAILABLE): Promise<T> {
  if (!isTauri()) throw new GitHubError('unavailable_on_web', unavailable);
  try {
    return await (args === undefined ? invoke<T>(cmd) : invoke<T>(cmd, args));
  } catch (e) {
    throw toGitHubError(e);
  }
}

/** Asks GitHub for a code and cancels any earlier sign-in. Opens nothing. */
export const startSignIn = (): Promise<DeviceStart> => call('github_start');

/** Waits until the code is approved (resolves signed in), refused (denied), or expired. */
export const pollSignIn = (): Promise<GitHubStatus> => call('github_poll');

export const signInStatus = (): Promise<GitHubStatus> => call('github_status');

/** Deletes the stored token (and stops a sign-in being polled). Fine when already signed out. */
export const signOut = (): Promise<void> => call('github_sign_out');

export interface RepoSummary {
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  canPush: boolean;
  /** Null for a repository with no commits. */
  pushedAt: string | null;
}

export interface RepoPage {
  repos: RepoSummary[];
  /** The page to ask for next; null on the last page. */
  nextPage: number | null;
}

interface RawRepoPage {
  repos: {
    owner: string;
    name: string;
    full_name: string;
    private: boolean;
    default_branch: string;
    can_push: boolean;
    pushed_at: string | null;
  }[];
  next_page: number | null;
}

/**
 * One page (1-based) of the repositories the signed-in user can access, most recently pushed first; the
 * caller follows `nextPage` until it is null. A revoked token rejects with kind not_signed_in.
 */
export async function listRepos(page: number): Promise<RepoPage> {
  const raw = await call<RawRepoPage>('github_list_repos', { page });
  return {
    repos: raw.repos.map((r) => ({
      owner: r.owner,
      name: r.name,
      fullName: r.full_name,
      private: r.private,
      defaultBranch: r.default_branch,
      canPush: r.can_push,
      pushedAt: r.pushed_at ?? null,
    })),
    nextPage: raw.next_page ?? null,
  };
}

export interface BranchPage {
  defaultBranch: string;
  /** Names; the default branch leads the first page and is listed nowhere else. */
  branches: string[];
  /** The page to ask for next; null on the last page. */
  nextPage: number | null;
}

/** One page (1-based, 100 per page) of a repository's branch names; the caller follows `nextPage`. */
export async function listBranches(owner: string, repo: string, page: number): Promise<BranchPage> {
  const raw = await call<{ default_branch: string; branches: string[]; next_page: number | null }>('github_list_branches', {
    owner,
    repo,
    page,
  });
  return { defaultBranch: raw.default_branch, branches: raw.branches, nextPage: raw.next_page ?? null };
}

export interface RepoEntry {
  name: string;
  /** Path inside the repository, no leading slash. */
  path: string;
  kind: 'folder' | 'file';
}

export interface RepoListing {
  /** Folders then Markdown files, A-Z ignoring case, no dotfiles: the Rust side applies the rule. */
  entries: RepoEntry[];
  /** GitHub cut a very large folder off, so the list may be incomplete. */
  truncated: boolean;
}

/** The folders and Markdown files directly inside `path` ('' = the root) on `branch`. */
export async function listFolder(owner: string, repo: string, branch: string, path: string): Promise<RepoListing> {
  const raw = await call<{ entries: RepoEntry[]; truncated: boolean }>('github_list_folder', { owner, repo, branch, path });
  return { entries: raw.entries, truncated: raw.truncated === true };
}

/** A file read from a branch, as github_read_file answers (camelCased). */
export interface GithubFile {
  /** The file's path in the repository, as GitHub reports it. */
  path: string;
  name: string;
  /** The text as GitHub holds it: CRLF, BOM and all. */
  content: string;
  /** The file's blob sha. */
  sha: string;
  /** The branch tip the file was read at. */
  commitSha: string;
}

/** What a github:// tab remembers about its file; every field comes from the API response or the opened location. */
export interface GithubDocument {
  owner: string;
  repo: string;
  /** The branch the file was opened from, not the navigator's later selection. */
  branch: string;
  path: string;
  sha: string;
  commitSha: string;
}

/** Words for a failed read, naming the file; the error keeps its kind. */
function describeReadError(e: GitHubError, owner: string, repo: string, branch: string, path: string): GitHubError {
  const where = `${owner}/${repo} on branch ${branch}`;
  const privateNote = 'GitHub also answers 404 for a private repository the signed-in account cannot see.';
  const text = ((): string | null => {
    switch (e.kind) {
      case 'not_signed_in':
        return 'Not signed in to GitHub. Sign in, then open the file again.';
      case 'path_not_found':
        return `${path} was not found in ${where}. ${privateNote}`;
      case 'branch_not_found':
      case 'empty_repo':
        return e.kind === 'empty_repo'
          ? `${owner}/${repo} has no commits, so ${path} cannot be opened.`
          : `Branch ${branch} of ${owner}/${repo} was not found: it may have been deleted. ${privateNote}`;
      case 'no_access':
        return `GitHub refused access to ${path} in ${owner}/${repo}. ${e.message}`;
      case 'not_a_file':
        return `${path} is a folder, not a file, so it was not opened.`;
      case 'symlink':
        return `${path} is a symbolic link, not a file, so it was not opened.`;
      case 'submodule':
        return `${path} is a submodule, not a file, so it was not opened.`;
      case 'file_too_large':
        return `${path} is over 1 MB. GitHub does not send files that large inline, and Gonq never opens a cut-off copy, so it was not opened.`;
      case 'rate_limited':
        return e.resetAt === null
          ? 'GitHub rate limit reached. Try again in a little while.'
          : `GitHub rate limit reached. Try again after ${new Date(e.resetAt * 1000).toLocaleTimeString()}.`;
      case 'network':
        return `Could not reach GitHub. You may be offline; check the connection and open ${path} again.`;
      default:
        return null;
    }
  })();
  return text === null ? e : new GitHubError(e.kind, text, e.resetAt);
}

/**
 * Reads a Markdown file from a branch: its text exactly as GitHub holds it, the blob sha and the branch-tip
 * commit sha. Rejects with a GitHubError whose message says what to do (kind not_signed_in, path_not_found,
 * no_access, not_a_file, symlink, submodule, file_too_large, rate_limited, branch_not_found, network...).
 */
export async function readFile(owner: string, repo: string, branch: string, path: string): Promise<GithubFile> {
  try {
    const raw = await call<{ path: string; name: string; content: string; sha: string; commit_sha: string }>('github_read_file', {
      owner,
      repo,
      branch,
      path,
    });
    return { path: raw.path, name: raw.name, content: raw.content, sha: raw.sha, commitSha: raw.commit_sha };
  } catch (e) {
    throw e instanceof GitHubError ? describeReadError(e, owner, repo, branch, path) : e;
  }
}

/**
 * Whether `gonq/<name>` exists on GitHub (the answer is GitHub's, not the loaded branch list's, so a branch
 * missing from the list or differing only in case is judged by GitHub). Advisory: createBranch decides.
 */
export async function branchExists(owner: string, repo: string, name: string): Promise<boolean> {
  return call<boolean>('github_branch_exists', { owner, repo, name }, GITHUB_BRANCH_UNAVAILABLE);
}

/**
 * Creates `gonq/<name>` at the current tip of branch `source`. Rejects with a GitHubError of kind
 * already_exists (nothing is overwritten) or any other failure; on the web, with kind unavailable_on_web.
 */
export async function createBranch(owner: string, repo: string, source: string, name: string): Promise<void> {
  await call<void>('github_create_branch', { owner, repo, source, name }, GITHUB_BRANCH_UNAVAILABLE);
}

/** What committing a file answers: the new blob and commit shas, or a conflict (nothing was written). */
export type CommitResult = { status: 'committed'; sha: string; commitSha: string } | { status: 'conflict' };

/** The fixed commit message; the same text the Rust side writes. */
export const commitMessage = (path: string): string => `Edit ${path} from Gonq`;

/**
 * Commits `text` to `path` on `branch` if the file there still has blob `sha`. Rejects with a GitHubError
 * carrying GitHub's message as given (the Rust side adds the needs-write-access note); on the web it rejects
 * with kind unavailable_on_web.
 */
export async function commitFile(args: { owner: string; repo: string; branch: string; path: string; text: string; sha: string }): Promise<CommitResult> {
  if (!isTauri()) throw new GitHubError('unavailable_on_web', GITHUB_COMMIT_UNAVAILABLE);
  try {
    const raw = await invoke<{ status: string; sha?: string; commit_sha?: string }>('github_commit_file', args);
    if (raw.status === 'conflict') return { status: 'conflict' };
    return { status: 'committed', sha: raw.sha ?? '', commitSha: raw.commit_sha ?? '' };
  } catch (e) {
    // An HTTP refusal keeps GitHub's own message, without the "GitHub returned N:" prefix other calls add.
    const r = e as { kind?: unknown; message?: unknown } | null;
    if (typeof r === 'object' && r !== null && r.kind === 'http' && typeof r.message === 'string' && r.message !== '') {
      throw new GitHubError('other', r.message);
    }
    throw toGitHubError(e);
  }
}

export const GITHUB_PULLS_UNAVAILABLE = 'Checking for open pull requests needs the Gonq desktop app';

/** An open (draft or not) pull request whose head is a branch of the same repository. */
export interface OpenPull {
  number: number;
  url: string;
  draft: boolean;
}

/**
 * The open pull requests for several branches of one repository in one pass: a map from each asked branch to its
 * pull request, or null when it has none. Calls github_open_pulls_for_branches (`{owner, repo, branches}` -> one
 * `{branch, pull: null | {number, html_url, draft, title}}` per requested branch; forks are ignored by the Rust side).
 * The contract lives in src-tauri/src/github/pulls.rs, and the command in src-tauri/src/github/mod.rs.
 * Rejects with a GitHubError on a network or rate-limit failure; on the web with kind unavailable_on_web.
 */
export async function openPullsForBranches(owner: string, repo: string, branches: string[]): Promise<Map<string, OpenPull | null>> {
  if (!isTauri()) throw new GitHubError('unavailable_on_web', GITHUB_PULLS_UNAVAILABLE);
  const out = new Map<string, OpenPull | null>(branches.map((b) => [b, null]));
  if (branches.length === 0) return out;
  const raw = await call<{ branch: string; pull: { number: number; html_url: string; draft?: boolean } | null }[] | undefined>('github_open_pulls_for_branches', { owner, repo, branches });
  for (const e of Array.isArray(raw) ? raw : []) {
    if (out.has(e.branch) && e.pull) out.set(e.branch, { number: e.pull.number, url: e.pull.html_url, draft: e.pull.draft === true });
  }
  return out;
}

/** The open pull request for one branch, or null. Same errors as openPullsForBranches. */
export async function openPullForBranch(owner: string, repo: string, branch: string): Promise<OpenPull | null> {
  return (await openPullsForBranches(owner, repo, [branch])).get(branch) ?? null;
}

export const GITHUB_OPEN_PR_UNAVAILABLE = 'Opening a pull request needs the Gonq desktop app';

/**
 * The subset of `branches` that exist on GitHub (github_branches_exist `{owner, repo, branches}` -> string[]).
 * Any failure other than a missing branch rejects. On the web: kind unavailable_on_web.
 */
export async function branchesExist(owner: string, repo: string, branches: string[]): Promise<string[]> {
  if (!isTauri()) throw new GitHubError('unavailable_on_web', GITHUB_OPEN_PR_UNAVAILABLE);
  if (branches.length === 0) return [];
  const raw = await call<string[] | undefined>('github_branches_exist', { owner, repo, branches }, GITHUB_OPEN_PR_UNAVAILABLE);
  return Array.isArray(raw) ? raw : [];
}

export type FileStatus = 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed' | 'unchanged';

export interface ComparedFile {
  filename: string;
  previousFilename: string | null;
  status: FileStatus;
  additions: number;
  deletions: number;
}

export interface Comparison {
  /** Commits `head` has that `base` lacks. */
  aheadBy: number;
  /** Commits `base` has that `head` lacks. */
  behindBy: number;
  files: ComparedFile[];
  /** GitHub cut the file list off, so `files` is incomplete. */
  truncated: boolean;
}

/**
 * Compares `base` with `head` (github_compare `{owner, repo, base, head}` -> `{ahead_by, behind_by, files:
 * [{filename, previous_filename, status, additions, deletions}], truncated}`). Rejects with a GitHubError;
 * on the web with kind unavailable_on_web.
 */
export async function compareBranches(owner: string, repo: string, base: string, head: string): Promise<Comparison> {
  const raw = await call<{
    ahead_by: number;
    behind_by: number;
    files: { filename: string; previous_filename: string | null; status: FileStatus; additions: number; deletions: number }[];
    truncated: boolean;
  }>('github_compare', { owner, repo, base, head }, GITHUB_OPEN_PR_UNAVAILABLE);
  return {
    aheadBy: raw.ahead_by,
    behindBy: raw.behind_by,
    files: raw.files.map((f) => ({
      filename: f.filename,
      previousFilename: f.previous_filename ?? null,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
    })),
    truncated: raw.truncated === true,
  };
}

export interface CreatedPull {
  number: number;
  url: string;
}

/**
 * Opens a pull request of `head` into `base` (github_create_pull `{owner, repo, title, body, head, base}` ->
 * `{number, html_url}`). GitHub's refusals (no commits between, one already exists, validation) reject with
 * GitHub's own message unchanged.
 */
export async function createPull(args: { owner: string; repo: string; title: string; body: string; head: string; base: string }): Promise<CreatedPull> {
  if (!isTauri()) throw new GitHubError('unavailable_on_web', GITHUB_OPEN_PR_UNAVAILABLE);
  try {
    const raw = await invoke<{ number: number; html_url: string }>('github_create_pull', args);
    return { number: raw.number, url: raw.html_url };
  } catch (e) {
    const r = e as { kind?: unknown; message?: unknown } | null;
    if (typeof r === 'object' && r !== null && r.kind === 'http' && typeof r.message === 'string' && r.message !== '') {
      throw new GitHubError('other', r.message);
    }
    throw toGitHubError(e);
  }
}

export const GITHUB_SCHEME = 'github://';

export interface GithubLocation {
  owner: string;
  repo: string;
  branch: string;
  /** Path inside the repository; '' for the root. */
  path: string;
}

export const isGithubPath = (p: string): boolean => p.startsWith(GITHUB_SCHEME);

/**
 * The navigator's path for a place in a repository: github://owner/repo@branch/dir/file.md. The branch and
 * every path segment are percent-encoded, so a branch like feature/ü or a file with `@`, `%` or spaces
 * cannot be confused with the separators ('@' cannot occur in an owner or repository name).
 */
export function githubPath({ owner, repo, branch, path }: GithubLocation): string {
  const segments = path.split('/').filter((s) => s !== '').map(encodeURIComponent);
  return `${GITHUB_SCHEME}${owner}/${repo}@${encodeURIComponent(branch)}${segments.map((s) => `/${s}`).join('')}`;
}

/** The inverse of githubPath; null when `p` is not a well-formed github:// path. */
export function parseGithubPath(p: string): GithubLocation | null {
  const m = /^github:\/\/([^/@]+)\/([^/@]+)@([^/]+)((?:\/[^/]+)*)$/.exec(p);
  if (m === null) return null;
  try {
    return {
      owner: m[1],
      repo: m[2],
      branch: decodeURIComponent(m[3]),
      path: m[4].split('/').filter((s) => s !== '').map(decodeURIComponent).join('/'),
    };
  } catch {
    return null;
  }
}

type SignInHandler = () => Promise<boolean>;
let signInHandler: SignInHandler | null = null;

/** Registers the sign-in dialog; returns a function that unregisters it. */
export function setSignInHandler(handler: SignInHandler | null): () => void {
  signInHandler = handler;
  return () => {
    if (signInHandler === handler) signInHandler = null;
  };
}

/**
 * Resolves true once signed in: at once when a token already exists, otherwise after the sign-in dialog
 * ran. Resolves false when the user closed the dialog without signing in. Throws a GitHubError when the
 * status cannot be read (on the web: unavailable_on_web).
 */
export async function ensureSignedIn(): Promise<boolean> {
  if ((await signInStatus()).signed_in) return true;
  if (signInHandler === null) throw new GitHubError('other', 'The GitHub sign-in is not available');
  return signInHandler();
}
