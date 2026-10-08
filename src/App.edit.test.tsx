import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import type { FileAccess, OpenedDocument } from './platform/files';
import { vi } from 'vitest';

// Each test drives the whole app through user-event; on slow CI they run close to the 5s default.
vi.setConfig({ testTimeout: 30000 });

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
  expect(saveDocument).toHaveBeenCalledWith({ name: 'a.md', path: null, text: ORIGINAL });
  await menu(user, 'File', /Save As/);
  expect(saveDocumentAs).toHaveBeenCalledWith({ name: 'a.md', text: ORIGINAL });
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
  expect(saveDocument).toHaveBeenCalledWith({ name: 'Untitled.md', path: null, text: '# Hello\n\nMore\n' });
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

describe('unsaved changes prompt', () => {
  async function dirtyThenNew() {
    const ctx = setup();
    await openDoc(ctx.user);
    await ctx.user.click(screen.getByText('last paragraph'));
    await ctx.user.type(editor(), '!');
    await ctx.user.keyboard('{Escape}');
    await menu(ctx.user, 'File', /New/);
    return { ...ctx, dialog: await screen.findByRole('dialog') };
  }

  test('Cancel keeps the document', async () => {
    const { user, dialog } = await dirtyThenNew();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('tab')).toHaveTextContent('a.md');
    expect(screen.getByText('last paragraph!')).toBeInTheDocument();
  });

  test("Don't save discards and continues", async () => {
    const { user, dialog, saveDocument } = await dirtyThenNew();
    await user.click(within(dialog).getByRole('button', { name: /Don.t save/ }));
    expect(saveDocument).not.toHaveBeenCalled();
    expect(screen.getByRole('tab')).toHaveTextContent('Untitled.md');
  });

  test('Save writes the file, then continues', async () => {
    const { user, dialog, saveDocument } = await dirtyThenNew();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(saveDocument).toHaveBeenCalledWith(expect.objectContaining({ text: ORIGINAL + '!' }));
    expect(await screen.findByText('Click here to start writing.')).toBeInTheDocument();
  });

  test('a clean document is replaced without asking', async () => {
    const { user } = setup();
    await openDoc(user);
    await menu(user, 'File', /New/);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
