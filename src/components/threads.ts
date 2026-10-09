import { parseCommentThreads, type CommentThread } from '../comment-threads';

/**
 * A thread as the UI addresses it. Ids are not guaranteed unique, so the key
 * carries the ordinal among same-id blocks, which is also how the library pairs
 * blocks with markers.
 */
export interface ThreadItem {
  key: string;
  ordinal: number;
  thread: CommentThread;
}

export function threadKey(id: string, ordinal: number): string {
  return `${id}#${ordinal}`;
}

/** Every well-formed thread in the document, in document order. */
export function listThreads(text: string): ThreadItem[] {
  const seen = new Map<string, number>();
  return [...parseCommentThreads(text)]
    .sort((a, b) => a.from - b.from)
    .map((thread) => {
      const ordinal = seen.get(thread.id) ?? 0;
      seen.set(thread.id, ordinal + 1);
      return { key: threadKey(thread.id, ordinal), ordinal, thread };
    });
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5m ago", "2h ago", "3d ago", then a calendar date. Unparseable stamps are shown as written. */
export function relativeTime(timestamp: string, now: number = Date.now()): string {
  const at = Date.parse(timestamp);
  if (Number.isNaN(at)) return timestamp;
  const age = now - at;
  if (age < MINUTE) return 'just now';
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m ago`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h ago`;
  if (age < 30 * DAY) return `${Math.floor(age / DAY)}d ago`;
  return new Date(at).toISOString().slice(0, 10);
}

export function preview(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > 50 ? `${flat.slice(0, 50)}…` : flat;
}
