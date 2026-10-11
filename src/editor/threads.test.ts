import { undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { vi } from 'vitest';
import { AGENT_GUIDANCE, parseCommentThreads } from '../comment-threads';
import { createEditorState } from './extensions';
import { editorHost, type EditorHost } from './host';
import { threadEdit } from './threads';

vi.mock('../platform/images', () => ({
  loadImage: vi.fn(async (src: string) => {
    if (src.includes('missing')) throw new Error('missing.png could not be read');
    return `blob:${src}`;
  }),
}));
import { loadImage } from '../platform/images';

const A = 'c20260910143022a3f9c1';
const B = 'c20260910143022b4a0d2';
const block = (id: string, status = 'open', body = 'Why?') =>
  `<!--\n@thread ${id}\n@status ${status}\n\n[User | 2026-09-10T14:30:22+02:00]\n${body}\n-->`;

function show(text: string, raw = false, host: Partial<EditorHost> = {}) {
  const parent = document.body.appendChild(document.createElement('div'));
  const hostExt = editorHost.of({ docPath: () => '/d/doc.md', openThread: () => {}, ...host });
  const view = new EditorView({ state: createEditorState(text, raw, hostExt), parent });
  return {
    view,
    shown: () => view.contentDOM.textContent ?? '',
    q: (sel: string) => Array.from(view.contentDOM.querySelectorAll<HTMLElement>(sel)),
    doc: () => view.state.doc.toString(),
    done: () => (view.destroy(), parent.remove()),
  };
}

describe('thread markers', () => {
  test('open and resolved markers are 💬 and ✅ glyphs; the source shows only in Raw', () => {
    const text = `One [💬](#md-thread-${A}) two [✅](#md-thread-${B}).\n\n${block(A)}\n\n${block(B, 'resolved')}\n`;
    const e = show(text);
    expect(e.shown()).toContain('One 💬 two ✅.');
    expect(e.q('.cm-thread-open').map((n) => n.textContent)).toEqual(['💬']);
    expect(e.q('.cm-thread-resolved').map((n) => n.textContent)).toEqual(['✅']);
    e.done();
    const r = show(text, true);
    expect(r.shown()).toContain(`[💬](#md-thread-${A})`);
    expect(r.shown()).toContain(`[✅](#md-thread-${B})`);
    expect(r.q('.cm-thread-marker')).toHaveLength(0);
    r.done();
  });

  test('a click reports the thread id and the ordinal among markers with the same id', () => {
    const openThread = vi.fn();
    const e = show(`a [💬](#md-thread-${A}) b [💬](#md-thread-${A})\n\n${block(A)}\n\n${block(A)}\n`, false, { openThread });
    const markers = e.q('.cm-thread-marker');
    markers[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    markers[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(openThread.mock.calls).toEqual([[A, 1], [A, 0]]);
    e.done();
  });

  test('a marker inside a task list item is a glyph next to the checkbox', () => {
    const e = show(`- [ ] ship it [💬](#md-thread-${A})\n- [x] done\n\n${block(A)}\n`);
    expect(e.q('.cm-task-box')).toHaveLength(2);
    expect(e.q('.cm-thread-marker').map((n) => n.textContent)).toEqual(['💬']);
    expect(e.shown()).toContain('ship it 💬');
    e.done();
  });

  test('a link that merely looks like a marker is left alone', () => {
    const e = show(`[💬 hi](#md-thread-${A}) and [x](#md-thread-)\n`);
    expect(e.q('.cm-thread-marker')).toHaveLength(0);
    e.done();
  });

  test('Backspace next to a marker removes the whole marker', () => {
    const text = `a [💬](#md-thread-${A})b\n\n${block(A)}\n`;
    const e = show(text);
    const at = text.indexOf('b\n');
    e.view.dispatch({ selection: { anchor: at } });
    e.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(e.doc().startsWith('a b\n')).toBe(true);
    e.done();
  });
});

describe('thread blocks', () => {
  const doc = `Intro text.\n\n${block(A)}\n\n${block(B, 'resolved')}\n`;

  test('hidden in formatted mode, shown in Raw', () => {
    const e = show(doc);
    expect(e.shown()).toContain('Intro text.');
    expect(e.shown()).not.toContain('@thread');
    expect(e.shown()).not.toContain('Why?');
    e.done();
    const r = show(doc, true);
    expect(r.shown()).toContain(`@thread ${A}`);
    expect(r.shown()).toContain('Why?');
    r.done();
  });

  test('the agent note is hidden with the blocks', () => {
    const e = show(`Intro.\n\n${AGENT_GUIDANCE}\n\n${block(A)}\n`);
    expect(e.shown()).not.toContain('Gonq comment threads');
    e.done();
  });

  test('a malformed block is skipped: it stays visible and nothing breaks', () => {
    const bad = '<!--\n@thread c1\n-->';
    const e = show(`Text.\n\n${bad}\n\n${block(A)}\n`);
    expect(e.shown()).toContain('@thread c1');
    expect(e.shown()).not.toContain(`@thread ${A}`);
    e.done();
  });

  test('a block inside a code block is an example and stays visible', () => {
    const e = show(`Example:\n\n    ${block(A).replace(/\n/g, '\n    ')}\n\nEnd\n`);
    expect(e.shown()).toContain('@thread');
    e.done();
  });

  test('a document that is only thread blocks still opens and takes typing', () => {
    const only = `${block(A)}\n\n${block(B)}\n`;
    const e = show(only);
    expect(e.shown()).toBe('');
    expect(e.q('.cm-thread-block')).toHaveLength(2);
    e.view.dispatch({ changes: { from: 0, insert: 'Hello' }, selection: { anchor: 5 }, userEvent: 'input.type' });
    expect(e.doc()).toBe(`Hello\n${only}`);
    expect(e.view.state.selection.main.head).toBe(5);
    expect(e.shown()).toBe('Hello');
    expect(parseCommentThreads(e.doc())).toHaveLength(2);
    e.done();
    const single = show(block(A));
    expect(single.q('.cm-thread-block-only')).toHaveLength(1);
    single.done();
  });

  test.each([
    ['Select All + Delete', (len: number) => ({ from: 0, to: len, insert: '' })],
    ['Select All + type over it', (len: number) => ({ from: 0, to: len, insert: 'new' })],
    ['a delete starting in the prose', (len: number) => ({ from: 3, to: len, insert: '' })],
  ])('%s leaves every thread block intact', (_n, change) => {
    const e = show(doc);
    e.view.dispatch({ changes: change(doc.length), userEvent: 'delete.selection' });
    expect(e.doc()).toContain(block(A));
    expect(e.doc()).toContain(block(B, 'resolved'));
    expect(e.doc()).not.toContain('Intro text.');
    e.done();
  });

  test('Raw mode protects the blocks the same way', () => {
    const e = show(doc, true);
    e.view.dispatch({ changes: { from: 0, to: doc.length, insert: '' }, userEvent: 'delete.selection' });
    expect(e.doc()).toContain(block(A));
    e.done();
  });

  test('ordinary editing next to a block still works', () => {
    const e = show(doc);
    e.view.dispatch({ changes: { from: 5, to: 5, insert: 'X' }, userEvent: 'input.type' });
    e.view.dispatch({ changes: { from: e.doc().indexOf('\n\n<!--'), insert: '!' }, userEvent: 'input.type' });
    expect(e.doc()).toBe(doc.slice(0, 5) + 'X' + doc.slice(5).replace('text.', 'text.!'));
    e.done();
  });

  test('deliberate thread rewrites (annotated) and their undo go through', () => {
    const e = show(doc);
    const next = doc.replace('@status open', '@status resolved');
    const at = doc.indexOf('@status open');
    e.view.dispatch({ changes: { from: at, to: at + '@status open'.length, insert: '@status resolved' }, annotations: threadEdit.of(true), userEvent: 'input.replace' });
    expect(e.doc()).toBe(next);
    undo(e.view);
    expect(e.doc()).toBe(doc);
    e.done();
  });
});

test('typing at the end of a document that ends with a block starts a new line', () => {
  const e = show(block(A));
  e.view.dispatch({ changes: { from: e.view.state.doc.length, insert: 'tail' }, selection: { anchor: e.view.state.doc.length + 4 }, userEvent: 'input.type' });
  expect(e.doc()).toBe(`${block(A)}\ntail`);
  expect(e.view.state.selection.main.head).toBe(e.doc().length);
  expect(parseCommentThreads(e.doc())).toHaveLength(1);
  e.done();
});

describe('images', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  test('shown as an image; the source shows while the caret is in it', async () => {
    const e = show('before ![a cat](cat.png) after\n\nend', false);
    await flush();
    const img = e.q('.cm-image img')[0] as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('blob:cat.png');
    expect(img.alt).toBe('a cat');
    expect(e.shown()).not.toContain('![a cat]');
    expect(vi.mocked(loadImage)).toHaveBeenCalledWith('cat.png', '/d/doc.md');
    e.view.dispatch({ selection: { anchor: 12 } });
    expect(e.shown()).toContain('![a cat](cat.png)');
    expect(e.q('.cm-image')).toHaveLength(1);
    e.done();
  });

  test('typing elsewhere keeps the same image element and loads nothing again', async () => {
    vi.mocked(loadImage).mockClear();
    const e = show('![a](one.png)\n\nsome text', false);
    await flush();
    const first = e.q('.cm-image')[0];
    for (const ch of 'abc') e.view.dispatch({ changes: { from: e.view.state.doc.length, insert: ch }, userEvent: 'input.type' });
    expect(e.q('.cm-image')[0]).toBe(first);
    expect(vi.mocked(loadImage)).toHaveBeenCalledTimes(1);
    e.done();
  });

  test('a missing image falls back to its alt text and does not throw', async () => {
    const e = show('![lost cat](missing.png)\n\nend', false);
    await flush();
    const miss = e.q('.cm-image-missing')[0];
    expect(miss.textContent).toContain('lost cat');
    expect(miss.title).toContain('missing.png');
    expect(e.doc()).toBe('![lost cat](missing.png)\n\nend');
    e.done();
  });

  test('Raw mode shows the image source', () => {
    const e = show('![a](one.png)', true);
    expect(e.shown()).toBe('![a](one.png)');
    expect(e.q('.cm-image')).toHaveLength(0);
    e.done();
  });
});
