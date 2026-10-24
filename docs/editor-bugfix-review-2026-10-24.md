# Editor bug-fix review: table caret and Raw → Formatted caret

> 2026-10-23 → 2026-10-24. Written by the orchestrator session (Claude) for the owner, to improve story and review guidance.
> Stories: `1449c6ac` (below a table, Up arrow jumps to the section heading and clicks land one line off) and `2b8b002c` (switching Raw → Formatted leaves the cursor off-screen).

## Outcome

Two bugs took 5 subtasks and 7 merged fix PRs (#112, #113, #115, #116, #118, #119, #120), and at the time of writing neither story is closed:

| Story | Subtask | PRs | Result |
|---|---|---|---|
| `1449c6ac` | `4b622fba` | #113 | Passed; the story check then found a second cause |
| `1449c6ac` | `bc6d87e5` | #116, #118, #120 | Passed on the second rework |
| `2b8b002c` | `ca908512` | #112, #115, #119 | Failed 2 of 8 criteria after two reworks; closed into fix subtask `8b7d9199` |

Every failed attempt merged to `dev` and deployed to Beta before review. Jenkins auto-merges on green, and review happens after merge.

## What went wrong

1. **A fix for the stated cause missed a second cause.** The table bug had two sources. One was the table wrapper's vertical `margin`, which CodeMirror leaves out of its height map. The other was `enterTable`, which picked the next line by logical line rather than by visual row. The bug report named only the first. The subtask review passed the CSS fix; the story-level check found the wrapped-paragraph case.
2. **Tests passed while the feature was broken.**
   - Raw → Formatted unit tests mocked `coordsAtPos` and `getBoundingClientRect`. #112 never scrolled, and #115 threw on every switch, yet both passed CI.
   - The first Down-into-table e2e test pressed Down in a tight loop until a cell had focus. It could not see focus bouncing back to the editor.
   - A unit test checked the stylesheet's text ("padding", not "margin") rather than the layout.
3. **CodeMirror rules were broken, each costing at least one round:**
   - Vertical margins on a block widget: the original bug.
   - Reading layout (`coordsAtPos`) inside a `requestMeasure` write phase: #115 threw "Reading the editor layout isn't allowed during an update" on every switch, so nothing scrolled.
   - Hand-rolled scroll correction: #119 chains 8 `requestMeasure` passes that each adjust `scrollTop`, instead of using `EditorView.scrollIntoView(pos, { y: 'start', yMargin })`. `MarkdownEditor.tsx` already uses that elsewhere.
   - Focusing a widget's DOM while the editor selection still points outside it: CodeMirror wrote its selection back to the DOM and pulled focus out of the table cell (#118). #120 fixed this by moving the selection to the table edge first.
4. **Infrastructure noise cost a round-trip.** A load spike (about 150 on 4 CPUs, mostly concurrent Rust compiles) made an unrelated test time out in the post-merge build. Jenkins' comment blamed "beta promotion / deploy". The agent could not reach Jenkins to read the log, so it blocked and asked. Two agent sessions also hit their time limit and were resumed.

## Guidance that would have helped

- **Bug stories:** ask for the cause to be confirmed by reproduction, and for every code path that produces the symptom (keyboard, mouse, each widget type), not only the first one found.
- **Layout, scrolling and focus work:** accept it only with Playwright tests on real layout that assert what the user sees, at a realistic key cadence (wait about 150 ms between presses and check focus is still there afterwards). Mocked geometry is fine for helpers, but it does not count as coverage for these criteria.
- **CodeMirror rules for agents:**
  - Block widgets space themselves with padding, never vertical margin.
  - Read layout only outside an update or in a measure `read` phase, and write only in `write`.
  - Position the view with `EditorView.scrollIntoView` effects, not manual `scrollTop` loops.
  - Set the editor selection next to or inside a widget before focusing the widget's DOM.
- **Reviews:** the subtask review should also run the story's edge cases, so the story check is a confirmation, not the first place a gap shows up.
- **Pipeline:** agents need a way to read Jenkins logs. The post-merge failure comment should name the failing stage instead of always naming the deploy.
