// ssh:// documents: the native calls and error wording for remote files. Components never invoke.
// Kept free of imports from files.ts / folders.ts so both can build on it.
import { invoke } from '@tauri-apps/api/core';

/** The server's version of a file when the tab last read or wrote it (SFTP v3: whole seconds). */
export interface RemoteStat {
  mtime: number;
  size: number;
}

export type RemoteErrorKind =
  | 'unreachable'
  | 'auth_required'
  | 'host_key_changed'
  | 'disconnected'
  | 'not_found'
  | 'permission_denied'
  | 'not_a_folder'
  | 'not_allowed'
  | 'io';

export type RemoteOp = 'open' | 'save' | 'list';

export function isSshPath(path: string | null | undefined): boolean {
  return typeof path === 'string' && path.slice(0, 6).toLowerCase() === 'ssh://';
}

const URI = /^ssh:\/\/(?:([^@/]*)@)?([^/:]+)(?::(\d+))?(\/.*)?$/i;

/** The pieces of an ssh:// path; null for anything else. */
export function parseSshPath(path: string): { user: string | null; host: string; port: string | null; file: string } | null {
  const m = URI.exec(path);
  if (m === null) return null;
  const file = (m[4] ?? '').split('/').filter(Boolean).pop() ?? '';
  return { user: m[1] || null, host: m[2], port: m[3] ?? null, file };
}

/** The host as the user knows it ("nas"), for messages. */
export function remoteHost(path: string): string {
  const p = parseSshPath(path);
  return p === null ? path : p.port === null ? p.host : `${p.host}:${p.port}`;
}

/** "user@host" (with :port when not 22), for recents and the navigator header. */
export function remoteAccount(path: string): string {
  const p = parseSshPath(path);
  if (p === null) return path;
  return `${p.user === null ? '' : `${p.user}@`}${remoteHost(path)}`;
}

export function remoteFileName(path: string): string {
  return parseSshPath(path)?.file || path;
}

/** A remote failure with a sentence for the user that names the host and the file. */
export class RemoteFileError extends Error {
  constructor(
    public kind: RemoteErrorKind,
    message: string,
    public detail: string = '',
  ) {
    super(message);
    this.name = 'RemoteFileError';
  }
}

/** Save found the server's copy changed (or deleted); nothing was written. */
export class RemoteConflictError extends Error {
  constructor(
    public name_: string,
    public deleted: boolean,
  ) {
    super(deleted ? `${name_} was deleted on the server since you opened it.` : `${name_} changed on the server since you opened it.`);
    this.name = 'RemoteConflictError';
  }
}

const KINDS: RemoteErrorKind[] = [
  'unreachable',
  'auth_required',
  'host_key_changed',
  'disconnected',
  'not_found',
  'permission_denied',
  'not_a_folder',
  'not_allowed',
  'io',
];

/** One sentence for a RemoteError kind, naming the host and the file. */
export function remoteErrorMessage(kind: RemoteErrorKind, op: RemoteOp, path: string, detail = ''): string {
  const host = remoteHost(path);
  const file = remoteFileName(path);
  const head = op === 'save' ? `Couldn't save to ${host}` : op === 'open' ? `Couldn't open ${file} on ${host}` : `Couldn't list ${file} on ${host}`;
  const tail = op === 'save' ? ` ${file} is still open and unsaved.` : '';
  let reason: string;
  switch (kind) {
    case 'unreachable':
      return op === 'save' ? `${head}: can't reach the server.${tail}` : `Couldn't reach ${host}. ${op === 'open' ? `${file} was not opened.` : ''}`.trim();
    case 'auth_required':
      reason = 'you need to log in again';
      break;
    case 'host_key_changed':
      reason = `the server's host key has changed, so the connection was refused${detail ? ` (remove this line from known_hosts: ${detail})` : ''}`;
      break;
    case 'disconnected':
      reason = 'connection lost';
      break;
    case 'not_found':
      reason = `${file} was not found`;
      break;
    case 'permission_denied':
      reason = `permission denied for ${file}`;
      break;
    case 'not_a_folder':
      reason = `${file} is not a folder`;
      break;
    case 'not_allowed':
      reason = op === 'list' ? `${file} is outside the folders you opened` : `only Markdown files in folders you opened can be used (${file})`;
      break;
    default:
      reason = detail || 'something went wrong';
  }
  return `${head}: ${reason}.${tail}`;
}

/** Turns whatever invoke rejected with into a RemoteFileError. */
export function toRemoteError(e: unknown, op: RemoteOp, path: string): RemoteFileError {
  if (e instanceof RemoteFileError) return e;
  const raw = e as { kind?: string; message?: string } | string | null;
  const kind: RemoteErrorKind =
    typeof raw === 'object' && raw !== null && KINDS.includes(raw.kind as RemoteErrorKind) ? (raw.kind as RemoteErrorKind) : 'io';
  const detail = typeof raw === 'string' ? raw : (raw?.message ?? (e instanceof Error ? e.message : ''));
  return new RemoteFileError(kind, remoteErrorMessage(kind, op, path, detail), detail);
}

/**
 * Story 4 supplies the Connect flow. It is called with the host's path when a command needs the
 * user to log in; resolves true once connected (the command is then tried again) or false to give up.
 */
export type ConnectHandler = (path: string) => Promise<boolean>;
let connectHandler: ConnectHandler | null = null;

/** Registers the Connect flow; returns a function that unregisters it. */
export function setConnectHandler(handler: ConnectHandler | null): () => void {
  connectHandler = handler;
  return () => {
    if (connectHandler === handler) connectHandler = null;
  };
}

/** Runs a remote command; on auth_required waits for the Connect flow, then tries once more. */
export async function withConnect<T>(path: string, op: RemoteOp, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof RemoteConflictError) throw e;
    const err = toRemoteError(e, op, path);
    if (err.kind !== 'auth_required' || connectHandler === null) throw err;
    if (!(await connectHandler(path))) throw err;
    try {
      return await run();
    } catch (e2) {
      if (e2 instanceof RemoteConflictError) throw e2;
      throw toRemoteError(e2, op, path);
    }
  }
}

/** The bytes of a remote file and the stat they were read at (12-byte header: mtime u32, size u64, big-endian). */
export async function remoteRead(path: string): Promise<{ bytes: Uint8Array; stat: RemoteStat }> {
  return withConnect(path, 'open', async () => {
    const raw = await invoke<ArrayBuffer | Uint8Array | number[]>('remote_read', { uri: path });
    const all = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw);
    const view = new DataView(all.buffer, all.byteOffset, all.byteLength);
    const stat = { mtime: view.getUint32(0), size: Number(view.getBigUint64(4)) };
    return { bytes: all.subarray(12), stat };
  });
}

export interface RemoteSaved {
  stat: RemoteStat;
  inPlace: boolean;
  /** First in-place (non-atomic) save on this host: tell the user once. */
  warn: boolean;
}

/** Writes the text exactly as held. Throws RemoteConflictError when the server's copy moved on, unless `force`. */
export async function remoteWrite(path: string, text: string, expected: RemoteStat, force: boolean): Promise<RemoteSaved> {
  return withConnect(path, 'save', async () => {
    const out = await invoke<
      | { status: 'saved'; stat: RemoteStat; in_place: boolean; warn: boolean }
      | { status: 'conflict'; deleted: boolean; current: RemoteStat | null }
    >('remote_write', { uri: path, text, expected, force });
    if (out.status === 'conflict') throw new RemoteConflictError(remoteFileName(path), out.deleted);
    return { stat: out.stat, inPlace: out.in_place, warn: out.warn };
  });
}

export async function remoteExists(path: string): Promise<boolean> {
  return invoke<boolean>('remote_exists', { uri: path });
}

export interface RemoteRow {
  name: string;
  path: string;
  is_dir: boolean;
}

export async function remoteList(path: string): Promise<RemoteRow[]> {
  return withConnect(path, 'list', () => invoke<RemoteRow[]>('remote_list_directory', { uri: path }));
}
