/** Covers controllers/threadEdits: the shared Reply and Resolve/Reopen edits give byte-identical documents to the library calls the desktop sidebar made before they were shared, on the same inputs (open, resolved, duplicate ids, missing marker, a ✅ on an open thread). */
import { appendToThread, setThreadStatus } from '../comment-threads';
import { listThreads } from '../model/threads';
import { replyText, statusText } from './threadEdits';

const A = 'c20260910143022a3f9c1';
const blk = (id: string, status: string, body: string) => `<!--\n@thread ${id}\n@status ${status}\n\n[User | 2026-09-10T14:30:22+02:00]\n${body}\n-->`;
const DOCS: Record<string, string> = {
  open: `Para [💬](#md-thread-${A}) here.\n\n${blk(A, 'open', 'First?')}\n`,
  resolved: `Para [✅](#md-thread-${A}) here.\n\n${blk(A, 'resolved', 'First?')}\n`,
  duplicate: `One [💬](#md-thread-${A}) two [💬](#md-thread-${A}).\n\n${blk(A, 'open', 'First?')}\n\n${blk(A, 'open', 'Second?')}\n`,
  noMarker: `Para here.\n\n${blk(A, 'open', 'First?')}\n`,
  glyphMismatch: `Para [✅](#md-thread-${A}) here.\n\n${blk(A, 'open', 'First?')}\n`,
};

describe.each(Object.entries(DOCS))('%s', (_name, doc) => {
  const items = listThreads(doc);
  test.each(items.map((i) => i.key))('status of %s matches the desktop path, both ways', (key) => {
    const item = items.find((i) => i.key === key)!;
    const ref = { id: item.thread.id, ordinal: item.ordinal };
    const resolved = statusText(doc, item, 'resolved');
    expect(resolved).toBe(setThreadStatus(doc, ref, 'resolved'));
    expect(statusText(resolved, item, 'open')).toBe(setThreadStatus(setThreadStatus(doc, ref, 'resolved'), ref, 'open'));
  });
  test.each(items.map((i) => i.key))('reply to %s matches the desktop path', (key) => {
    const item = items.find((i) => i.key === key)!;
    const ref = { id: item.thread.id, ordinal: item.ordinal };
    expect(replyText(doc, item, 'User', '  Thanks \n')).toBe(appendToThread(doc, ref, 'User', 'Thanks'));
  });
});

test('Resolve then Reopen on a plain open thread returns the original bytes', () => {
  const item = listThreads(DOCS.open)[0];
  expect(statusText(statusText(DOCS.open, item, 'resolved'), item, 'open')).toBe(DOCS.open);
});
