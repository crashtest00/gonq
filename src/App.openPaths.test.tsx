/** App tests for paths the OS hands to Gonq: queued and live launch paths open in tabs, dedupe, and errors. */
import { act, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { NotUtf8Error, type FileAccess, type OpenedDocument } from './platform/files';

const LOAD_TIMEOUT = 10000;

let pending: string[] = [];
let gate: Promise<void> = Promise.resolve();
let emit: (paths: string[]) => void = () => {};
vi.mock('./platform/openPaths', () => ({
  takePendingOpenPaths: async () => {
    await gate;
    const p = pending;
    pending = [];
    return p;
  },
  listenOpenPaths: (cb: (paths: string[]) => void) => {
    emit = cb;
    return () => {};
  },
}));

const disk: Record<string, string> = {};
const reads: string[] = [];
function fakeFiles(): FileAccess {
  return {
    pickDocument: async () => null,
    saveDocument: async (d) => ({ name: d.name, path: d.path }),
    saveDocumentAs: async (d) => ({ name: d.name, path: null }),
    async openPath(path): Promise<OpenedDocument> {
      reads.push(path);
      if (path.includes('bad-utf8')) throw new NotUtf8Error('bad-utf8.md');
      if (!(path in disk)) throw new Error(`${path}: No such file or directory`);
      return { name: path.split('/').pop() ?? path, path, text: disk[path] };
    },
  };
}

beforeEach(() => {
  pending = [];
  gate = Promise.resolve();
  reads.length = 0;
  emit = () => {};
  for (const k of Object.keys(disk)) delete disk[k];
  Object.assign(disk, {
    '/d/a.md': '# A\n',
    '/d/b.markdown': '# B\n',
    '/d/my notes/café ☕.md': '# Café\n',
    '/d/notes.txt': 'x',
  });
});

const tabs = () => screen.queryAllByRole('tab');

test('paths queued before the app was ready open in order, each in its own tab', async () => {
  pending = ['/d/a.md', '/d/b.markdown'];
  render(<App files={fakeFiles()} />);
  await waitFor(() => expect(tabs()).toHaveLength(2), { timeout: LOAD_TIMEOUT });
  expect(tabs()[0]).toHaveTextContent('a.md');
  expect(tabs()[1]).toHaveTextContent('b.markdown');
  expect(tabs()[1]).toHaveAttribute('aria-selected', 'true');
});

test('a path delivered while running opens in a new tab', async () => {
  render(<App files={fakeFiles()} />);
  await waitFor(() => expect(emit).not.toBe(undefined));
  await act(async () => emit(['/d/a.md']));
  await waitFor(() => expect(tabs()).toHaveLength(1), { timeout: LOAD_TIMEOUT });
  await act(async () => emit(['/d/b.markdown']));
  await waitFor(() => expect(tabs()).toHaveLength(2), { timeout: LOAD_TIMEOUT });
  expect(tabs()[1]).toHaveAttribute('aria-selected', 'true');
});

test('an already open path activates its tab; a repeat in one launch opens once', async () => {
  pending = ['/d/a.md', '/d/b.markdown', '/d/a.md', '/d/a.md'];
  render(<App files={fakeFiles()} />);
  await waitFor(() => expect(tabs()).toHaveLength(2), { timeout: LOAD_TIMEOUT });
  expect(reads).toEqual(['/d/a.md', '/d/b.markdown']);
  expect(tabs()[0]).toHaveAttribute('aria-selected', 'true');
  await act(async () => emit(['/d/b.markdown']));
  await waitFor(() => expect(tabs()[1]).toHaveAttribute('aria-selected', 'true'));
  expect(tabs()).toHaveLength(2);
});

test('spaces and non-ASCII characters in a path are kept', async () => {
  pending = ['/d/my notes/café ☕.md'];
  render(<App files={fakeFiles()} />);
  await waitFor(() => expect(tabs()).toHaveLength(1), { timeout: LOAD_TIMEOUT });
  expect(tabs()[0]).toHaveTextContent('café ☕.md');
});

test('a missing file shows an error and opens no tab', async () => {
  pending = ['/d/missing.md'];
  render(<App files={fakeFiles()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('/d/missing.md');
  expect(tabs()).toHaveLength(0);
});

test('a file that cannot be read as text shows an error and opens no tab', async () => {
  pending = ['/d/bad-utf8.md'];
  render(<App files={fakeFiles()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('not valid UTF-8');
  expect(tabs()).toHaveLength(0);
});

test('a non-Markdown file is rejected without being read', async () => {
  pending = ['/d/notes.txt'];
  render(<App files={fakeFiles()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('/d/notes.txt is not a Markdown file');
  expect(reads).toEqual([]);
  expect(tabs()).toHaveLength(0);
});

test('one bad path does not stop the others, and its error stays visible', async () => {
  pending = ['/d/notes.txt', '/d/a.md', '/d/missing.md', '/d/b.markdown'];
  render(<App files={fakeFiles()} />);
  await waitFor(() => expect(tabs()).toHaveLength(2), { timeout: LOAD_TIMEOUT });
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('notes.txt is not a Markdown file');
  expect(alert).toHaveTextContent('missing.md');
});

test('a path that arrives before the queued ones are fetched is opened after them, none lost', async () => {
  let release: () => void = () => {};
  gate = new Promise((r) => (release = r));
  pending = ['/d/a.md'];
  render(<App files={fakeFiles()} />);
  await act(async () => emit(['/d/b.markdown']));
  expect(tabs()).toHaveLength(0);
  await act(async () => release());
  await waitFor(() => expect(tabs()).toHaveLength(2), { timeout: LOAD_TIMEOUT });
  expect(reads).toEqual(['/d/a.md', '/d/b.markdown']);
});
