/** Covers tabLabels: plain names, folder-qualified local twins, and branch-qualified GitHub twins. */
import { expect, it } from 'vitest';
import { tabLabels } from './tabLabels';

const gh = (branch: string, path: string) => ({ owner: 'o', repo: 'r', branch, path, sha: 's', commitSha: 'c' });

it('keeps a unique name as is', () => {
  expect(tabLabels([{ name: 'a.md', path: '/x/a.md' }, { name: 'b.md', path: null }])).toEqual(['a.md', 'b.md']);
});

it('puts just enough of the folder in front of same-named local tabs', () => {
  expect(tabLabels([{ name: 'todo.md', path: '/notes/todo.md' }, { name: 'todo.md', path: '/work/todo.md' }])).toEqual(['notes/todo.md', 'work/todo.md']);
  expect(tabLabels([{ name: 'todo.md', path: '/a/x/todo.md' }, { name: 'todo.md', path: '/b/x/todo.md' }])).toEqual(['a/x/todo.md', 'b/x/todo.md']);
});

it('adds the branch to same-named GitHub tabs only', () => {
  const tabs = [
    { name: 'README.md', path: 'o/r/main/README.md', github: gh('main', 'README.md') },
    { name: 'README.md', path: 'o/r/dev/README.md', github: gh('dev', 'README.md') },
    { name: 'other.md', path: 'o/r/main/other.md', github: gh('main', 'other.md') },
  ];
  expect(tabLabels(tabs)).toEqual(['README.md (main)', 'README.md (dev)', 'other.md']);
});
