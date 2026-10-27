/**
 * The open-PR guard (story 9): which GitHub branches have an open pull request, in memory only (nothing is
 * persisted between launches). `useOpenPulls(active, tabId)` checks the active GitHub tab's branch when it opens or
 * is activated; tabs on the same branch share one entry, so they flip together. A failed check (offline, rate
 * limited) leaves what was known, so a tab that was editable stays editable. `checkNow` is the strict form
 * for Commit (it reports failure) and `markOpen` is what Open PR calls after Gonq opens a pull request.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { openPullForBranch, type GithubDocument, type OpenPull } from '../../platform/github';

export type BranchRef = Pick<GithubDocument, 'owner' | 'repo' | 'branch'>;

export const branchKey = (b: BranchRef): string => JSON.stringify([b.owner, b.repo, b.branch]);

/** The words for a refusal because a pull request is open; also the banner text. */
export const openPullMessage = (p: OpenPull): string => `Pull request #${p.number} is open for this branch. You can read this document but not change it.`;

export const PULL_CHECK_FAILED = 'Could not check for an open pull request; try again.';

export interface OpenPulls {
  /** The open pull request for a branch, from the last check; null when none (or not checked yet). */
  pullFor(b: BranchRef | null): OpenPull | null;
  /**
   * Asks GitHub now, records the answer for every tab on that branch and returns it. Rejects when the check
   * cannot complete (the recorded state is left as it was).
   */
  checkNow(b: BranchRef): Promise<OpenPull | null>;
  /** Records a pull request just opened for a branch, with no request, so its tabs turn read-only at once. */
  markOpen(b: BranchRef, pull: OpenPull): void;
}

export function useOpenPulls(active: BranchRef | null, tabId: number | null): OpenPulls {
  const [pulls, setPulls] = useState<Record<string, OpenPull>>({});
  // A newer check of a branch wins over an older one that answers late.
  const seq = useRef(new Map<string, number>());

  const checkNow = useCallback(async (b: BranchRef): Promise<OpenPull | null> => {
    const key = branchKey(b);
    const mine = (seq.current.get(key) ?? 0) + 1;
    seq.current.set(key, mine);
    const pull = await openPullForBranch(b.owner, b.repo, b.branch);
    if (seq.current.get(key) === mine) {
      setPulls((all) => {
        if (pull === null) {
          if (!(key in all)) return all;
          const { [key]: _gone, ...rest } = all;
          return rest;
        }
        const was = all[key];
        return was !== undefined && was.number === pull.number && was.url === pull.url && was.draft === pull.draft ? all : { ...all, [key]: pull };
      });
    }
    return pull;
  }, []);

  const markOpen = useCallback((b: BranchRef, pull: OpenPull) => {
    const key = branchKey(b);
    // Any check still in flight began before this pull request existed, so it must not overwrite it.
    seq.current.set(key, (seq.current.get(key) ?? 0) + 1);
    setPulls((all) => ({ ...all, [key]: pull }));
  }, []);

  const activeKey = active === null ? null : branchKey(active);
  useEffect(() => {
    if (active === null) return;
    // Offline or rate limited: stay as we were.
    checkNow(active).catch(() => {});
  }, [activeKey, tabId, checkNow]);

  const pullFor = useCallback((b: BranchRef | null) => (b === null ? null : (pulls[branchKey(b)] ?? null)), [pulls]);
  return { pullFor, checkNow, markOpen };
}
