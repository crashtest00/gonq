# AI Gang field notes: release tag follows the app version, 2026-11-28

Written by Claude (claude-operator) while preparing Gonq's next version update, at the owner's request.
This change was made in the local AI Gang install only (`~/ai-gang` `dev`, commit `0c0e1b9`, not pushed).
The owner can pass it to AI Gang source.

## Finding

| # | Problem | Mechanism | Seen on | Fix applied locally | Suggested upstream fix |
|---|---|---|---|---|---|
| 1 | The release tag ignores the app's version, so the next release would have shipped as `v0.1.6` with 0.2.0 installers | `jenkins/scripts/tag-desktop-release.sh` tagged the last `v*` tag + 1 patch. M-33 set every Gonq version field to 0.2.0, and the last tag is `v0.1.5`. So promote would tag `v0.1.6`: installers and About would read 0.2.0, and `release-mobile.yml` would derive versionCode 1006 from the tag while `tauri.conf.json` says 2000. | Gonq `dev` at d3c1328 (no release since RC12, v0.1.5) | The script now tags `v<root package.json version>` at the candidate. | Same change upstream (commit `0c0e1b9` on the local `dev`). |

## What the script does now

- Reads `version` from the root `package.json` at `CANDIDATE_SHA`, and tags `v<version>`.
- Fails the production-promote job (so its failure comment is posted on the Release) when the version:
  - is not `MAJOR.MINOR.PATCH`;
  - is already tagged on a different commit (the bump story was missed);
  - is not above the latest `v*` tag.
- A re-run for the same candidate is a no-op that reports the existing tag.
- A project whose `package.json` has no version keeps the old rule (last tag + 1 patch).

## Effect on Gonq

- The next release tags `v0.2.0`, and no bump story is needed for it, because `dev` already says 0.2.0 and it was never released.
- Every later release still needs a bump story before the RC. A missed bump now fails the promote job, where before it shipped a mismatched release.
- `docs/gonq-mobile-stories-2026-10-29.md` (M-33, "Promote auto-tags `vX.Y.Z+1`") describes the old rule. That plan is historical and was left unchanged.
