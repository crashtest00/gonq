/**
 * The Edit menu (Undo, Redo, Preferences), registered with the command registry as a side effect of being
 * imported (see commands/index.ts). Undo and Redo keys are left to the editor and to text fields.
 */
import { defineCommand, defineMenu } from '../../commands/registry';

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
defineCommand({ id: 'edit.preferences', menu: 'edit', group: 1, order: 10, label: 'Preferences…', shortcut: 'Ctrl+,', run: (ctx) => ctx.openPreferences() });
