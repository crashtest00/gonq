/**
 * The File menu and its document commands (New, Open, Open Recent, Open Folder, Connect to Server, Save, Save As, Close Tab),
 * registered with the command registry as a side effect of being imported (see commands/index.ts).
 */
import { recentLabel } from '../../model/recentRow';
import { MAX_RECENTS } from '../../platform/recents';
import { defineCommand, defineMenu } from '../../commands/registry';

defineMenu({ id: 'file', label: 'File', order: 10 });

defineCommand({ id: 'file.new', menu: 'file', group: 0, order: 10, label: 'New', shortcut: 'Ctrl+N', focusEditor: true, run: (ctx) => ctx.newFile() });
defineCommand({ id: 'file.open', menu: 'file', group: 0, order: 20, label: 'Open…', shortcut: 'Ctrl+O', focusEditor: true, run: (ctx) => ctx.openFile() });
// Open Recent lists the context's recents (computed items); with none it stays, disabled.
defineCommand({
  id: 'file.openRecent',
  menu: 'file',
  group: 0,
  order: 25,
  label: 'Open Recent',
  kind: 'submenu',
  enabled: (ctx) => ctx.recents.length > 0,
  items: (ctx) => ctx.recents.slice(0, MAX_RECENTS).map((r) => ({ key: r.path, label: recentLabel(r.path), run: (c) => c.openRecent(r.path) })),
});
defineCommand({ id: 'file.openFolder', menu: 'file', group: 0, order: 30, label: 'Open Folder…', run: (ctx) => ctx.openFolder() });
defineCommand({ id: 'file.connect', menu: 'file', group: 0, order: 40, label: 'Connect to Server…', shortcut: 'Ctrl+Shift+K', run: (ctx) => ctx.openConnect() });

defineCommand({ id: 'file.save', menu: 'file', group: 1, order: 10, label: 'Save', shortcut: 'Ctrl+S', enabled: (ctx) => ctx.hasDocument, run: (ctx) => ctx.save() });
defineCommand({ id: 'file.saveAs', menu: 'file', group: 1, order: 15, label: 'Save As…', shortcut: 'Ctrl+Shift+S', enabled: (ctx) => ctx.hasDocument, run: (ctx) => ctx.saveAs() });

// Ctrl+W closes the tab but the menu has never shown it.
defineCommand({ id: 'file.closeTab', menu: 'file', group: 2, order: 10, label: 'Close Tab', shortcut: 'Ctrl+W', showShortcut: false, enabled: (ctx) => ctx.hasDocument, run: (ctx) => ctx.closeTab() });
