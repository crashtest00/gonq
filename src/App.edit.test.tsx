import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import App from './App';
import type { FileAccess, OpenedDocument } from './platform/files';
import { at, caretAt, docText, editorView, queryEditor, select, selectText, shownText, type as typeText } from './testing/editor';

// Each test drives the whole app through user-event; on slow CI they run close to the 5s default.
vi.setConfig({ testTimeout: 30000 });

// The window-close hook is captured so tests can play the native close request (the native side is in lifecycle.test.ts).
const closeGuard = vi.hoisted(() => ({ confirm: null as null | (() => Promise<boolean>), destroyed: 0 }));
vi.mock('./platform/lifecycle', () => ({
  guardClose: (isDirty: () => boolean, confirm: () => Promise<boolean>) => {
    closeGuard.confirm = async () => {
      if (!isDirty()) return true;
      const ok = await confirm();
      if (ok) closeGuard.destroyed++;
      return ok;
    };
    return () => {};
  },
}));

// Deliberately unusual Markdown: none of it may be normalised by editing elsewhere.
const ORIGINAL = '*  odd bullet\n*  second\n\nSetext Title\n===\n\ntrailing spaces here  \nnext line\n\n+ plus list\n\nlast paragraph';

beforeEach(() => localStorage.clear());

function setup(text = ORIGINAL, path: string | null = '/d/a.md') {
  const doc: OpenedDocument = { name: 'a.md', path, text };
  const saveDocument = vi.fn(async (d: { name: string; path: string | null }) => ({ name: d.name, path: d.path ?? '/d/new.md' }));
  const saveDocumentAs = vi.fn(async () => ({ name: 'copy.md', path: '/d/copy.md' }));
  const files: FileAccess = { pickDocument: async () => doc, saveDocument, saveDocumentAs };
  const user = userEvent.setup();
  render(<App files={files} />);
  return { user, saveDocument, saveDocumentAs };
}

async function menu(user: ReturnType<typeof userEvent.setup>, bar: string, item: RegExp) {
  await user.click(screen.getByRole('menuitem', { name: bar }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

async function openDoc(user: ReturnType<typeof userEvent.setup>) {
  await menu(user, 'File', /^Open…/);
  await screen.findByTestId('editor');
}

const save = (user: ReturnType<typeof userEvent.setup>) => menu(user, 'File', /^Save(?! As)/);
const lastSaved = (saveDocument: { mock: { calls: any[][] } }) => saveDocument.mock.calls[saveDocument.mock.calls.length - 1]?.[0].text as string;

test('the document is one continuous editor: no append area, no per-block field', async () => {
  const { user } = setup();
  await openDoc(user);
  expect(screen.getAllByTestId('editor')).toHaveLength(1);
  expect(screen.queryByTestId('append-area')).toBeNull();
  expect(document.querySelector('textarea')).toBeNull();
  expect(docText()).toBe(ORIGINAL);
});

test('a new document: click the canvas, type a heading and bold text; ** shows only while the caret is in the bold', async () => {
  const { user } = setup();
  await menu(user, 'File', /New/);
  expect(screen.getByRole('tab')).toHaveTextContent('Untitled.md');
  expect(shownText()).toContain('Click here to start writing.');
  // A click on the canvas (outside the text) puts the caret in the empty document.
  fireEvent.mouseDown(screen.getByTestId('editor'));
  expect(editorView().state.selection.main.head).toBe(0);
  typeText('# Title');
  await user.keyboard('{Enter}');
  typeText('Some **bold** text');
  expect(docText()).toBe('# Title\nSome **bold** text');
  expect(document.querySelector('.cm-heading-1')).not.toBeNull();
  // Caret at the end of the line, outside **bold**: the stars are hidden.
  select(at('text', true));
  expect(shownText()).toContain('Some bold text');
  expect(document.querySelector('.cm-strong')?.textContent).toBe('bold');
  // Caret inside **bold**: the stars are shown.
  select(at('bold') + 2);
  expect(shownText()).toContain('Some **bold** text');
  // Caret on another line: hidden again, and the heading marker too.
  select(0);
  expect(shownText()).toContain('# Title');
  select(at('Some'));
  expect(shownText()).toContain('Title');
  expect(shownText()).not.toContain('# Title');
  expect(shownText()).toContain('Some bold text');
});

test('clicking below the last line puts the caret at the end of the document', async () => {
  const { user } = setup('one\n\ntwo');
  await openDoc(user);
  select(0);
  fireEvent.mouseDown(screen.getByTestId('editor'), { clientX: 10, clientY: 5000 });
  expect(editorView().state.selection.main.head).toBe(8);
  expect(editorView().hasFocus).toBe(true);
});

test('editing one place changes only that place of the file', async () => {
  const { user, saveDocument } = setup();
  await openDoc(user);
  caretAt('last paragraph');
  typeText('!');
  await save(user);
  expect(lastSaved(saveDocument)).toBe(ORIGINAL + '!');
});

test('an unedited document saves byte-identical, whatever its line endings', async () => {
  for (const text of [ORIGINAL, 'a\r\n\r\nb\r\n', 'mixed\r\nends\nhere\r\n', 'lone\rcr\n']) {
    const { user, saveDocument } = setup(text);
    await openDoc(user);
    await save(user);
    expect(lastSaved(saveDocument)).toBe(text);
    document.body.innerHTML = '';
  }
});

test('an edited CRLF file is saved with CRLF throughout', async () => {
  const { user, saveDocument } = setup('first\r\n\r\nsecond\r\nline\r\n');
  await openDoc(user);
  expect(docText()).toBe('first\n\nsecond\nline\n');
  caretAt('line');
  typeText('!');
  editorView().focus();
  await user.keyboard('{Enter}');
  typeText('x');
  await save(user);
  expect(lastSaved(saveDocument)).toBe('first\r\n\r\nsecond\r\nline!\r\nx\r\n');
});

test('typing is undoable and clears the unsaved mark again', async () => {
  const { user } = setup();
  await openDoc(user);
  expect(screen.queryByLabelText('unsaved changes')).toBeNull();
  caretAt('last paragraph');
  typeText('!');
  expect(screen.getByLabelText('unsaved changes')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Undo' }));
  expect(docText()).toBe(ORIGINAL);
  expect(screen.queryByLabelText('unsaved changes')).toBeNull();
});

test('save clears the unsaved mark and undo brings it back', async () => {
  const { user } = setup();
  await openDoc(user);
  caretAt('last paragraph');
  typeText('!');
  await save(user);
  expect(screen.queryByLabelText('unsaved changes')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Undo' }));
  expect(screen.getByLabelText('unsaved changes')).toBeInTheDocument();
});

test('a document with no path asks where to save; Save As always asks', async () => {
  const { user, saveDocument, saveDocumentAs } = setup(ORIGINAL, null);
  await openDoc(user);
  await save(user);
  expect(saveDocument).toHaveBeenCalledWith({ name: 'a.md', path: null, text: ORIGINAL }, expect.any(Function));
  await menu(user, 'File', /Save As/);
  expect(saveDocumentAs).toHaveBeenCalledWith({ name: 'a.md', text: ORIGINAL }, expect.any(Function));
  expect(screen.getByRole('tab')).toHaveTextContent('copy.md');
});

test('File > New starts an empty document that can be typed into and saved', async () => {
  const { user, saveDocument } = setup();
  await menu(user, 'File', /New/);
  typeText('# Hello');
  editorView().focus();
  await user.keyboard('{Enter}{Enter}');
  typeText('More');
  await save(user);
  expect(saveDocument).toHaveBeenCalledWith({ name: 'Untitled.md', path: null, text: '# Hello\n\nMore' }, expect.any(Function));
});

test('lang-markdown continues a list on Enter', async () => {
  const { user } = setup('- one');
  await openDoc(user);
  select(5);
  editorView().focus();
  await user.keyboard('{Enter}');
  typeText('two');
  expect(docText()).toBe('- one\n- two');
});

describe('Edit menu and shortcuts', () => {
  async function edited() {
    const ctx = setup();
    await openDoc(ctx.user);
    caretAt('last paragraph');
    typeText('!');
    expect(docText()).toBe(ORIGINAL + '!');
    return ctx;
  }

  test('Edit > Undo and Edit > Redo act on the editor', async () => {
    const { user } = await edited();
    await menu(user, 'Edit', /^Undo/);
    expect(docText()).toBe(ORIGINAL);
    await menu(user, 'Edit', /^Redo/);
    expect(docText()).toBe(ORIGINAL + '!');
  });

  test('Ctrl+Z and Ctrl+Y in the editor are CodeMirror history, once each', async () => {
    const { user } = await edited();
    editorView().focus();
    await user.keyboard('{Control>}z{/Control}');
    expect(docText()).toBe(ORIGINAL);
    await user.keyboard('{Control>}y{/Control}');
    expect(docText()).toBe(ORIGINAL + '!');
    await user.keyboard('{Control>}z{/Control}');
    expect(docText()).toBe(ORIGINAL);
  });

  test('Ctrl+Z outside the editor undoes the editor too', async () => {
    const { user } = await edited();
    (document.activeElement as HTMLElement | null)?.blur();
    document.body.focus();
    await user.keyboard('{Control>}z{/Control}');
    expect(docText()).toBe(ORIGINAL);
  });
});

describe('closing the window with unsaved changes', () => {
  async function dirtyThenClose() {
    const ctx = setup();
    closeGuard.destroyed = 0;
    await openDoc(ctx.user);
    caretAt('last paragraph');
    typeText('!');
    let result: Promise<boolean> = Promise.resolve(false);
    act(() => {
      result = closeGuard.confirm!();
    });
    return { ...ctx, result, dialog: await screen.findByRole('dialog') };
  }

  test('Cancel keeps the window open', async () => {
    const { user, dialog, result } = await dirtyThenClose();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await result).toBe(false);
    expect(closeGuard.destroyed).toBe(0);
  });

  test("Don't save closes without writing", async () => {
    const { user, dialog, result, saveDocument } = await dirtyThenClose();
    await user.click(within(dialog).getByRole('button', { name: /Don.t save/ }));
    expect(await result).toBe(true);
    expect(saveDocument).not.toHaveBeenCalled();
    expect(closeGuard.destroyed).toBe(1);
  });

  test('Save writes, then closes', async () => {
    const { user, dialog, result, saveDocument } = await dirtyThenClose();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await result).toBe(true);
    expect(lastSaved(saveDocument)).toBe(ORIGINAL + '!');
    expect(closeGuard.destroyed).toBe(1);
  });
});

describe('task checkboxes', () => {
  const boxes = () => Array.from(document.querySelectorAll<HTMLElement>('.cm-task-box'));
  const click = (el: HTMLElement) => fireEvent.mouseDown(el);

  test('clicking a checkbox flips only its marker in the text and can be undone', async () => {
    const { user, saveDocument } = setup('- [ ] one\n- [x] two\n\n1.  [ ] odd\n');
    await openDoc(user);
    expect(boxes().map((b) => b.classList.contains('cm-task-box-checked'))).toEqual([false, true, false]);
    click(boxes()[0]);
    click(boxes()[1]);
    click(boxes()[2]);
    expect(docText()).toBe('- [x] one\n- [ ] two\n\n1.  [x] odd\n');
    await save(user);
    expect(lastSaved(saveDocument)).toBe('- [x] one\n- [ ] two\n\n1.  [x] odd\n');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(docText()).toBe('- [x] one\n- [ ] two\n\n1.  [ ] odd\n');
  });

  test('a checked item reads as done', async () => {
    setup('- [x] done thing\n');
    await menu(userEvent.setup(), 'File', /^Open…/);
    await screen.findByTestId('editor');
    expect(document.querySelector('.cm-task-done')?.textContent).toBe(' done thing');
  });
});

describe('toolbar actions', () => {
  const press = (user: ReturnType<typeof userEvent.setup>, name: string) => user.click(screen.getByRole('button', { name }));

  async function openWith(text: string, needle: string) {
    const ctx = setup(text);
    await openDoc(ctx.user);
    selectText(needle);
    return ctx;
  }

  const ACTIONS: [string, string][] = [
    ['Bold', 'plain **words**'],
    ['Italic', 'plain *words*'],
    ['Underline', 'plain <ins>words</ins>'],
    ['Strikethrough', 'plain ~~words~~'],
    ['Bullet list', '- plain words'],
    ['Numbered list', '1. plain words'],
    ['Checkbox list', '- [ ] plain words'],
  ];

  test.each(ACTIONS)('%s changes the editor text, and undo/redo round-trips it', async (name, applied) => {
    const { user } = await openWith('plain words', 'words');
    await press(user, name);
    expect(docText()).toBe(applied);
    await press(user, 'Undo');
    expect(docText()).toBe('plain words');
    await press(user, 'Redo');
    expect(docText()).toBe(applied);
  });

  test('Underline toggles off and renders underlined', async () => {
    const { user } = await openWith('plain words', 'words');
    await press(user, 'Underline');
    expect(docText()).toBe('plain <ins>words</ins>');
    select(0, docText().length);
    selectText('words');
    await press(user, 'Underline');
    expect(docText()).toBe('plain words');
    await press(user, 'Underline');
    select(0);
    expect(document.querySelector('.cm-ins')?.textContent).toBe('words');
    expect(shownText()).toBe('plain words');
  });

  test('Insert link asks for a URL and writes [text](url)', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('https://example.com');
    const { user } = await openWith('plain words', 'words');
    await press(user, 'Insert link');
    expect(prompt).toHaveBeenCalled();
    expect(docText()).toBe('plain [words](https://example.com)');
    prompt.mockRestore();
  });

  test('cancelling the link prompt changes nothing', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(null);
    const { user } = await openWith('plain words', 'words');
    await press(user, 'Insert link');
    expect(docText()).toBe('plain words');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.queryByLabelText('unsaved changes')).toBeNull();
    prompt.mockRestore();
  });

  test('no selection inserts empty markup with the caret inside', async () => {
    const { user } = setup('ab');
    await openDoc(user);
    select(1);
    await press(user, 'Underline');
    expect(docText()).toBe('a<ins></ins>b');
    typeText('X');
    expect(docText()).toBe('a<ins>X</ins>b');
  });

  test('formatting skips code', async () => {
    const { user } = await openWith('```\ncode\n```', 'code');
    await press(user, 'Bold');
    expect(docText()).toBe('```\ncode\n```');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });
});

test('a large document stays responsive: only the visible part is rendered', async () => {
  const lines = Array.from({ length: 4000 }, (_, i) => (i % 10 === 0 ? `## Heading ${i}` : `Line ${i} with **bold** and \`code\``)).join('\n\n');
  const { user, saveDocument } = setup(lines);
  const t0 = performance.now();
  await openDoc(user);
  select(lines.length);
  typeText('!');
  await save(user);
  expect(lastSaved(saveDocument)).toBe(lines + '!');
  expect(document.querySelectorAll('.cm-line').length).toBeLessThan(2000);
  expect(performance.now() - t0).toBeLessThan(10_000);
  expect(queryEditor()).not.toBeNull();
});
