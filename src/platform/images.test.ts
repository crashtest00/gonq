import { resolveImagePath } from './images';

describe('resolveImagePath', () => {
  test.each([
    ['pic.png', '/home/u/notes/doc.md', '/home/u/notes/pic.png'],
    ['./img/a%20b.png', '/home/u/notes/doc.md', '/home/u/notes/img/a b.png'],
    ['../shared/p.png', '/home/u/notes/doc.md', '/home/u/shared/p.png'],
    ['/abs/p.png', '/home/u/notes/doc.md', '/abs/p.png'],
    ['p.png', 'C:\\Users\\u\\doc.md', 'C:\\Users\\u\\p.png'],
    ['sub/p.png', 'C:\\Users\\u\\doc.md', 'C:\\Users\\u\\sub\\p.png'],
    ['p.png?raw=1', '/a/doc.md', '/a/p.png'],
    ['p.png', 'ssh://me@host/srv/docs/doc.md', 'ssh://me@host/srv/docs/p.png'],
    ['../p.png', 'ssh://me@host/srv/docs/doc.md', 'ssh://me@host/srv/p.png'],
  ])('%s next to %s', (src, doc, want) => {
    expect(resolveImagePath(src, doc)).toBe(want);
  });
});
