/**
 * The mobile Outline drawer state: <OutlineProvider/> holds whether the drawer is open and useOutline() hands
 * { open, toggle, close } to the top-bar Outline button and the drawer. Switching tabs closes it. This is not a registry
 * command: the button lives outside the registry (decision D5), so the desktop menus are unchanged.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useDocuments } from './documents';

export interface OutlinePanel {
  open: boolean;
  toggle(): void;
  close(): void;
}

const OutlineContext = createContext<OutlinePanel | null>(null);

export function useOutline(): OutlinePanel {
  const o = useContext(OutlineContext);
  if (!o) throw new Error('useOutline needs an <OutlineProvider>');
  return o;
}

export function OutlineProvider({ children }: { children: ReactNode }) {
  const { session } = useDocuments();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [session.activeId]);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  const close = useCallback(() => setOpen(false), []);
  const value = useMemo(() => ({ open, toggle, close }), [open, toggle, close]);
  return <OutlineContext.Provider value={value}>{children}</OutlineContext.Provider>;
}
