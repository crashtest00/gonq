/** MarkdownEditor's `nativeContextMenu` prop: default false keeps the desktop right-click behaviour (preventDefault, onContextMenu called); true leaves contextmenu to the OS (no preventDefault, no callback). */
import { createEvent, fireEvent, render } from '@testing-library/react';
import { createRef } from 'react';
import { expect, it, vi } from 'vitest';
import { settleEditors } from '../testing/editor';
import { MarkdownEditor, type EditorHandle } from './MarkdownEditor';

function mount(native?: boolean) {
  const onContextMenu = vi.fn();
  render(
    <MarkdownEditor
      ref={createRef<EditorHandle>()}
      tabId={1}
      text="Hello brave world."
      raw
      readOnly={false}
      tabIds={[1]}
      onChange={() => {}}
      onSelection={() => {}}
      docPath={null}
      onOpenThread={() => {}}
      onTable={() => {}}
      onContextMenu={onContextMenu}
      {...(native === undefined ? {} : { nativeContextMenu: native })}
    />,
  );
  settleEditors(document.body);
  const content = document.querySelector<HTMLElement>('.cm-content')!;
  const ev = createEvent.contextMenu(content, { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
  fireEvent(content, ev);
  return { ev, onContextMenu };
}

it('by default the context menu is the app\'s: default prevented and onContextMenu called', () => {
  const { ev, onContextMenu } = mount();
  expect(ev.defaultPrevented).toBe(true);
  expect(onContextMenu).toHaveBeenCalledWith(5, 5);
});

it('nativeContextMenu={false} behaves like the default', () => {
  const { ev, onContextMenu } = mount(false);
  expect(ev.defaultPrevented).toBe(true);
  expect(onContextMenu).toHaveBeenCalledTimes(1);
});

it('nativeContextMenu leaves contextmenu to the OS: not prevented, no callback', () => {
  const { ev, onContextMenu } = mount(true);
  expect(ev.defaultPrevented).toBe(false);
  expect(onContextMenu).not.toHaveBeenCalled();
});
