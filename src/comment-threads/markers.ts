import type { CommentMarker, CommentThreadStatus } from './types'

/**
 * The URL-fragment namespace that identifies a comment marker in the document.
 * Deliberately vendor-neutral: a thread-bearing document should be readable by
 * any tool that implements this format, not just the app that wrote it.
 *
 * Changing this changes the on-disk format -- documents written with a
 * different prefix will not have their markers recognised.
 */
export const COMMENT_MARKER_PREFIX = '#md-thread-'
export const OPEN_COMMENT_LABEL = '💬'
export const RESOLVED_COMMENT_LABEL = '✅'

function escapeRegExp (literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const COMMENT_MARKER_RE = new RegExp(
  `\\[(${OPEN_COMMENT_LABEL}|${RESOLVED_COMMENT_LABEL})\\]\\(${escapeRegExp(COMMENT_MARKER_PREFIX)}([^)]+)\\)`,
  'g'
)
const COMMENT_MARKER_FRAGMENT_RE = new RegExp(`^${escapeRegExp(COMMENT_MARKER_PREFIX)}(.+)$`)

export function formatCommentMarker (id: string, status: CommentThreadStatus = 'open'): string {
  const label = status === 'resolved' ? RESOLVED_COMMENT_LABEL : OPEN_COMMENT_LABEL
  return `[${label}](${COMMENT_MARKER_PREFIX}${id})`
}

export function parseCommentMarkerFragment (fragment: string): string|undefined {
  return COMMENT_MARKER_FRAGMENT_RE.exec(fragment)?.[1]
}

export function parseCommentMarkers (doc: string): Map<string, CommentMarker[]> {
  const markers = new Map<string, CommentMarker[]>()

  for (const match of doc.matchAll(COMMENT_MARKER_RE)) {
    if (match.index === undefined || match[2].length === 0) {
      continue
    }

    const marker: CommentMarker = {
      from: match.index,
      to: match.index + match[0].length,
      status: match[1] === RESOLVED_COMMENT_LABEL ? 'resolved' : 'open'
    }
    markers.set(match[2], [ ...(markers.get(match[2]) ?? []), marker ])
  }

  return markers
}

export function quoteCommentSelection (selection: string): string {
  const trimmed = selection.trim()
  return trimmed.length === 0
    ? ''
    : trimmed.split('\n').map(line => `> ${line}`).join('\n')
}

export function effectiveCommentCreationPosition (
  selection: { empty: boolean, head: number, to: number },
  selectedText: string
): number {
  if (selection.empty) {
    return selection.head
  }

  const trailingWhitespace = /\s*$/.exec(selectedText)?.[0].length ?? 0
  return selection.to - trailingWhitespace
}

/**
 * Returns the separator + block to insert at the end of `doc` (not the whole
 * concatenated document) so that the thread block is preceded by a blank line.
 */
export function appendThreadBlock (doc: string, block: string): string {
  if (doc.length === 0) {
    return block
  }

  const trailingNewlines = /\n*$/.exec(doc)?.[0].length ?? 0
  return `${'\n'.repeat(Math.max(0, 2 - trailingNewlines))}${block}`
}
