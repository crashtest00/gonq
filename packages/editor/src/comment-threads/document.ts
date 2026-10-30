/**
 * Document-level operations: document in, document out.
 *
 * The primitives in the other files operate on thread objects and leave document
 * assembly to the caller. That works for an editor, which does its own
 * assembly, but it puts the format's guarantees in the caller's hands: opening a
 * thread correctly is a five-step sequence, and a caller that skips the marker
 * step produces a block that is parseable but not addressable.
 *
 * These operations hold those guarantees structurally instead:
 *
 * - `openThread` takes a position (a cursor offset or a selection) and places
 *   marker and block together, running the marker offset through
 *   `safeMarkerPosition` itself. A thread without a position is not
 *   constructible through this interface. A selection's text is also stored
 *   as the thread's `@anchor`.
 * - `appendToThread`, `setThreadStatus` and `editThreadMessage` name an intent
 *   rather than taking a replacement string.
 * - `deleteThread` removes a thread's block and its marker together, so neither
 *   is left behind.
 *
 * The primitives stay exported. This is a layer over them.
 */
import type { CommentThread, CommentThreadStatus } from './types'
import { appendThreadBlock, formatCommentMarker } from './markers'
import { parseCommentThreads, serializeCommentThread } from './parser'
import { appendReply, createCommentThread, editCommentMessage } from './commands'
import { safeMarkerPosition } from './positions'

/**
 * Names one thread in a document. Ids are not unique -- a document can carry two
 * blocks with the same id -- so `ordinal` selects among same-id blocks in
 * document order when it has to. The mutating operations refuse an ambiguous
 * reference rather than guessing, because silently mutating the wrong one of two
 * same-id threads is the wrong-passage failure this format already risks; there
 * is no reason to add a second route to it.
 */
export interface ThreadRef {
  id: string
  ordinal?: number
}

interface DocumentEdit {
  from: number
  to: number
  insert: string
}

/** Applies edits back-to-front so earlier offsets stay valid as we go. */
function applyEdits (doc: string, edits: DocumentEdit[]): string {
  return [ ...edits ]
    .sort((a, b) => b.from - a.from)
    .reduce((result, edit) => result.slice(0, edit.from) + edit.insert + result.slice(edit.to), doc)
}

/**
 * Finds the single thread a reference names. Throws when the reference matches
 * nothing, or matches several blocks and carries no ordinal to choose between
 * them.
 */
export function resolveThreadRef (doc: string, ref: ThreadRef): CommentThread {
  const matches = parseCommentThreads(doc).filter(thread => thread.id === ref.id)

  if (matches.length === 0) {
    throw new Error(`No thread ${JSON.stringify(ref.id)} in this document.`)
  }

  if (ref.ordinal === undefined) {
    if (matches.length > 1) {
      throw new Error(
        `Ambiguous thread reference ${JSON.stringify(ref.id)}: ${matches.length} blocks carry that id. ` +
        'Supply an ordinal to choose between them.'
      )
    }
    return matches[0]
  }

  const chosen = matches[ref.ordinal]
  if (chosen === undefined) {
    throw new Error(
      `No thread ${JSON.stringify(ref.id)} at ordinal ${ref.ordinal}: only ${matches.length} block(s) carry that id.`
    )
  }

  return chosen
}

/** The part of a document a thread is about, as offsets into it. */
export interface Selection {
  from: number
  to: number
}

/**
 * Opens a thread at a position, returning the new document and the thread as
 * it parses back out of it. The position is either a cursor offset or a
 * selection. A selection's text becomes the thread's `@anchor` and the marker
 * goes after it, ignoring trailing whitespace; a cursor (or an empty
 * selection) gives a thread with no `@anchor`, its marker at the cursor.
 *
 * The marker offset is a request, not an instruction: it is moved forward out
 * of any fenced code block, HTML comment, code span or link it landed inside.
 */
export function openThread (
  doc: string,
  position: number|Selection,
  author: string,
  body = ''
): { doc: string, thread: CommentThread } {
  const selection = typeof position === 'number' ? { from: position, to: position } : position
  const selected = doc.slice(selection.from, selection.to)
  const created = createCommentThread(author, body, selected)
  const trailingWhitespace = /\s*$/.exec(selected)?.[0].length ?? 0
  const at = safeMarkerPosition(doc, Math.max(selection.from, selection.to - trailingWhitespace))
  const withMarker = doc.slice(0, at) + formatCommentMarker(created.id) + doc.slice(at)
  const next = `${withMarker}${appendThreadBlock(withMarker, serializeCommentThread(created))}\n`

  const thread = parseCommentThreads(next).find(candidate => candidate.id === created.id)
  if (thread === undefined) {
    throw new Error(`Internal: thread ${created.id} did not parse back out of the document it was written into.`)
  }

  return { doc: next, thread }
}

/** Appends a message to an existing thread. */
export function appendToThread (doc: string, ref: ThreadRef, author: string, body: string): string {
  const thread = resolveThreadRef(doc, ref)
  const updated = appendReply(thread, author, body)

  return applyEdits(doc, [
    { from: thread.from, to: thread.to, insert: serializeCommentThread(updated) }
  ])
}

/**
 * Sets a thread's status, updating its block and its marker glyph together so
 * the two cannot disagree. A thread whose marker is missing is still updated;
 * the orphaned state is reported by `parseCommentThreads` returning an empty
 * `markers` array, not by failing here.
 */
export function setThreadStatus (doc: string, ref: ThreadRef, status: CommentThreadStatus): string {
  const thread = resolveThreadRef(doc, ref)

  const edits: DocumentEdit[] = [
    {
      from: thread.from,
      to: thread.to,
      insert: serializeCommentThread({ id: thread.id, status, ...(thread.anchor === undefined ? {} : { anchor: thread.anchor }), messages: thread.messages })
    }
  ]

  for (const marker of thread.markers) {
    edits.push({ from: marker.from, to: marker.to, insert: formatCommentMarker(thread.id, status) })
  }

  return applyEdits(doc, edits)
}

/**
 * Replaces the text of one message, by default the thread's first. Author and
 * timestamp stay as they were; other messages are untouched.
 */
export function editThreadMessage (doc: string, ref: ThreadRef, body: string, messageIndex = 0): string {
  const thread = resolveThreadRef(doc, ref)
  if (thread.messages[messageIndex] === undefined) {
    throw new Error(`Thread ${JSON.stringify(thread.id)} has no message ${messageIndex}.`)
  }

  return applyEdits(doc, [
    { from: thread.from, to: thread.to, insert: serializeCommentThread(editCommentMessage(thread, messageIndex, body)) }
  ])
}

/**
 * Deletes a thread: its block and its marker go together. The run of newlines
 * left where the block was collapses to one blank line between neighbours, or
 * a single trailing newline at the end of the document. A marker that stood
 * alone on its line takes its newline with it.
 */
export function deleteThread (doc: string, ref: ThreadRef): string {
  const thread = resolveThreadRef(doc, ref)

  const before = doc.slice(0, thread.from).replace(/[\r\n]*$/, '')
  const after = doc.slice(thread.to).replace(/^[\r\n]*/, '')
  let next = after.length === 0 ? `${before}\n` : `${before}\n\n${after}`

  // The block is after its marker, so removing it first leaves marker offsets valid.
  for (const marker of [ ...thread.markers ].sort((a, b) => b.from - a.from)) {
    const lineStart = marker.from === 0 || next[marker.from - 1] === '\n'
    const eol = next.startsWith('\r\n', marker.to) ? 2 : next[marker.to] === '\n' ? 1 : 0
    next = next.slice(0, marker.from) + next.slice(marker.to + (lineStart ? eol : 0))
  }

  return next
}
