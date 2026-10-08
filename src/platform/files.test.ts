import { NotUtf8Error, decodeUtf8, isRemoteSource, resolveRelativePath } from './files';

test('decodeUtf8 round-trips text, keeping a BOM and CRLFs', () => {
  const text = '\uFEFF# Hi\r\n💬\r\n';
  expect(decodeUtf8(new TextEncoder().encode(text), 'a.md')).toBe(text);
});

test('decodeUtf8 rejects invalid UTF-8', () => {
  expect(() => decodeUtf8(new Uint8Array([0x23, 0x20, 0xff, 0xfe]), 'bad.md')).toThrow(NotUtf8Error);
});

test('resolveRelativePath is relative to the document folder', () => {
  expect(resolveRelativePath('/home/u/notes/a.md', 'img/x%20y.png')).toBe('/home/u/notes/img/x y.png');
  expect(resolveRelativePath('/home/u/notes/a.md', './x.png?v=1')).toBe('/home/u/notes/x.png');
  expect(resolveRelativePath('C:\\docs\\a.md', 'img\\x.png')).toBe('C:\\docs\\img\\x.png');
});

test('remote sources are recognised', () => {
  expect(isRemoteSource('https://e.com/a.png')).toBe(true);
  expect(isRemoteSource('data:image/png;base64,AA')).toBe(true);
  expect(isRemoteSource('img/a.png')).toBe(false);
});
