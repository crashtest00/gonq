# Comment marker shows which thread is open: decision

Spike 0b3e3429 (parent 49d997fb). Verdict: **feasible, small, official CodeMirror 6 only, no comment-format change.**
Prototype (throwaway, never merged): branch `spike/0b3e3429-01af-4d7f-921d-f63af1aa9bb4-marker-active-prototype`, commit acef145
(7 files, +45/-9). Screenshots are on that branch in `docs/spike-marker-active-screens/`:
`desktop-none-light.png`, `desktop-active-light.png`, `desktop-active-dark.png`, `mobile-active-light.png`, `mobile-active-dark.png`.
The prototype also has two throwaway Playwright specs (`e2e/proto-marker-desktop.spec.ts`, `e2e/mobile-proto-marker.spec.ts`), both green
against the desktop web build and the mobile web build (Pixel 7); `packages/editor` vitest stayed green (176 tests). The glyph shows as an empty box in the headless screenshots because the container has no emoji font; the ring is what matters.

References below are to `dev` at 86e36aa (approximate line numbers).

## 1. How the active key reaches the editor

**`StateEffect` + `StateField`**, the standard CM6 way to put app-driven state into an editor state.

- `setActiveThread = StateEffect.define<string | null>()` and `activeThread = StateField.define<string | null>` (value = the `threadKey(id, ordinal)` string, `model/threads.ts:15`), defined next to `ThreadMarker` in `packages/editor/src/editor/threads.ts` (~18) and added to `createEditorState` in `extensions.ts` (~113).
- `MarkdownEditor.tsx` (Props ~90) gets one optional prop `activeThreadKey?: string | null`. A `useLayoutEffect` placed **after** the tab-switch effect (~170) and the mode effect (~188) dispatches `setActiveThread.of(key)` when `v.state.field(activeThread)` differs. Dependencies: `[activeThreadKey, tabId]`.
- Why not the alternatives:
  - A **facet + Compartment** (like `readOnlyCompartment`, `extensions.ts:71`) would reconfigure the whole editor for what is one value; a reconfigure also rebuilds every extension's state and is the heavier hammer. `editorHost` (`host.ts:5-14`) is deliberately read lazily at click time, so it cannot trigger a redraw either.
  - A **field per state** matches how tabs work: each tab owns an `EditorState` that is parked and restored (`MarkdownEditor.tsx` ~170-180, `v.setState`). The field value travels with the parked state, so the sync effect must also run on `tabId` (it does) so a restored state gets the current value, not a stale one.
- Wiring per app is one line each: desktop `App.tsx` ~619 `activeThreadKey={commentsOpen ? selectedKey : null}`; mobile `EditorScreen.tsx` ~60 `activeThreadKey={open ? selectedKey : null}`. Both already hold the key (`App.tsx:109`; `shell/comments.tsx:45-46`) in the `id#ordinal` form.

## 2. How the marker shows it

**Active flag in `ThreadMarker`**, not a mark decoration. The marker is a `Decoration.replace` widget over the whole `[💬](#md-thread-id)` link (`livePreview.ts` ~155-160); a mark decoration cannot style a replaced range, so the widget has to carry the state.

- `ThreadMarker` gets a third constructor argument `active = false`; `eq` compares it (`threads.ts` ~22), so CM6 only rebuilds the DOM of a marker whose state changed (the old and new widgets for the other markers stay `eq`, DOM reused). `toDOM` adds class `cm-thread-active` plus `aria-current="true"` (a11y: not colour alone).
- The live-preview plugin must rebuild when the field changes: add `u.startState.field(activeThread) !== u.state.field(activeThread)` to the `update` condition (`livePreview.ts` ~304). Rebuild is the plugin's normal viewport-only `build()`.
- **Duplicate ids.** The same id can appear in several markers; the thread key carries the ordinal among same-id markers (`model/threads.ts:15`; the click handler already derives it, `threads.ts` ~38). `build()` needs the same ordinal for each marker, and the plugin only visits the viewport, so the ordinal is computed from a **per-document cached** `parseCommentMarkers` (`WeakMap<Text, …>`, same idea as `threadBlockRanges`, `threads.ts` ~71). The prototype's `markerOrdinal(doc, id, from)` does this, and the click handler can reuse it. Verified: with `A` in two markers and one block, only marker `A#0` is active; `A#1` has no thread, so nothing is active for it (matches `onOpenThread`, which ignores keys without a block).
- **Resolved threads.** Handled by the same flag: `cm-thread-active` composes with `cm-thread-resolved`; the ring does not depend on open/resolved. The ✅ marker of an open-in-sidebar resolved thread rings the same way (verified for a resolved thread opened in the sidebar).

## 3. What "active" means, and when it clears

Rule: *active key = the thread currently shown in detail in the Comments panel, while that panel is visible; otherwise null.* The app passes `null` itself, the editor has no clearing logic.

| Situation | Desktop | Mobile |
|---|---|---|
| Thread shown in detail | `commentsOpen && selectedKey` (sidebar thread view) | `open && selectedKey` (sheet on a thread) |
| List view ("All threads" / sheet list) | `selectedKey` is null, none active | same |
| Draft (new comment) open | `openThread`/`startDraft` clear `selectedKey`, none active | `startDraft` clears it, none active |
| Close thread (X / Back) | `onClose` sets null (`App.tsx` ~653) | `showList` sets null |
| Close sidebar/sheet | `toggleComments` sets null (~282); also gate with `commentsOpen` | `close` sets null (`comments.tsx` ~70) |
| Tab switch | `App.tsx` ~141 resets `selectedKey`; field restored from the parked state then re-synced | `comments.tsx` 48-52 resets on `session.activeId` |
| Raw Markdown | no widget exists, so nothing shows; the field keeps its value and the ring is back on returning to Formatted (verified) | same |
| Delete thread | `setSelectedKey(null)` (~255) | closes to list |

Edge: a marker with a key whose thread was edited/resolved is still the same key (id + ordinal do not change), so it stays active. A thread deleted drops its key via the existing reset. Text edits that insert a same-id marker earlier would shift the ordinals; `selectedKey` has the same pre-existing limitation, so it is not new risk.

## 4. Visual treatment

Prototype CSS (`editor.css` next to ~84), theme tokens only:

```css
.gonq-editor .cm-thread-marker.cm-thread-active {
  background: color-mix(in srgb, var(--primary-text) 22%, transparent);
  box-shadow: 0 0 0 2px var(--primary-text);
  border-radius: 6px;
}
```

- `--primary-text` is a token that already has a light (`#177A59`-ish turquoise) and a dark (`#2FA079`) value (`tokens.css:20, 79`), so both themes are covered with no new variable. Checked in the light and dark screenshots: the ring is visible on cream and on near-black.
- **No hover dependency**: it is a static state, works on touch. It adds no `transform` and no `display` change.
- **Numbered-list trap**: the existing `.cm-thread-marker:hover { display: inline-block }` (`editor.css:85`) inherits the negative `text-indent` of `.cm-li-first` unless the base rule resets it (`text-indent: 0`, line 84). The active style uses only `background`, `box-shadow` and `border-radius`, none of which change layout or inheritance, so the item does not shift. The screenshot's first numbered item carries a marker for this reason, and the active marker in the list was checked by the e2e (no layout assertion needed beyond that: box-shadow is paint-only). The numbered-list shift bug itself stays out of scope.
- `box-shadow` is paint-only and can be clipped by an `overflow: hidden` ancestor; the editor content has none for inline text. Padding `0 2px` (existing) leaves room for the 2 px ring horizontally; vertically the line box is taller than the glyph.
- Forced-colors/high-contrast: box-shadow is dropped there; add `outline: 2px solid` fallback (`@media (forced-colors: active)`) in the story.

## 5. Cost and risk

- **Decoration rebuild**: one extra `build()` per active-key change (a click or panel navigation), viewport-limited, the same cost as one selection move, which already rebuilds on every `selectionSet`. Per-document `parseCommentMarkers` is cached by `Text`, so it runs once per document change, not per build. Without the cache, `parseCommentMarkers(doc.toString())` per marker per build would be O(markers × doc): do not skip the cache.
- **Live-preview interaction**: touched in two places only (the `update` condition and the one `ThreadMarker` construction). The `hide()` path, atomic ranges and the "caret touching the source shows it" rule are unchanged; the marker link is a `return false` branch with no caret reveal.
- **Markers outside the viewport**: not built, so no cost; they are built correctly when scrolled in because `build()` reads the field.
- **Tests impact**:
  - `packages/editor/src/editor/threads.test.ts` (marker tests, ~37-57) use `ThreadMarker` through the editor helper; the extra default arg changes nothing there. Add: active flag set via effect, one active only, duplicate ids, resolved, cleared with null, Raw/Formatted round trip.
  - App-level: a per-feature test in `apps/desktop/src/features/` or `components/` (`renderApp`, select a thread in the sidebar, `.cm-thread-active` follows; close clears; tab switch clears), and a mobile test via `renderMobileApp` for sheet list/thread/close. Existing e2e (`mobile-comments.spec.ts`, `mobile-marker-list.spec.ts`, `smoke.spec.ts`) select `.cm-thread-marker` and are unaffected by an added class.
  - Playwright: `e2e/comment-marker-active.spec.ts` and `e2e/mobile-comment-marker-active.spec.ts` (the prototype specs are a starting point); `smoke.spec.ts` and `App.edit.test.tsx` stay frozen.
- Risks: (a) stale value on tab restore, covered by the `tabId` dependency and a test; (b) `aria-current` on a `role=button` span is acceptable but should be confirmed with a screen-reader pass; (c) the effect runs in a layout effect after the tab swap, if a future refactor reorders effects the restored tab would flash the previous value (a test guards it).
- Constraints respected: official CM6 (`StateEffect`, `StateField`, widget `eq`), no comment-format change, no MenuBar edit, no keydown handler, nothing hidden by platform, theme tokens only.

## Recommended implementation story

**Story: Comment marker shows the open thread (desktop + mobile)**

Scope: the marker whose thread is shown in detail in the Comments panel looks active; nothing else changes (no thread navigation, no list-shift fix).

Files:
1. `packages/editor/src/editor/threads.ts`: `setActiveThread`, `activeThread`, `markerOrdinal` (cached), `ThreadMarker.active` in `eq`/`toDOM` (+class, `aria-current`); reuse `markerOrdinal` in the click handler; update header comment.
2. `packages/editor/src/editor/extensions.ts`: add `activeThread` to the state; `livePreview.ts`: pass `active`, rebuild on field change; update headers.
3. `packages/editor/src/editor/MarkdownEditor.tsx`: `activeThreadKey` prop + sync effect (after the tab-switch effect).
4. `packages/editor/src/styles/editor.css`: `.cm-thread-active` rule (tokens only, forced-colors fallback).
5. `apps/desktop/src/App.tsx` and `apps/mobile/src/screens/EditorScreen.tsx`: pass the prop (one line each).
6. Docs: a line in `CLAUDE.md` is not needed (no new directory/convention).

Tests: editor-level cases in a new `packages/editor/src/editor/threadActive.test.ts` (flag, duplicates, resolved, clear, Raw round trip, tab restore); desktop `apps/desktop/src/features/comments/markerActive.test.tsx`; mobile test via `renderMobileApp`; two Playwright specs as above, incl. light/dark screenshot assertions optional.

Estimate: small (about 1 day). No backend or Rust change; no `bindings.ts` change.
