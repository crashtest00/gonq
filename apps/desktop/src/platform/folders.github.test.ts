/** folders.ts routing of github:// paths to github.ts: listing, truncated flag, error kinds, web error. */
import { vi } from 'vitest';

let tauri = true;
const invoke = vi.fn();
vi.mock('./bindings', async () => (await import('../testing/mockBindings')).bindingsMock((...a: [string, Record<string, unknown>?]) => invoke(...a)));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('./files', () => ({ isTauri: () => tauri }));
vi.mock('./tauri', () => ({ isTauri: () => tauri }));

import { ListDirectoryError, listDirectory, listFolderPage, pathExists } from './folders';

beforeEach(() => {
  tauri = true;
  invoke.mockReset();
});

it('lists a repository folder through github_list_folder with the decoded branch and path', async () => {
  invoke.mockResolvedValue({
    entries: [
      { name: 'ü docs', path: 'sub/ü docs', kind: 'folder' },
      { name: 'a.md', path: 'sub/a.md', kind: 'file' },
    ],
    truncated: false,
  });
  const rows = await listDirectory('github://o/r@feat%2Fü/sub');
  expect(invoke).toHaveBeenCalledWith('github_list_folder', { owner: 'o', repo: 'r', branch: 'feat/ü', path: 'sub' });
  expect(rows).toEqual([
    { name: 'ü docs', path: 'github://o/r@feat%2F%C3%BC/sub/%C3%BC%20docs', isDir: true },
    { name: 'a.md', path: 'github://o/r@feat%2F%C3%BC/sub/a.md', isDir: false },
  ]);
  expect(invoke).not.toHaveBeenCalledWith('list_directory', expect.anything());
});

it('reports truncation', async () => {
  invoke.mockResolvedValue({ entries: [], truncated: true });
  expect((await listFolderPage('github://o/r@main')).truncated).toBe(true);
});

it('turns a GitHub failure into a ListDirectoryError of the same kind, with the reset time', async () => {
  invoke.mockRejectedValue({ kind: 'rate_limited', reset_at: 123, message: 'limit' });
  const err = await listDirectory('github://o/r@main').catch((e) => e);
  expect(err).toBeInstanceOf(ListDirectoryError);
  expect(err).toMatchObject({ kind: 'rate_limited', resetAt: 123 });
});

it('rejects a malformed github path', async () => {
  await expect(listDirectory('github://nope')).rejects.toMatchObject({ kind: 'not_found' });
});

it('throws the clear desktop-app error on the web', async () => {
  tauri = false;
  await expect(listDirectory('github://o/r@main')).rejects.toMatchObject({ kind: 'unavailable_on_web', message: 'Signing in to GitHub needs the Gonq desktop app' });
  expect(invoke).not.toHaveBeenCalled();
});

it('pathExists is true for github paths without a native call', async () => {
  expect(await pathExists('github://o/r@main/a.md')).toBe(true);
  expect(invoke).not.toHaveBeenCalled();
});
