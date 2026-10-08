import { applyFormat } from './formatting';

const run = (f: Parameters<typeof applyFormat>[0], v: string, s: number, e = s) => applyFormat(f, v, s, e);

test('wraps and unwraps a selection', () => {
  expect(run('bold', 'a word b', 2, 6)).toEqual({ value: 'a **word** b', start: 4, end: 8 });
  expect(run('bold', 'a **word** b', 4, 8).value).toBe('a word b');
  expect(run('bold', 'a **word** b', 2, 10).value).toBe('a word b');
  expect(run('italic', 'x', 0, 0).value).toBe('**x');
  expect(run('strike', 'gone', 0, 4).value).toBe('~~gone~~');
});

test('link wraps the selection and selects the url', () => {
  const r = run('link', 'see docs now', 4, 8);
  expect(r.value).toBe('see [docs](https://) now');
  expect(r.value.slice(r.start, r.end)).toBe('https://');
  expect(run('link', '', 0).value).toBe('[text](https://)');
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
