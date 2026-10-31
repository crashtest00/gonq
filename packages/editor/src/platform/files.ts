// Native file access lives behind this boundary so the web beta stays usable:
// in a browser, File > Open falls back to an <input type="file">. Exports FileAccess and `files`
// (desktop or web); ssh:// paths are routed to remote.ts, github:// paths to github.ts (openGithub; saving one
// is not available yet), local:// paths (a folder picked on Android) to local.ts.
import { commands } from './bindings';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { isTauri } from './tauri';
import { isGithubPath, readFile as readGithubFile, parseGithubPath, githubPath, type GithubDocument } from './github';
import { isSshPath, remoteFileName, remoteRead, remoteWrite, type RemoteStat } from './remote';
import {
  LocalFileError,
  LOCAL_UNAVAILABLE,
  checkLocalRoot,
  isLocalPath,
  localFileName,
  parseLocalPath,
  readLocal,
  writeLocal,
  type LocalStat,
} from './local';
import { removeRecent } from './recents';

export { isSshPath, isTauri };

export interface OpenedDocument {
  name: string;
  /** Absolute path on disk; null when opened through the browser fallback. */
  path: string | null;
  /** The file's text exactly as read: the source of truth, never normalised. */
  text: string;
  /** ssh:// documents only: the server's version when it was read. */
  remote?: RemoteStat;
  /** github:// documents only: where the text came from, as GitHub reported it. */
  github?: GithubDocument;
  /** local:// documents only: the file's size and modified time when it was read, sent back as `expected` on save. */
  local?: LocalStat;
}

export class NotUtf8Error extends Error {
  constructor(name: string) {
    super(`${name} is not valid UTF-8 text, so it was not opened.`);
    this.name = 'NotUtf8Error';
  }
}

/** What a document is called and where it lives after it has been written. */
export interface SavedDocument {
  name: string;
  path: string | null;
  /** ssh:// documents only: the server's version just written. */
  remote?: RemoteStat;
  /** local:// documents only: the stat just written. */
  local?: LocalStat;
  /** Set on the first in-place (non-atomic) save to a host: the host to tell the user about. */
  inPlaceHost?: string;
}

export interface SaveOptions {
  /** Overwrite a copy that changed on the server (the user chose Overwrite). */
  force?: boolean;
}

/** Returns true for a path that must not be written (another open tab already holds it). */
export type PathTaken = (path: string) => boolean;

export class PathTakenError extends Error {
  constructor(path: string) {
    super(`${path} is already open in another tab, so it was not saved there. Choose another name.`);
    this.name = 'PathTakenError';
  }
}

export interface FileAccess {
  /** Resolves null when the user cancels. Rejects (NotUtf8Error, ...) when the file cannot be opened. */
  pickDocument(): Promise<OpenedDocument | null>;
  /**
   * Writes the text to the document's own path, or asks where to put it when it has none.
   * Resolves null when the user cancels. Rejects when the file cannot be written.
   */
  saveDocument(
    doc: { name: string; path: string | null; text: string; remote?: RemoteStat; local?: LocalStat },
    taken?: PathTaken,
    options?: SaveOptions,
  ): Promise<SavedDocument | null>;
  /** Always asks where to put the file. Resolves null when the user cancels. */
  saveDocumentAs(doc: { name: string; text: string }, taken?: PathTaken): Promise<SavedDocument | null>;
  /** Reads a known file (desktop only; absent in the browser). Rejects when it cannot be opened. */
  openPath?(path: string): Promise<OpenedDocument>;
}

export function decodeUtf8(bytes: Uint8Array, name: string): string {
  try {
    // ignoreBOM keeps a leading BOM in the text so it is not silently dropped.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new NotUtf8Error(name);
  }
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** The text goes to disk exactly as held: no newline, BOM or whitespace normalisation. */
async function tauriWrite(path: string, text: string): Promise<SavedDocument> {
  await writeTextFile(path, text);
  try {
    // A document saved to a new place can show its relative images from there.
    await commands.allowDocumentFolder(path);
  } catch {
    // Images are a nicety; the save itself succeeded.
  }
  return { name: basename(path), path };
}

export const GITHUB_SAVE_UNAVAILABLE = 'Saving GitHub documents is not available yet. Nothing was written.';

/**
 * Reads a github:// file. The tab's path is rebuilt from what GitHub answered (its path for the file), on the
 * branch the file was opened from, so the identity never rests on text the user typed.
 */
export async function openGithub(path: string): Promise<OpenedDocument> {
  const loc = parseGithubPath(path);
  if (loc === null) throw new Error(`${path} is not a GitHub file address.`);
  const file = await readGithubFile(loc.owner, loc.repo, loc.branch, loc.path);
  const github: GithubDocument = {
    owner: loc.owner,
    repo: loc.repo,
    branch: loc.branch,
    path: file.path,
    sha: file.sha,
    commitSha: file.commitSha,
  };
  return { name: file.name, path: githubPath(github), text: file.content, github };
}

async function openRemote(path: string): Promise<OpenedDocument> {
  const name = remoteFileName(path);
  const { bytes, stat } = await remoteRead(path);
  return { name, path, text: decodeUtf8(bytes, name), remote: stat };
}

/** Throws RemoteConflictError when the server's copy changed and `force` is not set. */
async function saveRemote(path: string, text: string, expected: RemoteStat | undefined, force: boolean): Promise<SavedDocument> {
  if (expected === undefined) throw new Error(`No server version is known for ${path}; it cannot be saved safely.`);
  const saved = await remoteWrite(path, text, expected, force);
  return {
    name: remoteFileName(path),
    path,
    remote: saved.stat,
    inPlaceHost: saved.warn ? path : undefined,
  };
}

/**
 * Reads a local:// file. A recent from an earlier session is checked first (the tree still granted, its root still there);
 * when that fails the recent is removed and the platform's error text is thrown.
 */
async function openLocal(path: string): Promise<OpenedDocument> {
  let handle;
  try {
    handle = await checkLocalRoot(path);
  } catch (e) {
    if (e instanceof LocalFileError && e.kind !== 'unsupported') await removeRecent(path).catch(() => {});
    throw e;
  }
  const name = localFileName(path);
  const { bytes, stat } = await readLocal(handle);
  return { name, path, text: decodeUtf8(bytes, name), local: stat };
}

/** Throws RemoteConflictError (the SSH conflict type) when the file changed since it was read and `force` is not set. */
async function saveLocal(path: string, text: string, expected: LocalStat | undefined, force: boolean): Promise<SavedDocument> {
  const handle = parseLocalPath(path);
  if (handle === null) throw new LocalFileError('not-found', `${path} is not a file address on this device.`);
  const local = await writeLocal(handle, text, expected, force);
  return { name: localFileName(path), path, local };
}

const tauriFiles: FileAccess = {
  async pickDocument() {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    });
    if (path === null) return null;
    const name = basename(path);
    const text = decodeUtf8(await readFile(path), name);
    // Lets the document's own folder (only) be read, for relative images.
    await commands.allowDocumentFolder(path);
    return { name, path, text };
  },

  async openPath(path) {
    if (isGithubPath(path)) return openGithub(path);
    if (isSshPath(path)) return openRemote(path);
    if (isLocalPath(path)) return openLocal(path);
    const name = basename(path);
    const text = decodeUtf8(await readFile(path), name);
    await commands.allowDocumentFolder(path);
    return { name, path, text };
  },

  async saveDocument(doc, taken, options) {
    if (doc.path === null) return tauriFiles.saveDocumentAs(doc, taken);
    if (isGithubPath(doc.path)) throw new Error(GITHUB_SAVE_UNAVAILABLE);
    if (isSshPath(doc.path)) return saveRemote(doc.path, doc.text, doc.remote, options?.force === true);
    if (isLocalPath(doc.path)) return saveLocal(doc.path, doc.text, doc.local, options?.force === true);
    return tauriWrite(doc.path, doc.text);
  },

  async saveDocumentAs(doc, taken) {
    const path = await save({
      defaultPath: /\.(md|markdown)$/i.test(doc.name) ? doc.name : `${doc.name}.md`,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    });
    if (path === null) return null;
    // Refused before anything is written, so the other tab's file is never overwritten.
    if (taken?.(path)) throw new PathTakenError(path);
    return tauriWrite(path, doc.text);
  },
};

const webFiles: FileAccess = {
  // Only github:// paths, which fail with the "needs the desktop app" error; a browser reads no other known path.
  async openPath(path) {
    if (isGithubPath(path)) return openGithub(path);
    if (isLocalPath(path)) throw new LocalFileError('unsupported', LOCAL_UNAVAILABLE);
    throw new Error(`${path} cannot be opened here.`);
  },

  pickDocument() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.md,.markdown,text/markdown';
      input.addEventListener('cancel', () => resolve(null));
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        try {
          resolve({ name: file.name, path: null, text: decodeUtf8(new Uint8Array(await file.arrayBuffer()), file.name) });
        } catch (e) {
          reject(e);
        }
      });
      input.click();
    });
  },

  // A browser cannot overwrite a file it opened, so saving downloads the text.
  async saveDocument(doc) {
    if (doc.path !== null && isGithubPath(doc.path)) throw new Error(GITHUB_SAVE_UNAVAILABLE);
    if (doc.path !== null && isLocalPath(doc.path)) throw new LocalFileError('unsupported', LOCAL_UNAVAILABLE);
    return webFiles.saveDocumentAs(doc);
  },

  async saveDocumentAs(doc) {
    const name = /\.(md|markdown)$/i.test(doc.name) ? doc.name : `${doc.name}.md`;
    const url = URL.createObjectURL(new Blob([doc.text], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
    return { name, path: null };
  },
};

export const files: FileAccess = isTauri() ? tauriFiles : webFiles;
