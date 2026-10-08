/**
 * The note for AI agents that Gonq embeds, once, in a file that carries threads.
 *
 * It is an HTML comment with no `@thread` directive, so the parser never reads
 * it as a thread and no renderer shows it. Keep it short and in step with the
 * README: agents are told the same rules there.
 */
export const AGENT_GUIDANCE_TITLE = 'Gonq comment threads: guidance for AI agents'

export const AGENT_GUIDANCE = `<!--
${AGENT_GUIDANCE_TITLE}
This file holds comment threads. Each is an HTML comment block starting with
"@thread <id>" and "@status open|resolved", then messages. A message is a header
"[<author> | <timestamp>]" followed by its text, up to the next header. The
inline marker [💬](#md-thread-<id>) in the prose shows where a thread is anchored.
To reply, append a message at the end of the thread, inside its comment block,
with your own signature as author and an ISO-8601 timestamp with offset,
for example "[my-agent:1234 | 2026-09-10T14:31:05+02:00]".
To resolve, set "@status resolved" and change the marker's 💬 to ✅. To reopen, reverse that.
You may open threads, reply, resolve and reopen.
Never edit or delete existing messages or threads. Inside a message, write "--\\>" for a literal comment terminator.
-->`

/** Whether the document already carries the guidance, from any writer. */
export function hasAgentGuidance (doc: string): boolean {
  return doc.includes(AGENT_GUIDANCE_TITLE)
}

/**
 * Inserts the guidance at `offset` (a line start) as its own paragraph, unless
 * the document already has it. Returns the document unchanged in that case.
 */
export function withAgentGuidance (doc: string, offset: number): string {
  if (hasAgentGuidance(doc)) return doc
  const before = doc.slice(0, offset).replace(/\n*$/, '')
  const after = doc.slice(offset).replace(/^\n*/, '')
  return `${before}${before === '' ? '' : '\n\n'}${AGENT_GUIDANCE}\n\n${after}`
}
