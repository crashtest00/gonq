/** renumberAfter: wraps the Tab/Shift+Tab list indent so touched ordered lists are renumbered in the same undo step. */
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { ChangeSet, EditorSelection, EditorState, Transaction, type ChangeSpec, type TransactionSpec } from '@codemirror/state';
import type { EditorView, Command } from '@codemirror/view';

/** The syntax tree of `state` parsed to its end (bounded at 5 s), so list structure is never read from a partial parse. */
const fullTree = (state: EditorState) => ensureSyntaxTree(state, state.doc.length, 5000) ?? syntaxTree(state);

/**
 * Number edits that keep the ordered lists touched by `changed` (ranges of the new document) consecutive:
 * each list counts up from its first item, and a list that starts on a changed line, or sits under a changed
 * item, starts again at 1 (an item that was just nested, or the items it adopted when it moved out).
 * Only the digits are rewritten; the delimiter and everything else stay as typed.
 */
function renumberChanges(state: EditorState, changed: { from: number; to: number }[]): ChangeSpec[] {
  // Compared by whole lines: a list's range starts after its indent, but an indent edit lives in that indent.
  const hit = (from: number, to: number) => {
    const a = state.doc.lineAt(from).from;
    const b = state.doc.lineAt(to).to;
    return changed.some((c) => c.from <= b && c.to >= a);
  };
  const out: ChangeSpec[] = [];
  fullTree(state).iterate({
    enter(node) {
      if (node.name !== 'OrderedList') return;
      const list = node.node;
      const parent = list.parent;
      const underChanged = parent?.name === 'ListItem' && hit(state.doc.lineAt(parent.from).from, state.doc.lineAt(parent.from).to);
      if (!hit(list.from, list.to) && !underChanged) return;
      const items = [];
      for (let c = list.firstChild; c; c = c.nextSibling) if (c.name === 'ListItem') items.push(c);
      const marks = items.map((i) => i.getChild('ListMark')).filter((m) => m !== null);
      if (!marks.length) return;
      const firstLine = state.doc.lineAt(marks[0].from);
      const restart = parent !== null && parent.name === 'ListItem' && (underChanged || hit(firstLine.from, firstLine.to));
      const firstText = state.doc.sliceString(marks[0].from, marks[0].to);
      let n = restart ? 1 : parseInt(firstText, 10);
      for (const m of marks) {
        const text = state.doc.sliceString(m.from, m.to);
        const digits = /^\d+/.exec(text);
        if (digits && digits[0] !== String(n)) out.push({ from: m.from, to: m.from + digits[0].length, insert: String(n) });
        n++;
      }
    },
  });
  return out;
}

/** The selection widened to cover the whole of every list item that starts on a selected line, so its children move with it. */
function withChildren(state: EditorState): EditorSelection {
  return EditorSelection.create(
    state.selection.ranges.map((r) => {
      const first = state.doc.lineAt(r.from);
      // Like indentMore/indentLess: a non-empty range that ends at a line's start does not include that line.
      const last = state.doc.lineAt(!r.empty && r.to === state.doc.lineAt(r.to).from ? r.to - 1 : r.to);
      let to = r.to;
      fullTree(state).iterate({
        from: first.from,
        to: last.to,
        enter(node) {
          if (node.name === 'ListItem' && node.from >= first.from && node.from <= last.to) to = Math.max(to, node.to);
        },
      });
      return EditorSelection.range(r.from, to, r.goalColumn);
    }),
    state.selection.mainIndex,
  );
}

/** Wraps an indent command so the ordered lists it touches are renumbered in the same transaction (one undo step). */
export const renumberAfter = (command: Command): Command => (view) => {
  const { state } = view;
  const wide = withChildren(state);
  const probeState = wide.eq(state.selection) ? state : state.update({ selection: wide }).state;
  const got: { tr?: TransactionSpec | Transaction } = {};
  const probe = { state: probeState, dispatch: (tr: TransactionSpec | Transaction) => void (got.tr = tr) } as unknown as EditorView;
  if (!command(probe)) return false;
  if (!got.tr) return true;
  const tr1 = got.tr instanceof Transaction ? got.tr : probeState.update(got.tr);
  if (!tr1.docChanged) {
    if (probeState === state) view.dispatch(tr1);
    return true;
  }
  const selection = state.selection.map(tr1.changes, 1);
  const changed: { from: number; to: number }[] = [];
  tr1.changes.iterChangedRanges((_a, _b, from, to) => void changed.push({ from, to }));
  const specs = renumberChanges(tr1.state, changed);
  if (!specs.length) {
    view.dispatch({ changes: tr1.changes, selection, userEvent: tr1.annotation(Transaction.userEvent), scrollIntoView: true });
    return true;
  }
  const rc = ChangeSet.of(specs, tr1.newDoc.length);
  view.dispatch({
    changes: tr1.changes.compose(rc),
    selection: selection.map(rc, 1),
    userEvent: tr1.annotation(Transaction.userEvent),
    scrollIntoView: true,
  });
  return true;
};
