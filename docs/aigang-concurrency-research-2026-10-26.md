<!-- Redacted operator research notes: host paths, LAN address and session identifiers removed. AI Gang file:line references are to the AI Gang repository as installed on the build VM at the time. -->

# AI Gang concurrency and throughput: research notes, 2026-10-26

Written by the Claude Code session that orchestrated the Gonq "Review a repo file on GitHub" build.
Purpose: a self-contained resource for further (including theoretical) exploration of how AI Gang can run agents in parallel safely and ship faster.
Companion: `docs/aigang-field-notes-2026-10-26.md` records each change made, with rollback; this file explains the model, the measurements, the options weighed and what is still open.

## 1. System model

- **Agents.** Role agents (refinement, frontend, backend, devops) run as Claude Code sessions inside one container on a single 4-core VM. Each dispatch gets its own git worktree, so agents never share a working tree while running.
- **Unit of work.** A story is refined into implementation subtasks, each owned by one role agent. One subtask produces one PR to `dev`. The agent's session ends when it opens the PR and reports `completed`.
- **Pipeline.** Jenkins (2 executors, multibranch) scans GitHub, builds the PR (tests the merge of the PR head into `dev`), auto-merges on green (`gh pr merge --auto`, "require up to date" off), then a post-merge `dev` build promotes and deploys to Beta. Core moves the item to `in-review` when the deploy event names the PR.
- **Verification.** An independent QE pass (outside AI Gang today, run by the orchestrator) checks each subtask and story against its acceptance criteria, on the merged code and on Beta. Fail → rework round (a new PR from `dev`).
- **Dispatch.** ScrumMaster dispatches items that reach `ready`. Core gates `ready` on `blocks` links and releases `waiting-on-dependency` dependents when their blockers are done.

## 2. Where the time goes (measured)

A clean subtask cycle before the changes in this build, 50-70 min:

| Stage | Minutes | On the critical path? |
|---|---|---|
| Agent works, opens PR | 15-20 | yes |
| Jenkins scan wait (every 5 min) | 0-5 (twice: PR pickup, dev pickup) | yes |
| PR build | 8-14 (23 with Rust checks) | yes |
| Post-merge dev build (re-tests, then deploys) | 12-17 | yes, while the gate held the slot until QE |
| QE | 5-20 | yes, while the gate held the slot until QE |

Jenkins executor use (retained history, 138 merged PRs): PR builds 111 min, dev 311, leftover-branch builds 397, `beta` builds 195, release 75. **54% of executor time built things nobody read**: merged branches were never deleted, so each was rebuilt as a plain branch at the next scan, concurrently with the dev build (adding ~4.5 min to its tests on 4 cores; 4 of 24 such builds failed silently); the dev build's push to `beta` re-tested a tested tree; and in 85% of merges the dev build re-tested exactly the tree the PR build had tested (the PR build tests the merge commit; `dev` had not moved).

After the changes (section 6): the post-merge dev build skips the re-test on an exact tree match — **first live run 2.6 min vs 12-17** — `beta`/leftover builds skip Install/Test/Build, Rust checks run in parallel with the tests, and the scan runs every minute. The gate frees the slot at merge. Estimated critical path per subtask: agent (15-20) + scan (0-1) + PR build (8-14) ≈ 25-35 min.

## 3. Why "move every story to ready" made agents collide

Observed in two earlier builds; verified from logs, PR history and the session ledger:

- No item was ever dispatched twice, and agents never clashed on files **during** a session (separate worktrees).
- The collisions were **between pull requests**: two implementation subtasks ran at once, each branched from a `dev` without the other's change, and the PR that landed second went CONFLICTING. GitHub auto-merge then stops **silently**: nothing tells the agent or the operator. One PR sat 9.5 h.
- Conflict is a property of **two PRs open at the same time** touching nearby lines. A subtask that starts after the previous PR merged cannot conflict with it.
- Work items carry `writes_files`/`writes_services`, but nothing populates or reads them, so the platform has no overlap information.

## 4. Measuring conflict risk

**Method (replay).** For each pair of merged PRs from different sessions within 3 merges of each other, take PR A's diff and PR B's diff against their common base and run `git merge-file` on every file both touched; a non-clean merge counts as a conflict. This approximates "had these two run concurrently, would the second have conflicted". Scripts and raw data were kept by the operator (GitHub PR/file lists, Jenkins build histories).

**Results.**

| Era | Pairs | Conflicting |
|---|---|---|
| All history (PRs #1-#151) | 284 | 46 (16%) |
| Recent (#88+) | 118 | 10 (8.5%) |

**Hotspots.** Files touched by the most PRs (all 138 / last 60):

| File | All | Last 60 | Why it is touched |
|---|---|---|---|
| CLAUDE.md (project map) | 49 | 21 | Agents must update the map; the `src/editor` entry was one 2,357-character line, so any two PRs in that directory collided |
| src/App.tsx (831 lines, one component) | 37 | 9 | 27 of 37 PRs only wired a new menu prop; 23 added state, 25 a handler, 12 edited the keyboard switch, 7 mounted a dialog |
| src/components/MenuBar.tsx | 18 | 5 | Every new menu item edits the `MenuActions` interface, the destructuring and the JSX |
| src-tauri/src/lib.rs | 17 | 6 | One `generate_handler!` list; replay found only 1 conflict |
| e2e/smoke.spec.ts | 16 | 14 | New tests appended at the end of one file (all 3 recent conflicts there) |

**Projected conflict rate per concurrent pair** (replay with each change applied cumulatively, recent era / all history): today 8.5% / 16%; + generated project map 5.1% / 12%; + command registry and dialog host 3.4% / 9.2%; + per-feature test files ~1.7% / 7.7%. The remainder are genuine same-file feature edits that no restructuring removes. With 3 concurrent subtasks (3 pairs), P(at least one conflict) falls from ~23% to ~5%.

## 5. Deconfliction strategies weighed

| Strategy | Effect | Decision |
|---|---|---|
| **Generated project map** — a header comment in every source file is the source of truth; `npm run map` generates an untracked `PROJECT_MAP.md`; `npm run map:check` (inside `npm test`) fails the build on a missing header; `--json` emits `[{path, summary}]` | Removes the #1 hotspot; the map is always in sync with the tree | **Done** (Gonq dev 25e9a3b); agent definitions' Step 5 now says "keep your file headers accurate" |
| **Map in AI Gang's artifact store** | Concurrency-native in principle | **Proposed upstream** (field notes): today artifacts are human-uploaded whole files, last-write-wins, unlisted. Needs keyed entries, CAS/ETag, change events, listing; single writer = post-merge dev build publishing the generator's `--json` over Streams; librarian delivers a read-only map at dispatch |
| Per-directory CLAUDE.md | Fewer conflicts, not zero | Not taken |
| **Per-feature test files** + shared `renderApp()` helper; shared test files frozen | Removes append-at-end conflicts | **Done** (convention in CLAUDE.md and agent definitions) |
| **Command registry + DialogHost** — `defineCommand({id, menu, group, order, label, shortcut, enabled, run})`, features auto-loaded from `src/features/*/index.ts`; MenuBar and one keydown handler generated; `openDialog`/`registerDialog` | New features add files instead of editing App.tsx/MenuBar.tsx (would have covered 27 of 37 App.tsx PRs and all 18 MenuBar PRs). Modelled on CodeMirror facets | **In progress** as Gonq product stories (registry-1..4), each starting with a snapshot of the rendered menu tree that must stay identical |
| Rust plugin per module (`.plugin(github::init())`) | Removes `lib.rs`/`mod.rs` registration conflicts | Deferred (1 historical conflict; capability-name changes) |
| Overlap-aware gating (refinement declares files; allow parallel when disjoint) | Most parallelism with least risk | Open: needs refinement to populate `writes_files` reliably |

## 6. Concurrency control: design and evolution

1. **Serial gate** (ScrumMaster `maybeDispatch`): at most N implementation items of a project in flight (N = 1); refinement never held; a recent-dispatch window covers the gap before core records `in-progress`; held items dispatch by priority (lower number first) then age.
2. **Hold until QE** (in-review counted as in flight): prevented rework from overlapping the next item, but added 30-40 min per item and prevents no conflict. **Replaced by free-on-merge**: in flight = in-progress + needs-clarification; the slot frees when the PR merges.
3. **Conflict notice**: every 2 min, read the open PRs of in-progress items (from the `pull_request` artifacts the gateway records); when GitHub reports one conflicting, comment and move the item back to `ready`, once per PR head SHA. Turns a silent stall into a minutes-long round trip.
4. **Per-role limits** (in progress): limits per assignee role (frontend / backend / devops), read on every check from a config file so they change without a restart. Rationale below.

**Why per-role, not per-project.** Frontend and backend (Rust) subtasks touch disjoint trees (`src/` vs `src-tauri/`); with the map no longer shared, the only common file is the Rust command list (1 historical conflict). Allowing one of each in flight runs backend halves beside frontend work.

**Throughput model for the remainder of this build** (≈15 frontend, ≈5 backend, ≈1 devops subtasks; ≈35 min per clean cycle; dependency chains from `blocks` links):

| Setup | Estimate | Note |
|---|---|---|
| 1 in flight per project | 10-11 h | backend queues behind frontend |
| 1 frontend + 1 backend (+1 devops); 2 frontend after the registry | 6.5-7 h | frontend is the only bottleneck: ~5 serial items before the registry lands, then ~5 rounds two at a time |
| 2 frontend + 2 backend now | ~6-7 h on paper, worse in expectation | registry stories rewrite App.tsx (near-certain conflicts with concurrent UI stories); backend items all edit `github/mod.rs` and `lib.rs` (likely conflicts); only one backend overlap exists in the graph (~35 min once) |

## 7. Batching, considered and rejected for now

- **One PR per story** instead of per subtask: saves ~40% of PR builds (1.7 PRs per session recently) but coarsens QE, lengthens branches (more conflicts) and enlarges reworks.
- **Merge train / queue**: GitHub merge queue is unavailable (repository owned by a user account, not an organization); a home-made train reintroduces parallel branches and needs bisection on failure.
- **Stacked dispatch** (start the next item from the previous PR's head): breaks under squash merges and needs retarget/rebase steps agents do not have.
- Conclusion: remove CI waste and shorten the critical path first (section 2); keep one PR per subtask.

## 8. Failure modes observed (each cost real time)

| Failure | Mechanism | Suggested platform fix |
|---|---|---|
| False `failed` after a ScrumMaster restart | Gateway Tasks are in memory; reports for in-flight sessions were dropped as "Unknown task"; the reaper then failed the item and core never learned its PR | Persist Tasks (Redis) or rebuild them from core + the session ledger at startup |
| Dependents never released | Rollup to `done` skipped `_unblock_dependents` | Fixed locally (core) |
| Silent stall on a failed PR build | Agents cannot read Jenkins logs; the agent misdiagnosed a flaky test as a setup error, pushed nothing and asked for a re-run that nobody performed (1.5 h) | `pipeline_retry` should carry the failing test names and an excerpt; an agent's "please re-run" should trigger a rebuild or alert the operator |
| Stall after tests passed | Post-merge build failed on a network timeout during promote; item stuck `in-progress` | Retry infrastructure steps; comment on the item |
| Priority inversion | "Lower number = higher priority" and refinement creates subtasks at 0 | Document the scale; consider an explicit "critical path" flag |
| Rework for process misses | Agent definitions required `feature/` for every branch while refinement asked for `bugfix/`/`chore/`; the PR template had no place for criteria that ask for PR content | Fixed locally (agent definitions) |
| Flaky tests | Timing-dependent component tests fail under load on a shared 4-core box | Deterministic waits (settle helpers, waitFor on observable conditions); measure flake rates under contention in CI |

## 9. Open questions for exploration

1. **Overlap prediction.** Can refinement predict the files a subtask will touch well enough to gate on overlap (allow parallel when disjoint)? What precision is needed for the expected conflict cost to beat serial dispatch?
2. **Conflict economics.** With a conflict notice, a conflict costs one agent round trip (~20-30 min). At what conflict rate and cycle time does N=2 or N=3 maximise throughput? (Model: throughput gain vs P(conflict) × resolution cost, per role.)
3. **Speculative integration.** Could the platform test pairs of open PRs merged together (a private "integration preview") and only allow the second to proceed if the combination is green?
4. **Architecture as a concurrency lever.** Registries/facets turn central edits into new files. Which other central files (routing, settings schema, command registration in Rust) should every AI-Gang-built project structure this way from the scaffold?
5. **Project map as shared state.** Is the single-writer artifact-store design (post-merge build publishes per-path entries; librarian delivers at dispatch) sufficient, and how should a session see its own branch's new files?
6. **QE as part of the platform.** QE caught real regressions (a document-wiping undo, wrong numbering at depth 1+, missing paging). How should verification be scheduled so it stays off the critical path but still gates the next dependent story?
7. **Executor budget.** With CI waste removed, is the PR build or the agent now the bottleneck, and does a second Jenkins executor or a separate test runner change the optimum N?
8. **Flake management.** Should the pipeline automatically re-run a single failing test file once under lower load before failing a PR, and record flake statistics?
