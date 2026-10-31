/**
 * The mobile Comments panel state: <CommentsProvider/> holds whether the Comments sheet is open and which thread it
 * shows, and useComments() hands { open, selectedKey, toggle, openThread, showList, close } to the top-bar Comments
 * button, the editor screen (a tapped marker opens its thread) and the sheet. Each reopen starts at the thread list, as
 * on desktop, and switching tabs closes the sheet. This is not a registry command: the button lives outside the registry.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useDocuments } from './documents';

export interface CommentsPanel {
  open: boolean;
  /** The thread shown in detail, or null for the list. */
  selectedKey: string | null;
  /** The top-bar button: opens the list, or closes the sheet when it is open. */
  toggle(): void;
  openThread(key: string): void;
  /** Close thread: back to the list. */
  showList(): void;
  close(): void;
}

const CommentsContext = createContext<CommentsPanel | null>(null);

export function useComments(): CommentsPanel {
  const c = useContext(CommentsContext);
  if (!c) throw new Error('useComments needs a <CommentsProvider>');
  return c;
}

export function CommentsProvider({ children }: { children: ReactNode }) {
  const { session } = useDocuments();
  const [open, setOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  useEffect(() => {
    setOpen(false);
    setSelectedKey(null);
  }, [session.activeId]);
  const toggle = useCallback(() => {
    setSelectedKey(null);
    setOpen((o) => !o);
  }, []);
  const openThread = useCallback((key: string) => {
    setSelectedKey(key);
    setOpen(true);
  }, []);
  const showList = useCallback(() => setSelectedKey(null), []);
  const close = useCallback(() => {
    setOpen(false);
    setSelectedKey(null);
  }, []);
  const value = useMemo(() => ({ open, selectedKey, toggle, openThread, showList, close }), [open, selectedKey, toggle, openThread, showList, close]);
  return <CommentsContext.Provider value={value}>{children}</CommentsContext.Provider>;
}
