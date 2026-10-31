/**
 * <BottomSheet/>: the modal sheet that slides up from the bottom edge (commit, comments, menus in later stories).
 * A dialog with a title, a Close button and a scrim that closes it when tapped; renders nothing while `open` is
 * false. `docked` makes it a non-modal panel in the flow (the Comments sheet). Nothing here listens for keys: it is a touch surface.
 */
import type { ReactNode } from 'react';

export interface BottomSheetProps {
  open: boolean;
  title: string;
  onClose(): void;
  children?: ReactNode;
  /** Docked: laid out in the flow below its siblings (no scrim, not modal) so the content above it stays visible and usable. */
  docked?: boolean;
}

export function BottomSheet({ open, title, onClose, children, docked = false }: BottomSheetProps) {
  if (!open) return null;
  return (
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
}
