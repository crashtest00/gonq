// The author name written on new messages, persisted outside any document: settings.json in the
// app config dir on desktop, localStorage in the browser.
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './files';

export const DEFAULT_AUTHOR = 'User';
export const MAX_AUTHOR_CHARS = 100;
export const AUTHOR_KEY = 'gonq.authorName';

/** The message header syntax reserves `|` and `]`; a header is one line. */
const UNWRITABLE = /[|\]\r\n]/;

/** Why a name cannot be saved, or null when it can. Blank is valid: it resets to the default. */
export function authorNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if ([...trimmed].length > MAX_AUTHOR_CHARS) return `Use at most ${MAX_AUTHOR_CHARS} characters.`;
  if (UNWRITABLE.test(trimmed)) return 'The name cannot contain "|", "]" or line breaks.';
  return null;
}

/** The saved name, or the default when none is set or the store is unreadable. */
export async function getAuthorName(): Promise<string> {
  try {
    const stored = isTauri() ? await invoke<string | null>('author_name_get') : localStorage.getItem(AUTHOR_KEY);
    return stored && stored.trim() !== '' && authorNameProblem(stored) === null ? stored.trim() : DEFAULT_AUTHOR;
  } catch {
    return DEFAULT_AUTHOR;
  }
}

/** Saves the trimmed name (blank resets to the default) and returns the name now in effect. Rejects on failure. */
export async function setAuthorName(name: string): Promise<string> {
  const problem = authorNameProblem(name);
  if (problem !== null) throw new Error(problem);
  const trimmed = name.trim();
  if (isTauri()) {
    const stored = await invoke<string | null>('author_name_set', { name: trimmed });
    return stored ?? DEFAULT_AUTHOR;
  }
  if (trimmed === '') localStorage.removeItem(AUTHOR_KEY);
  else localStorage.setItem(AUTHOR_KEY, trimmed);
  return trimmed === '' ? DEFAULT_AUTHOR : trimmed;
}
