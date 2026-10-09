import { describe, it, expect } from 'vitest'
import * as lib from './index'
import { AGENT_SKILL, AGENT_SKILL_BODY, stripFrontMatter } from '../agent-skill/skill'
import agentEdited from '../agent-skill/fixtures/agent-edited.md?raw'

// Converted in the test so the result does not depend on how git checked the files out.
const toCrlf = (s: string): string => s.replace(/\r?\n/g, '\r\n')
const toLf = (s: string): string => s.replace(/\r\n/g, '\n')

const threadsDoc = (() => {
  let d = 'Intro line\n\n```js\nconst a = 1\n```\n\nHello world\n\nTail text\n'
  d = lib.openThread(d, d.indexOf('world'), 'Ann', 'First').doc
  return d
})()

const fixtures: Record<string, string> = {
  'agent-edited.md': toLf(agentEdited),
  'generated thread document': toLf(threadsDoc),
}

describe('CRLF documents', () => {
  for (const [name, source] of Object.entries(fixtures)) {
    describe(name, () => {
      const lf = source
      const crlf = toCrlf(source)
      const a = lib.parseCommentThreads(lf)
      const b = lib.parseCommentThreads(crlf)

      it('parses the same threads', () => {
        expect(a.length).toBeGreaterThan(0)
        expect(b.map((t) => t.id)).toEqual(a.map((t) => t.id))
        expect(b.map((t) => t.status)).toEqual(a.map((t) => t.status))
        expect(b.map((t) => t.anchor)).toEqual(a.map((t) => t.anchor))
        expect(b.map((t) => t.messages)).toEqual(a.map((t) => t.messages))
        expect(b.map((t) => t.markers.length)).toEqual(a.map((t) => t.markers.length))
        expect(b.map((t) => t.markers.map((m) => m.status))).toEqual(a.map((t) => t.markers.map((m) => m.status)))
      })

      it('has offsets that slice the CRLF text to whole comment blocks', () => {
        for (const t of b) {
          const slice = crlf.slice(t.from, t.to)
          expect(slice.startsWith('<!--')).toBe(true)
          expect(slice.endsWith('-->')).toBe(true)
          expect(slice).toContain(`@thread ${t.id}`)
          expect(toLf(slice)).toBe(lf.slice(a.find((x) => x.id === t.id)!.from, a.find((x) => x.id === t.id)!.to))
          for (const m of t.markers) expect(crlf.slice(m.from, m.to)).toContain(`#md-thread-${t.id}`)
        }
      })

      it('deletes every thread, leaving no block behind', () => {
        let next = crlf
        for (const t of lib.parseCommentThreads(crlf)) next = lib.deleteThread(next, lib.parseCommentThreads(next).find((x) => x.id === t.id)!)
        expect(lib.parseCommentThreads(next)).toHaveLength(0)
        expect(next).not.toContain('<!--')
      })
    })
  }
})

describe('stripFrontMatter', () => {
  it('strips front matter from a CRLF skill, matching the LF result', () => {
    const crlf = toCrlf(AGENT_SKILL)
    expect(crlf).toContain('\r\n')
    expect(AGENT_SKILL.startsWith('---')).toBe(true)
    const body = stripFrontMatter(crlf)
    expect(body.startsWith('---')).toBe(false)
    expect(body).toBe(toCrlf(AGENT_SKILL_BODY))
  })
})
