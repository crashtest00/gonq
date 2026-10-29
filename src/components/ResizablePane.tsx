/**
 * ResizablePane: wraps a side pane (folder navigator, outline or comments) at a user-set width with a drag
 * handle on the edge it shares with the editor. Exports ResizablePane.
 *
 * The handle is a WAI-ARIA window splitter (role=separator, aria-orientation=vertical, aria-valuenow/min/max in
 * px). Pointer events with pointer capture drive dragging, so mouse, touch and pen work and the drag continues
 * outside the handle and the window; text selection is off while dragging. Keyboard: Left/Right arrows move the
 * edge 16 px (Shift: 64 px), Home = minimum, End = maximum, Enter = reset to the default, Escape = cancel a
 * drag in progress. Double-click resets to the default. The width is saved on release / key press, never while
 * the pointer is still moving; the limits are in paneWidths.ts. Library choice: see docs/resizable-panes.md.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { PaneName } from '../platform/settings';
import { PANE_MIN, type PaneLayout } from './paneWidths';

const STEP = 16;
const BIG_STEP = 64;

const LABELS: Record<PaneName, string> = { navigator: 'Resize folder navigator', outline: 'Resize outline', comments: 'Resize comments' };

interface Drag {
  startX: number;
  startWidth: number;
}

export function ResizablePane({
  pane,
  edge,
  layout,
  otherOpen,
  children,
}: {
  pane: PaneName;
  /** Which edge of the pane touches the editor: 'right' for the left-hand panes, 'left' for comments. */
  edge: 'left' | 'right';
  layout: PaneLayout;
  /** The other pane open beside this one, whose width limits this one. */
  otherOpen: PaneName | null;
  children: ReactNode;
}) {
  const stored = layout.widthOf(pane, otherOpen);
  const max = layout.maxOf(pane, otherOpen);
  const min = Math.min(PANE_MIN[pane], max);
  const [live, setLive] = useState<number | null>(null);
  const drag = useRef<Drag | null>(null);
  const width = live ?? stored;
  // +1 when moving the pointer right makes the pane wider.
  const dir = edge === 'right' ? 1 : -1;
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));

  const endDrag = () => {
    drag.current = null;
    setLive(null);
    document.body.style.userSelect = '';
  };
  // A drag cut short by unmounting must not leave text selection off.
  useEffect(() => () => void (document.body.style.userSelect = ''), []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
    e.currentTarget.focus();
    drag.current = { startX: e.clientX, startWidth: width };
    document.body.style.userSelect = 'none';
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) setLive(clamp(d.startWidth + dir * (e.clientX - d.startX)));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const final = clamp(d.startWidth + dir * (e.clientX - d.startX));
    endDrag();
    if (final !== stored) layout.commit(pane, final);
  };
  const reset = () => {
    endDrag();
    layout.commit(pane, null);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? BIG_STEP : STEP;
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = width + dir * step;
    else if (e.key === 'ArrowLeft') next = width - dir * step;
    else if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    else if (e.key === 'Enter') {
      e.preventDefault();
      reset();
      return;
    } else if (e.key === 'Escape' && drag.current) {
      endDrag();
      return;
    } else return;
    e.preventDefault();
    const clamped = clamp(next);
    if (clamped !== stored) layout.commit(pane, clamped);
  };

  const handle = (
    <div className="relative w-0 shrink-0">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={LABELS[pane]}
        aria-valuenow={width}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        data-pane-handle={pane}
        data-dragging={live !== null ? '' : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={endDrag}
        onLostPointerCapture={() => drag.current && endDrag()}
        onDoubleClick={reset}
        onKeyDown={onKeyDown}
        className="group absolute inset-y-0 -left-1 z-10 flex w-2 cursor-col-resize touch-none justify-center outline-none"
      >
        <div className="h-full w-0.5 bg-transparent group-hover:bg-ring group-focus-visible:bg-ring group-data-[dragging]:bg-ring" />
      </div>
    </div>
  );

  return (
    <>
      {edge === 'left' && handle}
      <div className="flex min-h-0 shrink-0 overflow-hidden" style={{ width }} data-pane={pane}>
        {children}
      </div>
      {edge === 'right' && handle}
    </>
  );
}
