import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { commonmarkLanguage } from '@codemirror/lang-markdown';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { Strikethrough, Table, TaskList } from '@lezer/markdown';
import { livePreview } from './livePreview';
import { openLink } from './openLink';
import { protectThreadBlocks, separateThreadBlocks } from './threads';

export const PLACEHOLDER = 'Click here to start writing.';

/** CommonMark plus the GFM pieces Gonq supports: strikethrough, task lists and tables. */
export const gonqMarkdown = () => markdown({ base: commonmarkLanguage, extensions: [Strikethrough, TaskList, Table] });

const LIVE: Extension = livePreview(openLink);
/** Raw: the same editor and document with no live-preview styling, in the monospace face. */
const RAW: Extension = EditorView.editorAttributes.of({ class: 'cm-raw' });

/** The one thing that differs between Formatted and Raw; swapped by reconfiguring this compartment. */
export const modeCompartment = new Compartment();
export const modeExtension = (raw: boolean): Extension => (raw ? RAW : LIVE);

/** Every text-editing behaviour (typing, history, keys, list continuation) is CodeMirror's or lang-markdown's own. */
export function editorExtensions(raw: boolean, extra: Extension = []): Extension {
  return [
    history(),
    protectThreadBlocks,
    separateThreadBlocks,
    keymap.of([...defaultKeymap, ...historyKeymap]),
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
