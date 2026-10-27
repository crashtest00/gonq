/**
 * The File menu and its document commands (New, Open, Open Folder, Connect to Server, Save, Commit, Save As, Close Tab),
 * registered with the command registry as a side effect of being imported (see commands/index.ts).
 */
import { defineCommand, defineMenu } from '../../commands/registry';

defineMenu({ id: 'file', label: 'File', order: 10 });

defineCommand({ id: 'file.new', menu: 'file', group: 0, order: 10, label: 'New', shortcut: 'Ctrl+N', focusEditor: true, run: (ctx) => ctx.newFile() });
defineCommand({ id: 'file.open', menu: 'file', group: 0, order: 20, label: 'Open…', shortcut: 'Ctrl+O', focusEditor: true, run: (ctx) => ctx.openFile() });
defineCommand({ id: 'file.openFolder', menu: 'file', group: 0, order: 30, label: 'Open Folder…', run: (ctx) => ctx.openFolder() });
defineCommand({ id: 'file.connect', menu: 'file', group: 0, order: 40, label: 'Connect to Server…', shortcut: 'Ctrl+Shift+K', run: (ctx) => ctx.openConnect() });

defineCommand({ id: 'file.save', menu: 'file', group: 1, order: 10, label: 'Save', shortcut: 'Ctrl+S', enabled: (ctx) => ctx.hasDocument, run: (ctx) => ctx.save() });
// On a GitHub tab Save (Ctrl+S) is the commit flow; Commit… is the same action by name and is enabled only there, and greyed while a pull request is open for the branch (the tab is read-only).
defineCommand({ id: 'file.commit', menu: 'file', group: 1, order: 20, label: 'Commit…', enabled: (ctx) => ctx.isGithubTab && !ctx.readOnly, run: (ctx) => ctx.commit() });
defineCommand({ id: 'file.saveAs', menu: 'file', group: 1, order: 15, label: 'Save As…', shortcut: 'Ctrl+Shift+S', enabled: (ctx) => ctx.hasDocument, run: (ctx) => ctx.saveAs() });

// Ctrl+W closes the tab but the menu has never shown it.
defineCommand({ id: 'file.closeTab', menu: 'file', group: 2, order: 10, label: 'Close Tab', shortcut: 'Ctrl+W', showShortcut: false, enabled: (ctx) => ctx.hasDocument, run: (ctx) => ctx.closeTab() });
