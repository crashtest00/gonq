// Native file access lives behind this boundary so the web beta stays usable:
// in a browser, File > Open falls back to an <input type="file">.
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { isSshPath, remoteFileName, remoteRead, remoteWrite, type RemoteStat } from './remote';

export { isSshPath };

export interface OpenedDocument {
  name: string;
  /** Absolute path on disk; null when opened through the browser fallback. */
  path: string | null;
  /** The file's text exactly as read: the source of truth, never normalised. */
  text: string;
  /** ssh:// documents only: the server's version when it was read. */
  remote?: RemoteStat;
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
    doc: { name: string; path: string | null; text: string; remote?: RemoteStat },
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

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** The text goes to disk exactly as held: no newline, BOM or whitespace normalisation. */
async function tauriWrite(path: string, text: string): Promise<SavedDocument> {
  await writeTextFile(path, text);
  try {
    // A document saved to a new place can show its relative images from there.
    await invoke('allow_document_folder', { path });
  } catch {
    // Images are a nicety; the save itself succeeded.
  }
  return { name: basename(path), path };
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
    await invoke('allow_document_folder', { path });
    return { name, path, text };
  },

  async openPath(path) {
    if (isSshPath(path)) return openRemote(path);
    const name = basename(path);
    const text = decodeUtf8(await readFile(path), name);
    await invoke('allow_document_folder', { path });
    return { name, path, text };
  },

  async saveDocument(doc, taken, options) {
    if (doc.path === null) return tauriFiles.saveDocumentAs(doc, taken);
    if (isSshPath(doc.path)) return saveRemote(doc.path, doc.text, doc.remote, options?.force === true);
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
