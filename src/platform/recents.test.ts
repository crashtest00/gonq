import { vi } from 'vitest';

let tauri = false;
const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('./files', () => ({ isTauri: () => tauri }));

import { RECENTS_KEY, addRecent, allowRecentDocument, listRecents, removeRecent } from './recents';

beforeEach(() => {
  tauri = false;
  localStorage.clear();
  invoke.mockReset();
});

describe('web fallback (localStorage)', () => {
  it('adds newest first and dedupes', async () => {
    await addRecent('a.md');
    await addRecent('b.md');
    const list = await addRecent('a.md');
    expect(list.map((r) => r.path)).toEqual(['a.md', 'b.md']);
    expect(typeof list[0].openedAt).toBe('number');
    expect((await listRecents()).map((r) => r.path)).toEqual(['a.md', 'b.md']);
  });
  it('caps at 10', async () => {
    for (let i = 0; i < 12; i++) await addRecent(`${i}.md`);
    const list = await listRecents();
    expect(list).toHaveLength(10);
    expect(list[0].path).toBe('11.md');
  });
  it('removes one path', async () => {
    await addRecent('a.md');
    await addRecent('b.md');
    expect((await removeRecent('a.md')).map((r) => r.path)).toEqual(['b.md']);
  });
  it('treats corrupt storage as empty', async () => {
    localStorage.setItem(RECENTS_KEY, '{nope');
    expect(await listRecents()).toEqual([]);
    localStorage.setItem(RECENTS_KEY, '{"a":1}');
    expect(await listRecents()).toEqual([]);
  });
});

describe('desktop', () => {
  beforeEach(() => {
    tauri = true;
  });
  it('maps opened_at to openedAt', async () => {
    invoke.mockResolvedValue([{ path: '/a.md', opened_at: 5 }]);
    expect(await listRecents()).toEqual([{ path: '/a.md', openedAt: 5 }]);
    expect(invoke).toHaveBeenCalledWith('recent_documents_list');
  });
  it('add and remove call the commands', async () => {
    invoke.mockResolvedValue([]);
    await addRecent('/a.md');
    await removeRecent('/a.md');
    expect(invoke).toHaveBeenCalledWith('recent_documents_add', { path: '/a.md' });
    expect(invoke).toHaveBeenCalledWith('recent_documents_remove', { path: '/a.md' });
  });
  it('allowRecentDocument is a no-op on the web', async () => {
    tauri = false;
    await allowRecentDocument('/a.md');
    expect(invoke).not.toHaveBeenCalled();
  });
});
