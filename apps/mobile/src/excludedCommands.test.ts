/** The exact list of registry commands the mobile menus skip, checked against the real registry. */
import { registry } from '@gonq/editor/commands';
import { EXCLUDED_COMMAND_IDS } from './excludedCommands';

describe('EXCLUDED_COMMAND_IDS', () => {
  it('is exactly the Connect to Server command', () => {
    expect(EXCLUDED_COMMAND_IDS).toEqual(['file.connect']);
  });

  it('names registered commands', () => {
    const all = registry.commands();
    expect(all.length).toBeGreaterThan(10);
    const connect = all.find((c) => c.id === 'file.connect');
    expect(connect?.menu).toBe('file');
    expect(connect?.label).toBe('Connect to Server…');
  });

  it('leaves no other SSH, server or remote-folder command in the registry', () => {
    const sshLike = registry
      .commands()
      .filter((c) => /ssh|remote|server|connect/i.test(`${c.id} ${c.label}`))
      .map((c) => c.id);
    expect(sshLike).toEqual(EXCLUDED_COMMAND_IDS);
  });
});
