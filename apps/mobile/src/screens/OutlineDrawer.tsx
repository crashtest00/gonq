/**
 * <OutlineDrawer/> and <OutlineButton/>: the mobile counterpart of OutlineSidebar.tsx. The drawer slides in from the
 * left over the editor: header "Outline", the headings of the active document from model/outline (level 1 semibold,
 * deeper levels muted and indented, no "current heading" row), "No headings." when there are none; tapping a heading
 * jumps the editor there (the editor handle's reveal, selecting the heading) and closes the drawer. OutlineButton is
 * the top-bar button (outside the command registry).
 */
import { useMemo } from 'react';
import { outlineOf } from '@gonq/editor/model/outline';
import { useCommandHost } from '../shell/commandContext';
import { useDocuments } from '../shell/documents';
import { useOutline } from '../shell/outline';

export function OutlineDrawer() {
  const { open, close } = useOutline();
  const { session } = useDocuments();
  const { editor } = useCommandHost();
  const text = session.text;
  const items = useMemo(() => (open ? outlineOf(text) : []), [open, text]);
  if (!open) return null;
  return (
    <>
      <div className="m-scrim" data-testid="outline-scrim" onClick={close} />
      <aside className="m-drawer" role="dialog" aria-modal="true" aria-label="Outline">
        <div className="m-drawer-head">
          <div className="m-label">Outline</div>
          <button type="button" className="m-tap" aria-label="Close outline" onClick={close}>
            ✕
          </button>
        </div>
        {items.length === 0 ? (
          <p className="m-drawer-empty">No headings.</p>
        ) : (
          <ul className="m-outline-list">
            {items.map((item) => (
              <li key={item.from}>
                <button
                  type="button"
                  className="m-tap m-outline-row"
                  data-level={item.level}
                  title={item.text}
                  style={{ paddingLeft: 20 + (item.level - 1) * 12 }}
                  onClick={() => {
                    close();
                    editor.current?.reveal(item.from, true);
                  }}
                >
                  {item.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </>
  );
}

/** The top-bar Outline button: opens the drawer (closes it when open). Not a registry command. */
export function OutlineButton() {
  const { open, toggle } = useOutline();
  return (
    <button type="button" className="m-tap" aria-label="Document outline" title="Document outline" aria-haspopup="dialog" aria-expanded={open} onClick={toggle}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M4 6h16M8 12h12M12 18h8" />
      </svg>
    </button>
  );
}
