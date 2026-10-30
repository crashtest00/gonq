/**
 * A minimal stack navigator for the phone shell: <StackNavigator initial={screen}/> renders the top screen of a
 * stack, and useNavigator() gives push / pop / replace / reset to the screens inside it. A screen is
 * { key, title, render } so the shell's top bar can show the title and a Back button whenever the stack is deeper than one.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export interface Screen {
  key: string;
  /** Shown in the top bar; null shows no top bar (the splash). */
  title: string | null;
  render(): ReactNode;
}

export interface Navigator {
  stack: readonly Screen[];
  top: Screen;
  push(screen: Screen): void;
  pop(): void;
  /** Swaps the top screen. */
  replace(screen: Screen): void;
  /** Drops the whole stack for one screen. */
  reset(screen: Screen): void;
}

const NavigatorContext = createContext<Navigator | null>(null);

export function useNavigator(): Navigator {
  const ctx = useContext(NavigatorContext);
  if (!ctx) throw new Error('useNavigator needs a <NavigatorProvider>');
  return ctx;
}

export function NavigatorProvider({ initial, children }: { initial: Screen; children: ReactNode }) {
  const [stack, setStack] = useState<readonly Screen[]>([initial]);
  const push = useCallback((s: Screen) => setStack((st) => [...st, s]), []);
  const pop = useCallback(() => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st)), []);
  const replace = useCallback((s: Screen) => setStack((st) => [...st.slice(0, -1), s]), []);
  const reset = useCallback((s: Screen) => setStack([s]), []);
  const value = useMemo(() => ({ stack, top: stack[stack.length - 1], push, pop, replace, reset }), [stack, push, pop, replace, reset]);
  return <NavigatorContext.Provider value={value}>{children}</NavigatorContext.Provider>;
}

/** The top screen of the nearest NavigatorProvider. */
export function StackNavigator() {
  const { top } = useNavigator();
  return <>{top.render()}</>;
}
