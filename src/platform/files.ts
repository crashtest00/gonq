// Native file access lives behind this boundary so the web beta stays usable:
// in a browser, File > Open falls back to an <input type="file">.
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeTextFile } from '@tauri-apps/plugin-fs';

export interface OpenedDocument {
  name: string;
  /** Absolute path on disk; null when opened through the browser fallback. */
  path: string | null;
  /** The file's text exactly as read: the source of truth, never normalised. */
  text: string;
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
}

export interface FileAccess {
  /** Resolves null when the user cancels. Rejects (NotUtf8Error, ...) when the file cannot be opened. */
  pickDocument(): Promise<OpenedDocument | null>;
  /**
   * Writes the text to the document's own path, or asks where to put it when it has none.
   * Resolves null when the user cancels. Rejects when the file cannot be written.
   */
  saveDocument(doc: { name: string; path: string | null; text: string }): Promise<SavedDocument | null>;
  /** Always asks where to put the file. Resolves null when the user cancels. */
  saveDocumentAs(doc: { name: string; text: string }): Promise<SavedDocument | null>;
  /** Reads a known file (desktop only; absent in the browser). Rejects when it cannot be opened. */
  openPath?(path: string): Promise<OpenedDocument>;
  /** Resolves a displayable URL for an image, or null when it cannot be loaded. */
  loadImage(doc: OpenedDocument, src: string): Promise<string | null>;
}

export function decodeUtf8(bytes: Uint8Array, name: string): string {
  try {
    // ignoreBOM keeps a leading BOM in the text so it is not silently dropped.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new NotUtf8Error(name);
  }
}

const REMOTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

export function isRemoteSource(src: string): boolean {
  return REMOTE.test(src);
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Joins a document-relative reference onto the document's folder, lexically. */
export function resolveRelativePath(docPath: string, src: string): string {
  const sep = docPath.includes('\\') && !docPath.includes('/') ? '\\' : '/';
  const clean = decodeURIComponent(src.split(/[?#]/)[0]);
  const parts = docPath.split(/[\\/]/);
  parts.pop();
  for (const seg of clean.split(/[\\/]/)) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join(sep);
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
};

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
    const name = basename(path);
    const text = decodeUtf8(await readFile(path), name);
    await invoke('allow_document_folder', { path });
    return { name, path, text };
  },

  async saveDocument(doc) {
    if (doc.path === null) return tauriFiles.saveDocumentAs(doc);
    return tauriWrite(doc.path, doc.text);
  },

  async saveDocumentAs(doc) {
    const path = await save({
      defaultPath: /\.(md|markdown)$/i.test(doc.name) ? doc.name : `${doc.name}.md`,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    });
    return path === null ? null : tauriWrite(path, doc.text);
  },

  async loadImage(doc, src) {
    if (isRemoteSource(src)) return src;
    if (doc.path === null) return null;
    try {
      const bytes = await readFile(resolveRelativePath(doc.path, src));
      const ext = src.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? '';
      return URL.createObjectURL(new Blob([bytes], { type: MIME[ext] ?? 'application/octet-stream' }));
    } catch {
      return null;
    }
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

  async loadImage(_doc, src) {
    return isRemoteSource(src) ? src : null;
  },
};

export const files: FileAccess = isTauri() ? tauriFiles : webFiles;
