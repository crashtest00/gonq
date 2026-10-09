/**
 * Undo/redo for the document text. Whole-text snapshots: Markdown files are
 * small, and a snapshot can never drift out of step with the text the way a
 * replayed diff could.
 */
export interface History {
  /** The document text: the single source of truth, only ever changed by splicing. */
  text: string;
  /** The text as last opened or saved; the document is dirty when it differs. */
  saved: string;
  past: string[];
  future: string[];
  /** Edits sharing a key within COALESCE_MS of each other become one undo step. */
  lastKey: string | null;
  lastAt: number;
}

export const MAX_UNDO = 500;
export const COALESCE_MS = 1000;

export function createHistory(text: string): History {
  return { text, saved: text, past: [], future: [], lastKey: null, lastAt: 0 };
}

export function isDirty(h: History): boolean {
  return h.text !== h.saved;
}

export function edit(h: History, text: string, key: string | null = null, now: number = Date.now()): History {
  if (text === h.text) return h;
  const coalesce = key !== null && key === h.lastKey && now - h.lastAt < COALESCE_MS && h.past.length > 0;
  const past = coalesce ? h.past : [...h.past, h.text].slice(-MAX_UNDO);
  return { ...h, text, past, future: [], lastKey: key, lastAt: now };
}

export function undo(h: History): History {
  if (h.past.length === 0) return h;
  return {
    ...h,
    text: h.past[h.past.length - 1],
    past: h.past.slice(0, -1),
    future: [h.text, ...h.future],
    lastKey: null,
  };
}

export function redo(h: History): History {
  if (h.future.length === 0) return h;
  return {
    ...h,
    text: h.future[0],
    past: [...h.past, h.text],
    future: h.future.slice(1),
    lastKey: null,
  };
}

/** Records that `text` is what is now on disk. Undo history is kept. */
export function markSaved(h: History, text: string): History {
  return { ...h, saved: text };
}
