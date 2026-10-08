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

/** Document text, its dirty state and undo history, and the one block currently open for editing. */
export function useDocument() {
  const [meta, setMeta] = useState<DocumentMeta | null>(null);
  const [history, setHistory] = useState<History>(() => createHistory(''));
  const [region, setRegionState] = useState<Region | null>(null);
  const regionRef = useRef<Region | null>(null);
  const nextId = useRef(1);
  const textRef = useRef('');
  textRef.current = history.text;

  const setRegion = useCallback((r: Region | null) => {
    regionRef.current = r;
    setRegionState(r);
  }, []);

  const load = useCallback(
    (doc: OpenedDocument) => {
      setRegion(null);
      setMeta({ name: doc.name, path: doc.path });
      setHistory(createHistory(doc.text));
    },
    [setRegion],
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

  const closeEdit = useCallback(() => setRegion(null), [setRegion]);

  const doUndo = useCallback(() => {
    setRegion(null);
    setHistory(undo);
  }, [setRegion]);
  const doRedo = useCallback(() => {
    setRegion(null);
    setHistory(redo);
  }, [setRegion]);

  const rename = useCallback((next: DocumentMeta, savedText: string) => {
    setMeta(next);
    setHistory((h) => markSaved(h, savedText));
  }, []);

  return useMemo(
    () => ({
      meta,
      text: history.text,
      dirty: meta !== null && isDirty(history),
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      region: region === null ? null : { from: region.from, to: region.to },
      load,
      startEdit,
      startAppend,
      changeEdit,
      closeEdit,
      replaceRange,
      undo: doUndo,
      redo: doRedo,
      /** Records that `savedText` is now on disk under `next`. */
      saved: rename,
    }),
    [meta, history, region, load, startEdit, startAppend, changeEdit, closeEdit, replaceRange, doUndo, doRedo, rename],
  );
}
