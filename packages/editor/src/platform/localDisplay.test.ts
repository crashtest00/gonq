/** The display side of local:// paths: localTreeName, localDisplayPath, isLocalFolderRoot, and how recentRow (basename, localDetail) and tabLabels show them, with no tree URI or storage path. */
import { expect, it } from 'vitest';
import { basename, localDetail } from '../model/recentRow';
import { tabLabels } from '../model/tabLabels';
import { isLocalFolderRoot, localDisplayPath, localPath, localTreeName } from './local';

const TREE = 'content://com.android.externalstorage.documents/tree/primary%3ADocuments%2Fnotes';
const DOC = 'content://com.android.externalstorage.documents/document/primary%3ADocuments%2Fnew.md';

it('localTreeName is the last segment of the document id', () => {
  expect(localTreeName(TREE)).toBe('notes');
  expect(localTreeName('content://x/tree/primary%3A')).toBe('primary');
  expect(localTreeName('content://tree-a')).toBe('tree-a');
});

it('localDisplayPath is Folder/rel, the folder name for a root and the file name for a single document', () => {
  expect(localDisplayPath(localPath({ tree: TREE, rel: 'docs/b.md' }))).toBe('notes/docs/b.md');
  expect(localDisplayPath(localPath({ tree: TREE, rel: '' }))).toBe('notes');
  expect(localDisplayPath(localPath({ tree: DOC, rel: 'new.md' }))).toBe('new.md');
  expect(localDisplayPath('/plain/path.md')).toBe('/plain/path.md');
});

it('isLocalFolderRoot is true for a tree root only', () => {
  expect(isLocalFolderRoot(localPath({ tree: TREE, rel: '' }))).toBe(true);
  expect(isLocalFolderRoot(localPath({ tree: TREE, rel: 'a.md' }))).toBe(false);
  expect(isLocalFolderRoot(localPath({ tree: DOC, rel: '' }))).toBe(false);
  expect(isLocalFolderRoot('/x')).toBe(false);
});

it('recent rows name the file or folder and show its folder', () => {
  expect(basename(localPath({ tree: TREE, rel: 'docs/b.md' }))).toBe('b.md');
  expect(basename(localPath({ tree: TREE, rel: '' }))).toBe('notes');
  expect(localDetail(localPath({ tree: TREE, rel: 'docs/b.md' }))).toBe('notes/docs');
  expect(localDetail(localPath({ tree: TREE, rel: '' }))).toBe('Folder');
  expect(localDetail(localPath({ tree: DOC, rel: 'new.md' }))).toBeNull();
  expect(localDetail('/plain/path.md')).toBeNull();
});

it('same-named tabs get enough of the folder path, never the tree URI', () => {
  const other = 'content://x/tree/primary%3Awork';
  const labels = tabLabels([
    { name: 'todo.md', path: localPath({ tree: TREE, rel: 'todo.md' }) },
    { name: 'todo.md', path: localPath({ tree: other, rel: 'todo.md' }) },
  ]);
  expect(labels).toEqual(['notes/todo.md', 'work/todo.md']);
});
