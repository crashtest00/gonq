import { describe, expect, it } from 'vitest';
import css from '../styles/editor.css?raw';

// jsdom cannot measure layout (the real check is the Playwright cases in e2e/), but the cause of the
// below-table caret bug is plain in the stylesheet: CodeMirror leaves a block widget's vertical margins
// out of its height map, so the table wrapper must space itself with padding.
describe('table widget spacing', () => {
  const rule = css.split('\n').find((l: string) => l.includes('.cm-table-wrap {')) ?? '';

  it('uses vertical padding, not margin, on the block widget', () => {
    expect(rule).toMatch(/padding:\s*8px 0/);
    expect(rule.replace(/\/\*.*?\*\//g, '')).not.toMatch(/margin/);
    expect(rule).toMatch(/overflow-x:\s*auto/);
  });
});
