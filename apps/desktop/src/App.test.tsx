/** App-level tests for the empty shell, File > Open, cancel, non-UTF-8 errors and the web build. */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { editorView, select } from './testing/editor';
import { NotUtf8Error, type FileAccess, type OpenedDocument } from './platform/files';

// The live-preview decorations are built after mount; under full-suite load that can exceed waitFor's 1s default.
const LOAD_TIMEOUT = 10000;

function fakeFiles(pick: () => Promise<OpenedDocument | null>): FileAccess {
  return { pickDocument: pick, saveDocument: async (d) => ({ name: d.name, path: d.path }), saveDocumentAs: async (d) => ({ name: d.name, path: null }) };
}

async function openMenuItem() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /^Open…/ }));
}

test('shows the menu bar, the folder toggle (closed) and no editing controls', () => {
  render(<App files={fakeFiles(async () => null)} />);
  for (const name of ['File', 'Edit', 'View', 'Insert', 'Format', 'Help']) {
    expect(screen.getByRole('menuitem', { name })).toBeInTheDocument();
  }
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Folder navigator' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.queryByRole('complementary', { name: 'Folder navigator' })).not.toBeInTheDocument();
});

test('File > Open renders the file and names the tab', async () => {
  const doc: OpenedDocument = { name: 'notes.md', path: '/tmp/notes.md', text: '# Title\n\nHello **world**.\n' };
  render(<App files={fakeFiles(async () => doc)} />);
  await openMenuItem();
  await waitFor(
    () => {
      expect(screen.getByTestId('editor')).toHaveTextContent('Title');
      expect(screen.getByTestId('editor')).toHaveTextContent('Hello world.');
    },
    { timeout: LOAD_TIMEOUT },
  );
  expect(screen.getByRole('tab')).toHaveTextContent('notes.md');
});

test('cancelling the dialog changes nothing', async () => {
  render(<App files={fakeFiles(async () => null)} />);
  await openMenuItem();
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('a file that is not valid UTF-8 shows an error and is not opened', async () => {
  render(
    <App
      files={fakeFiles(async () => {
        throw new NotUtf8Error('bad.md');
      })}
    />,
  );
  await openMenuItem();
  expect(await screen.findByRole('alert')).toHaveTextContent('bad.md is not valid UTF-8');
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
});

test('an empty document renders without error', async () => {
  const doc: OpenedDocument = { name: 'empty.md', path: null, text: '' };
  render(<App files={fakeFiles(async () => doc)} />);
  await openMenuItem();
  await waitFor(
    () => {
      expect(screen.getByRole('tab')).toHaveTextContent('empty.md');
      expect(screen.getByTestId('editor')).toHaveTextContent('Click here to start writing.');
    },
    { timeout: LOAD_TIMEOUT },
  );
  expect(within(document.body).queryByRole('alert')).not.toBeInTheDocument();
});

describe('without the desktop runtime (web build)', () => {
  const DESKTOP_FILE_MENU = ['New', 'Open…', 'Open Folder…', 'Connect to Server…', 'Save', 'Save As…', 'Close Tab'];

  test('File menu lists every desktop item in order, Open Folder… and Connect to Server… enabled', async () => {
    const user = userEvent.setup();
    render(<App files={fakeFiles(async () => null)} />);
    await user.click(screen.getByRole('menuitem', { name: 'File' }));
    const items = await screen.findAllByRole('menuitem');
    const names = items.map((i) => (i.textContent ?? '').replace(/Ctrl\+.*$/, ''));
    expect(names.filter((n) => DESKTOP_FILE_MENU.includes(n))).toEqual(DESKTOP_FILE_MENU);
    expect(screen.getByRole('menuitem', { name: /Open Folder/ })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: /Connect to Server/ })).toBeEnabled();
  });

  test('File > Open Folder… shows the error banner and the app stays usable', async () => {
    const user = userEvent.setup();
    render(<App files={fakeFiles(async () => null)} />);
    await user.click(screen.getByRole('menuitem', { name: 'File' }));
    await user.click(await screen.findByRole('menuitem', { name: /Open Folder/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Opening a folder needs the desktop app.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New tab' }));
    expect(screen.getByRole('tab')).toBeInTheDocument();
  });

  test('the sidebar Open Folder… button shows the same error', async () => {
    const user = userEvent.setup();
    render(<App files={fakeFiles(async () => null)} />);
    await user.click(screen.getByRole('button', { name: 'Folder navigator' }));
    await user.click(await screen.findByRole('button', { name: 'Open Folder…' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Opening a folder needs the desktop app.');
  });
});

test('activating a tab focuses its editor', async () => {
  const user = userEvent.setup();
  render(<App files={fakeFiles(async () => null)} />);
  await user.click(screen.getByRole('button', { name: 'New tab' }));
  await user.click(screen.getByRole('button', { name: 'New tab' }));
  const [first] = screen.getAllByRole('tab');
  await user.click(first);
  await waitFor(() => expect(screen.getByTestId('editor').querySelector('.cm-content')).toHaveFocus(), { timeout: LOAD_TIMEOUT });
});

describe('editor focus', () => {
  const cm = () => screen.getByTestId('editor').querySelector('.cm-content');
  const focused = () => waitFor(() => expect(cm()).toHaveFocus(), { timeout: LOAD_TIMEOUT });
  const fileItem = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => {
    await user.click(screen.getByRole('menuitem', { name: 'File' }));
    await user.click(await screen.findByRole('menuitem', { name }));
  };
  const doc: OpenedDocument = { name: 'a.md', path: '/tmp/a.md', text: 'hello\n' };

  test('File > New from the empty state focuses the editor', async () => {
    const user = userEvent.setup();
    render(<App files={fakeFiles(async () => null)} />);
    await fileItem(user, /^New/);
    await focused();
  });

  test('File > Open from the empty state focuses the editor', async () => {
    const user = userEvent.setup();
    render(<App files={fakeFiles(async () => doc)} />);
    await fileItem(user, /^Open…/);
    await focused();
  });

  test('File > New and File > Open with documents open focus the new tab', async () => {
    const user = userEvent.setup();
    render(<App files={fakeFiles(async () => doc)} />);
    await fileItem(user, /^New/);
    await focused();
    await fileItem(user, /^New/);
    await focused();
    (document.activeElement as HTMLElement).blur();
    await fileItem(user, /^Open…/);
    await focused();
  });

  test('clicking the already-active tab focuses the editor', async () => {
    const user = userEvent.setup();
    render(<App files={fakeFiles(async () => null)} />);
    await user.click(screen.getByRole('button', { name: 'New tab' }));
    await focused();
    const tab = screen.getByRole('tab', { selected: true });
    tab.focus();
    expect(cm()).not.toHaveFocus();
    await user.click(tab);
    await focused();
  });

  test('closing the active tab focuses the editor of the tab that becomes active', async () => {
    const user = userEvent.setup();
    render(<App files={fakeFiles(async () => null)} />);
    await user.click(screen.getByRole('button', { name: 'New tab' }));
    await user.click(screen.getByRole('button', { name: 'New tab' }));
    await user.click(screen.getAllByRole('button', { name: /^Close/ })[1]);
    await focused();
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });
});

describe('table toolbar row', () => {
  test('is not shown with no file open', () => {
    render(<App files={fakeFiles(async () => null)} />);
    expect(screen.queryByRole('toolbar', { name: 'Table' })).not.toBeInTheDocument();
  });

  test('appears under the main toolbar while a table cell is targeted, and goes when the focus leaves the table', async () => {
    const user = userEvent.setup();
    render(<App files={fakeFiles(async () => null)} />);
    await user.click(screen.getByRole('button', { name: 'New tab' }));
    await user.click(await screen.findByRole('button', { name: 'Insert table' }, { timeout: LOAD_TIMEOUT }));
    const cell = await waitFor(() => {
      const td = screen.getByTestId('editor').querySelector<HTMLElement>('td');
      if (!td) throw new Error('no table yet');
      return td;
    }, { timeout: LOAD_TIMEOUT });
    cell.focus();
    const row = await screen.findByRole('toolbar', { name: 'Table' });
    expect(screen.getByRole('toolbar', { name: 'Editing' }).compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    screen.getByTestId('editor').querySelector<HTMLElement>('.cm-content')!.focus();
    // The caret may still lie in the table (the row then stays, by design): put it after the table.
    select(editorView().state.doc.length);
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Table' })).not.toBeInTheDocument());
  });
});

describe('Format menu', () => {
  const run = async (user: ReturnType<typeof userEvent.setup>, how: 'menu' | 'toolbar') => {
    if (how === 'toolbar') return user.click(await screen.findByRole('button', { name: 'Insert table' }, { timeout: LOAD_TIMEOUT }));
    await user.click(screen.getByRole('menuitem', { name: 'Format' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Table' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Insert table' }));
  };

  test.each(['menu', 'toolbar'] as const)('inserting a table from the %s leaves a blank line and the caret below it', async (how) => {
    const user = userEvent.setup();
    render(<App files={fakeFiles(async () => null)} />);
    await user.click(screen.getByRole('button', { name: 'New tab' }));
    await run(user, how);
    await waitFor(() => expect(editorView().state.doc.toString()).toContain('| Cell | Cell |'), { timeout: LOAD_TIMEOUT });
    const doc = editorView().state.doc.toString();
    expect(doc.endsWith('| Cell | Cell |\n\n')).toBe(true);
    expect(editorView().state.selection.main.head).toBe(doc.length);
  }, 20000);

  test('the Table sub-menu acts on the focused table cell', async () => {
    const user = userEvent.setup();
    render(<App files={fakeFiles(async () => null)} />);
    await user.click(screen.getByRole('button', { name: 'New tab' }));
    await run(user, 'toolbar');
    const cell = await waitFor(() => {
      const td = screen.getByTestId('editor').querySelector<HTMLElement>('td');
      if (!td) throw new Error('no table yet');
      return td;
    }, { timeout: LOAD_TIMEOUT });
    cell.focus();
    await screen.findByRole('toolbar', { name: 'Table' });
    await user.click(screen.getByRole('menuitem', { name: 'Format' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Table' }));
    expect(await screen.findByRole('menuitem', { name: 'Insert row below' })).not.toHaveAttribute('data-disabled');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Insert row below' }));
    await waitFor(() => expect(screen.getByTestId('editor').querySelectorAll('tbody tr')).toHaveLength(2));
  });
});
