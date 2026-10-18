# AI Gang spec: parallel agent sessions and the Active Agent Roster

2026-10-18 · Doc: https://claude.ai/code/artifact/b10f340d-c3e3-4dd0-a320-2c1fbb505381 (the doc is the maintained copy; this file mirrors it, minus the lifecycle diagram). Previous version: `/home/gonq/deploy-bak-parallel-2026-10-18/spec-v1-2026-10-17.md`.

## Status

Built, tested and running on the Gonq install. Not pushed, not merged to `dev`. A project container now runs up to N agent sessions at once, each in its own git worktree. A session that stops without reporting is resumed with `claude --resume`, not dispatched again.

| | |
| --- | --- |
| Branch | `feat/parallel-agent-sessions`, local worktree `.claude/worktrees/bridge-cse_01MDoxBH1bQ99euTzVh7F9Cj` |
| Commits | `cbbf586` feature · `8abcbef` `AIGANG_MOUNT_SOURCE` · `78e9a7c` one dispatch per arrival at `ready` · `6eaecaf` reaper guard and stale-resume drop |
| Live since | 2026-10-18, `gonq-dev` at 2 slots |
| Live result | 3 subtasks, 1 dispatch and 0 resumes each, PRs #98–#100 merged |

Five changes make it work:

1. **Ack on start.** A task message is confirmed (`XACK`) when its session starts, not when it ends.
2. **One worktree per dispatch** at `/workspace/.wt/<dispatch id>`, with a container-wide session limit.
3. **Session ledger and Active Agent Roster.** Durable outcome per work item, plus a 90-second liveness key per running session.
4. **Reaper.** An `in-progress` item off the roster and unreported is resumed, at most twice, then reported failed.
5. **One dispatch per arrival at `ready`.** Keyed on the status-history row, claimed before the Task is touched.

## Background and evidence

Before this change, any agent session longer than 10 minutes was run again. Two layers disagreed about when a job was picked up.

| Layer | When it said "picked up" | Where |
| --- | --- | --- |
| Work item | Right after dispatch: ScrumMaster publishes `transitionStatus … in-progress` | `services/scrummaster/src/dispatchConsumer.js:155-177` |
| Agent stream entry | When the session ended: `await handler(…); await client.xAck(…)` | `setup/commons/tools/streams.js:284-285` (before) |

- **Reclaim ignored liveness.** Every 60 s the consumer ran `XAUTOCLAIM` with a 10-minute idle threshold. The old code admitted it reclaimed "regardless of whether it was a live first attempt or a genuine retry".
- **Each claim reset the clock**, so a 30-minute session queued two or three full re-runs behind itself.
- **Observed on gonq-dev:** ticket `72e5b6d8` started 7 times in a row, the first ending in the 30-minute timeout. 178 starts were logged in total.
- **A second source of duplicates, found in the live test:** an agent-created subtask emits `work_item.created` and then `work_item.status_changed` (proposed → ready) within milliseconds. Both read the item as `ready` and were dispatched under different keys. The old serial queue hid this by running the copy after the original.

Parallelism also needed more than lifting the serial queue:

- All sessions shared one `/workspace`, so a `git checkout` in one would switch the branch under another.
- The librarian delivered only into `projects/<name>/src`.
- Each dispatch replaced `~/.claude/skills` wholesale, which would empty it under a running session.

## Goals and non-goals

**Goals**

- No task runs twice by accident.
- Up to N sessions per container, set per project. N=1 behaves like the old one-at-a-time queue, minus the duplicates.
- An interrupted session continues where it stopped, with its context, instead of starting over.
- One place answers "which agent sessions are working right now, on what".

**Non-goals**

- Several containers per project consuming one role stream (open question 3).
- Surviving a container recreate with full context. Accepted as a risk by the owner on 2026-10-17.
- Changing how ScrumMaster chooses what to dispatch, or the one-story-at-a-time orchestration process.

## Design

The stream only delivers. Whether a session is alive is the roster's job, and what became of it is the ledger's job.

Session lifecycle: Dispatched (once per ready) → Queued (waits for a free slot) → Running (own worktree + roster) → Ended → Reported? Yes → Closed, worktree removed. No, or off the roster → Reaper resumes (`claude --resume`, max 2) in the same worktree, back to Queued; out of resumes → Reported failed, with a comment. A finished task is closed whether its report came from this session or an earlier one; only an unreported in-progress item is resumed.

### Ack on start and the session limit

- `createConsumer` (`setup/commons/tools/streams.js`) takes a shared `limiter`, a FIFO counting semaphore from `createLimiter(n)`. A consumer takes a slot **before** it reads, so a task beyond capacity stays undelivered in its stream.
- A handler may return `{ running: <promise> }`. The entry is acked as soon as the handler returns, and the slot is released when the promise settles.
- Reclaim runs inside the read loop, one entry per held slot. It now covers only what it was meant for: a handler that failed before starting, or a process that died between read and ack.
- `AGENT_MAX_CONCURRENT` (default 1) sets the per-container limit in `setup/subscriber.js`, shared by all four agent roles.

### One worktree per dispatch

- Path `/workspace/.wt/<dispatch message id>`, created by `git fetch` plus `git worktree add --detach … origin/<branch>` (`setup/agent-sessions.js`). Creation and removal are serialised.
- `AGENT_DEFAULT_BRANCH` names the branch; otherwise `origin/HEAD`, else `main`. Gonq's clone has no `origin/HEAD`, so it sets `dev`.
- `.wt/` is added to `.git/info/exclude`, so the shared clone stays clean.
- `/workspace` paths in the prompt and in the snapshotted Markdown are rewritten onto the worktree, and the session's `cwd` is set to it. `AIGANG_WORKSPACE` names it in the session env.
- Kept across resumes, because Claude Code files transcripts under the working directory (`~/.claude/projects/<cwd slug>/`).
- Removed with `git worktree remove` (never `--force`) once reported. A sweep after every session, and at startup, removes trees no open ledger entry names. A tree this process is creating is claimed, so a sweep can't race its creation.
- The librarian takes an optional `workspace` field (`.wt/<name>`) and delivers into that worktree (`services/core/librarian/paths.py`). `.wt` is skipped by the content search, so one session's copy is never another's answer.
- Skills install by rename, and are skipped when the commons version is unchanged (`setup/dispatch-snapshot.js`).

### Session ledger and Active Agent Roster

| Record | Key | Lifetime | Written by |
| --- | --- | --- | --- |
| Ledger (hash) | `aigang:session:{project}:{workItemId}` | Durable; one per work item, replaced by each new dispatch | ScrumMaster `queued` · subscriber `running` / `ended` + `exit` + `claudeSessionId` · gateway `reported` |
| Open set | `aigang:sessions:open` (`project/workItemId`) | Until the reaper closes the entry | Subscriber and ScrumMaster add; reaper removes |
| Roster (string) | `aigang:roster:{project}:{workItemId}` | `EX 90`, refreshed every 30 s while the process lives | Subscriber |

The ledger is keyed per **work item**, not per dispatch (the earlier draft said per dispatch). A work item has one live dispatch at a time, and this key lets the gateway mark `reported` without dispatch-id plumbing. `role` is the stream suffix (`frontend`, `backend`, …). The roster is readable at `GET /roster?project=` on ScrumMaster (port 9000, Docker network only).

### The reaper

ScrumMaster runs `reapOnce` every 60 s over the open set (`services/scrummaster/src/agentSessions.js`, `decide()`):

| Situation | Action |
| --- | --- |
| Ledger `reported`, or the A2A Task is already terminal or interrupted | Close (once the process is gone) |
| Work item not `in-progress` | Close |
| `queued` | None: waiting for a slot |
| `running`, on the roster | None |
| `running`, off the roster two passes in a row | Resume, reason `session_lost` |
| `ended`, more than 60 s ago | Resume, reason = exit (`timeout`, `exit_code_n`) or `ended_without_report` |
| Resume needed, `resumes` ≥ `AGENT_MAX_RESUMES` (2) | Publish terminal `failed` via the gateway, close |

A resume is a `kind=task` envelope whose message carries `metadata.aigangResume`. The subscriber then:

1. **Drops it** if the ledger entry has since been reported or closed.
2. **Resumes:** otherwise runs `claude --resume <claudeSessionId>` in the same worktree. The prompt is a note saying why it stopped and where the snapshot files now are.
3. **Restarts:** if the transcript or the tree is gone, it starts a fresh session with the note plus the original prompt.

`A2A_LAST_MESSAGE_ID` stays the original dispatch's message id, so reports keep their lineage.

### One dispatch per arrival at ready

`maybeDispatch` keys a dispatch on the status-history row that moved the item to `ready` (`ready:<item>:<row id>`), not on the event's envelope id. `dispatchTask` claims that key in Redis (`SET NX`, 7 days) **before** touching the in-memory Task. A duplicate therefore neither publishes nor reopens the Task. A later return to `ready` has a new row, so it is a new dispatch.

## Requirements

REQ-01 to REQ-18 are implemented, except REQ-10's admin page.

| ID | Requirement | Where |
| --- | --- | --- |
| REQ-01 | Ack a task entry once its session has spawned and its ledger reads `running`, before awaiting the session. | `streams.js` `processEntry`; `subscriber.js` `startSession` |
| REQ-02 | Read at most as many entries as there are free slots; extra entries stay undelivered. | `streams.js` `createLimiter`, read loop |
| REQ-03 | Each dispatch runs in `/workspace/.wt/<dispatch id>`, detached at `origin/<branch>`, with `cwd` set to it. | `agent-sessions.js` `createWorktree` |
| REQ-04 | `/workspace` paths in the prompt and snapshotted Markdown point at the worktree; `AIGANG_WORKSPACE` is set. | `rewriteWorkspacePaths`, `rewriteSnapshotWorkspace` |
| REQ-05 | The librarian delivers into the requesting session's worktree, with containment rooted there. | `librarian/paths.py`, `delivery.py`, `content.py` |
| REQ-06 | Definitions branch from `origin/<branch>` without checking it out. | `setup/agents/frontend-agent.md`, `backend-agent.md` |
| REQ-07 | ScrumMaster writes `queued`; the subscriber writes `running`/`ended`, `exit`, `claudeSessionId` (passed as `--session-id`). | `agentSessions.recordQueued`; `agent-sessions.js` |
| REQ-08 | The gateway sets `reported` when the agent submits a terminal or interrupted state. | `gateway.js` `handleA2ASubmission` |
| REQ-09 | While the session's process lives, its roster key is set (`EX 90`, refreshed every 30 s), and it is deleted on exit. | `agent-sessions.js` `joinRoster` |
| REQ-10 | Roster readable via ScrumMaster `GET /roster`. **Admin page not built.** | `server.js` |
| REQ-11 | The reaper applies the decision table every 60 s. | `agentSessions.js` `decide`, `reapOnce` |
| REQ-12 | A resume runs `claude --resume` in the same worktree, or a fresh session with the note and original prompt when the transcript or tree is gone. | `subscriber.js` `planSession` |
| REQ-13 | A subscriber ignores a resume for a session running here, and drops one whose ledger entry is reported or closed. | `subscriber.js` |
| REQ-14 | After `AGENT_MAX_RESUMES` (2), report terminal `failed` with a comment. | `agentSessions.js` `publishFailure` |
| REQ-15 | `AGENT_MAX_CONCURRENT` (default 1) bounds sessions per container. | `subscriber.js` |
| REQ-16 | Worktrees are removed without `--force` once closed; sweeps never remove a claimed tree. | `agent-sessions.js` `sweepWorktrees` |
| REQ-17 | One dispatch per arrival at `ready`: key on the status-history row and claim before touching the Task. | `dispatchConsumer.js` `readyTransitionId`; `handlers.js` `claimDispatch` |
| REQ-18 | The reaper never resumes or fails a session whose A2A Task is already terminal or interrupted. | `agentSessions.js` `decide` (`taskState`) |

## Agent definition changes

One change, to branching only. git checks out a branch in at most one worktree, so `git checkout main` fails as soon as two sessions run.

- `setup/agents/frontend-agent.md` and `backend-agent.md`, step 2: `git checkout main && git pull` + `git checkout -b …` became `git fetch origin` + `git checkout -b feature/<reference>-short-description origin/main`, with a line saying why.
- `/workspace` references stay as written; the subscriber rewrites them onto the worktree.
- Gonq's local overlays (`/home/gonq/gonq-overrides/agents/*.md`) already used `git checkout -B … origin/dev`, so they needed no change.

## Verification

All suites pass. The second live run showed 1 dispatch and 0 resumes per subtask.

| Check | Result |
| --- | --- |
| ScrumMaster suite | 237/237 (21 new) |
| Container-side suite (`setup/commons/tools/test.sh`) | 159/159 (new `streams.test.js`, `agent-sessions.test.js`) |
| Librarian suite | 77/77 (5 new, `test_librarian_workspace.py`) |
| Integration: real `subscriber.js` + real reaper, stand-in `claude`, 2 slots, 3 tasks | 8/8 runs after one fix: peak 2 concurrent, own worktree each, unreported task resumed with `--resume <same id>` in the same tree, no duplicates |
| Real Claude Code 2.1.293 in `gonq-dev` | `--session-id` + `--resume` with stdin work; resumed session recalled an earlier word |

**Bugs found and fixed:**

| Found by | Bug | Fix |
| --- | --- | --- |
| Integration run | A session ending swept the next session's just-created worktree (`ENOENT uv_cwd`) | Claim trees on creation; the sweep checks the claim inside the creation lock (in `cbbf586`) |
| Live run 1 | Agent-created subtasks dispatched twice (pre-existing); each copy ran a full session and opened duplicate PR #95 | `78e9a7c` (REQ-17) |
| Live run 1 | Duplicates reset `reported`, and the reaper resumed then **failed** completed tasks `e9f2892e` and `46ccd441` | `6eaecaf` (REQ-18) |
| Live run 1 | A resume queued before the reaper closed its entry still ran, and restarted in a fresh tree | `6eaecaf` (REQ-13) |

**Live run 2 (fixed build):**

- 3 stories, each producing one agent-created subtask (`6a92ef49`, `c6af691d`, `368b3399`): 1 dispatch and 1 session each, all `ok` + reported, 0 resumes.
- PRs #98, #99 and #100 all merged. Two sessions overlapped throughout, and the third waited for a slot.
- A merge-conflict rework of `418da14e` dispatched once.
- One claim key per subtask in Redis. No `Skipped duplicate` lines, so the duplicate race did not recur in this run, and the claim path is covered by its regression test only.

## Deployment on this install

ScrumMaster and the librarian run images built from the branch. `gonq-dev` runs the new subscriber from a staged copy, because the container could not be recreated.

| Component | How it is deployed | Rollback |
| --- | --- | --- |
| ScrumMaster | Image `scrummaster-scrummaster:latest` built from `6eaecaf`, recreated with `docker compose up -d --no-build` | `:parallel-v1` (before the fixes), `:pre-parallel` (before the branch) |
| Librarian | Image `core-librarian:latest` built from the branch | `core-librarian:pre-parallel` |
| `gonq-dev` subscriber | pm2 runs `/opt/aigang-setup/subscriber.js`: a static copy of the branch's `setup/` plus Gonq's three agent overlays. Env `AIGANG_MOUNT_SOURCE=/opt/aigang-setup AGENT_MAX_CONCURRENT=2 AGENT_DEFAULT_BRANCH=dev` | `pm2 delete subscriber && pm2 start /agent-docs/subscriber.js --name subscriber` (as `aigang`, in `/workspace`); previous copy at `/opt/aigang-setup.prev` |

**Why `gonq-dev` was not recreated:**

- The running container's image is gone (`docker commit` failed: content digest not found).
- `gonq-dev:latest` is an older image, without the Rust toolchain installed at runtime (`~/.rustup` 1.7 GB, `~/.cargo` 692 MB).
- `AIGANG_MOUNT_SOURCE` (`8abcbef`) lets the snapshot come from the staged copy. Agents are still given `/agent-docs` paths.

**Operating rules while deployed:**

- Don't restart or recreate `gonq-dev`, or pm2-start from `/agent-docs`: either one rolls back to the old subscriber.
- Re-stage `/opt/aigang-setup` after any change to `setup/` or `/home/gonq/gonq-overrides`.
- Restart ScrumMaster only when no session runs: its A2A Task store is in memory, and a restart drops in-flight reports.

Backups are in `/home/gonq/deploy-bak-parallel-2026-10-18/`.

## Risks, gaps and open questions

**Accepted risks**

- **Container recreate loses transcripts.** `~/.claude` is not on a volume in `gonq-dev`. Worktrees survive in the bind mount, so a resume falls back to a fresh session there. Mounting `~/.claude/projects` on a volume would remove the risk.
- **Redis restart loses roster keys** until the next 30-second refresh. The two-pass rule and REQ-13 stop a live session being resumed beside itself.

**Known gaps**

- **Slot order is not FIFO across roles.** Free slots rotate between the per-role consumers, not by message age. The wait is bounded.
- **No Django admin roster page** (REQ-10); `GET /roster` is the only view.
- **The duplicate-dispatch claim is unexercised live** (see Verification).
- **Agents cannot reach Jenkins from the container**, so a rework for a failed build cannot read the console. This gap predates the branch.

**Open questions**

1. **Ports.** Parallel sessions collide on fixed dev-server and test ports. A per-slot `PORT` offset, or port 0 in test setups?
2. **Dependencies.** Each worktree runs its own `npm ci`; disk went from 67% to 73% in the first run. Keep it, or share an install?
3. **Several containers per project.** A resume must reach the container holding the worktree and transcript. Per-container streams, or one container per project as a rule?
4. **Model limits.** What N is safe on one `oauth-token` subscription before rate limits slow every session?
5. **More uses of the roster.** Dispatch only when a slot is free; orchestrator status from the roster; live capacity on the A2A agent card.
