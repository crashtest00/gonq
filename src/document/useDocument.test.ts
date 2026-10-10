import { act, renderHook } from '@testing-library/react';
import { useDocument } from './useDocument';

const doc = (name: string) => ({ name, path: `/x/${name}`, text: `# ${name}` });

test('closing the only tab leaves no tab and no active tab', () => {
  const { result } = renderHook(() => useDocument());
  act(() => result.current.openUntitled());
  act(() => result.current.close(result.current.activeId!));
  expect(result.current.tabs).toEqual([]);
  expect(result.current.activeId).toBeNull();
  expect(result.current.meta).toBeNull();
  expect(result.current.dirtyIds()).toEqual([]);
});

test('closing one of several activates a neighbour', () => {
  const { result } = renderHook(() => useDocument());
  act(() => result.current.open(doc('a.md')));
  act(() => result.current.open(doc('b.md')));
  act(() => result.current.open(doc('c.md')));
  act(() => result.current.close(result.current.tabs[2].id));
  expect(result.current.tabs.map((t) => t.name)).toEqual(['a.md', 'b.md']);
  expect(result.current.meta?.name).toBe('b.md');
});

test('the untitled counter restarts once every tab is closed', () => {
  const { result } = renderHook(() => useDocument());
  act(() => result.current.openUntitled());
  act(() => result.current.openUntitled());
  expect(result.current.tabs.map((t) => t.name)).toEqual(['Untitled.md', 'Untitled 2.md']);
  act(() => result.current.close(result.current.tabs[0].id));
  act(() => result.current.close(result.current.tabs[0].id));
  act(() => result.current.openUntitled());
  expect(result.current.tabs.map((t) => t.name)).toEqual(['Untitled.md']);
});

test('a dirty untitled tab is reported by dirtyIds until closed', () => {
  const { result } = renderHook(() => useDocument());
  act(() => result.current.openUntitled());
  act(() => result.current.edited(result.current.activeId!, { text: 'hi', canUndo: true, canRedo: false }));
  expect(result.current.dirtyIds()).toHaveLength(1);
});

const edit = (r: { current: ReturnType<typeof useDocument> }, text: string) =>
  act(() => r.current.edited(r.current.activeId!, { text, canUndo: true, canRedo: false }));

test('an untouched file is written back byte for byte, whatever its line endings', () => {
  const { result } = renderHook(() => useDocument());
  const mixed = '# A\r\nline\nlone\rend\r\n';
  act(() => result.current.open({ name: 'm.md', path: '/x/m.md', text: mixed }));
  expect(result.current.dirty).toBe(false);
  expect(result.current.peek(result.current.activeId!)?.text).toBe(mixed);
});

test('an edited CRLF file is written with CRLF throughout', () => {
  const { result } = renderHook(() => useDocument());
  act(() => result.current.open({ name: 'c.md', path: '/x/c.md', text: '# A\r\nline\r\n' }));
  expect(result.current.text).toBe('# A\nline\n');
  edit(result, '# A\nline\nmore\n');
  expect(result.current.dirty).toBe(true);
  expect(result.current.peek(result.current.activeId!)?.text).toBe('# A\r\nline\r\nmore\r\n');
});

test('saving records the written text as the clean state', () => {
  const { result } = renderHook(() => useDocument());
  act(() => result.current.openUntitled());
  edit(result, 'x\ny');
  const id = result.current.activeId!;
  act(() => result.current.saved(id, { name: 'n.md', path: '/x/n.md' }, 'x\ny'));
  expect(result.current.dirty).toBe(false);
  edit(result, 'x\ny\nz');
  expect(result.current.dirty).toBe(true);
});
