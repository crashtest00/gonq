/** local:// routing in files.ts, folders.ts, images.ts and recents.ts against the fake gonq-saf plugin (mobile app), plus desktop and browser. */
import { vi } from 'vitest';
import { fakeSafPlugin } from '../testing/mockBindings';

const saf = fakeSafPlugin();
let recents: { path: string; opened_at: number }[] = [];
const handler = (cmd: string, args?: Record<string, unknown>): unknown => {
  if (cmd === 'recent_documents_list') return recents;
  if (cmd === 'recent_documents_add') {
    recents = [{ path: String(args!.path), opened_at: 1 }, ...recents.filter((r) => r.path !== args!.path)];
    return recents;
  }
  if (cmd === 'recent_documents_remove') {
    recents = recents.filter((r) => r.path !== args!.path);
    return recents;
  }
  return undefined;
};
const invoke = vi.fn(handler);
vi.mock('./bindings', async () => (await import('../testing/mockBindings')).bindingsMock((...a: [string, Record<string, unknown>?]) => invoke(...a)));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string, args?: Record<string, unknown>) => saf.invoke(cmd, args) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
const readFile = vi.fn();
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: (...a: unknown[]) => readFile(...a), writeTextFile: vi.fn(), stat: vi.fn() }));

vi.hoisted(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});

import { RemoteConflictError } from './remote';
import { files } from './files';
import { listDirectory, ListDirectoryError, pathExists } from './folders';
import { MAX_LOCAL_IMAGE_BYTES, clearImageCache, loadImage, resolveImagePath } from './images';
import { localPath } from './local';
import { addRecent, listRecents } from './recents';

const TREE = 'content://com.android.externalstorage.documents/tree/primary%3ANotes';
const p = (rel: string) => localPath({ tree: TREE, rel });
const GH = 'github://o/r@main/README.md';

beforeEach(() => {
  vi.stubGlobal('__GONQ_APP__', 'mobile');
  saf.calls.length = 0;
  saf.granted.clear();
  recents = [];
  invoke.mockReset();
  invoke.mockImplementation(handler);
  readFile.mockReset();
  URL.revokeObjectURL = vi.fn();
  clearImageCache();
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  saf.addTree(TREE, { 'a.md': 'alpha', 'drafts/b.md': 'bee', 'drafts/pic.png': new Uint8Array([137, 80, 78, 71]), 'top.png': new Uint8Array([1]) });
});
afterEach(() => vi.unstubAllGlobals());

describe('files.openPath / saveDocument', () => {
  it('opens a local:// file with its name, text and stat, never touching tauri-plugin-fs', async () => {
    const doc = await files.openPath!(p('drafts/b.md'));
    expect(doc).toMatchObject({ name: 'b.md', path: p('drafts/b.md'), text: 'bee', local: { size: 3 } });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('saves in place and returns the new stat', async () => {
    const doc = await files.openPath!(p('a.md'));
    const saved = await files.saveDocument({ name: doc.name, path: doc.path, text: 'alpha 2', local: doc.local });
    expect(saved).toMatchObject({ name: 'a.md', path: p('a.md'), local: { size: 7 } });
    expect(saf.text(TREE, 'a.md')).toBe('alpha 2');
  });

  it('a changed file raises the SSH conflict error; force overwrites', async () => {
    const doc = await files.openPath!(p('a.md'));
    saf.tick();
    saf.put(TREE, 'a.md', 'changed outside');
    const save = (force?: boolean) => files.saveDocument({ name: 'a.md', path: doc.path, text: 'mine', local: doc.local }, undefined, { force });
    await expect(save()).rejects.toBeInstanceOf(RemoteConflictError);
    expect(saf.text(TREE, 'a.md')).toBe('changed outside');
    await save(true);
    expect(saf.text(TREE, 'a.md')).toBe('mine');
  });

  it('reopening a recent whose grant was revoked removes it and throws the platform text', async () => {
    await addRecent(p('a.md'));
    saf.revoke(TREE);
    await expect(files.openPath!(p('a.md'))).rejects.toMatchObject({ kind: 'permission', message: expect.stringContaining('Access to this folder was removed') });
    expect(recents).toEqual([]);
  });

  it('reopening a recent whose folder is gone removes it too', async () => {
    await addRecent(p('a.md'));
    saf.vanish(TREE);
    await expect(files.openPath!(p('a.md'))).rejects.toMatchObject({ kind: 'not-found' });
    expect(recents).toEqual([]);
  });

  it('a missing file in a healthy tree keeps the recent', async () => {
    await addRecent(p('gone.md'));
    await expect(files.openPath!(p('gone.md'))).rejects.toMatchObject({ kind: 'not-found' });
    expect(recents).toHaveLength(1);
  });

  it('still routes github:// by its prefix', async () => {
    invoke.mockImplementation(() => Promise.reject({ kind: 'not_signed_in' }));
    await expect(files.openPath!(GH)).rejects.toMatchObject({ kind: 'not_signed_in' });
    expect(saf.calls).toEqual([]);
  });
});

describe('folders', () => {
  it('lists a local:// folder as FolderEntry rows whose paths are local:// strings', async () => {
    const rows = await listDirectory(p(''));
    expect(rows).toEqual([
      { name: 'drafts', path: p('drafts'), isDir: true },
      { name: 'a.md', path: p('a.md'), isDir: false },
    ]);
    expect(await listDirectory(p('drafts'))).toEqual([{ name: 'b.md', path: p('drafts/b.md'), isDir: false }]);
  });

  it('maps plugin errors to ListDirectoryError kinds', async () => {
    saf.vanish(TREE);
    await expect(listDirectory(p(''))).rejects.toMatchObject({ kind: 'not_found' });
    saf.addTree(TREE, {});
    saf.revoke(TREE);
    const e = await listDirectory(p('')).catch((x) => x);
    expect(e).toBeInstanceOf(ListDirectoryError);
    expect(e.kind).toBe('permission_denied');
    saf.addTree(TREE, {});
    await expect(listDirectory(`local://${encodeURIComponent(TREE)}/..`)).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('pathExists asks the plugin', async () => {
    expect(await pathExists(p('a.md'))).toBe(true);
    expect(await pathExists(p('nope.md'))).toBe(false);
  });

  it('is a clear unsupported error on the desktop app', async () => {
    vi.stubGlobal('__GONQ_APP__', undefined);
    await expect(listDirectory(p(''))).rejects.toMatchObject({ kind: 'unsupported', message: expect.stringContaining('Android') });
    expect(saf.calls).toEqual([]);
  });
});

describe('images', () => {
  const doc = p('drafts/b.md');

  it('resolves a relative picture inside the tree', () => {
    expect(resolveImagePath('pic.png', doc)).toBe(p('drafts/pic.png'));
    expect(resolveImagePath('../top.png', doc)).toBe(p('top.png'));
    expect(resolveImagePath('./sub/../pic%20x.png?v=1#h', doc)).toBe(p('drafts/pic x.png'));
  });

  it('refuses `..` above the root, and absolute paths', () => {
    expect(() => resolveImagePath('../../x.png', doc)).toThrow('That is outside the opened folder.');
    expect(() => resolveImagePath('../x.png', p('a.md'))).toThrow('That is outside the opened folder.');
    expect(() => resolveImagePath('/etc/x.png', doc)).toThrow('outside the opened folder');
    expect(() => resolveImagePath('C:\\x.png', doc)).toThrow('outside the opened folder');
  });

  it('desktop paths resolve as before', () => {
    expect(resolveImagePath('../x.png', '/home/me/a/b.md')).toBe('/home/me/x.png');
    expect(resolveImagePath('x.png', 'ssh://me@nas/home/b.md')).toBe('ssh://me@nas/home/x.png');
  });

  it('loads the bytes through the plugin into a blob URL', async () => {
    const blob = vi.fn(() => 'blob:pic');
    URL.createObjectURL = blob;
    expect(await loadImage('pic.png', doc)).toBe('blob:pic');
    const made = (blob.mock.calls[0] as unknown as [Blob])[0];
    expect(made.type).toBe('image/png');
    expect(made.size).toBe(4);
    expect(readFile).not.toHaveBeenCalled();
  });

  it('rejects a climbing picture with the outside message and reads nothing', async () => {
    await expect(loadImage('../../x.png', doc)).rejects.toThrow('That is outside the opened folder.');
    expect(saf.calls).toEqual([]);
  });

  it('refuses a picture over the local limit before reading it', async () => {
    saf.put(TREE, 'drafts/big.png', new Uint8Array(MAX_LOCAL_IMAGE_BYTES + 1));
    await expect(loadImage('big.png', doc)).rejects.toThrow(/MB/);
    expect(saf.calls.map((c) => c[0])).not.toContain('local_read');
  });
});

describe('recents', () => {
  it('keeps local:// and github:// side by side on mobile', async () => {
    await addRecent(GH);
    await addRecent(p('a.md'));
    expect((await listRecents()).map((r) => r.path)).toEqual([p('a.md'), GH]);
  });

  it('desktop hides local:// entries (it never writes them)', async () => {
    recents = [
      { path: p('a.md'), opened_at: 2 },
      { path: '/home/me/a.md', opened_at: 1 },
    ];
    vi.stubGlobal('__GONQ_APP__', undefined);
    expect((await listRecents()).map((r) => r.path)).toEqual(['/home/me/a.md']);
  });

  it('the browser fallback hides local:// entries like ssh://', async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    try {
      localStorage.setItem(
        'gonq.recentDocuments',
        JSON.stringify([
          { path: p('a.md'), openedAt: 3 },
          { path: 'ssh://me@nas/a.md', openedAt: 2 },
          { path: GH, openedAt: 1 },
        ]),
      );
      vi.resetModules();
      const fresh = await import('./recents');
      expect((await fresh.listRecents()).map((r) => r.path)).toEqual([GH]);
    } finally {
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
      localStorage.clear();
    }
  });
});
