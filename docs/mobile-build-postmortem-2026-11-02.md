<!-- Redacted operator notes: host paths, LAN addresses and session identifiers removed. Token figures were totalled from agent transcripts on the build VM; see "Method and caveats". -->

# Post-mortem: the Gonq mobile build, 2026-10-27 to 2026-11-02

Scope: how the Android-first mobile app was planned and built with AI Gang and Claude agents, with particular emphasis on **token spend**. Product details are in `docs/gonq-mobile-stories-2026-10-29.md`. Platform findings are in `docs/aigang-field-notes-2026-10-29.md` and `docs/aigang-multi-repo-gaps-2026-10-27.md`.

## Summary

- **Outcome.** 31 of the 33 active stories were merged and independently QE'd by the time orchestration was handed to the owner (M-08 was deferred). M-33 (version bump to 0.2.0) and M-34 (Android acceptance) remain. 54 pull requests (#226 to #279) merged to `dev`, and a debug-signed Android APK builds in CI. The walking skeleton (real GitHub device-flow sign-in, Keystore-backed token, survives force-stop) passed on an emulator.
- **Cost.** About **931 million tokens** were processed across all agents (counting cache reads and writes, see caveats). **48%** of that was the first orchestrator alone. About **54%** was on Opus.
- **Main cause.** Not the amount of work per turn: **context size**. The first orchestrator ran 984 turns, and its context grew to about 752K tokens that were re-read on every turn (average 458K per turn). A second orchestrator doing the same job averaged 93K per turn.
- **Operational cost.** The owner's usage limit stopped the first orchestrator **six times**, the weekly all-models quota reached 100%, and each stop left orchestration down until someone resumed it, with lost QE and re-run subtasks. The second orchestrator then stalled silently for about 7 hours with work waiting.

## Timeline (Central time, approximate)

| When | Event |
|---|---|
| Oct 27 | Evaluation: React Native versus Tauri 2 mobile versus native. Decision: Tauri 2, reuse the Rust backend. |
| Oct 28 | AI Gang multi-repo review. Decision: one repo with Cargo and npm workspaces (PR #211 documents the platform gaps). |
| Oct 29 AM | 34-story plan merged (PRs #224, #225). Mockup audited against desktop; 74 defects found; mockup rewritten; decisions D1 to D10. |
| Oct 29 4 PM | Orchestrator #1 (Opus) starts: files 34 stories with dependency links, runs M-01. |
| Oct 29 to 30 | M-01 to M-04 serial (each about 1.5 to 2 h end to end). Parallel phase from 12:15 AM Oct 30. |
| Oct 30 | Three usage-limit stops (4:10 AM, 11:30 AM, 4:30 PM resets). M-09 unblocked after a stale dependency link was deleted. Evening: walking skeleton (M-13) passes after the owner approves a device code. |
| Oct 30 to 31 | Three more stops (9:30 PM, 7:30 AM, 12:30 PM resets). UI stories M-17 to M-31 land one at a time on a single frontend slot. |
| Oct 31 2 PM | Owner stops orchestrator #1 (about 3% of quota left). |
| Nov 1 10:05 PM | Orchestrator #2 (Sonnet, standalone tmux session) starts. Blocked about 1.5 h on a permission prompt; relaunched with allowed directories. |
| Nov 2 12:34 to 7:32 AM | Orchestrator #2 idles about 7 h with no watcher armed while M-23 and M-27 merge unverified. Nudged; closes M-31, M-27, M-23; stops at the owner's request. |

## Token spend

### By actor (cumulative, transcript totals)

| Actor | Model | Turns | Tokens | Share |
|---|---|---|---|---|
| Orchestrator #1 | Opus | 984 | 450.4M | 48.4% |
| AI Gang dev agents (108 sessions) | Sonnet | 3,153 | 209.0M | 22.5% |
| Coordinating session (planning, relaying, merging) | Sonnet | 495 | 138.4M | 14.9% |
| Helper agents for planning and design (6 agents) | Opus, Sonnet, Fable | 461 | 78.9M | 8.5% |
| QE agents launched by orchestrator #1 (38 agents) | Sonnet | 696 | 46.1M | 5.0% |
| Orchestrator #2 | Sonnet | 87 | 8.1M | 0.9% |
| **Total** | | **5,876** | **about 931M** | |

Shares are rounded. The helper agents were: story breakdown and revision (5.8M), mockup audit (20.0M), mockup fixes (29.0M), story-doc update (3.0M), extra frames (19.9M) and a multi-repo opinion (1.2M).

### What the tokens were

Across every actor, **cache reads dominate**. For orchestrator #1: 329.3M cache reads (73%), 121.1M cache writes (27%), 15K output tokens. Tokens are mostly the cost of re-reading the conversation on every turn, so cost scales with **turns multiplied by context size**.

| Actor | Average context re-read per turn |
|---|---|
| Orchestrator #1 | 458K |
| Coordinating session | 280K |
| Mockup-fixes agent (Opus) | 238K |
| Orchestrator #2 | 93K |
| Dev agents and QE agents | 66K |

At its last turn orchestrator #1's context was **752K tokens**. About 840 KB of tool results (roughly 210K tokens) and 466 KB of tool-call inputs (roughly 116K tokens) were in its history, mostly from 607 Bash calls and 17 file reads, and the rest was unattributed. It also loaded about 30 memory notes at the start.

### What drove it

1. **One long-lived orchestrator transcript, resumed many times.** Every resume re-read the full history. Orchestrator #2 did a comparable job at about a fifth of the per-turn cost.
2. **Opus for orchestration.** Opus accounted for about 505M tokens (54%). Most orchestration turns were bookkeeping (read tracker, run a script, log a line) that did not need it.
3. **Polling and chatter through the model.** Waiting on builds, PRs and QE was often done with model turns instead of shell watchers, and each turn re-read the whole context.
4. **A relaying middleman.** The coordinating session re-read about 280K tokens per turn to pass messages between the owner and the orchestrator.
5. **Re-running work after limit stops.** Work dispatched during a limit window failed with exit code 1 and ran again. M-22, M-27 and M-31's frontend each ran twice. A QE verdict lost at a stop was re-run.
6. **Verification layers.** A subtask QE, a story QE and sometimes a re-QE after rework: about 38 QE agents, 46M tokens. This was worth it (QE caught real defects: M-07 status bar, M-13 Copy code and dark mode, M-09 SDK pins, M-24 and M-27 rework), but their briefs could be tighter.
7. **Design iteration.** The mockup took an audit (20M), a rewrite (29M) and extra frames (20M): about 69M tokens. The desktop-wins rule found 74 defects the first mockup carried, so this prevented building the wrong behavior.
8. **Large agent briefs.** The orchestrator briefs were long, and each was re-read for as long as the agent lived.

### An illustrative counterfactual

If orchestrator #1 had averaged orchestrator #2's context (93K per turn) over its 984 turns, it would have used about **92M tokens instead of 450M**, saving about 359M, or **38% of the whole project**. That ignores the extra turns a fresh orchestrator needs to re-orient, so treat it as an upper bound, but the direction is not in doubt.

### Usage-limit events

| Stop | Reset time announced |
|---|---|
| 1 | Oct 30 4:10 AM |
| 2 | Oct 30 11:30 AM |
| 3 | Oct 30 4:30 PM |
| 4 | Oct 30 9:30 PM |
| 5 | Oct 31 7:30 AM |
| 6 | Oct 31 12:30 PM |

Consequences, not attributed per stop: orchestration stayed down until someone noticed and resumed it; QE verdicts in flight were lost and re-run (M-07 and the M-09 rework); and subtasks that AI Gang dispatched while the limit was active failed with exit code 1 and ran again (M-22, M-27 and M-31's frontend, and M-23 once). Each resume also began with a reconcile pass that re-read state. I did not measure the lost time per stop.

The weekly all-models quota reached 100% on Oct 31 and reset on Nov 1 at 10 PM. The owner stopped orchestrator #1 by hand at about 3% of the quota.

## What went wrong (beyond tokens)

- **Silent stall.** Orchestrator #2 said it would use a bounded watcher but did not arm one, so nothing woke it. It sat idle about 7 hours while two PRs merged unverified.
- **Permission prompt on launch.** The standalone session blocked on a "read outside the working directories" prompt for about 1.5 h, and the first fix swallowed its own start prompt because `--add-dir` is variadic.
- **Stale dependency link.** A cancelled story (M-08) still blocked M-09, and the work-item admin account could not delete the link. It needed the owner and was a day-long soft block.
- **Platform quirks** (details in the field notes): subtasks say they share "ONE PR" but each opens its own; GitHub sometimes never creates the pull-request ref, so builds fail at checkout; Jenkins failures such as a Groovy compile error post no comment; the reaper marks a story failed when an agent reports completion at PR open and then pushes fixes; agents edit files outside their subtask; the `createBranch` test is flaky under load.
- **Rework.** At least eight stories needed a rework round or a fix subtask (M-07, M-09, M-10, M-13, M-24, M-27, M-30 and M-31). Most were real defects QE caught; a few were wording ambiguities in criteria.

## What went well

- **Early de-risking.** The riskiest unknowns (Android Keystore, TLS verifier, folder picking) were put in front of the UI stories. The walking skeleton passed first time through the device flow once Copy code was fixed.
- **Desktop-wins rule and the mockup audit** caught 74 defects before any UI was built.
- **Dependency chain and file-overlap checks** let the parallel phase run with no duplicate PRs or double dispatches. The frontend slot stayed at one, which kept conflicts away from `App.tsx` (down from 1,005 to 697 lines on desktop, and 32 on mobile) at the price of throughput.
- **Independent QE after every merge** found real defects with tight scopes on Sonnet.
- **Single repo with workspaces** worked under AI Gang's one-repo-per-project assumption.

## Recommendations

### Token policy for the next long orchestration

1. **Cap orchestrator context.** Start a fresh orchestrator when its context passes about 150K tokens, or after about eight stories, whichever is first. The build log and a short brief are the memory, not the transcript.
2. **Use Sonnet for orchestration** and reserve Opus for planning and design. Orchestration turns are mostly lookups.
3. **Never poll through the model.** Every wait is a bounded shell watcher, and an orchestrator must not end a turn without one armed. Add a heartbeat so a stalled orchestrator is noticed within an hour, not seven.
4. **Remove the middleman.** Run the orchestrator directly where the owner can attach, instead of relaying through another long session.
5. **Keep reads small.** Read log tails, not whole files. Batch tracker calls into scripts. Keep QE briefs short.
6. **Do not dispatch into a limit window.** Check remaining quota before dispatching, and pause cleanly (write a PAUSED entry) when a limit is near.
7. **Measure.** Total tokens per actor from transcripts (script in the appendix) and record them in the build log at each milestone, so cost is visible while there is time to act.

### Process and platform

1. Use a permission configuration with explicit allowed directories from the start, and pass the start prompt before variadic options.
2. Make dependency-link deletion available to the orchestration account, or have a cancelled blocker count as satisfied, so a deferred story does not block its successor.
3. Fix the reaper false failure (completion at PR open followed by later pushes), the missing pull-request ref check, and the invisible Jenkins errors, as described in the field notes.
4. Give each remaining UI story a declared set of owned paths so the orchestrator can raise the frontend limit safely. This was proposed and deferred by the owner because usage, not conflicts, was the bottleneck.

## Method and caveats

- **Source.** Token figures come from the `usage` fields in agent transcripts: input, output, cache-creation and cache-read tokens, summed per assistant turn. They are not the quota meter, and I could not see how the plan weights cache reads against the limits.
- **Output tokens** are undercounted in transcripts (they record partial counts), but they are tiny next to cache traffic.
- **Dev agents.** The 108 sessions are all AI Gang agent sessions on the build VM modified since Oct 29 17:00 UTC. They may include a small amount of non-mobile activity.
- **Not included.** GitHub Actions minutes, Jenkins compute, and the owner's own interactive work. QE agents launched by orchestrator #2 are not counted (they are small).
- **Times** are approximate, converted from UTC. Daylight saving ended Nov 1, so late Nov 1 and Nov 2 times are CST.
- **Reproducing.** A short script totals the usage fields per transcript:

```python
import json, collections
def total(path):
    t = collections.Counter(); turns = 0
    for line in open(path, errors="replace"):
        try: o = json.loads(line)
        except ValueError: continue
        m = o.get("message") if isinstance(o, dict) else None
        u = m.get("usage") if isinstance(m, dict) and m.get("role") == "assistant" else None
        if u:
            turns += 1
            t["in"] += u.get("input_tokens", 0); t["out"] += u.get("output_tokens", 0)
            t["cache_write"] += u.get("cache_creation_input_tokens", 0)
            t["cache_read"] += u.get("cache_read_input_tokens", 0)
    return turns, dict(t)
```
