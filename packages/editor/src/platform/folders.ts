// Folder navigator access (pickFolder, listDirectory, listFolderPage, pathExists): native calls stay behind
// this boundary; the web beta degrades gracefully. ssh:// paths are routed to remote.ts, github:// paths
// (a repository folder on a branch) to github.ts.
import { commands } from './bindings';
import { open } from '@tauri-apps/plugin-dialog';
import { isTauri } from './files';
import { GitHubError, isGithubPath, githubPath, listFolder, parseGithubPath, type GitHubErrorKind } from './github';
import { isSshPath, remoteExists, remoteHost, remoteList, RemoteFileError } from './remote';

export { isSshPath, isGithubPath };

export interface FolderEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export type ListErrorKind =
  | 'not_found'
  | 'permission_denied'
  | 'not_a_folder'
  | 'not_allowed'
  | 'io'
  | 'unsupported'
  | 'disconnected'
  | 'auth_required'
  | 'unreachable'
  | 'host_key_changed'
  | GitHubErrorKind;

/** Rejection of listDirectory; the UI shows it as an error row. */
export class ListDirectoryError extends Error {
  /** For rate_limited: when GitHub's limit resets, in Unix seconds, if known. */
  resetAt: number | null = null;
  constructor(public kind: ListErrorKind, message: string) {
    super(message);
    this.name = 'ListDirectoryError';
  }
}

/**
 * Native folder picker. Resolves the chosen path, or null on cancel; rejects on the web, where folders
 * cannot be opened. The chosen folder and its subfolders become listable.
 */
export async function pickFolder(): Promise<string | null> {
  if (!isTauri()) throw new Error('Opening a folder needs the desktop app.');
  const path = await open({ directory: true, multiple: false, recursive: true });
  return path ?? null;
}

/** One folder's rows, and whether the source cut the list off (only GitHub does, for very large folders). */
export interface FolderPage {
  entries: FolderEntry[];
  truncated: boolean;
}

/** Folders and Markdown files only, no dotfiles, folders first then files, A-Z ignoring case. Read-only. */
export async function listDirectory(path: string): Promise<FolderEntry[]> {
  return (await listFolderPage(path)).entries;
}

/** listDirectory, plus the truncated flag; GitHub failures reject with a ListDirectoryError of the GitHub kind. */
export async function listFolderPage(path: string): Promise<FolderPage> {
  if (isGithubPath(path)) return listGithubFolder(path);
  if (!isTauri()) throw new ListDirectoryError('unsupported', 'Folders can only be browsed in the desktop app.');
  if (isSshPath(path)) {
    try {
      const rows = await remoteList(path);
      return { entries: rows.map((r) => ({ name: r.name, path: r.path, isDir: r.is_dir })), truncated: false };
    } catch (e) {
      if (e instanceof RemoteFileError) {
        const message = e.kind === 'disconnected' ? `Lost connection to ${remoteHost(path)}.` : e.message;
        throw new ListDirectoryError(e.kind, message);
      }
      throw new ListDirectoryError('io', e instanceof Error ? e.message : String(e));
    }
  }
  try {
    const rows = await commands.listDirectory(path);
    return { entries: rows.map((r) => ({ name: r.name, path: r.path, isDir: r.is_dir })), truncated: false };
  } catch (e) {
    const err = e as { kind?: ListErrorKind; message?: string };
    throw new ListDirectoryError(err?.kind ?? 'io', err?.message ?? String(e));
  }
}

async function listGithubFolder(path: string): Promise<FolderPage> {
  const at = parseGithubPath(path);
  if (at === null) throw new ListDirectoryError('not_found', `Not a GitHub folder path: ${path}`);
  try {
    const listing = await listFolder(at.owner, at.repo, at.branch, at.path);
    return {
      entries: listing.entries.map((e) => ({
        name: e.name,
        path: githubPath({ ...at, path: e.path }),
        isDir: e.kind === 'folder',
      })),
      truncated: listing.truncated,
    };
  } catch (e) {
    if (e instanceof GitHubError) {
      const err = new ListDirectoryError(e.kind, e.message);
      err.resetAt = e.resetAt;
      throw err;
    }
    throw new ListDirectoryError('other', e instanceof Error ? e.message : String(e));
  }
}

/** Whether a file or folder still exists. Always true in the browser, where paths are not real. */
export async function pathExists(path: string): Promise<boolean> {
  if (!isTauri()) return true;
  if (isSshPath(path)) return remoteExists(path);
  if (isGithubPath(path)) return true;
  return commands.pathExists(path);
}
