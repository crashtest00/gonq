/**
 * <EditorSheet/>: the touch counterpart of the desktop right-click menu, a bottom sheet "Editor" generated from
 * registry.resolveContextMenu (the commands with a contextMenu placement: Add Comment | Cut, Copy, Paste | Select All |
 * Bold, Italic), with a divider where the group changes. Disabled commands stay in the list, disabled. No shortcut
 * hints. useLongPress(onLongPress) gives the props that open it: a touch held still for LONG_PRESS_MS on the text.
 * It never prevents the default, so the OS selection handles and text menu keep working. Exports EditorSheet,
 * useLongPress and LONG_PRESS_MS (the touch that opens the sheet is released without the scrim tap closing it).
 */
import { useRef, type PointerEvent } from 'react';
import { registry } from '@gonq/editor/commands';
import { BottomSheet } from '../shell/BottomSheet';
import { useCommandHost } from '../shell/commandContext';

/** Shorter than Android's own long-press (about 500 ms), so Gonq's sheet is up as the native selection starts. */
export const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;
/** Lifting the finger that opened the sheet can click the scrim that appeared under it; a click this soon after the release is not a dismissal. */
const RELEASE_GRACE_MS = 400;

export function EditorSheet({ open, onClose, releasing }: { open: boolean; onClose(): void; /** True while the opening finger is down or only just lifted: scrim taps are ignored. */ releasing?: () => boolean }) {
  const { ctx, editor } = useCommandHost();
  return (
    <BottomSheet open={open} title="Editor" onClose={() => releasing?.() !== true && onClose()}>
      {open && (
        <div role="menu" aria-label="Editor">
          {registry.resolveContextMenu(ctx).map((e) => (
            <div key={e.command.id}>
              {e.divider && <div role="separator" style={{ height: 1, background: 'var(--border)', margin: 'var(--space-1) 0' }} />}
              <button
                type="button"
                role="menuitem"
                className="m-tap"
                style={{ width: '100%', justifyContent: 'flex-start', borderRadius: 0 }}
                disabled={!e.enabled}
                onClick={() => {
                  onClose();
                  void e.command.run?.(ctx);
                  editor.current?.focus();
                }}
              >
                {e.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </BottomSheet>
  );
}

/** Pointer handlers for the editor's wrapper: calls `onLongPress` when a touch stays within a few px on the text for LONG_PRESS_MS. */
export function useLongPress(onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const down = useRef(false);
  const upAt = useRef(-Infinity);
  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  return {
    onPointerDown(e: PointerEvent) {
      cancel();
      if (e.pointerType === 'mouse' || !e.isPrimary || !(e.target instanceof Element) || e.target.closest('.cm-content') === null) return;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        cancel();
        down.current = true;
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onPointerMove(e: PointerEvent) {
      const s = start.current;
      if (s !== null && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_TOLERANCE_PX) cancel();
    },
    onPointerUp() {
      cancel();
      down.current = false;
      upAt.current = performance.now();
    },
    onPointerCancel() {
      cancel();
      down.current = false;
      upAt.current = performance.now();
    },
    /** The finger that opened the sheet is still down or only just lifted. */
    releasing: () => down.current || performance.now() - upAt.current < RELEASE_GRACE_MS,
  };
}
