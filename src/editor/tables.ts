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
    if (this.canEdit) wrap.appendChild(toolbar(view, wrap));
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

type Align = TableModel['align'][number];

/** Where the table's row `r` lives: line 0 is the header, the delimiter line is skipped. */
const rowLine = (first: number, r: number) => first + (r === 0 ? 0 : r + 1);

/** The table as normalized Markdown, from its cells; used by the column and alignment edits. */
function render(rows: string[][], align: Align[]): string {
  const line = (cells: string[]) => '| ' + cells.join(' | ') + ' |';
  const delim = align.map((a) => (a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---'));
  return [line(rows[0]), line(delim), ...rows.slice(1).map(line)].join('\n');
}

type TableOp = 'rowAbove' | 'rowBelow' | 'colLeft' | 'colRight' | 'delRow' | 'delCol' | 'delTable' | 'left' | 'center' | 'right';

/** Applies a toolbar action for the cell (r, c) as ordinary document changes; returns the cell to refocus. */
function tableEdit(view: EditorView, t: { from: number; to: number }, op: TableOp, r: number, c: number): [number, number] | null {
  const doc = view.state.doc;
  const model = parseTable(view.state, t.from, t.to);
  const first = doc.lineAt(t.from).number;
  const cols = Math.max(...model.rows.map((x) => x.length), 1);
  const dispatch = (from: number, to: number, insert: string) => view.dispatch({ changes: { from, to, insert }, userEvent: 'input' });
  const rewrite = (rows: string[][], align: Align[]) => dispatch(t.from, t.to, render(rows, align));
  const texts = () => model.rows.map((row) => Array.from({ length: cols }, (_, i) => escapeCell(row[i]?.text ?? '')));
  const align = () => Array.from({ length: cols }, (_, i) => model.align[i] ?? null);
  switch (op) {
    case 'rowAbove':
    case 'rowBelow': {
      // Nothing goes above the header: "above" on it inserts the first body row.
      const below = op === 'rowBelow' || r === 0;
      const line = doc.line(rowLine(first, r));
      const text = '|' + ' |'.repeat(cols);
      if (below) dispatch(line.to, line.to, '\n' + text);
      else dispatch(line.from, line.from, text + '\n');
      return [below ? r + 1 : r, c];
    }
    case 'delRow': {
      if (r === 0) return null; // the header is what makes it a table
      const line = doc.line(rowLine(first, r));
      const last = r === model.rows.length - 1;
      dispatch(last ? line.from - 1 : line.from, last ? line.to : line.to + 1, '');
      return [Math.min(r, model.rows.length - 2), c];
    }
    case 'colLeft':
    case 'colRight': {
      const at = op === 'colLeft' ? c : c + 1;
      const rows = texts().map((x) => [...x.slice(0, at), '', ...x.slice(at)]);
      const al = align();
      rewrite(rows, [...al.slice(0, at), null, ...al.slice(at)]);
      return [r, at];
    }
    case 'delCol': {
      if (cols < 2) return null;
      rewrite(texts().map((x) => x.filter((_, i) => i !== c)), align().filter((_, i) => i !== c));
      return [r, Math.min(c, cols - 2)];
    }
    case 'delTable': {
      const a = t.from > 0 ? t.from - 1 : t.from;
      dispatch(a, t.from > 0 ? t.to : Math.min(t.to + 1, doc.length), '');
      return null;
    }
    default: {
      const al = align();
      al[c] = al[c] === op ? null : op; // pressing the active alignment clears it
      rewrite(texts(), al);
      return [r, c];
    }
  }
}

const TOOLS: { op: TableOp; label: string; text: string }[] = [
  { op: 'rowAbove', label: 'Insert row above', text: '↑▭' },
  { op: 'rowBelow', label: 'Insert row below', text: '↓▭' },
  { op: 'colLeft', label: 'Insert column left', text: '←▯' },
  { op: 'colRight', label: 'Insert column right', text: '→▯' },
  { op: 'left', label: 'Align column left', text: '⇤' },
  { op: 'center', label: 'Align column center', text: '↔' },
  { op: 'right', label: 'Align column right', text: '⇥' },
  { op: 'delRow', label: 'Delete row', text: '−▭' },
  { op: 'delCol', label: 'Delete column', text: '−▯' },
  { op: 'delTable', label: 'Delete table', text: '🗑' },
];

/** The bar over a table (shown while a cell has focus) acting on the cell that has it. */
function toolbar(view: EditorView, wrap: HTMLElement): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'cm-table-toolbar';
  bar.contentEditable = 'false';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Table');
  let last: HTMLElement | null = null;
  wrap.addEventListener('focusin', (e) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-row]');
    if (cell) last = cell;
  });
  for (const tool of TOOLS) {
    const b = bar.appendChild(document.createElement('button'));
    b.type = 'button';
    b.className = 'cm-table-tool';
    b.dataset.op = tool.op;
    b.title = b.ariaLabel = tool.label;
    b.textContent = tool.text;
    b.tabIndex = -1;
    // Keep the focus (and caret) in the cell while the button is pressed.
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      const td = last && wrap.contains(last) ? last : null;
      if (!td || !wrap.isConnected) return;
      commit(view, wrap, td);
      const tablePos = view.posAtDOM(wrap);
      const t = tableAt(view, tablePos);
      if (!t) return;
      const next = tableEdit(view, t, tool.op, Number(td.dataset.row), Number(td.dataset.col));
      if (next) focusCell(view, t.from, next[0], next[1]);
      else view.focus();
    });
  }
  return bar;
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
    if (!t) {
      // A blank line between this line and a table: step onto it ourselves, native vertical motion jumps past the table.
      const next = no + (down ? 1 : -1);
      if (doc.line(no).length > 0 || next < 1 || next > doc.lines || !tableBeside(view.state, next, down)) return false;
      view.dispatch({ selection: { anchor: doc.line(no).from }, scrollIntoView: true, userEvent: 'select' });
      return true;
    }
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
