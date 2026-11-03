/**
 * The Android system Back key for the phone shell. <BackProvider/> registers the platform hook once
 * (@gonq/editor/platform/backButton, Tauri's onBackButtonPress) and sends every press to the topmost registered handler:
 * useBackHandler(active, handler, level) puts a handler on the stack while `active`. Levels, lowest first: 'nav' (the
 * navigator's default, in <BackNavigation/>), 'screen' (a screen with its own Back/Cancel steps, like the sign-in and Open PR
 * screens) and 'overlay' (a sheet, menu, drawer or dialog, which closes as its own Close/Cancel control would). The highest level
 * wins, the latest registration within a level. Nothing is registered outside the Android app, so Beta is unchanged.
 */
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { onAndroidBack } from '@gonq/editor/platform/backButton';

export type BackLevel = 'nav' | 'screen' | 'overlay';
const RANK: Record<BackLevel, number> = { nav: 0, screen: 1, overlay: 2 };

interface Entry {
  level: BackLevel;
  run(): void;
}

interface BackStack {
  add(entry: Entry): () => void;
}

const BackContext = createContext<BackStack | null>(null);

export function BackProvider({ children }: { children: ReactNode }) {
  const entries = useRef<Entry[]>([]);
  const stack = useMemo<BackStack>(
    () => ({
      add(entry) {
        entries.current.push(entry);
        return () => {
          entries.current = entries.current.filter((e) => e !== entry);
        };
      },
    }),
    [],
  );
  useEffect(
    () =>
      onAndroidBack(() => {
        let top: Entry | undefined;
        for (const e of entries.current) if (top === undefined || RANK[e.level] >= RANK[top.level]) top = e;
        top?.run();
      }),
    [],
  );
  return <BackContext.Provider value={stack}>{children}</BackContext.Provider>;
}

/** While `active`, Back runs `handler` unless something above it on the stack takes it first. The latest `handler` is always the one called. */
export function useBackHandler(active: boolean, handler: () => void, level: BackLevel = 'overlay') {
  const stack = useContext(BackContext);
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!active || stack === null) return;
    return stack.add({ level, run: () => latest.current() });
  }, [active, level, stack]);
}
