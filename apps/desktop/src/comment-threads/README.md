# Gonq comment threads

Threaded comments that live inside a Markdown document. No database, no sidecar
file, no editor required. A document carrying threads is still a valid Markdown
file that any tool can read, diff, and commit.

## The format

Two pieces. An **anchor marker** sits inline in the prose, at the point being
commented on:

    The estimate holds through Q3 [💬](#md-thread-c20260910143022a3f9c1) but not beyond.

The **thread body** is an HTML comment, always appended at the end of the
file:

    <!--
    @thread c20260910143022a3f9c1
    @status open
    @anchor holds through Q3

    [User | 2026-09-10T14:30:22+02:00]
    Where does this number come from?

    [claude | 2026-09-10T14:31:05+02:00]
    Q2 actuals, extrapolated. Citation added.
    -->

Rules:

- `@thread <id>` and `@status <open|resolved>` are both required. A block
  missing either is ignored, not an error.
- Every thread has a position, recorded by its marker: the cursor or the
  selection it was created at. There are no comments without one.
- `@anchor <text>` is present only when the thread was created on a selection.
  It holds the selected text on one line, whitespace collapsed.
- Message headers are `[<author> | <timestamp>]`. Author is an **open
  vocabulary** — the person's preference name (default `User`) when written
  from the Gonq UI, or an agent's own signature such as
  `architect-agent:75a079f6` — constrained only by the header syntax: it may
  contain neither `|` nor `]`. Writing one that does throws rather than
  producing a document that cannot be read back. Everything up to the next
  header is that message's body.
- A resolved thread's marker renders `✅` instead of `💬`.
- Markers use the vendor-neutral `#md-thread-` namespace.
- Thread bodies may be indented (e.g. nested in a list item); the indent is
  stripped consistently.
- A body or anchor containing `-->` is escaped to `--\>` on write and unescaped
  on read.
  The pair is symmetric, so round-trips are lossless. The escape is
  load-bearing and must not be removed: a body line of exactly `-->` would
  otherwise close the comment block early and orphan the rest of it.
- Anything that fails to parse is skipped, so a malformed block degrades to
  invisible rather than throwing.
- Unrecognised `@` directives are ignored rather than fatal. They are **not**
  preserved: re-serialising a thread drops any directive this parser does not
  know. Non-directive junk in the
  metadata section is still rejected, so genuinely malformed blocks stay
  malformed.

Because the body is an HTML comment, threads do not render in output. Because
the marker is an ordinary link, it renders as a small clickable glyph.

## API

Reading:

    parseCommentThreads(doc)         -> CommentThread[]   (with paired marker positions)
    parseCommentMarkers(doc)         -> Map<id, CommentMarker[]>
    parseCommentMarkerFragment(frag) -> id | undefined
    danglingMarkers(doc)             -> Map<id, CommentMarker[]>  markers no block claims

Writing:

    createCommentThread(author, body?, anchor?) -> new thread
    normalizeAnchor(selection)              -> one-line anchor text, or undefined
    appendReply(thread, author, body)       -> thread + message
    editCommentMessage(thread, i, body)     -> thread with message i replaced
    resolveThread(thread)                   -> thread marked resolved
    serializeCommentThread(thread)          -> the <!-- ... --> block
    formatCommentMarker(id, status?)        -> the inline [💬](#md-thread-id) marker
    replaceCommentThreadBlock(doc, t, str)  -> doc with thread t's block swapped

Placement:

    safeMarkerPosition(doc, offset)  -> nearest offset that will not corrupt the doc
    fencedCodeRanges(doc)            -> ranges to avoid
    inlineCodeRanges(doc)
    linkRanges(doc)

All functions are pure: strings and plain objects in, strings and plain objects
out. Nothing reads the filesystem or mutates its arguments.

## Guidance for agents

When Gonq creates a thread in a file that lacks it, it also writes one short
HTML comment (`AGENT_GUIDANCE`, `guidance.ts`) just ahead of the new thread
block, explaining the format: read a thread, reply by appending a
`[<signature> | <timestamp>]` message, resolve. Agents may open threads, reply,
resolve and reopen; they must never edit or delete existing messages or threads.
It has no `@thread` directive, so it is never parsed as a thread and never
rendered. It is written once per file (`hasAgentGuidance`), never on reply
alone, and never to a file without threads.

## Duplicate ids and marker pairing

Ids are meant to be unique, but a document can carry two blocks with the same
id -- a bad merge, a hand edit, a writer without entropy. Pairing is **ordinal**:
the nth block carrying an id pairs with the nth marker carrying that id, both in
document order.

Ordinal rather than nearest-by-distance, because distance is degenerate for this
format. Markers sit inline in the prose; blocks are appended at the end. So every
marker precedes every block, the last marker is nearest to all of them, and
minimum-distance collapses every duplicate onto that one marker while leaving the
earlier ones unused. Ordinal pairing is position-independent and matches what a
reader assumes.

Consequences worth knowing:

- A block with no marker at its ordinal has `markers.length === 0`. That is an
  orphaned block, and it is visible through `parseCommentThreads`.
- A marker with no block at its ordinal is dangling -- surplus markers for an id,
  or every marker for an id with no blocks left. These are invisible to
  `parseCommentThreads`, which walks blocks only, so use `danglingMarkers` to
  find them. A marker left behind by a removed block shows up here and nowhere
  else.
- Pairing is part of the format, not an implementation detail. Two writers that
  pair differently disagree about which thread a marker addresses, and neither
  errors.

## Document-level operations

Prefer these over assembling documents yourself. They take a document and return
a document, and they hold the format's guarantees structurally rather than
leaving them to caller discipline.

    openThread(doc, position, author, body?)      -> { doc, thread }
    appendToThread(doc, ref, author, body)        -> doc
    setThreadStatus(doc, ref, status)             -> doc
    editThreadMessage(doc, ref, body, index = 0)  -> doc
    deleteThread(doc, ref)                        -> doc
    resolveThreadRef(doc, ref)                    -> CommentThread

`openThread` takes a position: a cursor offset, or a selection `{ from, to }`.
A thread without a position is not constructible through this interface. For a
selection, the selected text becomes the thread's `@anchor` and the marker goes
after it, ignoring trailing whitespace. For a cursor (or an empty selection),
the marker goes at the cursor and there is no `@anchor`. Either way the marker
offset is run through `safeMarkerPosition` — expect it to move if it landed
inside a code block, HTML comment, code span or link.

`setThreadStatus` updates the block and the marker glyph together, so the two
cannot disagree.

`editThreadMessage` replaces one message's text, by default the first; author,
timestamp and other messages are untouched.

`deleteThread` removes the block and its marker together, so neither is left
behind.

A `ref` is `{ id, ordinal? }`. Ids are not unique, so `ordinal` selects among
same-id blocks in document order. The mutating operations **throw** on an
ambiguous ref rather than guessing, because silently mutating the wrong one of
two same-id threads is precisely the wrong-passage failure this format already
risks.

## Read `safeMarkerPosition` before inserting anything

Markers are found by a regex that has no notion of Markdown structure. A marker
written into a fenced code block is therefore *still parsed as a valid anchor*,
while also appearing as literal text in the code. The document is corrupted and
the thread still looks fine to the parser.

So do not insert a marker at a raw offset. Run it through `safeMarkerPosition`,
which moves forward past any fenced block, code span, or link the offset landed
inside — including anchor markers already in the document, which are themselves
links and must never be split.

    const at = safeMarkerPosition(doc, desiredOffset)
    doc = doc.slice(0, at) + formatCommentMarker(thread.id) + doc.slice(at)
    doc = doc.replace(/\n*$/, '\n\n') + serializeCommentThread(thread) + '\n'

## Thread ids

`c` + local-time `YYYYMMDDhhmmss` + twelve CSPRNG hex characters. The random suffix
is load-bearing, not decoration: ids key the marker lookup, so two threads
sharing an id produce two markers for one id, and every mutation that checks
`markers.length !== 1` then silently does nothing. Do not shorten it to the
timestamp.

## Files

| File | Role |
|---|---|
| `types.ts` | Thread, message, and marker types |
| `parser.ts` | Parse and serialise thread blocks |
| `markers.ts` | Marker format, selection quoting |
| `commands.ts` | Create, reply, edit, resolve; anchor normalisation |
| `positions.ts` | Safe insertion offsets |
| `document.ts` | Document-level operations, including edit and delete |
| `guidance.ts` | The embedded note for AI agents |
| `index.ts` | Barrel |
| `editor/codemirror.ts` | Editor layer (CodeMirror changes for create/resolve/delete) — built and type-checked, not exported from the barrel |

## Dependencies

None. TypeScript, no runtime imports, no third-party source.

`editor/codemirror.ts` is the exception and is deliberately outside all of that:
it needs `@codemirror/state` (types only) and is not exported from the barrel.
Gonq's editor uses it to create threads. Marker placement is not decided there — it delegates to
`safeMarkerPosition`, which is normative on every surface.

## Tests

`test.cjs` — format round-trip, reply/resolve persistence, id uniqueness under a
frozen clock, fenced/inline/link insertion safety, malformed-input rejection,
cursor and selection positions, quoted anchors, edit and delete, and an end-to-end append into a document containing a
code block. Compile to
CommonJS and run with node.
