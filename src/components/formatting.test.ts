/** applyFormat: wrapping/unwrapping, links, block prefixes, tables, markers and code. */
import { applyFormat } from './formatting';

const run = (f: Parameters<typeof applyFormat>[0], v: string, s: number, e = s) => applyFormat(f, v, s, e);

test('wraps and unwraps a selection', () => {
  expect(run('bold', 'a word b', 2, 6)).toEqual({ value: 'a **word** b', start: 4, end: 8 });
  expect(run('bold', 'a **word** b', 4, 8).value).toBe('a word b');
  expect(run('bold', 'a **word** b', 2, 10).value).toBe('a word b');
  expect(run('strike', 'gone', 0, 4).value).toBe('~~gone~~');
});

test('underline wraps and unwraps with <ins>', () => {
  expect(run('underline', 'a word b', 2, 6)).toEqual({ value: 'a <ins>word</ins> b', start: 7, end: 11 });
  expect(run('underline', 'a <ins>word</ins> b', 7, 11).value).toBe('a word b');
  expect(run('underline', 'a <ins>word</ins> b', 2, 17).value).toBe('a word b');
});

test('no selection inserts empty markup with the caret inside', () => {
  const cases: [Parameters<typeof applyFormat>[0], string, number][] = [
    ['bold', '****', 2],
    ['italic', '**', 1],
    ['strike', '~~~~', 2],
    ['underline', '<ins></ins>', 5],
  ];
  for (const [format, markup, inside] of cases) {
    const r = run(format, 'ab', 1);
    expect(r.value).toBe(`a${markup}b`);
    expect(r.start).toBe(1 + inside);
    expect(r.end).toBe(r.start);
  }
});

test('link writes [text](url) and leaves the caret after it', () => {
  const r = run('link', 'see docs now', 4, 8);
  expect(applyFormat('link', 'see docs now', 4, 8, 'https://x.io')).toEqual({ value: 'see [docs](https://x.io) now', start: 24, end: 24 });
  expect(r.value).toBe('see [docs]() now');
  expect(applyFormat('link', '', 0, 0, 'u').value).toBe('[text](u)');
});

const MARKER = '[💬](#md-thread-abc)';

test('formatting never splits a comment marker', () => {
  const doc = `a ${MARKER} b`;
  const from = 2;
  const to = from + MARKER.length;
  // Collapsed inside the marker: moves to its end.
  expect(run('bold', doc, from + 3).value).toBe(`a ${MARKER}**** b`);
  // Selection cutting into either end: grows to the marker edges.
  expect(run('bold', doc, 0, from + 3).value).toBe(`**a ${MARKER}** b`);
  expect(run('strike', doc, from + 3, doc.length).value).toBe(`a ~~${MARKER} b~~`);
  expect(run('underline', doc, from + 2, to - 2).value).toBe(`a <ins>${MARKER}</ins> b`);
});

test('inline formats do nothing inside fenced or inline code', () => {
  const fenced = '```\ncode here\n```';
  const inline = 'a `code` b';
  for (const format of ['bold', 'italic', 'underline', 'strike'] as const) {
    expect(run(format, fenced, 5, 9).value).toBe(fenced);
    expect(run(format, inline, 4, 6).value).toBe(inline);
    expect(run(format, inline, 5).value).toBe(inline);
  }
  expect(applyFormat('link', fenced, 5, 9, 'u').value).toBe(fenced);
  // Prose around code still formats.
  expect(run('bold', inline, 0, 1).value).toBe('**a** `code` b');
  expect(run('bold', '```\nx\n```\n\nafter', 11, 16).value).toBe('```\nx\n```\n\n**after**');
});

test('list formats prefix every selected line and toggle off', () => {
  expect(run('bullet', 'a\nb\nc', 0, 3).value).toBe('- a\n- b\nc');
  expect(run('numbered', 'a\nb', 0, 3).value).toBe('1. a\n2. b');
  expect(run('task', 'a', 0).value).toBe('- [ ] a');
  expect(run('bullet', '- a\n- b', 0, 7).value).toBe('a\nb');
  expect(run('task', '- a', 0).value).toBe('- [ ] a');
  expect(run('bullet', '- [x] a', 0).value).toBe('- a');
  expect(run('task', '- [x] a', 0).value).toBe('a');
});

const T = '| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |';

test('table is inserted as its own block with a blank line and the caret below it', () => {
  // End of document.
  expect(run('table', '', 0)).toMatchObject({ value: T + '\n\n', start: T.length + 2, end: T.length + 2 });
  expect(run('table', 'text', 4)).toMatchObject({ value: 'text\n\n' + T + '\n\n', start: 6 + T.length + 2 });
});

test('table inserted in the middle of text splits it and leaves the caret before the rest', () => {
  const r = run('table', 'abcd', 2);
  expect(r.value).toBe('ab\n\n' + T + '\n\ncd');
  expect(r.value.slice(r.start)).toBe('cd');
  expect(r.start).toBe(r.end);
});

test('table inserted with another table directly below keeps them apart', () => {
  const below = '| a | b |\n| - | - |\n| 1 | 2 |';
  for (const gap of ['', '\n']) {
    const r = run('table', 'x\n' + gap + below, 1);
    expect(r.value.slice(0, r.start)).toBe('x\n\n' + T + '\n\n');
    // The caret's line is empty and a blank line separates it from the table below.
    expect(r.value.slice(r.start)).toBe('\n\n' + below);
  }
  const r = run('table', below, 0);
  expect(r.value).toBe(T + '\n\n' + below);
  expect(r.start).toBe(T.length + 2);
});

test('list formats work on an empty line and keep indentation', () => {
  expect(run('bullet', '', 0)).toMatchObject({ value: '- ', start: 2, end: 2 });
  expect(run('numbered', 'a\n\nb', 2)).toMatchObject({ value: 'a\n1. \nb', start: 5 });
  expect(run('task', '', 0).value).toBe('- [ ] ');
  expect(run('bullet', '- ', 2).value).toBe('');
  expect(run('bullet', '  - a', 0, 5).value).toBe('  a');
  expect(run('numbered', '  - a', 0, 5).value).toBe('  1. a');
});

test('inline formats on a multi-line selection wrap each line, skipping blanks and list prefixes', () => {
  expect(run('bold', 'one\ntwo', 0, 7).value).toBe('**one**\n**two**');
  expect(run('bold', 'one\n\ntwo', 0, 8).value).toBe('**one**\n\n**two**');
  expect(run('italic', '- a\n- b', 0, 7).value).toBe('- *a*\n- *b*');
  expect(run('bold', '**one**\n**two**', 0, 15).value).toBe('one\ntwo');
  expect(run('bold', '**one**\ntwo', 0, 11).value).toBe('**one**\n**two**');
  expect(run('strike', 'ab cd\nef gh', 3, 8).value).toBe('ab ~~cd~~\n~~ef~~ gh');
});
