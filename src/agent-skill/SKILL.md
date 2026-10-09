---
name: gonq-comment-threads
description: Read, reply to, open, resolve and reopen comment threads in a Markdown file edited with Gonq. Use when a .md file contains `[💬](#md-thread-…)` markers or `@thread` HTML comments, or when asked to review or discuss a passage in such a file.
---

# Gonq comment threads

Gonq stores threaded comments inside the `.md` file itself. A file with threads is
still plain Markdown: edit it with ordinary file tools and keep everything outside
the threads exactly as it is.

## Format

An **anchor marker** sits inline in the prose, at the passage being discussed:

    The estimate holds through Q3 [💬](#md-thread-c20260910143022a3f9c1) but not beyond.

The **thread body** is an HTML comment appended at the end of the file:

    <!--
    @thread c20260910143022a3f9c1
    @status open
    @anchor holds through Q3

    [User | 2026-09-10T14:30:22+02:00]
    Where does this number come from?

    [my-agent:1234 | 2026-09-10T14:31:05+02:00]
    Q2 actuals, extrapolated. Citation added.
    -->

- `@thread <id>` and `@status <open|resolved>` are required; a block missing either is ignored.
- `@anchor <text>` is the selected text on one line, present only if the thread was made on a selection.
- A message is a header `[<author> | <timestamp>]` followed by its text, up to the next header.
- The author may contain neither `|` nor `]`. The timestamp is ISO-8601 with a UTC offset.
- A resolved thread's marker shows `✅` instead of `💬`.
- Inside a message, write `--\>` for a literal `-->`. A bare `-->` closes the block early and orphans the rest of it.

## What you may do

- **Read** a thread: find its block by `@thread <id>`; the marker with the same id shows where it is anchored.
- **Reply**: append a message at the end of that thread, inside its comment block, before the closing `-->`. Sign with your own name, for example `[my-agent:1234 | 2026-09-10T14:31:05+02:00]`.
- **Resolve**: set `@status resolved` and change that thread's marker from `💬` to `✅`. **Reopen** by reversing both.
- **Open a thread**: add a marker `[💬](#md-thread-<id>)` at the passage, and append a new block at the end of the file. Make the id `c` + local time `YYYYMMDDhhmmss` + 12 random hex characters; ids must be unique.

## What you must not do

- Never edit or delete existing messages or threads, and never alter other agents' or people's messages.
- Never place a marker inside a fenced code block, inline code, an HTML comment, or another link. Put it just after the code or link instead.
- Do not reformat, re-wrap or otherwise rewrite the rest of the document.
- Do not remove the guidance comment titled "Gonq comment threads: guidance for AI agents".
