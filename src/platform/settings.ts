// The author name written on new messages, persisted outside any document: settings.json in the
// app config dir on desktop, localStorage in the browser.
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './files';

export const DEFAULT_AUTHOR = 'User';
export const MAX_AUTHOR_CHARS = 100;
export const AUTHOR_KEY = 'gonq.authorName';

/** The message header syntax reserves `|` and `]`; a header is one line. */
const UNWRITABLE = /[|\]\r\n]/;

/** Why a name cannot be saved, or null when it can. Blank names are refused. */
export function authorNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Enter a name.';
  if ([...trimmed].length > MAX_AUTHOR_CHARS) return `Use at most ${MAX_AUTHOR_CHARS} characters.`;
  if (UNWRITABLE.test(trimmed)) return 'The name cannot contain "|", "]" or line breaks.';
  return null;
}

/** The saved name, or the default when none is set or the store is unreadable. */
export async function getAuthorName(): Promise<string> {
  try {
    const stored = isTauri() ? await invoke<string>('get_author_name') : localStorage.getItem(AUTHOR_KEY);
    return stored && stored.trim() !== '' && authorNameProblem(stored) === null ? stored.trim() : DEFAULT_AUTHOR;
  } catch {
    return DEFAULT_AUTHOR;
  }
}

/** Saves the trimmed name and returns the name now in effect. Rejects with the error (backend: its string) on failure. */
export async function setAuthorName(name: string): Promise<string> {
  const problem = authorNameProblem(name);
  if (problem !== null) throw new Error(problem);
  const trimmed = name.trim();
  if (isTauri()) {
    return await invoke<string>('set_author_name', { name: trimmed });
  }
  localStorage.setItem(AUTHOR_KEY, trimmed);
  return trimmed;
}

export const SHOW_MARKERS_KEY = 'gonq.showMarkersInActiveBlock';

/** Whether the block being edited shows its Markdown syntax markers (**, #, -, ...). On unless turned off; on when unreadable. */
export async function getShowMarkers(): Promise<boolean> {
  try {
    return isTauri() ? (await invoke<boolean>('get_show_markers')) !== false : localStorage.getItem(SHOW_MARKERS_KEY) !== 'false';
  } catch {
    return true;
  }
}

/** Saves the option and returns the value now in effect. Rejects with the error on failure. */
export async function setShowMarkers(show: boolean): Promise<boolean> {
  if (isTauri()) return await invoke<boolean>('set_show_markers', { show });
  localStorage.setItem(SHOW_MARKERS_KEY, String(show));
  return show;
}
