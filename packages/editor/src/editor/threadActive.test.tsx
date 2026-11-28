/** The active thread marker (setActiveThread / MarkdownEditor's activeThreadKey): class and aria-current on exactly one marker, duplicate ids by ordinal, resolved look kept, cleared with null, Raw round trip, tab restore. */
import { render } from '@testing-library/react';
import { createRef } from 'react';
import { expect, it } from 'vitest';
import { settleEditors } from '../testing/editor';
import { MarkdownEditor, type EditorHandle } from './MarkdownEditor';

const A = 'c20260910143022a3f9c1';
const B = 'c20260910143022b4a0d2';
const block = (id: string, status = 'open') => `<!--\n@thread ${id}\n@status ${status}\n\n[User | 2026-09-10T14:30:22+02:00]\nWhy?\n-->`;
const DOC = `One [💬](#md-thread-${A}) two [✅](#md-thread-${B}) three [💬](#md-thread-${A}).\n\n${block(A)}\n\n${block(B, 'resolved')}\n\n${block(A)}\n`;

function mount(activeThreadKey: string | null, extra: { tabId?: number; raw?: boolean; text?: string } = {}) {
  const el = (key: string | null, o: typeof extra) => (
    <MarkdownEditor ref={createRef<EditorHandle>()} tabId={o.tabId ?? 1} text={o.text ?? DOC} raw={o.raw ?? false} readOnly={false} tabIds={[1, 2]} onChange={() => {}} onSelection={() => {}} docPath={null} onOpenThread={() => {}} onTable={() => {}} onContextMenu={() => {}} activeThreadKey={key} />
  );
  const r = render(el(activeThreadKey, extra));
  return { set: (key: string | null, o: typeof extra = extra) => r.rerender(el(key, o)) };
}
const markers = () => (settleEditors(document.body), Array.from(document.querySelectorAll<HTMLElement>('.cm-thread-marker')));
const active = () => markers().filter((m) => m.classList.contains('cm-thread-active'));

it('marks the open thread: class and aria-current, no other marker', () => {
  const e = mount(`${B}#0`);
  expect(active().map((m) => m.dataset.threadId)).toEqual([B]);
  expect(active()[0].getAttribute('aria-current')).toBe('true');
  expect(markers().filter((m) => m.getAttribute('aria-current') === 'true')).toHaveLength(1);
  e.set(null);
  expect(active()).toHaveLength(0);
});

it('with several markers sharing an id only the one with the matching ordinal is active', () => {
  const e = mount(`${A}#1`);
  const m = markers();
  expect(m.map((x) => x.classList.contains('cm-thread-active'))).toEqual([false, false, true]);
  e.set(`${A}#0`);
  expect(markers().map((x) => x.classList.contains('cm-thread-active'))).toEqual([true, false, false]);
});

it('a resolved marker is active together with its resolved look', () => {
  mount(`${B}#0`);
  expect(active()[0].classList.contains('cm-thread-resolved')).toBe(true);
});

it('Raw has no marker; back to Formatted shows the active marker again', () => {
  const e = mount(`${A}#0`);
  e.set(`${A}#0`, { raw: true });
  expect(markers()).toHaveLength(0);
  e.set(`${A}#0`, { raw: false });
  expect(active().map((m) => m.dataset.threadId)).toEqual([A]);
});

it('switching tabs and back never shows a stale active marker', () => {
  const e = mount(`${A}#0`);
  e.set(null, { tabId: 2 });
  expect(active()).toHaveLength(0);
  e.set(null, { tabId: 1 });
  expect(active()).toHaveLength(0);
  e.set(`${B}#0`, { tabId: 1 });
  expect(active().map((m) => m.dataset.threadId)).toEqual([B]);
});
