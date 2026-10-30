/** useDocumentController: closing a dirty tab (save, discard, cancel), a save conflict, and Save As onto a taken name. */
import { act, renderHook } from '@testing-library/react';
import { PathTakenError, type FileAccess } from '../platform/files';
import { RemoteConflictError } from '../platform/remote';
import { useDocumentController, type DocumentControllerOptions } from './document';

function setup(files: Partial<FileAccess>, choices: { unsaved?: 'save' | 'discard' | 'cancel'; conflict?: 'overwrite' | 'cancel' } = {}) {
  const calls = { unsaved: [] as string[], conflict: [] as { name: string; deleted: boolean }[], errors: [] as (string | null)[] };
  const options: DocumentControllerOptions = {
    files: files as FileAccess,
    confirmUnsaved: async (name) => (calls.unsaved.push(name), choices.unsaved ?? 'cancel'),
    confirmConflict: async (c) => (calls.conflict.push(c), choices.conflict ?? 'cancel'),
    onError: (m) => calls.errors.push(m),
    onNotice: () => {},
    onSaving: () => {},
  };
  const hook = renderHook(() => useDocumentController(options));
  return { ...hook, calls };
}

const saved = (path: string) => ({ name: path.split('/').pop()!, path });

/** Opens a.md and types into it, so the tab is dirty. */
function dirtyTab(result: { current: ReturnType<typeof useDocumentController> }) {
  act(() => result.current.session.open({ name: 'a.md', path: '/x/a.md', text: 'one' }));
  const id = result.current.session.activeId!;
  act(() => result.current.session.edited(id, { text: 'two', canUndo: true, canRedo: false }));
  return id;
}

describe('closing a dirty tab', () => {
  test('save writes the file, then closes', async () => {
    const saveDocument = vi.fn(async () => saved('/x/a.md'));
    const { result, calls } = setup({ saveDocument }, { unsaved: 'save' });
    dirtyTab(result);
    await act(() => result.current.closeTabById(result.current.session.activeId!));
    expect(calls.unsaved).toEqual(['a.md']);
    expect(saveDocument).toHaveBeenCalledTimes(1);
    expect(result.current.session.tabs).toEqual([]);
  });

  test('discard closes without writing', async () => {
    const saveDocument = vi.fn();
    const { result } = setup({ saveDocument }, { unsaved: 'discard' });
    dirtyTab(result);
    await act(() => result.current.closeTab() as unknown as Promise<void>);
    await vi.waitFor(() => expect(result.current.session.tabs).toEqual([]));
    expect(saveDocument).not.toHaveBeenCalled();
  });

  test('cancel keeps the tab and its text', async () => {
    const saveDocument = vi.fn();
    const { result } = setup({ saveDocument }, { unsaved: 'cancel' });
    const id = dirtyTab(result);
    await act(() => result.current.closeTabById(id));
    expect(saveDocument).not.toHaveBeenCalled();
    expect(result.current.session.tabs).toHaveLength(1);
    expect(result.current.session.text).toBe('two');
  });

  test('a clean tab closes without asking', async () => {
    const { result, calls } = setup({});
    act(() => result.current.session.open({ name: 'a.md', path: '/x/a.md', text: 'one' }));
    await act(() => result.current.closeTabById(result.current.session.activeId!));
    expect(calls.unsaved).toEqual([]);
    expect(result.current.session.tabs).toEqual([]);
  });
});

describe('a save conflict', () => {
  const conflict = () => new RemoteConflictError('a.md', false);

  test('overwrite saves again with force', async () => {
    const saveDocument = vi.fn().mockRejectedValueOnce(conflict()).mockResolvedValueOnce(saved('/x/a.md'));
    const { result, calls } = setup({ saveDocument }, { conflict: 'overwrite' });
    dirtyTab(result);
    await act(() => result.current.save());
    expect(calls.conflict).toEqual([{ name: 'a.md', deleted: false }]);
    expect(saveDocument.mock.calls[1][2]).toEqual({ force: true });
    expect(result.current.session.tabs[0].dirty).toBe(false);
  });

  test('cancel writes nothing and leaves the tab dirty', async () => {
    const saveDocument = vi.fn().mockRejectedValueOnce(conflict());
    const { result } = setup({ saveDocument }, { conflict: 'cancel' });
    dirtyTab(result);
    let ok = true;
    await act(async () => void (ok = await result.current.save()));
    expect(ok).toBe(false);
    expect(saveDocument).toHaveBeenCalledTimes(1);
    expect(result.current.session.tabs[0].dirty).toBe(true);
  });
});

test('Save As onto a name another tab holds reports PathTakenError and stays dirty', async () => {
  const saveDocumentAs = vi.fn(async (_doc: unknown, taken?: (p: string) => boolean) => {
    if (taken?.('/x/b.md')) throw new PathTakenError('/x/b.md');
    return saved('/x/b.md');
  });
  const { result, calls } = setup({ saveDocumentAs });
  act(() => result.current.session.open({ name: 'b.md', path: '/x/b.md', text: 'held' }));
  dirtyTab(result);
  let ok = true;
  await act(async () => void (ok = await result.current.saveAs()));
  expect(ok).toBe(false);
  expect(calls.errors.at(-1)).toBe('/x/b.md is already open in another tab, so it was not saved there. Choose another name.');
  expect(result.current.session.tabs[1].dirty).toBe(true);
});
