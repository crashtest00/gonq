/** Resizable side panes in the app: drag, limits, keyboard, double-click reset, persistence and window clamping. */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { menu, openDocument, renderApp, testDoc } from '../testing/renderApp';
import { PANE_WIDTHS_KEY } from '@gonq/editor/platform/settings';

const doc = testDoc('# Title\n\nbody\n');

// jsdom has no PointerEvent, so fireEvent.pointer* would drop clientX.
if (!('PointerEvent' in window)) {
  class PointerEventShim extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  Object.defineProperty(window, 'PointerEvent', { value: PointerEventShim });
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true, writable: true });
});

async function setup() {
  const r = renderApp({ docs: doc });
  await openDocument(r.user);
  return r;
}
const handle = (name: RegExp | string) => screen.getByRole('separator', { name });
const paneWidth = (pane: string) => (document.querySelector(`[data-pane="${pane}"]`) as HTMLElement).style.width;
const saved = () => JSON.parse(localStorage.getItem(PANE_WIDTHS_KEY) ?? '{}');
const drag = (el: HTMLElement, from: number, to: number) => {
  fireEvent.pointerDown(el, { button: 0, clientX: from, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: to, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: to, pointerId: 1 });
};

test('each pane opens at its default width with an accessible separator', async () => {
  const { user } = await setup();
  await user.click(screen.getByRole('button', { name: 'Document outline' }));
  const h = handle('Resize outline');
  expect(h).toHaveAttribute('aria-orientation', 'vertical');
  expect(h).toHaveAttribute('aria-valuenow', '240');
  expect(h).toHaveAttribute('aria-valuemin', '160');
  expect(h).toHaveAttribute('aria-valuemax', '480');
  expect(paneWidth('outline')).toBe('240px');
  expect(h).toHaveAttribute('tabindex', '0');
});

test('dragging the outline handle right widens it, stops at the maximum, and is saved on release', async () => {
  const { user } = await setup();
  await user.click(screen.getByRole('button', { name: 'Document outline' }));
  drag(handle('Resize outline'), 240, 300);
  expect(paneWidth('outline')).toBe('300px');
  expect(saved()).toEqual({ outline: 300 });
  drag(handle('Resize outline'), 300, 2000);
  expect(paneWidth('outline')).toBe('480px');
  drag(handle('Resize outline'), 480, -2000);
  expect(paneWidth('outline')).toBe('160px');
});

test('nothing is saved while the pointer is still down; Escape cancels the drag', async () => {
  const { user } = await setup();
  await user.click(screen.getByRole('button', { name: 'Document outline' }));
  const h = handle('Resize outline');
  fireEvent.pointerDown(h, { button: 0, clientX: 240, pointerId: 1 });
  fireEvent.pointerMove(h, { clientX: 320, pointerId: 1 });
  expect(paneWidth('outline')).toBe('320px');
  expect(document.body.style.userSelect).toBe('none');
  expect(localStorage.getItem(PANE_WIDTHS_KEY)).toBeNull();
  fireEvent.keyDown(h, { key: 'Escape' });
  expect(paneWidth('outline')).toBe('240px');
  expect(document.body.style.userSelect).toBe('');
  fireEvent.pointerUp(h, { clientX: 320, pointerId: 1 });
  expect(localStorage.getItem(PANE_WIDTHS_KEY)).toBeNull();
});

test('the comments handle sits on the pane\'s left edge: dragging left widens it', async () => {
  const { user } = await setup();
  await user.click(screen.getByRole('button', { name: /comments/i }));
  drag(handle('Resize comments'), 800, 740);
  expect(paneWidth('comments')).toBe('400px');
  expect(saved()).toEqual({ comments: 400 });
});

test('arrow keys resize in steps, Home/End jump to the limits, Enter and double-click reset', async () => {
  const { user } = await setup();
  await user.click(screen.getByRole('button', { name: 'Folder navigator' }));
  const h = handle('Resize folder navigator');
  fireEvent.keyDown(h, { key: 'ArrowRight' });
  expect(h).toHaveAttribute('aria-valuenow', '256');
  fireEvent.keyDown(h, { key: 'ArrowLeft', shiftKey: true });
  expect(h).toHaveAttribute('aria-valuenow', '192');
  fireEvent.keyDown(h, { key: 'End' });
  expect(h).toHaveAttribute('aria-valuenow', '480');
  fireEvent.keyDown(h, { key: 'Home' });
  expect(h).toHaveAttribute('aria-valuenow', '160');
  expect(saved()).toEqual({ navigator: 160 });
  fireEvent.doubleClick(h);
  expect(h).toHaveAttribute('aria-valuenow', '240');
  expect(saved()).toEqual({});
  fireEvent.keyDown(h, { key: 'ArrowRight' });
  fireEvent.keyDown(h, { key: 'Enter' });
  expect(paneWidth('navigator')).toBe('240px');
  expect(saved()).toEqual({});
});

test('a saved width is used when the pane is closed and reopened, and after a restart', async () => {
  localStorage.setItem(PANE_WIDTHS_KEY, JSON.stringify({ outline: 300, comments: 500 }));
  const { user } = await setup();
  const toggle = screen.getByRole('button', { name: 'Document outline' });
  await user.click(toggle);
  await waitFor(() => expect(paneWidth('outline')).toBe('300px'));
  await user.click(toggle);
  await user.click(screen.getByRole('button', { name: 'Folder navigator' }));
  expect(paneWidth('navigator')).toBe('240px');
  await user.click(screen.getByRole('button', { name: 'Document outline' }));
  expect(paneWidth('outline')).toBe('300px');
  await user.click(screen.getByRole('button', { name: /comments/i }));
  expect(paneWidth('comments')).toBe('500px');
});

test('opening another pane does not change a width; a narrow window clamps the display only', async () => {
  localStorage.setItem(PANE_WIDTHS_KEY, JSON.stringify({ outline: 300, comments: 560 }));
  const { user } = await setup();
  await user.click(screen.getByRole('button', { name: 'Document outline' }));
  await user.click(screen.getByRole('button', { name: /comments/i }));
  await waitFor(() => expect(paneWidth('outline')).toBe('280px'));
  // The editor keeps 360: the outline gives up 20 px of its 300 (1200 - 560 - 360 = 280), comments 20 of its 560.
  expect(paneWidth('comments')).toBe('540px');
  act(() => {
    window.innerWidth = 500;
    window.dispatchEvent(new Event('resize'));
  });
  expect(paneWidth('outline')).toBe('160px');
  expect(paneWidth('comments')).toBe('240px');
  act(() => {
    window.innerWidth = 1200;
    window.dispatchEvent(new Event('resize'));
  });
  expect(paneWidth('outline')).toBe('280px');
  expect(saved()).toEqual({ outline: 300, comments: 560 });
});
