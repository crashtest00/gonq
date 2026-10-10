import { vi } from 'vitest';

let tauri = true;
const invoke = vi.fn();
const open = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...a: unknown[]) => open(...a) }));
vi.mock('./files', () => ({ isTauri: () => tauri }));

import { ListDirectoryError, listDirectory, pathExists, pickFolder } from './folders';

beforeEach(() => {
  tauri = true;
  invoke.mockReset();
  open.mockReset();
});

describe('pickFolder', () => {
  it('returns the chosen path and asks for a recursive folder grant', async () => {
    open.mockResolvedValue('/docs');
    expect(await pickFolder()).toBe('/docs');
    expect(open).toHaveBeenCalledWith({ directory: true, multiple: false, recursive: true });
  });
  it('returns null on cancel', async () => {
    open.mockResolvedValue(null);
    expect(await pickFolder()).toBeNull();
  });
  it('rejects with the desktop-app message on the web, without opening a dialog', async () => {
    tauri = false;
    await expect(pickFolder()).rejects.toThrow('Opening a folder needs the desktop app.');
    expect(open).not.toHaveBeenCalled();
  });
});

describe('listDirectory', () => {
  it('maps rows to camelCase', async () => {
    invoke.mockResolvedValue([{ name: 'a', path: '/a', is_dir: true }]);
    expect(await listDirectory('/')).toEqual([{ name: 'a', path: '/a', isDir: true }]);
    expect(invoke).toHaveBeenCalledWith('list_directory', { path: '/' });
  });
  it('turns the typed backend error into ListDirectoryError', async () => {
    invoke.mockRejectedValue({ kind: 'not_found', message: '/gone' });
    await expect(listDirectory('/gone')).rejects.toMatchObject({ name: 'ListDirectoryError', kind: 'not_found', message: '/gone' });
  });
  it('rejects as unsupported on the web', async () => {
    tauri = false;
    await expect(listDirectory('/')).rejects.toBeInstanceOf(ListDirectoryError);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('pathExists', () => {
  it('asks the backend', async () => {
    invoke.mockResolvedValue(false);
    expect(await pathExists('/x.md')).toBe(false);
  });
  it('is true on the web', async () => {
    tauri = false;
    expect(await pathExists('/x.md')).toBe(true);
  });
});
