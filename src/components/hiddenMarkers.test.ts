import { expect, test } from 'vitest';
import { editHidden, hideMarkers, shownToSource } from './hiddenMarkers';

const A = '[💬](#md-thread-aaa)';
const B = '[✅](#md-thread-bbb)';
const src = `one ${A} two ${B} three`;

test('markers collapse to their glyph', () => {
  expect(hideMarkers(src)).toBe('one 💬 two ✅ three');
  expect(hideMarkers('plain')).toBe('plain');
});

test('typing leaves markers untouched', () => {
  expect(editHidden(src, 'one X💬 two ✅ three')).toBe(`one X${A} two ${B} three`);
  expect(editHidden(src, 'one 💬X two ✅ three')).toBe(`one ${A}X two ${B} three`);
  expect(editHidden(src, 'one 💬 two ✅ three!')).toBe(`${src}!`);
});

test('deleting a glyph removes exactly that marker', () => {
  expect(editHidden(src, 'one  two ✅ three')).toBe(`one  two ${B} three`);
  expect(editHidden(src, 'one 💬 two  three')).toBe(`one ${A} two  three`);
});

test('replacing across a marker removes it whole', () => {
  expect(editHidden(src, 'one X three')).toBe('one X three');
});

test('deleting text bordering a marker keeps it', () => {
  expect(editHidden(src, 'one💬 two ✅ three')).toBe(`one${A} two ${B} three`);
});

test('offsets map back to the source', () => {
  expect(shownToSource(src, 4)).toBe(4);
  expect(shownToSource(src, 6)).toBe(4 + A.length);
  expect(shownToSource(src, hideMarkers(src).length)).toBe(src.length);
});
