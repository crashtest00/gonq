// Image files for the editor live behind this boundary: native reads (Tauri fs, ssh) stay here and the
// browser gets a clear error instead of a different UI.
import { readFile } from '@tauri-apps/plugin-fs';
import { isTauri } from './files';
import { isSshPath, remoteRead } from './remote';

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

/** `src` relative to the document's folder, with `.` and `..` resolved; absolute paths stay as they are. */
export function resolveImagePath(src: string, docPath: string): string {
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

const cache = new Map<string, Promise<string>>();

async function read(src: string, docPath: string | null): Promise<string> {
  if (DIRECT.test(src)) return src;
  if (!isTauri()) throw new Error('Images stored next to the document can only be shown in the desktop app.');
  if (docPath === null && !/^([\\/]|[A-Za-z]:[\\/])/.test(src)) throw new Error('Save the document to show images next to it.');
  const path = resolveImagePath(src, docPath ?? '');
  const bytes = isSshPath(docPath) ? (await remoteRead(path)).bytes : await readFile(path);
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
