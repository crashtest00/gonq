import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import App from '../App';
import { FolderSidebar, relativeTime } from './FolderSidebar';
import type { FileAccess, OpenedDocument } from '../platform/files';
import { RECENTS_KEY } from '../platform/recents';

vi.setConfig({ testTimeout: 30000 });

const listDirectory = vi.fn();
vi.mock('../platform/folders', async (orig) => ({
  ...(await orig<typeof import('../platform/folders')>()),
  listDirectory: (p: string) => listDirectory(p),
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  listDirectory.mockReset();
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
  await user.click(within(screen.getByRole('complementary', { name: 'Folder navigator' })).getByText('n.md'));
  expect(await screen.findByText('Recent doc')).toBeInTheDocument();
});
