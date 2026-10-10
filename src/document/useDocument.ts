import { useCallback, useMemo, useRef, useState } from 'react';
import { parseCommentThreads } from '../comment-threads';
import type { OpenedDocument } from '../platform/files';
import { createHistory, edit, isDirty, markSaved, redo, undo, type History } from './history';
import { detectEol, splice } from './splice';

export interface DocumentMeta {
  name: string;
  /** Absolute path on disk; null for a new document or one opened in the browser. */
  path: string | null;
}

/**
 * The block being edited: text[from, to) in the document. `prefix` and `suffix`
 * are separators still owed around brand-new text; they are written together
 * with its first character, so opening the editor on nothing changes nothing.
 */
interface Region {
  id: number;
  from: number;
  to: number;
  prefix: string;
  suffix: string;
}

/** One open document: everything that belongs to it and must survive switching tabs. */
interface Tab {
  id: number;
  meta: DocumentMeta;
  history: History;
  scrollTop: number;
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

const EMPTY_HISTORY = createHistory('');
const NO_TABS: Tabs = { tabs: [], activeId: null };

/** "Untitled.md", then "Untitled 2.md", ... — the first name no open tab uses. */
function untitledName(tabs: Tab[]): string {
  const used = new Set(tabs.map((t) => t.meta.name));
  for (let n = 1; ; n++) {
    const name = n === 1 ? 'Untitled.md' : `Untitled ${n}.md`;
    if (!used.has(name)) return name;
  }
}

/**
 * The open documents and which one is active. The returned document fields (text, history,
 * dirty...) are the active tab's; the one block open for editing belongs to it too.
 */
export function useDocument() {
  const [state, setState] = useState<Tabs>(NO_TABS);
  const stateRef = useRef(state);
  stateRef.current = state;
  const active = state.tabs.find((t) => t.id === state.activeId) ?? null;
  const meta = active?.meta ?? null;
  const history = active?.history ?? EMPTY_HISTORY;
  const [region, setRegionState] = useState<Region | null>(null);
  const regionRef = useRef<Region | null>(null);
  const nextId = useRef(1);
  const nextTabId = useRef(1);
  const textRef = useRef('');
  textRef.current = history.text;

  const setRegion = useCallback((r: Region | null) => {
    regionRef.current = r;
    setRegionState(r);
  }, []);

  /** Applies `fn` to the active tab's history. */
  const setHistory = useCallback((fn: (h: History) => History) => {
    setState((s) => ({
      ...s,
      tabs: s.tabs.map((t) => (t.id === s.activeId ? { ...t, history: fn(t.history) } : t)),
    }));
  }, []);

  /** The id of the tab showing this file, if it is open. */
  const findByPath = useCallback(
    (path: string | null) => (path === null ? null : (stateRef.current.tabs.find((t) => t.meta.path === path)?.id ?? null)),
    [],
  );

  const activate = useCallback(
    (id: number) => {
      if (!stateRef.current.tabs.some((t) => t.id === id)) return;
      setRegion(null);
      setState((s) => (s.activeId === id ? s : { ...s, activeId: id }));
    },
    [setRegion],
  );

  /** Opens a document in a new tab; a file that is already open just gets its tab shown. */
  const open = useCallback(
    (doc: OpenedDocument) => {
      setRegion(null);
      const existing = findByPath(doc.path);
      if (existing !== null) return activate(existing);
      const id = nextTabId.current++;
      const tab: Tab = { id, meta: { name: doc.name, path: doc.path }, history: createHistory(doc.text), scrollTop: 0, raw: false };
      setState((s) => ({ tabs: [...s.tabs, tab], activeId: id }));
    },
    [setRegion, findByPath, activate],
  );

  /** Opens a new empty untitled document in a new tab. */
  const openUntitled = useCallback(() => {
    setRegion(null);
    const id = nextTabId.current++;
    setState((s) => {
      const tab: Tab = { id, meta: { name: untitledName(s.tabs), path: null }, history: createHistory(''), scrollTop: 0, raw: false };
      return { tabs: [...s.tabs, tab], activeId: id };
    });
  }, [setRegion]);

  /** Closes a tab without asking; closing the last one leaves no tab at all. */
  const close = useCallback(
    (id: number) => {
      setRegion(null);
      setState((s) => {
        const i = s.tabs.findIndex((t) => t.id === id);
        if (i < 0) return s;
        const tabs = s.tabs.filter((t) => t.id !== id);
        if (tabs.length === 0) return NO_TABS;
        const activeId = s.activeId === id ? tabs[Math.min(i, tabs.length - 1)].id : s.activeId;
        return { tabs, activeId };
      });
    },
    [setRegion],
  );

  const setRaw = useCallback((raw: boolean) => {
    setState((s) => ({ ...s, tabs: s.tabs.map((t) => (t.id === s.activeId ? { ...t, raw } : t)) }));
  }, []);

  /** Scroll offset is remembered without re-rendering. */
  const setScrollTop = useCallback((scrollTop: number) => {
    const t = stateRef.current.tabs.find((x) => x.id === stateRef.current.activeId);
    if (t) t.scrollTop = scrollTop;
  }, []);

  /** A tab's current name, path, text and dirty state, read without waiting for a render. */
  const peek = useCallback((id: number) => {
    const t = stateRef.current.tabs.find((x) => x.id === id);
    return t ? { meta: t.meta, text: t.history.text, dirty: isDirty(t.history) } : null;
  }, []);
  const peekTabs = useCallback(
    (): TabInfo[] => stateRef.current.tabs.map((t) => ({ id: t.id, name: t.meta.name, path: t.meta.path, dirty: isDirty(t.history) })),
    [],
  );
  const dirtyIds = useCallback(
    () => stateRef.current.tabs.filter((t) => isDirty(t.history)).map((t) => t.id),
    [],
  );

  const startEdit = useCallback(
    (range: { from: number; to: number }) => setRegion({ id: nextId.current++, ...range, prefix: '', suffix: '' }),
    [setRegion],
  );

  /** Opens an empty editor for a new block after the last one, ahead of any thread blocks at the end. */
  const startAppend = useCallback(() => {
    const text = textRef.current;
    const eol = detectEol(text);
    const firstThread = Math.min(text.length, ...[...parseCommentThreads(text)].map((t) => t.from));
    const before = text.slice(0, firstThread);
    const after = text.slice(firstThread);
    const blankBefore = /(\r?\n){2}$/.test(before);
    const prefix = before === '' || blankBefore ? '' : /\n$/.test(before) ? eol : eol + eol;
    const suffix =
      after === '' ? eol : /^(\r?\n){2}/.test(after) ? '' : /^\r?\n/.test(after) ? eol : eol + eol;
    setRegion({ id: nextId.current++, from: firstThread, to: firstThread, prefix, suffix });
  }, [setRegion]);

  const changeEdit = useCallback(
    (value: string) => {
      const r = regionRef.current;
      if (r === null) return;
      const pending = r.prefix !== '' || r.suffix !== '';
      if (pending && value === '') return;
      const from = r.from + r.prefix.length;
      const next: Region = { ...r, from, to: from + value.length, prefix: '', suffix: '' };
      setRegion(next);
      setHistory((h) => edit(h, splice(h.text, r.from, r.to, r.prefix + value + r.suffix), `block-${r.id}`));
    },
    [setRegion],
  );

  /** Replaces text[from, to) as one undo step, outside any block being edited. */
  const replaceRange = useCallback((from: number, to: number, insert: string) => {
    setHistory((h) => edit(h, splice(h.text, from, to, insert)));
  }, []);

  /**
   * Replaces text[from, to) as typing: edits sharing `key` in quick succession are one undo step.
   * The block-editing region is not involved; the caller tracks where the caret goes.
   */
  const spliceText = useCallback((from: number, to: number, insert: string, key: string) => {
    setHistory((h) => edit(h, splice(h.text, from, to, insert), key));
  }, []);

  /** Replaces the whole text with a document built by the comment-threads library, as one undo step. */
  const replaceText = useCallback(
    (next: string) => {
      setRegion(null);
      setHistory((h) => edit(h, next));
    },
    [setRegion],
  );

  const closeEdit = useCallback(() => setRegion(null), [setRegion]);

  const doUndo = useCallback(() => {
    setRegion(null);
    setHistory(undo);
  }, [setRegion]);
  const doRedo = useCallback(() => {
    setRegion(null);
    setHistory(redo);
  }, [setRegion]);

  /** Records that `savedText` is now on disk for tab `id` under `next`. */
  const rename = useCallback((id: number, next: DocumentMeta, savedText: string) => {
    setState((s) => ({
      ...s,
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, meta: next, history: markSaved(t.history, savedText) } : t)),
    }));
  }, []);

  return useMemo(
    () => ({
      meta,
      tabs: state.tabs.map((t): TabInfo => ({ id: t.id, name: t.meta.name, path: t.meta.path, dirty: isDirty(t.history) })),
      activeId: state.activeId,
      activeTab: active,
      raw: active?.raw ?? false,
      text: history.text,
      dirty: meta !== null && isDirty(history),
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      region: region === null ? null : { from: region.from, to: region.to },
      open,
      openUntitled,
      close,
      activate,
      findByPath,
      setRaw,
      setScrollTop,
      peek,
      peekTabs,
      dirtyIds,
      startEdit,
      startAppend,
      changeEdit,
      closeEdit,
      replaceRange,
      spliceText,
      replaceText,
      undo: doUndo,
      redo: doRedo,
      saved: rename,
    }),
    [meta, state, active, history, region, open, openUntitled, close, activate, findByPath, setRaw, setScrollTop, peek, peekTabs, dirtyIds, startEdit, startAppend, changeEdit, closeEdit, replaceRange, spliceText, replaceText, doUndo, doRedo, rename],
  );
}
