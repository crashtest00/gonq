/** <HScroll/>: a row of controls that scrolls sideways when it is wider than the screen; the edge fades (styles.css .m-hscroll) are the visible cue. */
import type { ReactNode } from 'react';

export function HScroll({ children, label, className = '' }: { children: ReactNode; label: string; className?: string }) {
  return (
    <div className={`m-hscroll ${className}`.trim()} role="group" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
