/**
 * <BottomSheet/>: the modal sheet that slides up from the bottom edge (commit, comments, menus in later stories).
 * A dialog with a title, a Close button and a scrim that closes it when tapped; renders nothing while `open` is
 * false (or, with `keepMounted`, its content inside a hidden element). `docked` makes it a non-modal panel in the flow (the Comments sheet). Nothing here listens for keys: it is a touch surface.
 */
import type { ReactNode } from 'react';

export interface BottomSheetProps {
  open: boolean;
  title: string;
  onClose(): void;
  children?: ReactNode;
  /** Docked: laid out in the flow below its siblings (no scrim, not modal) so the content above it stays visible and usable. */
  docked?: boolean;
  /** Closed, stay mounted but `hidden` (so what is inside keeps its state, like a folder tree's expanded folders). */
  keepMounted?: boolean;
}

export function BottomSheet({ open, title, onClose, children, docked = false, keepMounted = false }: BottomSheetProps) {
  if (!open && !keepMounted) return null;
  const sheet = (
    <>
      {!docked && <button type="button" className="m-scrim" aria-label="Close sheet" onClick={onClose} />}
      <section className={docked ? 'm-sheet m-sheet-docked' : 'm-sheet'} role="dialog" aria-modal={!docked} aria-label={title}>
        <div className="m-sheet-head">
          <h2>{title}</h2>
          <button type="button" className="m-tap" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </section>
    </>
  );
  // Kept mounted, the same elements stay in place (hidden) so their state is not lost when it closes.
  return keepMounted ? <div hidden={!open}>{sheet}</div> : sheet;
}
