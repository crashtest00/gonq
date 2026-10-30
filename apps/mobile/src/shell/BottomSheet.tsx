/**
 * <BottomSheet/>: the modal sheet that slides up from the bottom edge (commit, comments, menus in later stories).
 * A dialog with a title, a Close button and a scrim that closes it when tapped; renders nothing while `open` is
 * false. Nothing here listens for keys: it is a touch surface.
 */
import type { ReactNode } from 'react';

export interface BottomSheetProps {
  open: boolean;
  title: string;
  onClose(): void;
  children?: ReactNode;
}

export function BottomSheet({ open, title, onClose, children }: BottomSheetProps) {
  if (!open) return null;
  return (
    <>
      <button type="button" className="m-scrim" aria-label="Close sheet" onClick={onClose} />
      <section className="m-sheet" role="dialog" aria-modal="true" aria-label={title}>
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
