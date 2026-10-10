// The Connect to Server flow's native calls: host list, ssh_connect with answers, the folder picker's
// listing, the navigator root grant, and the last folders opened. Desktop only; the web beta has none.
// Passwords and passphrases pass through here once and are never stored.
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './files';
import { remoteAccount, toRemoteError } from './remote';

export type ConnectResult =
  | { kind: 'connected'; home: string; authority: string }
  | { kind: 'needs_host_key'; key_type: string; fingerprint: string }
  | { kind: 'host_key_changed'; fingerprint: string; known_line: string }
  | { kind: 'needs_passphrase'; key_path: string }
  | { kind: 'needs_password'; attempts_left: number }
  | { kind: 'auth_failed'; tried: string[] }
  | { kind: 'unreachable'; reason: string };

export interface ConnectAnswers {
  trust_fingerprint?: string;
  passphrase?: string;
  password?: string;
  skip_passphrase?: string[];
}

/** Whether the Connect flow exists: the desktop app only. */
export function connectSupported(): boolean {
  return isTauri();
}

/** `Host` names from ~/.ssh/config (wildcards left out); empty on the web or when there is no file. */
export async function listHosts(): Promise<string[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<string[]>('ssh_list_hosts');
  } catch {
    return [];
  }
}

/** Connects, or resolves the one thing still needed. A failure of the command itself is an unreachable result. */
export async function connectHost(target: string, answers: ConnectAnswers = {}): Promise<ConnectResult> {
  if (!isTauri()) return { kind: 'unreachable', reason: 'Connecting to a server is available in the desktop app.' };
  try {
    return await invoke<ConnectResult>('ssh_connect', { target, answers });
  } catch (e) {
    return { kind: 'unreachable', reason: typeof e === 'string' ? e : e instanceof Error ? e.message : String(e) };
  }
}

/** Closes the session for what was typed in the Connect box. Failures are ignored: it is cleanup. */
export async function disconnectHost(target: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('ssh_disconnect', { host: target });
  } catch {
    // Nothing to close.
  }
}

/** ssh://authority/path, with only % escaped (the URI form the backend parses). */
export function remoteUri(authority: string, path: string): string {
  return `ssh://${authority}${path.replace(/%/g, '%25')}`;
}

/** The unescaped absolute path of an ssh:// address. */
export function sshPathOf(uri: string): string {
  const rest = uri.replace(/^ssh:\/\//i, '');
  const slash = rest.indexOf('/');
  const path = slash < 0 ? '/' : rest.slice(slash);
  return path.replace(/%25/gi, '%');
}

/** Everything in the Connect box: the target to connect to, and the folder a pasted ssh:// address names. */
export function parseConnectInput(input: string): { target: string; path: string | null } {
  const text = input.trim();
  if (/^ssh:\/\//i.test(text)) {
    const rest = text.slice(6);
    const slash = rest.indexOf('/');
    if (slash < 0) return { target: rest, path: null };
    const path = sshPathOf(text);
    return { target: rest.slice(0, slash), path: path === '/' ? null : path };
  }
  return { target: text, path: null };
}

export interface FolderListing {
  /** The canonical address of what was listed. */
  uri: string;
  folders: string[];
}

/** Subfolder names of a folder anywhere on a connected host. Rejects with a RemoteFileError. */
export async function listFolders(uri: string): Promise<FolderListing> {
  try {
    return await invoke<FolderListing>('remote_list_folders', { uri });
  } catch (e) {
    throw toRemoteError(e, 'list', uri);
  }
}

/** The picked folder becomes the navigator root. Rejects with a RemoteFileError. */
export async function openRoot(uri: string): Promise<void> {
  try {
    await invoke('remote_open_root', { uri });
  } catch (e) {
    throw toRemoteError(e, 'list', uri);
  }
}

// The last folders opened. Host and folder only, never a secret. Kept in the webview's storage:
// settings.json has no command for it yet.
export const RECENT_FOLDERS_KEY = 'gonq.recentRemoteFolders';
export const MAX_RECENT_FOLDERS = 5;

/** Newest first, at most five ssh:// folder addresses. */
export function listRecentFolders(): string[] {
  if (!isTauri()) return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_FOLDERS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === 'string' && /^ssh:\/\//i.test(p)).slice(0, MAX_RECENT_FOLDERS);
  } catch {
    return [];
  }
}

export function addRecentFolder(uri: string): string[] {
  if (!isTauri()) return [];
  const list = [uri, ...listRecentFolders().filter((p) => p !== uri)].slice(0, MAX_RECENT_FOLDERS);
  try {
    localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(list));
  } catch {
    // Storage full or blocked: recents are a convenience.
  }
  return list;
}

export function removeRecentFolder(uri: string): string[] {
  const list = listRecentFolders().filter((p) => p !== uri);
  try {
    localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(list));
  } catch {
    // Ignored, as above.
  }
  return list;
}

/** The last folder opened on a host (matched by user@host), or null. */
export function lastFolderOn(authority: string): string | null {
  const want = authority.toLowerCase();
  return listRecentFolders().find((u) => remoteAccount(u).toLowerCase() === want) ?? null;
}
