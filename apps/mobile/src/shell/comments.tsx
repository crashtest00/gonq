/**
 * The mobile Comments panel state: <CommentsProvider/> holds whether the Comments sheet is open, which thread it
 * shows and the new-comment draft (target, the document text it was started on, quoted anchor), and useComments() hands
 * { open, selectedKey, draft, startDraft, cancelDraft, toggle, openThread, showList, close } to the top-bar Comments
 * button, the Add Comment command (commandContext), the editor screen (a tapped marker opens its thread) and the sheet.
 * Each reopen starts at the thread list, as on desktop (which also drops a draft), and switching tabs closes the sheet. This is not a registry command: the button lives outside the registry.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ThreadTarget } from '@gonq/editor/model/newThread';
import { useDocuments } from './documents';

/** The comment being written: where it goes, the text it was started on (a change in between refuses the save), the quoted selection. */
export interface CommentDraft {
  target: ThreadTarget;
  text: string;
  anchor?: string;
}

export interface CommentsPanel {
  draft: CommentDraft | null;
  /** Opens the sheet on a new-comment box (desktop startDraft). */
  startDraft(draft: CommentDraft): void;
  cancelDraft(): void;
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
  const [draft, setDraft] = useState<CommentDraft | null>(null);
  useEffect(() => {
    setOpen(false);
    setSelectedKey(null);
    setDraft(null);
  }, [session.activeId]);
  const startDraft = useCallback((d: CommentDraft) => {
    setSelectedKey(null);
    setDraft(d);
    setOpen(true);
  }, []);
  const cancelDraft = useCallback(() => setDraft(null), []);
  const toggle = useCallback(() => {
    setSelectedKey(null);
    setDraft(null);
    setOpen((o) => !o);
  }, []);
  const openThread = useCallback((key: string) => {
    setDraft(null);
    setSelectedKey(key);
    setOpen(true);
  }, []);
  const showList = useCallback(() => setSelectedKey(null), []);
  const close = useCallback(() => {
    setDraft(null);
    setOpen(false);
    setSelectedKey(null);
  }, []);
  const value = useMemo(() => ({ open, selectedKey, draft, startDraft, cancelDraft, toggle, openThread, showList, close }), [open, selectedKey, draft, startDraft, cancelDraft, toggle, openThread, showList, close]);
  return <CommentsContext.Provider value={value}>{children}</CommentsContext.Provider>;
}
