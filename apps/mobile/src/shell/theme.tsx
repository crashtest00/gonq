/**
 * <ThemeProvider/>: runs the shared useTheme once for the whole mobile app (saved choice applied to <html>, Auto
 * following the OS) and useThemeChoice() hands [theme, setTheme] to the overflow menu, whose View > Theme registry
 * commands call setTheme. A failed save goes to the shell's error banner.
 */
import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { useTheme } from '@gonq/editor/lib/useTheme';
import { useNotices } from './notices';

type ThemeState = ReturnType<typeof useTheme>;

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { setError } = useNotices();
  const state = useTheme(useCallback((e: unknown) => setError(e instanceof Error ? e.message : String(e)), [setError]));
  return <ThemeContext.Provider value={state}>{children}</ThemeContext.Provider>;
}

export function useThemeChoice(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeChoice needs a <ThemeProvider>');
  return ctx;
}
