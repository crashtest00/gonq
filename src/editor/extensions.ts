import { defaultKeymap, history, historyKeymap, indentLess, indentMore, redo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { commonmarkLanguage } from '@codemirror/lang-markdown';
import { search, searchKeymap } from '@codemirror/search';
import { indentUnit } from '@codemirror/language';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, placeholder, type Command } from '@codemirror/view';
import { Strikethrough, Table, TaskList, type MarkdownConfig } from '@lezer/markdown';
import { formatKeymap } from './formatCommands';
import { livePreview } from './livePreview';
import { openLink } from './openLink';
import { tocWidgets } from './toc';
import { keepCaretOutOfTocMarker, protectThreadBlocks, separateThreadBlocks } from './threads';

export const PLACEHOLDER = 'Click here to start writing.';

/** CommonMark plus the GFM pieces Gonq supports: strikethrough, task lists and tables. */
const LIST_START = /^(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const THEMATIC_BREAK = /^(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,})$/;

const TABLE_DELIMITER = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/** The open leaf (public `LeafBlock.content`) is a GFM table: a piped header row, then a delimiter row. lezer's own TableParser is not exported. */
function isTableLeaf(content: string): boolean {
  const [header, delimiter] = content.split('\n');
  return delimiter !== undefined && header.includes('|') && delimiter.includes('-') && TABLE_DELIMITER.test(delimiter);
}

/**
 * A list item, or a line without a pipe, right under a table row ends the table instead of turning the table into a Setext heading
 * (`| 1 | 2 |` then `- ` would otherwise read as an H2). Uses lezer's `endLeaf` block-parser hook, the same
 * one its own Table, list and HR parsers use; a `---` line still underlines as before.
 */
const ListEndsTable: MarkdownConfig = {
  parseBlock: [
    {
      name: 'ListEndsTable',
      endLeaf(_cx, line, leaf) {
        if (!isTableLeaf(leaf.content)) return false;
        const text = line.text.slice(line.pos);
        // A line without a pipe under the table is the text being typed after it, not another row: GFM would
        // absorb it, and the table widget would swallow the line the caret is on.
        if (!text.replace(/\\./g, '').includes('|') && !THEMATIC_BREAK.test(text.trim())) return true;
        return LIST_START.test(text) && !THEMATIC_BREAK.test(text.trim());
      },
      before: 'SetextHeading',
    },
  ],
};

export const gonqMarkdown = () => markdown({ base: commonmarkLanguage, extensions: [Strikethrough, TaskList, Table, ListEndsTable] });

const LIVE: Extension = [livePreview(openLink), tocWidgets];
/** Raw: the same editor and document with no live-preview styling, in the monospace face. */
const RAW: Extension = EditorView.editorAttributes.of({ class: 'cm-raw' });

/** The one thing that differs between Formatted and Raw; swapped by reconfiguring this compartment. */
export const modeCompartment = new Compartment();
export const modeExtension = (raw: boolean): Extension => (raw ? RAW : LIVE);

const LIST_LINE = /^[ \t]*([-*+]|\d+[.)])([ \t]|$)/;

/** Tab / Shift+Tab indent or outdent list lines (marker-only ones too); elsewhere Tab keeps moving focus. */
const listIndent = (command: Command): Command => (view) => {
  const { state } = view;
  const inList = state.selection.ranges.some((r) => {
    for (let pos = r.from; pos <= r.to; ) {
      const line = state.doc.lineAt(pos);
      if (LIST_LINE.test(line.text)) return true;
      pos = line.to + 1;
    }
    return false;
  });
  if (!inList) return false;
  // A list's first item has no parent to nest in: one step in at most (four spaces would make it a code block).
  if (command === indentMore && state.selection.ranges.every((r) => !hasListAbove(state, r.from))) {
    const line = state.doc.lineAt(state.selection.main.from);
    if (!/^[ \t]/.test(line.text)) view.dispatch({ changes: { from: line.from, insert: '  ' }, userEvent: 'input.indent' });
    return true;
  }
  return command(view);
};

/** Some earlier non-blank line is a list line or an indented continuation of one, so there is an item to nest under. */
function hasListAbove(state: EditorState, pos: number): boolean {
  const first = state.doc.lineAt(pos).number;
  if (first === 1) return false;
  const above = state.doc.line(first - 1).text;
  return LIST_LINE.test(above) || (/^[ \t]+\S/.test(above));
}

/** Every text-editing behaviour (typing, history, keys, list continuation) is CodeMirror's or lang-markdown's own. */
export function editorExtensions(raw: boolean, extra: Extension = []): Extension {
  return [
    history(),
    // Four spaces, so Tab nests every list marker up to "99. ": a child must start at or past its parent's content column.
    indentUnit.of('    '),
    protectThreadBlocks,
    separateThreadBlocks,
    keepCaretOutOfTocMarker,
    formatKeymap,
    keymap.of([
      { key: 'Tab', run: listIndent(indentMore), shift: listIndent(indentLess) },
      // historyKeymap binds Ctrl+Shift+Z only on Linux; Windows would otherwise have just Ctrl+Y.
      { key: 'Mod-Shift-z', run: redo, preventDefault: true },
      ...searchKeymap,
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    search({ top: true }),
    gonqMarkdown(),
    EditorView.lineWrapping,
    placeholder(PLACEHOLDER),
    modeCompartment.of(modeExtension(raw)),
    extra,
  ];
}

export function createEditorState(text: string, raw: boolean, extra: Extension = []): EditorState {
  return EditorState.create({ doc: text, extensions: editorExtensions(raw, extra) });
}
