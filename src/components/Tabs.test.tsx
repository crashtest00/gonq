import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import App from '../App';
import { PathTakenError, type FileAccess, type OpenedDocument } from '../platform/files';
import { tabLabels } from './TabStrip';

vi.setConfig({ testTimeout: 30000 });

const closeGuard = vi.hoisted(() => ({ confirm: null as null | (() => Promise<boolean>) }));
vi.mock('../platform/lifecycle', () => ({
  guardClose: (isDirty: () => boolean, confirm: () => Promise<boolean>) => {
    closeGuard.confirm = async () => (isDirty() ? confirm() : true);
    return () => {};
  },
}));

const A: OpenedDocument = { name: 'a.md', path: '/x/a.md', text: '# Alpha\n\nfirst doc' };
const B: OpenedDocument = { name: 'b.md', path: '/x/b.md', text: '# Beta\n\n## Sub\n\nsecond doc' };

function setup(queue: OpenedDocument[]) {
  const picks = [...queue];
  const saveDocument = vi.fn(async (d: { name: string; path: string | null }) => ({ name: d.name, path: d.path ?? '/x/new.md' }));
  const saveDocumentAs = vi.fn(async (d: { name: string }, taken?: (p: string) => boolean) => {
    if (taken?.('/x/a.md')) throw new PathTakenError('/x/a.md');
    return { name: 'a.md', path: '/x/a.md' };
  });
  const files: FileAccess = {
    pickDocument: async () => picks.shift() ?? null,
    loadImage: async () => null,
    saveDocument,
    saveDocumentAs,
  };
  const user = userEvent.setup();
  render(<App files={files} />);
  return { user, saveDocument, saveDocumentAs };
}

type U = ReturnType<typeof userEvent.setup>;
async function openFile(user: U) {
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /Open/ }));
}
const tabs = () => screen.getAllByRole('tab');
const tab = (name: RegExp) => screen.getByRole('tab', { name });
async function type(user: U, para: string, extra: string) {
  await user.click(screen.getByText(para));
  await user.type(screen.getByRole('textbox', { name: /Markdown source/ }), extra);
  await user.keyboard('{Escape}');
}

test('several documents open at once, one tab each; switching swaps the content', async () => {
  const { user } = setup([A, B]);
  await openFile(user);
  await screen.findByText('first doc');
  await openFile(user);
  await screen.findByText('second doc');
  expect(tabs()).toHaveLength(2);
  expect(tab(/b\.md/)).toHaveAttribute('aria-selected', 'true');
  await user.click(tab(/a\.md/));
  expect(screen.getByText('first doc')).toBeInTheDocument();
  expect(screen.queryByText('second doc')).not.toBeInTheDocument();
});

test('undo history, unsaved indicator and raw mode are kept per document', async () => {
  const { user } = setup([A, B]);
  await openFile(user);
  await screen.findByText('first doc');
  await type(user, 'first doc', '!');
  await user.click(screen.getByRole('switch'));
  await openFile(user);
  await screen.findByText('second doc');
  // The second document is clean, formatted, and has nothing to undo.
  expect(within(tab(/b\.md/)).queryByLabelText('unsaved changes')).not.toBeInTheDocument();
  expect(within(tab(/a\.md/)).getByLabelText('unsaved changes')).toBeInTheDocument();
  expect(screen.getByRole('switch')).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await user.click(tab(/a\.md/));
  expect(screen.getByRole('switch')).toBeChecked();
  expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: 'Undo' }));
  expect(within(tab(/a\.md/)).queryByLabelText('unsaved changes')).not.toBeInTheDocument();
});

test('scroll position is restored when switching back', async () => {
  const { user } = setup([A, B]);
  await openFile(user);
  await screen.findByText('first doc');
  const main = screen.getByRole('main');
  main.scrollTop = 120;
  main.dispatchEvent(new Event('scroll'));
  await openFile(user);
  await screen.findByText('second doc');
  expect(main.scrollTop).toBe(0);
  await user.click(tab(/a\.md/));
  expect(main.scrollTop).toBe(120);
});

test('opening an already-open file switches to its tab instead of opening another', async () => {
  const { user } = setup([A, B, { ...A, text: 'changed on disk' }]);
  await openFile(user);
  await screen.findByText('first doc');
  await openFile(user);
  await screen.findByText('second doc');
  await openFile(user);
  expect(await screen.findByText('first doc')).toBeInTheDocument();
  expect(tabs()).toHaveLength(2);
  expect(tab(/a\.md/)).toHaveAttribute('aria-selected', 'true');
});

test('+ opens a new untitled tab', async () => {
  const { user } = setup([A]);
  await openFile(user);
  await screen.findByText('first doc');
  await user.click(screen.getByRole('button', { name: 'New tab' }));
  await user.click(screen.getByRole('button', { name: 'New tab' }));
  expect(tabs().map((t) => t.textContent)).toEqual(['a.md', 'Untitled.md', 'Untitled 2.md'].map((n) => expect.stringContaining(n)));
  expect(screen.getByText('Click here to start writing.')).toBeInTheDocument();
});

test('outline and comments sidebars follow the active tab; comments reset to All threads', async () => {
  const thread = '<!--\n@thread c20260910143022a3f9c1\n@status open\n\n[User | 2026-09-10T14:30:22+02:00]\nHi there\n-->\n';
  const C: OpenedDocument = { name: 'c.md', path: '/x/c.md', text: `# Gamma\n\nPara [💬](#md-thread-c20260910143022a3f9c1)\n\n${thread}` };
  const { user } = setup([B, C]);
  await openFile(user);
  await screen.findByText('second doc');
  await user.click(screen.getByRole('button', { name: 'Document outline' }));
  const outline = screen.getByRole('complementary', { name: /outline/i });
  expect(within(outline).getByText('Sub')).toBeInTheDocument();
  await openFile(user);
  await screen.findByText(/^Para/);
  expect(within(outline).queryByText('Sub')).not.toBeInTheDocument();
  expect(within(outline).getByText('Gamma')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Comments' }));
  await user.click(await screen.findByText('Hi there'));
  expect(screen.queryByText('No comments yet.')).not.toBeInTheDocument();
  await user.click(tab(/b\.md/));
  expect(await screen.findByText('No comments yet.')).toBeInTheDocument();
  await user.click(tab(/c\.md/));
  // Back on the thread-bearing tab the sidebar shows the list, not the previously open thread.
  expect(await screen.findByText('Hi there')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Reply/ })).not.toBeInTheDocument();
});

describe('closing a tab', () => {
  async function dirtyTab() {
    const ctx = setup([A, B]);
    await openFile(ctx.user);
    await screen.findByText('first doc');
    await type(ctx.user, 'first doc', '!');
    await openFile(ctx.user);
    await screen.findByText('second doc');
    await ctx.user.click(screen.getByRole('button', { name: 'Close a.md' }));
    return { ...ctx, dialog: await screen.findByRole('dialog') };
  }

  test('a clean tab closes without asking', async () => {
    const { user } = setup([A, B]);
    await openFile(user);
    await screen.findByText('first doc');
    await openFile(user);
    await user.click(screen.getByRole('button', { name: 'Close b.md' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(tabs()).toHaveLength(1);
    expect(await screen.findByText('first doc')).toBeInTheDocument();
  });

  test('Cancel keeps the tab', async () => {
    const { user, dialog } = await dirtyTab();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(tabs()).toHaveLength(2);
  });

  test("Don't save closes without writing", async () => {
    const { user, dialog, saveDocument } = await dirtyTab();
    await user.click(within(dialog).getByRole('button', { name: /Don.t save/ }));
    expect(tabs()).toHaveLength(1);
    expect(saveDocument).not.toHaveBeenCalled();
  });

  test('Save writes that tab, then closes it', async () => {
    const { user, dialog, saveDocument } = await dirtyTab();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(tabs()).toHaveLength(1));
    expect(saveDocument).toHaveBeenCalledWith(expect.objectContaining({ path: '/x/a.md', text: '# Alpha\n\nfirst doc!' }));
  });

  test('closing the last tab leaves no tab and shows the empty screen', async () => {
    const { user } = setup([A]);
    await openFile(user);
    await screen.findByText('first doc');
    await user.click(screen.getByRole('button', { name: 'Close a.md' }));
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getByText(/Use File > Open to open a Markdown file/)).toBeInTheDocument();
  });

  test('an empty untitled tab closes, and File > Close does the same', async () => {
    const { user } = setup([]);
    await user.click(screen.getByRole('button', { name: 'New tab' }));
    await user.click(screen.getByRole('button', { name: 'Close Untitled.md' }));
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getByText(/Use File > Open to open a Markdown file/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New tab' }));
    await user.click(screen.getByRole('menuitem', { name: 'File' }));
    await user.click(await screen.findByRole('menuitem', { name: /Close/ }));
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  test('a dirty untitled tab still asks; Cancel keeps it', async () => {
    const { user } = setup([]);
    await user.click(screen.getByRole('button', { name: 'New tab' }));
    await user.click(screen.getByTestId('append-area'));
    await user.type(screen.getByRole('textbox', { name: /Markdown source/ }), 'hello');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Close Untitled.md' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(tabs()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Close Untitled.md' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Don.t save/ }));
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  test('File > New after closing the last tab starts at Untitled.md', async () => {
    const { user } = setup([]);
    await user.click(screen.getByRole('button', { name: 'New tab' }));
    await user.click(screen.getByRole('button', { name: 'Close Untitled.md' }));
    await user.click(screen.getByRole('menuitem', { name: 'File' }));
    await user.click(await screen.findByRole('menuitem', { name: /New/ }));
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0]).toHaveTextContent('Untitled.md');
  });

  test('the window closes without a prompt when no tab is open', async () => {
    const { user } = setup([A]);
    await openFile(user);
    await screen.findByText('first doc');
    await user.click(screen.getByRole('button', { name: 'Close a.md' }));
    await expect(closeGuard.confirm!()).resolves.toBe(true);
  });
});

test('closing the window asks for every unsaved tab in turn; Cancel aborts', async () => {
  const { user, saveDocument } = setup([A, B]);
  await openFile(user);
  await screen.findByText('first doc');
  await type(user, 'first doc', '!');
  await openFile(user);
  await screen.findByText('second doc');
  await type(user, 'second doc', '?');
  let result: Promise<boolean> = Promise.resolve(false);
  act(() => {
    result = closeGuard.confirm!();
  });
  let dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('a.md');
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
  await vi.waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('b.md'));
  expect(saveDocument).toHaveBeenCalledTimes(1);
  dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(await result).toBe(false);

  act(() => {
    result = closeGuard.confirm!();
  });
  dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('b.md');
  await user.click(within(dialog).getByRole('button', { name: /Don.t save/ }));
  expect(await result).toBe(true);
});

test('Save As to the path of another open tab is refused', async () => {
  const { user } = setup([A, B]);
  await openFile(user);
  await screen.findByText('first doc');
  await openFile(user);
  await screen.findByText('second doc');
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /Save As/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('already open in another tab');
  expect(tab(/b\.md/)).toBeInTheDocument();
});

test('same file names in different folders show enough of the path', () => {
  expect(
    tabLabels([
      { name: 'todo.md', path: '/notes/todo.md' },
      { name: 'todo.md', path: '/work/todo.md' },
      { name: 'a.md', path: '/work/a.md' },
      { name: 'Untitled.md', path: null },
    ]),
  ).toEqual(['notes/todo.md', 'work/todo.md', 'a.md', 'Untitled.md']);
  expect(
    tabLabels([
      { name: 'todo.md', path: '/p/x/todo.md' },
      { name: 'todo.md', path: '/q/x/todo.md' },
    ]),
  ).toEqual(['p/x/todo.md', 'q/x/todo.md']);
});
