import { outlineOf } from './outline';

test('lists ATX headings with level and file offset', () => {
  const text = '# One\n\ntext\n\n## **Two** `x`\n';
  expect(outlineOf(text)).toEqual([
    { level: 1, text: 'One', from: 0 },
    { level: 2, text: 'Two x', from: text.indexOf('## ') },
  ]);
});

test('ignores headings in fenced code, closing hashes and non-headings', () => {
  const text = '```\n# not\n```\n\n#nope\n\n### Three ###\n';
  expect(outlineOf(text).map((i) => [i.level, i.text])).toEqual([[3, 'Three']]);
});
