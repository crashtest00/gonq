/**
 * Comment threads in the editor: marker glyph widgets (click opens the thread via editorHost), thread blocks
 * hidden in Formatted mode and protected from edits that cover them.
 */
import { ensureSyntaxTree } from '@codemirror/language';
import { Annotation, EditorState, type Extension, StateField, type Text, Transaction, type TransactionSpec } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { AGENT_GUIDANCE, OPEN_COMMENT_LABEL, parseCommentMarkers, parseCommentThreads } from '../comment-threads';
import { findToc } from '../components/toc';
import { tocMarkerHidden } from './toc';
import { editorHost } from './host';

/** Comment-thread markers as glyphs, and the thread blocks at the end of the file kept out of sight and out of harm's way. */

/** Set on transactions that rewrite thread blocks on purpose (create, reply, resolve, edit, delete). */
export const threadEdit = Annotation.define<boolean>();

export class ThreadMarker extends WidgetType {
  constructor(readonly id: string, readonly glyph: string) {
    super();
  }
  eq(other: ThreadMarker) {
    return other.id === this.id && other.glyph === this.glyph;
  }
  toDOM(view: EditorView) {
    const el = document.createElement('span');
    const open = this.glyph === OPEN_COMMENT_LABEL;
    el.className = `cm-thread-marker ${open ? 'cm-thread-open' : 'cm-thread-resolved'}`;
    el.textContent = this.glyph;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', open ? 'Open comment thread' : 'Resolved comment thread');
    el.dataset.threadId = this.id;
    // Keep the caret where it is: a click opens the thread, it does not edit.
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const at = view.posAtDOM(el);
      const found = parseCommentMarkers(view.state.doc.toString()).get(this.id) ?? [];
      view.state.facet(editorHost).openThread(this.id, Math.max(0, found.findIndex((m) => m.from === at)));
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

class HiddenBlock extends WidgetType {
  constructor(readonly first: boolean) {
    super();
  }
  eq(other: HiddenBlock) {
    return other.first === this.first;
  }
  toDOM() {
    const el = document.createElement('div');
    // A document made only of thread blocks still needs a line to put the caret on.
    el.className = this.first ? 'cm-thread-block cm-thread-block-only' : 'cm-thread-block';
    return el;
  }
  get estimatedHeight() {
    return 0;
  }
}

export interface Range {
  from: number;
  to: number;
}

const cache = new WeakMap<Text, Range[]>();

/**
 * The comment blocks Gonq keeps hidden: every well-formed thread block and the agent note.
 * Malformed blocks are not thread blocks, so they stay visible.
 */
export function threadBlockRanges(state: EditorState): Range[] {
  const doc = state.doc;
  let ranges = cache.get(doc);
  if (ranges === undefined) {
    const text = doc.toString();
    const tree = ensureSyntaxTree(state, doc.length, 200);
    // A block shown inside a code block (the Agent skill's example) is an example, not a thread.
    const inCode = (from: number) => {
      // A block indented inside a code block starts after its indent.
      const at = from + Math.max(0, text.slice(from, from + 8).search(/\S/));
      for (let n = tree?.resolveInner(at, 1) ?? null; n; n = n.parent) if (n.name === 'FencedCode' || n.name === 'CodeBlock') return true;
      return false;
    };
    ranges = parseCommentThreads(text).filter((t) => !inCode(t.from)).map((t) => ({ from: t.from, to: t.to }));
    const note = text.indexOf(AGENT_GUIDANCE);
    if (note >= 0 && !inCode(note)) ranges.push({ from: note, to: note + AGENT_GUIDANCE.length });
    ranges.sort((a, b) => a.from - b.from);
    cache.set(doc, ranges);
  }
  return ranges;
}

/** Formatted mode: thread blocks are replaced by nothing at all. Raw mode leaves them as text. */
const hiddenBlocks = StateField.define<DecorationSet>({
  create: (state) => hide(state),
  update: (value, tr) => (tr.docChanged ? hide(tr.state) : value),
  provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))],
});

function hide(state: EditorState): DecorationSet {
  const doc = state.doc;
  const ranges = threadBlockRanges(state);
  return Decoration.set(
    ranges.map((r, i) => Decoration.replace({ block: true, widget: new HiddenBlock(i === 0 && r.from === 0 && r.to === doc.length) }).range(r.from, r.to)),
  );
}

export const hideThreadBlocks: Extension = hiddenBlocks;

/**
 * Whatever a user does (Select All and Delete, a paste over a selection), the thread blocks survive:
 * the parts of a change that fall inside a block are dropped. Rewrites made on purpose carry `threadEdit`;
 * undo and redo restore what those rewrote.
 */
export const protectThreadBlocks: Extension = EditorState.changeFilter.of((tr) => {
  if (tr.annotation(threadEdit) || tr.isUserEvent('undo') || tr.isUserEvent('redo')) return true;
  const blocks = threadBlockRanges(tr.startState);
  if (blocks.length === 0) return true;
  // The ranges returned are the ones where changes are suppressed.
  return blocks.flatMap((b) => [b.from, b.to]);
});

/**
 * Text typed straight against a hidden block or the hidden toc end marker would glue itself to the block's first or last line and break
 * it ("Hello<!--"). Keep the block on lines of its own: a newline goes between them.
 */
export const separateThreadBlocks: Extension = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.annotation(threadEdit) || tr.isUserEvent('undo') || tr.isUserEvent('redo')) return tr;
  const blocks = [...threadBlockRanges(tr.startState)];
  // The table of contents' end marker is hidden in Formatted mode only, and text glued to it would unmake the table of contents.
  const toc = tocMarkerHidden(tr.startState) ? findToc(tr.startState.doc.toString()) : null;
  if (toc) {
    const marker = tr.startState.doc.lineAt(toc.to);
    const moved = relocatedPastMarker(tr, marker);
    if (moved) return moved;
    blocks.push(marker);
  }
  if (blocks.length === 0) return tr;
  const before: number[] = [];
  const after: number[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (inserted.length === 0) return;
    const text = inserted.toString();
    for (const b of blocks) {
      if (toA === b.from && !text.endsWith('\n')) after.push(b.from);
      if (fromA === b.to && !text.startsWith('\n')) before.push(b.to);
    }
  });
  if (before.length === 0 && after.length === 0) return tr;
  return [
    ...(before.length > 0 ? [{ changes: before.map((at) => ({ from: at, insert: '\n' })) }] : []),
    tr,
    ...(after.length > 0 ? [{ changes: after.map((at) => ({ from: at, insert: '\n' })) }] : []),
  ];
});

/**
 * Text typed at the start of, or inside, the hidden toc end marker must neither split the marker nor land in the list above it:
 * it goes after the marker, on a line of its own, and the caret follows it.
 */
function relocatedPastMarker(tr: Transaction, marker: Range): TransactionSpec | null {
  let only: { from: number; to: number; text: string } | null = null;
  let count = 0;
  tr.changes.iterChanges((from, to, _f, _t, inserted) => {
    count++;
    only = { from, to, text: inserted.toString() };
  });
  const change = only as { from: number; to: number; text: string } | null;
  if (count !== 1 || !change || change.text === '' || change.from < marker.from || change.to >= marker.to) return null;
  if (change.from === marker.from && /^\n*$/.test(change.text)) return null;
  const insert = change.text.startsWith('\n') ? change.text : `\n${change.text}`;
  const caret = tr.selection?.main;
  return {
    changes: { from: marker.to, insert },
    selection: !caret || caret.empty ? { anchor: marker.to + insert.length } : undefined,
    userEvent: tr.annotation(Transaction.userEvent),
    scrollIntoView: true,
  };
}

/**
 * The hidden toc end marker can't hold a caret: when one lands inside it (Raw -> Formatted with the caret in the marker, a click, an arrow key)
 * it moves to the marker's end, so typing starts together after the marker.
 */
export const keepCaretOutOfTocMarker: Extension = EditorState.transactionFilter.of((tr) => {
  if (tr.docChanged || tr.annotation(threadEdit)) return tr;
  const state = tr.state;
  if (!tocMarkerHidden(state)) return tr;
  const toc = findToc(state.doc.toString());
  if (!toc) return tr;
  const sel = state.selection.main;
  const marker = state.doc.lineAt(toc.to);
  if (!sel.empty || sel.head <= marker.from || sel.head >= marker.to) return tr;
  return [tr, { selection: { anchor: marker.to }, sequential: true }];
});
