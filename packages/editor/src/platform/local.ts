/**
 * Local folders on Android (M-30): the only caller of the `gonq-saf` plugin commands (local_pick_folder, local_granted,
 * local_list, local_stat, local_read, local_write, local_create, local_exists; Kotlin SafPlugin behind src/saf.rs in the mobile
 * crate) and the home of the local:// path format, `local://<percent-encoded tree URI>/<rel segments>`, where the tree is a
 * Storage Access Framework folder the user picked and rel is names under it. Exports LocalHandle, localPath / parseLocalPath,
 * isLocalPath, the list/read/write/create/exists wrappers, LocalFileError and `checkLocalRoot` (the reopen check).
 * The commands are declared by hand: tauri-specta cannot generate a mobile plugin's commands. Everywhere but the Gonq
 * Android app every call rejects with a LocalFileError of kind `unsupported` (shown in the error banner, as ssh:// does).
 */
import { invoke } from '@tauri-apps/api/core';
import { appKind } from './app';
import { isTauri } from './tauri';
import { RemoteConflictError } from './remote';

export const LOCAL_SCHEME = 'local://';
export const LOCAL_UNAVAILABLE = 'Folders on this device can only be opened in the Gonq app for Android.';
export const LOCAL_OUTSIDE = 'That is outside the opened folder.';

/** A place inside a picked folder: the tree URI Android granted, and the "/"-separated names under its root ('' = the root). */
export interface LocalHandle {
  tree: string;
  rel: string;
}

/** What a provider reports for a file; `modified` (Unix ms, whole-second resolution) is null when it gives none. */
export interface LocalStat {
  size: number;
  modified: number | null;
}

export type LocalErrorKind = 'not-found' | 'permission' | 'outside' | 'conflict' | 'exists' | 'unsupported' | 'io';

export class LocalFileError extends Error {
  constructor(
    readonly kind: LocalErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'LocalFileError';
  }
}

/** A raw listing row from the plugin; the Markdown/dotfile filter and the sort happen in listLocalFolder. */
interface RawEntry {
  name: string;
  isDir: boolean;
}

export interface LocalEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export const isLocalPath = (p: string | null | undefined): boolean =>
  typeof p === 'string' && p.slice(0, LOCAL_SCHEME.length).toLowerCase() === LOCAL_SCHEME;

/** The names of a rel path, without empty ones. (".." is refused by parseLocalPath and by the plugin.) */
const names = (rel: string): string[] => rel.split('/').filter((s) => s !== '');

/** local://<tree>/<seg>/<seg>; the tree and every segment are percent-encoded, so no name can be read as a separator. */
export function localPath({ tree, rel }: LocalHandle): string {
  return `${LOCAL_SCHEME}${encodeURIComponent(tree)}${names(rel).map((s) => `/${encodeURIComponent(s)}`).join('')}`;
}

/** The inverse of localPath; null when `p` is not a well-formed local:// path (or names a "." or ".." segment). */
export function parseLocalPath(p: string): LocalHandle | null {
  const m = /^local:\/\/([^/]+)((?:\/[^/]+)*)$/i.exec(p);
  if (m === null) return null;
  try {
    const rel = m[2].split('/').filter((s) => s !== '').map(decodeURIComponent);
    if (rel.some((s) => s === '.' || s === '..' || s.includes('/'))) return null;
    return { tree: decodeURIComponent(m[1]), rel: rel.join('/') };
  } catch {
    return null;
  }
}

/** The file or folder name at the end of a local:// path ('' for a tree root). */
export function localFileName(path: string): string {
  const h = parseLocalPath(path);
  return h === null ? path : (names(h.rel).pop() ?? '');
}

/** The handle of a child of `dir`. */
export const childHandle = (dir: LocalHandle, name: string): LocalHandle => ({
  tree: dir.tree,
  rel: [...names(dir.rel), name].join('/'),
});

function handleOf(path: string): LocalHandle {
  const h = parseLocalPath(path);
  if (h === null) throw new LocalFileError('not-found', `${path} is not a folder address on this device.`);
  return h;
}

const KINDS: LocalErrorKind[] = ['not-found', 'permission', 'outside', 'conflict', 'exists', 'unsupported', 'io'];

/** Turns what the plugin rejected with (`{kind, message}` from saf.rs, or a string) into a LocalFileError. */
export function toLocalError(e: unknown): LocalFileError {
  if (e instanceof LocalFileError) return e;
  if (typeof e === 'object' && e !== null && typeof (e as { kind?: unknown }).kind === 'string') {
    const { kind, message } = e as { kind: string; message?: unknown };
    const k = KINDS.includes(kind as LocalErrorKind) ? (kind as LocalErrorKind) : 'io';
    const text = typeof message === 'string' && message !== '' ? message : 'The folder could not be accessed.';
    return new LocalFileError(k, k === 'outside' ? LOCAL_OUTSIDE : text);
  }
  return new LocalFileError('io', typeof e === 'string' ? e : e instanceof Error ? e.message : String(e));
}

/** Calls a plugin command. Outside the Gonq Android app there is no plugin, so it fails with a clear error instead. */
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri() || appKind() !== 'mobile') throw new LocalFileError('unsupported', LOCAL_UNAVAILABLE);
  try {
    return await invoke<T>(`plugin:gonq-saf|${command}`, args);
  } catch (e) {
    throw toLocalError(e);
  }
}

function toStat(raw: { size?: number; modified?: number | null }): LocalStat {
  return { size: typeof raw.size === 'number' ? raw.size : 0, modified: typeof raw.modified === 'number' ? raw.modified : null };
}

/** The system folder picker. Resolves the picked tree (its grant is persisted) and its name; null when cancelled. */
export async function pickLocalFolder(): Promise<{ handle: LocalHandle; name: string } | null> {
  const r = await call<{ picked?: boolean; tree?: string; name?: string } | null>('local_pick_folder');
  if (r === null || r.picked === false || typeof r.tree !== 'string') return null;
  return { handle: { tree: r.tree, rel: '' }, name: r.name ?? r.tree };
}

/** The trees Android still holds a grant for. */
export async function grantedTrees(): Promise<string[]> {
  const r = await call<string[] | { trees?: string[] }>('local_granted');
  return Array.isArray(r) ? r : (r.trees ?? []);
}

export function isMarkdownName(name: string): boolean {
  return /^.+\.(md|markdown)$/i.test(name);
}

/** Folders and Markdown files only, no dotfiles, folders first then files, A-Z ignoring case (as the desktop listing). */
export async function listLocalFolder(h: LocalHandle): Promise<LocalEntry[]> {
  const r = await call<RawEntry[] | { entries?: RawEntry[] }>('local_list', { tree: h.tree, rel: h.rel });
  const rows = Array.isArray(r) ? r : (r.entries ?? []);
  return rows
    .filter((e) => e.name !== '' && !e.name.startsWith('.') && (e.isDir || isMarkdownName(e.name)))
    .map((e) => ({ name: e.name, path: localPath(childHandle(h, e.name)), isDir: e.isDir }))
    .sort((a, b) => Number(!a.isDir) - Number(!b.isDir) || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0));
}

/** Size and modified time; rejects not-found when the file (or the whole folder) is gone. */
export async function statLocal(h: LocalHandle): Promise<LocalStat> {
  return toStat(await call('local_stat', { tree: h.tree, rel: h.rel }));
}

export async function existsLocal(h: LocalHandle): Promise<boolean> {
  const r = await call<boolean | { exists?: boolean }>('local_exists', { tree: h.tree, rel: h.rel });
  return typeof r === 'boolean' ? r : r.exists === true;
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The file's bytes (base64 over the channel, so images survive) and the stat they were read at. */
export async function readLocal(h: LocalHandle): Promise<{ bytes: Uint8Array; stat: LocalStat }> {
  const r = await call<{ bytes?: string; size?: number; modified?: number | null }>('local_read', { tree: h.tree, rel: h.rel });
  return { bytes: fromBase64(r.bytes ?? ''), stat: toStat(r) };
}

/**
 * Writes the text in place (truncating; Android has no atomic replace). Unless `force`, the plugin compares `expected` with
 * the file's current size and modified time first (whole-second resolution, so size is compared too; a provider with no
 * modified time is checked on size alone) and the call fails with a RemoteConflictError, the SSH conflict type, which
 * the existing Cancel/Overwrite dialog handles. Resolves the stat after the write.
 */
export async function writeLocal(h: LocalHandle, text: string, expected?: LocalStat, force = false): Promise<LocalStat> {
  const args: Record<string, unknown> = { tree: h.tree, rel: h.rel, text };
  if (expected !== undefined && !force) args.expected = { size: expected.size, modified: expected.modified };
  try {
    return toStat(await call('local_write', args));
  } catch (e) {
    if (e instanceof LocalFileError && e.kind === 'conflict') throw new RemoteConflictError(localFileName(localPath(h)), false);
    throw e;
  }
}

/** Creates a new file with the text; rejects `exists` when the name is taken (the provider never renames it). */
export async function createLocal(h: LocalHandle, text: string): Promise<LocalStat> {
  return toStat(await call('local_create', { tree: h.tree, rel: h.rel, text }));
}

/**
 * The check on reopening a recent: the tree must still be granted AND its root must still stat (a provider lists a vanished
 * folder as empty, so the listing alone proves nothing). Rejects with the platform's error text otherwise.
 */
export async function checkLocalRoot(path: string): Promise<LocalHandle> {
  const h = handleOf(path);
  if (!(await grantedTrees()).includes(h.tree)) {
    throw new LocalFileError('permission', 'Access to this folder was removed. Open it again to continue.');
  }
  await statLocal({ tree: h.tree, rel: '' });
  return h;
}

/** Whether a local:// recent can be shown: only the Gonq Android app can reach one. */
export const localReachable = (): boolean => isTauri() && appKind() === 'mobile';
