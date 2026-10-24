import { useCallback, useEffect, useState } from 'react';
import { applyTheme, isDark, systemPrefersDark, systemScheme } from './theme';
import { getTheme, readStoredTheme, setTheme, type ThemeChoice } from '../platform/settings';

/**
 * The theme choice (default Auto), applied to <html>. Auto follows the OS live; Light and Dark ignore it.
 * A failed save keeps the new choice for this session and goes to `onError`.
 */
export function useTheme(onError: (e: unknown) => void) {
  const [choice, setChoice] = useState<ThemeChoice>(readStoredTheme);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    let live = true;
    getTheme().then((t) => live && setChoice(t));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const mq = systemScheme();
    if (!mq) return;
    const on = () => setSystemDark(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  const dark = isDark(choice, systemDark);
  useEffect(() => applyTheme(dark), [dark]);

  const choose = useCallback(
    (next: ThemeChoice) => {
      setChoice(next);
      setTheme(next).catch(onError);
    },
    [onError],
  );
  return [choice, choose] as const;
}
