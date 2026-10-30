/** No feature module imports isTauri: nothing is hidden or disabled by platform. */
const sources = import.meta.glob('./**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

test('no feature module imports isTauri: nothing is hidden or disabled by platform', () => {
  const files = Object.entries(sources).filter(([name]) => !name.endsWith('.test.ts'));
  expect(files.length).toBeGreaterThanOrEqual(3);
  for (const [name, source] of files) expect(source, name).not.toMatch(/isTauri/);
});
