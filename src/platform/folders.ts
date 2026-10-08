// Folder navigator access: native calls stay behind this boundary; the web beta degrades gracefully.
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { isTauri } from './files';

export interface FolderEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export type ListErrorKind = 'not_found' | 'permission_denied' | 'not_a_folder' | 'not_allowed' | 'io' | 'unsupported';

/** Rejection of listDirectory; the UI shows it as an error row. */
export class ListDirectoryError extends Error {
  constructor(public kind: ListErrorKind, message: string) {
    super(message);
    this.name = 'ListDirectoryError';
  }
}

/** True when folders can be opened and listed (the desktop app only). */
export function foldersSupported(): boolean {
  return isTauri();
}

/**
 * Native folder picker. Resolves the chosen path, or null on cancel or when unsupported (web).
 * The chosen folder and its subfolders become listable.
 */
export async function pickFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  const path = await open({ directory: true, multiple: false, recursive: true });
  return path ?? null;
}

/** Folders and Markdown files only, no dotfiles, folders first then files, A-Z ignoring case. Read-only. */
export async function listDirectory(path: string): Promise<FolderEntry[]> {
  if (!isTauri()) throw new ListDirectoryError('unsupported', 'Folders can only be browsed in the desktop app.');
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
  return invoke<boolean>('path_exists', { path });
}
