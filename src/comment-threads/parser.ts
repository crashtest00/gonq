import type { CommentMarker, CommentMessage, CommentThread, CommentThreadAuthor, CommentThreadStatus, SerializableCommentThread } from './types'
import { parseCommentMarkers } from './markers'

// Author is an open vocabulary; it may contain neither '|' nor ']' because
// both would make this header ambiguous.
const MESSAGE_HEADER_RE = /^\[([^|\]]+) \| (.+?)\]$/

/**
 * Reverses the escape applied by `serializeCommentThread`. The pair must stay
 * symmetric: the escape is load-bearing, because a body line of exactly '-->'
 * would otherwise close the comment block early and orphan the rest of it.
 */
function unescapeBody (line: string): string {
  return line.replace(/--\\>/g, '-->')
}

function isValidStatus (status: string): status is CommentThreadStatus {
  return status === 'open' || status === 'resolved'
}

function isCommentOpenLine (line: string): boolean {
  return /^(\s*)<!--$/.test(line)
}

function removeIndent (line: string, indent: string): string|null {
  if (indent.length === 0) {
    return line
  }

  if (line === '') {
    return line
  }

  return line.startsWith(indent) ? line.slice(indent.length) : null
}

function parseBlock (block: string[], from: number, to: number, lineNumber: number, indent: string): CommentThread|null {
  const lines: string[] = []
  for (const line of block.slice(1, -1)) {
    const dedented = removeIndent(line, indent)
    if (dedented === null) {
      return null
    }
    lines.push(dedented)
  }

  let id: string|undefined
  let status: CommentThreadStatus|undefined
  let anchor: string|undefined
  let index = 0

  for (; index < lines.length; index++) {
    const line = lines[index]
    if (MESSAGE_HEADER_RE.test(line)) {
      break
    }

    if (line.startsWith('@thread ')) {
      id = line.slice('@thread '.length).trim()
    } else if (line.startsWith('@status ')) {
      const candidate = line.slice('@status '.length).trim()
      if (!isValidStatus(candidate)) {
        return null
      }
      status = candidate
    } else if (line.startsWith('@anchor ')) {
      anchor = unescapeBody(line.slice('@anchor '.length).trim())
    } else if (line.startsWith('@')) {
      // Unknown directive from another tool. Ignored rather than fatal, so a
      // thread written by a writer we don't know about is still readable.
      // Note it is NOT preserved: re-serialising this thread drops it.
      continue
    } else if (line.trim() !== '') {
      return null
    }
  }

  if (id === undefined || id === '' || status === undefined) {
    return null
  }

  const messages: CommentMessage[] = []
  let current: CommentMessage|undefined

  for (; index < lines.length; index++) {
    const line = lines[index]
    const match = MESSAGE_HEADER_RE.exec(line)

    if (match !== null) {
      // `serializeCommentThread` writes a blank line between messages. That
      // separator is indistinguishable from a trailing blank line in the body,
      // so exactly one is taken back off the message it followed. Without this,
      // every round trip appends a newline to every message but the last, and it
      // compounds without bound.
      if (current !== undefined) {
        current.body = current.body.replace(/\n$/, '')
      }

      current = {
        author: match[1] as CommentThreadAuthor,
        timestamp: match[2],
        body: ''
      }
      messages.push(current)
      continue
    }

    if (current === undefined) {
      if (line.trim() === '') {
        continue
      }
      return null
    }

    const text = unescapeBody(line)
    current.body += current.body.length === 0 ? text : `\n${text}`
  }

  return {
    id,
    status,
    ...(anchor === undefined || anchor === '' ? {} : { anchor }),
    messages,
    markers: [],
    from,
    to,
    line: lineNumber
  }
}

/**
 * Parses every thread block in the document and pairs each with its marker.
 *
 * Pairing is ordinal, not by distance: the nth block carrying an id pairs with
 * the nth marker carrying that id, both in document order. Distance is the
 * wrong rule here because markers sit inline in the prose while blocks are
 * appended at the end, so every marker precedes every block and the last marker
 * is nearest to all of them -- minimum-distance collapses every duplicate onto
 * one marker and leaves the others unused.
 *
 * A block with no marker at its ordinal gets an empty `markers` array, which is
 * how an orphaned block is detected. Markers with no block at their ordinal are
 * dangling; see `danglingMarkers`.
 */
export function parseCommentThreads (doc: string): CommentThread[] {
  const threads: CommentThread[] = []
  const markers = parseCommentMarkers(doc)
  // Raw lines keep any trailing CR so offsets stay exact on CRLF documents;
  // `lines` is what gets matched.
  const rawLines = doc.split('\n')
  const lines = rawLines.map(l => l.endsWith('\r') ? l.slice(0, -1) : l)
  // How many blocks carrying each id we have passed, so the nth block for an id
  // pairs with the nth marker for that id. See pairing note above.
  const ordinals = new Map<string, number>()
  let offset = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const openMatch = /^(\s*)<!--$/.exec(line)

    if (openMatch === null || !isCommentOpenLine(line)) {
      offset += rawLines[i].length + (i < lines.length - 1 ? 1 : 0)
      continue
    }

    const indent = openMatch[1]
    const from = offset
    const block = [line]
    let blockOffset = offset + rawLines[i].length + (i < lines.length - 1 ? 1 : 0)
    let closingIndex = -1

    for (let j = i + 1; j < lines.length; j++) {
      const candidate = lines[j]
      block.push(candidate)
      const dedented = removeIndent(candidate, indent)
      if (dedented === '-->') {
        closingIndex = j
        break
      }
      blockOffset += rawLines[j].length + (j < lines.length - 1 ? 1 : 0)
    }

    if (closingIndex === -1) {
      offset += rawLines[i].length + (i < lines.length - 1 ? 1 : 0)
      continue
    }

    const closingLine = lines[closingIndex]
    const to = blockOffset + closingLine.length
    const parsed = parseBlock(block, from, to, i + 1, indent)
    if (parsed !== null) {
      const ordinal = ordinals.get(parsed.id) ?? 0
      ordinals.set(parsed.id, ordinal + 1)
      const paired = (markers.get(parsed.id) ?? [])[ordinal]
      parsed.markers = paired === undefined ? [] : [ paired ]
      threads.push(parsed)
    }

    for (; i < closingIndex; i++) {
      offset += rawLines[i].length + (i < lines.length - 1 ? 1 : 0)
    }
    offset += rawLines[closingIndex].length + (closingIndex < lines.length - 1 ? 1 : 0)
  }

  return threads
}

export function serializeCommentThread (thread: SerializableCommentThread): string {
  const lines = [
    '<!--',
    `@thread ${thread.id}`,
    `@status ${thread.status}`,
    ...(thread.anchor === undefined ? [] : [ `@anchor ${thread.anchor.replace(/-->/g, '--\\>')}` ]),
    ''
  ]

  for (const [ index, message ] of thread.messages.entries()) {
    if (index > 0) {
      lines.push('')
    }
    lines.push(`[${message.author} | ${message.timestamp}]`)
    lines.push(message.body.replace(/-->/g, '--\\>'))
  }

  lines.push('-->')
  return lines.join('\n')
}

export function replaceCommentThreadBlock (doc: string, thread: CommentThread, replacement: string): string {
  return doc.slice(0, thread.from) + replacement + doc.slice(thread.to)
}

/**
 * Markers that no block claims: surplus markers for an id whose ordinal exceeds
 * the number of blocks carrying that id, including every marker for an id with
 * no blocks at all. These are invisible to `parseCommentThreads`, which walks
 * blocks only, so a marker left behind by a removed block would otherwise be
 * undetectable through this module.
 */
export function danglingMarkers (doc: string): Map<string, CommentMarker[]> {
  const blockCounts = new Map<string, number>()
  for (const thread of parseCommentThreads(doc)) {
    blockCounts.set(thread.id, (blockCounts.get(thread.id) ?? 0) + 1)
  }

  const dangling = new Map<string, CommentMarker[]>()
  for (const [ id, found ] of parseCommentMarkers(doc)) {
    const surplus = found.slice(blockCounts.get(id) ?? 0)
    if (surplus.length > 0) {
      dangling.set(id, surplus)
    }
  }

  return dangling
}
