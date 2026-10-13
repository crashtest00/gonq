<!-- Redacted copy of the operator's Gonq orchestrator skill (SKILL.md): host paths and LAN address removed. -->

---
name: gonq-orchestrator
description: Orchestrate a Gonq build on this VM — release stories in dependency order, start Jenkins PR builds, verify every subtask and story with an independent Sonnet Quality Engineer subagent, drive rework, and keep a build log. Use when the user asks to orchestrate, run or drive the Gonq build.
---

# Gonq orchestrator

You orchestrate Gonq, an AI Gang project on this VM. The goal is a fully built app: every buildable story done and verified. Keep work flowing, verify it independently, fix what you can, and log everything.

Invoking this skill is the owner's authorization to release Gonq stories and subtasks (move them to `ready`) for this run.

## Arguments

`$ARGUMENTS` may name:
- **Sessions to wait on**, each with what it does. Don't message them unless blocked on them; never take over their work.
- **Beta URL**. Default: the Beta host on port 8181 (`http://beta.<LAN address>.nip.io:8181`).
- **Build log path**. Default: `gonq-build-log.md` in the operator's home directory.

## Protect your context

- Don't read agent transcripts, build logs or PR diffs yourself. Delegate every review to a subagent and keep only its verdict.
- Check status by work item status (Django admin / core API) and PR state, roughly every 15–20 minutes, on a ScheduleWakeup or Monitor loop. No tight polling.
- Make every admin write as `claude-operator`, never as a human account.

## What to release (move to `ready`)

- Every Gonq story, in dependency order, one story at a time (agents share one `/workspace` in gonq-dev). Release a story only when the stories it depends on are `done`.
- Skip any story whose criteria need something only the owner can provide. Log each skip.
- No releases to production: the release-candidate job is known to be broken.

## The build chain, per subtask

1. When an agent opens a PR, start its Jenkins PR build (no webhook or polling here; builds are started by hand). Jenkins merges on green and deploys to Beta, and the subtask moves to `in-review`.
2. When a subtask reaches `in-review`, start a **Sonnet** subagent as Quality Engineer (prompt below) on its merged PR, against the **subtask's** acceptance criteria.
3. Pass: move the subtask to `done`. This also unblocks its dependents.
4. Fail: the subagent posts its report as a comment on the work item. Then move the subtask `in-review` → `in-progress`, which is what triggers rework (moving it to `ready` gives the wrong prompt). Add this line to the comment, because the rework prompt is wrong: "The original PR has merged. Cut a new branch from dev, open a NEW PR, and report `completed` through a2a-submit with that PR's URL."
5. At most 2 rework rounds per subtask. After that, park the item and log it for the owner.

## Per story

When every subtask of a story is `done`, start a **Sonnet** subagent to check the story on Beta against the **story's** acceptance criteria.

- Pass: move the story to `done`.
- Fail: create **one new subtask** under the story for the failing criteria. Assign it to the agent that owns that area, make its acceptance criteria the failing story criteria (verbatim), attach the QE report as a comment, and move it to `ready`. When it's `done`, re-run the story check. At most 2 fix subtasks per story; after that, park the story and log it.
- Criteria that come back `unverifiable` on Beta (native/desktop behaviour; Beta serves the web build): don't block the story on them. Move it to `done` if everything else passes, and list each unverifiable criterion in the log for the owner to check by hand.

## Quality Engineer subagent prompt (use for both levels)

> You are an independent, read-only verifier. Check <PR URL / Beta URL> against these acceptance criteria and nothing else: <criteria, verbatim>. Rules: judge only against the criteria as written, no other standard. For each criterion give exactly one verdict: pass, fail, ambiguous (list the possible readings, don't pick one) or unverifiable (your environment can't check it). Every pass or fail needs proof: file:line, a test name or command output. ambiguous and unverifiable never count as a pass. Don't trust the agent's own description of its work. Never edit code, push, or change any status. Return the per-criterion table.

At subtask level an item passes only if every criterion is pass. On an `ambiguous` verdict: pick the most reasonable reading, log the choice, and continue. Don't stall on it.

## Hard rules

- **AI Gang repo (local checkout):** you may fix local bugs that block the build. Never push, never open PRs against AI Gang's remote. Log every local change with its file path and a one-line summary of the diff, so it can be fixed properly upstream.
- Never run git commands that write in the agents' `/workspace`. Read-only.
- Never change GitHub settings or tokens. Change `.env` or Jenkins configuration only as a logged local fix, and only if it's blocking the build.
- Keep story and comment text within the agents' definitions. If the process can't do something, log it; never do an agent's work yourself.
- Check disk every hour (`df -h /`). At 85% or more:
  1. run `docker builder prune -f` once;
  2. wipe the Jenkins workspaces of closed-PR jobs (listed in `workspace/workspaces.txt`), never the `dev` or `beta` workspaces;
  3. log both. If still above 85%, pause releasing work and log it.
- If you're unsure whether an action is allowed, don't do it. Log it instead.

## Known AI Gang issues

- The DevOps agent may never report `completed`. If its PR has merged but the item hasn't moved for 30+ minutes, check the PR state and log it.
- Agents sometimes claim work they didn't do. That's why every item gets the independent check.

## Build log

Append to the build log path as you go, as a table: time (UTC), item, what happened, what you did. Include:
- every QE verdict summary;
- rework rounds and fix subtasks;
- skipped and parked items;
- every local AI Gang fix (path and summary);
- unverifiable criteria;
- any new AI Gang problem you saw.

End with three short lists:
- **Built and verified**
- **Needs the owner**
- **Local AI Gang changes to upstream**
