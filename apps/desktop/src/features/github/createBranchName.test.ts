/** validateBranchName: the table of accepted and rejected short branch names. */
import { describe, expect, it } from 'vitest';
import { validateBranchName } from './createBranch';

describe('validateBranchName', () => {
  it.each([
    ['fix', true],
    ['a/b', true],
    ['feature/x-1_2.3', true],
    ['@x', true],
    ['x@y', true],
    ['日本語/ブランチ', true],
    ['a'.repeat(300), true],
    ['', false],
    ['a b', false],
    [' a', false],
    ['a\tb', false],
    ['a\u0001b', false],
    ['a\u007fb', false],
    ['a..b', false],
    ['a~b', false],
    ['a^b', false],
    ['a:b', false],
    ['a?b', false],
    ['a*b', false],
    ['a[b', false],
    ['a\\b', false],
    ['a@{b', false],
    ['@', false],
    ['/a', false],
    ['a/', false],
    ['.a', false],
    ['a.', false],
    ['a//b', false],
    ['x.lock', false],
    ['a.lock/b', false],
    ['a/b.lock', false],
    ['a/.b', false],
  ])('%j -> valid %s', (name, ok) => {
    const reason = validateBranchName(name);
    if (ok) expect(reason).toBeNull();
    else expect(reason).toEqual(expect.any(String));
    if (!ok) expect(reason!.length).toBeLessThan(40);
  });
});
