/** The in-memory session branch list: add, list, remove, deduplication and isolation of the returned copies. */
import { beforeEach, describe, expect, it } from 'vitest';
import { addSessionBranch, clearSessionBranches, listSessionBranches, removeSessionBranch } from './sessionBranches';

const b = (branch: string, repo = 'notes', owner = 'octo') => ({ owner, repo, branch });

beforeEach(clearSessionBranches);

describe('session branch list', () => {
  it('starts empty', () => {
    expect(listSessionBranches()).toEqual([]);
  });

  it('lists added branches in order and dedupes', () => {
    addSessionBranch(b('gonq/a'));
    addSessionBranch(b('main'));
    addSessionBranch(b('gonq/a'));
    expect(listSessionBranches()).toEqual([b('gonq/a'), b('main')]);
  });

  it('tells apart owner, repo and branch', () => {
    addSessionBranch(b('main'));
    addSessionBranch(b('main', 'other'));
    addSessionBranch(b('main', 'notes', 'someone'));
    expect(listSessionBranches()).toHaveLength(3);
  });

  it('does not confuse separators inside names', () => {
    addSessionBranch({ owner: 'a', repo: 'b', branch: 'c/d' });
    addSessionBranch({ owner: 'a', repo: 'b/c', branch: 'd' });
    expect(listSessionBranches()).toHaveLength(2);
  });

  it('removes a branch and reports whether it was listed', () => {
    addSessionBranch(b('main'));
    expect(removeSessionBranch(b('main'))).toBe(true);
    expect(removeSessionBranch(b('main'))).toBe(false);
    expect(listSessionBranches()).toEqual([]);
  });

  it('hands out copies', () => {
    addSessionBranch(b('main'));
    listSessionBranches()[0].branch = 'changed';
    expect(listSessionBranches()).toEqual([b('main')]);
  });
});
