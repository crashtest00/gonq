/**
 * The Edit menu (Undo, Redo, Settings) and the clipboard and Select All items of the editor's right-click menu, registered with the command registry as a side effect of being
 * imported (see commands/index.ts). Undo and Redo keys are left to the editor and to text fields.
 */
import { defineCommand, defineMenu } from '../../commands/registry';
import type { CommandContext } from '../../commands/context';

defineMenu({ id: 'edit', label: 'Edit', order: 20 });

defineCommand({
  id: 'edit.undo',
  menu: 'edit',
  group: 0,
  order: 10,
  label: 'Undo',
  shortcut: 'Ctrl+Z',
  skipInTextFields: true,
  enabled: (ctx) => ctx.canUndo,
  run: (ctx) => ctx.editor.current?.undo(),
});
defineCommand({
  id: 'edit.redo',
  menu: 'edit',
  group: 0,
  order: 20,
  label: 'Redo',
  shortcut: 'Ctrl+Y',
  aliases: ['Ctrl+Shift+Z'],
  skipInTextFields: true,
  enabled: (ctx) => ctx.canRedo,
  run: (ctx) => ctx.editor.current?.redo(),
});
defineCommand({ id: 'edit.settings', menu: 'edit', group: 1, order: 10, label: 'Settings…', shortcut: 'Ctrl+,', run: (ctx) => ctx.openSettings() });

/** Cut, copy or paste through the clipboard; a failure shows in the error banner. */
function clipboard(ctx: CommandContext, op: 'cut' | 'copy' | 'paste') {
  ctx.editor.current?.[op]().then(
    () => ctx.setError(null),
    (e: unknown) => ctx.setError(e instanceof Error ? e.message : String(e)),
  );
}

// Listed only in the editor's right-click menu.
defineCommand({ id: 'edit.cut', group: 0, order: 20, label: 'Cut', contextMenu: { group: 10, order: 10 }, enabled: (ctx) => ctx.hasSelection, run: (ctx) => clipboard(ctx, 'cut') });
defineCommand({ id: 'edit.copy', group: 0, order: 30, label: 'Copy', contextMenu: { group: 10, order: 20 }, enabled: (ctx) => ctx.hasSelection, run: (ctx) => clipboard(ctx, 'copy') });
defineCommand({ id: 'edit.paste', group: 0, order: 40, label: 'Paste', contextMenu: { group: 10, order: 30 }, run: (ctx) => clipboard(ctx, 'paste') });
defineCommand({ id: 'edit.selectAll', group: 0, order: 50, label: 'Select All', contextMenu: { group: 20, order: 10 }, run: (ctx) => ctx.editor.current?.selectAll() });
