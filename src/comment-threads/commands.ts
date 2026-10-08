import type { CommentThread, SerializableCommentThread } from './types'

function pad (value: number): string {
  return value.toString().padStart(2, '0')
}

/**
 * Twelve hex characters of entropy, from the platform CSPRNG where available.
 * Falls back to Math.random only in environments without WebCrypto.
 *
 * Twelve rather than six because the timestamp prefix is shared by every id
 * minted in the same second, so the suffix is the only thing separating a burst
 * of them. At six hex characters that is 24 bits, and 2000 ids in one second
 * collide about 11% of the time -- well inside what an agent creating threads
 * in a loop will do. At twelve it is 48 bits and the same burst collides with
 * probability around 7e-9.
 */
function randomSuffix (): string {
  const cryptoObj = globalThis.crypto as Crypto|undefined

  if (cryptoObj?.getRandomValues !== undefined) {
    const bytes = new Uint8Array(6)
    cryptoObj.getRandomValues(bytes)
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  }

  return Array.from(
    { length: 2 },
    () => Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, '0')
  ).join('')
}

/**
 * Local-time `YYYYMMDDhhmmss` plus twelve random hex characters. Self-contained by
 * design: this module has no dependency on any host application.
 *
 * The timestamp prefix keeps ids sortable and human-legible; the random suffix
 * is what makes them safe. Without it, two threads created in the same second
 * share an id, which makes `parseCommentMarkers` return two markers for that id
 * -- and every mutation guarded by `markers.length !== 1` (resolve, delete,
 * provisional removal) then silently does nothing.
 */
function generateThreadId (date = new Date()): string {
  const timestamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('')

  return `${timestamp}${randomSuffix()}`
}

export function getLocalTimestamp (date = new Date()): string {
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absOffset = Math.abs(offsetMinutes)
  const offset = `${sign}${pad(Math.floor(absOffset / 60))}:${pad(absOffset % 60)}`

  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
    ':',
    pad(date.getSeconds()),
    offset
  ].join('')
}

const UNWRITABLE_AUTHOR_RE = /[|\]]/

/**
 * Authors are an open vocabulary, but the message header syntax reserves two
 * characters. Writing one would produce a document whose own parser cannot read
 * the message back, so it is refused here rather than discovered later.
 */
function assertWritableAuthor (author: string): void {
  if (author.length === 0 || UNWRITABLE_AUTHOR_RE.test(author)) {
    throw new Error(
      `Invalid comment author ${JSON.stringify(author)}: must be non-empty and contain neither "|" nor "]".`
    )
  }
}

/**
 * Reduces a selection to the one-line form stored in `@anchor`: whitespace
 * runs, newlines included, collapse to a single space. Returns undefined when
 * nothing is left, which is the same as creating the thread at a cursor.
 */
export function normalizeAnchor (selection: string|undefined): string|undefined {
  const anchor = (selection ?? '').replace(/\s+/g, ' ').trim()
  return anchor.length === 0 ? undefined : anchor
}

/**
 * `anchor` is the selected text the thread is created on; omit it for a thread
 * created at a cursor position.
 */
export function createCommentThread (author: string, initialBody = '', anchor?: string): SerializableCommentThread {
  assertWritableAuthor(author)
  const quoted = normalizeAnchor(anchor)

  return {
    id: `c${generateThreadId()}`,
    status: 'open',
    ...(quoted === undefined ? {} : { anchor: quoted }),
    messages: initialBody.trim().length > 0
      ? [{ author, timestamp: getLocalTimestamp(), body: initialBody }]
      : []
  }
}

export function appendReply (thread: CommentThread, author: string, body: string): SerializableCommentThread {
  assertWritableAuthor(author)

  return {
    id: thread.id,
    status: thread.status,
    ...(thread.anchor === undefined ? {} : { anchor: thread.anchor }),
    messages: [
      ...thread.messages,
      { author, timestamp: getLocalTimestamp(), body }
    ]
  }
}

export function editCommentMessage (thread: CommentThread, messageIndex: number, body: string): SerializableCommentThread {
  return {
    id: thread.id,
    status: thread.status,
    ...(thread.anchor === undefined ? {} : { anchor: thread.anchor }),
    messages: thread.messages.map((message, index) => {
      return index === messageIndex ? { ...message, body } : message
    })
  }
}

export function resolveThread (thread: CommentThread): SerializableCommentThread {
  return {
    id: thread.id,
    status: 'resolved',
    ...(thread.anchor === undefined ? {} : { anchor: thread.anchor }),
    messages: thread.messages
  }
}
