// Applying the light/dark theme: a `.dark` class on <html> swaps the CSS variables in styles/tokens.css.
import type { ThemeChoice } from '../platform/settings';

const QUERY = '(prefers-color-scheme: dark)';

/** The media query list for the OS colour scheme, or null where matchMedia is unavailable. */
export function systemScheme(): MediaQueryList | null {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;
  } catch {
    return null;
  }
}

/** Whether the OS prefers dark; no preference, or no way to ask, is light. */
export function systemPrefersDark(): boolean {
  return systemScheme()?.matches === true;
}

export function isDark(choice: ThemeChoice, systemDark: boolean): boolean {
  return choice === 'dark' || (choice === 'auto' && systemDark);
}

/** Sets or clears `.dark` on <html>. Instant: transitions are switched off for the moment of the change. */
export function applyTheme(dark: boolean): void {
  const root = document.documentElement;
  if (root.classList.contains('dark') === dark) return;
  root.classList.add('theme-switching');
  root.classList.toggle('dark', dark);
  void root.offsetHeight; // style recalculation happens with transitions off
  setTimeout(() => root.classList.remove('theme-switching'), 0);
}
