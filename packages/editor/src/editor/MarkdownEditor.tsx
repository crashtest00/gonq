/**
 * The one CodeMirror 6 editor for the document: one EditorView whose state is swapped per tab. Exposes
 * EditorHandle (format, replace text, threads, images, TOC, clipboard, scroll) and reports changes,
 * selection and table target to App.tsx.
 */
import { redo, redoDepth, selectAll, undo, undoDepth } from '@codemirror/commands';
import { EditorState, type Extension, type StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { caretOffset, keepCaretVisible } from './caretAnchor';
import { focusCaretCell, focusTableCell, releaseTable, runTableOp, tableTargetListener, type TableOp, type TableTarget } from './tables';
import { type Format } from '../model/formatting';
import { diff, formatView } from './formatCommands';
import { createCommentThread, formatCommentMarker, normalizeAnchor, serializeCommentThread, effectiveCommentCreationPosition, AGENT_GUIDANCE, hasAgentGuidance } from '../comment-threads';
import { commentThreadCreationChanges } from '../comment-threads/editor/codemirror';
import { createEditorState, modeCompartment, modeExtension, readOnlyCompartment, readOnlyExtension } from './extensions';
import { editorHost } from './host';
import { threadEdit } from './threads';
import { refreshToc } from './toc';
import { tocChange } from '../model/toc';

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
  /** Inserts `![alt](src)` at the caret (replacing the selection) as one undoable change. */
  insertImage(src: string, alt: string): void;
  /** Inserts a table of contents at the caret, or rebuilds the existing one; one undoable change. Returns whether it refreshed one. */
  insertToc(): 'inserted' | 'refreshed';
  /** Copies the selection to the clipboard (throws a clear error when the browser refuses). */
  copy(): Promise<void>;
  /** Copies the selection to the clipboard and deletes it. */
  cut(): Promise<void>;
  /** Replaces the selection with the clipboard text. */
  paste(): Promise<void>;
  selectAll(): void;
  /** Collapses the selection to its end. */
  collapse(): void;
  focus(): void;
  /** Scrolls the caret into view if it is hidden (the visible area shrank, e.g. a virtual keyboard opened); does nothing without focus. */
  scrollCaretIntoView(): void;
  /** Runs a table toolbar action on the focused table cell. */
  tableAction(op: TableOp): void;
  /** Puts the focus back in the table cell the toolbar acts on. */
  focusTableCell(): void;
  /** The toolbar lost focus for good: the caret is no longer in a table. */
  releaseTable(): void;
}

interface Props {
  /** The active tab; each tab keeps its own editor state (text, caret, undo history) and scroll. */
  tabId: number;
  /** The tab's text, used only to create its editor state the first time it is shown. */
  text: string;
  raw: boolean;
  /** The active tab cannot be changed (a pull request is open for its branch): see readOnlyExtension. */
  readOnly: boolean;
  /** Ids of every open tab; the state of a closed tab is dropped. */
  tabIds: number[];
  onChange: (id: number, change: EditorChange) => void;
  onSelection: (selection: EditorSelection | null, head: number) => void;
  /** Path of the document in the active tab; relative images are read from beside it. */
  docPath: string | null;
  /** A 💬 / ✅ marker was clicked. */
  onOpenThread: (id: string, ordinal: number) => void;
  /** The focused table cell changed: null when the caret is not in a table. */
  onTable: (target: TableTarget | null) => void;
  /** Right-click in the text; the caret has already moved there unless it hit the selection. */
  onContextMenu: (x: number, y: number) => void;
}

/** Said when a text-changing operation reaches a read-only tab (the facet only guards user input, not dispatches). */
const READ_ONLY_MESSAGE = 'This document is read-only.';

interface Saved {
  state: EditorState;
  scroll: StateEffect<unknown>;
}

const summary = (state: EditorState): EditorChange => ({
  text: state.doc.toString(),
  canUndo: undoDepth(state) > 0,
  canRedo: redoDepth(state) > 0,
});

async function writeClipboard(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error('This browser does not allow writing the clipboard; use Ctrl+C.');
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    throw new Error('Clipboard access was denied; use Ctrl+C.');
  }
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
  const tableExt = useRef<Extension | null>(null);
  tableExt.current ??= tableTargetListener.of((t) => latest.current.onTable(t));
  const extras = () => [listener.current!, hostExt.current!, tableExt.current!];

  useLayoutEffect(() => {
    const { tabId, text, raw, readOnly } = latest.current;
    const v = new EditorView({ state: createEditorState(text, raw, extras(), readOnly), parent: host.current! });
    view.current = v;
    current.current = tabId;
    v.focus();
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
    v.setState(back?.state ?? createEditorState(props.text, props.raw, extras(), props.readOnly));
    if (back) v.dispatch({ effects: back.scroll });
    else v.scrollDOM.scrollTop = 0;
    saved.current.delete(props.tabId);
    v.focus();
  }, [props.tabId, props.text, props.raw]);

  // Formatted / Raw: the same state, a different mode extension.
  useLayoutEffect(() => {
    const v = view.current;
    if (!v) return;
    const want = modeExtension(props.raw);
    if (modeCompartment.get(v.state) === want) return;
    const before = caretOffset(v);
    v.dispatch({ effects: [modeCompartment.reconfigure(want), keepCaretVisible(v, before, !props.raw)] });
    // The switch button took focus with its click; give it back so the caret shows and keys edit.
    v.focus();
    // Line heights changed: the scroll effect above keeps the caret where it was on screen (centred if it
    // was off-screen; a table in full when the caret is in one); in Formatted, enter the table cell the caret was in.
    if (!props.raw) focusCaretCell(v);
  }, [props.raw, props.tabId]);

  // A tab becomes read-only or editable again: its own state gets the facets through the compartment.
  useLayoutEffect(() => {
    const v = view.current;
    if (!v) return;
    const want = readOnlyExtension(props.readOnly);
    if (readOnlyCompartment.get(v.state) === want) return;
    v.dispatch({ effects: readOnlyCompartment.reconfigure(want) });
  }, [props.readOnly, props.tabId]);

  // Closed tabs release their state.
  useEffect(() => {
    for (const id of saved.current.keys()) if (!props.tabIds.includes(id)) saved.current.delete(id);
  }, [props.tabIds]);

  useImperativeHandle(
    ref,
    () => ({
      tableAction: (op) => view.current && !view.current.state.readOnly && runTableOp(view.current, op),
      focusTableCell: () => view.current && focusTableCell(view.current),
      releaseTable: () => view.current && releaseTable(view.current),
      undo: () => view.current && (undo(view.current), view.current.focus()),
      redo: () => view.current && (redo(view.current), view.current.focus()),
      format(format, url = '') {
        const v = view.current;
        if (!v || v.state.readOnly) return;
        formatView(v, format, url);
        v.focus();
      },
      setText(next) {
        const v = view.current;
        if (!v || v.state.readOnly) return;
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
        if (v.state.readOnly) throw new Error(READ_ONLY_MESSAGE);
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
      insertImage(src, alt) {
        const v = view.current;
        if (!v) throw new Error('No document is open.');
        if (v.state.readOnly) throw new Error(READ_ONLY_MESSAGE);
        v.dispatch(v.state.replaceSelection(`![${alt}](${src})`), { userEvent: 'input.image', scrollIntoView: true });
        v.focus();
      },
      insertToc() {
        const v = view.current;
        if (!v) throw new Error('No document is open.');
        if (v.state.readOnly) throw new Error(READ_ONLY_MESSAGE);
        const text = v.state.doc.toString();
        if (refreshToc(v)) {
          v.focus();
          return 'refreshed';
        }
        const { insert, from, to } = tocChange(text, v.state.selection.main.head);
        v.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: 'input.toc', scrollIntoView: true });
        v.focus();
        return 'inserted';
      },
      async copy() {
        const v = view.current;
        if (!v) return;
        const { from, to } = v.state.selection.main;
        if (from === to) return;
        await writeClipboard(v.state.sliceDoc(from, to));
        v.focus();
      },
      async cut() {
        const v = view.current;
        if (!v || v.state.readOnly) return;
        const { from, to } = v.state.selection.main;
        if (from === to) return;
        await writeClipboard(v.state.sliceDoc(from, to));
        v.dispatch({ changes: { from, to }, userEvent: 'delete.cut', scrollIntoView: true });
        v.focus();
      },
      async paste() {
        const v = view.current;
        if (!v || v.state.readOnly) return;
        if (!navigator.clipboard?.readText) throw new Error('This browser does not allow reading the clipboard; use Ctrl+V.');
        let clip: string;
        try {
          clip = await navigator.clipboard.readText();
        } catch {
          throw new Error('Clipboard access was denied; use Ctrl+V to paste.');
        }
        v.dispatch(v.state.replaceSelection(clip.replace(/\r\n?/g, '\n')), { userEvent: 'input.paste', scrollIntoView: true });
        v.focus();
      },
      selectAll() {
        const v = view.current;
        if (!v) return;
        selectAll(v);
        v.focus();
      },
      collapse() {
        const v = view.current;
        if (v) v.dispatch({ selection: { anchor: v.state.selection.main.head } });
      },
      focus: () => view.current?.focus(),
      scrollCaretIntoView() {
        const v = view.current;
        if (v?.hasFocus) v.dispatch({ effects: EditorView.scrollIntoView(v.state.selection.main.head, { y: 'nearest', yMargin: 16 }) });
      },
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

  const onContextMenu = (e: React.MouseEvent) => {
    const v = view.current;
    if (!v || !(e.target instanceof Node) || !v.contentDOM.contains(e.target)) return;
    e.preventDefault();
    let at: number | null = null;
    try {
      at = v.posAtCoords({ x: e.clientX, y: e.clientY }, false);
    } catch {
      /* no layout: leave the selection as it is */
    }
    const { from, to } = v.state.selection.main;
    if (at !== null && (at < from || at > to || from === to)) v.dispatch({ selection: { anchor: at } });
    v.focus();
    latest.current.onContextMenu(e.clientX, e.clientY);
  };

  return <div ref={host} data-testid="editor" onMouseDown={onMouseDown} onContextMenu={onContextMenu} className="gonq-editor min-h-0 flex-1" />;
});
