import { COALESCE_MS, createHistory, edit, isDirty, markSaved, redo, undo } from './history';

test('edit, undo and redo walk the text', () => {
  let h = createHistory('a');
  h = edit(h, 'ab');
  h = edit(h, 'abc');
  expect(undo(h).text).toBe('ab');
  expect(undo(undo(h)).text).toBe('a');
  expect(undo(undo(undo(h))).text).toBe('a');
  expect(redo(undo(undo(h))).text).toBe('ab');
});

test('a new edit clears the redo stack', () => {
  let h = edit(createHistory('a'), 'b');
  h = undo(h);
  h = edit(h, 'c');
  expect(redo(h).text).toBe('c');
});

test('edits with the same key in quick succession are one undo step', () => {
  let h = createHistory('');
  h = edit(h, 'a', 'k', 1000);
  h = edit(h, 'ab', 'k', 1200);
  h = edit(h, 'abc', 'k', 1200 + COALESCE_MS + 1);
  expect(undo(h).text).toBe('ab');
  expect(undo(undo(h)).text).toBe('');
  h = edit(h, 'abcd', 'other', 1300 + COALESCE_MS);
  expect(undo(h).text).toBe('abc');
});

test('dirty tracks the saved text, not the number of edits', () => {
  let h = createHistory('a');
  expect(isDirty(h)).toBe(false);
  h = edit(h, 'b');
  expect(isDirty(h)).toBe(true);
  expect(isDirty(undo(h))).toBe(false);
  h = markSaved(h, 'b');
  expect(isDirty(h)).toBe(false);
  expect(isDirty(undo(h))).toBe(true);
});
