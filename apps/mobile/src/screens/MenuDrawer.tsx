/**
 * <MenuDrawer/>: the ☰ ("Menu") top-bar button in a screen's leading slot and the left side drawer it opens, which drills
 * down through the command registry (registry.resolveMenus) one level at a time: the menus (each with a "›"), then a menu's
 * items, then a submenu's items (View > Theme, Format > Table, File > Open Recent). A back control returns one level; the
 * close control, the scrim and the Android Back key (one level per press, via useBackHandler) close it. Separators, check
 * and radio rows and disabled commands follow the registry and are shown, never hidden; the commands in
 * EXCLUDED_COMMAND_IDS are skipped; no shortcut hints on touch. Choosing a command closes the drawer and runs it against the
 * mobile CommandContext with the menu's closeFocus or the command's focusEditor. It has a filled header band and slides in,
 * unlike the plain Outline drawer. Exports MenuDrawer.
 */
import { useState } from 'react';
import { registry, type MenuEntry } from '@gonq/editor/commands';
import { EXCLUDED_COMMAND_IDS } from '../excludedCommands';
import { useBackHandler } from '../shell/back';
import { useCommandHost } from '../shell/commandContext';

/** Separators only between two kept entries: dropping an excluded command must not leave one at an edge or doubled. */
function tidy(entries: MenuEntry[]): MenuEntry[] {
  const kept = entries.filter((e) => e.type === 'separator' || !EXCLUDED_COMMAND_IDS.includes(e.command.id));
  return kept.filter((e, i) => e.type !== 'separator' || (i > 0 && i < kept.length - 1 && kept[i - 1].type !== 'separator'));
}

const Chevron = () => <span aria-hidden="true">›</span>;

export function MenuDrawer() {
  const [open, setOpen] = useState(false);
  /** The drilled-down levels: a menu id, then submenu command ids. Empty is the list of menus. */
  const [path, setPath] = useState<string[]>([]);
  const { ctx, editor } = useCommandHost();

  const close = () => {
    setOpen(false);
    setPath([]);
  };
  // The Android Back key goes up one level, then closes, like the back and close controls.
  useBackHandler(open, () => (path.length > 0 ? setPath(path.slice(0, -1)) : close()));

  const run = (command: { run?: (c: typeof ctx) => unknown; focusEditor?: boolean }, closeFocus?: (c: typeof ctx) => void) => {
    close();
    void command.run?.(ctx);
    if (closeFocus !== undefined) closeFocus(ctx);
    else if (command.focusEditor) editor.current?.focus();
  };

  const openDrawer = () => {
    // With the soft keyboard up, drop the editor's focus so it closes and the drawer has the whole screen.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('.cm-editor')) active.blur();
    setOpen(true);
  };

  const menus = open ? registry.resolveMenus(ctx) : [];
  const menu = menus.find((m) => m.menu.id === path[0]);
  let title = 'Menu';
  let entries: MenuEntry[] | null = null;
  let enabled = true;
  if (menu !== undefined) {
    title = menu.menu.label;
    entries = tidy(menu.entries);
    enabled = menu.enabled;
    for (const id of path.slice(1)) {
      const sub = entries.find((e) => e.type === 'submenu' && e.command.id === id);
      if (sub?.type !== 'submenu') break;
      title = sub.command.label;
      entries = tidy(sub.items);
      enabled = enabled && sub.enabled;
    }
  }

  const rows = (list: MenuEntry[]) =>
    list.map((e, i) => {
      if (e.type === 'separator') return <div key={`sep${i}`} role="separator" style={{ height: 1, background: 'var(--border)', margin: 'var(--space-1) 0' }} />;
      const { command } = e;
      const disabled = !enabled || !e.enabled;
      if (e.type === 'submenu') {
        return (
          <button key={command.id} type="button" role="menuitem" aria-haspopup="menu" data-submenu={command.id} className="m-tap m-menu-row" disabled={disabled} onClick={() => setPath([...path, command.id])}>
            {command.label}
            <Chevron />
          </button>
        );
      }
      const role = command.kind === 'checkbox' ? 'menuitemcheckbox' : command.kind === 'radio' ? 'menuitemradio' : 'menuitem';
      return (
        <button
          key={command.id}
          type="button"
          role={role}
          data-command={command.id}
          className="m-tap m-menu-row"
          disabled={disabled}
          {...(role === 'menuitem' ? {} : { 'aria-checked': e.checked })}
          onClick={() => run(command, menu?.menu.closeFocus)}
        >
          {command.label}
          {role !== 'menuitem' && <span aria-hidden="true">{e.checked ? '✓' : ''}</span>}
        </button>
      );
    });

  return (
    <>
      <button type="button" className="m-tap" aria-label="Menu" aria-haspopup="dialog" aria-expanded={open} onClick={openDrawer}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      {open && (
        <>
          <button type="button" className="m-scrim" data-testid="menu-scrim" aria-label="Dismiss menu" style={{ zIndex: 21 }} onClick={close} />
          <aside className="m-menu-drawer" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="m-menu-drawer-head">
              {path.length > 0 && (
                <button type="button" className="m-tap" aria-label="Back to menus" onClick={() => setPath(path.slice(0, -1))}>
                  ‹
                </button>
              )}
              <h2>{title}</h2>
              <button type="button" className="m-tap" aria-label="Close menu" onClick={close}>
                ✕
              </button>
            </div>
            <div className="m-menu-drawer-body" role="menu" aria-label={title}>
              {entries === null
                ? menus.map(({ menu: m, enabled: on }) => (
                    <button key={m.id} type="button" role="menuitem" aria-haspopup="menu" data-menu={m.id} className="m-tap m-menu-row" disabled={!on} onClick={() => setPath([m.id])}>
                      {m.label}
                      <Chevron />
                    </button>
                  ))
                : rows(entries)}
            </div>
          </aside>
        </>
      )}
    </>
  );
}
