/** Covers recentRow: basename of local/Windows/github paths, the relativeTime buckets and githubDetail. */
import { expect, test } from 'vitest';
import { basename, githubDetail, relativeTime } from './recentRow';

test('basename', () => {
  expect(basename('/home/a/notes.md')).toBe('notes.md');
  expect(basename('C:\\docs\\a.md')).toBe('a.md');
  expect(basename('github://o/r@main/docs/x.md')).toBe('x.md');
});

test('relativeTime buckets', () => {
  const now = 1_000_000_000_000;
  expect(relativeTime(now - 5_000, now)).toBe('just now');
  expect(relativeTime(now - 5 * 60_000, now)).toBe('5 min ago');
  expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 h ago');
  expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2 d ago');
  expect(relativeTime(now - 30 * 86_400_000, now)).toBe(new Date(now - 30 * 86_400_000).toLocaleDateString());
});

test('githubDetail', () => {
  expect(githubDetail('github://o/r@main/x.md')).toBe('o/r @ main');
  expect(githubDetail('/home/a.md')).toBe(null);
});
