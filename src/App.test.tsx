import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
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
