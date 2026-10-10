import { act, screen } from '@testing-library/react';
import { offsetToPoint } from '../components/inplace';

/** Helpers for tests of editing in place: the caret is placed in the DOM, as a click or arrow key would. */

export const view = () => screen.getByTestId('markdown-view');

/** Lets selectionchange handlers and the renders they cause finish. */
export const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

/** Blocks currently showing their source spans (the ones the caret touches). */
export const activeBlocks = () => Array.from(view().querySelectorAll<HTMLElement>('[data-active]'));

/** The Markdown of the active blocks, read from the spans that carry it (a thread marker shows as its glyph). */
export const activeSource = () =>
  activeBlocks()
    .map((b) => Array.from(b.querySelectorAll('[data-s]')).map((s) => s.textContent).join(''))
    .join('\n\n');

/**
 * Syntax text on screen: what document.css shows (jsdom does not apply it) is the syntax of the active
 * blocks, and only while the Show markers option is on.
 */
export function shownMarkers(): string[] {
  if (view().dataset.markers !== 'on') return [];
  return Array.from(view().querySelectorAll<HTMLElement>('[data-active] .gonq-mk')).map((el) => el.textContent ?? '');
}

const textNodes = (el: Element) => {
  const out: Text[] = [];
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!n.parentElement?.closest('.gonq-mk')) out.push(n as Text);
  return out;
};

/** Puts the caret in the text of `el`, `at` characters in (or at its end). */
export async function caretIn(el: Element, at: number | 'end' = 'end') {
  const nodes = textNodes(el);
  let left = at === 'end' ? Infinity : at;
  let target: [Node, number] = [nodes[0] ?? el, 0];
  for (const n of nodes) {
    target = [n, Math.min(left, n.length)];
    if (left <= n.length) break;
    left -= n.length;
  }
  act(() => window.getSelection()!.setBaseAndExtent(target[0], target[1], target[0], target[1]));
  await settle();
}

/** Selects from `a` to `b`, each a [element, characters-in] pair. */
export async function selectBetween(a: [Element, number], b: [Element, number]) {
  const point = ([el, at]: [Element, number]): [Node, number] => {
    let left = at;
    const nodes = textNodes(el);
    for (const n of nodes) {
      if (left <= n.length) return [n, left];
      left -= n.length;
    }
    const last = nodes[nodes.length - 1];
    return [last, last.length];
  };
  const [an, ao] = point(a);
  const [fn, fo] = point(b);
  act(() => window.getSelection()!.setBaseAndExtent(an, ao, fn, fo));
  await settle();
}

/** Selects file offsets [from, to] inside the blocks that are already active. */
export async function selectSource(from: number, to = from) {
  const a = offsetToPoint(view(), from, true);
  const b = offsetToPoint(view(), to, true);
  if (!a || !b) throw new Error(`offset ${from}..${to} is not in an active block`);
  act(() => window.getSelection()!.setBaseAndExtent(a[0], a[1], b[0], b[1]));
  await settle();
}
