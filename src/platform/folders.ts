// Folder navigator access: native calls stay behind this boundary; the web beta degrades gracefully.
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { isTauri } from './files';
import { isSshPath, remoteExists, remoteHost, remoteList, RemoteFileError } from './remote';

export { isSshPath };

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
  | 'host_key_changed';

/** Rejection of listDirectory; the UI shows it as an error row. */
export class ListDirectoryError extends Error {
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

/** Folders and Markdown files only, no dotfiles, folders first then files, A-Z ignoring case. Read-only. */
export async function listDirectory(path: string): Promise<FolderEntry[]> {
  if (!isTauri()) throw new ListDirectoryError('unsupported', 'Folders can only be browsed in the desktop app.');
  if (isSshPath(path)) {
    try {
      const rows = await remoteList(path);
      return rows.map((r) => ({ name: r.name, path: r.path, isDir: r.is_dir }));
    } catch (e) {
      if (e instanceof RemoteFileError) {
        const message = e.kind === 'disconnected' ? `Lost connection to ${remoteHost(path)}.` : e.message;
        throw new ListDirectoryError(e.kind, message);
      }
      throw new ListDirectoryError('io', e instanceof Error ? e.message : String(e));
    }
  }
  try {
    const rows = await invoke<{ name: string; path: string; is_dir: boolean }[]>('list_directory', { path });
    return rows.map((r) => ({ name: r.name, path: r.path, isDir: r.is_dir }));
  } catch (e) {
    const err = e as { kind?: ListErrorKind; message?: string };
    throw new ListDirectoryError(err?.kind ?? 'io', err?.message ?? String(e));
  }
}

/** Whether a file or folder still exists. Always true in the browser, where paths are not real. */
export async function pathExists(path: string): Promise<boolean> {
  if (!isTauri()) return true;
  if (isSshPath(path)) return remoteExists(path);
  return invoke<boolean>('path_exists', { path });
}
