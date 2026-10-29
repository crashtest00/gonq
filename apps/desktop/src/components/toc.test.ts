/** Table of contents building/refresh, and image reference/alt helpers from platform/images.ts. */
import { buildToc, findToc, tocChange } from './toc';
import { imageAlt, imageReference } from '../platform/images';

test('nests entries by heading level, skipped levels collapse to one step', () => {
  expect(buildToc('# A\n\n## B\n\n#### C\n\n## D\n\n# E\n')).toBe(
    ['<!-- toc -->', '- [A](#a)', '  - [B](#b)', '    - [C](#c)', '  - [D](#d)', '- [E](#e)', '<!-- /toc -->'].join('\n'),
  );
});

test('repeated headings get numbered anchors; no headings gives an empty state', () => {
  expect(buildToc('## Same\n\n## Same\n')).toContain('- [Same](#same-1)');
  expect(buildToc('just text\n')).toBe('<!-- toc -->\n_No headings yet._\n<!-- /toc -->');
});

test('the block never lists itself and is found again', () => {
  const text = `# A\n\n${buildToc('# A\n')}\n\n## B\n`;
  const range = findToc(text)!;
  expect(text.slice(range.from, range.to)).toBe(buildToc('# A\n'));
  expect(buildToc(text)).toBe('<!-- toc -->\n- [A](#a)\n  - [B](#b)\n<!-- /toc -->');
});

test('a second insert refreshes the existing block instead of adding another', () => {
  const text = `# A\n\n${buildToc('# A\n')}\n\n## B\n`;
  const c = tocChange(text, text.length);
  expect(c.refreshed).toBe(true);
  expect(text.slice(0, c.from) + c.insert + text.slice(c.to)).toBe(`# A\n\n${buildToc(text)}\n\n## B\n`);
});

test('a new block is set off by blank lines', () => {
  const c = tocChange('# A\ntext', 4);
  expect(c.insert).toBe(`\n${buildToc('# A\ntext')}\n\n`);
});

test('image references are relative beneath the document, absolute elsewhere, and URL-safe', () => {
  expect(imageReference('/d/img/my pic (1).png', '/d/a.md')).toBe('img/my%20pic%20%281%29.png');
  expect(imageReference('/other/p.png', '/d/a.md')).toBe('/other/p.png');
  expect(imageReference('C:\\d\\img\\p.png', 'C:\\d\\a.md')).toBe('img/p.png');
  expect(imageReference('/x/p.png', null)).toBe('/x/p.png');
  expect(imageAlt('/d/my [pic].final.png')).toBe('my pic.final');
});
