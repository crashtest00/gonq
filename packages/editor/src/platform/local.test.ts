/** local.ts: the local:// path format, the plugin wrappers against the fake plugin, error mapping, the conflict path, desktop/web errors. */
import { vi } from 'vitest';
import { fakeSafPlugin } from '../testing/mockBindings';

const saf = fakeSafPlugin();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string, args?: Record<string, unknown>) => saf.invoke(cmd, args) }));

import { RemoteConflictError } from './remote';
import {
  LocalFileError,
  checkLocalRoot,
  createLocal,
  createLocalDocument,
  existsLocal,
  grantedTrees,
  isLocalPath,
  listLocalFolder,
  localFileName,
  localPath,
  parseLocalPath,
  pickLocalFolder,
  readLocal,
  statLocal,
  toLocalError,
  writeLocal,
} from './local';

const TREE = 'content://com.android.externalstorage.documents/tree/primary%3ANotes';
const at = (rel: string) => ({ tree: TREE, rel });

function mobile() {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  vi.stubGlobal('__GONQ_APP__', 'mobile');
}

beforeEach(() => {
  mobile();
  saf.calls.length = 0;
  saf.granted.clear();
  saf.nextPick = null;
  saf.nextDocument = null;
  saf.addTree(TREE, {
    'a.md': 'alpha',
    'Zed.md': 'z',
    'b.markdown': 'b',
    'notes.txt': 'no',
    '.hidden.md': 'h',
    '.git/': '',
    'drafts/x.md': 'x',
    'Apple/': '',
    'img/pic.png': new Uint8Array([0, 255, 128, 10, 13]),
  });
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.unstubAllGlobals();
});

describe('local:// paths', () => {
  it('round-trips a handle, encoding the tree and every segment', () => {
    const h = { tree: TREE, rel: 'my notes/100% a@b.md' };
    const p = localPath(h);
    expect(p).toBe(`local://${encodeURIComponent(TREE)}/my%20notes/100%25%20a%40b.md`);
    expect(parseLocalPath(p)).toEqual(h);
    expect(isLocalPath(p)).toBe(true);
    expect(localFileName(p)).toBe('100% a@b.md');
  });
  it('writes the tree root without a trailing slash and parses it back', () => {
    expect(localPath(at(''))).toBe(`local://${encodeURIComponent(TREE)}`);
    expect(parseLocalPath(localPath(at('')))).toEqual(at(''));
  });
  it('refuses malformed paths and dot segments', () => {
    expect(parseLocalPath('local://')).toBeNull();
    expect(parseLocalPath('github://o/r@b')).toBeNull();
    expect(parseLocalPath(`local://${encodeURIComponent(TREE)}/%2E%2E/x.md`)).toBeNull();
    expect(parseLocalPath(`local://${encodeURIComponent(TREE)}/../x.md`)).toBeNull();
    expect(parseLocalPath(`local://${encodeURIComponent(TREE)}/%E0%A4%A`)).toBeNull();
    expect(isLocalPath('ssh://h/a')).toBe(false);
    expect(isLocalPath(null)).toBe(false);
  });
});

describe('the plugin through local.ts', () => {
  it('picks a folder (cancel is null) and lists the granted trees', async () => {
    expect(await pickLocalFolder()).toBeNull();
    saf.nextPick = { tree: 'content://x/tree/new', name: 'Vault' };
    expect(await pickLocalFolder()).toEqual({ handle: { tree: 'content://x/tree/new', rel: '' }, name: 'Vault' });
    expect(await grantedTrees()).toEqual(expect.arrayContaining([TREE, 'content://x/tree/new']));
  });

  it('lists folders and Markdown only, no dotfiles, folders first, A-Z ignoring case, with full local:// paths', async () => {
    const rows = await listLocalFolder(at(''));
    expect(rows.map((r) => [r.name, r.isDir])).toEqual([
      ['Apple', true],
      ['drafts', true],
      ['img', true],
      ['a.md', false],
      ['b.markdown', false],
      ['Zed.md', false],
    ]);
    expect(rows[1].path).toBe(localPath(at('drafts')));
    expect((await listLocalFolder(at('drafts'))).map((r) => r.path)).toEqual([localPath(at('drafts/x.md'))]);
  });

  it('reads bytes exactly (a binary file survives) with the stat they were read at', async () => {
    const { bytes, stat } = await readLocal(at('img/pic.png'));
    expect([...bytes]).toEqual([0, 255, 128, 10, 13]);
    expect(stat.size).toBe(5);
    const { bytes: t } = await readLocal(at('a.md'));
    expect(new TextDecoder().decode(t)).toBe('alpha');
  });

  it('stats and checks existence; a missing file is not-found', async () => {
    expect((await statLocal(at('a.md'))).size).toBe(5);
    expect(await existsLocal(at('a.md'))).toBe(true);
    expect(await existsLocal(at('nope.md'))).toBe(false);
    await expect(statLocal(at('nope.md'))).rejects.toMatchObject({ kind: 'not-found' });
  });

  it('writes in place and returns the new stat', async () => {
    const before = await statLocal(at('a.md'));
    saf.tick();
    const after = await writeLocal(at('a.md'), 'alpha two', before);
    expect(after.size).toBe(9);
    expect(saf.text(TREE, 'a.md')).toBe('alpha two');
  });

  it('creates a file and refuses an existing name with exists', async () => {
    const st = await createLocal(at('drafts/new.md'), 'hi');
    expect(st.size).toBe(2);
    expect(saf.text(TREE, 'drafts/new.md')).toBe('hi');
    await expect(createLocal(at('drafts/new.md'), 'again')).rejects.toMatchObject({ kind: 'exists' });
    expect(saf.text(TREE, 'drafts/new.md')).toBe('hi');
  });
});

describe('the conflict path', () => {
  it('throws the SSH conflict error when the file changed since it was read, and writes nothing', async () => {
    const opened = await statLocal(at('a.md'));
    saf.tick();
    saf.put(TREE, 'a.md', 'edited outside, longer');
    const err = await writeLocal(at('a.md'), 'mine', opened).catch((e) => e);
    expect(err).toBeInstanceOf(RemoteConflictError);
    expect(err).toMatchObject({ name_: 'a.md', deleted: false });
    expect(saf.text(TREE, 'a.md')).toBe('edited outside, longer');
  });
  it('catches a same-second edit by its size, and a same-size edit by its time', async () => {
    const opened = await statLocal(at('a.md'));
    saf.put(TREE, 'a.md', 'alphas', opened.modified); // same second, other size
    await expect(writeLocal(at('a.md'), 'x', opened)).rejects.toBeInstanceOf(RemoteConflictError);
    saf.put(TREE, 'a.md', 'alpha', opened.modified! + 1000); // same size, later second
    await expect(writeLocal(at('a.md'), 'x', opened)).rejects.toBeInstanceOf(RemoteConflictError);
  });
  it('compares size alone when the provider gives no modified time', async () => {
    saf.put(TREE, 'a.md', 'alpha', null);
    const opened = await statLocal(at('a.md'));
    expect(opened.modified).toBeNull();
    await writeLocal(at('a.md'), 'beta!', opened);
    expect(saf.text(TREE, 'a.md')).toBe('beta!');
  });
  it('Overwrite (force) sends no expected stat and writes', async () => {
    const opened = await statLocal(at('a.md'));
    saf.put(TREE, 'a.md', 'changed elsewhere');
    await writeLocal(at('a.md'), 'mine', opened, true);
    expect(saf.text(TREE, 'a.md')).toBe('mine');
    expect(saf.calls.at(-1)![1]).not.toHaveProperty('expected');
  });
});

describe('error mapping', () => {
  it('a revoked grant is permission', async () => {
    saf.revoke(TREE);
    await expect(listLocalFolder(at(''))).rejects.toMatchObject({ kind: 'permission' });
    await expect(readLocal(at('a.md'))).rejects.toMatchObject({ kind: 'permission' });
  });
  it('a path that climbs out of the tree is the distinct "outside" message', async () => {
    const err = await readLocal(at('../GonqSecond/d.md')).catch((e) => e);
    expect(err).toBeInstanceOf(LocalFileError);
    expect(err).toMatchObject({ kind: 'outside', message: 'That is outside the opened folder.' });
  });
  it('a vanished folder is not-found, not an empty listing', async () => {
    saf.vanish(TREE);
    await expect(listLocalFolder(at(''))).rejects.toMatchObject({ kind: 'not-found' });
  });
  it('maps rejections of every shape', () => {
    expect(toLocalError({ kind: 'outside', message: 'Document x is not a descendant' }).message).toBe('That is outside the opened folder.');
    expect(toLocalError({ kind: 'weird', message: 'm' })).toMatchObject({ kind: 'io', message: 'm' });
    expect(toLocalError('boom')).toMatchObject({ kind: 'io', message: 'boom' });
    expect(toLocalError(new Error('e')).message).toBe('e');
  });
});

describe('checkLocalRoot (reopening a recent)', () => {
  it('passes when the tree is granted and its root stats', async () => {
    expect(await checkLocalRoot(localPath(at('a.md')))).toEqual(at('a.md'));
  });
  it('fails with permission when the tree is no longer in the granted list', async () => {
    saf.revoke(TREE);
    await expect(checkLocalRoot(localPath(at('a.md')))).rejects.toMatchObject({ kind: 'permission' });
  });
  it('fails with not-found when the grant is there but the root is gone', async () => {
    saf.vanish(TREE);
    await expect(checkLocalRoot(localPath(at('a.md')))).rejects.toMatchObject({ kind: 'not-found' });
  });
});

describe('createLocalDocument (Save as outside an opened folder)', () => {
  const DOC = 'content://com.android.providers.downloads.documents/document/42';
  it('resolves a single-document handle that round-trips through localPath and can be written and read', async () => {
    saf.nextDocument = { uri: DOC, name: 'notes.md' };
    const r = await createLocalDocument('Untitled.md');
    expect(r).toEqual({ handle: { tree: DOC, rel: 'notes.md' }, name: 'notes.md' });
    expect(saf.calls[saf.calls.length - 1]).toEqual(['local_create_document', { name: 'Untitled.md' }]);
    const path = localPath(r!.handle);
    expect(parseLocalPath(path)).toEqual(r!.handle);
    expect(localFileName(path)).toBe('notes.md');
    const stat = await writeLocal(r!.handle, 'hello');
    expect(stat.size).toBe(5);
    expect(new TextDecoder().decode((await readLocal(r!.handle)).bytes)).toBe('hello');
    expect((await checkLocalRoot(path)).tree).toBe(DOC);
  });
  it('resolves null when cancelled, without an error', async () => {
    expect(await createLocalDocument('Untitled.md')).toBeNull();
  });
  it('maps a rejection to a LocalFileError', async () => {
    const spy = vi.spyOn(saf, 'invoke').mockRejectedValueOnce({ kind: 'io', message: 'boom' });
    await expect(createLocalDocument('x.md')).rejects.toMatchObject({ name: 'LocalFileError', kind: 'io', message: 'boom' });
    spy.mockRestore();
  });
  it('rejects with unsupported outside the Android app and never calls the plugin', async () => {
    vi.stubGlobal('__GONQ_APP__', undefined);
    await expect(createLocalDocument('x.md')).rejects.toMatchObject({ kind: 'unsupported' });
    expect(saf.calls).toEqual([]);
  });
});

describe('outside the Gonq Android app', () => {
  it('rejects with a clear unsupported error on the desktop app and never calls the plugin', async () => {
    vi.stubGlobal('__GONQ_APP__', undefined);
    const err = await listLocalFolder(at('')).catch((e) => e);
    expect(err).toMatchObject({ kind: 'unsupported' });
    expect(err.message).toMatch(/Gonq app for Android/);
    expect(saf.calls).toEqual([]);
  });
  it('rejects the same way in a browser', async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    await expect(pickLocalFolder()).rejects.toMatchObject({ kind: 'unsupported' });
    expect(saf.calls).toEqual([]);
  });
});
