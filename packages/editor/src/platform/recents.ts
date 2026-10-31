// Recently opened files, persisted outside any document: recent.json in the app data dir
// on desktop and mobile, localStorage in the browser. local:// entries (Android folders) are listed only in the Gonq Android app.
import { commands, type Recent } from './bindings';
import { isTauri } from './files';
import { isSshPath } from './remote';
import { isLocalPath, localReachable } from './local';

export interface RecentDocument {
  path: string;
  /** Unix epoch milliseconds. */
  openedAt: number;
}

export const MAX_RECENTS = 10;
export const RECENTS_KEY = 'gonq.recentDocuments';

// local:// entries only mean something in the Gonq Android app (recents.rs stores any string and is unchanged).
const fromRaw = (rows: Recent[]): RecentDocument[] =>
  rows.filter((r) => localReachable() || !isLocalPath(r.path)).map((r) => ({ path: r.path, openedAt: r.opened_at }));

function readLocal(): RecentDocument[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      // A browser cannot reach ssh:// or local:// files, so none are shown there.
      .filter((r) => r && typeof r.path === 'string' && typeof r.openedAt === 'number' && !isSshPath(r.path) && !isLocalPath(r.path))
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

function writeLocal(list: RecentDocument[]): void {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
  } catch {
    // Storage full or blocked: recents are a convenience.
  }
}

/** Newest first. Empty when nothing is stored or the store is unreadable. */
export async function listRecents(): Promise<RecentDocument[]> {
  if (!isTauri()) return readLocal();
  return fromRaw(await commands.recentDocumentsList());
}

/** Moves the path to the top (deduped, capped at 10) and stamps it. Returns the new list. */
export async function addRecent(path: string): Promise<RecentDocument[]> {
  if (!isTauri()) {
    const list = [{ path, openedAt: Date.now() }, ...readLocal().filter((r) => r.path !== path)].slice(0, MAX_RECENTS);
    writeLocal(list);
    return list;
  }
  return fromRaw(await commands.recentDocumentsAdd(path));
}

export async function removeRecent(path: string): Promise<RecentDocument[]> {
  if (!isTauri()) {
    const list = readLocal().filter((r) => r.path !== path);
    writeLocal(list);
    return list;
  }
  return fromRaw(await commands.recentDocumentsRemove(path));
}

/** Desktop only: lets a recent file from an earlier session be read again. Rejects for paths not in the list. */
export async function allowRecentDocument(path: string): Promise<void> {
  if (isTauri()) await commands.allowRecentDocument(path);
}
