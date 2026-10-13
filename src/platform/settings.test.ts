import { vi } from 'vitest';

let tauri = true;
const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('./files', () => ({ isTauri: () => tauri }));

import { AUTHOR_KEY, authorNameProblem, getAuthorName, setAuthorName } from './settings';

beforeEach(() => {
  tauri = true;
  invoke.mockReset();
  localStorage.clear();
});

describe('authorNameProblem', () => {
  it.each(['Ann', 'Ann Lee-Smith', 'Åsa 🙂'])('accepts %j', (n) => expect(authorNameProblem(n)).toBeNull());
  it.each(['', '  ', '\n', 'a|b', 'a]b', 'a\nb', 'x'.repeat(101)])('rejects %j', (n) => expect(authorNameProblem(n)).not.toBeNull());
  it('accepts exactly 100 characters', () => expect(authorNameProblem('x'.repeat(100))).toBeNull());
});

describe('desktop', () => {
  it('reads the saved name', async () => {
    invoke.mockResolvedValue('Ann');
    expect(await getAuthorName()).toBe('Ann');
    expect(invoke).toHaveBeenCalledWith('get_author_name');
  });
  it('falls back to User when unset or the read fails', async () => {
    invoke.mockResolvedValue('');
    expect(await getAuthorName()).toBe('User');
    invoke.mockRejectedValue(new Error('x'));
    expect(await getAuthorName()).toBe('User');
  });
  it('saves the trimmed name and returns what is stored', async () => {
    invoke.mockResolvedValue('Ann');
    expect(await setAuthorName('  Ann ')).toBe('Ann');
    expect(invoke).toHaveBeenCalledWith('set_author_name', { name: 'Ann' });
  });
  it.each(['', ' ', 'a|b', 'a]b', 'a\nb', 'a\rb'])('refuses %j without calling the backend', async (n) => {
    await expect(setAuthorName(n)).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it('rejects an invalid name without calling the backend', async () => {
    await expect(setAuthorName('a|b')).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it('rejects when the backend fails', async () => {
    invoke.mockRejectedValue('disk full');
    await expect(setAuthorName('Ann')).rejects.toBe('disk full');
  });
});

describe('web', () => {
  beforeEach(() => {
    tauri = false;
  });
  it('refuses blank and stores nothing', async () => {
    await expect(setAuthorName('  ')).rejects.toThrow();
    expect(localStorage.getItem(AUTHOR_KEY)).toBeNull();
  });
  it('round-trips through localStorage', async () => {
    expect(await setAuthorName(' Bo ')).toBe('Bo');
    expect(localStorage.getItem(AUTHOR_KEY)).toBe('Bo');
    expect(await getAuthorName()).toBe('Bo');
    expect(invoke).not.toHaveBeenCalled();
  });
  it('ignores a leftover gonq.showMarkersInActiveBlock value and still reads the author name', async () => {
    localStorage.setItem('gonq.showMarkersInActiveBlock', 'false');
    localStorage.setItem(AUTHOR_KEY, 'Bo');
    expect(await getAuthorName()).toBe('Bo');
    expect(localStorage.getItem('gonq.showMarkersInActiveBlock')).toBe('false');
  });
});
