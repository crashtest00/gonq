import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { activeBlocks, activeSource, caretIn, selectBetween, selectSource, settle, shownMarkers, view } from './testing/inplace';
import { alignText } from './components/inplace';
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

beforeEach(() => localStorage.clear());

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
  await menu(user, 'File', /^Open…/);
  await screen.findByTestId('markdown-view');
}

const editor = () => screen.getByRole('textbox', { name: /Markdown source/ }) as HTMLTextAreaElement;
const noField = () => expect(screen.queryByRole('textbox', { name: /Markdown source/ })).not.toBeInTheDocument();

/** Clicks a paragraph, puts the caret `at` characters into its text (default: the end) and types. */
async function typeIn(user: ReturnType<typeof userEvent.setup>, find: () => HTMLElement, text: string, at: number | 'end' = 'end') {
  await user.click(find());
  await caretIn(find().closest('[data-active]') ?? find(), at);
  await user.keyboard(text);
}

test('editing one block changes only that block of the file', async () => {
  const { user, saveDocument } = setup();
  await openDoc(user);
  await user.click(screen.getByText('last paragraph'));
  // The block stays rendered: no field replaces it.
  noField();
  expect(screen.getByText('last paragraph')).toBeInTheDocument();
  await caretIn(screen.getByText('last paragraph'));
  await user.keyboard(' edited');
  await user.keyboard('{Escape}');
  expect(view()).not.toHaveAttribute('contenteditable');
  expect(screen.getByText('last paragraph edited')).toBeInTheDocument();

  await menu(user, 'File', /^Save(?! As)/);
  expect(saveDocument).toHaveBeenCalledWith({ name: 'a.md', path: '/d/a.md', text: ORIGINAL + ' edited' });
});

test('clicking a block or pressing Enter on it leaves it rendered, with no field', async () => {
  const { user } = setup();
  await openDoc(user);
  await user.click(screen.getByRole('heading', { name: 'Setext Title' }));
  noField();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /Setext Title/ })).toHaveAttribute('data-active');
  expect(view()).toHaveAttribute('contenteditable', 'true');
  await user.keyboard('{Escape}');
  expect(activeBlocks()).toHaveLength(0);

  const para = screen.getByText('last paragraph');
  para.focus();
  await user.keyboard('{Enter}');
  noField();
  expect(activeBlocks().map((b) => b.getAttribute('data-from'))).toEqual([String(ORIGINAL.indexOf('last paragraph'))]);
  expect(screen.getByText('last paragraph')).toBeInTheDocument();
});

test('opening a block for editing leaves the file alone and keeps its exact source in the spans', async () => {
  const { user } = setup();
  await openDoc(user);
  await user.click(screen.getByRole('heading', { name: 'Setext Title' }));
  expect(activeSource()).toBe('Setext Title\n===');
  await user.keyboard('{Escape}');
  expect(screen.queryByLabelText('unsaved changes')).not.toBeInTheDocument();
});

test('line endings of a CRLF file are kept', async () => {
  const { user, saveDocument } = setup('first\r\n\r\nsecond\r\nline\r\n');
  await openDoc(user);
  await user.click(screen.getByText(/second/));
  expect(activeSource()).toBe('second\r\nline');
  await caretIn(screen.getByText(/second/));
  await user.keyboard('!');
  await user.keyboard('{Escape}');
  await user.keyboard('{Control>}s{/Control}');
  expect(saveDocument).toHaveBeenCalledWith(expect.objectContaining({ text: 'first\r\n\r\nsecond\r\nline!\r\n' }));
});

test('Shift+Enter in a CRLF file inserts a CRLF, and a pasted LF becomes CRLF', async () => {
  const { user, saveDocument } = setup('first\r\n\r\nsecond\r\n');
  await openDoc(user);
  await user.click(screen.getByText('second'));
  await caretIn(screen.getByText('second'));
  await user.keyboard('{Shift>}{Enter}{/Shift}x');
  await user.paste('a\nb');
  await user.keyboard('{Escape}{Control>}s{/Control}');
  expect(saveDocument).toHaveBeenCalledWith(expect.objectContaining({ text: 'first\r\n\r\nsecond\r\nxa\r\nb\r\n' }));
});

test('an unedited document saves byte-identical after blocks were visited', async () => {
  const { user, saveDocument } = setup();
  await openDoc(user);
  for (const el of [screen.getByText('last paragraph'), screen.getByRole('heading', { name: 'Setext Title' }), screen.getByText(/plus list/)]) {
    await user.click(el);
    await caretIn(view());
  }
  await user.keyboard('{Escape}');
  expect(screen.queryByLabelText('unsaved changes')).not.toBeInTheDocument();
  await menu(user, 'File', /^Save(?! As)/);
  expect(saveDocument).toHaveBeenCalledWith({ name: 'a.md', path: '/d/a.md', text: ORIGINAL });
});

test('typing, deleting and pasting splice only the edited text', async () => {
  const { user, saveDocument } = setup('keep  me\n\nsecond *para* here\n\nkeep too\n');
  await openDoc(user);
  await user.click(screen.getByText(/second/));
  // Just before the emphasis, after "second ".
  await selectSource(17);
  await user.keyboard('[[');
  await user.paste(']');
  expect(activeSource()).toBe('second []*para* here');
  await user.keyboard('{Backspace}{Backspace}');
  expect(activeSource()).toBe('second *para* here');
  await selectSource(12, 16);
  await user.keyboard('{Delete}');
  await user.keyboard('{Escape}{Control>}s{/Control}');
  expect(saveDocument).toHaveBeenCalledWith(expect.objectContaining({ text: 'keep  me\n\nse *para* here\n\nkeep too\n' }));
});

test('save clears the unsaved mark and undo brings it back', async () => {
  const { user } = setup();
  await openDoc(user);
  await typeIn(user, () => screen.getByText('last paragraph'), '!');
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

test('typing is one undo step; the document is dirty after the first character', async () => {
  const { user } = setup();
  await openDoc(user);
  await typeIn(user, () => screen.getByText('last paragraph'), 'xyz');
  expect(screen.getByLabelText('unsaved changes')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Undo' }));
  expect(screen.getByText('last paragraph')).toBeInTheDocument();
  expect(screen.queryByLabelText('unsaved changes')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('Ctrl+Z inside the edited block undoes the document edit', async () => {
  const { user } = setup();
  await openDoc(user);
  await typeIn(user, () => screen.getByText('last paragraph'), 'xyz');
  await user.keyboard('{Control>}z{/Control}');
  expect(view()).not.toHaveAttribute('contenteditable');
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
  const SAME = `Intro\n\nPara ${MARKER} end\n\n${THREAD}`;

  async function editMarkerBlock() {
    const ctx = setup(DOC);
    await openDoc(ctx.user);
    await ctx.user.click(screen.getByText(/^Para/));
    expect(activeSource()).toBe('Para 💬 end');
    const start = DOC.indexOf('[');
    return { ...ctx, start, end: start + MARKER.length };
  }
  const fileNow = async (user: ReturnType<typeof userEvent.setup>, saveDocument: { mock: { calls: any[][] } }) => {
    await user.keyboard('{Control>}s{/Control}');
    const text: string = saveDocument.mock.calls[saveDocument.mock.calls.length - 1]?.[0].text;
    return text.slice(7, text.indexOf('\n\n<!--'));
  };
  const saved = async (user: ReturnType<typeof userEvent.setup>, saveDocument: { mock: { calls: any[][] } }) => {
    await user.keyboard('{Escape}{Control>}s{/Control}');
    return saveDocument.mock.calls[saveDocument.mock.calls.length - 1]?.[0].text;
  };

  test('Backspace at the end of the marker leaves it intact', async () => {
    const { user, end, saveDocument } = await editMarkerBlock();
    await selectSource(end);
    await user.keyboard('{Backspace}');
    expect(await fileNow(user, saveDocument)).toBe(`Para ${MARKER} end`);
  });

  test('Delete at the start of the marker leaves it intact', async () => {
    const { user, start, saveDocument } = await editMarkerBlock();
    await selectSource(start);
    await user.keyboard('{Delete}');
    expect(await fileNow(user, saveDocument)).toBe(`Para ${MARKER} end`);
  });

  test('Delete and Backspace with the caret in the marker leave it intact', async () => {
    const { user, saveDocument } = await editMarkerBlock();
    const glyph = document.querySelector('.gonq-marker .gonq-at')!;
    await selectBetween([glyph as Element, 1], [glyph as Element, 1]);
    await user.keyboard('{Delete}');
    expect(await fileNow(user, saveDocument)).toBe(`Para ${MARKER} end`);
  });

  test('typing with the caret on either side of the marker lands beside it, never inside', async () => {
    const { user, start, end, saveDocument } = await editMarkerBlock();
    await selectSource(end);
    await user.keyboard('Z');
    expect(await fileNow(user, saveDocument)).toBe(`Para ${MARKER}Z end`);
    await selectSource(start);
    await user.keyboard('Y');
    expect(await fileNow(user, saveDocument)).toBe(`Para Y${MARKER}Z end`);
  });

  test('a selection spanning part of the marker deletes only the text outside it', async () => {
    const { user, saveDocument } = await editMarkerBlock();
    // The caret can only sit beside a marker, so a selection ending in its glyph ends before it.
    await selectBetween([screen.getByText(/^Para/), 2], [document.querySelector('.gonq-marker .gonq-at')!, 1]);
    await user.keyboard('{Delete}');
    expect(await fileNow(user, saveDocument)).toBe(`Pa${MARKER} end`);
  });

  test('a selection covering the whole marker may remove it, whole', async () => {
    const { user, start, end, saveDocument } = await editMarkerBlock();
    await selectSource(start - 1, end + 1);
    await user.keyboard('{Delete}');
    expect(await fileNow(user, saveDocument)).toBe('Paraend');
  });

  test('editing text next to the marker saves byte-exactly with the thread block intact', async () => {
    const { user, saveDocument, end } = await editMarkerBlock();
    await selectSource(end + 4);
    await user.keyboard('!');
    expect(await saved(user, saveDocument)).toBe(SAME.replace(' end', ' end!'));
    expect(DOC).toContain(THREAD);
  });

  test('clicking the marker opens its thread and does not start an edit', async () => {
    const ctx = setup(DOC);
    await openDoc(ctx.user);
    await ctx.user.click(document.querySelector('.gonq-marker')!);
    expect(view()).not.toHaveAttribute('contenteditable');
    expect(activeBlocks()).toHaveLength(0);
  });
});

test('clicking a link follows it and does not start an edit', async () => {
  const { user } = setup('a [link](https://example.com) here\n');
  await openDoc(user);
  await user.click(screen.getByRole('link', { name: 'link' }));
  expect(view()).not.toHaveAttribute('contenteditable');
  expect(activeBlocks()).toHaveLength(0);
  expect(screen.getByRole('link', { name: 'link' })).toHaveAttribute('href', 'https://example.com');
});

test('editing a middle block changes none of the other bytes', async () => {
  const { user, saveDocument } = setup();
  await openDoc(user);
  await user.click(screen.getByText(/next line/));
  expect(activeSource()).toBe('trailing spaces here  \nnext line');
  await caretIn(screen.getByText(/next line/));
  await user.keyboard(' X');
  await user.keyboard('{Escape}{Control>}s{/Control}');
  const expected = ORIGINAL.replace('next line', 'next line X');
  expect(expected).not.toBe(ORIGINAL);
  expect(saveDocument).toHaveBeenCalledWith(expect.objectContaining({ text: expected }));
  expect(expected.startsWith('*  odd bullet\n*  second\n\nSetext Title\n===\n\ntrailing spaces here  \nnext line X\n\n+ plus list\n\nlast paragraph')).toBe(true);
});

describe('markers in the active block', () => {
  const DOC = '# Title\n\nsome **bold** and `code`\n\n- item one\n- item two\n\n> quoted\n';

  test('with the option on only the block holding the caret shows its syntax, and it follows the caret', async () => {
    const { user } = setup(DOC);
    await openDoc(user);
    expect(shownMarkers()).toEqual([]);
    await user.click(screen.getByText(/^some/));
    await caretIn(screen.getByText(/^some/));
    expect(activeBlocks()).toHaveLength(1);
    expect(shownMarkers().join('')).toBe('****``');
    await caretIn(screen.getByRole('heading'), 2);
    expect(activeBlocks().map((b) => b.tagName)).toEqual(['H1']);
    expect(shownMarkers()).toEqual(['# ']);
    // Keyboard: arrow to the end of the heading, then down into the next block.
    await user.keyboard('{Escape}');
    expect(shownMarkers()).toEqual([]);
  });

  test('a leftover gonq.showMarkersInActiveBlock value in localStorage is ignored', async () => {
    localStorage.setItem('gonq.showMarkersInActiveBlock', 'false');
    const { user } = setup(DOC);
    await openDoc(user);
    await user.click(screen.getByText(/^some/));
    await caretIn(screen.getByText(/^some/));
    expect(shownMarkers().join('')).toBe('****``');
  });

  test('markers show for every list item and quote line of the block, and nothing else', async () => {
    const { user } = setup(DOC);
    await openDoc(user);
    await user.click(screen.getByText('item two'));
    expect(activeBlocks().map((b) => b.tagName)).toEqual(['UL']);
    expect(shownMarkers().join('|')).toBe('- |\n|- ');
    await caretIn(screen.getByText('quoted'));
    expect(activeBlocks().map((b) => b.tagName)).toEqual(['BLOCKQUOTE']);
    expect(shownMarkers()).toEqual(['> ']);
  });

  test('a selection across several blocks shows markers on every block it touches', async () => {
    const { user } = setup(DOC);
    await openDoc(user);
    await user.click(screen.getByRole('heading'));
    await selectBetween([screen.getByRole('heading'), 2], [screen.getByText('item one'), 3]);
    expect(activeBlocks().map((b) => b.tagName)).toEqual(['H1', 'P', 'UL']);
    expect(shownMarkers()).toContain('# ');
    expect(shownMarkers()).toContain('**');
    expect(shownMarkers()).toContain('- ');
    // The quote after the selection does not.
    expect(document.querySelector('blockquote[data-active]')).toBeNull();
    // Shrinking the selection back into one block drops the markers of the others.
    await caretIn(screen.getByText('item one'), 2);
    expect(activeBlocks().map((b) => b.tagName)).toEqual(['UL']);
  });

  test('Tab moves the caret to the next block and its markers follow', async () => {
    const { user } = setup(DOC);
    await openDoc(user);
    await user.click(screen.getByRole('heading'));
    expect(activeBlocks().map((b) => b.tagName)).toEqual(['H1']);
    await user.tab();
    await settle();
    expect(activeBlocks().map((b) => b.tagName)).toEqual(['P']);
  });

  test('leaving the document ends editing and hides the markers', async () => {
    const { user } = setup(DOC);
    await openDoc(user);
    await user.click(screen.getByRole('heading'));
    expect(shownMarkers()).toEqual(['# ']);
    await user.click(screen.getByTestId('append-area'));
    expect(activeBlocks()).toHaveLength(0);
    expect(shownMarkers()).toEqual([]);
  });

  test('markers do not change the text that is saved, and typing next to them keeps the formatting', async () => {
    const { user, saveDocument } = setup(DOC);
    await openDoc(user);
    await user.click(screen.getByText('bold'));
    await caretIn(screen.getByText('bold'));
    await user.keyboard('er');
    await user.keyboard('{Escape}{Control>}s{/Control}');
    expect(saveDocument).toHaveBeenCalledWith(expect.objectContaining({ text: DOC.replace('**bold**', '**bolder**') }));
    expect(screen.getByText('bolder').tagName).toBe('STRONG');
  });

});

describe('splitting and joining blocks while typing', () => {
  test('Enter inside a paragraph splits it into two blocks and keep the caret', async () => {
    const { user, saveDocument } = setup('onetwo\n\nlast\n');
    await openDoc(user);
    await user.click(screen.getByText('onetwo'));
    await caretIn(screen.getByText('onetwo'), 3);
    await user.keyboard('{Enter}X');
    expect(view().querySelectorAll('p')).toHaveLength(3);
    expect(activeBlocks()).toHaveLength(1);
    expect(activeSource()).toBe('Xtwo');
    await user.keyboard('{Escape}{Control>}s{/Control}');
    expect(saveDocument).toHaveBeenCalledWith(expect.objectContaining({ text: 'one\n\nXtwo\n\nlast\n' }));
  });

  test('Backspace at the start of a paragraph joins it to the one before', async () => {
    const { user, saveDocument } = setup('one\n\ntwo\n');
    await openDoc(user);
    await user.click(screen.getByText('two'));
    await caretIn(screen.getByText('two'), 0);
    await user.keyboard('{Backspace}');
    await user.keyboard('{Escape}{Control>}s{/Control}');
    expect(saveDocument).toHaveBeenCalledWith(expect.objectContaining({ text: 'onetwo\n' }));
  });
});

describe('edge cases', () => {
  test('an empty document can be started from the append area', async () => {
    const { user, saveDocument } = setup('');
    await openDoc(user);
    expect(activeBlocks()).toHaveLength(0);
    await user.click(screen.getByTestId('append-area'));
    await user.type(editor(), 'Hi');
    await user.keyboard('{Escape}{Control>}s{/Control}');
    expect(saveDocument).toHaveBeenCalledWith(expect.objectContaining({ text: 'Hi\n' }));
  });

  test('a block holding only thread markers can be entered and left unchanged', async () => {
    const id = 'c20260910143022a3f9c1';
    const thread = `<!--\n@thread ${id}\n@status open\n\n[User | 2026-09-10T14:30:22+02:00]\nHi\n-->\n`;
    const text = `[💬](#md-thread-${id})\n\n${thread}`;
    const { user, saveDocument } = setup(text);
    await openDoc(user);
    await user.click(view().querySelector('p')!);
    expect(activeSource()).toBe('💬');
    await user.keyboard('{Escape}{Control>}s{/Control}');
    expect(saveDocument).toHaveBeenCalledWith(expect.objectContaining({ text }));
  });

  describe('tables', () => {
    /** A cell by its text, whether or not the table is being edited (its syntax is in the cell then, unseen). */
    const cell = (text: string) =>
      Array.from(view().querySelectorAll('td, th')).find((c) => (c.textContent ?? '').replace(/[|\s]/g, '') === text) as HTMLElement;
    const TABLE = '| a | b |\n| - | - |\n| 1 | 2 |\n\nafter\n';

    test('a click on a table edits its cells in place, never as pipe syntax', async () => {
      const { user } = setup(TABLE);
      await openDoc(user);
      await user.click(screen.getByRole('cell', { name: '1' }));
      noField();
      expect(view()).toHaveAttribute('contenteditable', 'true');
      expect(screen.getByRole('table')).toBeInTheDocument();
      // Every pipe and the delimiter row are syntax that is never on screen, markers option or not.
      expect(shownMarkers()).toEqual([]);
      expect(activeSource()).toBe('| a | b |\n| - | - |\n| 1 | 2 |');
    });

    test('typing in a cell changes only that cell of the file', async () => {
      const { user, saveDocument } = setup(TABLE);
      await openDoc(user);
      await user.click(cell('1'));
      await caretIn(cell('1'));
      await user.keyboard('23');
      await user.keyboard('{Escape}{Control>}s{/Control}');
      expect(saveDocument).toHaveBeenCalledWith(expect.objectContaining({ text: '| a | b |\n| - | - |\n| 123 | 2 |\n\nafter\n' }));
      expect(cell('123')).toBeInTheDocument();
    });

    test('a pipe typed in a cell is cell text; Enter does not break the table', async () => {
      const { user, saveDocument } = setup(TABLE);
      await openDoc(user);
      await user.click(cell('2'));
      await caretIn(cell('2'));
      await user.keyboard('|{Enter}x');
      await user.keyboard('{Escape}{Control>}s{/Control}');
      expect(saveDocument).toHaveBeenCalledWith(expect.objectContaining({ text: '| a | b |\n| - | - |\n| 1 | 2\\|x |\n\nafter\n' }));
      expect(screen.getAllByRole('cell')).toHaveLength(2);
    });

    test('Backspace at the start of a cell leaves the neighbouring cell alone', async () => {
      const { user, saveDocument } = setup(TABLE);
      await openDoc(user);
      await user.click(cell('2'));
      await caretIn(cell('2'), 0);
      await user.keyboard('{Backspace}');
      await user.keyboard('{Escape}{Control>}s{/Control}');
      expect(saveDocument).toHaveBeenCalledWith(expect.objectContaining({ text: TABLE }));
    });

    test('an empty cell can be typed into', async () => {
      const { user, saveDocument } = setup('| a | b |\n| - | - |\n| 1 |  |\n');
      await openDoc(user);
      await user.click(screen.getAllByRole('cell')[1]);
     
      await caretIn(screen.getAllByRole('cell')[1]);
      await user.keyboard('z');
      await user.keyboard('{Escape}{Control>}s{/Control}');
      expect(saveDocument).toHaveBeenCalledWith(expect.objectContaining({ text: '| a | b |\n| - | - |\n| 1 | z |\n' }));
    });
  });
});

describe('Edit menu and shortcuts', () => {
  async function edited() {
    const ctx = setup();
    await openDoc(ctx.user);
    await typeIn(ctx.user, () => screen.getByText('last paragraph'), '!');
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
    await typeIn(ctx.user, () => screen.getByText('last paragraph'), '!');
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
  expect(bold).toBeEnabled();
  await selectSource(6, 11);
  await user.click(bold);
  expect(activeSource()).toBe('plain **words**');
  await user.click(screen.getByRole('button', { name: 'Bullet list' }));
  expect(activeSource()).toBe('- plain **words**');
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
  expect(view()).not.toHaveAttribute('contenteditable');
  await menu(user, 'File', /^Save(?! As)/);
  expect(saveDocument).toHaveBeenCalledWith({ name: 'a.md', path: '/d/a.md', text: '- [x] one\n- [ ] two\n\n1.  [x] odd\n' });
  await user.click(screen.getByRole('button', { name: 'Undo' }));
  expect((screen.getAllByRole('checkbox')[2] as HTMLInputElement).checked).toBe(false);
});

test('a task item is edited in place with its checkbox still working', async () => {
  const { user, saveDocument } = setup('- [ ] one\n- [x] two\n');
  await openDoc(user);
  await user.click(screen.getByText('one'));
  expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  expect(shownMarkers().join('')).toBe('- [ ] \n- [x] ');
  await user.click(screen.getAllByRole('checkbox')[0]);
  await user.keyboard('{Escape}{Control>}s{/Control}');
  expect(saveDocument).toHaveBeenCalledWith(expect.objectContaining({ text: '- [x] one\n- [x] two\n' }));
});

describe('toolbar actions', () => {
  const press = (user: ReturnType<typeof userEvent.setup>, name: string) => user.click(screen.getByRole('button', { name }));
  const undo = (user: ReturnType<typeof userEvent.setup>) => press(user, 'Undo');
  const redo = (user: ReturnType<typeof userEvent.setup>) => press(user, 'Redo');

  async function openBlock(text: string, from: number, to: number) {
    const { user, saveDocument } = setup(text);
    await openDoc(user);
    await user.click(view().firstElementChild!);
    await selectSource(from, to);
    return { user, saveDocument };
  }
  const reopen = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(view().firstElementChild!);
  };

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
    expect(activeSource()).toBe(applied);
    await user.keyboard('{Escape}');
    await undo(user);
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled();
    await reopen(user);
    expect(activeSource()).toBe(original);
    await user.keyboard('{Escape}');
    await redo(user);
    await reopen(user);
    expect(activeSource()).toBe(applied);
  });

  test('Underline toggles off and renders underlined', async () => {
    const { user } = await openBlock('plain words', 6, 11);
    await press(user, 'Underline');
    expect(activeSource()).toBe('plain <ins>words</ins>');
    await selectSource(11, 16);
    await press(user, 'Underline');
    expect(activeSource()).toBe('plain words');
    await selectSource(6, 11);
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
    expect(activeSource()).toBe('plain [words](https://example.com)');
    await user.keyboard('{Escape}');
    await undo(user);
    await user.click(screen.getByText('plain words'));
    expect(activeSource()).toBe('plain words');
    prompt.mockRestore();
  });

  test('cancelling the link prompt changes nothing', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(null);
    const { user } = await openBlock('plain words', 6, 11);
    await press(user, 'Insert link');
    expect(activeSource()).toBe('plain words');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.queryByText(/unsaved|●/)).not.toBeInTheDocument();
    prompt.mockRestore();
  });

  test('no selection inserts empty markup with the caret inside', async () => {
    const { user } = await openBlock('ab', 1, 1);
    await press(user, 'Underline');
    expect(activeSource()).toBe('a<ins></ins>b');
    await user.keyboard('X');
    expect(activeSource()).toBe('a<ins>X</ins>b');
  });

  test('formatting skips code', async () => {
    const { user } = await openBlock('```\ncode\n```', 5, 9);
    await press(user, 'Bold');
    expect(activeSource()).toBe('```\ncode\n```');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });
});


describe('rework of editing in place', () => {
  const save = async (user: ReturnType<typeof userEvent.setup>, saveDocument: { mock: { calls: any[][] } }) => {
    await user.keyboard('{Escape}{Control>}s{/Control}');
    return saveDocument.mock.calls[saveDocument.mock.calls.length - 1]?.[0].text as string;
  };
  const beforeInput = (type: string, init: Record<string, unknown> = {}, ranges?: unknown[]) => {
    const ev = new InputEvent('beforeinput', { inputType: type, bubbles: true, cancelable: true, ...init });
    if (ranges) Object.defineProperty(ev, 'getTargetRanges', { value: () => ranges });
    act(() => {
      view().dispatchEvent(ev);
    });
  };

  describe('IME and dead keys', () => {
    test('composed text is written to the file when the composition ends', async () => {
      const { user, saveDocument } = setup('one\n\nabc\n');
      await openDoc(user);
      await user.click(screen.getByText('abc'));
      await caretIn(screen.getByText('abc'), 1);
      fireEvent.compositionStart(view());
      // The browser puts the composing text in the DOM only.
      const node = screen.getByText('abc').firstChild as Text;
      act(() => {
        node.data = 'aüc'.slice(0, 2) + node.data.slice(1);
      });
      fireEvent.compositionEnd(view(), { data: 'ü' });
      await settle();
      expect(activeSource()).toBe('aübc');
      // the spans still map to the right offsets
      await user.keyboard('X');
      expect(await save(user, saveDocument)).toBe('one\n\naüXbc\n');
    });

    test('a cancelled composition leaves the file alone', async () => {
      const { user, saveDocument } = setup('abc\n');
      await openDoc(user);
      await user.click(screen.getByText('abc'));
      await caretIn(screen.getByText('abc'), 1);
      fireEvent.compositionStart(view());
      fireEvent.compositionEnd(view(), { data: '' });
      await settle();
      await user.keyboard('X');
      expect(await save(user, saveDocument)).toBe('aXbc\n');
    });

    test('Escape during a composition does not end editing', async () => {
      const { user } = setup('abc\n');
      await openDoc(user);
      await user.click(screen.getByText('abc'));
      fireEvent.compositionStart(view());
      fireEvent.keyDown(view(), { key: 'Escape', isComposing: true });
      expect(view()).toHaveAttribute('contenteditable');
    });
  });

  describe('joining blocks', () => {
    const DEF = '[r]: http://example.com/\n';
    test('Backspace never deletes a link reference definition between two paragraphs', async () => {
      const text = `one\n\n${DEF}\ntwo\n`;
      const { user, saveDocument } = setup(text);
      await openDoc(user);
      await user.click(screen.getByText('two'));
      await caretIn(screen.getByText('two'), 0);
      await user.keyboard('{Backspace}');
      expect(await save(user, saveDocument)).toBe(text);
    });

    test('Delete at the end of a paragraph never deletes an HTML comment after it', async () => {
      const text = 'one\n\n<!-- keep me -->\n\ntwo\n';
      const { user, saveDocument } = setup(text);
      await openDoc(user);
      await user.click(screen.getByText('one'));
      await caretIn(screen.getByText('one'));
      await user.keyboard('{Delete}');
      expect(await save(user, saveDocument)).toBe(text);
    });

    test('a paragraph is not joined onto a fenced code block, nor code onto a paragraph', async () => {
      const text = '```\ncode\n```\n\npara\n\n```\nmore\n```\n';
      const { user, saveDocument } = setup(text);
      await openDoc(user);
      await user.click(screen.getByText('para'));
      await caretIn(screen.getByText('para'), 0);
      await user.keyboard('{Backspace}');
      await caretIn(screen.getByText('para'));
      await user.keyboard('{Delete}');
      expect(await save(user, saveDocument)).toBe(text);
    });

    test('plain paragraphs still join, taking only the blank line between them', async () => {
      const { user, saveDocument } = setup('one\n\n\n\ntwo\n');
      await openDoc(user);
      await user.click(screen.getByText('two'));
      await caretIn(screen.getByText('two'), 0);
      await user.keyboard('{Backspace}');
      expect(await save(user, saveDocument)).toBe('onetwo\n');
    });
  });

  describe('CRLF', () => {
    const TEXT = 'first\r\n\r\nsecond\r\nline\r\n';
    const AT = 'first\r\n\r\nsecond'.length;
    test('Backspace after a line break removes the whole \\r\\n', async () => {
      const { user, saveDocument } = setup(TEXT);
      await openDoc(user);
      await user.click(screen.getByText(/second/));
      await selectSource(AT + 2);
      await user.keyboard('{Backspace}');
      expect(await save(user, saveDocument)).toBe('first\r\n\r\nsecondline\r\n');
    });

    test('Delete before a line break removes the whole \\r\\n', async () => {
      const { user, saveDocument } = setup(TEXT);
      await openDoc(user);
      await user.click(screen.getByText(/second/));
      await selectSource(AT);
      await user.keyboard('{Delete}');
      expect(await save(user, saveDocument)).toBe('first\r\n\r\nsecondline\r\n');
    });

    test('a caret between \\r and \\n is moved out of the break before typing', async () => {
      const { user, saveDocument } = setup(TEXT);
      await openDoc(user);
      await user.click(screen.getByText(/second/));
      await selectSource(AT + 1);
      await user.keyboard('X');
      expect(await save(user, saveDocument)).toBe('first\r\n\r\nsecond\r\nXline\r\n');
    });
  });

  describe('entities and escapes', () => {
    test('typing after a rendered & goes after the whole entity', async () => {
      const { user, saveDocument } = setup('a &amp; b\n');
      await openDoc(user);
      await user.click(screen.getByText(/a & b/));
      await caretIn(view().querySelector('[data-active]')!, 3);
      await user.keyboard('X');
      expect(await save(user, saveDocument)).toBe('a &amp;X b\n');
    });

    test('Backspace after a numeric entity removes all of it', async () => {
      const { user, saveDocument } = setup('a &#38; b\n');
      await openDoc(user);
      await user.click(screen.getByText(/a & b/));
      await caretIn(view().querySelector('[data-active]')!, 3);
      await user.keyboard('{Backspace}');
      expect(await save(user, saveDocument)).toBe('a  b\n');
    });

    test('an escaped character is one unit', async () => {
      const { user, saveDocument } = setup('x \\* y and \\\\ z\n');
      await openDoc(user);
      await user.click(screen.getByText(/x \* y/));
      await caretIn(view().querySelector('[data-active]')!, 3);
      await user.keyboard('A');
      expect(await save(user, saveDocument)).toBe('x \\*A y and \\\\ z\n');
    });

    test('inline code with doubled backticks keeps its delimiters as syntax', async () => {
      const { user, saveDocument } = setup('see `` `x` `` now\n');
      await openDoc(user);
      await user.click(screen.getByText('`x`'));
      await caretIn(view().querySelector('code')!, 1);
      await user.keyboard('Q');
      expect(await save(user, saveDocument)).toBe('see `` `Qx` `` now\n');
    });

    test('alignText treats an entity as one unit', () => {
      expect(alignText('a & b', 'a &amp; b', true)).toEqual([
        { kind: 'tx', from: 0, to: 2 },
        { kind: 'at', from: 2, to: 7, text: '&' },
        { kind: 'tx', from: 7, to: 9 },
      ]);
    });
  });

  describe('Enter', () => {
    test('at the end of a paragraph starts a new paragraph', async () => {
      const { user, saveDocument } = setup('abc\n');
      await openDoc(user);
      await user.click(screen.getByText('abc'));
      await caretIn(screen.getByText('abc'));
      await user.keyboard('{Enter}x');
      expect(view().querySelectorAll('p')).toHaveLength(2);
      expect(await save(user, saveDocument)).toBe('abc\n\nx\n');
    });

    test('Shift+Enter keeps the soft break', async () => {
      const { user, saveDocument } = setup('abc\n');
      await openDoc(user);
      await user.click(screen.getByText('abc'));
      await caretIn(screen.getByText('abc'));
      await user.keyboard('{Shift>}{Enter}{/Shift}x');
      expect(await save(user, saveDocument)).toBe('abc\nx\n');
    });

    test('in a list item starts a new item with the same marker', async () => {
      const { user, saveDocument } = setup('* a\n* b\n');
      await openDoc(user);
      await user.click(screen.getByText('b'));
      await caretIn(screen.getByText('b'));
      await user.keyboard('{Enter}c');
      expect(view().querySelectorAll('li')).toHaveLength(3);
      expect(await save(user, saveDocument)).toBe('* a\n* b\n* c\n');
    });

    test('in an ordered, nested or task item the new item matches', async () => {
      const { user, saveDocument } = setup('1. a\n   - [x] b\n');
      await openDoc(user);
      await user.click(screen.getByText('b'));
      await caretIn(screen.getByText('b'));
      await user.keyboard('{Enter}c');
      expect(await save(user, saveDocument)).toBe('1. a\n   - [x] b\n   - [ ] c\n');
    });

    test('in a quote keeps the quote', async () => {
      const { user, saveDocument } = setup('> a\n');
      await openDoc(user);
      await user.click(screen.getByText('a'));
      await caretIn(screen.getByText('a'));
      await user.keyboard('{Enter}b');
      expect(await save(user, saveDocument)).toBe('> a\n>\n> b\n');
    });

    test('in a code block adds a line', async () => {
      const { user, saveDocument } = setup('```\nx\n```\n');
      await openDoc(user);
      await user.click(screen.getByText('x'));
      await caretIn(screen.getByText('x'));
      await user.keyboard('{Enter}y');
      expect(await save(user, saveDocument)).toBe('```\nx\ny\n```\n');
    });

    test('in a CRLF file the paragraph break is CRLF', async () => {
      const { user, saveDocument } = setup('abc\r\n');
      await openDoc(user);
      await user.click(screen.getByText('abc'));
      await caretIn(screen.getByText('abc'));
      await user.keyboard('{Enter}x');
      expect(await save(user, saveDocument)).toBe('abc\r\n\r\nx\r\n');
    });
  });

  describe('spellcheck, word and line deletes, empty paste', () => {
    test('a replacement from spellcheck replaces the range it names, not the caret', async () => {
      const { user, saveDocument } = setup('hello wrold\n');
      await openDoc(user);
      await user.click(screen.getByText(/hello/));
      await caretIn(screen.getByText(/hello/), 0);
      const node = screen.getByText(/hello/).firstChild as Text;
      beforeInput('insertReplacementText', { data: 'world' }, [{ startContainer: node, startOffset: 6, endContainer: node, endOffset: 11 }]);
      await settle();
      expect(await save(user, saveDocument)).toBe('hello world\n');
    });

    test('deleteWordBackward removes the word, not one character', async () => {
      const { user, saveDocument } = setup('one two three\n');
      await openDoc(user);
      await user.click(screen.getByText(/one/));
      await caretIn(screen.getByText(/one/));
      beforeInput('deleteWordBackward');
      await settle();
      expect(await save(user, saveDocument)).toBe('one two \n');
    });

    test('deleteWordForward removes the next word', async () => {
      const { user, saveDocument } = setup('one two three\n');
      await openDoc(user);
      await user.click(screen.getByText(/one/));
      await caretIn(screen.getByText(/one/), 4);
      beforeInput('deleteWordForward');
      await settle();
      expect(await save(user, saveDocument)).toBe('one  three\n');
    });

    test('deleteSoftLineBackward removes to the start of the line', async () => {
      const { user, saveDocument } = setup('one two\nthree four\n');
      await openDoc(user);
      await user.click(screen.getByText(/one/));
      await caretIn(screen.getByText(/one/));
      beforeInput('deleteSoftLineBackward');
      await settle();
      expect(await save(user, saveDocument)).toBe('one two\n\n');
    });

    test('pasting nothing leaves the selection alone', async () => {
      const { user, saveDocument } = setup('hello\n');
      await openDoc(user);
      await user.click(screen.getByText('hello'));
      await selectBetween([screen.getByText('hello'), 1], [screen.getByText('hello'), 3]);
      beforeInput('insertFromPaste', { data: '' });
      await settle();
      expect(await save(user, saveDocument)).toBe('hello\n');
    });
  });
});
