/**
 * The branches Gonq has committed to in this session, in memory only (nothing is persisted): `add`, `list` and
 * `remove` of owner/repo/branch triples, deduplicated. Every successful commit adds its branch; story 9 (the
 * open-PR refusal) and later stories read the list.
 */
export interface SessionBranch {
  owner: string;
  repo: string;
  branch: string;
}

const key = (b: SessionBranch) => JSON.stringify([b.owner, b.repo, b.branch]);

const branches = new Map<string, SessionBranch>();

/** Adds a branch; adding one that is already listed changes nothing. */
export function addSessionBranch(b: SessionBranch): void {
  const k = key(b);
  if (!branches.has(k)) branches.set(k, { owner: b.owner, repo: b.repo, branch: b.branch });
}

/** The listed branches in the order they were added (copies). */
export function listSessionBranches(): SessionBranch[] {
  return [...branches.values()].map((b) => ({ ...b }));
}

/** Removes a branch; true when it was listed. */
export function removeSessionBranch(b: SessionBranch): boolean {
  return branches.delete(key(b));
}

/** Empties the list (tests). */
export function clearSessionBranches(): void {
  branches.clear();
}
