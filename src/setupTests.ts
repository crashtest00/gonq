import '@testing-library/jest-dom/vitest';

// jsdom has no layout; CodeMirror measures text through these.
if (typeof Range !== 'undefined') {
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
}
