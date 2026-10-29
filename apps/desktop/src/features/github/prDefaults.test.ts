/** Fixtures for defaultPrTitle and defaultPrBody (branch edges, templates, escaping, truncation, big numbers). */
import { describe, expect, it } from 'vitest';
import { defaultPrBody, defaultPrTitle, type PrFile } from './prDefaults';

const file = (filename: string, o: Partial<PrFile> = {}): PrFile => ({
  filename,
  status: 'modified',
  additions: 1,
  deletions: 2,
  ...o,
});
const body = (files: PrFile[]) => defaultPrBody({ source: 'gonq/a', target: 'main', files });

describe('defaultPrTitle', () => {
  it('removes one leading gonq/ only', () => {
    expect(defaultPrTitle('gonq/fix-it')).toBe('fix-it');
    expect(defaultPrTitle('gonq/gonq/x')).toBe('gonq/x');
    expect(defaultPrTitle('feature/x')).toBe('feature/x');
    expect(defaultPrTitle('xgonq/x')).toBe('xgonq/x');
  });
  it('does not crash on empty or prefix-only branches', () => {
    expect(defaultPrTitle('')).toBe('');
    expect(defaultPrTitle('gonq/')).toBe('gonq/');
  });
});

describe('defaultPrBody', () => {
  it('handles no files', () => {
    expect(body([])).toBe('Merging gonq/a into main\n\n0 files changed, +0 −0\n\nOpened from Gonq');
  });
  it('handles one file (singular)', () => {
    expect(body([file('src/a.ts')])).toBe(
      'Merging gonq/a into main\n\n1 file changed, +1 −2\n\n- modified: src/a.ts (+1 −2)\n\nOpened from Gonq',
    );
  });
  it('lists every status and renamed old → new', () => {
    const out = body([
      file('a', { status: 'added', additions: 5, deletions: 0 }),
      file('b', { status: 'removed', additions: 0, deletions: 7 }),
      file('new.ts', { status: 'renamed', previous_filename: 'old.ts', additions: 0, deletions: 0 }),
    ]);
    expect(out).toContain('3 files changed, +5 −7');
    expect(out).toContain('- added: a (+5 −0)');
    expect(out).toContain('- removed: b (+0 −7)');
    expect(out).toContain('- renamed: old.ts → new.ts (+0 −0)');
  });
  it('keeps zero-change files', () => {
    expect(body([file('z', { additions: 0, deletions: 0 })])).toContain('- modified: z (+0 −0)');
  });
  it('escapes markdown, pipes, backticks, mentions and links', () => {
    const out = body([file('a b|c`d*e_f@g [x](y) <z> héllo 文.md'), file('www.evil.com'), file('http://x.y')]);
    expect(out).toContain('a b\\|c\\`d\\*e\\_f\\@g \\[x\\]\\(y\\) \\<z\\> héllo 文.md');
    expect(out).toContain('www\\.evil.com');
    expect(out).toContain('http\\://x.y');
  });
  it('flattens newlines in names', () => {
    expect(body([file('a\nb')])).toContain('- modified: a b (+1 −2)');
  });
  it('cuts at 200 files with an accurate remainder line', () => {
    const files = Array.from({ length: 250 }, (_, i) => file(`f${i}.ts`));
    const out = body(files);
    expect(out).toContain('250 files changed, +250 −500');
    expect(out.match(/^- modified:/gm)).toHaveLength(200);
    expect(out).toContain('\n…and 50 more files\n\nOpened from Gonq');
  });
  it('says "1 more file" in the singular', () => {
    expect(body(Array.from({ length: 201 }, (_, i) => file(`f${i}`)))).toContain('…and 1 more file\n');
  });
  it('stays under 60,000 characters with long names, keeping footer and count accurate', () => {
    const files = Array.from({ length: 200 }, (_, i) => file(`${'d/'.repeat(240)}${i}`));
    const out = body(files);
    expect(out.length).toBeLessThanOrEqual(60_000);
    const shown = out.match(/^- modified:/gm)!.length;
    expect(shown).toBeLessThan(200);
    expect(out).toContain(`…and ${200 - shown} more files`);
    expect(out.endsWith('\n\nOpened from Gonq')).toBe(true);
  });
  it('shortens absurdly long names and branches', () => {
    const out = defaultPrBody({ source: 'b'.repeat(100_000), target: 't', files: [file('x'.repeat(100_000))] });
    expect(out.length).toBeLessThan(2000);
  });
  it('formats very large and invalid counts', () => {
    const out = body([
      file('big', { additions: 1e21, deletions: 123456789 }),
      file('bad', { additions: NaN, deletions: -4 }),
    ]);
    expect(out).toContain('+1,000,000,000,000,000,000,000 −123,456,789');
    expect(out).toContain('- modified: bad (+0 −0)');
  });
});
