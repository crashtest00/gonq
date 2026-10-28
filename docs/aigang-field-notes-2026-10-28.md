<!-- Redacted operator notes: host paths, LAN address and session identifiers removed. AI Gang file:line references are not given; the observations are about behaviour of AI Gang as installed on the build VM at the time. -->

# AI Gang field notes: UI polish stories, 2026-10-27/28

Kept by the Claude Code session that orchestrated eight owner-requested UI stories for Gonq (UTC times, first dispatch about 17:40, last story done about 02:20 the next day), plus the "gonq-editor" PR label story that followed.
Scope: what this run showed about **how AI Gang works** and where it cost time. The Gonq product work is in the work-item history and the PRs, not here.
**No change was made to the AI Gang repository or to the build VM's AI Gang install in this run.** Everything below is an observation for AI Gang source to consider.
Earlier notes in this folder: `aigang-field-notes-2026-10-26.md` (dispatch gate, rollup unblocking, agent definition changes) and `github-builds-aigang-issues-2026-10-09.md`.

## The run in numbers

| Story | Fix rounds | Merged PRs |
|---|---|---|
| Edit > Preferences renamed to Settings | 0 | #193 |
| GitHub sign-in moved into Settings | 1 | #194, #195 |
| File > Save As directly below Save | 0 | #196 |
| View menu: Raw Markdown and Theme share one indent | 0 | #197 |
| Resizable side panes (folder navigator, outline, comments) | 2 | #198, #199, #200, #201 |
| Create branch dialog: gap after the `gonq/` prefix | 0 | #202 |
| Comment shortcuts (Alt+M adds a comment, Ctrl+Enter saves) | 1 | #206, #208 |
| Navigator Refresh (local, ssh://, GitHub) | 4 (the owner reset the cap once) | #203, #204, #205, #207, #209 |

Four stories passed their story-level check first time; four needed 1 to 4 fix rounds. Every fix round was found by an independent read-only QE agent working from the story's acceptance criteria, not by the build agents or by CI (CI was green on every PR).

## Summary for AI Gang source

| # | Area | Observation | Impact in this run |
|---|---|---|---|
| 1 | Subtask text | A subtask without a literal **Acceptance** heading is treated by the build agent as having no criteria | Two stories shipped partial work: Refresh (#203) and comment shortcuts (#206) |
| 2 | Story completion | A story becomes `done` the instant its last subtask is set `done` | Story-level QE has to run before that save; a fix subtask has to be created first |
| 3 | Split stories | A frontend half and a backend half of one story can disagree on a contract and both pass their own tests | Pane widths: wrong pane id, non-nullable width, defaults instead of none |
| 4 | Agent tests | Tests that cannot fail are accepted as proof | Scroll assertions that pass in jsdom whatever the code does; fix rounds spent on test strength |
| 5 | PR descriptions | The PR body does not map the acceptance criteria to proving tests | QE had to rediscover coverage; several rounds ended on "no named test" |
| 6 | Verification environment | The Beta web build cannot exercise desktop-only flows | Many criteria are `unverifiable` and are handed to the owner |
| 7 | Orchestrator API | No supported way to create a subtask or story except the Django admin add form | Hand-built form posts; the story-detail inline is ignored on create |
| 8 | Fix-round cap | A cap of two fix subtasks per story is a poor fit for stories with many criteria | Two stories hit it; the owner reset the counter |

## Details

### 1. A subtask with no Acceptance heading counts as having no criteria

- Refresh, first delivery (PR #203): the subtask description had a long BUILD section (busy state, registry command, deleted-branch path, error handling) but no separate acceptance section. The PR body said "No explicit criteria in the ticket", and the PR delivered only a bare icon button. Four of nine story criteria failed.
- Comment shortcuts, first delivery (PR #206): PR body said "Ticket has no numbered criteria". It delivered the two shortcuts but not the right-click hint, the repeat guard, the tooltips, the docs or any per-criterion tests.
- What worked: every fix subtask the orchestrator wrote had a lettered "what is missing" list followed by a literal `Acceptance` section quoting the failing story criteria word for word. Those were picked up and delivered.
- Suggestion: when AI Gang creates subtasks from a story, copy the story's acceptance criteria verbatim into each subtask under an `Acceptance` heading, with the story's numbering, and have the agent definition require the PR to answer each numbered criterion (the existing "PR body answers the acceptance criteria" rule from the 2026-10-26 notes was not enough when the heading was absent).

### 2. A story completes on its last subtask

- Seen again (also noted in earlier runs): setting the last subtask `done` made the story `done` immediately.
- Consequence: the orchestrator ran the story-level check while the last subtask was still `in-review`, and on a failed check created the fix subtask first and only then set the old subtask `done`. If it had been the other way round the failing story would have been closed.
- Suggestion: a story whose subtasks are all `done` should move to a `verifying` state (or stay `in-review`) until something sets it `done`, so the story-level check has a place to happen.

### 3. Frontend/backend contract divergence (pane widths)

- The backend subtask text defined the contract: commands `get_pane_widths` and `set_pane_width` with `{pane, width|null}`, panes `navigator|outline|comments`, unsaved panes return none.
- The merged Rust code used pane id `folder`, took `width: u32` (so the frontend's `null` reset failed to deserialize) and returned defaulted numbers for unsaved panes. The frontend swallowed the invoke errors, so on the desktop app navigator widths would never save and reset would not persist.
- Every test passed: the frontend tests exercised localStorage, the Rust tests called Rust functions directly. Only a QE agent reading both halves side by side with file:line found it.
- Fix that worked: a backend-only fix subtask plus a test that pushes the exact frontend JSON through Tauri's real IPC into the real commands (`generate_handler!` with the production commands) and a frontend test mocking `invoke` and asserting `{pane, width}`.
- Suggestion: for split stories, put the contract in a shared artifact and have a contract test that both halves import; or have the agent definitions require one test per half that uses the other half's literal payloads.

### 4. Tests that cannot fail

- jsdom does no layout. Round 3 of the Refresh story asserted `scrollTop` by setting and reading it back: it passes even if the whole list is remounted. A "same scroll position" criterion cannot be proven that way.
- What bit: asserting that the rows that exist before and after keep the **same DOM node** and that the list never renders empty during the refresh. A style-only bug fix (Create branch gap) had the same limit: the PR's test checks CSS classes, the pixel gap was only measurable in a real browser.
- Other examples found by QE: a rapid Ctrl+Enter test that allowed up to two threads; an empty-body test covering only one of three boxes; a "no document" test that would pass if the feature were broken.
- Suggestion: agent definitions should require, for every acceptance criterion, a test that fails when the behaviour is removed (mutation-style: name the one-line change that would make it fail) and say plainly when a criterion cannot be tested in jsdom and needs a real-browser (Playwright) check.

### 5. PR descriptions do not map criteria to tests

- Rounds repeatedly ended with "criterion N has no named test". PR bodies listed test files or positions ("first test", "last test"), used their own numbering, or covered only some criteria.
- Suggestion: require a table in the PR body: story criterion number, proving test name, file:line, and what would make it fail.

### 6. The Beta web build is not enough to verify a desktop app

- Folders, ssh://, GitHub sign-in, native persistence and macOS key behaviour cannot be exercised on Beta. QE agents judged them from code and mocked tests and marked the live part `unverifiable`, which the process allows but which moves the real check to the owner (this run: about a dozen hand-checks listed in the build log).
- Where Beta could not open the feature at all (Create branch dialog, behind a signed-in GitHub navigator), QE rebuilt the exact markup and compiled CSS in a browser and measured that: useful, but it is a reconstruction.
- Suggestion: a fake-backend mode for the web build (a fake GitHub and a fake file system behind the same platform boundary the Tauri build uses) so the same flows can be driven in Beta; or a Tauri driver smoke job on the build VM.

### 7. No supported way to create work items programmatically

- Subtasks and stories were created by posting the Django admin add form (parent as a select, type and status as free text). The add form ignores the story-detail inline on create, so a story needs a second save before it can leave `proposed`; a save that changes status drops other edits in the same post (both known from earlier runs).
- A convenience script that documents `create-story` and `create-subtask` commands had them unimplemented; the form post was used instead.
- Suggestion: an `/admin/work-items` create endpoint (title, type, parent, description, story detail) logged with the actor, next to the existing transition and comment endpoints.

### 8. Fix-round cap

- The orchestrator rule is at most 2 fix subtasks per story, then park and ask the owner. Pane widths used both; Refresh would have stopped after two and needed four rounds (the owner reset the counter once and chose "one more round" twice).
- In both cases the later rounds were narrow (tests and docs only) and the first-round failures were the missing-acceptance-section problem (#1), not hard engineering.
- Suggestion: fixing the acceptance propagation should make the cap rarely bite; if it stays, count rounds per failing criterion, not per story.

## Smaller observations

- Jenkins merged PRs on green every time (auto-merge enabled after the PR build passed); the post-merge dev build took 3 to 15 minutes depending on the change, and the work item moved to `in-review` when the deploy finished. Beta's bundle timestamp matched the `in-review` time each time it was checked.
- One PR (#196) got a second pr-merge build for no visible reason before merging.
- When two stories were in flight at once (frontend limit 2), no merge conflicts occurred, including both agents editing the shared project map in `CLAUDE.md`.
- Agents occasionally skip most of a long description (Refresh #203). The independent QE step, working from the story's criteria and not from the PR text, caught every case.

## Local AI Gang changes

None. Nothing was changed in the AI Gang repository or install during this run.
