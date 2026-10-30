/** Formatted-mode widgets for the table of contents (Contents label with Refresh, hidden end marker); refreshToc. */
import { type Extension, RangeSetBuilder, StateField, type EditorState } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { buildToc, findToc } from '../model/toc';

/**
 * Formatted mode: the table of contents' start marker is a "Contents" label with a Refresh button and its
 * end marker is hidden. Refresh is the only thing that rebuilds the list, as one undo step.
 */

/** Rebuilds the table of contents from the headings as they are now. Returns false when the document has none. */
export function refreshToc(view: EditorView): boolean {
  const own = findToc(view.state.doc.toString());
  if (!own) return false;
  const insert = buildToc(view.state.doc.toString());
  if (view.state.sliceDoc(own.from, own.to) !== insert) view.dispatch({ changes: { from: own.from, to: own.to, insert }, userEvent: 'input.toc' });
  return true;
}

class TocHeader extends WidgetType {
  eq() {
    return true;
  }
  toDOM(view: EditorView) {
    const el = document.createElement('span');
    el.className = 'cm-toc-header';
    const label = document.createElement('span');
    label.textContent = 'Contents';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-toc-refresh';
    button.textContent = '⟳ Refresh';
    button.title = 'Rebuild the contents from the current headings';
    button.setAttribute('aria-label', 'Refresh table of contents');
    button.addEventListener('mousedown', (e) => e.preventDefault());
    button.addEventListener('click', (e) => {
      e.preventDefault();
      refreshToc(view);
    });
    el.append(label, button);
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

function decorate(state: EditorState): DecorationSet {
  const own = findToc(state.doc.toString());
  if (!own) return Decoration.none;
  const first = state.doc.lineAt(own.from);
  const last = state.doc.lineAt(own.to);
  const b = new RangeSetBuilder<Decoration>();
  b.add(first.from, first.from, Decoration.line({ class: 'cm-toc-first' }));
  b.add(first.from, first.to, Decoration.replace({ widget: new TocHeader() }));
  b.add(last.from, last.from, Decoration.line({ class: 'cm-hidden-line' }));
  b.add(last.from, last.to, Decoration.replace({}));
  return b.finish();
}

const tocField = StateField.define<DecorationSet>({
  create: decorate,
  update: (value, tr) => (tr.docChanged ? decorate(tr.state) : value),
  provide: (f) => EditorView.decorations.from(f),
});

export const tocWidgets: Extension = tocField;

/** True while the end marker is hidden, i.e. in Formatted mode (Raw has no such widgets). */
export const tocMarkerHidden = (state: EditorState): boolean => state.field(tocField, false) !== undefined;
