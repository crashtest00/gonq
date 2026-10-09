import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import type { FileAccess, OpenedDocument } from './platform/files';
import { vi } from 'vitest';

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

function setup(text = ORIGINAL, path: string | null = '/d/a.md') {
  const doc: OpenedDocument = { name: 'a.md', path, text };
  const saveDocument = vi.fn(async (d: { name: string; path: string | null }) => ({ name: d.name, path: d.path ?? '/d/new.md' }));
  const saveDocumentAs = vi.fn(async () => ({ name: 'copy.md', path: '/d/copy.md' }));
  const files: FileAccess = { pickDocument: async () => doc, loadImage: async () => null, saveDocument, saveDocumentAs };
  const user = userEvent.setup();
  render(<App files={files} />);
  return { user, saveDocument, saveDocumentAs };
}

async function menu(user: ReturnType<typeof userEvent.setup>, bar: string, item: RegExp) {
  await user.click(screen.getByRole('menuitem', { name: bar }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

async function openDoc(user: ReturnType<typeof userEvent.setup>) {
  await menu(user, 'File', /Open/);
  await screen.findByTestId('markdown-view');
}

const editor = () => screen.getByRole('textbox', { name: /Markdown source/ }) as HTMLTextAreaElement;

test('editing one block changes only that block of the file', async () => {
  const { user, saveDocument } = setup();
  await openDoc(user);
  await user.click(screen.getByText('last paragraph'));
  expect(editor().value).toBe('last paragraph');
  await user.type(editor(), ' edited');
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.getByText('last paragraph edited')).toBeInTheDocument();

  await menu(user, 'File', /^Save(?! As)/);
  expect(saveDocument).toHaveBeenCalledWith({ name: 'a.md', path: '/d/a.md', text: ORIGINAL + ' edited' });
});

test('opening a block for editing shows its exact source and leaves the file alone', async () => {
  const { user } = setup();
  await openDoc(user);
  await user.click(screen.getByRole('heading', { name: 'Setext Title' }));
  expect(editor().value).toBe('Setext Title\n===');
  await user.keyboard('{Escape}');
  expect(screen.queryByLabelText('unsaved changes')).not.toBeInTheDocument();
});

test('line endings of a CRLF file are kept', async () => {
  const { user, saveDocument } = setup('first\r\n\r\nsecond\r\nline\r\n');
  await openDoc(user);
  await user.click(screen.getByText(/second/));
  expect(editor().value).toBe('second\nline');
  await user.type(editor(), '!');
  await user.keyboard('{Escape}');
  await user.keyboard('{Control>}s{/Control}');
  expect(saveDocument).toHaveBeenCalledWith(expect.objectContaining({ text: 'first\r\n\r\nsecond\r\nline!\r\n' }));
});

test('save clears the unsaved mark and undo brings it back', async () => {
  const { user } = setup();
  await openDoc(user);
  await user.click(screen.getByText('last paragraph'));
  await user.type(editor(), '!');
  await user.keyboard('{Escape}');
  expect(screen.getByLabelText('unsaved changes')).toBeInTheDocument();
  await menu(user, 'File', /^Save(?! As)/);
  expect(screen.queryByLabelText('unsaved changes')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Undo' }));
  expect(screen.getByText('last paragraph')).toBeInTheDocument();
  expect(screen.getByLabelText('unsaved changes')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Redo' }));
  expect(screen.getByText('last paragraph!')).toBeInTheDocument();
  expect(screen.queryByLabelText('unsaved changes')).not.toBeInTheDocument();
});

test('Ctrl+Z inside the block editor undoes the document edit', async () => {
  const { user } = setup();
  await openDoc(user);
  await user.click(screen.getByText('last paragraph'));
  await user.type(editor(), 'xyz');
  await user.keyboard('{Control>}z{/Control}');
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.getByText('last paragraph')).toBeInTheDocument();
});

test('a document with no path asks where to save; Save As always asks', async () => {
  const { user, saveDocument, saveDocumentAs } = setup(ORIGINAL, null);
  await openDoc(user);
  await menu(user, 'File', /^Save(?! As)/);
  expect(saveDocument).toHaveBeenCalledWith({ name: 'a.md', path: null, text: ORIGINAL }, expect.any(Function));
  await menu(user, 'File', /Save As/);
  expect(saveDocumentAs).toHaveBeenCalledWith({ name: 'a.md', text: ORIGINAL }, expect.any(Function));
  expect(screen.getByRole('tab')).toHaveTextContent('copy.md');
});

test('File > New starts an empty document that can be typed into and saved', async () => {
  const { user, saveDocument } = setup();
  await menu(user, 'File', /New/);
  expect(screen.getByRole('tab')).toHaveTextContent('Untitled.md');
  await user.click(screen.getByTestId('append-area'));
  await user.type(editor(), '# Hello');
  await user.keyboard('{Escape}');
  expect(screen.getByRole('heading', { level: 1, name: 'Hello' })).toBeInTheDocument();
  await user.click(screen.getByTestId('append-area'));
  await user.type(editor(), 'More');
  await user.keyboard('{Escape}');
  await menu(user, 'File', /^Save(?! As)/);
  expect(saveDocument).toHaveBeenCalledWith({ name: 'Untitled.md', path: null, text: '# Hello\n\nMore\n' }, expect.any(Function));
});

test('appending goes ahead of the thread blocks at the end of the file', async () => {
  const thread = '<!--\n@thread c20260910143022a3f9c1\n@status open\n\n[User | 2026-09-10T14:30:22+02:00]\nHi\n-->\n';
  const { user, saveDocument } = setup(`Para [💬](#md-thread-c20260910143022a3f9c1)\n\n${thread}`);
  await openDoc(user);
  await user.click(screen.getByTestId('append-area'));
  await user.type(editor(), 'New');
  await user.keyboard('{Escape}{Control>}s{/Control}');
  expect(saveDocument).toHaveBeenCalledWith(
    expect.objectContaining({ text: `Para [💬](#md-thread-c20260910143022a3f9c1)\n\nNew\n\n${thread}` }),
  );
});

describe('thread markers stay whole while a block is edited', () => {
  const MARKER = '[💬](#md-thread-c20260910143022a3f9c1)';
  const THREAD = '<!--\n@thread c20260910143022a3f9c1\n@status open\n\n[User | 2026-09-10T14:30:22+02:00]\nHi\n-->\n';
  const DOC = `Intro\n\nPara ${MARKER} end\n\n${THREAD}`;

  async function editMarkerBlock() {
    const ctx = setup(DOC);
    await openDoc(ctx.user);
    await ctx.user.click(screen.getByText(/^Para/));
    expect(editor().value).toBe(`Para ${MARKER} end`);
    const start = editor().value.indexOf('[');
    return { ...ctx, start, end: start + MARKER.length };
  }
  const caretAt = (n: number, m = n) => editor().setSelectionRange(n, m);

  test('Backspace at the end of the marker leaves it intact', async () => {
    const { user, end } = await editMarkerBlock();
    caretAt(end);
    await user.keyboard('{Backspace}');
    expect(editor().value).toBe(`Para ${MARKER} end`);
  });

  test('Delete at the start of the marker leaves it intact', async () => {
    const { user, start } = await editMarkerBlock();
    caretAt(start);
    await user.keyboard('{Delete}');
    expect(editor().value).toBe(`Para ${MARKER} end`);
  });

  test('Delete and Backspace inside the marker leave it intact', async () => {
    const { user, start } = await editMarkerBlock();
    caretAt(start + 2);
    await user.keyboard('{Delete}');
    caretAt(start + 10);
    await user.keyboard('{Backspace}');
    expect(editor().value).toBe(`Para ${MARKER} end`);
  });

  test('typing inside the marker lands after it', async () => {
    const { user, start, end } = await editMarkerBlock();
    caretAt(start + 12);
    await user.keyboard('Z');
    expect(editor().value).toBe(`Para ${MARKER}Z end`);
    expect(editor().selectionStart).toBe(end + 1);
  });

  test('a selection spanning part of the marker deletes only the text outside it', async () => {
    const { user, start } = await editMarkerBlock();
    caretAt(2, start + 5);
    await user.keyboard('{Delete}');
    expect(editor().value).toBe(`Pa${MARKER} end`);
  });

  test('a selection covering the whole marker may remove it, whole', async () => {
    const { user, start, end } = await editMarkerBlock();
    caretAt(start - 1, end + 1);
    await user.keyboard('{Delete}');
    expect(editor().value).toBe('Paraend');
  });

  test('editing text next to the marker saves byte-exactly with the thread block intact', async () => {
    const { user, saveDocument, end } = await editMarkerBlock();
    caretAt(end + 4);
    await user.keyboard('!');
    await user.keyboard('{Escape}{Control>}s{/Control}');
    expect(saveDocument).toHaveBeenCalledWith(
      expect.objectContaining({ text: `Intro\n\nPara ${MARKER} end!\n\n${THREAD}` }),
    );
  });
});

test('editing a middle block changes none of the other bytes', async () => {
  const { user, saveDocument } = setup();
  await openDoc(user);
  await user.click(screen.getByText(/trailing spaces here/));
  expect(editor().value).toBe('trailing spaces here  \nnext line');
  await user.type(editor(), ' X');
  await user.keyboard('{Escape}{Control>}s{/Control}');
  const expected = ORIGINAL.replace('next line', 'next line X');
  expect(expected).not.toBe(ORIGINAL);
  expect(saveDocument).toHaveBeenCalledWith(expect.objectContaining({ text: expected }));
  expect(expected.startsWith('*  odd bullet\n*  second\n\nSetext Title\n===\n\ntrailing spaces here  \nnext line X\n\n+ plus list\n\nlast paragraph')).toBe(true);
});

describe('Edit menu and shortcuts', () => {
  async function edited() {
    const ctx = setup();
    await openDoc(ctx.user);
    await ctx.user.click(screen.getByText('last paragraph'));
    await ctx.user.type(editor(), '!');
    await ctx.user.keyboard('{Escape}');
    expect(screen.getByText('last paragraph!')).toBeInTheDocument();
    return ctx;
  }

  test('Edit > Undo and Edit > Redo', async () => {
    const { user } = await edited();
    await menu(user, 'Edit', /^Undo/);
    expect(screen.getByText('last paragraph')).toBeInTheDocument();
    await menu(user, 'Edit', /^Redo/);
    expect(screen.getByText('last paragraph!')).toBeInTheDocument();
  });

  test('Ctrl+Shift+Z and Ctrl+Y redo', async () => {
    const { user } = await edited();
    await user.keyboard('{Control>}z{/Control}');
    expect(screen.getByText('last paragraph')).toBeInTheDocument();
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(screen.getByText('last paragraph!')).toBeInTheDocument();
    await user.keyboard('{Control>}z{/Control}');
    expect(screen.getByText('last paragraph')).toBeInTheDocument();
    await user.keyboard('{Control>}y{/Control}');
    expect(screen.getByText('last paragraph!')).toBeInTheDocument();
  });
});

describe('closing the window with unsaved changes', () => {
  async function dirtyThenClose() {
    const ctx = setup();
    closeGuard.destroyed = 0;
    await openDoc(ctx.user);
    await ctx.user.click(screen.getByText('last paragraph'));
    await ctx.user.type(editor(), '!');
    await ctx.user.keyboard('{Escape}');
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
    expect(saveDocument).toHaveBeenCalledWith(expect.objectContaining({ text: ORIGINAL + '!' }));
    expect(closeGuard.destroyed).toBe(1);
  });
});

test('toolbar formats the selection in the open block, and undo reverts it', async () => {
  const { user } = setup('plain words\n\nother');
  await openDoc(user);
  const bold = screen.getByRole('button', { name: 'Bold' });
  expect(bold).toBeDisabled();
  await user.click(screen.getByText('plain words'));
  editor().setSelectionRange(6, 11);
  await user.click(bold);
  expect(editor().value).toBe('plain **words**');
  await user.click(screen.getByRole('button', { name: 'Bullet list' }));
  expect(editor().value).toBe('- plain **words**');
  await user.keyboard('{Escape}');
  expect(screen.getByText('words').tagName).toBe('STRONG');
  await user.click(screen.getByRole('button', { name: 'Undo' }));
  await user.click(screen.getByRole('button', { name: 'Undo' }));
  expect(screen.getByText('plain words')).toBeInTheDocument();
});

test('clicking a task checkbox flips only its marker and can be undone', async () => {
  const { user, saveDocument } = setup('- [ ] one\n- [x] two\n\n1.  [ ] odd\n');
  await openDoc(user);
  const boxes = screen.getAllByRole('checkbox');
  expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([false, true, false]);
  await user.click(boxes[0]);
  await user.click(screen.getAllByRole('checkbox')[1]);
  await user.click(screen.getAllByRole('checkbox')[2]);
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  await menu(user, 'File', /^Save(?! As)/);
  expect(saveDocument).toHaveBeenCalledWith({ name: 'a.md', path: '/d/a.md', text: '- [x] one\n- [ ] two\n\n1.  [x] odd\n' });
  await user.click(screen.getByRole('button', { name: 'Undo' }));
  expect((screen.getAllByRole('checkbox')[2] as HTMLInputElement).checked).toBe(false);
});

describe('toolbar actions', () => {
  const press = (user: ReturnType<typeof userEvent.setup>, name: string) => user.click(screen.getByRole('button', { name }));
  const undo = (user: ReturnType<typeof userEvent.setup>) => press(user, 'Undo');
  const redo = (user: ReturnType<typeof userEvent.setup>) => press(user, 'Redo');

  async function openBlock(text: string, from: number, to: number) {
    const { user, saveDocument } = setup(text);
    await openDoc(user);
    await user.click(screen.getByTestId('markdown-view').firstElementChild!);
    editor().setSelectionRange(from, to);
    return { user, saveDocument };
  }

  const ACTIONS: [string, string, string][] = [
    ['Bold', 'plain **words**', 'plain words'],
    ['Italic', 'plain *words*', 'plain words'],
    ['Underline', 'plain <ins>words</ins>', 'plain words'],
    ['Strikethrough', 'plain ~~words~~', 'plain words'],
    ['Bullet list', '- plain words', 'plain words'],
    ['Numbered list', '1. plain words', 'plain words'],
    ['Checkbox list', '- [ ] plain words', 'plain words'],
  ];

  test.each(ACTIONS)('%s applies and undo/redo round-trips it', async (name, applied, original) => {
    const { user } = await openBlock('plain words', 6, 11);
    await press(user, name);
    expect(editor().value).toBe(applied);
    await user.keyboard('{Escape}');
    await undo(user);
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled();
    await user.click(screen.getByTestId('markdown-view').firstElementChild!);
    expect(editor().value).toBe(original);
    await user.keyboard('{Escape}');
    await redo(user);
    await user.click(screen.getByTestId('markdown-view').firstElementChild!);
    expect(editor().value).toBe(applied);
  });

  test('Underline toggles off and renders underlined', async () => {
    const { user } = await openBlock('plain words', 6, 11);
    await press(user, 'Underline');
    expect(editor().value).toBe('plain <ins>words</ins>');
    editor().setSelectionRange(11, 16);
    await press(user, 'Underline');
    expect(editor().value).toBe('plain words');
    editor().setSelectionRange(6, 11);
    await press(user, 'Underline');
    await user.keyboard('{Escape}');
    const ins = screen.getByText('words');
    expect(ins.tagName).toBe('INS');
    expect(ins.parentElement?.textContent).toBe('plain words');
  });

  test('Insert link asks for a URL and writes [text](url)', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('https://example.com');
    const { user } = await openBlock('plain words', 6, 11);
    await press(user, 'Insert link');
    expect(prompt).toHaveBeenCalled();
    expect(editor().value).toBe('plain [words](https://example.com)');
    await undo(user);
    await user.click(screen.getByText('plain words'));
    expect(editor().value).toBe('plain words');
    prompt.mockRestore();
  });

  test('cancelling the link prompt changes nothing', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(null);
    const { user } = await openBlock('plain words', 6, 11);
    await press(user, 'Insert link');
    expect(editor().value).toBe('plain words');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.queryByText(/unsaved|●/)).not.toBeInTheDocument();
    prompt.mockRestore();
  });

  test('no selection inserts empty markup with the caret inside', async () => {
    const { user } = await openBlock('ab', 1, 1);
    await press(user, 'Underline');
    expect(editor().value).toBe('a<ins></ins>b');
    expect(editor().selectionStart).toBe(6);
    await user.keyboard('X');
    expect(editor().value).toBe('a<ins>X</ins>b');
  });

  test('formatting skips code', async () => {
    const { user } = await openBlock('```\ncode\n```', 5, 9);
    await press(user, 'Bold');
    expect(editor().value).toBe('```\ncode\n```');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });
});
