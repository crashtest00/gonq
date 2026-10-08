import { outlineOf } from './outline';

test('lists ATX headings with level and file offset', () => {
  const text = '# One\n\ntext\n\n## **Two** `x`\n';
  expect(outlineOf(text)).toEqual([
    { level: 1, text: 'One', from: 0 },
    { level: 2, text: 'Two x', from: text.indexOf('## ') },
  ]);
});

test('ignores headings in fenced code, closing hashes and non-headings', () => {
  const text = '```\n# not\n```\n\n#nope\n\n## Two ##\n';
  expect(outlineOf(text).map((i) => [i.level, i.text])).toEqual([[2, 'Two']]);
});

test('H3 and deeper are not listed', () => {
  expect(outlineOf('# A\n\n### C\n\n#### D\n\n###### F\n\n## B\n').map((i) => [i.level, i.text])).toEqual([
    [1, 'A'],
    [2, 'B'],
  ]);
});

test('setext headings are H1 and H2', () => {
  const text = 'Title\n=====\n\nSub\n---\n\nbody\n';
  expect(outlineOf(text)).toEqual([
    { level: 1, text: 'Title', from: 0 },
    { level: 2, text: 'Sub', from: text.indexOf('Sub') },
  ]);
});

test('a thread marker is not part of the heading text', () => {
  const text = '## Marked [💬](#md-thread-abc) heading\n\n[✅](#md-thread-def) # not a heading\n';
  expect(outlineOf(text).map((i) => i.text)).toEqual(['Marked heading']);
});
