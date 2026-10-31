/**
 * <PhoneShell/>: the frame every screen sits in: a safe-area top bar (env(safe-area-inset-*)) with a Back button when
 * the stack is deeper than one and the screen's title and actions, the NoticeBanner, and the scrolling content area. A screen with
 * no title (the splash) gets no top bar.
 */
import type { ReactNode } from 'react';
import { NoticeBanner } from './notices';
import { useNavigator } from './StackNavigator';

export function PhoneShell({ children }: { children: ReactNode }) {
  const { top, stack, pop } = useNavigator();
  return (
    <div className="m-shell">
      {top.title !== null && (
        <header className="m-topbar">
          {stack.length > 1 && (
            <button type="button" className="m-tap" aria-label="Back" onClick={pop}>
              ←
            </button>
          )}
          <h1>{top.title}</h1>
          {top.actions?.()}
        </header>
      )}
      <NoticeBanner />
      <main className="m-content">{children}</main>
    </div>
  );
}
