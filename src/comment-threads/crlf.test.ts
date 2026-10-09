import { describe, it, expect } from 'vitest'
import * as lib from './index'
import { AGENT_SKILL_BODY } from '../agent-skill/skill'

const toCrlf = (s: string): string => s.replace(/\r?\n/g, '\r\n')

describe('CRLF documents', () => {
  const lf = lib.openThread('Hello world\n\nTail text\n', 5, 'Ann', 'First').doc
  const crlf = toCrlf(lf)

  it('parses the same threads with exact offsets', () => {
    const a = lib.parseCommentThreads(lf)
    const b = lib.parseCommentThreads(crlf)
    expect(b).toHaveLength(1)
    expect(b[0].id).toBe(a[0].id)
    expect(b[0].messages).toEqual(a[0].messages)
    expect(b[0].markers).toHaveLength(1)
    expect(crlf.slice(b[0].from, b[0].to).startsWith('<!--')).toBe(true)
    expect(crlf.slice(b[0].from, b[0].to).endsWith('-->')).toBe(true)
  })

  it('deletes a thread without leaving it behind', () => {
    const next = lib.deleteThread(crlf, { id: lib.parseCommentThreads(crlf)[0].id } as never)
    expect(lib.parseCommentThreads(next)).toHaveLength(0)
    expect(next).not.toContain('<!--')
  })

  it('strips front matter from a CRLF skill', () => {
    expect(AGENT_SKILL_BODY.startsWith('---')).toBe(false)
  })
})
