/**
 * GFM tables as a block widget with editable cells that write back to the source (Raw shows the pipes). Reports
 * the target cell (tableTargetListener) and runs table operations on it (runTableOp), each one undo step.
 */
import { syntaxTree } from '@codemirror/language';
import { ChangeSet, type ChangeSpec, type EditorState, type Extension, Prec, type Range, StateField, type Text, Facet } from '@codemirror/state';
import { redo, undo } from '@codemirror/commands';
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';

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

/**
 * Where the cells of a table line are separated: cell i lies between cuts[i] and cuts[i + 1]. A cut is
 * an unescaped pipe, except the virtual ones (-1, and the line length) standing in for a missing outer pipe.
 */
function lineCuts(text: string): { cuts: number[]; lead: boolean; trail: boolean } {
  const bounds: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '|') bounds.push(i);
  }
  const lead = /^\s*\|/.test(text);
  const trail = bounds.length > 0 && /^\s*$/.test(text.slice(bounds[bounds.length - 1] + 1));
  return { cuts: [...(lead ? [] : [-1]), ...bounds, ...(trail ? [] : [text.length])], lead, trail };
}

/** Splits a table line on unescaped pipes into cells with the document range of their trimmed text. */
function splitLine(text: string, offset: number): Cell[] {
  const cells: Cell[] = [];
  const { cuts } = lineCuts(text);
  let start = cuts[0];
  for (let k = 1; k < cuts.length; k++) {
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
  return parseDoc(state.doc, from, to);
}

function parseDoc(doc: Text, from: number, to: number): TableModel {
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

/** The table around `pos`, if any (its source range). */
export function tableAt(view: EditorView, pos: number): { from: number; to: number } | undefined {
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
    wrap.className = this.canEdit ? 'cm-table-wrap cm-table-editable' : 'cm-table-wrap';
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

/** The change that writes an edited cell back to the source, or null when its text is unchanged. */
function cellEdit(doc: Text, t: { from: number; to: number }, td: HTMLElement): ChangeSpec | null {
  const cell = parseDoc(doc, t.from, t.to).rows[Number(td.dataset.row)]?.[Number(td.dataset.col)];
  if (!cell) return null;
  const next = escapeCell(td.textContent ?? '');
  if (next === cell.text) return null;
  // A trailing backslash would escape the pipe that closes the cell when nothing separates them.
  const guard = next.endsWith('\\') && !/\s/.test(doc.sliceString(cell.to, cell.to + 1)) ? ' ' : '';
  return { from: cell.from, to: cell.to, insert: next + guard };
}

/** Writes an edited cell back to the source as one change; a no-op when the text is unchanged. */
function commit(view: EditorView, wrap: HTMLElement, td: HTMLElement): boolean {
  if (!wrap.isConnected) return false;
  // A cell being removed by a redraw blurs while the view is mid-update and cannot locate it: its edit was
  // already written by whatever caused the redraw.
  let pos: number;
  try {
    pos = view.posAtDOM(wrap);
  } catch {
    return false;
  }
  const t = tableAt(view, pos);
  const change = t && cellEdit(view.state.doc, t, td);
  if (!change) return false;
  view.dispatch({ changes: change, userEvent: 'input.type' });
  return true;
}

export type Align = TableModel['align'][number];

/** Where the table's row `r` lives: line 0 is the header, the delimiter line is skipped. */
const rowLine = (first: number, r: number) => first + (r === 0 ? 0 : r + 1);

export type TableOp = 'rowAbove' | 'rowBelow' | 'colLeft' | 'colRight' | 'delRow' | 'delCol' | 'delTable' | 'left' | 'center' | 'right';

const isAlign = (op: TableOp): op is NonNullable<Align> => op === 'left' || op === 'center' || op === 'right';

/** A toolbar action as changes to the source (in coordinates of the document it was planned on) and the cell to refocus. */
interface Plan {
  changes: ChangeSpec[];
  focus: [number, number] | null;
}

/**
 * Plans a toolbar action for the cell (r, c), or null when it does not apply there. Only the touched
 * cells change: every other character of the table, spacing and outer pipes included, is left as it is.
 */
function tableEdit(doc: Text, t: { from: number; to: number }, op: TableOp, r: number, c: number): Plan | null {
  const model = parseDoc(doc, t.from, t.to);
  const first = doc.lineAt(t.from).number;
  const last = doc.lineAt(t.to).number;
  const cols = Math.max(...model.rows.map((x) => x.length), 1);
  // Every line of the table (the delimiter row included) with the cuts between its cells.
  const lines = Array.from({ length: last - first + 1 }, (_, i) => {
    const line = doc.line(first + i);
    return { line, delimiter: i === 1, ...lineCuts(line.text) };
  });
  switch (op) {
    case 'rowAbove':
    case 'rowBelow': {
      // Nothing goes above the header: "above" on it inserts the first body row.
      const below = op === 'rowBelow' || r === 0;
      const line = doc.line(r === 0 ? first + 1 : rowLine(first, r)); // the delimiter row stays under the header
      const text = '|' + ' |'.repeat(cols);
      return { changes: [below ? { from: line.to, insert: '\n' + text } : { from: line.from, insert: text + '\n' }], focus: [below ? r + 1 : r, c] };
    }
    case 'delRow': {
      if (r === 0) return null; // the header is what makes it a table
      const line = doc.line(rowLine(first, r));
      const end = r === model.rows.length - 1;
      return { changes: [{ from: end ? line.from - 1 : line.from, to: end ? line.to : line.to + 1 }], focus: [Math.min(r, model.rows.length - 2), c] };
    }
    case 'colLeft':
    case 'colRight': {
      const at = op === 'colLeft' ? c : c + 1;
      const changes: ChangeSpec[] = [];
      for (const { line, delimiter, cuts, trail } of lines) {
        const n = cuts.length - 1;
        if (n < at) continue; // a short body row: the table pads it
        const cell = delimiter ? '---' : '';
        if (at < n) {
          // Before the pipe that opens the cell now at `at`; at the line start when that pipe is not written.
          changes.push(cuts[at] < 0 ? { from: line.from, insert: delimiter ? cell + ' | ' : ' | ' } : { from: line.from + cuts[at], insert: `| ${cell}${cell ? ' ' : ''}` });
        } else if (trail) changes.push({ from: line.from + cuts[n] + 1, insert: ` ${cell}${cell ? ' ' : ''}|` });
        else changes.push({ from: line.to, insert: delimiter ? ' | ---' : ' | |' });
      }
      return { changes, focus: [r, at] };
    }
    case 'delCol': {
      if (lines[0].cuts.length < 3) return null; // the last column stays
      const changes: ChangeSpec[] = [];
      for (const { line, cuts } of lines) {
        if (cuts.length - 1 < 2 || cuts.length - 1 <= c) continue;
        const [a, b] = [cuts[c], cuts[c + 1]];
        changes.push(a < 0 ? { from: line.from, to: line.from + b + 1 + (/^\s*/.exec(line.text.slice(b + 1))?.[0].length ?? 0) } : { from: line.from + a, to: line.from + b });
      }
      return { changes, focus: [r, Math.min(c, cols - 2)] };
    }
    case 'delTable': {
      const a = t.from > 0 ? t.from - 1 : t.from;
      return { changes: [{ from: a, to: t.from > 0 ? t.to : Math.min(t.to + 1, doc.length) }], focus: null };
    }
    default: {
      if (!isAlign(op)) return null;
      const cell = splitLine(lines[1].line.text, lines[1].line.from)[c];
      if (!cell) return null; // a column the delimiter row does not cover
      // Keeps the number of dashes; pressing the active alignment clears it.
      const dashes = '-'.repeat(Math.max(1, (cell.text.match(/-/g) ?? []).length));
      const mark = model.align[c] === op ? dashes : op === 'left' ? ':' + dashes : op === 'right' ? dashes + ':' : ':' + dashes + ':';
      return { changes: [{ from: cell.from, to: cell.to, insert: mark }], focus: [r, c] };
    }
  }
}

/** What the table toolbar (outside the editor) needs to know about the cell that has the focus. */
export interface TableTarget {
  /** Actions the cell cannot use. */
  disabled: TableOp[];
  /** Alignment of the cell's column. */
  align: Align;
}

/** Receives the table target whenever it changes: null while the caret is not in a table. */
export const tableTargetListener = Facet.define<(target: TableTarget | null) => void, ((target: TableTarget | null) => void) | null>({
  combine: (v) => v[0] ?? null,
});

const ALL_OPS: TableOp[] = ['rowAbove', 'rowBelow', 'colLeft', 'colRight', 'left', 'center', 'right', 'delRow', 'delCol', 'delTable'];

/** The row and column of the table cell the position `pos` (inside the table `t`) lies in. */
function cellAtPos(doc: Text, t: { from: number; to: number }, pos: number): [number, number] {
  const first = doc.lineAt(t.from).number;
  const line = doc.lineAt(pos);
  const idx = line.number - first;
  const rows = parseDoc(doc, t.from, t.to).rows.length;
  const r = idx <= 0 ? 0 : Math.min(idx === 1 ? 1 : idx - 1, rows - 1);
  const { cuts } = lineCuts(line.text);
  let c = 0;
  for (let i = 0; i < cuts.length - 1; i++) if (cuts[i] < pos - line.from) c = i;
  return [r, c];
}

/**
 * Follows the table the toolbar acts on: the cell that has the focus or, when no cell does, the cell the
 * caret lies in (an undo or redo can put it there). It is none in Raw mode, where there is no table widget.
 */
class TableTracker {
  /** The cell that has the focus. */
  private focused: HTMLElement | null = null;
  /** The cell the caret (or the last undo/redo) points at while no cell has the focus. */
  private derived: HTMLElement | null = null;
  private hint: number | null = null;
  private last = '';
  private destroyed = false;
  constructor(readonly view: EditorView) {
    view.dom.addEventListener('focusin', this.focusin);
    view.dom.addEventListener('focusout', this.focusout);
  }
  get cell() {
    return this.focused ?? this.derived;
  }
  focusin = (e: FocusEvent) => {
    this.focused = (e.target as HTMLElement).closest<HTMLElement>('.cm-table-editable [data-row]');
    this.refresh();
  };
  focusout = (e: FocusEvent) => {
    const to = e.relatedTarget as Element | null;
    // Focus may go to the table toolbar or the Format menu and still target the same cell.
    if (!to || (!this.view.dom.contains(to) && !to.closest('[data-table-toolbar], [data-format-menu]'))) this.release();
  };
  release() {
    this.focused = null;
    this.derived = null;
    this.report();
  }
  update(u: ViewUpdate) {
    const undone = u.transactions.some((tr) => tr.isUserEvent('undo') || tr.isUserEvent('redo'));
    // Where an undo or redo last changed the document, until the caret is moved elsewhere.
    if (undone) {
      this.hint = null;
      u.changes.iterChangedRanges((_a, _b, from) => void (this.hint ??= from));
    } else if (u.selectionSet) this.hint = null;
    else if (this.hint !== null) this.hint = u.changes.mapPos(this.hint);
    // The widgets are redrawn after the plugins update: look at the table once they are.
    if (this.cell || u.docChanged || u.selectionSet || u.transactions.some((tr) => tr.effects.length)) {
      this.view.requestMeasure({ key: this, read: () => this.refresh(), write: () => {} });
    }
  }
  destroy() {
    this.destroyed = true;
    this.view.dom.removeEventListener('focusin', this.focusin);
    this.view.dom.removeEventListener('focusout', this.focusout);
    this.focused = this.derived = null;
    this.report();
  }
  /** Recomputes the cell from the focus and the caret, then reports. */
  refresh() {
    if (this.destroyed) return;
    const hint = this.hint;
    if (this.focused && !this.focused.isConnected) this.focused = null;
    this.derived = null;
    if (!this.focused && this.view.hasFocus) {
      const pos = hint !== null ? Math.min(hint, this.view.state.doc.length) : this.view.state.selection.main.head;
      const t = tableAt(this.view, pos);
      if (t && (hint !== null ? pos >= t.from && pos <= t.to : pos > t.from && pos < t.to)) {
        const [r, c] = cellAtPos(this.view.state.doc, t, pos);
        for (const w of Array.from(this.view.contentDOM.querySelectorAll<HTMLElement>('.cm-table-wrap'))) {
          if (this.view.posAtDOM(w) !== t.from) continue;
          this.derived = w.querySelector<HTMLElement>(`[data-row="${r}"][data-col="${c}"]`) ?? w.querySelector<HTMLElement>('[data-row]');
        }
      }
    }
    this.report();
  }
  /** The cell and its table while both are still in the document. */
  target() {
    const td = this.cell;
    const wrap = td?.closest<HTMLElement>('.cm-table-wrap') ?? null;
    const t = td && wrap && wrap.isConnected ? tableAt(this.view, this.view.posAtDOM(wrap)) : undefined;
    return td && wrap && t ? { td, wrap, t } : null;
  }
  report() {
    const tg = this.target();
    let out: TableTarget | null = null;
    if (tg) {
      const r = Number(tg.td.dataset.row);
      const c = Number(tg.td.dataset.col);
      out = {
        disabled: ALL_OPS.filter((op) => tableEdit(this.view.state.doc, tg.t, op, r, c) === null),
        align: parseTable(this.view.state, tg.t.from, tg.t.to).align[c] ?? null,
      };
    }
    const key = JSON.stringify(out);
    if (key === this.last) return;
    this.last = key;
    this.view.state.facet(tableTargetListener)?.(out);
  }
}

const trackerPlugin = ViewPlugin.fromClass(TableTracker);

/** Runs a table toolbar action on the cell that has the focus; one undo step, a typed-but-unwritten cell joins it. */
export function runTableOp(view: EditorView, op: TableOp) {
  const tg = view.plugin(trackerPlugin)?.target();
  if (!tg) return;
  const { td, t } = tg;
  const pending = cellEdit(view.state.doc, t, td);
  const typed = ChangeSet.of(pending ?? [], view.state.doc.length);
  const doc = typed.apply(view.state.doc);
  const at = { from: typed.mapPos(t.from, -1), to: typed.mapPos(t.to, 1) };
  const plan = tableEdit(doc, at, op, Number(td.dataset.row), Number(td.dataset.col));
  if (!plan) return;
  view.dispatch({ changes: typed.compose(ChangeSet.of(plan.changes, doc.length)), userEvent: 'input' });
  if (plan.focus) focusCell(view, at.from, plan.focus[0], plan.focus[1]);
  else view.focus();
}

/** Puts the focus back in the cell the toolbar acts on. */
export function focusTableCell(view: EditorView) {
  view.plugin(trackerPlugin)?.target()?.td.focus();
}

/** Moves the focus into the table cell the caret lies in (after Raw -> Formatted); false when it is not in a table. */
export function focusCaretCell(view: EditorView): boolean {
  const pos = view.state.selection.main.head;
  const t = tableAt(view, pos);
  if (!t || pos < t.from || pos > t.to) return false;
  const [r, c] = cellAtPos(view.state.doc, t, pos);
  focusCell(view, t.from, r, c);
  return true;
}

/** The caret left the table for somewhere outside the editor (the toolbar lost focus too). */
export function releaseTable(view: EditorView) {
  view.plugin(trackerPlugin)?.release();
}

/** Shift+Tab off the first cell: to the table toolbar's first usable button. */
function focusToolbar() {
  document.querySelector<HTMLButtonElement>('[data-table-toolbar] button:not(:disabled)')?.focus();
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
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === 'z' || k === 'y')) {
    // The cell is a separate editing surface: history belongs to the document. Write the pending edit
    // first so it is its own undo step, then hand focus back to the editor.
    e.preventDefault();
    e.stopPropagation();
    commit(view, wrap, td);
    (k === 'y' || e.shiftKey ? redo : undo)(view);
    view.focus();
    return;
  }
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
  if (tr < 0) {
    focusToolbar();
    return;
  }
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
    const cur = doc.lineAt(sel.head);
    // A wrapped line is several visual lines: only leave it from its first (Up) or last (Down) one.
    // Measured by position, not by moving: at the end of a line before a table the native move clamps inside the line.
    const here = view.coordsAtPos(sel.head, sel.assoc < 0 ? -1 : 1);
    const edge = down ? view.coordsAtPos(cur.to, -1) : view.coordsAtPos(cur.from, 1);
    if (here && edge && Math.abs(here.top - edge.top) > 1) return false;
    const no = cur.number + (down ? 1 : -1);
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
    // Put the caret on the table's edge first: with it on the line next to the table, CodeMirror writes it back
    // to the DOM selection after the cell took the focus, which pulls the focus out of the cell again.
    view.dispatch({ selection: { anchor: down ? t.from : t.to }, userEvent: 'select' });
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
  trackerPlugin,
  Prec.highest(keymap.of([{ key: 'ArrowDown', run: enterTable(true) }, { key: 'ArrowUp', run: enterTable(false) }])),
];
