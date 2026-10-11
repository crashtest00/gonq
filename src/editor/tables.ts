import { syntaxTree } from '@codemirror/language';
import { type EditorState, type Extension, Prec, type Range, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, keymap, WidgetType } from '@codemirror/view';

/**
 * GFM tables shown as real tables. The whole table block is replaced by a widget whose cells
 * are editable; every edit is written back into the Markdown source as a change to that one
 * cell, so the document stays the single source of truth (undo, save and Raw mode all see it).
 */

export interface Cell {
  from: number;
  to: number;
  text: string;
}
export interface TableModel {
  rows: Cell[][]; // header first, delimiter row excluded
  align: ('left' | 'center' | 'right' | null)[];
}

/** Splits a table line on unescaped pipes into cells with the document range of their trimmed text. */
function splitLine(text: string, offset: number): Cell[] {
  const cells: Cell[] = [];
  let start = 0;
  const bounds: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '|') bounds.push(i);
  }
  const lead = /^\s*\|/.test(text);
  const trail = bounds.length > 0 && /^\s*$/.test(text.slice(bounds[bounds.length - 1] + 1));
  const cuts = [...(lead ? [] : [-1]), ...bounds, ...(trail ? [] : [text.length])];
  const first = lead ? bounds[0] : -1;
  start = first;
  for (let k = lead ? 1 : 1; k < cuts.length; k++) {
    const end = cuts[k];
    const raw = text.slice(start + 1, end);
    const lt = raw.length - raw.trimStart().length;
    const body = raw.trim();
    // An empty cell collapses to the spot just after its opening pipe (and one space, if any).
    const a = body ? start + 1 + lt : Math.min(start + 1 + (raw.startsWith(' ') ? 1 : 0), end);
    cells.push({ from: offset + a, to: offset + a + body.length, text: body.replace(/\\\|/g, '|') });
    start = end;
  }
  return cells;
}

export function parseTable(state: EditorState, from: number, to: number): TableModel {
  const doc = state.doc;
  const rows: Cell[][] = [];
  let align: TableModel['align'] = [];
  const first = doc.lineAt(from).number;
  const last = doc.lineAt(to).number;
  for (let n = first; n <= last; n++) {
    const l = doc.line(n);
    if (n === first + 1) {
      align = splitLine(l.text, l.from).map((c) => {
        const t = c.text;
        return t.startsWith(':') && t.endsWith(':') ? 'center' : t.endsWith(':') ? 'right' : t.startsWith(':') ? 'left' : null;
      });
    } else rows.push(splitLine(l.text, l.from));
  }
  return { rows, align };
}

const escapeCell = (s: string) => s.replace(/\r?\n/g, ' ').replace(/\\?\|/g, '\\|').trim();

function tableAt(view: EditorView, pos: number): { from: number; to: number } | undefined {
  for (let n = syntaxTree(view.state).resolveInner(pos, 1); n; n = n.parent!) {
    if (n.name === 'Table') return { from: n.from, to: n.to };
    if (!n.parent) return undefined;
  }
  return undefined;
}

class TableWidget extends WidgetType {
  constructor(readonly model: TableModel, readonly canEdit: boolean) {
    super();
  }
  eq(o: TableWidget) {
    return o.canEdit === this.canEdit && JSON.stringify(o.model.align) === JSON.stringify(this.model.align) && o.model.rows.length === this.model.rows.length &&
      o.model.rows.every((r, i) => r.length === this.model.rows[i].length && r.every((c, j) => c.text === this.model.rows[i][j].text));
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-table-wrap';
    const table = wrap.appendChild(document.createElement('table'));
    table.className = 'cm-table';
    const cols = Math.max(...this.model.rows.map((r) => r.length), 1);
    this.model.rows.forEach((row, r) => {
      const tr = (r === 0 ? table.createTHead() : (table.tBodies[0] ?? table.createTBody())).insertRow();
      for (let c = 0; c < cols; c++) {
        const td = tr.appendChild(document.createElement(r === 0 ? 'th' : 'td'));
        const cell = row[c];
        const a = this.model.align[c];
        if (a) td.style.textAlign = a;
        td.textContent = cell?.text ?? '';
        td.dataset.row = String(r);
        td.dataset.col = String(c);
        if (cell && this.canEdit) {
          td.contentEditable = 'plaintext-only';
          td.spellcheck = false;
          td.tabIndex = -1;
          td.addEventListener('blur', () => commit(view, wrap, td));
          td.addEventListener('keydown', (e) => cellKey(view, wrap, td, e));
          td.addEventListener('paste', (e) => {
            // Cells hold one line of text.
            e.preventDefault();
            const t = (e.clipboardData?.getData('text/plain') ?? '').replace(/\s*\n\s*/g, ' ');
            document.execCommand('insertText', false, t);
          });
        }
      }
    });
    return wrap;
  }
  // The cells handle their own mouse and keyboard events.
  ignoreEvent() {
    return true;
  }
}

/** Writes an edited cell back to the source as one change; a no-op when the text is unchanged. */
function commit(view: EditorView, wrap: HTMLElement, td: HTMLElement): boolean {
  if (!wrap.isConnected) return false;
  const pos = view.posAtDOM(wrap);
  const t = tableAt(view, pos);
  if (!t) return false;
  const cell = parseTable(view.state, t.from, t.to).rows[Number(td.dataset.row)]?.[Number(td.dataset.col)];
  if (!cell) return false;
  const next = escapeCell(td.textContent ?? '');
  if (next === cell.text) return false;
  // A trailing backslash would escape the pipe that closes the cell when nothing separates them.
  const guard = next.endsWith('\\') && !/\s/.test(view.state.sliceDoc(cell.to, cell.to + 1)) ? ' ' : '';
  view.dispatch({ changes: { from: cell.from, to: cell.to, insert: next + guard }, userEvent: 'input.type' });
  return true;
}

function focusCell(view: EditorView, tablePos: number, r: number, c: number) {
  for (const w of Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.cm-table-wrap'))) {
    if (view.posAtDOM(w) !== tablePos) continue;
    w.querySelector<HTMLElement>(`[data-row="${r}"][data-col="${c}"]`)?.focus();
  }
}

function cellKey(view: EditorView, wrap: HTMLElement, td: HTMLElement, e: KeyboardEvent) {
  const tablePos = view.posAtDOM(wrap);
  const r = Number(td.dataset.row);
  const c = Number(td.dataset.col);
  let tr = r;
  let tc = c;
  if (e.key === 'Enter') tr = r + 1;
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const down = e.key === 'ArrowDown';
    const last = wrap.querySelectorAll('tr').length - 1;
    if (down ? r < last : r > 0) {
      commit(view, wrap, td);
      focusCell(view, tablePos, r + (down ? 1 : -1), c);
      return;
    }
    // Off the edge of the table: back to the document, on the line before or after it.
    commit(view, wrap, td);
    const t = tableAt(view, tablePos);
    if (!t) return;
    const pos = down ? t.to + 1 : t.from - 1;
    if (pos < 0 || pos > view.state.doc.length) return;
    td.blur();
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    view.focus();
    return;
  } else if (e.key === 'Tab') {
    tc = c + (e.shiftKey ? -1 : 1);
  } else if (e.key === 'Escape') {
    td.blur();
    view.focus();
    return;
  } else return;
  e.preventDefault();
  const cols = td.parentElement!.children.length;
  const rows = wrap.querySelectorAll('tr').length;
  if (tc < 0) [tr, tc] = [r - 1, cols - 1];
  else if (tc >= cols) [tr, tc] = [r + 1, 0];
  if (tr < 0) return;
  commit(view, wrap, td);
  if (tr >= rows) {
    // Past the last row: append an empty one.
    const t = tableAt(view, tablePos);
    if (!t) return;
    view.dispatch({ changes: { from: t.to, insert: '\n|' + ' |'.repeat(cols) }, userEvent: 'input' });
  }
  focusCell(view, tablePos, tr, tc);
}

function build(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = [];
  const editable = state.facet(EditorView.editable);
  syntaxTree(state).iterate({
    enter(n) {
      if (n.name !== 'Table') return;
      const model = parseTable(state, n.from, n.to);
      if (model.rows.length > 0) out.push(Decoration.replace({ widget: new TableWidget(model, editable), block: true }).range(n.from, n.to));
      return false;
    },
  });
  return Decoration.set(out, true);
}

/** The table whose first (`start`) or last line is the line at `lineNo`, if any. */
function tableBeside(state: EditorState, lineNo: number, start: boolean) {
  const edge = start ? state.doc.line(lineNo).from : state.doc.line(lineNo).to;
  let found: { from: number; to: number } | undefined;
  state.field(tableField).between(edge, edge, (from, to) => {
    if ((start ? from : to) === edge) found = { from, to };
  });
  return found;
}

/** Arrow keys step into the table from the line above or below it (it is one atomic range otherwise). */
function enterTable(down: boolean) {
  return (view: EditorView) => {
    const sel = view.state.selection.main;
    if (!sel.empty) return false;
    const doc = view.state.doc;
    const no = doc.lineAt(sel.head).number + (down ? 1 : -1);
    if (no < 1 || no > doc.lines) return false;
    const t = tableBeside(view.state, no, down);
    if (!t) return false;
    const rows = parseTable(view.state, t.from, t.to).rows.length;
    focusCell(view, t.from, down ? 0 : rows - 1, 0);
    return true;
  };
}

const tableField = StateField.define<DecorationSet>({
  create: build,
  update(value, tr) {
    return tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state) || tr.startState.facet(EditorView.editable) !== tr.state.facet(EditorView.editable)
      ? build(tr.state)
      : value;
  },
  provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((v) => v.state.field(f))],
});

export const tables: Extension = [
  tableField,
  Prec.highest(keymap.of([{ key: 'ArrowDown', run: enterTable(true) }, { key: 'ArrowUp', run: enterTable(false) }])),
];
