// The only place the frontend invokes the GitHub commands (OAuth device flow, repository list, branches and
// folder listings), and the home of the github:// folder-path format. The token and the device code stay in
// Rust: JS gets the user code to show, the login and whether a token exists. Desktop only; on the web every
// call throws a GitHubError of kind unavailable_on_web, which the caller shows in the error banner.
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './files';

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

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new GitHubError('unavailable_on_web', GITHUB_UNAVAILABLE);
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
