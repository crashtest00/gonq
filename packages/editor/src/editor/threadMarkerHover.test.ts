/** The comment marker's :hover effect in styles/editor.css applies only inside @media (hover: hover). */
import { expect, it } from 'vitest';
import css from '../styles/editor.css?raw';

it('scopes the marker :hover rule to hover-capable devices', () => {
  const rules = css.split('\n').filter((l) => l.includes('.cm-thread-marker:hover'));
  expect(rules).toHaveLength(1);
  expect(rules[0].trimStart().startsWith('@media (hover: hover)')).toBe(true);
});
