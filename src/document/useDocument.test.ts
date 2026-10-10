import { act, renderHook } from '@testing-library/react';
import { useDocument } from './useDocument';

const doc = (name: string) => ({ name, path: `/x/${name}`, text: `# ${name}` });

test('closing the only tab leaves no tab, no active tab and no open edit', () => {
  const { result } = renderHook(() => useDocument());
  act(() => result.current.openUntitled());
  act(() => result.current.startAppend());
  expect(result.current.region).not.toBeNull();
  act(() => result.current.close(result.current.activeId!));
  expect(result.current.tabs).toEqual([]);
  expect(result.current.activeId).toBeNull();
  expect(result.current.meta).toBeNull();
  expect(result.current.region).toBeNull();
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
  act(() => result.current.replaceText('hi'));
  expect(result.current.dirtyIds()).toHaveLength(1);
});
