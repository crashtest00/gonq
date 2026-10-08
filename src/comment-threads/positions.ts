/**
 * Where a marker may safely be inserted into raw Markdown.
 *
 * Placing an anchor marker at an arbitrary offset can corrupt the document:
 * dropped inside a fenced code block it becomes literal code, and dropped
 * inside an existing link or code span it breaks that construct. Worse, the
 * marker scanner is a plain regex with no notion of code blocks, so a marker
 * buried in a fence is still *found* -- the document silently acquires a thread
 * anchor that renders as source text.
 *
 * These helpers take a desired offset and return the nearest safe one, moving
 * forward to the end of any construct the offset landed inside.
 *
 * HTML comments are included, which covers thread blocks themselves. Thread
 * bodies live in HTML comments and sit at the end of the document by
 * convention, so without this the whole trailing region of every threaded
 * document is a trap: a marker written there is swallowed into another thread's
 * message body, while still being found by the marker scanner. Both threads then
 * report exactly one marker and the document looks healthy.
 */

export interface DocumentRange {
  from: number
  to: number
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/

/**
 * Character ranges covered by fenced code blocks, inclusive of both fence
 * lines. An unterminated fence runs to the end of the document, matching how
 * CommonMark treats it.
 */
export function fencedCodeRanges (doc: string): DocumentRange[] {
  const ranges: DocumentRange[] = []
  const lines = doc.split('\n')
  let offset = 0
  let openedAt: number|null = null
  let fence = ''

  for (const line of lines) {
    const match = FENCE_RE.exec(line)

    if (openedAt === null) {
      if (match !== null) {
        openedAt = offset
        fence = match[1]
      }
    } else if (match !== null && match[1][0] === fence[0] && match[1].length >= fence.length && match[2].trim() === '') {
      ranges.push({ from: openedAt, to: offset + line.length })
      openedAt = null
    }

    offset += line.length + 1
  }

  if (openedAt !== null) {
    ranges.push({ from: openedAt, to: doc.length })
  }

  return ranges
}

/** Inline backtick code spans. Does not cross a line boundary. */
export function inlineCodeRanges (doc: string): DocumentRange[] {
  const ranges: DocumentRange[] = []
  const fenced = fencedCodeRanges(doc)
  const lines = doc.split('\n')
  let offset = 0

  for (const line of lines) {
    if (!fenced.some(range => offset >= range.from && offset < range.to)) {
      for (const match of line.matchAll(/(`+)(?:(?!\1).)*\1/gs)) {
        if (match.index !== undefined) {
          ranges.push({ from: offset + match.index, to: offset + match.index + match[0].length })
        }
      }
    }
    offset += line.length + 1
  }

  return ranges
}

/** Inline links, including anchor markers already present in the document. */
export function linkRanges (doc: string): DocumentRange[] {
  const ranges: DocumentRange[] = []

  for (const match of doc.matchAll(/\[[^\]\n]*\]\([^)\n]*\)/g)) {
    if (match.index !== undefined) {
      ranges.push({ from: match.index, to: match.index + match[0].length })
    }
  }

  return ranges
}

/**
 * HTML comment ranges, inclusive of both delimiters. This is what keeps a marker
 * out of a thread block. An unterminated comment runs to the end of the
 * document. Comments opened inside fenced code are not comments.
 *
 * The first unescaped `-->` closes the comment, which is exactly why
 * `serializeCommentThread` escapes that sequence in message bodies.
 */
export function htmlCommentRanges (doc: string): DocumentRange[] {
  const ranges: DocumentRange[] = []
  const fenced = fencedCodeRanges(doc)
  let search = 0

  while (search < doc.length) {
    const open = doc.indexOf('<!--', search)
    if (open === -1) {
      break
    }

    if (fenced.some(range => open >= range.from && open < range.to)) {
      search = open + 4
      continue
    }

    const close = doc.indexOf('-->', open + 4)
    const to = close === -1 ? doc.length : close + 3
    ranges.push({ from: open, to })
    search = to
  }

  return ranges
}

/**
 * Block constructs are closed by a delimiter that must be alone on its line: a
 * closing fence may carry no trailing content, and a thread block closes on a
 * line that is exactly `-->`. Landing a marker immediately after that delimiter
 * puts it on the delimiter's own line and the construct then never closes --
 * the fence swallows the rest of the document, the thread block swallows the
 * next one. So for block constructs the safe position is the start of the
 * following line, not the offset just past the delimiter.
 */
function throughEndOfLine (doc: string, range: DocumentRange): DocumentRange {
  return doc[range.to] === '\n' ? { from: range.from, to: range.to + 1 } : range
}

/**
 * Every range a marker must not land strictly inside, expressed as insertion
 * safety rather than as true construct extents: block ranges are extended
 * through their trailing newline for the reason above, so the individual
 * scanners above still report exact extents while this reports where it is
 * actually safe to write.
 */
export function unsafeRanges (doc: string): DocumentRange[] {
  return [
    ...fencedCodeRanges(doc).map(range => throughEndOfLine(doc, range)),
    ...htmlCommentRanges(doc).map(range => throughEndOfLine(doc, range)),
    ...inlineCodeRanges(doc),
    ...linkRanges(doc)
  ]
}

/**
 * The nearest offset at or after `position` that does not fall inside a fenced
 * code block, HTML comment (including a thread block), code span, or link. Boundaries count as safe: an offset exactly
 * at the start or end of a construct is left alone.
 */
export function safeMarkerPosition (doc: string, position: number): number {
  let target = Math.max(0, Math.min(position, doc.length))
  const ranges = unsafeRanges(doc)

  // Constructs can nest (a code span inside a link), so iterate to a fixed
  // point rather than assuming one hop is enough.
  for (let pass = 0; pass < ranges.length + 1; pass++) {
    const containing = ranges.find(range => target > range.from && target < range.to)
    if (containing === undefined) {
      return target
    }
    target = containing.to
  }

  return target
}
