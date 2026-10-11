import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import { EditorState, type Extension, type StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { applyFormat, type Format } from '../components/formatting';
import { createCommentThread, formatCommentMarker, normalizeAnchor, serializeCommentThread, effectiveCommentCreationPosition, AGENT_GUIDANCE, hasAgentGuidance } from '../comment-threads';
import { commentThreadCreationChanges } from '../comment-threads/editor/codemirror';
import { createEditorState, modeCompartment, modeExtension } from './extensions';
import { editorHost } from './host';
import { threadEdit } from './threads';

export interface EditorChange {
  text: string;
  canUndo: boolean;
  canRedo: boolean;
}

export interface EditorSelection {
  from: number;
  to: number;
  /** Viewport position just after the end of a non-empty selection (for the comment button). */
  x: number;
  y: number;
}

export interface EditorHandle {
  undo(): void;
  redo(): void;
  /** Applies a toolbar format to the selection as ordinary editor changes. */
  format(format: Format, url?: string): void;
  /** Replaces the document text (comment-thread operations) as one undoable change; only the differing middle is touched. */
  setText(next: string): void;
  /** Scrolls the text at `offset` to the top of the canvas; `select` also puts the caret there. */
  reveal(offset: number, select?: boolean): void;
  /**
   * Opens a thread on the selection `{from, to}` or at a caret offset: the marker goes where `safeMarkerPosition`
   * puts it and the block (with the agent note, once per file) at the end, as one undoable change.
   * Returns the new document text, or throws (e.g. an author name the format cannot hold).
   */
  createThread(target: { from: number; to: number } | number, author: string, body: string): string;
  /** Collapses the selection to its end. */
  collapse(): void;
  focus(): void;
}

interface Props {
  /** The active tab; each tab keeps its own editor state (text, caret, undo history) and scroll. */
  tabId: number;
  /** The tab's text, used only to create its editor state the first time it is shown. */
  text: string;
  raw: boolean;
  /** Ids of every open tab; the state of a closed tab is dropped. */
  tabIds: number[];
  onChange: (id: number, change: EditorChange) => void;
  onSelection: (selection: EditorSelection | null, head: number) => void;
  /** Path of the document in the active tab; relative images are read from beside it. */
  docPath: string | null;
  /** A 💬 / ✅ marker was clicked. */
  onOpenThread: (id: string, ordinal: number) => void;
}

interface Saved {
  state: EditorState;
  scroll: StateEffect<unknown>;
}

const summary = (state: EditorState): EditorChange => ({
  text: state.doc.toString(),
  canUndo: undoDepth(state) > 0,
  canRedo: redoDepth(state) > 0,
});

/** The single smallest replacement that turns `a` into `b`. */
function diff(a: string, b: string): { from: number; to: number; insert: string } {
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a[start] === b[start]) start++;
  let end = 0;
  while (end < max - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return { from: start, to: a.length - end, insert: b.slice(start, b.length - end) };
}

/**
 * The one editor for the document: a single CodeMirror view whose state is swapped when the active tab
 * changes. Everything about editing text is CodeMirror's; this component only hosts it.
 */
export const MarkdownEditor = forwardRef<EditorHandle, Props>(function MarkdownEditor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const saved = useRef(new Map<number, Saved>());
  const current = useRef<number | null>(null);
  const latest = useRef(props);
  latest.current = props;

  // One listener, part of every tab's state, reports changes of whichever tab is shown.
  const listener = useRef<Extension | null>(null);
  listener.current ??= EditorView.updateListener.of((u) => {
    const id = current.current;
    if (id === null) return;
    if (u.docChanged || u.transactions.some((t) => undoDepth(t.startState) !== undoDepth(t.state) || redoDepth(t.startState) !== redoDepth(t.state))) {
      latest.current.onChange(id, summary(u.state));
    }
    if (u.docChanged || u.selectionSet) {
      const r = u.state.selection.main;
      let sel: EditorSelection | null = null;
      if (!r.empty) {
        const box = u.view.coordsAtPos(r.to);
        sel = { from: r.from, to: r.to, x: (box?.right ?? 0) + 4, y: Math.max(0, (box?.top ?? 0) - 30) };
      }
      latest.current.onSelection(sel, r.head);
    }
  });

  const hostExt = useRef<Extension | null>(null);
  hostExt.current ??= editorHost.of({ docPath: () => latest.current.docPath, openThread: (id, ordinal) => latest.current.onOpenThread(id, ordinal) });
  const extras = () => [listener.current!, hostExt.current!];

  useLayoutEffect(() => {
    const { tabId, text, raw } = latest.current;
    const v = new EditorView({ state: createEditorState(text, raw, extras()), parent: host.current! });
    view.current = v;
    current.current = tabId;
    return () => {
      v.destroy();
      view.current = null;
    };
  }, []);

  // Switching tabs: park the current state and scroll position, bring the other tab's back.
  useLayoutEffect(() => {
    const v = view.current;
    if (!v || current.current === props.tabId) return;
    if (current.current !== null) saved.current.set(current.current, { state: v.state, scroll: v.scrollSnapshot() });
    current.current = props.tabId;
    const back = saved.current.get(props.tabId);
    v.setState(back?.state ?? createEditorState(props.text, props.raw, extras()));
    if (back) v.dispatch({ effects: back.scroll });
    else v.scrollDOM.scrollTop = 0;
    saved.current.delete(props.tabId);
  }, [props.tabId, props.text, props.raw]);

  // Formatted / Raw: the same state, a different mode extension.
  useLayoutEffect(() => {
    const v = view.current;
    if (!v) return;
    const want = modeExtension(props.raw);
    if (modeCompartment.get(v.state) !== want) v.dispatch({ effects: modeCompartment.reconfigure(want) });
  }, [props.raw, props.tabId]);

  // Closed tabs release their state.
  useEffect(() => {
    for (const id of saved.current.keys()) if (!props.tabIds.includes(id)) saved.current.delete(id);
  }, [props.tabIds]);

  useImperativeHandle(
    ref,
    () => ({
      undo: () => view.current && (undo(view.current), view.current.focus()),
      redo: () => view.current && (redo(view.current), view.current.focus()),
      format(format, url = '') {
        const v = view.current;
        if (!v) return;
        const value = v.state.doc.toString();
        const sel = v.state.selection.main;
        const next = applyFormat(format, value, sel.from, sel.to, url);
        const change = diff(value, next.value);
        v.dispatch({
          ...(next.value === value ? {} : { changes: change }),
          selection: { anchor: next.start, head: next.end },
          userEvent: 'input.format',
          scrollIntoView: true,
        });
        v.focus();
      },
      setText(next) {
        const v = view.current;
        if (!v) return;
        const change = diff(v.state.doc.toString(), next);
        if (change.from === change.to && change.insert === '') return;
        v.dispatch({ changes: change, userEvent: 'input.replace', annotations: threadEdit.of(true) });
      },
      reveal(offset, select = false) {
        const v = view.current;
        if (!v) return;
        const at = Math.min(Math.max(offset, 0), v.state.doc.length);
        v.dispatch({
          ...(select ? { selection: { anchor: at } } : {}),
          effects: EditorView.scrollIntoView(at, { y: 'start', yMargin: 20 }),
        });
      },
      createThread(target, author, body) {
        const v = view.current;
        if (!v) throw new Error('No document is open.');
        const selected = typeof target === 'number' ? '' : v.state.sliceDoc(target.from, target.to);
        const thread = createCommentThread(author, body, normalizeAnchor(selected));
        const position =
          typeof target === 'number'
            ? target
            : effectiveCommentCreationPosition({ empty: target.from === target.to, head: target.from, to: target.to }, selected);
        // The note for agents goes just ahead of the first block, once per file.
        const block = `${hasAgentGuidance(v.state.doc.toString()) ? '' : `${AGENT_GUIDANCE}\n\n`}${serializeCommentThread(thread)}\n`;
        v.dispatch({
          changes: commentThreadCreationChanges(v.state, position, formatCommentMarker(thread.id), block),
          userEvent: 'input.thread',
          annotations: threadEdit.of(true),
        });
        return v.state.doc.toString();
      },
      collapse() {
        const v = view.current;
        if (v) v.dispatch({ selection: { anchor: v.state.selection.main.head } });
      },
      focus: () => view.current?.focus(),
    }),
    [],
  );

  // A click anywhere on the canvas outside the text, below the last line included, puts the caret in the editor.
  const onMouseDown = (e: React.MouseEvent) => {
    const v = view.current;
    if (!v || (e.target instanceof Node && v.contentDOM.contains(e.target))) return;
    e.preventDefault();
    let at = v.state.doc.length;
    if (e.clientY < v.contentDOM.getBoundingClientRect().bottom) {
      try {
        at = v.posAtCoords({ x: e.clientX, y: e.clientY }, false);
      } catch {
        /* no layout: end of the document */
      }
    }
    v.focus();
    v.dispatch({ selection: { anchor: at }, scrollIntoView: true });
  };

  return <div ref={host} data-testid="editor" onMouseDown={onMouseDown} className="gonq-editor min-h-0 flex-1" />;
});
