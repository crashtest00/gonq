import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import { caretIn } from '../testing/inplace';
import App from '../App';
import { FolderSidebar, ROW_CHUNK, relativeTime } from './FolderSidebar';
import type { FileAccess, OpenedDocument } from '../platform/files';
import { RECENTS_KEY } from '../platform/recents';

vi.setConfig({ testTimeout: 30000 });

const listDirectory = vi.fn();
const pathExists = vi.fn(async (_p: string) => true);
vi.mock('../platform/folders', async (orig) => ({
  ...(await orig<typeof import('../platform/folders')>()),
  listDirectory: (p: string) => listDirectory(p),
  pathExists: (p: string) => pathExists(p),
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  listDirectory.mockReset();
  pathExists.mockReset();
  pathExists.mockResolvedValue(true);
});

const noop = () => {};
const props = { supported: true, folder: null, recents: [], currentPath: null, onOpenFolder: noop, onOpenFile: noop, onOpenRecent: noop, onRemoveRecent: noop };

test('relativeTime buckets', () => {
  const now = 1_000_000_000;
  expect(relativeTime(now - 5_000, now)).toBe('just now');
  expect(relativeTime(now - 5 * 60_000, now)).toBe('5 min ago');
  expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 h ago');
  expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2 d ago');
});

test('empty state offers Open Folder and shows no recents', async () => {
  const onOpenFolder = vi.fn();
  render(<FolderSidebar {...props} onOpenFolder={onOpenFolder} />);
  await userEvent.click(screen.getByRole('button', { name: 'Open Folder…' }));
  expect(onOpenFolder).toHaveBeenCalled();
  expect(screen.getByText('No recent documents.')).toBeInTheDocument();
});

test('web explains that folders need the desktop app', () => {
  render(<FolderSidebar {...props} supported={false} />);
  expect(screen.getByText(/desktop app/)).toBeInTheDocument();
});

test('lists the folder lazily and opens a file', async () => {
  listDirectory.mockImplementation(async (p: string) =>
    p === '/proj'
      ? [{ name: 'docs', path: '/proj/docs', isDir: true }, { name: 'a.md', path: '/proj/a.md', isDir: false }]
      : [{ name: 'b.md', path: '/proj/docs/b.md', isDir: false }],
  );
  const onOpenFile = vi.fn();
  const user = userEvent.setup();
  render(<FolderSidebar {...props} folder="/proj" onOpenFile={onOpenFile} />);
  await screen.findByText('a.md');
  expect(listDirectory).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: /docs/ }));
  await user.click(await screen.findByText('b.md'));
  expect(onOpenFile).toHaveBeenCalledWith('/proj/docs/b.md');
});

test('a listing error shows as an alert', async () => {
  listDirectory.mockRejectedValue(new Error('Permission denied'));
  render(<FolderSidebar {...props} folder="/proj" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Permission denied');
});

test('sections collapse', async () => {
  const user = userEvent.setup();
  render(<FolderSidebar {...props} />);
  await user.click(screen.getByRole('button', { name: 'Recent documents' }));
  expect(screen.queryByText('No recent documents.')).toBeNull();
});

test('recents show name and time, open and remove', async () => {
  const onOpenRecent = vi.fn();
  const onRemoveRecent = vi.fn();
  const user = userEvent.setup();
  render(<FolderSidebar {...props} recents={[{ path: '/x/notes.md', openedAt: Date.now() - 120_000 }]} onOpenRecent={onOpenRecent} onRemoveRecent={onRemoveRecent} />);
  expect(screen.getByText('2 min ago')).toBeInTheDocument();
  await user.click(screen.getByText('notes.md'));
  expect(onOpenRecent).toHaveBeenCalledWith('/x/notes.md');
  await user.click(screen.getByRole('button', { name: /Remove notes.md/ }));
  expect(onRemoveRecent).toHaveBeenCalledWith('/x/notes.md');
});

const doc: OpenedDocument = { name: 'n.md', path: '/n.md', text: '# T\n' };
const files: FileAccess = {
  pickDocument: async () => doc,
  openPath: async (path) => ({ name: 'r.md', path, text: '# Recent doc\n' }),
  loadImage: async () => null,
  saveDocument: async (d) => ({ name: d.name, path: d.path }),
  saveDocumentAs: async (d) => ({ name: d.name, path: null }),
};

test('App: toggle swaps with the outline; opening a file records it and recents open it', async () => {
  listDirectory.mockResolvedValue([]);
  localStorage.setItem(RECENTS_KEY, JSON.stringify([{ path: '/r.md', openedAt: Date.now() - 1000 }]));
  const user = userEvent.setup();
  render(<App files={files} />);
  await user.click(screen.getByRole('button', { name: 'Folder navigator' }));
  expect(screen.getByRole('complementary', { name: 'Folder navigator' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Document outline' }));
  expect(screen.queryByRole('complementary', { name: 'Folder navigator' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Document outline' }));

  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /Open…/ }));
  await screen.findByTestId('markdown-view');
  await waitFor(() => expect(JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]')[0].path).toBe('/n.md'));

  await user.click(screen.getByRole('button', { name: 'Folder navigator' }));
  await user.click(await within(screen.getByRole('complementary', { name: 'Folder navigator' })).findByText('r.md'));
  expect(await screen.findByText('Recent doc')).toBeInTheDocument();
});

const side = () => within(screen.getByRole('complementary', { name: 'Folder navigator' }));
const editorBox = () => screen.getByRole('textbox', { name: /Markdown source/ });

async function openFileMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /Open…/ }));
  await screen.findByTestId('markdown-view');
}

test('renders folders before files, in the order listed', async () => {
  listDirectory.mockResolvedValue([
    { name: 'alpha', path: '/p/alpha', isDir: true },
    { name: 'Zeta', path: '/p/Zeta', isDir: true },
    { name: 'a.md', path: '/p/a.md', isDir: false },
    { name: 'B.md', path: '/p/B.md', isDir: false },
  ]);
  render(<FolderSidebar {...props} folder="/p" />);
  await screen.findByText('a.md');
  const labels = screen.getAllByRole('listitem').map((li) => li.textContent);
  expect(labels).toEqual(['alpha', 'Zeta', 'a.md', 'B.md']);
});

test('the Project folder section collapses and expands', async () => {
  listDirectory.mockResolvedValue([{ name: 'a.md', path: '/p/a.md', isDir: false }]);
  const user = userEvent.setup();
  render(<FolderSidebar {...props} folder="/p" />);
  await screen.findByText('a.md');
  await user.click(screen.getByRole('button', { name: 'Project folder' }));
  expect(screen.queryByText('a.md')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Project folder' }));
  expect(await screen.findByText('a.md')).toBeInTheDocument();
});

test('recents are shown in the given order, newest first', () => {
  const now = Date.now();
  render(
    <FolderSidebar
      {...props}
      recents={[
        { path: '/x/newest.md', openedAt: now },
        { path: '/x/middle.md', openedAt: now - 3_600_000 },
        { path: '/x/oldest.md', openedAt: now - 2 * 86_400_000 },
      ]}
    />,
  );
  const names = screen.getAllByRole('listitem').map((li) => li.querySelector('span')?.textContent);
  expect(names).toEqual(['newest.md', 'middle.md', 'oldest.md']);
});

test('a large folder renders a bounded number of rows and reveals more on request', async () => {
  const many = Array.from({ length: 2000 }, (_, i) => ({ name: `f${String(i).padStart(4, '0')}.md`, path: `/big/f${i}.md`, isDir: false }));
  listDirectory.mockResolvedValue(many);
  const user = userEvent.setup();
  render(<FolderSidebar {...props} folder="/big" />);
  await screen.findByText('f0000.md');
  expect(screen.getAllByRole('listitem').length).toBeLessThanOrEqual(ROW_CHUNK + 1);
  expect(screen.queryByText('f1999.md')).toBeNull();
  await user.click(screen.getByRole('button', { name: /Show more \(1800 more\)/ }));
  expect(screen.getAllByRole('listitem').length).toBeLessThanOrEqual(2 * ROW_CHUNK + 1);
});

test('App: an untitled document with no folder says "No folder open"', async () => {
  const user = userEvent.setup();
  render(<App files={files} />);
  await user.click(screen.getByRole('button', { name: 'Folder navigator' }));
  expect(side().getByText('No folder open')).toBeInTheDocument();
});

test('App: the Project folder follows the opened document\'s parent folder', async () => {
  listDirectory.mockResolvedValue([{ name: 'n.md', path: '/docs/n.md', isDir: false }]);
  const user = userEvent.setup();
  render(<App files={{ ...files, pickDocument: async () => ({ name: 'n.md', path: '/docs/n.md', text: '# T\n' }) }} />);
  await user.click(screen.getByRole('button', { name: 'Folder navigator' }));
  await openFileMenu(user);
  await waitFor(() => expect(listDirectory).toHaveBeenCalledWith('/docs'));
  expect(side().queryByText('No folder open')).toBeNull();
  expect(side().getByTitle('/docs')).toHaveTextContent('docs');
});

test('App: both toggles off hides the sidebar', async () => {
  const user = userEvent.setup();
  render(<App files={files} />);
  const toggle = screen.getByRole('button', { name: 'Folder navigator' });
  await user.click(toggle);
  expect(screen.getByRole('complementary', { name: 'Folder navigator' })).toBeInTheDocument();
  await user.click(toggle);
  expect(screen.queryByRole('complementary', { name: 'Folder navigator' })).toBeNull();
  expect(screen.queryByRole('complementary', { name: /outline/i })).toBeNull();
});

test('App: a missing recent shows an error and is removed', async () => {
  localStorage.setItem(RECENTS_KEY, JSON.stringify([{ path: '/gone.md', openedAt: Date.now() }]));
  pathExists.mockResolvedValue(false);
  const user = userEvent.setup();
  render(<App files={files} />);
  await user.click(screen.getByRole('button', { name: 'Folder navigator' }));
  await user.click(await side().findByText('gone.md'));
  expect(await screen.findByText(/no longer exists/)).toBeInTheDocument();
  await waitFor(() => expect(side().queryByText('gone.md')).toBeNull());
  expect(JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]')).toEqual([]);
});

describe('opening from the folder pane uses tabs', () => {
  const opened = vi.fn();
  const f: FileAccess = {
    ...files,
    pickDocument: async () => ({ name: 'n.md', path: '/docs/n.md', text: 'first para\n\nlast paragraph' }),
    openPath: async (path) => {
      opened(path);
      return { name: 'other.md', path, text: 'Other doc text\n' };
    },
  };

  async function dirtyThen(click: 'folder' | 'recent') {
    listDirectory.mockResolvedValue([{ name: 'other.md', path: '/docs/other.md', isDir: false }]);
    localStorage.setItem(RECENTS_KEY, JSON.stringify([{ path: '/r/rec.md', openedAt: Date.now() }]));
    opened.mockClear();
    const user = userEvent.setup();
    render(<App files={f} />);
    await user.click(screen.getByRole('button', { name: 'Folder navigator' }));
    await openFileMenu(user);
    await user.click(screen.getByText('last paragraph'));
    await caretIn(screen.getByText('last paragraph'));
    await user.keyboard('!');
    await user.keyboard('{Escape}');
    await user.click(click === 'folder' ? await side().findByText('other.md') : side().getByText('rec.md'));
    return { user };
  }

  test.each(['folder', 'recent'] as const)('%s click: opens a new tab without asking; the dirty tab is kept', async (kind) => {
    const { user } = await dirtyThen(kind);
    expect(await screen.findByText('Other doc text')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    await user.click(screen.getByRole('tab', { name: /n\.md/ }));
    expect(screen.getByText('last paragraph!')).toBeInTheDocument();
  });

  test('clicking a file that is already open switches to its tab', async () => {
    const { user } = await dirtyThen('folder');
    await screen.findByText('Other doc text');
    await user.click(screen.getByRole('tab', { name: /n\.md/ }));
    await user.click((await side().findAllByText('other.md'))[0]);
    expect(opened).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByText('Other doc text')).toBeInTheDocument();
  });
});
