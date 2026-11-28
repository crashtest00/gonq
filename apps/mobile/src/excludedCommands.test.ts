/** The exact list of registry commands the mobile menus skip, checked against the real registry. */
import { registry } from '@gonq/editor/commands';
import { EXCLUDED_COMMAND_IDS } from './excludedCommands';

describe('EXCLUDED_COMMAND_IDS', () => {
  it('is exactly Connect to Server and Close Tab', () => {
    expect(EXCLUDED_COMMAND_IDS).toEqual(['file.connect', 'file.closeTab']);
  });

  it('names registered commands', () => {
    const all = registry.commands();
    expect(all.length).toBeGreaterThan(10);
    const connect = all.find((c) => c.id === 'file.connect');
    expect(connect?.menu).toBe('file');
    expect(connect?.label).toBe('Connect to Server…');
    // Close Tab stays in the desktop menu; mobile leaves it out because each tab has its own close control.
    expect(all.find((c) => c.id === 'file.closeTab')?.menu).toBe('file');
  });

  it('leaves no other SSH, server or remote-folder command in the registry', () => {
    const sshLike = registry
      .commands()
      .filter((c) => /ssh|remote|server|connect/i.test(`${c.id} ${c.label}`))
      .map((c) => c.id);
    expect(sshLike).toEqual(['file.connect']);
  });
});
