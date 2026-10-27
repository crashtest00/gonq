/** The editor right-click menu is built from commands' contextMenu placement: a command defined in a test shows up in it, in its group, and runs. */
import { fireEvent, screen, within } from '@testing-library/react';
import { defineCommand } from '../../commands/registry';
import { openDocument, renderApp, testDoc } from '../../testing/renderApp';

const calls: string[] = [];
defineCommand({ id: 'fixture.ctx', group: 9, order: 1, label: 'Fixture Ctx', contextMenu: { group: 99, order: 1 }, run: () => void calls.push('ran') });

test('a feature command with a contextMenu placement appears last in the right-click menu and runs when picked', async () => {
  const { user } = renderApp({ docs: [testDoc('# Title\n\nBody text.\n')] });
  await openDocument(user);
  fireEvent.contextMenu(document.querySelector('.cm-content')!, { clientX: 10, clientY: 10 });
  const names = within(screen.getByRole('menu', { name: 'Editor' })).getAllByRole('menuitem').map((i) => i.textContent);
  expect(names).toEqual(['Add Comment', 'Cut', 'Copy', 'Paste', 'Select All', 'Bold', 'Italic', 'Fixture Ctx']);
  await user.click(screen.getByRole('menuitem', { name: 'Fixture Ctx' }));
  expect(calls).toEqual(['ran']);
});
