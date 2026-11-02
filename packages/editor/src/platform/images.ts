// Image files for the editor live behind this boundary: native reads (Tauri fs, ssh, local:// folders on Android) and Insert > Image
// (including copying a picked picture into a local:// document's folder) stay here; the browser gets a clear error instead of a different UI.
import { open } from '@tauri-apps/plugin-dialog';
import { readFile, stat } from '@tauri-apps/plugin-fs';
import { isTauri } from './files';
import { isSshPath, remoteRead } from './remote';
import { LOCAL_OUTSIDE, LocalFileError, childHandle, createLocalBytes, existsLocal, isDocumentGrant, isLocalPath, parseLocalPath, readLocal, statLocal, localPath } from './local';

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
};

const DIRECT = /^(https?:|data:|blob:)/i;

/**
 * A picture next to a local:// document, as a local:// path in the same tree. A document in a picked folder can only
 * refer to files below that folder: an absolute path, or `..` climbing above the root, throws LocalFileError (outside).
 */
function resolveLocalImage(src: string, docPath: string): string {
  const doc = parseLocalPath(docPath);
  if (doc === null) throw new LocalFileError('not-found', `${docPath} is not a file address on this device.`);
  let target = src;
  try {
    target = decodeURI(src);
  } catch {
    /* keep the text as written */
  }
  target = target.replace(/^file:\/\//i, '').split(/[?#]/)[0];
  if (/^([\\/]|[A-Za-z]:)/.test(target)) throw new LocalFileError('outside', LOCAL_OUTSIDE);
  const out = doc.rel.split('/').filter((s) => s !== '').slice(0, -1);
  for (const p of target.split(/[\\/]/)) {
    if (p === '' || p === '.') continue;
    if (p === '..') {
      if (out.length === 0) throw new LocalFileError('outside', LOCAL_OUTSIDE);
      out.pop();
    } else out.push(p);
  }
  return localPath({ tree: doc.tree, rel: out.join('/') });
}

/** `src` relative to the document's folder, with `.` and `..` resolved; absolute paths stay as they are. A local:// document refuses what leaves its folder. */
export function resolveImagePath(src: string, docPath: string): string {
  if (isLocalPath(docPath)) return resolveLocalImage(src, docPath);
  let target = src;
  try {
    target = decodeURI(src);
  } catch {
    /* keep the text as written */
  }
  target = target.replace(/^file:\/\//i, '').split(/[?#]/)[0];
  const ssh = docPath.match(/^(ssh:\/\/[^/]+)(\/.*)$/i);
  const prefix = ssh ? ssh[1] : /^[A-Za-z]:/.test(docPath) ? docPath.slice(0, 2) : '';
  const docRest = ssh ? ssh[2] : docPath.slice(prefix.length);
  const sep = docRest.includes('\\') && !docRest.includes('/') ? '\\' : '/';
  const absolute = /^([\\/]|[A-Za-z]:[\\/])/.test(target);
  const base = absolute ? [] : docRest.split(/[\\/]/).slice(0, -1);
  const parts = [...base, ...target.replace(/^[A-Za-z]:/, '').split(/[\\/]/)];
  const out: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  const drive = ssh ? prefix : absolute ? (/^[A-Za-z]:/.test(target) ? target.slice(0, 2) : '') : prefix;
  return `${drive}${sep}${out.join(sep)}`;
}

/** Local images travel as base64 over the plugin channel (slow on a phone), so a big one is refused before it is read. */
export const MAX_LOCAL_IMAGE_BYTES = 8 * 1024 * 1024;

async function readLocalImage(path: string): Promise<Uint8Array> {
  const at = parseLocalPath(path);
  if (at === null) throw new LocalFileError('not-found', `${path} is not a file address on this device.`);
  const { size } = await statLocal(at);
  if (size > MAX_LOCAL_IMAGE_BYTES) {
    throw new Error(`That picture is ${Math.round(size / 1048576)} MB; pictures over ${MAX_LOCAL_IMAGE_BYTES / 1048576} MB are not shown from a folder on this device.`);
  }
  return (await readLocal(at)).bytes;
}

const cache = new Map<string, Promise<string>>();

async function read(src: string, docPath: string | null): Promise<string> {
  if (DIRECT.test(src)) return src;
  if (!isTauri()) throw new Error('Images stored next to the document can only be shown in the desktop app.');
  if (docPath === null && !/^([\\/]|[A-Za-z]:[\\/])/.test(src)) throw new Error('Save the document to show images next to it.');
  const path = resolveImagePath(src, docPath ?? '');
  const bytes = isLocalPath(docPath) ? await readLocalImage(path) : isSshPath(docPath) ? (await remoteRead(path)).bytes : await readFile(path);
  const type = MIME[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
}

/** A URL an <img> can show for `src`. Loads are cached per document and source, so a rebuilt widget never re-reads. */
export function loadImage(src: string, docPath: string | null): Promise<string> {
  const key = DIRECT.test(src) ? src : `${docPath ?? ''}\n${src}`;
  let hit = cache.get(key);
  if (hit === undefined) {
    hit = read(src, docPath);
    cache.set(key, hit);
    // A failed load may succeed later (the file appears); do not remember the failure.
    hit.catch(() => cache.get(key) === hit && cache.delete(key));
  }
  return hit;
}

export function clearImageCache(): void {
  for (const url of cache.values()) void url.then((u) => u.startsWith('blob:') && URL.revokeObjectURL(u), () => {});
  cache.clear();
}

/** Largest picture Insert > Image accepts; a bigger one would be read whole into memory to show it. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

const norm = (p: string) => p.replace(/\\/g, '/');

/** How a document refers to `path`: relative to its folder when it lies beneath it, else the absolute path; URL-safe. */
export function imageReference(path: string, docPath: string | null): string {
  const target = norm(path);
  let ref = target;
  if (docPath !== null) {
    const dir = norm(docPath).split('/').slice(0, -1).join('/') + '/';
    if (dir.length > 1 && target.toLowerCase().startsWith(dir.toLowerCase())) ref = target.slice(dir.length);
  }
  return ref.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

/** Alt text from a file name: its base name without the extension, brackets removed. */
export function imageAlt(path: string): string {
  return (norm(path).split('/').pop() ?? path).replace(/\.[^.]*$/, '').replace(/[[\]]/g, '');
}

const EXT_BY_MAGIC: [string, number[]][] = [
  ['png', [0x89, 0x50, 0x4e, 0x47]],
  ['jpg', [0xff, 0xd8, 0xff]],
  ['gif', [0x47, 0x49, 0x46, 0x38]],
  ['bmp', [0x42, 0x4d]],
];

/** The extension for picture bytes: from the file name when it has a known one, else from the first bytes (a content:// URI has no name), else png. */
function pictureExtension(picked: string, bytes: Uint8Array): string {
  const named = /\.([A-Za-z0-9]+)$/.exec(picked.split(/[?#]/)[0])?.[1].toLowerCase();
  if (named !== undefined && named in MIME) return named;
  const riff = String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';
  if (riff) return 'webp';
  return EXT_BY_MAGIC.find(([, magic]) => magic.every((b, i) => bytes[i] === b))?.[0] ?? 'png';
}

/**
 * Insert > Image into a document in a picked folder on Android: the system picker returns a content:// URI the folder cannot
 * address, so the picture is copied into the document's own folder (never overwriting: a taken name gets " 2", " 3", ...) and the
 * reference is that file name, which resolveLocalImage then reads back.
 */
async function pickLocalImage(docPath: string): Promise<{ src: string; alt: string } | null> {
  const doc = parseLocalPath(docPath);
  if (doc === null) throw new LocalFileError('not-found', `${docPath} is not a file address on this device.`);
  if (isDocumentGrant(doc.tree)) {
    throw new Error('Open the folder this document is in to insert a picture; a document saved on its own has no folder to keep it in.');
  }
  const picked = await open({ multiple: false, directory: false, filters: [{ name: 'Images', extensions: Object.keys(MIME) }] });
  if (picked === null) return null;
  const { size } = await stat(picked);
  if (size > MAX_LOCAL_IMAGE_BYTES) {
    throw new Error(`That picture is ${Math.round(size / 1048576)} MB; pictures over ${MAX_LOCAL_IMAGE_BYTES / 1048576} MB are not inserted into a folder on this device. Resize it first.`);
  }
  const bytes = await readFile(picked);
  const ext = pictureExtension(picked, bytes);
  const dir = { tree: doc.tree, rel: doc.rel.split('/').filter((s) => s !== '').slice(0, -1).join('/') };
  for (let n = 1; n <= 999; n++) {
    const file = `image${n === 1 ? '' : ` ${n}`}.${ext}`;
    const at = childHandle(dir, file);
    if (await existsLocal(at)) continue;
    try {
      await createLocalBytes(at, bytes);
    } catch (e) {
      if (e instanceof LocalFileError && e.kind === 'exists') continue; // taken since the check
      throw e;
    }
    return { src: imageReference(file, null), alt: imageAlt(file) };
  }
  throw new Error('This folder already holds too many pictures named image; rename some and try again.');
}

/**
 * Asks for a picture and returns the Markdown reference to put in `docPath`'s text (null when cancelled).
 * Throws a clear error in the browser (no file paths there), for a document on a server, or for a very large file.
 */
export async function pickImage(docPath: string | null): Promise<{ src: string; alt: string } | null> {
  if (!isTauri()) throw new Error('Inserting an image stored on this computer needs the desktop app; the browser cannot refer to a file by its path.');
  if (isSshPath(docPath)) throw new Error('Pictures from this computer cannot be inserted into a document on a server.');
  if (docPath !== null && isLocalPath(docPath)) return pickLocalImage(docPath);
  const path = await open({ multiple: false, directory: false, filters: [{ name: 'Images', extensions: Object.keys(MIME) }] });
  if (path === null) return null;
  const { size } = await stat(path);
  if (size > MAX_IMAGE_BYTES) {
    throw new Error(`${imageAlt(path)} is ${Math.round(size / 1048576)} MB; pictures over ${MAX_IMAGE_BYTES / 1048576} MB are not inserted. Resize it first.`);
  }
  return { src: imageReference(path, docPath), alt: imageAlt(path) };
}
