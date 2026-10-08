import { describe, it, expect, vi } from 'vitest'
import * as lib from './index'
import type { CommentThread } from './types'
import * as assert from './testAssert'

// The port exercises the library through an untyped handle, as test.cjs did.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m: any = lib

// Ported 1:1 from test.cjs. Sections share fixtures from the first section
// (thread/doc/parsed), so they must run in file order.
/* eslint-disable @typescript-eslint/no-explicit-any */
describe('comment-threads', () => {
  let thread: any, block: string, doc: string, parsed: CommentThread[]
  let fenced: string, DUP: string, dupBlock: (body: string) => string, dupDoc: string

  it("format round-trip", () => {
  thread = m.createCommentThread('user', 'This paragraph needs a citation.')
  block = m.serializeCommentThread(thread)
  doc = `Some prose here ${m.formatCommentMarker(thread.id)}\n\n${block}\n`
  parsed = m.parseCommentThreads(doc)
  assert.strictEqual(parsed.length, 1)
  assert.strictEqual(parsed[0].id, thread.id)
  assert.strictEqual(parsed[0].messages[0].body, 'This paragraph needs a citation.')
  assert.strictEqual(parsed[0].markers.length, 1)
  })

  it("reply / resolve", () => {
  const replied = m.appendReply(parsed[0], 'user', 'Added one.')
  const resolved = m.resolveThread({ ...parsed[0], messages: replied.messages })
  const doc2 = m.replaceCommentThreadBlock(doc, parsed[0], m.serializeCommentThread(resolved))
  const re = m.parseCommentThreads(doc2)
  assert.strictEqual(re[0].status, 'resolved')
  assert.strictEqual(re[0].messages.length, 2)
  assert.ok(m.formatCommentMarker(re[0].id, 'resolved').includes('✅'), 'resolved glyph is U+2705')
  })

  it("id uniqueness under a frozen clock", () => {
  vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-10T14:30:22'))
    let ids: Set<string>
    try {
    ids = new Set(Array.from({ length: 2000 }, () => m.createCommentThread('user', 'x').id))
    } finally { vi.useRealTimers() }
  assert.strictEqual(ids.size, 2000)
  })

  it("position safety: fenced code", () => {
  fenced = 'intro\n\n```js\nconst a = 1\n```\n\nafter\n'
  const insideFence = fenced.indexOf('const a')
  assert.notStrictEqual(m.safeMarkerPosition(fenced, insideFence), insideFence, 'must not stay in fence')
  assert.strictEqual(m.safeMarkerPosition(fenced, insideFence), fenced.indexOf('```\n\nafter') + 4,
    'clears the closing fence line entirely, not just the delimiter')
  // a marker on the delimiter's own line would stop the construct closing
  {
    const at = m.safeMarkerPosition(fenced, insideFence)
    const spliced = fenced.slice(0, at) + m.formatCommentMarker('f1') + fenced.slice(at)
    assert.strictEqual(m.fencedCodeRanges(spliced).length, 1, 'fence still closes after insertion')
  }
  assert.strictEqual(m.fencedCodeRanges(fenced).length, 1)

  // unterminated fence runs to EOF
  assert.strictEqual(m.fencedCodeRanges('a\n```\nb\n').length, 1)
  assert.strictEqual(m.safeMarkerPosition('a\n```\nb\n', 6), 8)

  // tildes, and a longer closing fence
  assert.strictEqual(m.fencedCodeRanges('~~~\nx\n~~~\n').length, 1)
  assert.strictEqual(m.fencedCodeRanges('```\nx\n`````\n').length, 1)
  })

  it("position safety: inline code + links", () => {
  const inline = 'use `npm install` now'
  const insideCode = inline.indexOf('npm')
  assert.strictEqual(m.safeMarkerPosition(inline, insideCode), inline.indexOf('` now') + 1)

  const link = 'see [the docs](https://example.com) here'
  const insideLink = link.indexOf('example')
  assert.strictEqual(m.safeMarkerPosition(link, insideLink), link.indexOf(') here') + 1)

  // an existing marker is a link: never split one
  const withMarker = `text [💬](#md-thread-abc) more`
  const insideMarker = withMarker.indexOf('#md-thread')
  assert.strictEqual(m.safeMarkerPosition(withMarker, insideMarker), withMarker.indexOf(') more') + 1)

  // backticks inside a fence are not treated as inline spans
  assert.strictEqual(m.inlineCodeRanges('```\na `b` c\n```\n').length, 0)
  })

  it("safe positions are left alone", () => {
  const plain = 'just some prose here'
  assert.strictEqual(m.safeMarkerPosition(plain, 9), 9)
  assert.strictEqual(m.safeMarkerPosition(plain, 0), 0)
  assert.strictEqual(m.safeMarkerPosition(plain, 999), plain.length)
  assert.strictEqual(m.safeMarkerPosition(fenced, fenced.indexOf('after')), fenced.indexOf('after'))
  })

  it("malformed blocks ignored", () => {
  for (const bad of ['<!--\n@thread nope\n-->', '<!--\n@status open\n-->', '<!--\n@thread a\n@status bogus\n-->', '<!--\n@thread a\n@status open\n']) {
    assert.strictEqual(m.parseCommentThreads(bad).length, 0)
  }
  })

  it("end-to-end: agent appends a comment to a doc with a code block", () => {
  let live = 'Intro para.\n\n```py\nx = 1\n```\n\nOutro para.\n'
  const t2 = m.createCommentThread('user', 'Explain this constant.')
  const pos = m.safeMarkerPosition(live, live.indexOf('x = 1'))
  const mk = m.formatCommentMarker(t2.id)
  live = live.slice(0, pos) + mk + live.slice(pos) 
  live = live.replace(/\n*$/, '\n\n') + m.serializeCommentThread(t2) + '\n'
  const found = m.parseCommentThreads(live)
  assert.strictEqual(found.length, 1, 'thread readable after append')
  assert.strictEqual(found[0].markers.length, 1, 'exactly one marker')
  assert.ok(live.includes('x = 1\n```'), 'code block left intact')
  })

  it("ordinal pairing under duplicate ids", () => {
  DUP = 'dup1'
  dupBlock = (body: string) => `<!--\n@thread ${DUP}\n@status open\n@anchor a\n\n[user | ts]\n${body}\n-->`
  dupDoc = `Para one ${m.formatCommentMarker(DUP)} text.\n\n` +
    `Para two ${m.formatCommentMarker(DUP)} text.\n\n${dupBlock('FIRST')}\n\n${dupBlock('SECOND')}\n`
  const dupThreads = m.parseCommentThreads(dupDoc)
  const dupMarkers = m.parseCommentMarkers(dupDoc).get(DUP)
  assert.strictEqual(dupThreads.length, 2, 'both blocks parsed')
  assert.strictEqual(dupMarkers.length, 2, 'both markers found')
  // nth block pairs with nth marker, in document order
  assert.strictEqual(dupThreads[0].markers.length, 1, 'first block gets exactly one marker')
  assert.strictEqual(dupThreads[1].markers.length, 1, 'second block gets exactly one marker')
  assert.strictEqual(dupThreads[0].markers[0].from, dupMarkers[0].from, 'FIRST pairs with earlier marker')
  assert.strictEqual(dupThreads[1].markers[0].from, dupMarkers[1].from, 'SECOND pairs with later marker')
  assert.notStrictEqual(dupThreads[0].markers[0].from, dupThreads[1].markers[0].from, 'no collapse onto one marker')
  // the unique-id case is unchanged by pairing
  assert.strictEqual(parsed[0].markers.length, 1, 'unique id still gets its marker')
  })

  it("surplus and orphan detection", () => {
  // two markers, one block: second marker is dangling
  const surplus = `a ${m.formatCommentMarker(DUP)} b ${m.formatCommentMarker(DUP)} c\n\n${dupBlock('only')}\n`
  assert.strictEqual(m.parseCommentThreads(surplus)[0].markers.length, 1, 'block takes its ordinal marker')
  assert.strictEqual(m.danglingMarkers(surplus).get(DUP).length, 1, 'surplus marker reported dangling')
  // block with no marker at all is orphaned but visible
  assert.strictEqual(m.parseCommentThreads(dupBlock('lonely'))[0].markers.length, 0, 'orphan block detectable')
  // marker whose block was removed is now detectable
  const removed = `prose ${m.formatCommentMarker('gone')} more`
  assert.strictEqual(m.parseCommentThreads(removed).length, 0, 'no block to parse')
  assert.strictEqual(m.danglingMarkers(removed).get('gone').length, 1, 'dangling marker surfaced')
  // a healthy document reports nothing dangling
  assert.strictEqual(m.danglingMarkers(dupDoc).size, 0, 'balanced doc has no dangles')
  assert.strictEqual(m.danglingMarkers(doc).size, 0, 'single-thread doc has no dangles')
  })

  it("forward compatibility with other tools", () => {
  const withUnknown = '<!--\n@thread fw1\n@status open\n@anchor a\n@version 2\n@tool someeditor\n\n[user | ts]\nbody\n-->'
  const fw = m.parseCommentThreads(withUnknown)
  assert.strictEqual(fw.length, 1, 'unknown @ directives no longer fatal')
  assert.strictEqual(fw[0].id, 'fw1')
  assert.strictEqual(fw[0].messages[0].body, 'body', 'message still recovered')
  // unknown directives are ignored, not preserved
  assert.ok(!m.serializeCommentThread(fw[0]).includes('@version'), 'unknown directive dropped on re-serialise')
  // non-directive junk is still rejected, so malformed blocks stay malformed
  assert.strictEqual(m.parseCommentThreads('<!--\n@thread a\n@status open\n@anchor a\nhello\n\n[user | ts]\nx\n-->').length, 0,
    'arbitrary prose in metadata still rejected')
  })

  it("FA-17: author is an open vocabulary", () => {
  const agent = 'architect-agent:75a079f6'
  const agentThread = m.createCommentThread(agent, 'Per-agent attribution.')
  const agentDoc = m.serializeCommentThread(agentThread)
  const agentBack = m.parseCommentThreads(agentDoc)
  assert.strictEqual(agentBack.length, 1, 'foreign author no longer drops the thread')
  assert.strictEqual(agentBack[0].messages[0].author, agent, 'author round-trips verbatim')
  // a colon-bearing agent identity is the motivating case
  assert.ok(agent.includes(':'), 'sanity: identity carries a colon')
  // replies carry their own author
  const twoAuthors = m.appendReply(agentBack[0], 'reviewer-agent:ff01', 'Ack.')
  assert.strictEqual(twoAuthors.messages[1].author, 'reviewer-agent:ff01')
  const mixed = m.parseCommentThreads(m.serializeCommentThread(twoAuthors))[0]
  assert.deepStrictEqual(mixed.messages.map((x: any) => x.author), [agent, 'reviewer-agent:ff01'], 'distinct authors preserved')

  // the two reserved characters are refused on write, not silently corrupted
  for (const bad of ['has|pipe', 'has]bracket', '']) {
    assert.throws(() => m.createCommentThread(bad, 'x'), /Invalid comment author/, `rejects ${JSON.stringify(bad)}`)
    assert.throws(() => m.appendReply(agentBack[0], bad, 'x'), /Invalid comment author/)
  }
  })

  it("FA-18: escaping is symmetric", () => {
  for (const body of ['Use the arrow --> here', '-->', 'a -->\nb --> c', 'no arrows at all']) {
    const t = m.createCommentThread('user', body)
    const round = m.parseCommentThreads(m.serializeCommentThread(t))
    assert.strictEqual(round.length, 1, `block survives body ${JSON.stringify(body)}`)
    assert.strictEqual(round[0].messages[0].body, body, `lossless: ${JSON.stringify(body)}`)
  }
  // the escape is still applied on the wire, so a lone --> cannot close the block
  assert.ok(m.serializeCommentThread(m.createCommentThread('user', '-->')).includes('--\\>'),
    'escape still written')
  // double round-trip is stable
  const tricky = m.createCommentThread('user', 'x --> y')
  const once = m.parseCommentThreads(m.serializeCommentThread(tricky))[0]
  const twice = m.parseCommentThreads(m.serializeCommentThread(once))[0]
  assert.strictEqual(twice.messages[0].body, 'x --> y', 'stable across two round-trips')
  })

  it("glyph", () => {
  assert.ok(m.formatCommentMarker('g1', 'resolved').includes('\u2705'), 'resolved marker uses U+2705')
  assert.ok(m.formatCommentMarker('g1').includes('\u{1F4AC}'), 'open marker unchanged')
  // both glyphs are still recognised by the scanner
  assert.strictEqual(m.parseCommentMarkers(m.formatCommentMarker('g1', 'resolved')).get('g1')[0].status, 'resolved')
  assert.strictEqual(m.parseCommentMarkers(m.formatCommentMarker('g1')).get('g1')[0].status, 'open')
  })

  it("regression: a marker must never land inside a thread block", () => {
  {
    const t = m.createCommentThread('user', 'Existing thread body here.')
    const base = `Prose ${m.formatCommentMarker(t.id)} more prose.\n\n${m.serializeCommentThread(t)}\n`
    const insideBody = base.indexOf('Existing thread body')
    assert.notStrictEqual(m.safeMarkerPosition(base, insideBody), insideBody,
      'offset inside a thread block must move')
    assert.strictEqual(m.htmlCommentRanges(base).length, 1, 'thread block seen as an HTML comment')
    // unterminated comment runs to EOF; a comment inside a fence is not a comment
    assert.strictEqual(m.htmlCommentRanges('a\n<!--\nb\n').length, 1)
    assert.strictEqual(m.htmlCommentRanges('```\n<!--\n```\n').length, 0)

    // opening a thread at that offset must not corrupt the existing one
    const opened = m.openThread(base, { from: insideBody, to: insideBody + 8 }, 'user', 'New thread.')
    const both = m.parseCommentThreads(opened.doc)
    assert.strictEqual(both.length, 2, 'two threads')
    const original = both.find((x: any) => x.id === t.id)
    assert.strictEqual(original.messages[0].body, 'Existing thread body here.',
      'original message body untouched')
    assert.strictEqual(original.markers.length, 1)
    assert.strictEqual(opened.thread.markers.length, 1, 'new thread is anchored')
    // and the new marker is in prose, not buried in a comment
    const newMarker = opened.thread.markers[0]
    assert.ok(!m.htmlCommentRanges(opened.doc).some((r: any) => newMarker.from > r.from && newMarker.from < r.to),
      'new marker is not inside any HTML comment')
  }
  })

  it("document-level API", () => {
  {
    let d = 'First para.\n\nSecond para.\n'
    const a = m.openThread(d, { from: d.indexOf('First'), to: d.indexOf('First') + 5 }, 'agent:a1', 'Question one.')
    d = a.doc
    assert.strictEqual(m.parseCommentThreads(d).length, 1)
    assert.strictEqual(a.thread.markers.length, 1, 'openThread anchors in one step')
    assert.strictEqual(a.thread.messages[0].author, 'agent:a1')

    // append, preserving prior messages and other threads
    const b = m.openThread(d, { from: d.indexOf('Second'), to: d.indexOf('Second') + 6 }, 'agent:b2', 'Question two.')
    d = b.doc
    d = m.appendToThread(d, { id: a.thread.id }, 'agent:c3', 'Answer one.')
    const after = m.parseCommentThreads(d)
    assert.strictEqual(after.length, 2, 'both threads survive an append')
    const threadA = after.find((x: any) => x.id === a.thread.id)
    assert.deepStrictEqual(threadA.messages.map((x: any) => x.body), [ 'Question one.', 'Answer one.' ])
    assert.deepStrictEqual(threadA.messages.map((x: any) => x.author), [ 'agent:a1', 'agent:c3' ])
    assert.strictEqual(after.find((x: any) => x.id === b.thread.id).messages.length, 1, 'other thread untouched')

    // status flips block and marker together
    d = m.setThreadStatus(d, { id: a.thread.id }, 'resolved')
    const resolvedThread = m.parseCommentThreads(d).find((x: any) => x.id === a.thread.id)
    assert.strictEqual(resolvedThread.status, 'resolved', 'block status flipped')
    assert.strictEqual(resolvedThread.markers[0].status, 'resolved', 'marker glyph flipped with it')
    assert.strictEqual(resolvedThread.messages.length, 2, 'resolve preserves every message')
    assert.ok(d.includes('\u2705'), 'resolved glyph present in document')
    // and back again
    d = m.setThreadStatus(d, { id: a.thread.id }, 'open')
    assert.strictEqual(m.parseCommentThreads(d).find((x: any) => x.id === a.thread.id).markers[0].status, 'open')
  }
  })

  it("ThreadRef resolution", () => {
  {
    const DUP2 = 'dupref'
    const blk = (body: string) => `<!--\n@thread ${DUP2}\n@status open\n@anchor a\n\n[user | ts]\n${body}\n-->`
    const d = `x ${m.formatCommentMarker(DUP2)} y ${m.formatCommentMarker(DUP2)} z\n\n${blk('A')}\n\n${blk('B')}\n`

    assert.throws(() => m.resolveThreadRef(d, { id: 'nope' }), /No thread/, 'missing id throws')
    assert.throws(() => m.resolveThreadRef(d, { id: DUP2 }), /Ambiguous/, 'duplicate id without ordinal throws')
    assert.strictEqual(m.resolveThreadRef(d, { id: DUP2, ordinal: 0 }).messages[0].body, 'A')
    assert.strictEqual(m.resolveThreadRef(d, { id: DUP2, ordinal: 1 }).messages[0].body, 'B')
    assert.throws(() => m.resolveThreadRef(d, { id: DUP2, ordinal: 5 }), /ordinal 5/, 'out-of-range ordinal throws')

    // mutating operations refuse an ambiguous ref rather than guessing
    assert.throws(() => m.appendToThread(d, { id: DUP2 }, 'user', 'x'), /Ambiguous/)
    assert.throws(() => m.setThreadStatus(d, { id: DUP2 }, 'resolved'), /Ambiguous/)
    // with an ordinal they act on exactly one
    const only = m.setThreadStatus(d, { id: DUP2, ordinal: 1 }, 'resolved')
    const states = m.parseCommentThreads(only).map((x: any) => x.status)
    assert.deepStrictEqual(states, [ 'open', 'resolved' ], 'only the named block changed')
  }
  })

  it("positions and quoted anchors", () => {
  {
    // @anchor is optional: a cursor-created thread has none
    const bare = m.parseCommentThreads('<!--\n@thread a\n@status open\n\n[user | ts]\nx\n-->')
    assert.strictEqual(bare.length, 1)
    assert.strictEqual(bare[0].anchor, undefined)
    assert.ok(!m.serializeCommentThread(bare[0]).includes('@anchor'), 'no @anchor written for a cursor thread')
    // a multi-line selection is stored on one line, whitespace collapsed
    assert.strictEqual(m.createCommentThread('User', 'x', '  two\n  lines\t here ').anchor, 'two lines here')
    assert.strictEqual(m.createCommentThread('User', 'x', ' \n ').anchor, undefined, 'blank selection = no quote')
    // --> in an anchor is escaped like a body, and round-trips
    const arrow = m.createCommentThread('User', 'x', 'a --> b')
    assert.ok(m.serializeCommentThread(arrow).includes('@anchor a --\\> b'))
    assert.strictEqual(m.parseCommentThreads(m.serializeCommentThread(arrow))[0].anchor, 'a --> b')

    // a selection: quoted, marker after it, before trailing space
    let d = 'The estimate holds through Q3 but not beyond.\n'
    const sel = { from: d.indexOf('holds'), to: d.indexOf(' but') + 1 }
    const o = m.openThread(d, sel, 'User', 'Where from?')
    assert.strictEqual(o.thread.anchor, 'holds through Q3')
    assert.ok(o.doc.startsWith('The estimate holds through Q3[\u{1F4AC}](#md-thread-'), 'marker after selection')
    d = m.appendToThread(o.doc, { id: o.thread.id }, 'claude', 'Q2 actuals.')
    d = m.setThreadStatus(d, { id: o.thread.id }, 'resolved')
    d = m.editThreadMessage(d, { id: o.thread.id }, 'Where does this come from?')
    assert.strictEqual(m.parseCommentThreads(d)[0].anchor, 'holds through Q3', 'anchor survives append, resolve, edit')

    // a cursor: marker at the cursor, no quote, and it stays unquoted
    const c = m.openThread('Alpha beta.\n', 5, 'User', 'Here.')
    assert.ok(c.doc.startsWith('Alpha[\u{1F4AC}](#md-thread-'), 'marker at cursor')
    assert.strictEqual(c.thread.anchor, undefined)
    const cr = m.setThreadStatus(m.appendToThread(c.doc, { id: c.thread.id }, 'claude', 'Ok.'), { id: c.thread.id }, 'resolved')
    assert.strictEqual(m.parseCommentThreads(cr)[0].anchor, undefined, 'cursor thread stays unquoted')
    // an empty selection behaves as a cursor
    assert.strictEqual(m.openThread('Alpha beta.\n', { from: 5, to: 5 }, 'User', 'x').thread.anchor, undefined)
  }
  })

  it("edit and delete", () => {
  {
    const original = 'First para.\n\nSecond para.\n'
    const a = m.openThread(original, { from: 0, to: 5 }, 'User', 'One.')
    const b = m.openThread(a.doc, { from: a.doc.indexOf('Second'), to: a.doc.indexOf('Second') + 6 }, 'User', 'Two.')
    let d = m.appendToThread(b.doc, { id: a.thread.id }, 'agent:x', 'Reply.')

    // edit replaces the first message only
    d = m.editThreadMessage(d, { id: a.thread.id }, 'One, edited.')
    const ta = m.parseCommentThreads(d).find((x: any) => x.id === a.thread.id)
    assert.deepStrictEqual(ta.messages.map((x: any) => x.body), [ 'One, edited.', 'Reply.' ])
    assert.deepStrictEqual(ta.messages.map((x: any) => x.author), [ 'User', 'agent:x' ], 'authors kept')
    assert.throws(() => m.editThreadMessage(d, { id: a.thread.id }, 'x', 7), /no message 7/)

    // delete removes block and marker together, in either order
    const noA = m.deleteThread(d, { id: a.thread.id })
    assert.deepStrictEqual(m.parseCommentThreads(noA).map((x: any) => x.id), [ b.thread.id ])
    assert.strictEqual(m.danglingMarkers(noA).size, 0, 'no marker left behind')
    const none = m.deleteThread(noA, { id: b.thread.id })
    assert.strictEqual(none, original, 'deleting every thread restores the document')
    const none2 = m.deleteThread(m.deleteThread(b.doc, { id: b.thread.id }), { id: a.thread.id })
    assert.strictEqual(none2, original, 'reverse order also restores it')

    // a marker alone on its line takes its newline with it
    const own = `Para.\n\n${m.formatCommentMarker('own1')}\nNext.\n\n<!--\n@thread own1\n@status open\n@anchor Para\n\n[User | ts]\nx\n-->\n`
    assert.strictEqual(m.deleteThread(own, { id: 'own1' }), 'Para.\n\nNext.\n')

    // ambiguous refs are refused, as for every other mutation
    const blk = (body: string) => `<!--\n@thread dd\n@status open\n@anchor a\n\n[user | ts]\n${body}\n-->`
    const dup = `x ${m.formatCommentMarker('dd')} y ${m.formatCommentMarker('dd')} z\n\n${blk('A')}\n\n${blk('B')}\n`
    assert.throws(() => m.deleteThread(dup, { id: 'dd' }), /Ambiguous/)
    assert.throws(() => m.editThreadMessage(dup, { id: 'dd' }, 'x'), /Ambiguous/)
    const oneLeft = m.deleteThread(dup, { id: 'dd', ordinal: 1 })
    assert.deepStrictEqual(m.parseCommentThreads(oneLeft).map((x: any) => x.messages[0].body), [ 'A' ])
  }
  })

  it("multi-message bodies are stable across repeated round-trips", () => {
  {
    let t = { id: 'stable1', status: 'open', anchor: 'a', messages: [
      { author: 'a', timestamp: 't1', body: 'first' },
      { author: 'b', timestamp: 't2', body: 'second' },
      { author: 'c', timestamp: 't3', body: 'third' }
    ]}
    const want = [ 'first', 'second', 'third' ]
    for (let i = 0; i < 5; i++) {
      t = m.parseCommentThreads(m.serializeCommentThread(t))[0]
      assert.deepStrictEqual(t.messages.map((x: any) => x.body), want, `bodies stable at trip ${i + 1}`)
    }
    // a body containing a deliberate internal blank line still survives
    let para = { id: 'stable2', status: 'open', anchor: 'a', messages: [
      { author: 'a', timestamp: 't1', body: 'one\n\ntwo' },
      { author: 'b', timestamp: 't2', body: 'tail' }
    ]}
    para = m.parseCommentThreads(m.serializeCommentThread(para))[0]
    assert.strictEqual(para.messages[0].body, 'one\n\ntwo', 'internal blank line preserved')
  }

  console.log('ALL PASS —', 'protocol + document API: 14 groups')
  })
})
