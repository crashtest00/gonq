/**
 * <MoreMenu/>: the "⋯" top-bar button and its scrolling bottom sheet "Menu", generated from the command registry
 * (registry.resolveMenus) so it follows the desktop menu bar: every menu with its items in order, separators between
 * groups, submenus (Format > Table, View > Theme) as labelled groups, checkbox and radio rows with a check mark, and
 * disabled commands shown disabled, never hidden. The commands in EXCLUDED_COMMAND_IDS are skipped. Touch sheets show
 * no shortcut hints. Picking a row closes the sheet and runs the command against the mobile CommandContext. Exports MoreMenu.
 */
import { useState } from 'react';
import { registry, type MenuEntry } from '@gonq/editor/commands';
import { EXCLUDED_COMMAND_IDS } from '../excludedCommands';
import { BottomSheet } from '../shell/BottomSheet';
import { useCommandHost } from '../shell/commandContext';

const rowStyle = { width: '100%', justifyContent: 'space-between', borderRadius: 0 } as const;

/** Separators only between two kept entries: dropping an excluded command must not leave one at an edge or doubled. */
function tidy(entries: MenuEntry[]): MenuEntry[] {
  const kept = entries.filter((e) => e.type === 'separator' || !EXCLUDED_COMMAND_IDS.includes(e.command.id));
  return kept.filter((e, i) => e.type !== 'separator' || (i > 0 && i < kept.length - 1 && kept[i - 1].type !== 'separator'));
}

export function MoreMenu() {
  const [open, setOpen] = useState(false);
  const { ctx, editor } = useCommandHost();

  const run = (command: { run?: (c: typeof ctx) => unknown; focusEditor?: boolean }, closeFocus?: (c: typeof ctx) => void) => {
    setOpen(false);
    void command.run?.(ctx);
    if (closeFocus !== undefined) closeFocus(ctx);
    else if (command.focusEditor) editor.current?.focus();
  };

  const rows = (entries: MenuEntry[], menuEnabled: boolean, closeFocus?: (c: typeof ctx) => void) =>
    tidy(entries).map((e, i) => {
      if (e.type === 'separator') return <div key={`sep${i}`} role="separator" style={{ height: 1, background: 'var(--border)', margin: 'var(--space-1) 0' }} />;
      const { command } = e;
      const disabled = !menuEnabled || !e.enabled;
      if (e.type === 'submenu') {
        return (
          <div key={command.id} role="group" aria-label={command.label}>
            <div className="m-label" aria-hidden="true">
              {command.label}
            </div>
            {rows(e.items, !disabled, closeFocus)}
          </div>
        );
      }
      const role = command.kind === 'checkbox' ? 'menuitemcheckbox' : command.kind === 'radio' ? 'menuitemradio' : 'menuitem';
      return (
        <button
          key={command.id}
          type="button"
          role={role}
          data-command={command.id}
          className="m-tap"
          style={rowStyle}
          disabled={disabled}
          {...(role === 'menuitem' ? {} : { 'aria-checked': e.checked })}
          onClick={() => run(command, closeFocus)}
        >
          {command.label}
          {role !== 'menuitem' && <span aria-hidden="true">{e.checked ? '✓' : ''}</span>}
        </button>
      );
    });

  return (
    <>
      <button type="button" className="m-tap" aria-label="More" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        ⋯
      </button>
      <BottomSheet open={open} title="Menu" onClose={() => setOpen(false)}>
        {open &&
          registry.resolveMenus(ctx).map(({ menu, enabled, entries }) => (
            <div key={menu.id} role="menu" aria-label={menu.label}>
              <div className="m-label" aria-hidden="true">
                {menu.label}
              </div>
              {rows(entries, enabled, menu.closeFocus)}
            </div>
          ))}
      </BottomSheet>
    </>
  );
}
