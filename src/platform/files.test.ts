import { NotUtf8Error, decodeUtf8 } from './files';

test('decodeUtf8 round-trips text, keeping a BOM and CRLFs', () => {
  const text = '\uFEFF# Hi\r\n💬\r\n';
  expect(decodeUtf8(new TextEncoder().encode(text), 'a.md')).toBe(text);
});

test('decodeUtf8 rejects invalid UTF-8', () => {
  expect(() => decodeUtf8(new Uint8Array([0x23, 0x20, 0xff, 0xfe]), 'bad.md')).toThrow(NotUtf8Error);
});
