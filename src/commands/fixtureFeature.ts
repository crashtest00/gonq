/** Test fixture: a feature module that adds one File menu item by registering a command, the way a real feature's index.ts does. */
import { defineCommand } from './registry';

export const fixtureRun = { calls: 0 };

defineCommand({
  id: 'fixture.hello',
  menu: 'file',
  group: 9,
  order: 1,
  label: 'Fixture Hello',
  shortcut: 'Ctrl+Shift+H',
  run: () => {
    fixtureRun.calls++;
  },
});
