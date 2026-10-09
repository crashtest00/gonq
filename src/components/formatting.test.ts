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

test('table is inserted as its own block', () => {
  expect(run('table', '', 0).value).toBe('| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |');
  expect(run('table', 'text', 4).value).toBe('text\n\n| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |');
});
