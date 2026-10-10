import { useCallback, useMemo, useRef, useState } from 'react';
import type { OpenedDocument } from '../platform/files';
import type { RemoteStat } from '../platform/remote';
import { normalizeEol, toFileText } from './eol';

export interface DocumentMeta {
  name: string;
  /** Absolute path on disk; null for a new document or one opened in the browser. */
  path: string | null;
  /** ssh:// documents: the server's version at the last read or save, sent back as `expected` on save. */
  remote?: RemoteStat;
}

/**
 * One open document: what the app needs to know about it between editor events. The editor itself
 * (caret, scroll, undo history) keeps the rest of a tab's state while the tab is not shown.
 */
interface Tab {
  id: number;
  meta: DocumentMeta;
  /** The document text as the editor holds it: every line break is `\n`. */
  text: string;
  /** The file as last read or saved, byte for byte; the document is dirty when `text` differs from it. */
  original: string;
  canUndo: boolean;
  canRedo: boolean;
  raw: boolean;
}

interface Tabs {
  tabs: Tab[];
  activeId: number | null;
}

export interface TabInfo {
  id: number;
  name: string;
  path: string | null;
  dirty: boolean;
}

const NO_TABS: Tabs = { tabs: [], activeId: null };

const isDirty = (t: Tab) => t.text !== normalizeEol(t.original);

/** "Untitled.md", then "Untitled 2.md", ... — the first name no open tab uses. */
function untitledName(tabs: Tab[]): string {
  const used = new Set(tabs.map((t) => t.meta.name));
  for (let n = 1; ; n++) {
    const name = n === 1 ? 'Untitled.md' : `Untitled ${n}.md`;
    if (!used.has(name)) return name;
  }
}

/**
 * The open documents and which one is active. The returned document fields (text, dirty...) are the
 * active tab's. Text edits are made in the editor and reported here through `edited`.
 */
export function useDocument() {
  const [state, setState] = useState<Tabs>(NO_TABS);
  const stateRef = useRef(state);
  const nextTabId = useRef(1);

  /** Applies `fn` to the tabs; the ref follows at once so a read right after an event sees it. */
  const update = useCallback((fn: (s: Tabs) => Tabs) => {
    const next = fn(stateRef.current);
    stateRef.current = next;
    setState(next);
  }, []);
  const patch = useCallback(
    (id: number, fn: (t: Tab) => Tab) => update((s) => ({ ...s, tabs: s.tabs.map((t) => (t.id === id ? fn(t) : t)) })),
    [update],
  );

  const active = state.tabs.find((t) => t.id === state.activeId) ?? null;
  const meta = active?.meta ?? null;

  /** The id of the tab showing this file, if it is open. */
  const findByPath = useCallback(
    (path: string | null) => (path === null ? null : (stateRef.current.tabs.find((t) => t.meta.path === path)?.id ?? null)),
    [],
  );

  const activate = useCallback(
    (id: number) => {
      if (!stateRef.current.tabs.some((t) => t.id === id)) return;
      update((s) => (s.activeId === id ? s : { ...s, activeId: id }));
    },
    [update],
  );

  const add = useCallback(
    (meta: DocumentMeta, original: string) => {
      const id = nextTabId.current++;
      const tab: Tab = { id, meta, text: normalizeEol(original), original, canUndo: false, canRedo: false, raw: false };
      update((s) => ({ tabs: [...s.tabs, tab], activeId: id }));
    },
    [update],
  );

  /** Opens a document in a new tab; a file that is already open just gets its tab shown. */
  const open = useCallback(
    (doc: OpenedDocument) => {
      const existing = findByPath(doc.path);
      if (existing !== null) return activate(existing);
      add({ name: doc.name, path: doc.path, remote: doc.remote }, doc.text);
    },
    [findByPath, activate, add],
  );

  /** Opens a new empty untitled document in a new tab. */
  const openUntitled = useCallback(() => add({ name: untitledName(stateRef.current.tabs), path: null }, ''), [add]);

  /** Closes a tab without asking; closing the last one leaves no tab at all. */
  const close = useCallback(
    (id: number) => {
      update((s) => {
        const i = s.tabs.findIndex((t) => t.id === id);
        if (i < 0) return s;
        const tabs = s.tabs.filter((t) => t.id !== id);
        if (tabs.length === 0) return NO_TABS;
        const activeId = s.activeId === id ? tabs[Math.min(i, tabs.length - 1)].id : s.activeId;
        return { tabs, activeId };
      });
    },
    [update],
  );

  const setRaw = useCallback(
    (raw: boolean) => {
      const id = stateRef.current.activeId;
      if (id !== null) patch(id, (t) => ({ ...t, raw }));
    },
    [patch],
  );

  /** The editor changed tab `id`'s text, or what undo and redo can do. */
  const edited = useCallback(
    (id: number, change: { text: string; canUndo: boolean; canRedo: boolean }) => patch(id, (t) => ({ ...t, ...change })),
    [patch],
  );

  /** A tab's current name, path, dirty state and the text to write for it, read without waiting for a render. */
  const peek = useCallback((id: number) => {
    const t = stateRef.current.tabs.find((x) => x.id === id);
    return t ? { meta: t.meta, text: toFileText(t.text, t.original), dirty: isDirty(t) } : null;
  }, []);
  const peekTabs = useCallback(
    (): TabInfo[] => stateRef.current.tabs.map((t) => ({ id: t.id, name: t.meta.name, path: t.meta.path, dirty: isDirty(t) })),
    [],
  );
  const dirtyIds = useCallback(() => stateRef.current.tabs.filter(isDirty).map((t) => t.id), []);

  /** Records that `savedText` (as written to disk) is now the file for tab `id`, under `next`. */
  const saved = useCallback(
    (id: number, next: DocumentMeta, savedText: string) => patch(id, (t) => ({ ...t, meta: next, original: savedText })),
    [patch],
  );

  const tabInfos = useMemo(() => state.tabs.map((t): TabInfo => ({ id: t.id, name: t.meta.name, path: t.meta.path, dirty: isDirty(t) })), [state.tabs]);
  const tabIds = useMemo(() => state.tabs.map((t) => t.id), [state.tabs]);

  return useMemo(
    () => ({
      meta,
      tabs: tabInfos,
      tabIds,
      activeId: state.activeId,
      raw: active?.raw ?? false,
      text: active?.text ?? '',
      dirty: active !== null && isDirty(active),
      canUndo: active?.canUndo ?? false,
      canRedo: active?.canRedo ?? false,
      open,
      openUntitled,
      close,
      activate,
      findByPath,
      setRaw,
      edited,
      peek,
      peekTabs,
      dirtyIds,
      saved,
    }),
    [meta, tabInfos, tabIds, state.activeId, active, open, openUntitled, close, activate, findByPath, setRaw, edited, peek, peekTabs, dirtyIds, saved],
  );
}
