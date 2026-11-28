/** The comment marker's :hover effect in styles/editor.css applies only inside @media (hover: hover); the active marker rule is paint-only (tokens, forced-colors fallback). */
import { expect, it } from 'vitest';
import css from '../styles/editor.css?raw';

it('scopes the marker :hover rule to hover-capable devices', () => {
  const rules = css.split('\n').filter((l) => l.includes('.cm-thread-marker:hover'));
  expect(rules).toHaveLength(1);
  expect(rules[0].trimStart().startsWith('@media (hover: hover)')).toBe(true);
});

it('the active marker rule only paints: no layout, transform or hover dependency, tokens only, with a forced-colors fallback', () => {
  const rules = css.split('\n').filter((l) => l.includes('.cm-thread-active'));
  expect(rules).toHaveLength(2);
  const [base, forced] = rules;
  expect(base).not.toMatch(/display|transform|margin|padding|text-indent|:hover|#[0-9a-f]{3,6}\b/i);
  expect(base).toContain('var(--primary-text)');
  expect(forced).toContain('@media (forced-colors: active)');
  expect(forced).toContain('outline');
});
