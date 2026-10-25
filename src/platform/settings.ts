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

export type ThemeChoice = 'light' | 'dark' | 'auto';
export const DEFAULT_THEME: ThemeChoice = 'auto';
export const THEME_KEY = 'gonq.theme';

/** The choice a stored value names; anything else (missing, unreadable, unknown) is Auto. */
export function parseTheme(value: unknown): ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'auto' ? value : DEFAULT_THEME;
}

/** The choice in the browser's localStorage, read synchronously (also the desktop's copy for the first paint). */
export function readStoredTheme(): ThemeChoice {
  try {
    return parseTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

function mirrorTheme(theme: ThemeChoice) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Only a cache so the next start paints in the right theme before the commands answer.
  }
}

/** The saved theme choice; Auto when none is saved or the store is unreadable or holds something else. */
export async function getTheme(): Promise<ThemeChoice> {
  if (!isTauri()) return readStoredTheme();
  try {
    const theme = parseTheme(await invoke<string>('get_theme'));
    mirrorTheme(theme);
    return theme;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Saves the choice. Rejects with the error (backend: its string) on failure. */
export async function setTheme(theme: ThemeChoice): Promise<ThemeChoice> {
  if (isTauri()) {
    const saved = parseTheme(await invoke<string>('set_theme', { theme }));
    mirrorTheme(saved);
    return saved;
  }
  localStorage.setItem(THEME_KEY, theme);
  return theme;
}
